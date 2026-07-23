import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import L from "leaflet";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  MapPin,
  Save,
  Trash2,
  X,
} from "lucide-react";
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
import { SiteHeader } from "@/app/components/SiteHeader";
import { readApiResponse } from "@/lib/api";
import type { Database, Json } from "@/lib/database.types";
import {
  EMAIL_VERIFICATION_REQUIRED_MESSAGE,
  isUserEmailVerified,
} from "@/lib/auth";
import { useAuth } from "@/lib/authContext";
import {
  FREE_MAP_TOUR_LIMIT,
  FREE_MAP_TOUR_POINT_LIMIT,
  getMapTourPointLimit,
  getUnusedTourCreditCount,
  isPaidMapTourCreditStatus,
  isMissingMapTourPurchasesTable,
} from "@/lib/mapTourBilling";
import {
  MAP_STORY_IMAGE_BUCKET,
  MAP_STORY_IMAGE_MAX_MB,
  prepareMapStoryImage,
} from "@/lib/mapStoryImages";
import {
  createBrowserSupabaseClient,
  getSupabaseBrowserConfig,
} from "@/lib/supabase/client";
import "leaflet/dist/leaflet.css";
import styles from "@/app/maptour/maptour.module.css";

type MapApp = Database["public"]["Tables"]["map_apps"]["Row"];
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
const compactEditorLayoutQuery = "(max-width: 820px)";
const pointIconCache = new Map<string, L.DivIcon>();

