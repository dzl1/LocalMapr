import { Fragment, useEffect } from "react";
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
    title: "Map Stories",
    status: "Live",
    summary:
      "A Map Story is a shareable story map with ordered points, media, notes, and a public link.",
    bestFor: [
      "Heritage walks, visitor trails, property stories, learning journeys, and project showcases.",
      "Experiences where people should move through places in a planned order.",
    ],
    workflow: [
      "Open Map Stories from the dashboard.",
      "Create a draft and add story points.",
      "Add titles, descriptions, photos, hover text, and location details.",
      "Publish the story and share the public link.",
    ],
    href: "/map-stories",
    cta: "Open Map Stories",
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
      "Use Map Stories when you need a published story map today.",
      "Use Local Guides when you need stops connected by routes today.",
      "Treat Field Apps as an early product area while the capture workflow is being shaped.",
    ],
    cta: "View dashboard",
    href: "/dashboard",
  },
];

const creditNotes = [
  `${FREE_MAP_TOUR_LIMIT} Map Stories are included before paid credits are needed.`,
  `Each paid Map Story credit adds one extra Map Story.`,
  `Map Story credits are one-time purchases currently priced at ${MAP_TOUR_CREDIT_PRICE_LABEL}.`,
  `Map Stories can include up to ${FREE_MAP_TOUR_POINT_LIMIT} points unless your workspace has admin access.`,
];

const mapTourSteps = [
  {
    title: "Create a Map Story",
    steps: [
      "Open Map Stories from the dashboard or the top navigation.",
      `Select New Map Story to start a draft. Your first ${FREE_MAP_TOUR_LIMIT} stories are free; after that each new story uses a one-time credit.`,
      "Give the story a Title and Description in the Story details panel on the left.",
      "Add your story points, then select Save to store your changes.",
      "Tick Published to generate a public link, then copy the Share URL, Embed URL, or Embed code.",
    ],
  },
  {
    title: "Add a story point",
    steps: [
      "Select the + button in the side panel to drop a new point at the current map view.",
      "Or select Place on map, then click the exact spot to position the point.",
      "Each new point is added to the end of the list and numbered automatically.",
      "Select any point in the list to open the Point editor and fill in its details.",
      `Free stories can include up to ${FREE_MAP_TOUR_POINT_LIMIT} points; admin workspaces are unlimited.`,
    ],
  },
];

const pointFields = [
  {
    name: "Title",
    requirement: "Recommended",
    what: "The name of the point shown in the story list and used as the fallback pin label.",
    tip: 'Keep it short and specific, e.g. "Old Harbour Lighthouse".',
  },
  {
    name: "Story text",
    requirement: "Optional",
    what: "The main description for the point — the narrative visitors read when they reach it.",
    tip: 'Use it for history, directions, or context. Empty points show "No story text yet." in the list.',
  },
  {
    name: "Pin popup text",
    requirement: "Optional",
    what: "The short text shown in the popup when someone hovers or taps the map pin.",
    tip: "If left blank, the popup falls back to the point Title. Keep it to a line or two.",
  },
  {
    name: "Image URLs",
    requirement: "Optional",
    what: "One or more image links shown with the point. Use + to add another URL and Remove to delete one.",
    tip: "Use direct links to hosted images (ending in .jpg, .png, etc.). Multiple images rotate as a slideshow.",
  },
  {
    name: "Timer seconds",
    requirement: "Optional",
    what: "How long each image is shown before the slideshow advances to the next one.",
    tip: "Minimum 1 second; defaults to 4. Only relevant when a point has more than one image.",
  },
  {
    name: "Latitude & Longitude",
    requirement: "Required",
    what: "The exact map coordinates of the point. Set automatically when you place or drag the pin.",
    tip: "Fine-tune the numbers directly, or drag the pin on the map to update them.",
  },
  {
    name: "Card colour",
    requirement: "Optional",
    what: "The colour of the numbered pin and the badge shown in the point list.",
    tip: "Use colours to group or distinguish points, for example by theme or area.",
  },
];

const pointActions = [
  "Save stores all point and story changes. It stays disabled until you have unsaved changes.",
  "Move up and Move down change the point's position in the story sequence.",
  "Delete removes the point from the story; Close returns to the story without deleting.",
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
          it, and what happens when you buy a Map Story credit.
        </span>
      </section>

      <section className={styles.productGrid} aria-label="LocalMapr products">
        {products.map((product) => (
          <Fragment key={product.title}>
            <article className={styles.productCard}>
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

            {product.title === "Map Stories" ? (
              <div className={styles.guidePanel} aria-label="Map Stories walkthrough">
                <div className={styles.guideIntro}>
                  <p>Map Stories</p>
                  <h2>Build a Map Story step by step</h2>
                  <span>
                    Create a story, add points on the map, then use the Point
                    editor to add the story, media, and location details for
                    each stop.
                  </span>
                </div>

                <div className={styles.stepColumns}>
                  {mapTourSteps.map((group) => (
                    <div className={styles.stepCard} key={group.title}>
                      <h3>{group.title}</h3>
                      <ol>
                        {group.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>

                <div className={styles.fieldSection}>
                  <h3>Point editor fields</h3>
                  <span className={styles.fieldNote}>
                    Select a point in the story list to open the Point editor.
                    Each field controls how the point appears to visitors.
                  </span>
                  <div className={styles.fieldList}>
                    {pointFields.map((field) => (
                      <div className={styles.fieldRow} key={field.name}>
                        <div className={styles.fieldHead}>
                          <strong>{field.name}</strong>
                          <span className={styles.fieldTag}>{field.requirement}</span>
                        </div>
                        <p className={styles.fieldWhat}>{field.what}</p>
                        <p className={styles.fieldTip}>{field.tip}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={styles.actionSection}>
                  <h3>Point actions</h3>
                  <ul>
                    {pointActions.map((action) => (
                      <li key={action}>{action}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </Fragment>
        ))}
      </section>

      <section className={styles.billingPanel}>
        <div>
          <p>Credits</p>
          <h2>How Map Story credits work</h2>
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
            <strong>Use Map Stories</strong>
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
