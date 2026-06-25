import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  createBrowserSupabaseClient,
  getSupabaseBrowserConfig,
} from "@/lib/supabase/client";
import styles from "@/app/dashboard/dashboard.module.css";

type MapApp = Database["public"]["Tables"]["map_apps"]["Row"];
type MapTourPurchase =
  Database["public"]["Tables"]["map_tour_purchases"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const freeMapTourLimit = 1;

const appTypeLabels: Record<string, string> = {
  field_app: "Field app",
  local_guide: "Local guide",
  map_tour: "Map tour",
};

function formatStatus(status?: string | null) {
  if (!status || status === "free") {
    return "Free";
  }

  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 52);
}

async function startBillingFlow(path: string, body?: Record<string, unknown>) {
  const supabase = createBrowserSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Please log in again before managing billing.");
  }

  const response = await fetch(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json()) as { error?: string; url?: string };

  if (!response.ok || !payload.url) {
    throw new Error(payload.error ?? "Billing could not be started.");
  }

  window.location.href = payload.url;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [apps, setApps] = useState<MapApp[]>([]);
  const [purchases, setPurchases] = useState<MapTourPurchase[]>([]);
  const [createType, setCreateType] = useState("map_tour");
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(searchParams.get("error") ?? "");
  const [creating, setCreating] = useState(false);
  const [billingPending, setBillingPending] = useState(false);
  const hasSupabase = Boolean(getSupabaseBrowserConfig());

  async function loadDashboard() {
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

    setUser(currentUser);

    const [
      { data: profileData },
      { data: appsData },
      { data: purchasesData },
      { data: adminRecord },
    ] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("*")
          .eq("id", currentUser.id)
          .maybeSingle(),
        supabase
          .from("map_apps")
          .select("*")
          .eq("owner_id", currentUser.id)
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

    setProfile(profileData);
    setApps(appsData ?? []);
    setPurchases(purchasesData ?? []);
    setIsAdmin(Boolean(adminRecord));
    setLoading(false);
  }

  useEffect(() => {
    document.title = "Dashboard | LocalMapr";
    void loadDashboard();
  }, []);

  useEffect(() => {
    if (searchParams.get("created")) {
      setMessage("Draft map app created.");
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    setMessage("");

    const supabase = createBrowserSupabaseClient();
    const formData = new FormData(event.currentTarget);
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
    const unusedTourCredits = purchases.filter(
      (purchase) => purchase.credit_type === "tour" && !purchase.used_at,
    );

    if (
      appType === "map_tour" &&
      !isAdmin &&
      mapTourApps.length >= freeMapTourLimit &&
      unusedTourCredits.length < 1
    ) {
      setError(
        "Your free Map Tour is already used. Buy a tour credit to create another.",
      );
      setCreating(false);
      return;
    }

    const slug = `${slugify(title)}-${crypto.randomUUID().slice(0, 8)}`;
    const { data: insertedApp, error: insertError } = await supabase
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

    if (
      insertedApp &&
      appType === "map_tour" &&
      !isAdmin &&
      mapTourApps.length >= freeMapTourLimit &&
      unusedTourCredits[0]
    ) {
      const { error: consumeError } = await supabase
        .from("map_tour_purchases")
        .update({
          used_at: new Date().toISOString(),
          used_for_app_id: insertedApp.id,
        })
        .eq("id", unusedTourCredits[0].id)
        .eq("user_id", user.id)
        .is("used_at", null);

      if (consumeError) {
        setError(consumeError.message);
      }
    }

    event.currentTarget.reset();
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

  async function handleBilling(path: string) {
    setBillingPending(true);
    setError("");

    try {
      await startBillingFlow(path);
    } catch (billingError) {
      setError(
        billingError instanceof Error
          ? billingError.message
          : "Billing could not be started.",
      );
      setBillingPending(false);
    }
  }

  async function handleMapTourCheckout(creditType: "tour" | "points") {
    setBillingPending(true);
    setError("");

    try {
      await startBillingFlow("/api/billing/map-tour-checkout", {
        creditType,
      });
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Map Tour checkout could not be started.",
      );
      setBillingPending(false);
    }
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

  const planStatus = profile?.subscription_status ?? "free";
  const isPaid =
    planStatus === "active" ||
    planStatus === "trialing" ||
    planStatus === "past_due";
  const mapTourApps = apps.filter((app) => app.app_type === "map_tour");
  const unusedTourCredits = purchases.filter(
    (purchase) => purchase.credit_type === "tour" && !purchase.used_at,
  ).length;

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
        <div className={styles.planPanel}>
          <span>Plan</span>
          <strong>{formatStatus(planStatus)}</strong>
          <p>
            {isPaid
              ? "Your paid workspace is enabled."
              : "Start on the free workspace, then upgrade when you are ready."}
          </p>
          <button
            disabled={billingPending}
            type="button"
            onClick={() =>
              handleBilling(
                isPaid ? "/api/billing/portal" : "/api/billing/checkout",
              )
            }
          >
            {billingPending
              ? "Opening..."
              : isPaid
                ? "Manage billing"
                : "Upgrade"}
          </button>
          <small>
            Map Tour credits: {unusedTourCredits} available. Free Map Tours: {Math.max(0, freeMapTourLimit - mapTourApps.length)} remaining.
          </small>
        </div>
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
          mapTourApps.length >= freeMapTourLimit &&
          unusedTourCredits < 1 ? (
            <button
              type="button"
              disabled={billingPending}
              className={styles.secondaryButton}
              onClick={() => handleMapTourCheckout("tour")}
            >
              {billingPending ? "Opening..." : "Buy Map Tour credit"}
            </button>
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
                    <strong>{formatStatus(app.status)}</strong>
                    <code>/{app.slug}</code>
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