function createCard(index: number, lat = defaultCenter[0], lng = defaultCenter[1]): TourCard {
  return {
    id: `tour-card-${Date.now()}-${index}`,
    title: `Story point ${index + 1}`,
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
  const cacheKey = `${index}:${color}:${active ? "active" : "idle"}`;
  const cachedIcon = pointIconCache.get(cacheKey);

  if (cachedIcon) {
    return cachedIcon;
  }

  const icon = L.divIcon({
    className: styles.pointIcon,
    html: `<span style="--point-color:${color}" class="${active ? styles.pointIconActive : ""}">${index}</span>`,
    iconAnchor: [20, 20],
    iconSize: [40, 40],
    popupAnchor: [0, -20],
  });

  pointIconCache.set(cacheKey, icon);
  return icon;
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function isCompactEditorViewport() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.matchMedia(compactEditorLayoutQuery).matches;
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2Z" />
      <path d="M6 9h12l-1 11H7L6 9Zm4 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z" />
    </svg>
  );
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
      title: String(card.title || `Story point ${index + 1}`),
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
  const lastViewportRef = useRef<{ center: [number, number]; zoom: number } | null>(null);

  function handleMoveEnd(event: L.LeafletEvent) {
    if (isPaused()) {
      return;
    }

    const map = event.target as L.Map;
    const center = map.getCenter();
    const next = { center: [center.lat, center.lng] as [number, number], zoom: map.getZoom() };
    const previous = lastViewportRef.current;

    if (
      previous &&
      previous.zoom === next.zoom &&
      Math.abs(previous.center[0] - next.center[0]) < 1e-7 &&
      Math.abs(previous.center[1] - next.center[1]) < 1e-7
    ) {
      return;
    }

    lastViewportRef.current = next;
    onChange(next);
  }

  useMapEvents({
    moveend: handleMoveEnd,
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
  const publicUrl = `${origin}/story/${encodeURIComponent(slug)}`;
  const embedUrl = `${origin}/story/${encodeURIComponent(slug)}?embed=1`;
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

  const { user: authUser, loading: authLoading } = useAuth();
  const authUserId = authUser?.id ?? null;
  const authUserRef = useRef<User | null>(authUser);
  authUserRef.current = authUser;

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
  const [isStoryIntroCollapsed, setIsStoryIntroCollapsed] = useState(false);
  const [isStoryPointsCollapsed, setIsStoryPointsCollapsed] = useState(!isPublic);
  const [isPointEditorCollapsed, setIsPointEditorCollapsed] = useState(true);
  const [isCompactEditorLayout, setIsCompactEditorLayout] = useState(isCompactEditorViewport);
  const [deletingTourId, setDeletingTourId] = useState<string | null>(null);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [viewport, setViewport] = useState<{ center: [number, number]; zoom: number }>({
    center: defaultCenter,
    zoom: defaultZoom,
  });
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
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
  const descriptionTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const storyTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageUploadRef = useRef<HTMLInputElement | null>(null);

  const selectedCard = useMemo(
    () => cards.find((card) => card.id === selectedCardId) || null,
    [cards, selectedCardId],
  );
  const selectedPointLimit = getMapTourPointLimit(isAdmin);
  const isPaidStory = Boolean(
    app &&
      purchases.some(
        (purchase) =>
          purchase.credit_type === "tour" &&
          purchase.used_for_app_id === app.id &&
          Boolean(purchase.used_at) &&
          isPaidMapTourCreditStatus(purchase.status),
      ),
  );
  const areRailSectionsCollapsed = isPublic
    ? isStoryIntroCollapsed && isStoryPointsCollapsed
    : isTourDetailsCollapsed && isStoryPointsCollapsed;
  const { publicUrl, embedUrl, embedCode } = app?.slug
    ? getShareUrls(app.slug)
    : { embedCode: "", embedUrl: "", publicUrl: "" };

  useEffect(() => {
    if (isListMode) {
      document.title = "Map Stories | LocalMapr";
      return;
    }

    document.title = isPublic ? "Map Story | LocalMapr" : "Map Story Editor | LocalMapr";
  }, [isListMode, isPublic]);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!hasSupabase) {
        setError("Supabase is not configured for this workspace.");
        setLoading(false);
        return;
      }

      setError("");

      if (isPublic) {
        setLoading(true);
        initializedRef.current = false;

        const supabase = createBrowserSupabaseClient();
        const { data, error: tourError } = await supabase
          .from("map_apps")
          .select("*")
          .eq("slug", slug ?? "")
          .eq("app_type", "map_tour")
          .eq("status", "published")
          .maybeSingle();

        if (!active) {
          return;
        }

        if (tourError || !data) {
          setError("This published map story could not be found.");
          setLoading(false);
          return;
        }

        const config = parseConfig(data.config);
        setApp(data);
        setTitle(data.title);
        setDescription(data.description || "");
        setIsPublished(true);
        setCards(config.cards);
        setSelectedCardId(config.cards[0]?.id || null);
        setViewport({ center: config.center, zoom: config.zoom });
        setDirty(false);
        initializedRef.current = true;
        setLoading(false);
        return;
      }

      // Auth-required modes: rely on the shared auth context so we don't make a
      // fresh network auth request (which caused the persistent loading state)
      // on every navigation to this page.
      if (authLoading) {
        return;
      }

      const currentUser = authUserRef.current;

      if (!currentUser) {
        navigate("/login?next=/map-stories", { replace: true });
        return;
      }

      if (!isUserEmailVerified(currentUser)) {
        const supabase = createBrowserSupabaseClient();
        await supabase.auth.signOut();
        navigate(
          `/login?error=${encodeURIComponent(EMAIL_VERIFICATION_REQUIRED_MESSAGE)}`,
          { replace: true },
        );
        return;
      }

      setLoading(true);
      initializedRef.current = false;
      setUser(currentUser);

      const supabase = createBrowserSupabaseClient();
      const [
        { data: appRows },
        { data: purchasesData, error: purchasesError },
        { data: adminRecord },
      ] =
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

      if (!active) {
        return;
      }

      const tours = appRows ?? [];
      const selectedApp = appId ? tours.find((item) => item.id === appId) ?? null : null;
      const safePurchases = isMissingMapTourPurchasesTable(purchasesError)
        ? []
        : purchasesData ?? [];

      setAllTours(tours);
      setPurchases(safePurchases);
      setIsAdmin(Boolean(adminRecord));

      if (isListMode) {
        setLoading(false);
        return;
      }

      if (!selectedApp) {
        setError("Map story draft was not found in your workspace.");
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

    return () => {
      active = false;
    };
  }, [appId, authLoading, authUserId, hasSupabase, isListMode, isPublic, navigate, slug]);

  useEffect(() => {
    if (searchParams.get("checkout") === "success") {
      setMessage("Checkout completed. Your Map Story credits were updated.");
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

  useEffect(() => {
    const mediaQuery = window.matchMedia(compactEditorLayoutQuery);

    function handleChange() {
      setIsCompactEditorLayout(mediaQuery.matches);
    }

    handleChange();
    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    resizeStoryTextArea();
  }, [selectedCard?.body, selectedCardId, isPointEditorCollapsed]);

  useEffect(() => {
    resizeDescriptionTextArea();
  }, [description, isTourDetailsCollapsed]);

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

  useEffect(() => {
    const listEl = tourCardListRef.current;

    if (!listEl || !isPublic) {
      return undefined;
    }

    listEl.addEventListener("wheel", handleTourWheel, { passive: false });

    return () => {
      listEl.removeEventListener("wheel", handleTourWheel);
    };
  }, [cards, isPublic, selectedCardId]);

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

  function resizeStoryTextArea() {
    const element = storyTextAreaRef.current;
    if (!element) {
      return;
    }

    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }

  function resizeDescriptionTextArea() {
    const element = descriptionTextAreaRef.current;
    if (!element) {
      return;
    }

    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }

  function toggleStoryIntroPanel() {
    if (isStoryIntroCollapsed) {
      setIsStoryIntroCollapsed(false);
      setIsStoryPointsCollapsed(true);
      return;
    }

    setIsStoryIntroCollapsed(true);
  }

  function openStoryDetailsPanel() {
    setIsTourDetailsCollapsed(false);

    if (isPublic) {
      return;
    }

    setIsStoryPointsCollapsed(true);
    if (isCompactEditorLayout) {
      setIsPointEditorCollapsed(true);
    }
  }

  function toggleStoryDetailsPanel() {
    if (isTourDetailsCollapsed) {
      openStoryDetailsPanel();
      return;
    }

    setIsTourDetailsCollapsed(true);
  }

  function openStoryPointsPanel() {
    setIsStoryPointsCollapsed(false);

    if (isPublic) {
      setIsStoryIntroCollapsed(true);
      return;
    }

    setIsTourDetailsCollapsed(true);
    if (isCompactEditorLayout) {
      setIsPointEditorCollapsed(true);
    }
  }

  function toggleStoryPointsPanel() {
    if (isStoryPointsCollapsed) {
      openStoryPointsPanel();
      return;
    }

    setIsStoryPointsCollapsed(true);
  }

  function openPointEditorPanel(cardId?: string) {
    if (cardId) {
      setSelectedCardId(cardId);
    }
    setIsPointEditorCollapsed(false);

    if (isPublic) {
      return;
    }

    if (isCompactEditorLayout) {
      setIsTourDetailsCollapsed(true);
      setIsStoryPointsCollapsed(true);
    }
  }

  function togglePointEditorPanel() {
    if (isPointEditorCollapsed) {
      openPointEditorPanel();
      return;
    }

    setIsPointEditorCollapsed(true);
  }

  function addCard(lat: number, lng: number) {
    if (!isAdmin && cards.length >= selectedPointLimit) {
      setError(
        `Map Stories can include up to ${FREE_MAP_TOUR_POINT_LIMIT} points.`,
      );
      return;
    }

    setError("");
    setCards((prev) => {
      const next = [...prev, createCard(prev.length, lat, lng)];
      openPointEditorPanel(next[next.length - 1].id);
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
    if (!app || !user || !window.confirm(`Delete "${title || "Map Story"}"?`)) {
      return;
    }

    const supabase = createBrowserSupabaseClient();
    const { error: deleteError } = await supabase
      .from("map_apps")
      .delete()
      .eq("id", app.id)
      .eq("owner_id", user.id);

    if (deleteError) {
      setError(deleteError.message || "Unable to delete Map Story.");
      return;
    }

    navigate("/map-stories");
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

  function handleTourWheel(event: WheelEvent) {
    if (!isPublic || cards.length < 2 || !selectedCardId) {
      wheelRemainderRef.current = 0;
      return;
    }

    const rawDelta =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (!rawDelta) {
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

    event.preventDefault();
    event.stopPropagation();

    if (wheelStepLockRef.current) {
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

  async function uploadImages(files: FileList | null) {
    if (!files?.length || !selectedCard || !app || !user) {
      return;
    }

    if (!isPaidStory) {
      setError("Image uploads are available only for paid Map Stories. You can still add image URLs.");
      return;
    }

    setIsUploadingImages(true);
    setError("");
    setMessage("");
    const supabase = createBrowserSupabaseClient();
    const uploadedUrls: string[] = [];
    const uploadedPaths: string[] = [];

    try {
      for (const file of Array.from(files)) {
        const image = await prepareMapStoryImage(file);
        const path = `${user.id}/${app.id}/${selectedCard.id}/${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from(MAP_STORY_IMAGE_BUCKET)
          .upload(path, image, { contentType: "image/jpeg", upsert: false });

        if (uploadError) {
          throw uploadError;
        }

        const { data } = supabase.storage.from(MAP_STORY_IMAGE_BUCKET).getPublicUrl(path);
        uploadedPaths.push(path);
        uploadedUrls.push(data.publicUrl);
      }

      updateSelectedCard({ imageUrls: [...selectedCard.imageUrls, ...uploadedUrls] });
      setMessage(
        `${uploadedUrls.length} image${uploadedUrls.length === 1 ? "" : "s"} uploaded and reduced to ${MAP_STORY_IMAGE_MAX_MB} MB or less. Save the story to keep the change.`,
      );
    } catch (uploadError) {
      if (uploadedPaths.length) {
        await supabase.storage.from(MAP_STORY_IMAGE_BUCKET).remove(uploadedPaths);
      }
      setError(uploadError instanceof Error ? uploadError.message : "The image upload failed.");
    } finally {
      setIsUploadingImages(false);
      if (imageUploadRef.current) {
        imageUploadRef.current.value = "";
      }
    }
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
    const nextConfig = serializeConfig(config);
    const supabase = createBrowserSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setSaveState("error");
      setError("Please log in again before saving this Map Story.");
      return false;
    }

    const publishedAt = nextIsPublished ? new Date().toISOString() : null;
    const updatePayload: Database["public"]["Tables"]["map_apps"]["Update"] = {
      config: nextConfig,
      description: description.trim() || null,
      title: title.trim() || "Untitled map story",
    };

    if (shouldUpdatePublishState) {
      updatePayload.status = nextIsPublished ? "published" : "draft";
      updatePayload.published_at = publishedAt;
    }

    const { data: updated, error: updateError } = await supabase
      .from("map_apps")
      .update(updatePayload)
      .eq("id", app.id)
      .eq("owner_id", user.id)
      .eq("app_type", "map_tour")
      .select("*")
      .single();

    if (updateError || !updated) {
      setSaveState("error");
      setError(updateError?.message || "Map story changes could not be saved.");
      return false;
    }

    setApp(updated);
    setTitle(updated.title);
    setDescription(updated.description || "");
    setIsPublished(updated.status === "published");
    setSaveState("saved");
    setDirty(false);
    if (!silent) {
      setMessage("Map story changes saved.");
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

  async function createTourFromList() {
    if (!user) {
      navigate("/login?next=/map-stories", { replace: true });
      return;
    }

    const unusedTourCredits = getUnusedTourCreditCount(purchases);
    const canCreate =
      isAdmin || allTours.length < FREE_MAP_TOUR_LIMIT || unusedTourCredits > 0;

    if (!canCreate) {
      setError("Your free Map Stories are used. Buy a story credit to create another.");
      return;
    }

    const supabase = createBrowserSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setError("Please log in again before creating a Map Story.");
      return;
    }

    const response = await fetch("/api/map-tour/create", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        config: serializeConfig({
          cards: [createCard(0)],
          center: defaultCenter,
          zoom: defaultZoom,
        }),
        title: `Map Story ${allTours.length + 1}`,
      }),
    });
    const payload = await readApiResponse<{
      app?: MapApp;
      error?: string;
    }>(response, "Could not create Map Story.");

    if (!response.ok || !payload.app) {
      if (import.meta.env.DEV && response.status === 404) {
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
            slug: `map-story-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
            title: `Map Story ${allTours.length + 1}`,
          })
          .select("id")
          .single();

        if (insertError || !inserted) {
          setError(insertError?.message || "Could not create Map Story.");
          return;
        }

        navigate(`/map-stories/${inserted.id}`);
        return;
      }

      setError(payload.error || "Could not create Map Story.");
      return;
    }

    navigate(`/map-stories/${payload.app.id}`);
  }

  async function deleteTourFromList(tour: MapApp) {
    if (!user) {
      navigate("/login?next=/map-stories", { replace: true });
      return;
    }

    const confirmed = window.confirm(
      `Delete "${tour.title || "Map Story"}"? This will permanently remove the Map Story and its share link.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingTourId(tour.id);
    setError("");
    setMessage("");

    const supabase = createBrowserSupabaseClient();
    const { error: deleteError } = await supabase
      .from("map_apps")
      .delete()
      .eq("id", tour.id)
      .eq("owner_id", user.id)
      .eq("app_type", "map_tour");

    if (deleteError) {
      setError(deleteError.message || "Unable to delete Map Story.");
      setDeletingTourId(null);
      return;
    }

    setAllTours((current) => current.filter((item) => item.id !== tour.id));
    setMessage(`"${tour.title}" deleted.`);
    setDeletingTourId(null);
  }

  if (loading) {
    return (
      <main className={styles.homePage}>
        <section className={styles.statusCard}>
          <h1>Loading map story...</h1>
        </section>
      </main>
    );
  }

  if (error && !isListMode && !app) {
    return (
      <main className={styles.homePage}>
        <section className={styles.statusCard}>
          <h1>Map story unavailable</h1>
          <p>{error}</p>
          <Link to={isPublic ? "/" : "/dashboard"}>Go back</Link>
        </section>
      </main>
    );
  }

  if (isListMode) {
    const unusedTourCredits = getUnusedTourCreditCount(purchases);
    const canCreateTour =
      isAdmin || allTours.length < FREE_MAP_TOUR_LIMIT || unusedTourCredits > 0;

    return (
      <main className={styles.homePage}>
        <SiteHeader className={styles.homeHeader} user={user} />

        <section className={styles.homeHero}>
          <div className={styles.homeHeroCopy}>
            <p>Map Stories</p>
            <h1>Your Map Stories</h1>
            <span>{user?.email}</span>
          </div>

          <div className={styles.homePlanPanel}>
            <span>Credits</span>
            <strong>
              {isAdmin
                ? "Unlimited"
                : allTours.length >= FREE_MAP_TOUR_LIMIT
                  ? `${unusedTourCredits} story credits`
                  : `${Math.max(0, FREE_MAP_TOUR_LIMIT - allTours.length)} free stories`}
            </strong>
            <p>
              {isAdmin
                ? "Super admins can create unlimited stories and points."
                : `${Math.max(0, FREE_MAP_TOUR_LIMIT - allTours.length)} free stories remaining. ${unusedTourCredits} paid story credits available.`}
            </p>
            <button type="button" onClick={() => void createTourFromList()} disabled={!canCreateTour}>
              Create Map Story
            </button>
            <Link className={styles.secondaryButton} to="/pricing">
              Buy story credit
            </Link>
          </div>
        </section>

        {message ? (
          <div className={styles.notice} role="status" aria-live="polite">
            <span className={styles.noticeText}>{message}</span>
            <button
              type="button"
              className={styles.noticeDismissButton}
              aria-label="Dismiss message"
              onClick={() => setMessage("")}
            >
              <X size={16} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {error ? <p className={styles.error}>{error}</p> : null}

        <section className={styles.homePanel}>
          <div className={styles.panelHeader}>
            <div>
              <p>Library</p>
              <h2>{allTours.length} stories</h2>
            </div>
          </div>

          <section className={styles.table} aria-label="Your Map Stories">
            {allTours.length === 0 ? (
              <div className={styles.empty}>No Map Stories created yet.</div>
            ) : (
              allTours.map((tour) => {
                const config = parseConfig(tour.config);
                return (
                  <article className={styles.row} key={tour.id}>
                    <button
                      type="button"
                      className={styles.rowOpenButton}
                      onClick={() => navigate(`/map-stories/${tour.id}`)}
                    >
                      <span>
                        <strong>{tour.title}</strong>
                        <small>{tour.description || "No description"}</small>
                      </span>
                      <span>{config.cards.length} points</span>
                      <span>{tour.status === "published" ? "Published" : "Draft"}</span>
                      <span>Updated {new Date(tour.updated_at).toLocaleDateString()}</span>
                    </button>
                    <button
                      type="button"
                      className={styles.deleteTourButton}
                      onClick={() => void deleteTourFromList(tour)}
                      disabled={deletingTourId === tour.id}
                      aria-label={`Delete ${tour.title}`}
                      title="Delete story"
                    >
                      <TrashIcon />
                    </button>
                  </article>
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
          isPointEditorCollapsed && styles.isPointEditorCollapsed,
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
          updateWhenIdle
          updateWhenZooming={false}
        />
        <TileLayer
          attribution="Reference labels &copy; Esri"
          url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
          keepBuffer={6}
          updateWhenIdle
          updateWhenZooming={false}
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
	                  openPointEditorPanel(card.id);
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
	                  openPointEditorPanel(card.id);
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

      <aside
        className={cx(
          styles.rail,
          isRailCollapsed && styles.railCollapsed,
          areRailSectionsCollapsed && styles.railSectionsCollapsed,
        )}
      >
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

        {!isRailCollapsed ? (
          <div className={styles.railContent}>
            <Link className={styles.railLogoLink} to="/map-stories" aria-label="Map Stories home">
              <img
                className={styles.railLogo}
                src="/brand/logo_dark.png"
                alt="LocalMapr"
              />
            </Link>

            {isPublic ? (
              <section className={styles.publicIntro}>
                <button
                  type="button"
                  className={styles.panelToggle}
                  aria-label={isStoryIntroCollapsed ? "Open story description" : "Collapse story description"}
                  aria-expanded={!isStoryIntroCollapsed}
                  onClick={toggleStoryIntroPanel}
                >
                  <span>Story description</span>
                  <span
                    className={cx(
                      styles.detailsToggleIcon,
                      !isStoryIntroCollapsed && styles.detailsToggleIconOpen,
                    )}
                    aria-hidden="true"
                  />
                </button>

                {!isStoryIntroCollapsed ? (
                  <div className={styles.publicIntroBody}>
                    <div className={styles.railHeader}>
                      <h1 className={styles.publicTitle}>{title}</h1>
                    </div>

                    {description ? <p className={styles.publicDescription}>{description}</p> : null}
                  </div>
                ) : null}
              </section>
            ) : (
              <section className={styles.detailsCard}>
            <button
              type="button"
	              className={styles.detailsToggle}
	              aria-label={isTourDetailsCollapsed ? "Open story details" : "Close story details"}
	              aria-expanded={!isTourDetailsCollapsed}
	              onClick={toggleStoryDetailsPanel}
	            >
              <span>Story details</span>
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
                    aria-label="Map story title"
                  />
                </div>

                <textarea
                  ref={descriptionTextAreaRef}
                  className={styles.descriptionInput}
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setDirty(true);
                    resizeDescriptionTextArea();
                  }}
                  rows={5}
                  placeholder="Description"
                />

                <div className={styles.limitRow}>
                  <span>
                    {cards.length}/{isAdmin ? "unlimited" : selectedPointLimit} points
                  </span>
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

            {message ? (
              <div className={styles.alert} role="status" aria-live="polite">
                <span className={styles.alertText}>{message}</span>
                <button
                  type="button"
                  className={styles.alertDismissButton}
                  aria-label="Dismiss message"
                  onClick={() => setMessage("")}
                >
                  <X size={16} strokeWidth={2.4} aria-hidden="true" />
                </button>
              </div>
            ) : null}
            {error ? <p className={cx(styles.alert, styles.alertError)}>{error}</p> : null}

            <section className={cx(styles.pointsPanel, isStoryPointsCollapsed && styles.pointsPanelCollapsed)}>
              <button
                type="button"
	                className={styles.panelToggle}
	                aria-label={isStoryPointsCollapsed ? "Open story points" : "Collapse story points"}
	                aria-expanded={!isStoryPointsCollapsed}
	                onClick={toggleStoryPointsPanel}
	              >
                <span>Story points ({cards.length})</span>
                <span
                  className={cx(
                    styles.detailsToggleIcon,
                    !isStoryPointsCollapsed && styles.detailsToggleIconOpen,
                  )}
                  aria-hidden="true"
                />
              </button>

              {!isStoryPointsCollapsed ? (
                <div
                  className={styles.cardList}
                  ref={tourCardListRef}
                  onScroll={handleTourCardListScroll}
                >
                  {!cards.length ? <div className={styles.empty}>No story points yet.</div> : null}
                  {cards.map((card, index) => (
                    <button
                      type="button"
                      key={card.id}
                      className={cx(
                        styles.card,
	                        card.id === selectedCardId && styles.active,
	                        getRenderableImageUrls(card).length > 0 && styles.hasImage,
	                      )}
	                      onClick={() => openPointEditorPanel(card.id)}
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
              ) : null}
            </section>

            {!isPublic ? (
              <div className={styles.railFooter}>
                <button
                  type="button"
                  className={cx(styles.addPointButton, isAdding && styles.addPointButtonActive)}
                  onClick={addCardFromButton}
                  disabled={!isAdmin && cards.length >= selectedPointLimit}
                  aria-label="Add point"
                  title="Add point"
                >
                  +
                </button>
                <button
                  type="button"
                  className={cx(styles.button, styles.buttonQuiet, styles.mobileIconAction)}
                  onClick={() => setIsAdding((current) => !current)}
                  aria-label={isAdding ? "Click map to place point" : "Place point on map"}
                  title={isAdding ? "Click map" : "Place on map"}
                >
                  <MapPin className={styles.mobileActionIcon} size={18} strokeWidth={2.4} aria-hidden="true" />
                  <span className={styles.mobileActionText}>{isAdding ? "Click map" : "Place on map"}</span>
                </button>
                <button
                  type="button"
                  className={cx(styles.button, styles.mobileIconAction)}
                  onClick={() => void persistChanges(false)}
                  disabled={saveState === "saving" || !dirty}
                  aria-label={saveState === "saving" ? "Saving story" : "Save story"}
                  title={saveState === "saving" ? "Saving" : "Save"}
                >
                  <Save className={styles.mobileActionIcon} size={18} strokeWidth={2.4} aria-hidden="true" />
                  <span className={styles.mobileActionText}>{saveState === "saving" ? "Saving" : "Save"}</span>
                </button>
                <button
                  type="button"
                  className={cx(styles.button, styles.buttonDanger, styles.mobileIconAction)}
                  onClick={() => void deleteTour()}
                  aria-label="Delete story"
                  title="Delete story"
                >
                  <Trash2 className={styles.mobileActionIcon} size={18} strokeWidth={2.4} aria-hidden="true" />
                  <span className={styles.mobileActionText}>Delete story</span>
                </button>
                <span className={cx(styles.saveState, saveState === "error" && styles.saveStateError)}>
                  {saveState === "saving"
                    ? "Saving"
                    : saveState === "error"
                      ? "Save failed"
                      : dirty
                        ? "Unsaved changes"
                        : "Saved"}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>

      {selectedCard && !isPublic ? (
        <aside className={cx(styles.editor, isPointEditorCollapsed && styles.editorCollapsed)}>
          <div className={styles.editorHeader}>
            <div>
              <div className={styles.kicker}>Point editor</div>
              <strong>{selectedCard.title}</strong>
            </div>
            <div className={styles.editorHeaderActions}>
              <button
                type="button"
	                className={cx(styles.iconButton, styles.editorIconButton)}
	                aria-label={isPointEditorCollapsed ? "Open point editor" : "Collapse point editor"}
	                aria-expanded={!isPointEditorCollapsed}
	                title={isPointEditorCollapsed ? "Open point editor" : "Collapse point editor"}
	                onClick={togglePointEditorPanel}
	              >
                {isPointEditorCollapsed ? (
                  <ChevronUp size={18} strokeWidth={2.4} aria-hidden="true" />
                ) : (
                  <ChevronDown size={18} strokeWidth={2.4} aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                className={cx(styles.iconButton, styles.editorIconButton)}
                aria-label="Close point editor"
                title="Close point editor"
                onClick={() => setSelectedCardId(null)}
              >
                <X size={18} strokeWidth={2.4} aria-hidden="true" />
              </button>
            </div>
          </div>

          {!isPointEditorCollapsed ? (
            <div className={styles.editorBody}>
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
                  ref={storyTextAreaRef}
                  className={styles.autoGrowTextarea}
                  rows={5}
                  value={selectedCard.body}
                  onChange={(event) => {
                    updateSelectedCard({ body: event.target.value });
                    resizeStoryTextArea();
                  }}
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
                  <span>Images</span>
                  <div className={styles.imageActions}>
                    {isPaidStory ? (
                      <>
                        <input
                          ref={imageUploadRef}
                          className={styles.hiddenImageInput}
                          type="file"
                          accept="image/*,.heic,.heif"
                          multiple
                          onChange={(event) => void uploadImages(event.target.files)}
                        />
                        <button
                          type="button"
                          className={styles.uploadImageButton}
                          onClick={() => imageUploadRef.current?.click()}
                          disabled={isUploadingImages}
                        >
                          <ImagePlus size={17} strokeWidth={2.4} aria-hidden="true" />
                          {isUploadingImages ? "Converting…" : "Upload"}
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className={styles.miniAddButton}
                      onClick={addImageUrl}
                      aria-label="Add image URL"
                      title="Add image URL"
                    >
                      +
                    </button>
                  </div>
                </div>
                <p className={styles.imageHelp}>
                  {isPaidStory
                    ? "Upload JPEG, PNG, WebP, HEIC or HEIF, or add an image URL. Uploads are converted to JPEG and limited to 2 MB."
                    : "Free Map Stories can add image URLs. Direct image uploads are available on paid stories."}
                </p>
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
                        className={cx(styles.iconButton, styles.editorActionIconButton)}
                        onClick={() => removeImageUrl(index)}
                        aria-label="Remove image URL"
                        title="Remove image URL"
                      >
                        <Trash2 size={18} strokeWidth={2.4} aria-hidden="true" />
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
                <button
                  type="button"
                  className={cx(styles.button, styles.editorActionIconButton)}
                  onClick={() => void persistChanges(false)}
                  disabled={saveState === "saving" || !dirty}
                  aria-label={saveState === "saving" ? "Saving point" : "Save point"}
                  title={saveState === "saving" ? "Saving" : "Save"}
                >
                  <Save size={18} strokeWidth={2.4} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={cx(styles.button, styles.buttonQuiet, styles.editorActionIconButton)}
                  onClick={() => moveSelectedCard(-1)}
                  aria-label="Move point up"
                  title="Move up"
                >
                  <ArrowUp size={18} strokeWidth={2.4} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={cx(styles.button, styles.buttonQuiet, styles.editorActionIconButton)}
                  onClick={() => moveSelectedCard(1)}
                  aria-label="Move point down"
                  title="Move down"
                >
                  <ArrowDown size={18} strokeWidth={2.4} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={cx(styles.button, styles.buttonDanger, styles.editorActionIconButton)}
                  onClick={removeSelectedCard}
                  aria-label="Delete point"
                  title="Delete point"
                >
                  <Trash2 size={18} strokeWidth={2.4} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}
        </aside>
      ) : null}
      </main>
  );

  return mapTourMain;
}
