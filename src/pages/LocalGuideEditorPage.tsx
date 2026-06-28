import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Polyline,
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
import styles from "@/app/localguides/editor.module.css";

type MapApp = Database["public"]["Tables"]["map_apps"]["Row"];

type GuideStop = {
  id: string;
  title: string;
  notes: string;
  popupText: string;
  lat: number;
  lng: number;
  color: string;
};

type GuideConfig = {
  center: [number, number];
  routeColor: string;
  routeMode: "driving";
  stops: GuideStop[];
  zoom: number;
};

const defaultCenter: [number, number] = [-35.205, 173.95];
const defaultZoom = 11;
const colors = ["#1f4834", "#2563eb", "#be123c", "#b45309", "#6d28d9"];
const routeColors = ["#0d8f5a", "#2563eb", "#be123c", "#b45309", "#6d28d9", "#102136"];
const noteFontSizes = ["12px", "14px", "16px", "18px", "22px"];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function toNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeNotes(value: string) {
  const text = String(value || "");
  if (!text.trim()) {
    return "";
  }

  if (/<\/?[a-z][\s\S]*>/i.test(text)) {
    return text;
  }

  return text
    .split(/\n+/)
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join("");
}

function sanitizeRichText(value: string) {
  const source = normalizeNotes(value);
  if (!source.trim()) {
    return "";
  }

  const template = document.createElement("template");
  const clean = document.createElement("div");
  template.innerHTML = source;

  function appendCleanNode(node: Node, parent: HTMLElement | DocumentFragment) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent || ""));
      return;
    }

    if (!(node instanceof HTMLElement)) {
      return;
    }

    const tagName = node.tagName.toLowerCase();
    const tagMap: Record<string, string> = {
      b: "strong",
      div: "div",
      em: "em",
      i: "em",
      li: "li",
      p: "div",
      span: "span",
      strong: "strong",
      ul: "ul",
    };
    const nextTag = tagMap[tagName];

    if (!nextTag) {
      Array.from(node.childNodes).forEach((child) => appendCleanNode(child, parent));
      return;
    }

    const nextNode = document.createElement(nextTag);
    if (nextTag === "span") {
      const fontSize = node.style.fontSize;
      if (noteFontSizes.includes(fontSize)) {
        nextNode.style.fontSize = fontSize;
      }
    }

    Array.from(node.childNodes).forEach((child) => appendCleanNode(child, nextNode));
    parent.appendChild(nextNode);
  }

  Array.from(template.content.childNodes).forEach((node) => appendCleanNode(node, clean));
  return clean.innerHTML;
}

function FormattedNotes({
  className,
  notes,
}: {
  className: string;
  notes: string;
}) {
  if (!notes.trim()) {
    return null;
  }

  const html = sanitizeRichText(notes);
  if (!html) {
    return null;
  }

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function createStop(index: number, lat = defaultCenter[0], lng = defaultCenter[1]): GuideStop {
  return {
    id: `guide-stop-${Date.now()}-${index}`,
    title: `Stop ${index + 1}`,
    notes: "",
    popupText: "",
    lat,
    lng,
    color: colors[index % colors.length],
  };
}

function parseConfig(config: Json): GuideConfig {
  const value = typeof config === "object" && config ? (config as Record<string, unknown>) : {};
  const rawStops = Array.isArray(value.stops) ? value.stops : [];
  const stops = rawStops.map((raw, index) => {
    const stop = typeof raw === "object" && raw ? (raw as Record<string, unknown>) : {};
    return {
      id: String(stop.id || `guide-stop-${index}`),
      title: String(stop.title || `Stop ${index + 1}`),
      notes: normalizeNotes(String(stop.notes || "")),
      popupText: String(stop.popupText || ""),
      lat: toNumber(stop.lat, defaultCenter[0]),
      lng: toNumber(stop.lng, defaultCenter[1]),
      color: String(stop.color || colors[index % colors.length]),
    };
  });
  const centerValue = Array.isArray(value.center) ? value.center : defaultCenter;

  return {
    center: [
      toNumber(centerValue[0], defaultCenter[0]),
      toNumber(centerValue[1], defaultCenter[1]),
    ],
    routeColor: String(value.routeColor || routeColors[0]),
    routeMode: "driving",
    stops,
    zoom: toNumber(value.zoom, defaultZoom),
  };
}

function serializeConfig(config: GuideConfig): Json {
  return config;
}

function createStopIcon(index: number, color: string, active: boolean) {
  return L.divIcon({
    className: styles.stopIcon,
    html: `<span style="--stop-color:${color}" class="${active ? styles.stopIconActive : ""}">${index}</span>`,
    iconAnchor: [20, 20],
    iconSize: [40, 40],
    popupAnchor: [0, -20],
  });
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

function AddStopOnClick({
  enabled,
  onAdd,
}: {
  enabled: boolean;
  onAdd: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(event) {
      if (enabled) {
        onAdd(event.latlng.lat, event.latlng.lng);
      }
    },
  });

  return null;
}

function FocusSelectedStop({
  isPaused,
  stop,
}: {
  isPaused: () => boolean;
  stop: GuideStop | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!stop || isPaused()) {
      return;
    }

    map.panTo([stop.lat, stop.lng], {
      animate: true,
      duration: 0.25,
    });
  }, [isPaused, map, stop]);

  return null;
}

