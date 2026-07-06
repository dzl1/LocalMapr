import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { readApiResponse } from "@/lib/api";
import type { Database, Json } from "@/lib/database.types";
import {
  createBrowserSupabaseClient,
  getSupabaseBrowserConfig,
} from "@/lib/supabase/client";
import {
  EMAIL_VERIFICATION_REQUIRED_MESSAGE,
  isUserEmailVerified,
} from "@/lib/auth";
import {
  FREE_MAP_TOUR_LIMIT,
  getUnusedTourCreditCount,
  isMissingMapTourPurchasesTable,
} from "@/lib/mapTourBilling";
import styles from "@/app/dashboard/dashboard.module.css";

type MapApp = Database["public"]["Tables"]["map_apps"]["Row"];
type MapTourPurchase =
  Database["public"]["Tables"]["map_tour_purchases"]["Row"];

const defaultCenter: [number, number] = [-35.205, 173.95];
const defaultZoom = 11;
type DashboardLoadOptions = {
  syncedPurchases?: MapTourPurchase[];
};

const appTypeLabels: Record<string, string> = {
  field_app: "Field app",
  local_guide: "Local guide",
  map_tour: "Map tour",
};

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2Z" />
      <path d="M6 9h12l-1 11H7L6 9Zm4 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z" />
    </svg>
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 52);
}

