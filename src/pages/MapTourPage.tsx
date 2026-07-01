import { useEffect, useMemo, useRef, useState } from "react";
import type { WheelEvent as ReactWheelEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { User } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  createBrowserSupabaseClient,
  getSupabaseBrowserConfig,
} from "@/lib/supabase/client";
import "leaflet/dist/leaflet.css";
import styles from "@/app/maptour/maptour.module.css";

type MapApp = Database["public"]["Tables"]["map_apps"]["Row"];
type MapAppUpdate = Database["public"]["Tables"]["map_apps"]["Update"];
type MapTourPurchase =
  Database["public"]["Tables"]["map_tour_purchases"]["Row"];

type TourCard = {
  id: string;
  title: string;
  body: string;
  hoverText: string;
  lat: number;
  lng: number;
  color: string;
  imageUrls: string[];
  imageTimerSeconds: number;
};

type TourConfig = {
  cards: TourCard[];
  center: [number, number];
  zoom: number;
};

const defaultCenter: [number, number] = [-35.205, 173.95];
const defaultZoom = 11;
const colors = ["#1f4834", "#2563eb", "#be123c", "#b45309", "#6d28d9"];
const freePointLimit = 3;
const paidPointLimit = 10;

function createCard(index: number, lat = defaultCenter[0], lng = defaultCenter[1]): TourCard {
  return {
    id: `tour-card-${Date.now()}-${index}`,
    title: `Tour point ${index + 1}`,
    body: "",
    hoverText: "",
    lat,
    lng,
    color: colors[index % colors.length],
    imageUrls: [],
    imageTimerSeconds: 4,
  };
}

function createPointIcon(index: number, color: string, active: boolean) {
  return L.divIcon({
    className: styles.pointIcon,
    html: `<span style="--point-color:${color}" class="${active ? styles.pointIconActive : ""}">${index}</span>`,
    iconAnchor: [20, 20],
    iconSize: [40, 40],
    popupAnchor: [0, -20],
  });
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function toNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseConfig(config: Json): TourConfig {
  const value = typeof config === "object" && config ? (config as Record<string, unknown>) : {};
  const rawCards = Array.isArray(value.cards) ? value.cards : [];
  const cards = rawCards.map((raw, index) => {
    const card = typeof raw === "object" && raw ? (raw as Record<string, unknown>) : {};
    return {
      id: String(card.id || `tour-card-${index}`),
      title: String(card.title || `Tour point ${index + 1}`),
      body: String(card.body || ""),
      hoverText: String(card.hoverText || ""),
      lat: toNumber(card.lat, defaultCenter[0]),
      lng: toNumber(card.lng, defaultCenter[1]),
      color: String(card.color || colors[index % colors.length]),
      imageUrls: Array.isArray(card.imageUrls)
        ? card.imageUrls.map((item) => String(item || "").trim()).filter(Boolean)
        : [],
      imageTimerSeconds: Math.max(1, toNumber(card.imageTimerSeconds, 4)),
    };
  });

  const centerValue = Array.isArray(value.center) ? value.center : defaultCenter;
  const center: [number, number] = [
    toNumber(centerValue[0], defaultCenter[0]),
    toNumber(centerValue[1], defaultCenter[1]),
  ];

  return {
    cards,
    center,
    zoom: toNumber(value.zoom, defaultZoom),
  };
}

function serializeConfig(config: TourConfig): Json {
  return {
    cards: config.cards,
    center: config.center,
    zoom: config.zoom,
  };
}

function getVisibleMapCenterLatLng(
  map: L.Map,
  target: L.LatLng,
  zoom = map.getZoom(),
) {
  const mapContainer = map.getContainer();
  const mapRect = mapContainer.getBoundingClientRect();
  const page = mapContainer.closest(`.${styles.tourPage}`);
  const visible = {
    left: mapRect.left,
    right: mapRect.right,
    top: mapRect.top,
    bottom: mapRect.bottom,
  };

  page?.querySelectorAll(`.${styles.rail}, .${styles.editor}`).forEach((panel) => {
    const rect = panel.getBoundingClientRect();
    const overlapsX = Math.max(
      0,
      Math.min(rect.right, mapRect.right) - Math.max(rect.left, mapRect.left),
    );
    const overlapsY = Math.max(
      0,
      Math.min(rect.bottom, mapRect.bottom) - Math.max(rect.top, mapRect.top),
    );

    if (!overlapsX || !overlapsY) {
      return;
    }

    if (overlapsY > mapRect.height * 0.25) {
      if (rect.left <= mapRect.left + 24) {
        visible.left = Math.max(visible.left, rect.right);
      }
      if (rect.right >= mapRect.right - 24) {
        visible.right = Math.min(visible.right, rect.left);
      }
    }

    if (overlapsX > mapRect.width * 0.25) {
      if (rect.top <= mapRect.top + 24) {
        visible.top = Math.max(visible.top, rect.bottom);
      }
      if (rect.bottom >= mapRect.bottom - 24) {
        visible.bottom = Math.min(visible.bottom, rect.top);
      }
    }
  });

  const offsetX =
    (visible.left + visible.right) / 2 - (mapRect.left + mapRect.width / 2);
  const offsetY =
    (visible.top + visible.bottom) / 2 - (mapRect.top + mapRect.height / 2);
  const targetPoint = map.project(target, zoom);
  return map.unproject(targetPoint.subtract(L.point(offsetX, offsetY)), zoom);
}

function FitSelectedCard({ card }: { card: TourCard | null }) {
  const map = useMap();
  const hasFocusedCardRef = useRef(false);

  useEffect(() => {
    if (!card) {
      return;
    }

    const target = L.latLng(card.lat, card.lng);
    const focusTarget = getVisibleMapCenterLatLng(map, target);

    if (!hasFocusedCardRef.current && map.getZoom() < 12) {
      hasFocusedCardRef.current = true;
      map.setView(getVisibleMapCenterLatLng(map, target, 14), 14, {
        animate: false,
      });
      return;
    }

    hasFocusedCardRef.current = true;
    map.panTo(focusTarget, {
      animate: true,
      duration: 0.25,
      easeLinearity: 0.35,
      noMoveStart: true,
    });
  }, [card, map]);

  return null;
}

function TrackViewport({
  isPaused,
  onChange,
}: {
  isPaused: () => boolean;
  onChange: (next: { center: [number, number]; zoom: number }) => void;
}) {
  useMapEvents({
    moveend(event) {
      if (isPaused()) {
        return;
      }

      const center = event.target.getCenter();
      onChange({ center: [center.lat, center.lng], zoom: event.target.getZoom() });
    },
    zoomend(event) {
      if (isPaused()) {
        return;
      }

      const center = event.target.getCenter();
      onChange({ center: [center.lat, center.lng], zoom: event.target.getZoom() });
    },
  });

  return null;
}

function AddPointOnClick({
  enabled,
  onAdd,
}: {
  enabled: boolean;
  onAdd: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(event) {
      if (!enabled) {
        return;
      }

      onAdd(event.latlng.lat, event.latlng.lng);
    },
  });

  return null;
}

