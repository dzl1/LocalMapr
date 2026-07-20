import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  createBrowserSupabaseClient,
  getSupabaseBrowserConfig,
} from "@/lib/supabase/client";
import {
  EMAIL_VERIFICATION_REQUIRED_MESSAGE,
  isUserEmailVerified,
} from "@/lib/auth";
import styles from "@/app/login/login.module.css";

type Mode = "login" | "signup";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [message, setMessage] = useState(searchParams.get("error") ?? "");
  const [pending, setPending] = useState(false);
  const [resendPending, setResendPending] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const isConfigured = Boolean(getSupabaseBrowserConfig());
  const next = searchParams.get("next") ?? "/dashboard";

  useEffect(() => {
    document.title = "Log in | LocalMapr";

    if (!isConfigured) {
      return;
    }

    const supabase = createBrowserSupabaseClient();
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        return;
      }

      if (!isUserEmailVerified(data.user)) {
        await supabase.auth.signOut();
        setMessage(EMAIL_VERIFICATION_REQUIRED_MESSAGE);
        return;
      }

      navigate(next, { replace: true });
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
      if (result.error.code === "email_not_confirmed") {
        setConfirmationEmail(email);
      }
      setMessage(result.error.message);
      return;
    }

    if (!isUserEmailVerified(result.data.user)) {
      await supabase.auth.signOut();
      setConfirmationEmail(email);
      setMessage(
        mode === "signup"
          ? "If this email is new, check your inbox, junk, or quarantine folder for a confirmation link. If you already have an account, log in instead."
          : EMAIL_VERIFICATION_REQUIRED_MESSAGE,
      );
      return;
    }

    navigate(next);
  }

  async function resendConfirmation() {
    if (!confirmationEmail) {
      return;
    }

    setResendPending(true);
    setMessage("");

    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: confirmationEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    setResendPending(false);
    setMessage(
      error
        ? error.message
        : "Confirmation email resent. Check your inbox, junk, or quarantine folder.",
    );
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
            Create map stories, local guides, and field apps that are stored
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
              {confirmationEmail ? (
                <button
                  className={styles.resendButton}
                  disabled={pending || resendPending}
                  type="button"
                  onClick={() => void resendConfirmation()}
                >
                  {resendPending ? "Resending..." : "Resend confirmation email"}
                </button>
              ) : null}
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
