import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { readApiResponse } from "@/lib/api";
import {
  createBrowserSupabaseClient,
  getSupabaseBrowserConfig,
} from "@/lib/supabase/client";
import {
  FREE_MAP_TOUR_LIMIT,
  FREE_MAP_TOUR_POINT_LIMIT,
  MAP_TOUR_CREDIT_PRICE_LABEL,
} from "@/lib/mapTourBilling";
import styles from "@/app/pricing/pricing.module.css";

export function PricingPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [error, setError] = useState("");
  const hasSupabase = Boolean(getSupabaseBrowserConfig());

  useEffect(() => {
    document.title = "Pricing | LocalMapr";

    if (!hasSupabase) {
      setLoading(false);
      return;
    }

    const supabase = createBrowserSupabaseClient();
    void supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
  }, [hasSupabase]);

  async function startTourCreditCheckout() {
    if (!user) {
      navigate("/login?next=/pricing", { replace: true });
      return;
    }

    setIsCheckingOut(true);
    setError("");

    try {
      const supabase = createBrowserSupabaseClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please log in again before opening checkout.");
      }

      const response = await fetch("/api/billing/map-tour-checkout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ creditType: "tour" }),
      });
      const payload = await readApiResponse<{ error?: string; url?: string }>(
        response,
        "Could not open Map Tour credit checkout.",
      );

      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Could not open Map Tour credit checkout.");
      }

      window.location.href = payload.url;
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Could not open Map Tour credit checkout.",
      );
      setIsCheckingOut(false);
    }
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
        <nav className={styles.actions} aria-label="Pricing navigation">
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/map-tour">Map Tours</Link>
          <Link to="/help">Help</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <p>Pricing</p>
        <h1>Buy Map Tour credits</h1>
        <span>
          Map Tour credits are one-time purchases. Each credit lets you create
          one extra Map Tour after your free tours are used.
        </span>
      </section>

      <section className={styles.pricingGrid}>
        <article className={styles.priceCard}>
          <div>
            <p>Map Tour credit</p>
            <h2>{MAP_TOUR_CREDIT_PRICE_LABEL}</h2>
            <span>One extra Map Tour</span>
          </div>
          <ul>
            <li>{FREE_MAP_TOUR_LIMIT} Map Tours included before paid credits are needed.</li>
            <li>One credit is consumed when an extra Map Tour is created.</li>
            <li>Each Map Tour can include up to {FREE_MAP_TOUR_POINT_LIMIT} points.</li>
            <li>Credits are tied to your signed-in LocalMapr account.</li>
          </ul>
          {error ? <p className={styles.error}>{error}</p> : null}
          <button
            type="button"
            onClick={() => void startTourCreditCheckout()}
            disabled={loading || isCheckingOut || !hasSupabase}
          >
            {isCheckingOut ? "Opening checkout..." : user ? "Buy credit" : "Sign in to buy credit"}
          </button>
        </article>

        <aside className={styles.helpCard}>
          <p>What Happens Next</p>
          <ol>
            <li>Stripe opens a secure checkout for the one-time credit.</li>
            <li>After payment, you return to LocalMapr automatically.</li>
            <li>Your Map Tour credit total increases by one.</li>
            <li>The next extra Map Tour you create uses that credit.</li>
          </ol>
        </aside>
      </section>
    </main>
  );
}
