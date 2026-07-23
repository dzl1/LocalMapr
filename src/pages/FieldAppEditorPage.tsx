import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import L from "leaflet";
import { GeoJSON as GeoJSONLayer, LayersControl, MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import { ArrowLeft, Download, FileUp, Layers, MapPin, Plus, Save, Trash2 } from "lucide-react";
import type { Database, Json } from "@/lib/database.types";
import { EMAIL_VERIFICATION_REQUIRED_MESSAGE, isUserEmailVerified } from "@/lib/auth";
import { createBrowserSupabaseClient, getSupabaseBrowserConfig } from "@/lib/supabase/client";
import { countGeometryTypes, parseGeoFile } from "@/lib/geoFile";
import type { GeoFeatureCollection } from "@/lib/geoFile";
import "leaflet/dist/leaflet.css";
import styles from "@/app/fieldapps/editor.module.css";

type MapApp = Database["public"]["Tables"]["map_apps"]["Row"];
type FieldLayer = {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  data: GeoFeatureCollection;
};
type InfoPoint = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  description: string;
};
type FieldConfig = { layers: FieldLayer[]; infoPoints: InfoPoint[] };
type ExportFormat = "pdf" | "png" | "jpg";

const colors = ["#0d8f5a", "#2563eb", "#dc6b2f", "#7c3aed", "#be123c", "#102136"];
const FREE_LAYER_STORAGE_BYTES = 10 * 1024 * 1024;

function serializedBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function formatStorage(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(0.01, bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function parseConfig(config: Json): FieldConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) return { layers: [], infoPoints: [] };
  const candidate = config as Record<string, Json | undefined>;
  const rawLayers = Array.isArray(candidate.layers) ? candidate.layers : [];
  const layers = rawLayers.filter((layer): layer is Json & Record<string, Json | undefined> =>
    Boolean(layer && typeof layer === "object" && !Array.isArray(layer)),
  ).map((layer, index) => ({
    id: typeof layer.id === "string" ? layer.id : crypto.randomUUID(),
    name: typeof layer.name === "string" ? layer.name : `Layer ${index + 1}`,
    color: typeof layer.color === "string" ? layer.color : colors[index % colors.length],
    visible: layer.visible !== false,
    data: layer.data as unknown as GeoFeatureCollection,
  })).filter((layer) => layer.data?.type === "FeatureCollection" && Array.isArray(layer.data.features));
  const rawPoints = Array.isArray(candidate.infoPoints) ? candidate.infoPoints : [];
  const infoPoints = rawPoints.filter((point): point is Json & Record<string, Json | undefined> =>
    Boolean(point && typeof point === "object" && !Array.isArray(point)),
  ).map((point, index) => ({
    id: typeof point.id === "string" ? point.id : crypto.randomUUID(),
    lat: Number(point.lat),
    lng: Number(point.lng),
    title: typeof point.title === "string" ? point.title : `Information point ${index + 1}`,
    description: typeof point.description === "string" ? point.description : "",
  })).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  return { layers, infoPoints };
}

