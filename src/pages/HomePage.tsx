import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import {
  createBrowserSupabaseClient,
  getSupabaseBrowserConfig,
} from "@/lib/supabase/client";
import styles from "@/app/page.module.css";

const appTypes = [
  {
    title: "Map tours",
    copy: "Turn landmarks, field notes, and photos into guided routes people can open from any link.",
    image: "/map-tours-card.png",
    imageAlt: "Map Tours preview showing route stops connected on a map",
    href: "/map-tour",
  },
  {
    title: "Local guides",
    copy: "Publish neighborhood picks, event maps, visitor trails, and pop-up directories without rebuilding from scratch.",
    image: "/local-guides-card.png",
    imageAlt: "Local Guides preview showing places and guide notes",
  },
  {
    title: "Field apps",
    copy: "Collect lightweight place-based stories, observations, and project updates with simple map-first workflows.",
    image: "/field-apps-card.png",
    imageAlt: "Field Maps preview showing capture points and field entries",
  },
];

const steps = [
  "Choose a map app template",
  "Add stops, media, and map layers",
  "Publish a shareable webapp",
];

const metrics = [
  ["3 min", "to draft a route"],
  ["1 link", "to share anywhere"],
  ["0 code", "to launch a map app"],
];

export function HomePage() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!getSupabaseBrowserConfig()) {
      return;
    }

    const supabase = createBrowserSupabaseClient();
    void supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  const workspaceHref = user ? "/dashboard" : "/login";

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="hero-title">
        <header className={styles.nav}>
          <Link className={styles.brand} to="/" aria-label="LocalMapr home">
            <img
              className={styles.brandLogo}
              src="/brand/logo_dark.png"
              alt="LocalMapr"
            />
          </Link>
          <nav className={styles.navLinks} aria-label="Primary navigation">
            <a href="#templates">Templates</a>
            <a href="#workflow">Workflow</a>
            <a href="#sharing">Sharing</a>
          </nav>
          <div className={styles.accountNav}>
            {user?.email ? (
              <span className={styles.accountEmail}>{user.email}</span>
            ) : null}
            <Link className={styles.navCta} to={workspaceHref}>
              {user ? "Dashboard" : "Log in"}
            </Link>
          </div>
        </header>

        <div className={styles.heroContent}>
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>Map-first app builder</p>
            <h1 id="hero-title">Create</h1>
            <p className={styles.heroCopy}>
              LocalMapr (short for Local Mapper) helps you build small,
              shareable web apps for mapping stories, map tours, local guides,
              and place-based projects without starting from a blank canvas.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryAction} to={workspaceHref}>
                {user ? "Open dashboard" : "Start building"}
              </Link>
              <a className={styles.secondaryAction} href="#templates">
                Explore templates
              </a>
            </div>
          </div>

          <div className={styles.heroVisual}>
            <img
              className={styles.heroImage}
              src="/localmapr-hero.png"
              alt="LocalMapr interface showing a map tour builder with numbered stops and publish controls"
            />
          </div>
        </div>
      </section>

      <section className={styles.metrics} aria-label="LocalMapr highlights">
        {metrics.map(([value, label]) => (
          <div className={styles.metric} key={value}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>

      <section className={styles.section} id="templates">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>Templates</p>
          <h2>Launch the kind of map people actually use.</h2>
          <p>
            LocalMapr focuses on compact, purposeful mapping experiences that
            are easy to publish, update, and send around.
          </p>
        </div>

        <div className={styles.templateGrid}>
          {appTypes.map((app) => (
            app.href ? (
              <Link className={`${styles.templateCard} ${styles.templateCardLink}`} key={app.title} to={app.href}>
                <div className={styles.cardMap}>
                  <img className={styles.cardImage} src={app.image} alt={app.imageAlt} />
                </div>
                <h3>{app.title}</h3>
                <p>{app.copy}</p>
              </Link>
            ) : (
              <article className={styles.templateCard} key={app.title}>
                <div className={styles.cardMap}>
                  <img className={styles.cardImage} src={app.image} alt={app.imageAlt} />
                </div>
                <h3>{app.title}</h3>
                <p>{app.copy}</p>
              </article>
            )
          ))}
        </div>
      </section>

      <section className={styles.workflow} id="workflow">
        <div className={styles.workflowCopy}>
          <p className={styles.eyebrow}>Workflow</p>
          <h2>From idea to published map in one focused flow.</h2>
          <p>
            Arrange stops, attach photos or notes, tune the route, then publish
            a responsive webapp with a clean link for visitors, teams, or
            communities.
          </p>
        </div>

        <ol className={styles.steps}>
          {steps.map((step, index) => (
            <li key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {step}
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.shareBand} id="sharing">
        <div>
          <p className={styles.eyebrow}>Sharing</p>
          <h2>Built for links, not lock-in.</h2>
        </div>
        <p>
          Share a finished map app with visitors, collaborators, classes,
          clients, or local communities. Every project is designed to feel
          useful the moment someone opens it.
        </p>
      </section>

      <section className={styles.finalCta} id="start">
        <p className={styles.eyebrow}>Early access</p>
        <h2>Bring your first place-based app to life.</h2>
        <Link className={styles.primaryAction} to={workspaceHref}>
          {user ? "Open dashboard" : "Open workspace"}
        </Link>
      </section>
    </main>
  );
}
