import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { FileUp, Layers, MapPin, Trash2 } from "lucide-react";
import { SiteHeader } from "@/app/components/SiteHeader";
import type { Database, Json } from "@/lib/database.types";
import {
  EMAIL_VERIFICATION_REQUIRED_MESSAGE,
  isUserEmailVerified,
} from "@/lib/auth";
import {
  createBrowserSupabaseClient,
  getSupabaseBrowserConfig,
} from "@/lib/supabase/client";
import styles from "@/app/fieldapps/fieldapps.module.css";

type MapApp = Database["public"]["Tables"]["map_apps"]["Row"];

const fieldFeatures = [
  {
    icon: FileUp,
    title: "Bring your own map data",
    copy: "Import GeoJSON, KML, and GPX files to review boundaries, survey points, routes, tracks, and other spatial data.",
  },
  {
    icon: MapPin,
    title: "Add field information",
    copy: "Place information points directly on the map and add concise notes for sites, observations, assets, or project updates.",
  },
  {
    icon: Layers,
    title: "Control and export the view",
    copy: "Switch basemaps, toggle layers and place names, then export the current map view as PDF, PNG, or JPG.",
  },
];

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 52);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fieldAppSummary(config: Json): { features: number; layers: number; points: number } {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { features: 0, layers: 0, points: 0 };
  }

  const value = config as Record<string, Json | undefined>;
  const layers = Array.isArray(value.layers) ? value.layers : [];
  const points = Array.isArray(value.infoPoints) ? value.infoPoints.length : 0;
  const features = layers.reduce<number>((total, layer) => {
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) return total;
    const data = (layer as Record<string, Json | undefined>).data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return total;
    const layerFeatures = (data as Record<string, Json | undefined>).features;
    return total + (Array.isArray(layerFeatures) ? layerFeatures.length : 0);
  }, 0);

  return { features, layers: layers.length, points };
}