function RichNotesEditor({
  onChange,
  value,
}: {
  onChange: (nextValue: string) => void;
  value: string;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef<Range | null>(null);

  const saveSelection = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      selectionRef.current = range.cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    const selection = window.getSelection();
    const range = selectionRef.current;
    if (!selection || !range) {
      return null;
    }

    selection.removeAllRanges();
    selection.addRange(range);
    return range;
  }, []);

  const releaseSelection = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    selectionRef.current = null;

    if (!editor || !selection?.rangeCount) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      return;
    }

    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const emitChange = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    onChange(sanitizeRichText(editor.innerHTML));
    saveSelection();
  }, [onChange, saveSelection]);

  const prepareToolbarSelection = useCallback(
    (event: MouseEvent<HTMLButtonElement | HTMLSelectElement>) => {
      event.preventDefault();
      saveSelection();
    },
    [saveSelection],
  );

  const runCommand = useCallback(
    (command: string, options: { requireSelection?: boolean } = {}) => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }

      editor.focus();
      const range = restoreSelection();
      if (options.requireSelection && (!range || range.collapsed)) {
        releaseSelection();
        return;
      }

      document.execCommand(command);
      emitChange();
      releaseSelection();
    },
    [emitChange, releaseSelection, restoreSelection],
  );

  const changeFontSize = useCallback(
    (fontSize: string) => {
      const editor = editorRef.current;
      if (!editor || !noteFontSizes.includes(fontSize)) {
        return;
      }

      editor.focus();
      const range = restoreSelection();
      if (!range || range.collapsed) {
        releaseSelection();
        return;
      }

      document.execCommand("fontSize", false, "7");
      editor.querySelectorAll("font[size='7']").forEach((fontNode) => {
        const span = document.createElement("span");
        span.style.fontSize = fontSize;
        span.innerHTML = fontNode.innerHTML;
        fontNode.replaceWith(span);
      });
      emitChange();
      releaseSelection();
    },
    [emitChange, releaseSelection, restoreSelection],
  );

  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const shortcutPressed = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (!shortcutPressed) {
        return;
      }

      if (key === "i") {
        event.preventDefault();
        saveSelection();
        runCommand("italic", { requireSelection: true });
        return;
      }

      if (event.shiftKey && key === "8") {
        event.preventDefault();
        saveSelection();
        runCommand("insertUnorderedList");
      }
    },
    [runCommand, saveSelection],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) {
      return;
    }

    const clean = sanitizeRichText(value);
    if (editor.innerHTML !== clean) {
      editor.innerHTML = clean;
    }
  }, [value]);

  return (
    <div className={styles.richTextShell}>
      <div className={styles.richTextToolbar}>
        <button
          type="button"
          onMouseDown={prepareToolbarSelection}
          onClick={() => runCommand("italic", { requireSelection: true })}
          aria-label="Italic"
        >
          I
        </button>
        <button
          type="button"
          onMouseDown={prepareToolbarSelection}
          onClick={() => runCommand("insertUnorderedList")}
          aria-label="Bullet list"
        >
          UL
        </button>
        <select
          aria-label="Font size"
          defaultValue=""
          onChange={(event) => {
            changeFontSize(event.target.value);
            event.target.value = "";
          }}
          onMouseDown={prepareToolbarSelection}
        >
          <option value="" disabled>
            Size
          </option>
          {noteFontSizes.map((fontSize) => (
            <option value={fontSize} key={fontSize}>
              {fontSize}
            </option>
          ))}
        </select>
      </div>
      <div
        ref={editorRef}
        className={styles.richTextEditor}
        contentEditable
        role="textbox"
        aria-label="Stop notes"
        onBlur={emitChange}
        onMouseDown={() => {
          selectionRef.current = null;
        }}
        onDoubleClick={() => {
          selectionRef.current = null;
        }}
        onInput={emitChange}
        onKeyDown={handleEditorKeyDown}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        suppressContentEditableWarning
      />
    </div>
  );
}