function getShareUrls(slug: string) {
  const origin = window.location.origin;
  const publicUrl = `${origin}/tour/${encodeURIComponent(slug)}`;
  const embedUrl = `${origin}/tour/${encodeURIComponent(slug)}?embed=1`;
  const embedCode = `<iframe src="${embedUrl}" width="100%" height="720" style="border:0;" loading="lazy"></iframe>`;
  return { embedCode, embedUrl, publicUrl };
}

function getRenderableImageUrl(value: string) {
  const url = String(value || "").trim();
  if (!url) {
    return "";
  }

  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveMatch?.[1]) {
    return `https://drive.google.com/uc?export=view&id=${driveMatch[1]}`;
  }

  return url;
}

function getRenderableImageUrls(card: TourCard) {
  return (Array.isArray(card.imageUrls) ? card.imageUrls : [])
    .map((item) => getRenderableImageUrl(String(item || "")))
    .filter(Boolean);
}

function TourCardImage({ card }: { card: TourCard }) {
  const urls = getRenderableImageUrls(card);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [failedUrls, setFailedUrls] = useState<Record<string, boolean>>({});
  const visibleUrls = urls.filter((url) => !failedUrls[url]);
  const imageKey = visibleUrls.join("|");

  useEffect(() => {
    setCurrentIndex(0);
  }, [imageKey]);

  useEffect(() => {
    if (visibleUrls.length <= 1) {
      return undefined;
    }

    const duration = Math.max(1, Number(card.imageTimerSeconds) || 4) * 1000;
    const timer = window.setInterval(() => {
      setCurrentIndex((value) => (value + 1) % visibleUrls.length);
    }, duration);

    return () => window.clearInterval(timer);
  }, [card.imageTimerSeconds, imageKey, visibleUrls.length]);

  if (!visibleUrls.length) {
    return null;
  }

  return (
    <div className={styles.imageStack}>
      {visibleUrls.map((imageUrl, index) => (
        <img
          key={imageUrl}
          src={imageUrl}
          alt=""
          className={index === currentIndex % visibleUrls.length ? cx(styles.cardImage, styles.cardImageActive) : styles.cardImage}
          onError={() => setFailedUrls((prev) => ({ ...prev, [imageUrl]: true }))}
        />
      ))}
    </div>
  );
}

