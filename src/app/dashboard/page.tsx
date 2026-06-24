import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getStripeConfig, getSupabaseConfig } from "@/lib/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createMapApp, signOut } from "./actions";
import styles from "./dashboard.module.css";

export const metadata = {
  title: "Dashboard | LocalMapr",
};

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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const hasSupabase = Boolean(getSupabaseConfig());
  const hasStripe = Boolean(getStripeConfig());

  if (!hasSupabase || !supabase) {
    return (
      <main className={styles.page}>
        <section className={styles.setup}>
          <h1>Connect Supabase to use the dashboard.</h1>
          <p>
            Add your Supabase environment variables and run the schema in
            `supabase/schema.sql` before creating map apps.
          </p>
          <Link href="/">Back to home</Link>
        </section>
      </main>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard");
  }

  const [{ data: profile }, { data: apps }, { data: adminRecord }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("map_apps")
      .select("*")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("super_admins")
      .select("id")
      .eq("email", user.email?.toLowerCase() ?? "")
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  const planStatus = profile?.subscription_status ?? "free";
  const isPaid =
    planStatus === "active" || planStatus === "trialing" || planStatus === "past_due";

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
        <div className={styles.headerActions}>
          {adminRecord ? (
            <Link className={styles.adminLink} href="/admin">
              Admin
            </Link>
          ) : null}
          <form action={signOut}>
            <button className={styles.ghostButton} type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className={styles.hero}>
        <div>
          <p>Workspace</p>
          <h1>Your map apps</h1>
          <span>{user.email}</span>
        </div>
        <div className={styles.planPanel}>
          <span>Plan</span>
          <strong>{formatStatus(planStatus)}</strong>
          <p>
            {isPaid
              ? "Your paid workspace is enabled."
              : "Start on the free workspace, then upgrade when you are ready."}
          </p>
          {hasStripe ? (
            <form
              action={isPaid ? "/api/billing/portal" : "/api/billing/checkout"}
              method="post"
            >
              <button type="submit">
                {isPaid ? "Manage billing" : "Upgrade"}
              </button>
            </form>
          ) : (
            <small>Stripe env vars are needed to enable paid plans.</small>
          )}
        </div>
      </section>

      {params.created ? (
        <p className={styles.notice}>Draft map app created.</p>
      ) : null}
      {params.error ? <p className={styles.error}>{params.error}</p> : null}

      <section className={styles.grid}>
        <form action={createMapApp} className={styles.createPanel}>
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
            <select defaultValue="map_tour" name="app_type">
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
          <button type="submit">Create draft</button>
        </form>

        <section className={styles.appsPanel}>
          <div className={styles.panelHeader}>
            <div>
              <p>Library</p>
              <h2>{apps?.length ?? 0} apps</h2>
            </div>
          </div>

          {apps?.length ? (
            <div className={styles.appList}>
              {apps.map((app) => (
                <article className={styles.appItem} key={app.id}>
                  <div>
                    <span>{appTypeLabels[app.app_type] ?? app.app_type}</span>
                    <h3>{app.title}</h3>
                    <p>{app.description || "No description yet."}</p>
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