async function getDrivingRoute(stops: GuideStop[], signal: AbortSignal) {
  if (stops.length < 2) {
    return [];
  }

  const coordinates = stops.map((stop) => `${stop.lng},${stop.lat}`).join(";");
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`,
    { signal },
  );

  if (!response.ok) {
    throw new Error("Driving route could not be calculated.");
  }

  const payload = (await response.json()) as {
    routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> } }>;
  };
  const routeCoordinates = payload.routes?.[0]?.geometry?.coordinates ?? [];
  return routeCoordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
}

function getShareUrls(slug: string) {
  const origin = window.location.origin;
  const publicUrl = `${origin}/guide/${encodeURIComponent(slug)}`;
  const embedUrl = `${origin}/guide/${encodeURIComponent(slug)}?embed=1`;
  const embedCode = `<iframe src="${embedUrl}" width="100%" height="720" style="border:0;" loading="lazy"></iframe>`;
  return { embedCode, embedUrl, publicUrl };
}

export function LocalGuideEditorPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const params = useParams();
  const guideId = params.id;
  const slug = params.slug;
  const isEmbedMode = searchParams.get("embed") === "1";
  const isPublic = Boolean(slug);
  const hasSupabase = Boolean(getSupabaseBrowserConfig());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [app, setApp] = useState<MapApp | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [routeColor, setRouteColor] = useState(routeColors[0]);
  const [stops, setStops] = useState<GuideStop[]>([]);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [isGuideCardCollapsed, setIsGuideCardCollapsed] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [viewport, setViewport] = useState<{ center: [number, number]; zoom: number }>({
    center: defaultCenter,
    zoom: defaultZoom,
  });
  const [routePath, setRoutePath] = useState<Array<[number, number]>>([]);
  const [routeState, setRouteState] = useState<"idle" | "routing" | "fallback">("idle");
  const draggingStopIdRef = useRef<string | null>(null);
  const isDraggingStop = useCallback(() => Boolean(draggingStopIdRef.current), []);

  const selectedStop = useMemo(
    () => stops.find((stop) => stop.id === selectedStopId) || null,
    [selectedStopId, stops],
  );
  const { embedCode, embedUrl, publicUrl } = app?.slug
    ? getShareUrls(app.slug)
    : { embedCode: "", embedUrl: "", publicUrl: "" };

  useEffect(() => {
    document.title = isPublic ? "Local Guide | LocalMapr" : "Local Guide Editor | LocalMapr";
  }, [isPublic]);

  useEffect(() => {
    async function loadGuide() {
      if (!hasSupabase) {
        setError("Supabase is not configured for this workspace.");
        setLoading(false);
        return;
      }

      const supabase = createBrowserSupabaseClient();

      if (isPublic) {
        const { data, error: guideError } = await supabase
          .from("map_apps")
          .select("*")
          .eq("slug", slug ?? "")
          .eq("app_type", "local_guide")
          .eq("status", "published")
          .maybeSingle();

        if (guideError || !data) {
          setError("This published Local Guide could not be found.");
          setLoading(false);
          return;
        }

        const config = parseConfig(data.config);
        setApp(data);
        setTitle(data.title);
        setDescription(data.description || "");
        setIsPublished(true);
        setRouteColor(config.routeColor);
        setStops(config.stops);
        setSelectedStopId(config.stops[0]?.id || null);
        setViewport({ center: config.center, zoom: config.zoom });
        setDirty(false);
        setLoading(false);
        return;
      }

      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();

      if (!currentUser) {
        navigate(`/login?next=/local-guides/${guideId ?? ""}`, { replace: true });
        return;
      }

      setUser(currentUser);

      const { data, error: guideError } = await supabase
        .from("map_apps")
        .select("*")
        .eq("id", guideId ?? "")
        .eq("owner_id", currentUser.id)
        .eq("app_type", "local_guide")
        .maybeSingle();

      if (guideError || !data) {
        setError("This Local Guide could not be found in your workspace.");
        setLoading(false);
        return;
      }

      const config = parseConfig(data.config);
      setApp(data);
      setTitle(data.title);
      setDescription(data.description || "");
      setIsPublished(data.status === "published");
      setRouteColor(config.routeColor);
      setStops(config.stops);
      setSelectedStopId(config.stops[0]?.id || null);
      setViewport({ center: config.center, zoom: config.zoom });
      setDirty(false);
      setLoading(false);
    }

    void loadGuide();
  }, [guideId, hasSupabase, isPublic, navigate, slug]);

  useEffect(() => {
    if (stops.length < 2) {
      setRoutePath([]);
      setRouteState("idle");
      return undefined;
    }

    const controller = new AbortController();
    setRouteState("routing");

    void getDrivingRoute(stops, controller.signal)
      .then((path) => {
        if (!controller.signal.aborted) {
          setRoutePath(path);
          setRouteState("idle");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setRoutePath(stops.map((stop) => [stop.lat, stop.lng]));
          setRouteState("fallback");
        }
      });

    return () => controller.abort();
  }, [stops]);

  useEffect(() => {
    if (isPublic || !app || !user || !dirty) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      if (draggingStopIdRef.current) {
        return;
      }

      void persistGuide(true);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [app, description, dirty, isPublic, routeColor, stops, title, user, viewport]);

  function addStop(lat: number, lng: number) {
    setStops((prev) => {
      const next = [...prev, createStop(prev.length, lat, lng)];
      setSelectedStopId(next[next.length - 1].id);
      return next;
    });
    setDirty(true);
  }

  function addStopFromButton() {
    const base = selectedStop || stops[stops.length - 1];
    const offset = 0.01 + (stops.length % 4) * 0.004;
    addStop(
      (base?.lat || defaultCenter[0]) + offset,
      (base?.lng || defaultCenter[1]) + offset,
    );
  }

  function updateStop(id: string, patch: Partial<GuideStop>) {
    setStops((prev) => prev.map((stop) => (stop.id === id ? { ...stop, ...patch } : stop)));
    setDirty(true);
  }

  function removeSelectedStop() {
    if (!selectedStop) {
      return;
    }

    setStops((prev) => {
      const next = prev.filter((stop) => stop.id !== selectedStop.id);
      setSelectedStopId(next[0]?.id || null);
      return next;
    });
    setDirty(true);
  }

  async function persistGuide(
    silent = false,
    overrides: { isPublished?: boolean; routeColor?: string } = {},
  ) {
    if (!app || !user) {
      return false;
    }

    setSaveState("saving");
    if (!silent) {
      setError("");
      setMessage("");
    }

    const nextIsPublished = overrides.isPublished ?? isPublished;
    const nextRouteColor = overrides.routeColor ?? routeColor;
    const publishedAt = nextIsPublished ? new Date().toISOString() : null;
    const nextConfig = serializeConfig({
      center: viewport.center,
      routeColor: nextRouteColor,
      routeMode: "driving",
      stops,
      zoom: viewport.zoom,
    });
    const supabase = createBrowserSupabaseClient();
    const { error: updateError } = await supabase
      .from("map_apps")
      .update({
        config: nextConfig,
        description: description.trim() || null,
        published_at: publishedAt,
        status: nextIsPublished ? "published" : "draft",
        title: title.trim() || "Untitled local guide",
      })
      .eq("id", app.id)
      .eq("owner_id", user.id);

    if (updateError) {
      setSaveState("error");
      setError(updateError.message);
      return false;
    }

    setSaveState("saved");
    setApp((current) =>
      current
        ? {
            ...current,
            config: nextConfig,
            description: description.trim() || null,
            published_at: publishedAt,
            status: nextIsPublished ? "published" : "draft",
            title: title.trim() || "Untitled local guide",
          }
        : current,
    );
    setDirty(false);
    if (!silent) {
      setMessage("Local guide changes saved.");
    }
    return true;
  }

  async function handlePublishedChange(nextIsPublished: boolean) {
    const previousValue = isPublished;
    setIsPublished(nextIsPublished);
    setDirty(true);

    const saved = await persistGuide(true, { isPublished: nextIsPublished });
    if (!saved) {
      setIsPublished(previousValue);
    }
  }

  async function handleRouteColorChange(color: string) {
    const previousColor = routeColor;
    setRouteColor(color);
    setDirty(true);

    const saved = await persistGuide(true, { routeColor: color });
    if (!saved) {
      setRouteColor(previousColor);
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

  if (loading) {
    return (
      <main className={styles.statusPage}>
        <section className={styles.statusCard}>
          <h1>Loading Local Guide...</h1>
        </section>
      </main>
    );
  }

  if (error && !app) {
    return (
      <main className={styles.statusPage}>
        <section className={styles.statusCard}>
          <h1>Local Guide unavailable</h1>
          <p>{error}</p>
          <Link to="/local-guides">Back to Local Guides</Link>
        </section>
      </main>
    );
  }

  return (
    <main
      className={cx(
        styles.editorPage,
        isPublic && styles.isPublic,
        isEmbedMode && styles.isEmbed,
      )}
    >
      <MapContainer
        center={viewport.center}
        zoom={viewport.zoom}
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
          isPaused={isDraggingStop}
          onChange={(next) => {
            setViewport(next);
            if (!isPublic) {
              setDirty(true);
            }
          }}
        />
        <AddStopOnClick
          enabled={!isPublic && isAdding}
          onAdd={(lat, lng) => {
            addStop(lat, lng);
            setIsAdding(false);
          }}
        />
        <FocusSelectedStop
          isPaused={isDraggingStop}
          stop={selectedStop}
        />

        {routePath.length >= 2 ? (
          <Polyline
            positions={routePath}
            pathOptions={{
              color: routeState === "fallback" ? "#f36f5a" : routeColor,
              opacity: 0.92,
              weight: 5,
            }}
          />
        ) : null}

        {stops.map((stop, index) => {
          const pinPopupText = stop.popupText.trim() || stop.title;

          return (
            <Marker
              key={stop.id}
              position={[stop.lat, stop.lng]}
              icon={createStopIcon(index + 1, stop.color, stop.id === selectedStopId)}
              draggable={!isPublic}
              eventHandlers={{
                click: (event) => {
                  if (draggingStopIdRef.current) {
                    return;
                  }

                  setSelectedStopId(stop.id);
                  event.target.openPopup();
                },
                dragstart: (event) => {
                  draggingStopIdRef.current = stop.id;
                  event.target.closePopup();
                },
                dragend: (event) => {
                  const next = event.target.getLatLng();
                  updateStop(stop.id, { lat: next.lat, lng: next.lng });
                  draggingStopIdRef.current = null;
                  setSelectedStopId(stop.id);
                },
              }}
            >
              <Popup closeButton={false}>
                <strong>{pinPopupText}</strong>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      <aside className={styles.sidebar}>
        {isPublic ? (
          <a className={styles.logoLink} href="https://localmapr.com/" aria-label="LocalMapr home">
            <img src="/brand/logo_dark.png" alt="LocalMapr" />
          </a>
        ) : (
          <Link className={styles.logoLink} to="/local-guides">
            <img src="/brand/logo_dark.png" alt="LocalMapr" />
          </Link>
        )}

        <div className={styles.guideCard}>
          {!isPublic ? (
            <div className={styles.guideCardToolbar}>
              <Link to="/local-guides">All guides</Link>
              <button
                type="button"
                className={styles.guideCardToggle}
                aria-label={isGuideCardCollapsed ? "Expand guide details" : "Collapse guide details"}
                aria-expanded={!isGuideCardCollapsed}
                onClick={() => setIsGuideCardCollapsed((current) => !current)}
              >
                <span
                  className={cx(
                    styles.chevronIcon,
                    !isGuideCardCollapsed && styles.chevronIconOpen,
                  )}
                  aria-hidden="true"
                />
              </button>
            </div>
          ) : (
            <div className={styles.cardHeader}>
              <div>
                <p>Local Guide</p>
                <h1>{title || "Untitled local guide"}</h1>
              </div>
            </div>
          )}

          {isPublic ? (
            description ? <p className={styles.publicDescription}>{description}</p> : null
          ) : !isGuideCardCollapsed ? (
            <>
              <label>
                Guide title
                <input
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <label>
                Description
                <textarea
                  rows={4}
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setDirty(true);
                  }}
                />
              </label>
            </>
          ) : null}

          {isPublic || !isGuideCardCollapsed ? (
            <div className={styles.routeStatus}>
              <span>{stops.length} stops</span>
              <span>{routeState === "routing" ? "Calculating route" : routeState === "fallback" ? "Showing direct fallback" : "Driving route"}</span>
            </div>
          ) : null}

          {!isPublic && !isGuideCardCollapsed ? (
            <>
              <div className={styles.routeColorRow}>
                <span>Route colour</span>
                <div>
                  {routeColors.map((color) => (
                    <button
                      type="button"
                      key={color}
                      className={color === routeColor ? styles.activeColor : ""}
                      style={{ background: color }}
                      onClick={() => {
                        void handleRouteColorChange(color);
                      }}
                      aria-label={`Set route colour ${color}`}
                    />
                  ))}
                </div>
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
                        <button type="button" onClick={() => void copyText(publicUrl, "Share URL")}>
                          Copy
                        </button>
                      </div>
                    </label>
                    <label>
                      <span>Embed URL</span>
                      <div className={styles.copyRow}>
                        <input readOnly value={embedUrl} />
                        <button type="button" onClick={() => void copyText(embedUrl, "Embed URL")}>
                          Copy
                        </button>
                      </div>
                    </label>
                    <label>
                      <span>Embed code</span>
                      <div className={styles.copyRow}>
                        <input readOnly value={embedCode} />
                        <button type="button" onClick={() => void copyText(embedCode, "Embed code")}>
                          Copy
                        </button>
                      </div>
                    </label>
                  </>
                ) : null}
              </section>
            </>
          ) : null}
        </div>

        {message ? <p className={styles.notice}>{message}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}

        <section className={styles.stopList}>
          {stops.length ? (
            stops.map((stop, index) => (
              <button
                type="button"
                key={stop.id}
                className={stop.id === selectedStopId ? cx(styles.stopItem, styles.active) : styles.stopItem}
                onClick={() => setSelectedStopId(stop.id)}
              >
                <span style={{ background: stop.color }}>{index + 1}</span>
                <div>
                  <strong>{stop.title}</strong>
                  {stop.notes.trim() ? (
                    <FormattedNotes className={styles.stopItemNotes} notes={stop.notes} />
                  ) : (
                    <small>No notes yet.</small>
                  )}
                </div>
              </button>
            ))
          ) : (
            <div className={styles.empty}>No stops yet. Add one from the button below or click the map while placing.</div>
          )}
        </section>

        {!isPublic ? (
          <div className={styles.sidebarFooter}>
            <button type="button" onClick={addStopFromButton}>Add stop</button>
            <button
              type="button"
              className={isAdding ? styles.activeButton : styles.secondaryButton}
              onClick={() => setIsAdding((current) => !current)}
            >
              {isAdding ? "Click map" : "Place on map"}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={() => void persistGuide(false)}>
              Save
            </button>
            <span>{saveState === "saving" ? "Saving" : saveState === "error" ? "Save failed" : "Saved"}</span>
          </div>
        ) : null}
      </aside>

      {selectedStop && !isPublic ? (
        <aside className={styles.stopEditor}>
          <div className={styles.cardHeader}>
            <div>
              <p>Stop editor</p>
              <h2>{selectedStop.title}</h2>
            </div>
          </div>
          <label>
            Stop title
            <input
              value={selectedStop.title}
              onChange={(event) => updateStop(selectedStop.id, { title: event.target.value })}
            />
          </label>
          <label>
            Pin popup text
            <textarea
              rows={2}
              value={selectedStop.popupText}
              onChange={(event) => updateStop(selectedStop.id, { popupText: event.target.value })}
            />
          </label>
          <label>
            Point colour
            <div className={styles.colorPickerRow}>
              <input
                type="color"
                className={styles.colorPicker}
                value={selectedStop.color}
                onChange={(event) => updateStop(selectedStop.id, { color: event.target.value })}
                aria-label="Point colour"
              />
              <span>{selectedStop.color}</span>
            </div>
          </label>
          <label>
            Notes
            <RichNotesEditor
              key={selectedStop.id}
              value={selectedStop.notes}
              onChange={(nextNotes) => updateStop(selectedStop.id, { notes: nextNotes })}
            />
          </label>
          <div className={styles.coordGrid}>
            <label>
              Latitude
              <input
                type="number"
                step="0.00001"
                value={selectedStop.lat}
                onChange={(event) => updateStop(selectedStop.id, { lat: toNumber(event.target.value, selectedStop.lat) })}
              />
            </label>
            <label>
              Longitude
              <input
                type="number"
                step="0.00001"
                value={selectedStop.lng}
                onChange={(event) => updateStop(selectedStop.id, { lng: toNumber(event.target.value, selectedStop.lng) })}
              />
            </label>
          </div>
          <button type="button" className={styles.dangerButton} onClick={removeSelectedStop}>
            Delete stop
          </button>
        </aside>
      ) : null}
    </main>
  );
}
