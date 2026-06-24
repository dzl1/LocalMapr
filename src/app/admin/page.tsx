import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseConfig } from "@/lib/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { signOut } from "@/app/dashboard/actions";
import styles from "./admin.module.css";

export const metadata = {
  title: "Admin | LocalMapr",
};

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

export default async function AdminPage() {
  const supabase = await createServerSupabaseClient();

  if (!getSupabaseConfig() || !supabase) {
    return (
      <main className={styles.page}>
        <section className={styles.setup}>
          <h1>Connect Supabase to use admin.</h1>
          <p>Admin access depends on Supabase Auth and RLS policies.</p>
          <Link href="/">Back to home</Link>
        </section>
      </main>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    redirect("/login?next=/admin");
  }

  const { data: adminRecord } = await supabase
    .from("super_admins")
    .select("id,email,is_active")
    .eq("email", user.email.toLowerCase())
    .eq("is_active", true)
    .maybeSingle();

  if (!adminRecord) {
    redirect("/dashboard?error=admin-access-required");
  }

  const [
    { data: profiles },
    { data: mapApps },
    { data: subscriptions },
    { data: billingEvents },
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

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <Image
            className={styles.brandLogo}
            src="/brand/logo_dark.png"
            alt="LocalMapr"
            width={376}
            height={160}
            priority
          />
        </Link>
        <nav className={styles.actions} aria-label="Admin navigation">
          <Link href="/dashboard">Dashboard</Link>
          <form action={signOut}>
            <button type="submit">Sign out</button>
          </form>
        </nav>
      </header>

      <section className={styles.hero}>
        <p>Super admin</p>
        <h1>Accounts and billing</h1>
        <span>{user.email}</span>
      </section>

      <section className={styles.metrics} aria-label="Admin totals">
        <article>
          <strong>{profiles?.length ?? 0}</strong>
          <span>Accounts</span>
        </article>
        <article>
          <strong>{mapApps?.length ?? 0}</strong>
          <span>Map apps</span>
        </article>
        <article>
          <strong>{subscriptions?.length ?? 0}</strong>
          <span>Subscriptions</span>
        </article>
        <article>
          <strong>{billingEvents?.length ?? 0}</strong>
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
              {profiles?.map((profile) => (
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
          {mapApps?.map((app) => (
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
              {subscriptions?.map((subscription) => (
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
          {billingEvents?.map((event) => (
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
