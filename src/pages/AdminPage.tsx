import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  createBrowserSupabaseClient,
  getSupabaseBrowserConfig,
} from "@/lib/supabase/client";
import styles from "@/app/admin/admin.module.css";

type BillingEvent = Database["public"]["Tables"]["billing_events"]["Row"];
type MapApp = Database["public"]["Tables"]["map_apps"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Subscription = Database["public"]["Tables"]["subscriptions"]["Row"];

function formatDate(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function readable(value: string | null | undefined) {
  return value || "Not set";
}

export function AdminPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [mapApps, setMapApps] = useState<MapApp[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [billingEvents, setBillingEvents] = useState<BillingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasSupabase = Boolean(getSupabaseBrowserConfig());

  useEffect(() => {
    document.title = "Admin | LocalMapr";

    async function loadAdmin() {
      if (!hasSupabase) {
        setLoading(false);
        return;
      }

      const supabase = createBrowserSupabaseClient();
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();

      if (!currentUser?.email) {
        navigate("/login?next=/admin", { replace: true });
        return;
      }

      const { data: adminRecord } = await supabase
        .from("super_admins")
        .select("id,email,is_active")
        .eq("email", currentUser.email.toLowerCase())
        .eq("is_active", true)
        .maybeSingle();

      if (!adminRecord) {
        navigate("/dashboard?error=admin-access-required", { replace: true });
        return;
      }

      const [
        { data: profileData, error: profilesError },
        { data: appData, error: appsError },
        { data: subscriptionData, error: subscriptionsError },
        { data: eventData, error: eventsError },
      ] = await Promise.all([
        supabase
          .from("profiles")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("map_apps")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("subscriptions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("billing_events")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

      const loadError =
        profilesError ?? appsError ?? subscriptionsError ?? eventsError;

      if (loadError) {
        setError(loadError.message);
      }

      setUser(currentUser);
      setProfiles(profileData ?? []);
      setMapApps(appData ?? []);
      setSubscriptions(subscriptionData ?? []);
      setBillingEvents(eventData ?? []);
      setLoading(false);
    }

    void loadAdmin();
  }, [hasSupabase, navigate]);

  async function handleSignOut() {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    navigate("/");
  }

  if (!hasSupabase) {
    return (
      <main className={styles.page}>
        <section className={styles.setup}>
          <h1>Connect Supabase to use admin.</h1>
          <p>Admin access depends on Supabase Auth and RLS policies.</p>
          <Link to="/">Back to home</Link>
        </section>
      </main>
    );
  }

  if (loading) {
    return (
      <main className={styles.page}>
        <section className={styles.setup}>
          <h1>Loading admin...</h1>
          <p>Checking access and loading account records.</p>
        </section>
      </main>
    );
  }

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
        <nav className={styles.actions} aria-label="Admin navigation">
          <Link to="/dashboard">Dashboard</Link>
          <button type="button" onClick={handleSignOut}>
            Sign out
          </button>
        </nav>
      </header>

      <section className={styles.hero}>
        <p>Super admin</p>
        <h1>Accounts and billing</h1>
        <span>{user?.email}</span>
      </section>

      {error ? (
        <section className={styles.setup}>
          <h1>Admin data could not load.</h1>
          <p>{error}</p>
        </section>
      ) : null}

      <section className={styles.metrics} aria-label="Admin totals">
        <article>
          <strong>{profiles.length}</strong>
          <span>Accounts</span>
        </article>
        <article>
          <strong>{mapApps.length}</strong>
          <span>Map apps</span>
        </article>
        <article>
          <strong>{subscriptions.length}</strong>
          <span>Subscriptions</span>
        </article>
        <article>
          <strong>{billingEvents.length}</strong>
          <span>Billing events</span>
        </article>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <p>Accounts</p>
          <h2>Latest users</h2>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Plan</th>
                <th>Stripe customer</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.id}>
                  <td>{readable(profile.email)}</td>
                  <td>{profile.subscription_status}</td>
                  <td>{readable(profile.stripe_customer_id)}</td>
                  <td>{formatDate(profile.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <p>Apps</p>
          <h2>Map app records</h2>
        </div>
        <div className={styles.cardGrid}>
          {mapApps.map((app) => (
            <article className={styles.card} key={app.id}>
              <span>{app.app_type}</span>
              <h3>{app.title}</h3>
              <p>{readable(app.description)}</p>
              <code>{app.owner_id}</code>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <p>Billing</p>
          <h2>Subscriptions</h2>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>User</th>
                <th>Price</th>
                <th>Current period end</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((subscription) => (
                <tr key={subscription.id}>
                  <td>{subscription.status}</td>
                  <td>{subscription.user_id}</td>
                  <td>{readable(subscription.price_id)}</td>
                  <td>{formatDate(subscription.current_period_end)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <p>Transactions</p>
          <h2>Stripe billing events</h2>
        </div>
        <div className={styles.eventList}>
          {billingEvents.map((event) => (
            <article className={styles.eventItem} key={event.id}>
              <div>
                <h3>{event.event_type}</h3>
                <p>{formatDate(event.created_at)}</p>
              </div>
              <code>{event.stripe_event_id}</code>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