function PointPlacement({ active, onPlace }: { active: boolean; onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event) {
      if (active) onPlace(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

function pointIcon(selected: boolean) {
  return L.divIcon({
    className: "",
    html: `<span class="${styles.pointMarker} ${selected ? styles.pointMarkerSelected : ""}"><span></span></span>`,
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
    iconSize: [28, 28],
  });
}

function importedFeaturePopup(properties: Record<string, unknown>) {
  const entries = Object.entries(properties).filter(([, value]) =>
    value !== null && value !== undefined && typeof value !== "object",
  ).slice(0, 8);
  if (!entries.length) return null;
  const card = document.createElement("article");
  card.className = styles.importedPopup;
  const titleEntry = entries.find(([key]) => /^(name|title|label)$/i.test(key));
  const title = document.createElement("h3");
  title.textContent = titleEntry ? String(titleEntry[1]) : "Map feature";
  card.appendChild(title);
  entries.filter(([key]) => key !== titleEntry?.[0]).forEach(([key, value]) => {
    const row = document.createElement("p");
    const label = document.createElement("strong");
    label.textContent = key.replace(/_/g, " ");
    const content = document.createElement("span");
    content.textContent = String(value);
    row.append(label, content);
    card.appendChild(row);
  });
  return card;
}

function FitLayers({ layers }: { layers: FieldLayer[] }) {
  const map = useMap();
  const signature = layers.map((layer) => `${layer.id}:${layer.data.features.length}`).join("|");
  useEffect(() => {
    if (!layers.length) return;
    const group = L.geoJSON(layers.map((layer) => layer.data) as GeoJSON.GeoJsonObject[]);
    const bounds = group.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
  }, [map, signature]);
  return null;
}

export function FieldAppEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const mapWrapRef = useRef<HTMLElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const hasSupabase = Boolean(getSupabaseBrowserConfig());
  const [app, setApp] = useState<MapApp | null>(null);
  const [title, setTitle] = useState("");
  const [layers, setLayers] = useState<FieldLayer[]>([]);
  const [infoPoints, setInfoPoints] = useState<InfoPoint[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [placingPoint, setPlacingPoint] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("pdf");
  const [dragging, setDragging] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const featureCount = useMemo(() => layers.reduce((total, layer) => total + layer.data.features.length, 0), [layers]);
  const draftLayerBytes = useMemo(() => serializedBytes(layers), [layers]);
  const draftExceedsFreeLimit = draftLayerBytes > FREE_LAYER_STORAGE_BYTES;

  useEffect(() => {
    document.title = "Field App Editor | LocalMapr";
    async function loadApp() {
      if (!hasSupabase) {
        setError("Supabase is not configured for this workspace.");
        setLoading(false);
        return;
      }
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate(`/login?next=/field-apps/${id ?? ""}`, { replace: true });
        return;
      }
      if (!isUserEmailVerified(user)) {
        await supabase.auth.signOut();
        navigate(`/login?error=${encodeURIComponent(EMAIL_VERIFICATION_REQUIRED_MESSAGE)}`, { replace: true });
        return;
      }
      const { data, error: loadError } = await supabase.from("map_apps").select("*")
        .eq("id", id ?? "").eq("owner_id", user.id).eq("app_type", "field_app").maybeSingle();
      if (loadError || !data) {
        setError("This Field App could not be found in your workspace.");
      } else {
        setApp(data);
        setTitle(data.title);
        const config = parseConfig(data.config);
        setLayers(config.layers);
        setInfoPoints(config.infoPoints);
      }
      setLoading(false);
    }
    void loadApp();
  }, [hasSupabase, id, navigate]);

  async function importFiles(files: FileList | File[]) {
    setError("");
    setMessage("");
    const selected = Array.from(files);
    if (!selected.length) return;
    try {
      const imported = await Promise.all(selected.map(async (file, index) => ({
        id: crypto.randomUUID(),
        name: file.name.replace(/\.(geojson|json|kml|gpx)$/i, ""),
        color: colors[(layers.length + index) % colors.length],
        visible: true,
        data: await parseGeoFile(file),
      })));
      setLayers((current) => [...current, ...imported]);
      setDirty(true);
      setMessage(`${imported.length} layer${imported.length === 1 ? "" : "s"} imported. Save to keep your changes.`);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "The map file could not be imported.");
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void importFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void importFiles(event.dataTransfer.files);
  }

  async function save() {
    if (!app) return;
    if (draftExceedsFreeLimit) {
      setError("These layers exceed the 10 MB free storage limit. Remove or simplify a layer before saving.");
      return;
    }
    setSaving(true);
    setError("");
    const supabase = createBrowserSupabaseClient();
    const { error: saveError } = await supabase.from("map_apps").update({
      title: title.trim() || app.title,
      config: { layers, infoPoints } as unknown as Json,
    }).eq("id", app.id).eq("owner_id", app.owner_id);
    if (saveError) {
      setError(saveError.message || "Your Field App could not be saved.");
    } else {
      setDirty(false);
      setMessage("Field App saved.");
    }
    setSaving(false);
  }

  async function exportCurrentView() {
    if (!app || !mapWrapRef.current || exporting) return;
    setExporting(true);
    setError("");
    setMessage("");
    try {
      mapRef.current?.stop();
      mapRef.current?.invalidateSize({ animate: false, pan: false });
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(mapWrapRef.current, {
        backgroundColor: "#dce7df",
        logging: false,
        scale: Math.min(window.devicePixelRatio || 1, 2),
        useCORS: true,
      });
      const exportTitle = title.trim() || app.title;
      const fileName = exportTitle.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "field-map";

      if (exportFormat === "png" || exportFormat === "jpg") {
        const mimeType = exportFormat === "png" ? "image/png" : "image/jpeg";
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (result) => result ? resolve(result) : reject(new Error("The map image could not be created.")),
            mimeType,
            exportFormat === "jpg" ? 0.92 : undefined,
          );
        });
        const objectUrl = URL.createObjectURL(blob);
        const download = document.createElement("a");
        download.href = objectUrl;
        download.download = `${fileName}.${exportFormat}`;
        document.body.appendChild(download);
        download.click();
        download.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        setMessage(`${exportFormat.toUpperCase()} exported from the current map view.`);
        return;
      }

      const { jsPDF } = await import("jspdf");
      const landscape = canvas.width >= canvas.height;
      const pdf = new jsPDF({
        orientation: landscape ? "landscape" : "portrait",
        unit: "pt",
        format: landscape ? "a4" : "a4",
        compress: true,
      });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 28;
      const headerHeight = 42;
      const availableWidth = pageWidth - margin * 2;
      const availableHeight = pageHeight - margin * 2 - headerHeight;
      const imageScale = Math.min(availableWidth / canvas.width, availableHeight / canvas.height);
      const imageWidth = canvas.width * imageScale;
      const imageHeight = canvas.height * imageScale;
      const imageX = (pageWidth - imageWidth) / 2;
      const imageY = margin + headerHeight;

      pdf.setTextColor(16, 33, 54);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.text(exportTitle, margin, margin + 12, { maxWidth: availableWidth * 0.72 });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(92, 107, 120);
      pdf.text(`Exported ${new Date().toLocaleString()}`, pageWidth - margin, margin + 12, { align: "right" });
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", imageX, imageY, imageWidth, imageHeight, undefined, "FAST");

      pdf.save(`${fileName}.pdf`);
      setMessage("PDF exported from the current map view.");
    } catch (exportError) {
      setError(exportError instanceof Error ? `Export failed: ${exportError.message}` : "The map could not be exported.");
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <main className={styles.state}><p>Loading Field App…</p></main>;
  if (!app) return <main className={styles.state}><h1>Field App unavailable</h1><p>{error}</p><Link to="/dashboard">Back to dashboard</Link></main>;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link to="/dashboard" className={styles.back}><ArrowLeft size={18} /> Dashboard</Link>
        <input className={styles.title} value={title} aria-label="Field App title" onChange={(event) => { setTitle(event.target.value); setDirty(true); }} />
        <div className={styles.headerActions}>
          <div className={styles.exportGroup}>
            <select aria-label="Export format" value={exportFormat} disabled={exporting} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}>
              <option value="pdf">PDF</option>
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
            </select>
            <button className={styles.export} type="button" disabled={exporting} onClick={() => void exportCurrentView()}><Download size={17} />{exporting ? "Exporting…" : "Export"}</button>
          </div>
          <button className={styles.save} type="button" disabled={!dirty || saving || draftExceedsFreeLimit} onClick={() => void save()}><Save size={17} />{saving ? "Saving…" : dirty ? "Save changes" : "Saved"}</button>
        </div>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.sidebar}>
          <div className={styles.intro}><span>Field App</span><h1>Map layers</h1><p>Overlay field boundaries, survey points, tracks, and other spatial data.</p></div>
          <div className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ""}`} onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
            <FileUp size={25} />
            <strong>Drop map files here</strong>
            <span>GeoJSON, KML, or GPX · up to 5 MB</span>
            <button type="button" onClick={() => inputRef.current?.click()}>Choose files</button>
            <input ref={inputRef} hidden multiple type="file" accept=".geojson,.json,.kml,.gpx,application/geo+json,application/json" onChange={handleFileChange} />
          </div>
          <div className={styles.storageMeter}>
            <div><strong>This Field App</strong><span>{formatStorage(draftLayerBytes)} / 10 MB</span></div>
            <progress max={FREE_LAYER_STORAGE_BYTES} value={Math.min(draftLayerBytes, FREE_LAYER_STORAGE_BYTES)} />
            <small>The 10 MB free limit applies across all your saved Field Apps. Local, unsaved layers do not count.</small>
          </div>
          {error ? <p className={styles.error}>{error}</p> : null}
          {message ? <p className={styles.message}>{message}</p> : null}
          <div className={styles.pointHeading}>
            <div><MapPin size={17} /><strong>Information points</strong></div>
            <span>{infoPoints.length}</span>
          </div>
          <button className={`${styles.addPoint} ${placingPoint ? styles.addPointActive : ""}`} type="button" onClick={() => setPlacingPoint((current) => !current)}>
            <Plus size={17} />{placingPoint ? "Click the map to place it" : "Add information point"}
          </button>
          <div className={styles.pointList}>
            {infoPoints.map((point, index) => (
              <section className={`${styles.pointCard} ${selectedPointId === point.id ? styles.pointCardSelected : ""}`} key={point.id} onClick={() => setSelectedPointId(point.id)}>
                <div className={styles.pointCardTop}><span>{index + 1}</span><strong>Point leaflet</strong><button type="button" aria-label={`Remove ${point.title}`} onClick={(event) => { event.stopPropagation(); setInfoPoints((current) => current.filter((item) => item.id !== point.id)); setSelectedPointId(null); setDirty(true); }}><Trash2 size={15} /></button></div>
                <label>Title<input value={point.title} onChange={(event) => { setInfoPoints((current) => current.map((item) => item.id === point.id ? { ...item, title: event.target.value } : item)); setDirty(true); }} /></label>
                <label>Information<textarea rows={3} placeholder="What should people know about this point?" value={point.description} onChange={(event) => { setInfoPoints((current) => current.map((item) => item.id === point.id ? { ...item, description: event.target.value } : item)); setDirty(true); }} /></label>
                <small>{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</small>
              </section>
            ))}
          </div>
          <div className={styles.layerHeading}><div><Layers size={17} /><strong>{layers.length} layers</strong></div><span>{featureCount} features</span></div>
          <div className={styles.layerList}>
            {layers.map((layer) => {
              const geometrySummary = Object.entries(countGeometryTypes(layer.data)).map(([type, count]) => `${count} ${type}`).join(", ");
              return <section className={styles.layer} key={layer.id}>
                <div className={styles.layerTop}>
                  <input type="checkbox" checked={layer.visible} aria-label={`Show ${layer.name}`} onChange={(event) => { setLayers((current) => current.map((item) => item.id === layer.id ? { ...item, visible: event.target.checked } : item)); setDirty(true); }} />
                  <input className={styles.layerName} value={layer.name} aria-label="Layer name" onChange={(event) => { setLayers((current) => current.map((item) => item.id === layer.id ? { ...item, name: event.target.value } : item)); setDirty(true); }} />
                  <input className={styles.color} type="color" value={layer.color} aria-label={`${layer.name} color`} onChange={(event) => { setLayers((current) => current.map((item) => item.id === layer.id ? { ...item, color: event.target.value } : item)); setDirty(true); }} />
                  <button className={styles.remove} type="button" aria-label={`Remove ${layer.name}`} onClick={() => { setLayers((current) => current.filter((item) => item.id !== layer.id)); setDirty(true); }}><Trash2 size={16} /></button>
                </div>
                <p>{geometrySummary || "No features"}</p>
              </section>;
            })}
            {!layers.length ? <p className={styles.empty}>Import a map file to create your first overlay.</p> : null}
          </div>
        </aside>

        <section ref={mapWrapRef} className={styles.mapWrap} aria-label="Field App map preview">
          <MapContainer ref={mapRef} center={[-35.205, 173.95]} zoom={11} zoomControl={false} preferCanvas className={styles.map}>
            <LayersControl position="topright">
              <LayersControl.BaseLayer checked name="Street map">
                <TileLayer attribution="&copy; OpenStreetMap contributors" crossOrigin="anonymous" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
              </LayersControl.BaseLayer>
              <LayersControl.BaseLayer name="Satellite">
                <TileLayer attribution="Tiles &copy; Esri and its data providers" crossOrigin="anonymous" maxZoom={19} url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
              </LayersControl.BaseLayer>
            </LayersControl>
            <ZoomControl position="bottomright" />
            <FitLayers layers={layers} />
            <PointPlacement active={placingPoint} onPlace={(lat, lng) => {
              const point = { id: crypto.randomUUID(), lat, lng, title: `Information point ${infoPoints.length + 1}`, description: "" };
              setInfoPoints((current) => [...current, point]);
              setSelectedPointId(point.id);
              setPlacingPoint(false);
              setDirty(true);
            }} />
            {layers.filter((layer) => layer.visible).map((layer) => (
              <GeoJSONLayer key={`${layer.id}-${layer.color}`} data={layer.data as GeoJSON.GeoJsonObject} style={{ color: layer.color, fillColor: layer.color, fillOpacity: 0.22, weight: 3 }} pointToLayer={(_feature, latlng) => L.circleMarker(latlng, { radius: 7, color: "#fff", weight: 2, fillColor: layer.color, fillOpacity: 1 })} onEachFeature={(feature, leafletLayer) => {
                const properties = feature.properties as Record<string, unknown> | undefined;
                const popup = properties ? importedFeaturePopup(properties) : null;
                if (popup) leafletLayer.bindPopup(popup);
              }} />
            ))}
            {infoPoints.map((point) => (
              <Marker key={point.id} position={[point.lat, point.lng]} icon={pointIcon(selectedPointId === point.id)} eventHandlers={{ click: () => setSelectedPointId(point.id) }}>
                <Popup className={styles.pointPopup}>
                  <article><span>Field information</span><h3>{point.title || "Untitled point"}</h3>{point.description ? <p>{point.description}</p> : <p>No information added yet.</p>}<small>{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</small></article>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
          {placingPoint ? <div className={styles.placementHint}><MapPin size={17} /> Click anywhere on the map</div> : null}
          {!layers.length && !infoPoints.length ? <div className={styles.mapEmpty}><Layers size={30} /><strong>Your field map will appear here</strong><span>Import an overlay or add an information point.</span></div> : null}
        </section>
      </div>
    </main>
  );
}