async function createMapTourDraft(body: {
  description: string;
  title: string;
  userId: string;
}) {
  const supabase = createBrowserSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Please log in again before creating a Map Tour.");
  }

  const response = await fetch("/api/map-tour/create", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await readApiResponse<{
    app?: MapApp;
    error?: string;
  }>(response, "Map Tour could not be created.");

  if (!response.ok || !payload.app) {
    if (import.meta.env.DEV && response.status === 404) {
      const slugBase = slugify(body.title || "map-tour") || "map-tour";
      const { data: inserted, error } = await supabase
        .from("map_apps")
        .insert({
          app_type: "map_tour",
          config: {
            cards: [
              {
                body: "",
                color: "#1f4834",
                hoverText: "",
                id: `tour-card-${Date.now()}-0`,
                imageTimerSeconds: 4,
                imageUrls: [],
                lat: defaultCenter[0],
                lng: defaultCenter[1],
                title: "Tour point 1",
              },
            ],
            center: defaultCenter,
            zoom: defaultZoom,
          } as Json,
          description: body.description || null,
          owner_id: body.userId,
          slug: `${slugBase}-${crypto.randomUUID().slice(0, 8)}`,
          title: body.title || "Untitled map tour",
        })
        .select("*")
        .single();

      if (error || !inserted) {
        throw new Error(error?.message ?? "Map Tour could not be created.");
      }

      return inserted;
    }

    throw new Error(payload.error ?? "Map Tour could not be created.");
  }

  return payload.app;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [apps, setApps] = useState<MapApp[]>([]);
  const [purchases, setPurchases] = useState<MapTourPurchase[]>([]);
  const [createType, setCreateType] = useState("map_tour");
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(searchParams.get("error") ?? "");
  const [creating, setCreating] = useState(false);
  const [deletingAppId, setDeletingAppId] = useState<string | null>(null);
  const hasSupabase = Boolean(getSupabaseBrowserConfig());

  async function loadDashboard(options: DashboardLoadOptions = {}) {
    if (!hasSupabase) {
      setLoading(false);
      return;
    }

    const supabase = createBrowserSupabaseClient();
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();

    if (!currentUser) {
      navigate("/login?next=/dashboard", { replace: true });
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

    setUser(currentUser);

    const purchasesRequest = options.syncedPurchases
      ? Promise.resolve({ data: options.syncedPurchases, error: null })
      : supabase
          .from("map_tour_purchases")
          .select("*")
          .eq("user_id", currentUser.id)
          .order("created_at", { ascending: false });

    const [
      { data: appsData },
      { data: purchasesData, error: purchasesError },
      { data: adminRecord },
    ] = await Promise.all([
      supabase
        .from("map_apps")
        .select("*")
        .eq("owner_id", currentUser.id)
        .order("updated_at", { ascending: false }),
      purchasesRequest,
      supabase
        .from("super_admins")
        .select("id")
        .eq("email", currentUser.email?.toLowerCase() ?? "")
        .eq("is_active", true)
        .maybeSingle(),
    ]);

    setApps(appsData ?? []);
    if (purchasesError && !isMissingMapTourPurchasesTable(purchasesError)) {
      setError(
        purchasesError.message ||
          "Map Tour credits could not be loaded. Please refresh the dashboard.",
      );
    } else {
      setPurchases(
        isMissingMapTourPurchasesTable(purchasesError) ? [] : purchasesData ?? [],
      );
    }
    setIsAdmin(Boolean(adminRecord));
    setLoading(false);
  }

  useEffect(() => {
    document.title = "Dashboard | LocalMapr";
    // On a successful checkout return, the checkout effect below owns the
    // reload so the freshly synced credit is not clobbered by a racing read.
    if (searchParams.get("checkout") !== "success") {
      void loadDashboard();
    }
  }, []);

  useEffect(() => {
    if (searchParams.get("created")) {
      setMessage("Draft map app created.");
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const checkout = searchParams.get("checkout");

    if (checkout === "success") {
      const sessionId = searchParams.get("session_id");
      const credit = searchParams.get("credit");
      const clearCheckoutParams = () => {
        const next = new URLSearchParams(searchParams);
        next.delete("checkout");
        next.delete("credit");
        next.delete("session_id");
        setSearchParams(next, { replace: true });
      };

      setMessage(
        credit === "tour"
          ? "Checkout completed. Updating your Map Tour credits..."
          : "Checkout completed.",
      );

      void (async () => {
        if (credit !== "tour") {
          await loadDashboard();
          clearCheckoutParams();
          setMessage("Checkout completed.");
          return;
        }

        if (!sessionId) {
          await loadDashboard();
          clearCheckoutParams();
          setError("Checkout completed, but Stripe did not return a session ID.");
          return;
        }

        try {
          const supabase = createBrowserSupabaseClient();
          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (!session?.access_token) {
            await loadDashboard();
            return;
          }

          const response = await fetch("/api/billing/map-tour-credit-sync", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ sessionId }),
          });
          const payload = await readApiResponse<{
            error?: string;
            purchases?: MapTourPurchase[];
          }>(response, "Map Tour credit could not be synced.");

          if (!response.ok || !payload.purchases) {
            throw new Error(payload.error || "Map Tour credit could not be synced.");
          }

          setPurchases(payload.purchases);
          // Reload the rest of the dashboard from the database. The admin
          // upsert has committed; keep the server-returned credit list so it
          // cannot be replaced by a racing client-side read.
          await loadDashboard({ syncedPurchases: payload.purchases });
          clearCheckoutParams();
          setMessage("Checkout completed. Your Map Tour credits were updated.");
        } catch (syncError) {
          await loadDashboard();
          setError(
            syncError instanceof Error
              ? syncError.message
              : "Map Tour credit could not be synced.",
          );
        }
      })();
    } else if (checkout === "cancelled") {
      const next = new URLSearchParams(searchParams);
      next.delete("checkout");
      next.delete("session_id");
      setSearchParams(next, { replace: true });
      setError("Checkout was cancelled.");
    }
  }, [searchParams, setSearchParams]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    setMessage("");

    const supabase = createBrowserSupabaseClient();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const appType = String(formData.get("app_type") ?? createType);

    if (!user) {
      navigate("/login?next=/dashboard");
      return;
    }

    if (!title) {
      setError("A title is required.");
      setCreating(false);
      return;
    }

    const mapTourApps = apps.filter((app) => app.app_type === "map_tour");
    const unusedTourCredits = getUnusedTourCreditCount(purchases);

    if (
      appType === "map_tour" &&
      !isAdmin &&
      mapTourApps.length >= FREE_MAP_TOUR_LIMIT &&
      unusedTourCredits < 1
    ) {
      setError(
        "Your free Map Tours are already used. Buy a tour credit to create another.",
      );
      setCreating(false);
      return;
    }

    if (appType === "map_tour") {
      try {
        await createMapTourDraft({ description, title, userId: user.id });
        form.reset();
        setCreateType("map_tour");
        setMessage("Draft map app created.");
        setCreating(false);
        await loadDashboard();
      } catch (createError) {
        setError(
          createError instanceof Error
            ? createError.message
            : "Map Tour could not be created.",
        );
        setCreating(false);
      }
      return;
    }

    const slug = `${slugify(title)}-${crypto.randomUUID().slice(0, 8)}`;
    const { error: insertError } = await supabase
      .from("map_apps")
      .insert({
        app_type: appType,
        description: description || null,
        owner_id: user.id,
        slug,
        title,
      })
      .select("id")
      .single();

    if (insertError) {
      setError(insertError.message);
      setCreating(false);
      return;
    }

    form.reset();
    setCreateType("map_tour");
    setMessage("Draft map app created.");
    setCreating(false);
    await loadDashboard();
  }

  async function handleSignOut() {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    navigate("/");
  }

  async function handleDeleteApp(app: MapApp) {
    if (!user) {
      navigate("/login?next=/dashboard");
      return;
    }

    const appType = appTypeLabels[app.app_type] ?? "map app";
    const confirmed = window.confirm(
      `Delete "${app.title}"? This will permanently remove this ${appType} and its share link.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingAppId(app.id);
    setError("");
    setMessage("");

    const supabase = createBrowserSupabaseClient();
    const { error: deleteError } = await supabase
      .from("map_apps")
      .delete()
      .eq("id", app.id)
      .eq("owner_id", user.id);

    if (deleteError) {
      setError(deleteError.message || "Unable to delete map app.");
      setDeletingAppId(null);
      return;
    }

    setApps((current) => current.filter((item) => item.id !== app.id));
    setMessage(`"${app.title}" deleted.`);
    setDeletingAppId(null);
  }

  if (!hasSupabase) {
    return (
      <main className={styles.page}>
        <section className={styles.setup}>
          <h1>Connect Supabase to use the dashboard.</h1>
          <p>
            Add your Supabase environment variables and run the schema in
            `supabase/schema.sql` before creating map apps.
          </p>
          <Link to="/">Back to home</Link>
        </section>
      </main>
    );
  }

  if (loading) {
    return (
      <main className={styles.page}>
        <section className={styles.setup}>
          <h1>Loading workspace...</h1>
          <p>Getting your map apps and account details.</p>
        </section>
      </main>
    );
  }

  const mapTourApps = apps.filter((app) => app.app_type === "map_tour");
  const unusedTourCredits = getUnusedTourCreditCount(purchases);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} to="/">
          <img
            className={styles.brandLogo}
            src="/brand/logo_dark.png"
            alt="LocalMapr"
          />
        </Link>
        <div className={styles.headerActions}>
          <Link className={styles.adminLink} to="/pricing">
            Pricing
          </Link>
          <Link className={styles.adminLink} to="/help">
            Help
          </Link>
          {isAdmin ? (
            <Link className={styles.adminLink} to="/admin">
              Admin
            </Link>
          ) : null}
          <button
            className={styles.ghostButton}
            type="button"
            onClick={handleSignOut}
          >
            Sign out
          </button>
        </div>
      </header>

      <section className={styles.hero}>
        <div>
          <p>Workspace</p>
          <h1>Your map apps</h1>
          <span>{user?.email}</span>
        </div>
        {!isAdmin ? (
          <div className={styles.planPanel}>
            <span>Credits</span>
            <strong>{unusedTourCredits}</strong>
            <p>Buy one-time Map Tour credits after your free tours are used.</p>
            <Link to="/pricing">Buy Map Tour credit</Link>
            <small>
              Map Tour credits: {unusedTourCredits} available. Free Map Tours: {Math.max(0, FREE_MAP_TOUR_LIMIT - mapTourApps.length)} remaining.
            </small>
          </div>
        ) : null}
      </section>

      {message ? <p className={styles.notice}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.grid}>
        <form onSubmit={handleCreate} className={styles.createPanel}>
          <div>
            <p>Create</p>
            <h2>New map app</h2>
          </div>
          <label>
            App name
            <input
              required
              name="title"
              placeholder="Coastal heritage walk"
              type="text"
            />
          </label>
          <label>
            Type
            <select
              value={createType}
              name="app_type"
              onChange={(event) => setCreateType(event.target.value)}
            >
              <option value="map_tour">Map tour</option>
              <option value="local_guide">Local guide</option>
              <option value="field_app">Field app</option>
            </select>
          </label>
          <label>
            Description
            <textarea
              name="description"
              placeholder="A short note for you and collaborators"
              rows={4}
            />
          </label>
          <button disabled={creating} type="submit">
            {creating ? "Creating..." : "Create draft"}
          </button>
          {createType === "map_tour" &&
          !isAdmin &&
          mapTourApps.length >= FREE_MAP_TOUR_LIMIT &&
          unusedTourCredits < 1 ? (
            <Link className={styles.secondaryButton} to="/pricing">
              Buy Map Tour credit
            </Link>
          ) : null}
        </form>

        <section className={styles.appsPanel}>
          <div className={styles.panelHeader}>
            <div>
              <p>Library</p>
              <h2>{apps.length} apps</h2>
            </div>
          </div>

          {apps.length ? (
            <div className={styles.appList}>
              {apps.map((app) => (
                <article className={styles.appItem} key={app.id}>
                  <div>
                    <span>{appTypeLabels[app.app_type] ?? app.app_type}</span>
                    <h3>{app.title}</h3>
                    <p>{app.description || "No description yet."}</p>
                    {app.app_type === "map_tour" ? (
                      <div className={styles.appLinks}>
                        <Link to={`/map-tour/${app.id}`}>Open editor</Link>
                        {app.status === "published" ? (
                          <Link to={`/tour/${app.slug}`} target="_blank" rel="noreferrer">
                            Open public
                          </Link>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className={styles.appMeta}>
                    <strong>{app.status}</strong>
                    <code>/{app.slug}</code>
                    <button
                      type="button"
                      className={styles.deleteAppButton}
                      onClick={() => void handleDeleteApp(app)}
                      disabled={deletingAppId === app.id}
                      aria-label={`Delete ${app.title}`}
                      title="Delete app"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <h3>No map apps yet</h3>
              <p>Create your first draft to start shaping the builder flow.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
