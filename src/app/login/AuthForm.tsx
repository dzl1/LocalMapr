"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import styles from "./login.module.css";

type Mode = "login" | "signup";

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setMessage("");

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
              emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
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

    router.push("/dashboard");
    router.refresh();
  }

  return (
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

      <form action={handleSubmit} className={styles.form}>
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
  );
}