export function MapTourPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useParams();
  const appId = params.id;
  const slug = params.slug;
  const isEmbedMode = searchParams.get("embed") === "1";
  const isPublic = Boolean(slug);
  const isEditorMode = Boolean(appId);
  const isListMode = !isPublic && !isEditorMode;
  const hasSupabase = Boolean(getSupabaseBrowserConfig());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [app, setApp] = useState<MapApp | null>(null);
  const [allTours, setAllTours] = useState<MapApp[]>([]);
  const [purchases, setPurchases] = useState<MapTourPurchase[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [cards, setCards] = useState<TourCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  const [isTourDetailsCollapsed, setIsTourDetailsCollapsed] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [viewport, setViewport] = useState<{ center: [number, number]; zoom: number }>({
    center: defaultCenter,
    zoom: defaultZoom,
  });
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [upgradePending, setUpgradePending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const initializedRef = useRef(false);
  const tourCardListRef = useRef<HTMLDivElement | null>(null);
  const tourCardRefs = useRef(new Map<string, HTMLButtonElement>());
  const draggingCardIdRef = useRef<string | null>(null);
  const ignoreScrollSyncRef = useRef(false);
  const tourCardScrollFrameRef = useRef<number | null>(null);
  const wheelRemainderRef = useRef(0);
  const wheelStepLockRef = useRef(false);
  const wheelStepTimerRef = useRef<number | null>(null);

  const selectedCard = useMemo(
    () => cards.find((card) => card.id === selectedCardId) || null,
    [cards, selectedCardId],
  );
  const hasPointUpgrade = useMemo(
    () =>
      isAdmin ||
      Boolean(
        purchases.find(
          (purchase) =>
            purchase.credit_type === "points" &&
            purchase.map_app_id === app?.id &&
            (purchase.status === "paid" || purchase.status === "completed"),
        ),
      ),
    [app?.id, isAdmin, purchases],
  );
  const selectedPointLimit = hasPointUpgrade ? paidPointLimit : freePointLimit;
  const { publicUrl, embedUrl, embedCode } = app?.slug
    ? getShareUrls(app.slug)
    : { embedCode: "", embedUrl: "", publicUrl: "" };

  useEffect(() => {
    if (isListMode) {
      document.title = "Map Tours | LocalMapr";
      return;
    }

    document.title = isPublic ? "Map Tour | LocalMapr" : "Map Tour Editor | LocalMapr";
  }, [isListMode, isPublic]);

  useEffect(() => {
    async function load() {
      if (!hasSupabase && !isPublic) {
        setError("Supabase is not configured for this workspace.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      initializedRef.current = false;

      if (isPublic) {
        let payload: { app?: MapApp; error?: string } = {};
        let ok = false;

        try {
          const response = await fetch(
            `/api/map-tour/public?slug=${encodeURIComponent(slug ?? "")}`,
          );
          ok = response.ok;
          payload = (await response.json().catch(() => ({}))) as {
            app?: MapApp;
            error?: string;
          };
        } catch {
          setError("This published map tour could not be loaded.");
          setLoading(false);
          return;
        }

        if (!ok || !payload.app) {
          setError(payload.error || "This published map tour could not be found.");
          setLoading(false);
          return;
        }

        const config = parseConfig(payload.app.config);
        setApp(payload.app);
        setTitle(payload.app.title);
        setDescription(payload.app.description || "");
        setIsPublished(true);
        setCards(config.cards);
        setSelectedCardId(config.cards[0]?.id || null);
        setViewport({ center: config.center, zoom: config.zoom });
        setDirty(false);
        initializedRef.current = true;
        setLoading(false);
        return;
      }

      const supabase = createBrowserSupabaseClient();
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();

      if (!currentUser) {
        navigate("/login?next=/map-tour", { replace: true });
        return;
      }

      setUser(currentUser);

      const [{ data: appRows }, { data: purchasesData }, { data: adminRecord }] =
        await Promise.all([
          supabase
            .from("map_apps")
            .select("*")
            .eq("owner_id", currentUser.id)
            .eq("app_type", "map_tour")
            .order("updated_at", { ascending: false }),
          supabase
            .from("map_tour_purchases")
            .select("*")
            .eq("user_id", currentUser.id)
            .order("created_at", { ascending: false }),
          supabase
            .from("super_admins")
            .select("id")
            .eq("email", currentUser.email?.toLowerCase() ?? "")
            .eq("is_active", true)
            .maybeSingle(),
        ]);

      const tours = appRows ?? [];
      const selectedApp = appId ? tours.find((item) => item.id === appId) ?? null : null;

      setAllTours(tours);
      setPurchases(purchasesData ?? []);
      setIsAdmin(Boolean(adminRecord));

      if (isListMode) {
        setLoading(false);
        return;
      }

      if (!selectedApp) {
        setError("Map tour draft was not found in your workspace.");
        setLoading(false);
        return;
      }

      const config = parseConfig(selectedApp.config);
      const safeCards = config.cards.length ? config.cards : [createCard(0)];

      setApp(selectedApp);
      setTitle(selectedApp.title);
      setDescription(selectedApp.description || "");
      setIsPublished(selectedApp.status === "published");
      setCards(safeCards);
      setSelectedCardId(safeCards[0]?.id || null);
      setViewport({ center: config.center, zoom: config.zoom });
      setDirty(false);
      initializedRef.current = true;
      setLoading(false);
    }

    void load();
  }, [appId, hasSupabase, isListMode, isPublic, navigate, slug]);

  useEffect(() => {
    if (searchParams.get("checkout") === "success") {
      setMessage("Checkout completed. Your Map Tour credits were updated.");
      const next = new URLSearchParams(searchParams);
      next.delete("checkout");
      next.delete("credit");
      setSearchParams(next, { replace: true });
      void (async () => {
        if (!user || isPublic) {
          return;
        }

        const supabase = createBrowserSupabaseClient();
        const { data: purchasesData } = await supabase
          .from("map_tour_purchases")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });
        setPurchases(purchasesData ?? []);
      })();
    }
  }, [isPublic, searchParams, setSearchParams, user]);

  useEffect(() => {
    if (
      !initializedRef.current ||
      isPublic ||
      isListMode ||
      !app ||
      !user ||
      !dirty
    ) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      if (draggingCardIdRef.current) {
        return;
      }

      void persistChanges(true);
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [
    app,
    cards,
    description,
    dirty,
    isListMode,
    isPublic,
    isPublished,
    title,
    user,
    viewport,
  ]);

  useEffect(() => {
    if (!selectedCardId) {
      return;
    }

    const cardEl = tourCardRefs.current.get(selectedCardId);
    const listEl = tourCardListRef.current;

    if (!cardEl || !listEl) {
      return;
    }

    ignoreScrollSyncRef.current = true;
    const listRect = listEl.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();
    const targetTop =
      listEl.scrollTop +
      (cardRect.top - listRect.top) -
      (listRect.height - cardRect.height) / 2;

    listEl.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    const timer = window.setTimeout(() => {
      ignoreScrollSyncRef.current = false;
    }, 500);

    return () => window.clearTimeout(timer);
  }, [selectedCardId]);

  useEffect(
    () => () => {
      if (wheelStepTimerRef.current) {
        window.clearTimeout(wheelStepTimerRef.current);
      }
      if (tourCardScrollFrameRef.current) {
        window.cancelAnimationFrame(tourCardScrollFrameRef.current);
      }
    },
    [],
  );

  function updateSelectedCard(patch: Partial<TourCard>) {
    if (!selectedCard) {
      return;
    }

    setCards((prev) =>
      prev.map((card) =>
        card.id === selectedCard.id ? { ...card, ...patch } : card,
      ),
    );
    setDirty(true);
  }

  function addCard(lat: number, lng: number) {
    if (!hasPointUpgrade && cards.length >= freePointLimit) {
      setError("Free Map Tours include up to 3 points. Upgrade to unlock 10.");
      return;
    }

    if (hasPointUpgrade && cards.length >= paidPointLimit) {
      setError("This Map Tour has reached the 10 point limit.");
      return;
    }

    setError("");
    setCards((prev) => {
      const next = [...prev, createCard(prev.length, lat, lng)];
      setSelectedCardId(next[next.length - 1].id);
      return next;
    });
    setDirty(true);
  }

  function addCardFromButton() {
    const base = selectedCard || cards[cards.length - 1];
    const offset = 0.01 + (cards.length % 4) * 0.004;
    addCard(
      (base?.lat || defaultCenter[0]) + offset,
      (base?.lng || defaultCenter[1]) + offset,
    );
  }

  function removeSelectedCard() {
    if (!selectedCard) {
      return;
    }

    setCards((prev) => {
      const next = prev.filter((card) => card.id !== selectedCard.id);
      setSelectedCardId(next[0]?.id || null);
      return next;
    });
    setDirty(true);
  }

  async function deleteTour() {
    if (!app || !user || !window.confirm(`Delete "${title || "Map Tour"}"?`)) {
      return;
    }

    const supabase = createBrowserSupabaseClient();
    const { error: deleteError } = await supabase
      .from("map_apps")
      .delete()
      .eq("id", app.id)
      .eq("owner_id", user.id);

    if (deleteError) {
      setError(deleteError.message || "Unable to delete Map Tour.");
      return;
    }

    navigate("/map-tour");
  }

  function moveSelectedCard(direction: -1 | 1) {
    if (!selectedCard) {
      return;
    }

    setCards((prev) => {
      const index = prev.findIndex((card) => card.id === selectedCard.id);
      const target = index + direction;

      if (index < 0 || target < 0 || target >= prev.length) {
        return prev;
      }

      const next = [...prev];
      const [card] = next.splice(index, 1);
      next.splice(target, 0, card);
      return next;
    });
    setDirty(true);
  }

  function updateCardPosition(id: string, lat: number, lng: number) {
    setCards((prev) =>
      prev.map((card) => (card.id === id ? { ...card, lat, lng } : card)),
    );
    setDirty(true);
  }

  function syncSelectedCardFromScroll() {
    if (ignoreScrollSyncRef.current) {
      return;
    }

    const listEl = tourCardListRef.current;
    if (!listEl || !cards.length) {
      return;
    }

    const edgeThreshold = 8;
    const firstCard = cards[0];
    const lastCard = cards[cards.length - 1];

    if (listEl.scrollTop <= edgeThreshold) {
      if (firstCard?.id && firstCard.id !== selectedCardId) {
        setSelectedCardId(firstCard.id);
      }
      return;
    }

    const distanceFromBottom =
      listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
    if (distanceFromBottom <= edgeThreshold) {
      if (lastCard?.id && lastCard.id !== selectedCardId) {
        setSelectedCardId(lastCard.id);
      }
      return;
    }

    const listRect = listEl.getBoundingClientRect();
    const midpoint = listRect.top + listRect.height / 2;
    let bestId: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    cards.forEach((card) => {
      const el = tourCardRefs.current.get(card.id);
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const distance = Math.abs(center - midpoint);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = card.id;
      }
    });

    if (bestId && bestId !== selectedCardId) {
      setSelectedCardId(bestId);
    }
  }

  function handleTourCardListScroll() {
    if (tourCardScrollFrameRef.current) {
      window.cancelAnimationFrame(tourCardScrollFrameRef.current);
    }

    tourCardScrollFrameRef.current = window.requestAnimationFrame(() => {
      tourCardScrollFrameRef.current = null;
      syncSelectedCardFromScroll();
    });
  }

  function handleTourWheel(event: ReactWheelEvent<HTMLElement>) {
    if (!isPublic || !cards.length || !selectedCardId) {
      return;
    }

    const rawDelta =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (!rawDelta) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (wheelStepLockRef.current) {
      return;
    }

    const unit =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    const delta = rawDelta * unit;
    wheelRemainderRef.current += delta;

    if (Math.abs(wheelRemainderRef.current) < 80) {
      return;
    }

    const direction = wheelRemainderRef.current > 0 ? 1 : -1;
    wheelRemainderRef.current = 0;
    const currentIndex = Math.max(0, cards.findIndex((card) => card.id === selectedCardId));
    const nextIndex = Math.min(cards.length - 1, Math.max(0, currentIndex + direction));
    const nextCard = cards[nextIndex];

    if (!nextCard || nextCard.id === selectedCardId) {
      return;
    }

    wheelStepLockRef.current = true;
    setSelectedCardId(nextCard.id);
    if (wheelStepTimerRef.current) {
      window.clearTimeout(wheelStepTimerRef.current);
    }
    wheelStepTimerRef.current = window.setTimeout(() => {
      wheelStepLockRef.current = false;
    }, 420);
  }

  function updateImageUrl(index: number, value: string) {
    if (!selectedCard) {
      return;
    }

    const nextUrls = [...selectedCard.imageUrls];
    nextUrls[index] = value;
    updateSelectedCard({ imageUrls: nextUrls });
  }

  function addImageUrl() {
    if (!selectedCard) {
      return;
    }

    updateSelectedCard({ imageUrls: [...selectedCard.imageUrls, ""] });
  }

  function removeImageUrl(index: number) {
    if (!selectedCard) {
      return;
    }

    updateSelectedCard({
      imageUrls: selectedCard.imageUrls.filter((_, itemIndex) => itemIndex !== index),
    });
  }

  async function persistChanges(
    silent = false,
    overrides: { isPublished?: boolean } = {},
  ) {
    if (!app || !user) {
      return false;
    }

    setSaveState("saving");
    if (!silent) {
      setError("");
      setMessage("");
    }

    const config: TourConfig = {
      cards,
      center: viewport.center,
      zoom: viewport.zoom,
    };
    const shouldUpdatePublishState = typeof overrides.isPublished === "boolean";
    const nextIsPublished = overrides.isPublished ?? isPublished;
    const publishedAt = nextIsPublished ? new Date().toISOString() : null;
    const nextConfig = serializeConfig(config);
    const updatePayload: MapAppUpdate = {
      title: title.trim() || "Untitled map tour",
      description: description.trim() || null,
      config: nextConfig,
    };

    if (shouldUpdatePublishState) {
      updatePayload.status = nextIsPublished ? "published" : "draft";
      updatePayload.published_at = publishedAt;
    }

    const supabase = createBrowserSupabaseClient();
    const { error: updateError } = await supabase
      .from("map_apps")
      .update(updatePayload)
      .eq("id", app.id)
      .eq("owner_id", user.id);

    if (updateError) {
      setSaveState("error");
      setError(updateError.message);
      return false;
    }

    setApp((current) =>
      current
        ? {
            ...current,
            config: nextConfig,
            description: description.trim() || null,
            published_at: shouldUpdatePublishState ? publishedAt : current.published_at,
            status: shouldUpdatePublishState
              ? nextIsPublished
                ? "published"
                : "draft"
              : current.status,
            title: title.trim() || "Untitled map tour",
          }
        : current,
    );
    setSaveState("saved");
    setDirty(false);
    if (!silent) {
      setMessage("Map tour changes saved.");
    }
    return true;
  }

  async function handlePublishedChange(nextIsPublished: boolean) {
    const previousValue = isPublished;
    setIsPublished(nextIsPublished);
    setDirty(true);

    const saved = await persistChanges(true, { isPublished: nextIsPublished });
    if (!saved) {
      setIsPublished(previousValue);
    }
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied.`);
    } catch {
      setError(`Could not copy ${label.toLowerCase()}.`);
    }
  }

  async function startPointUpgradeCheckout() {
    if (!user || !app) {
      return;
    }

    setUpgradePending(true);
    setError("");

    try {
      const supabase = createBrowserSupabaseClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please log in again before opening checkout.");
      }

      const response = await fetch("/api/billing/map-tour-checkout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          creditType: "points",
          mapAppId: app.id,
        }),
      });
      const payload = (await response.json()) as { error?: string; url?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Could not open point upgrade checkout.");
      }

      window.location.href = payload.url;
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Could not open point upgrade checkout.",
      );
      setUpgradePending(false);
    }
  }

  async function startTourCreditCheckout() {
    if (!user) {
      navigate("/login?next=/map-tour", { replace: true });
      return;
    }

    setIsCheckingOut(true);
    setError("");

    try {
      const supabase = createBrowserSupabaseClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please log in again before opening checkout.");
      }

      const response = await fetch("/api/billing/map-tour-checkout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ creditType: "tour" }),
      });
      const payload = (await response.json()) as { error?: string; url?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Could not open tour credit checkout.");
      }

      window.location.href = payload.url;
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Could not open tour credit checkout.",
      );
      setIsCheckingOut(false);
    }
  }

  async function createTourFromList() {
    if (!user) {
      navigate("/login?next=/map-tour", { replace: true });
      return;
    }

    const unusedTourCredits = purchases.filter(
      (purchase) => purchase.credit_type === "tour" && !purchase.used_at,
    );
    const canCreate =
      isAdmin || allTours.length < 1 || Boolean(unusedTourCredits[0]);

    if (!canCreate) {
      setError("Your free Map Tour is used. Buy a tour credit to create another.");
      return;
    }

    const supabase = createBrowserSupabaseClient();
    const slugBase = `map-tour-${Date.now()}`;
    const { data: inserted, error: insertError } = await supabase
      .from("map_apps")
      .insert({
        app_type: "map_tour",
        config: serializeConfig({
          cards: [createCard(0)],
          center: defaultCenter,
          zoom: defaultZoom,
        }),
        owner_id: user.id,
        slug: `${slugBase}-${crypto.randomUUID().slice(0, 8)}`,
        title: `Map Tour ${allTours.length + 1}`,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      setError(insertError?.message || "Could not create Map Tour.");
      return;
    }

    if (!isAdmin && allTours.length >= 1 && unusedTourCredits[0]) {
      await supabase
        .from("map_tour_purchases")
        .update({
          used_at: new Date().toISOString(),
          used_for_app_id: inserted.id,
        })
        .eq("id", unusedTourCredits[0].id)
        .eq("user_id", user.id)
        .is("used_at", null);
    }

    navigate(`/map-tour/${inserted.id}`);
  }

  if (loading) {
    return (
      <main className={styles.homePage}>
        <section className={styles.statusCard}>
          <h1>Loading map tour...</h1>
        </section>
      </main>
    );
  }

  if (error && !isListMode) {
    return (
      <main className={styles.homePage}>
        <section className={styles.statusCard}>
          <h1>Map tour unavailable</h1>
          <p>{error}</p>
          <Link to={isPublic ? "/" : "/dashboard"}>Go back</Link>
        </section>
      </main>
    );
  }

  if (isListMode) {
    const unusedTourCredits = purchases.filter(
      (purchase) => purchase.credit_type === "tour" && !purchase.used_at,
    ).length;
    const canCreateTour = isAdmin || allTours.length < 1 || unusedTourCredits > 0;

    return (
      <main className={styles.homePage}>
        <header className={styles.homeNav}>
          <Link className={styles.brand} to="/" aria-label="LocalMapr home">
            <img
              className={styles.brandLogo}
              src="/brand/logo_dark.png"
              alt="LocalMapr"
            />
          </Link>
          <div className={styles.homeNavActions}>
            <Link className={styles.ghostButton} to="/dashboard">
              Dashboard
            </Link>
          </div>
        </header>

        <section className={styles.homeHero}>
          <div>
            <p>Map Tours</p>
            <h1>Your Map Tours</h1>
            <span>{user?.email}</span>
          </div>

          <div className={styles.homePlanPanel}>
            <span>Credits</span>
            <strong>
              {isAdmin
                ? "Unlimited"
                : allTours.length
                  ? `${unusedTourCredits} tour credits`
                  : "Free tour available"}
            </strong>
            <p>
              {isAdmin
                ? "Super admins can create unlimited tours and points."
                : `${Math.max(0, 1 - allTours.length)} free tours remaining. ${unusedTourCredits} paid tour credits available.`}
            </p>
            <button type="button" onClick={() => void createTourFromList()} disabled={!canCreateTour}>
              Create Map Tour
            </button>
            {!canCreateTour ? (
              <button type="button" className={styles.secondaryButton} onClick={() => void startTourCreditCheckout()} disabled={isCheckingOut}>
                {isCheckingOut ? "Opening..." : "Buy tour credit"}
              </button>
            ) : null}
          </div>
        </section>

        {message ? <p className={styles.notice}>{message}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}

        <section className={styles.homePanel}>
          <div className={styles.panelHeader}>
            <div>
              <p>Library</p>
              <h2>{allTours.length} tours</h2>
            </div>
          </div>

          <section className={styles.table} aria-label="Your Map Tours">
            {allTours.length === 0 ? (
              <div className={styles.empty}>No Map Tours created yet.</div>
            ) : (
              allTours.map((tour) => {
                const config = parseConfig(tour.config);
                return (
                  <button
                    type="button"
                    key={tour.id}
                    className={styles.row}
                    onClick={() => navigate(`/map-tour/${tour.id}`)}
                  >
                    <span>
                      <strong>{tour.title}</strong>
                      <small>{tour.description || "No description"}</small>
                    </span>
                    <span>{config.cards.length} points</span>
                    <span>{tour.status === "published" ? "Published" : "Draft"}</span>
                    <span>Updated {new Date(tour.updated_at).toLocaleDateString()}</span>
                  </button>
                );
              })
            )}
          </section>
        </section>
      </main>
    );
  }

  const mapTourMain = (
    <main
        className={cx(
          styles.tourPage,
          isAdding && styles.isAdding,
          isPublic && styles.isPublic,
          isEmbedMode && styles.isEmbed,
          !isPublic && styles.isEditorMode,
        )}
      >
      <MapContainer
        center={selectedCard ? [selectedCard.lat, selectedCard.lng] : viewport.center}
        zoom={Math.max(viewport.zoom, 12)}
        minZoom={3}
        maxZoom={18}
        className={styles.map}
        scrollWheelZoom
        zoomControl={false}
      >
        <ZoomControl position="bottomright" />
        <TileLayer
          attribution="Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          keepBuffer={6}
          updateWhenIdle={false}
        />
        <TileLayer
          attribution="Reference labels &copy; Esri"
          url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
          keepBuffer={6}
          updateWhenIdle={false}
          zIndex={2}
        />
        <TrackViewport
          isPaused={() => Boolean(draggingCardIdRef.current)}
          onChange={(next) => {
            setViewport(next);
            if (!isPublic) {
              setDirty(true);
            }
          }}
        />
        <AddPointOnClick
          enabled={!isPublic && isAdding}
          onAdd={(lat, lng) => {
            addCard(lat, lng);
            setIsAdding(false);
          }}
        />
        <FitSelectedCard card={selectedCard} />

        {cards.map((card, index) => {
          const pinPopupText = card.hoverText.trim() || card.title;

          return (
            <Marker
              key={card.id}
              position={[card.lat, card.lng]}
              icon={createPointIcon(index + 1, card.color, card.id === selectedCardId)}
              draggable={!isPublic}
              eventHandlers={{
                click: (event) => {
                  setSelectedCardId(card.id);
                  event.target.openPopup();
                },
                dragstart: (event) => {
                  draggingCardIdRef.current = card.id;
                  event.target.closePopup();
                },
                mouseover: (event) => {
                  if (!draggingCardIdRef.current) {
                    event.target.openPopup();
                  }
                },
                mouseout: (event) => {
                  if (!draggingCardIdRef.current) {
                    event.target.closePopup();
                  }
                },
                dragend: (event) => {
                  const next = event.target.getLatLng();
                  updateCardPosition(card.id, next.lat, next.lng);
                  draggingCardIdRef.current = null;
                  setSelectedCardId(card.id);
                },
              }}
            >
              <Popup className={styles.pinPopup} closeButton={false} maxWidth={400}>
                {pinPopupText}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      <aside className={cx(styles.rail, isRailCollapsed && styles.railCollapsed)}>
        {!isPublic ? (
          <button
            type="button"
            className={styles.railCollapseButton}
            aria-label={isRailCollapsed ? "Open side panel" : "Collapse side panel"}
            aria-expanded={!isRailCollapsed}
            onClick={() => setIsRailCollapsed((current) => !current)}
            title={isRailCollapsed ? "Open side panel" : "Collapse side panel"}
          >
            <span
              className={cx(
                styles.railCollapseIcon,
                isRailCollapsed && styles.railCollapseIconCollapsed,
              )}
              aria-hidden="true"
            />
          </button>
        ) : null}

        {!isRailCollapsed ? (
          <div className={styles.railContent}>
            <a className={styles.railLogoLink} href="https://localmapr.com/" aria-label="LocalMapr home">
              <img
                className={styles.railLogo}
                src="/brand/logo_dark.png"
                alt="LocalMapr"
              />
            </a>

            {isPublic ? (
              <>
                <div className={styles.railHeader}>
                  <h1 className={styles.publicTitle}>{title}</h1>
                </div>

                {description ? <p className={styles.publicDescription}>{description}</p> : null}
              </>
            ) : (
              <section className={styles.detailsCard}>
            <button
              type="button"
              className={styles.detailsToggle}
              aria-label={isTourDetailsCollapsed ? "Open tour details" : "Close tour details"}
              aria-expanded={!isTourDetailsCollapsed}
              onClick={() => setIsTourDetailsCollapsed((current) => !current)}
            >
              <span>Tour details</span>
              <span
                className={cx(
                  styles.detailsToggleIcon,
                  !isTourDetailsCollapsed && styles.detailsToggleIconOpen,
                )}
                aria-hidden="true"
              />
            </button>

            {!isTourDetailsCollapsed ? (
              <div className={styles.detailsCardBody}>
                <div className={styles.railHeader}>
                  <input
                    className={styles.titleInput}
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setDirty(true);
                    }}
                    aria-label="Map tour title"
                  />
                </div>

                <textarea
                  className={styles.descriptionInput}
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setDirty(true);
                  }}
                  rows={5}
                  placeholder="Description"
                />

                <div className={styles.limitRow}>
                  <span>
                    {cards.length}/{isAdmin ? "unlimited" : selectedPointLimit} points
                  </span>
                  {!isAdmin && !hasPointUpgrade && cards.length >= freePointLimit ? (
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => void startPointUpgradeCheckout()}
                      disabled={upgradePending}
                    >
                      {upgradePending ? "Opening..." : "Upgrade to 10"}
                    </button>
                  ) : null}
                </div>

                <section className={styles.sharePanel}>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={isPublished}
                    onChange={(event) => {
                      void handlePublishedChange(event.target.checked);
                    }}
                  />
                  <span>Published</span>
                </label>

                {isPublished && app?.status === "published" && app?.slug ? (
                  <>
                    <label>
                      <span>Share URL</span>
                      <div className={styles.copyRow}>
                        <input readOnly value={publicUrl} />
                        <button type="button" className={cx(styles.button, styles.buttonQuiet)} onClick={() => void copyText(publicUrl, "Share URL")}>
                          Copy
                        </button>
                      </div>
                    </label>
                    <label>
                      <span>Embed URL</span>
                      <div className={styles.copyRow}>
                        <input readOnly value={embedUrl} />
                        <button type="button" className={cx(styles.button, styles.buttonQuiet)} onClick={() => void copyText(embedUrl, "Embed URL")}>
                          Copy
                        </button>
                      </div>
                    </label>
                    <label>
                      <span>Embed code</span>
                      <div className={styles.copyRow}>
                        <input readOnly value={embedCode} />
                        <button type="button" className={cx(styles.button, styles.buttonQuiet)} onClick={() => void copyText(embedCode, "Embed code")}>
                          Copy
                        </button>
                      </div>
                    </label>
                  </>
                ) : null}
              </section>
              </div>
            ) : null}
              </section>
            )}

            {message ? <p className={styles.alert}>{message}</p> : null}
            {error ? <p className={cx(styles.alert, styles.alertError)}>{error}</p> : null}

            <div
              className={styles.cardList}
              ref={tourCardListRef}
              onScroll={handleTourCardListScroll}
              onWheel={handleTourWheel}
            >
              {!cards.length ? <div className={styles.empty}>No tour points yet.</div> : null}
              {cards.map((card, index) => (
                <button
                  type="button"
                  key={card.id}
                  className={cx(
                    styles.card,
                    card.id === selectedCardId && styles.active,
                    getRenderableImageUrls(card).length > 0 && styles.hasImage,
                  )}
                  onClick={() => setSelectedCardId(card.id)}
                  ref={(element) => {
                    if (element) {
                      tourCardRefs.current.set(card.id, element);
                    } else {
                      tourCardRefs.current.delete(card.id);
                    }
                  }}
                >
                  <TourCardImage card={card} />
                  <span className={styles.badge} style={{ background: card.color }}>{index + 1}</span>
                  <span className={styles.cardText}>
                    <strong>{card.title}</strong>
                    <span>{card.body || (isPublic ? "Draft point" : "No story text yet.")}</span>
                  </span>
                </button>
              ))}
            </div>

            {!isPublic ? (
              <div className={styles.railFooter}>
                <button
                  type="button"
                  className={cx(styles.addPointButton, isAdding && styles.addPointButtonActive)}
                  onClick={addCardFromButton}
                  disabled={!isAdmin && cards.length >= paidPointLimit}
                  aria-label="Add point"
                  title="Add point"
                >
                  +
                </button>
                <button
                  type="button"
                  className={cx(styles.button, styles.buttonQuiet)}
                  onClick={() => setIsAdding((current) => !current)}
                >
                  {isAdding ? "Click map" : "Place on map"}
                </button>
                <button type="button" className={cx(styles.button, styles.buttonDanger)} onClick={() => void deleteTour()}>
                  Delete tour
                </button>
                <span className={cx(styles.saveState, saveState === "error" && styles.saveStateError)}>
                  {saveState === "saving" ? "Saving" : saveState === "error" ? "Save failed" : "Saved"}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>

      {selectedCard && !isPublic ? (
        <aside className={styles.editor}>
          <div className={styles.editorHeader}>
            <div>
              <div className={styles.kicker}>Point editor</div>
              <strong>{selectedCard.title}</strong>
            </div>
            <button type="button" className={styles.iconButton} onClick={() => setSelectedCardId(null)}>
              Close
            </button>
          </div>

          <label>
            <span>Title</span>
            <input
              value={selectedCard.title}
              onChange={(event) => updateSelectedCard({ title: event.target.value })}
            />
          </label>

          <label>
            <span>Story text</span>
            <textarea
              rows={5}
              value={selectedCard.body}
              onChange={(event) => updateSelectedCard({ body: event.target.value })}
            />
          </label>

          <label>
            <span>Pin popup text</span>
            <textarea
              rows={2}
              value={selectedCard.hoverText}
              onChange={(event) => updateSelectedCard({ hoverText: event.target.value })}
            />
          </label>

          <div className={styles.imageEditor}>
            <div className={styles.imageEditorHeader}>
              <span>Image URLs</span>
              <button type="button" className={styles.miniAddButton} onClick={addImageUrl} aria-label="Add image URL" title="Add image URL">
                +
              </button>
            </div>
            <div className={styles.imageUrlList}>
              {(selectedCard.imageUrls.length ? selectedCard.imageUrls : [""]).map((imageUrl, index) => (
                <div className={styles.imageUrlRow} key={`${selectedCard.id}-image-${index}`}>
                  <input
                    value={imageUrl}
                    onChange={(event) => updateImageUrl(index, event.target.value)}
                    placeholder="Image URL"
                  />
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => removeImageUrl(index)}
                    aria-label="Remove image URL"
                    title="Remove image URL"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <label className={styles.imageTimer}>
              <span>Timer seconds</span>
              <input
                type="number"
                min="1"
                step="1"
                value={selectedCard.imageTimerSeconds || 4}
                onChange={(event) =>
                  updateSelectedCard({
                    imageTimerSeconds: Math.max(
                      1,
                      toNumber(event.target.value, selectedCard.imageTimerSeconds || 4),
                    ),
                  })
                }
              />
            </label>
          </div>

          <div className={styles.editorGrid}>
            <label>
              <span>Latitude</span>
              <input
                type="number"
                step="0.00001"
                value={selectedCard.lat}
                onChange={(event) => updateSelectedCard({ lat: toNumber(event.target.value, selectedCard.lat) })}
              />
            </label>
            <label>
              <span>Longitude</span>
              <input
                type="number"
                step="0.00001"
                value={selectedCard.lng}
                onChange={(event) => updateSelectedCard({ lng: toNumber(event.target.value, selectedCard.lng) })}
              />
            </label>
          </div>

          <div className={styles.swatches} aria-label="Card colour">
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                className={selectedCard.color === color ? styles.active : ""}
                style={{ background: color }}
                onClick={() => updateSelectedCard({ color })}
              />
            ))}
          </div>

          <div className={styles.editorActions}>
            <button type="button" className={styles.button} onClick={() => void persistChanges(false)} disabled={saveState === "saving"}>
              Save
            </button>
            <button type="button" className={cx(styles.button, styles.buttonQuiet)} onClick={() => moveSelectedCard(-1)}>
              Move up
            </button>
            <button type="button" className={cx(styles.button, styles.buttonQuiet)} onClick={() => moveSelectedCard(1)}>
              Move down
            </button>
            <button type="button" className={cx(styles.button, styles.buttonDanger)} onClick={removeSelectedCard}>
              Delete
            </button>
          </div>
        </aside>
      ) : null}
      </main>
  );

  return mapTourMain;
}
