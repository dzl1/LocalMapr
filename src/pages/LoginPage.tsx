import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  createBrowserSupabaseClient,
  getSupabaseBrowserConfig,
} from "@/lib/supabase/client";
import styles from "@/app/login/login.module.css";

type Mode = "login" | "signup";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const isConfigured = Boolean(getSupabaseBrowserConfig());
  const next = searchParams.get("next") ?? "/dashboard";

  useEffect(() => {
    document.title = "Log in | LocalMapr";

    if (!isConfigured) {
      return;
    }

    const supabase = createBrowserSupabaseClient();
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        navigate(next, { replace: true });
      }
    });
  }, [isConfigured, navigate, next]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const supabase = createBrowserSupabaseClient();

    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
            },
          });

    setPending(false);

    if (result.error) {
      setMessage(result.error.message);
      return;
    }

    if (mode === "signup" && !result.data.session) {
      setMessage("Check your email to confirm your account, then log in.");
      return;
    }

    navigate(next);
  }

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <Link className={styles.brand} to="/">
          <img
            className={styles.brandLogo}
            src="/brand/logo_dark.png"
            alt="LocalMapr"
          />
        </Link>

        <div className={styles.copy}>
          <p>Map app workspace</p>
          <h1>Log in and start building place-based apps.</h1>
          <p>
            Create map tours, local guides, and field apps that are stored
            securely against your account.
          </p>
        </div>

        {isConfigured ? (
          <div className={styles.authPanel}>
            <div className={styles.modeSwitch} aria-label="Authentication mode">
              <button
                className={mode === "login" ? styles.activeMode : undefined}
                type="button"
                onClick={() => setMode("login")}
              >
                Log in
              </button>
              <button
                className={mode === "signup" ? styles.activeMode : undefined}
                type="button"
                onClick={() => setMode("signup")}
              >
                Sign up
              </button>
            </div>

            <form onSubmit={handleSubmit} className={styles.form}>
              <label>
                Email
                <input
                  required
                  autoComplete="email"
                  name="email"
                  placeholder="you@example.com"
                  type="email"
                />
              </label>
              <label>
                Password
                <input
                  required
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  minLength={8}
                  name="password"
                  placeholder="At least 8 characters"
                  type="password"
                />
              </label>
              <button disabled={pending} type="submit">
                {pending
                  ? "Working..."
                  : mode === "login"
                    ? "Log in"
                    : "Create account"}
              </button>
              {message ? <p className={styles.message}>{message}</p> : null}
            </form>
          </div>
        ) : (
          <div className={styles.setupPanel}>
            <h2>Supabase setup needed</h2>
            <p>
              Add your Supabase URL and anon key to `.env.local` to enable
              login and signup.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