export function FieldAppsPage() {
  const navigate = useNavigate();
  const hasSupabase = Boolean(getSupabaseBrowserConfig());
  const [user, setUser] = useState<User | null>(null);
  const [fieldApps, setFieldApps] = useState<MapApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const totals = useMemo(
    () => fieldApps.reduce(
      (summary, app) => {
        const appSummary = fieldAppSummary(app.config);
        return {
          features: summary.features + appSummary.features,
          layers: summary.layers + appSummary.layers,
          points: summary.points + appSummary.points,
        };
      },
      { features: 0, layers: 0, points: 0 },
    ),
    [fieldApps],
  );

  async function loadFieldApps() {
    if (!hasSupabase) {
      setLoading(false);
      return;
    }

    const supabase = createBrowserSupabaseClient();
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();

    setUser(currentUser);

    if (!currentUser) {
      setFieldApps([]);
      setLoading(false);
      return;
    }

    if (!isUserEmailVerified(currentUser)) {
      await supabase.auth.signOut();
      navigate(
        `/login?error=${encodeURIComponent(EMAIL_VERIFICATION_REQUIRED_MESSAGE)}`,
        { replace: true },
      );
      return;
    }

    const { data, error: loadError } = await supabase
      .from("map_apps")
      .select("*")
      .eq("owner_id", currentUser.id)
      .eq("app_type", "field_app")
      .order("updated_at", { ascending: false });

    if (loadError) {
      setError(loadError.message);
    } else {
      setFieldApps(data ?? []);
    }

    setLoading(false);
  }

  useEffect(() => {
    document.title = "Field Apps | LocalMapr";
    void loadFieldApps();
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!hasSupabase) {
      setError("Supabase is not configured for this workspace.");
      return;
    }

    if (!user) {
      navigate("/login?next=/field-apps");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();

    if (!title) {
      setError("A Field App name is required.");
      return;
    }

    setCreating(true);
    setError("");
    setMessage("");

    const slugBase = slugify(title) || "field-app";
    const supabase = createBrowserSupabaseClient();
    const { data: inserted, error: insertError } = await supabase
      .from("map_apps")
      .insert({
        app_type: "field_app",
        config: { infoPoints: [], layers: [] },
        description: description || null,
        owner_id: user.id,
        slug: `${slugBase}-${crypto.randomUUID().slice(0, 8)}`,
        title,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      setError(insertError?.message || "Could not create Field App.");
      setCreating(false);
      return;
    }

    navigate(`/field-apps/${inserted.id}`);
  }

  async function handleDelete(app: MapApp) {
    if (!hasSupabase || !user) return;

    const confirmed = window.confirm(
      `Delete "${app.title}"? This permanently removes the Field App and its saved layers.`,
    );
    if (!confirmed) return;

    setDeletingId(app.id);
    setError("");
    setMessage("");

    const supabase = createBrowserSupabaseClient();
    const { error: deleteError } = await supabase
      .from("map_apps")
      .delete()
      .eq("id", app.id)
      .eq("owner_id", user.id)
      .eq("app_type", "field_app");

    if (deleteError) {
      setError(deleteError.message || "Unable to delete Field App.");
    } else {
      setFieldApps((current) => current.filter((item) => item.id !== app.id));
      setMessage(`"${app.title}" deleted.`);
    }
    setDeletingId(null);
  }

  const workspace = user ? (
    <section className={styles.workspace} aria-labelledby="field-app-library">
      <div className={styles.workspaceIntro}>
        <div>
          <p>Your workspace</p>
          <h1 id="field-app-library">Your Field Apps</h1>
          <span>Open an existing field map or start a new one.</span>
        </div>
        <div className={styles.totals}>
          <div><strong>{fieldApps.length}</strong><span>apps</span></div>
          <div><strong>{totals.layers}</strong><span>layers</span></div>
          <div><strong>{totals.features + totals.points}</strong><span>mapped items</span></div>
        </div>
      </div>

      {message ? <p className={styles.notice}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.workspaceGrid}>
        <form className={styles.createPanel} onSubmit={handleCreate}>
          <div><p>Create</p><h2>New Field App</h2></div>
          <label>
            App name
            <input name="title" placeholder="Wetland survey map" required />
          </label>
          <label>
            Description
            <textarea name="description" placeholder="A short note about this field project" rows={4} />
          </label>
          <button type="submit" disabled={creating}>
            {creating ? "Creating..." : "Create Field App"}
          </button>
          <small>Saved map layers share a 10 MB free storage allowance across your Field Apps.</small>
        </form>

        <section className={styles.library}>
          <div className={styles.libraryHeader}>
            <p>Recent apps</p>
            <strong>{fieldApps.length} total</strong>
          </div>
          {loading ? (
            <div className={styles.empty}>Loading Field Apps...</div>
          ) : fieldApps.length ? (
            <div className={styles.appList}>
              {fieldApps.map((app) => {
                const summary = fieldAppSummary(app.config);
                return (
                  <article className={styles.appItem} key={app.id}>
                    <Link to={`/field-apps/${app.id}`}>
                      <span>{app.status === "published" ? "Published" : "Draft"}</span>
                      <h3>{app.title}</h3>
                      <p>{app.description || "No description yet."}</p>
                      <div className={styles.appStats}>
                        <small>{summary.layers} layers</small>
                        <small>{summary.features} features</small>
                        <small>{summary.points} information points</small>
                      </div>
                    </Link>
                    <div className={styles.appMeta}>
                      <strong>Updated {formatDate(app.updated_at)}</strong>
                      <button
                        type="button"
                        onClick={() => void handleDelete(app)}
                        disabled={deletingId === app.id}
                        aria-label={`Delete ${app.title}`}
                        title="Delete Field App"
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.empty}>
              No Field Apps yet. Create your first app to begin mapping field data.
            </div>
          )}
        </section>
      </div>
    </section>
  ) : null;

  const information = (
    <section className={styles.product}>
      <div className={styles.hero}>
        <div className={styles.heroCopy}>
          <p>Field Apps</p>
          <h1>Bring field data together on one practical map.</h1>
          <span>
            Field Apps help teams, communities, researchers, and land managers
            combine spatial files with clear on-map information—without needing
            a full GIS workflow.
          </span>
          <div className={styles.heroActions}>
            <Link to={user ? "#field-app-library" : "/login?next=/field-apps"}>
              {user ? "View your Field Apps" : "Sign in to create a Field App"}
            </Link>
            <a href="#field-app-features">Explore features</a>
          </div>
        </div>
        <div className={styles.heroVisual}>
          <img src="/field-apps-card.png" alt="Field App showing spatial layers and information points on a map" />
          <div><strong>Map-first field work</strong><span>Import · review · annotate · export</span></div>
        </div>
      </div>

      <div id="field-app-features" className={styles.infoGrid}>
        {fieldFeatures.map(({ icon: Icon, title, copy }) => (
          <article key={title}>
            <Icon size={22} />
            <h2>{title}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </div>

      <div className={styles.workflow}>
        <div>
          <p>How it works</p>
          <h2>From local files to a useful field map.</h2>
        </div>
        <ol>
          <li><span>01</span><strong>Import layers</strong><p>Preview supported spatial files locally before deciding what to save.</p></li>
          <li><span>02</span><strong>Shape the view</strong><p>Style, name, and toggle layers, add field notes, and choose a basemap.</p></li>
          <li><span>03</span><strong>Save or export</strong><p>Keep the Field App in your workspace or export the current view for reports.</p></li>
        </ol>
      </div>

      {!user ? (
        <div className={styles.signInBand}>
          <div><p>Ready to map?</p><h2>Create and manage Field Apps in your LocalMapr workspace.</h2></div>
          <Link to="/login?next=/field-apps">Sign in to get started</Link>
        </div>
      ) : null}
    </section>
  );

  return (
    <main className={styles.page}>
      <SiteHeader
        className={styles.fieldAppsHeader}
        user={user}
        accountHref={user ? "/dashboard" : "/login?next=/field-apps"}
      />
      {workspace}
      {information}
      {!user && loading ? <p className={styles.loading}>Checking your workspace...</p> : null}
      {!user && error ? <p className={styles.error}>{error}</p> : null}
    </main>
  );
}
