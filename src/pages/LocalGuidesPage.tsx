import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  createBrowserSupabaseClient,
  getSupabaseBrowserConfig,
} from "@/lib/supabase/client";
import styles from "@/app/localguides/localguides.module.css";

type MapApp = Database["public"]["Tables"]["map_apps"]["Row"];

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2Z" />
      <path d="M6 9h12l-1 11H7L6 9Zm4 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z" />
    </svg>
  );
}

const guideFeatures = [
  {
    title: "Plan connected stops",
    copy: "Add places in order, then shape them into a guide people can follow by car, on foot, or as a local itinerary.",
  },
  {
    title: "Show driving routes",
    copy: "Local Guides calculate road paths between stops and display them as a clear route line on the map.",
  },
  {
    title: "Publish one link",
    copy: "Share the finished guide with visitors, clients, communities, or teams without sending a spreadsheet of addresses.",
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

export function LocalGuidesPage() {
  const navigate = useNavigate();
  const hasSupabase = Boolean(getSupabaseBrowserConfig());
  const [user, setUser] = useState<User | null>(null);
  const [guides, setGuides] = useState<MapApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingGuideId, setDeletingGuideId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadGuides() {
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
      setGuides([]);
      setLoading(false);
      return;
    }

    const { data, error: guidesError } = await supabase
      .from("map_apps")
      .select("*")
      .eq("owner_id", currentUser.id)
      .eq("app_type", "local_guide")
      .order("updated_at", { ascending: false });

    if (guidesError) {
      setError(guidesError.message);
    } else {
      setGuides(data ?? []);
    }

    setLoading(false);
  }

  useEffect(() => {
    document.title = "Local Guides | LocalMapr";
    void loadGuides();
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!hasSupabase) {
      setError("Supabase is not configured for this workspace.");
      return;
    }

    if (!user) {
      navigate("/login?next=/local-guides");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();

    if (!title) {
      setError("A guide name is required.");
      return;
    }

    setCreating(true);
    setError("");
    setMessage("");

    const slugBase = slugify(title) || "local-guide";
    const supabase = createBrowserSupabaseClient();
    const { data: insertedGuide, error: insertError } = await supabase
      .from("map_apps")
      .insert({
        app_type: "local_guide",
        config: {
          center: [-35.205, 173.95],
          routeColor: "#0d8f5a",
          routeMode: "driving",
          stops: [],
          zoom: 11,
        },
        description: description || null,
        owner_id: user.id,
        slug: `${slugBase}-${crypto.randomUUID().slice(0, 8)}`,
        title,
      })
      .select("id")
      .single();

    if (insertError || !insertedGuide) {
      setError(insertError?.message || "Could not create Local Guide.");
      setCreating(false);
      return;
    }

    navigate(`/local-guides/${insertedGuide.id}`);
  }

  async function handleDeleteGuide(guide: MapApp) {
    if (!hasSupabase || !user) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${guide.title}"? This will permanently remove the Local Guide and its share link.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingGuideId(guide.id);
    setError("");
    setMessage("");

    const supabase = createBrowserSupabaseClient();
    const { error: deleteError } = await supabase
      .from("map_apps")
      .delete()
      .eq("id", guide.id)
      .eq("owner_id", user.id)
      .eq("app_type", "local_guide");

    if (deleteError) {
      setError(deleteError.message || "Unable to delete Local Guide.");
      setDeletingGuideId(null);
      return;
    }

    setGuides((current) => current.filter((item) => item.id !== guide.id));
    setMessage(`"${guide.title}" deleted.`);
    setDeletingGuideId(null);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} to="/" aria-label="LocalMapr home">
          <img
            className={styles.brandLogo}
            src="/brand/logo_dark.png"
            alt="LocalMapr"
          />
        </Link>
        <div className={styles.headerActions}>
          {user?.email ? <span className={styles.accountEmail}>{user.email}</span> : null}
          <Link className={styles.ghostButton} to={user ? "/dashboard" : "/login?next=/local-guides"}>
            {user ? "Dashboard" : "Sign in"}
          </Link>
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p>Local Guides</p>
          <h1>Create route-based local guides.</h1>
          <span>
            Build practical guides for neighborhoods, visitor trails, property
            viewings, field visits, and local recommendations. Each guide can
            connect places with driving routes and publish as one shareable map.
          </span>
        </div>
        <div className={styles.heroPanel}>
          <span>Routing</span>
          <strong>Driving routes between stops</strong>
          <p>
            Maps can show routes to locations. The map displays your stops, and
            a routing service calculates the road path between them.
          </p>
          <Link to={user ? "#create-guide" : "/login?next=/local-guides"}>
            {user ? "Create a guide" : "Sign in to get started"}
          </Link>
        </div>
      </section>

      {message ? <p className={styles.notice}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.infoGrid} aria-label="What Local Guides can do">
        {guideFeatures.map((feature) => (
          <article className={styles.infoCard} key={feature.title}>
            <h2>{feature.title}</h2>
            <p>{feature.copy}</p>
          </article>
        ))}
      </section>

      <section className={styles.workspaceGrid}>
        {user ? (
          <form id="create-guide" className={styles.createPanel} onSubmit={handleCreate}>
            <div>
              <p>Create</p>
              <h2>New local guide</h2>
            </div>
            <label>
              Guide name
              <input name="title" placeholder="Best coffee stops in Wellington" required />
            </label>
            <label>
              Description
              <textarea
                name="description"
                placeholder="A short note for your guide"
                rows={5}
              />
            </label>
            <button type="submit" disabled={creating}>
              {creating ? "Creating..." : "Create guide draft"}
            </button>
          </form>
        ) : (
          <section className={styles.signInPanel}>
            <p>Get started</p>
            <h2>Sign in to create and manage Local Guides.</h2>
            <span>
              You can browse what Local Guides are for without an account. Sign
              in when you are ready to save drafts and build your own guide list.
            </span>
            <Link to="/login?next=/local-guides">Sign in to get started</Link>
          </section>
        )}

        <section className={styles.guidesPanel}>
          <div className={styles.panelHeader}>
            <div>
              <p>Your library</p>
              <h2>{user ? `${guides.length} guides` : "Sign in required"}</h2>
            </div>
          </div>

          {loading ? (
            <div className={styles.empty}>Loading local guides...</div>
          ) : !user ? (
            <div className={styles.empty}>
              Your local guide drafts will appear here after you sign in.
            </div>
          ) : guides.length ? (
            <div className={styles.guideList}>
              {guides.map((guide) => (
                <article className={styles.guideItem} key={guide.id}>
                  <Link className={styles.guideLink} to={`/local-guides/${guide.id}`}>
                    <div>
                      <span>{guide.status === "published" ? "Published" : "Draft"}</span>
                      <h3>{guide.title}</h3>
                      <p>{guide.description || "No description yet."}</p>
                    </div>
                  </Link>
                  <div className={styles.guideMeta}>
                    <strong>Updated {formatDate(guide.updated_at)}</strong>
                    <code>/{guide.slug}</code>
                    <button
                      type="button"
                      className={styles.deleteGuideButton}
                      onClick={() => void handleDeleteGuide(guide)}
                      disabled={deletingGuideId === guide.id}
                      aria-label={`Delete ${guide.title}`}
                      title="Delete guide"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              No Local Guides yet. Create a draft to start planning your first
              route-based guide.
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
