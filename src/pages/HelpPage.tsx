import { useEffect } from "react";
import { Link } from "react-router-dom";
import { SiteHeader } from "@/app/components/SiteHeader";
import {
  FREE_MAP_TOUR_LIMIT,
  FREE_MAP_TOUR_POINT_LIMIT,
  MAP_TOUR_CREDIT_PRICE_LABEL,
} from "@/lib/mapTourBilling";
import styles from "@/app/help/help.module.css";

const products = [
  {
    title: "Map Tours",
    status: "Live",
    summary:
      "A Map Tour is a shareable story map with ordered points, media, notes, and a public link.",
    bestFor: [
      "Heritage walks, visitor trails, property tours, learning journeys, and project showcases.",
      "Experiences where people should move through places in a planned order.",
    ],
    workflow: [
      "Open Map Tours from the dashboard.",
      "Create a draft and add tour points.",
      "Add titles, descriptions, photos, hover text, and location details.",
      "Publish the tour and share the public link.",
    ],
    href: "/map-tour",
    cta: "Open Map Tours",
  },
  {
    title: "Local Guides",
    status: "Live",
    summary:
      "A Local Guide is a route-based guide with connected stops, driving routes, stop notes, and distance labels.",
    bestFor: [
      "Local recommendations, event maps, open-home routes, field visits, and neighborhood guides.",
      "Experiences where users need practical routing between stops.",
    ],
    workflow: [
      "Open Local Guides and create a guide draft.",
      "Add stops on the map or from the sidebar.",
      "Drag stops in the list to reorder the route.",
      "Publish the guide and share or embed the link.",
    ],
    href: "/local-guides",
    cta: "Open Local Guides",
  },
  {
    title: "Field Apps",
    status: "Early",
    summary:
      "Field Apps are intended for lightweight place-based collection workflows and field updates.",
    bestFor: [
      "Community observations, project check-ins, local reporting, and simple mapped submissions.",
      "Workflows where the main job is collecting structured information from locations.",
    ],
    workflow: [
      "Use Map Tours when you need a published story map today.",
      "Use Local Guides when you need stops connected by routes today.",
      "Treat Field Apps as an early product area while the capture workflow is being shaped.",
    ],
    cta: "View dashboard",
    href: "/dashboard",
  },
];

const creditNotes = [
  `${FREE_MAP_TOUR_LIMIT} Map Tours are included before paid credits are needed.`,
  `Each paid Map Tour credit adds one extra Map Tour.`,
  `Map Tour credits are one-time purchases currently priced at ${MAP_TOUR_CREDIT_PRICE_LABEL}.`,
  `Map Tours can include up to ${FREE_MAP_TOUR_POINT_LIMIT} points unless your workspace has admin access.`,
];

export function HelpPage() {
  useEffect(() => {
    document.title = "Help | LocalMapr";
  }, []);

  return (
    <main className={styles.page}>
      <SiteHeader className={styles.helpHeader} />

      <section className={styles.hero}>
        <p>Help</p>
        <h1>Products and workflows</h1>
        <span>
          A practical guide to what each LocalMapr product is for, when to use
          it, and what happens when you buy a Map Tour credit.
        </span>
      </section>

      <section className={styles.productGrid} aria-label="LocalMapr products">
        {products.map((product) => (
          <article className={styles.productCard} key={product.title}>
            <div className={styles.cardHeader}>
              <div>
                <p>{product.status}</p>
                <h2>{product.title}</h2>
              </div>
            </div>
            <p className={styles.summary}>{product.summary}</p>
            <div className={styles.detailGrid}>
              <div>
                <h3>Best For</h3>
                <ul>
                  {product.bestFor.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>How To Use It</h3>
                <ol>
                  {product.workflow.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </div>
            </div>
            <Link className={styles.cardAction} to={product.href}>
              {product.cta}
            </Link>
          </article>
        ))}
      </section>

      <section className={styles.billingPanel}>
        <div>
          <p>Credits</p>
          <h2>How Map Tour credits work</h2>
        </div>
        <ul>
          {creditNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>

      <section className={styles.workflowPanel}>
        <div>
          <p>Choosing</p>
          <h2>Which product should I use?</h2>
        </div>
        <div className={styles.choiceGrid}>
          <div>
            <strong>Use Map Tours</strong>
            <span>when the order of places and story content matters most.</span>
          </div>
          <div>
            <strong>Use Local Guides</strong>
            <span>when visitors need a practical route between stops.</span>
          </div>
          <div>
            <strong>Use Field Apps</strong>
            <span>when you are planning a place-based data collection flow.</span>
          </div>
        </div>
      </section>
    </main>
  );
}
