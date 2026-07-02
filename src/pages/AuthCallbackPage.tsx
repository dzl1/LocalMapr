import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  EMAIL_VERIFICATION_REQUIRED_MESSAGE,
  isUserEmailVerified,
} from "@/lib/auth";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import styles from "@/app/dashboard/dashboard.module.css";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const next = searchParams.get("next") ?? "/dashboard";
    const code = searchParams.get("code");
    const supabase = createBrowserSupabaseClient();

    async function completeAuth() {
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) {
          navigate(`/login?error=${encodeURIComponent(error.message)}`, {
            replace: true,
          });
          return;
        }
      }

      const { data } = await supabase.auth.getUser();

      if (!isUserEmailVerified(data.user)) {
        await supabase.auth.signOut();
        navigate(
          `/login?error=${encodeURIComponent(EMAIL_VERIFICATION_REQUIRED_MESSAGE)}`,
          {
            replace: true,
          },
        );
        return;
      }

      navigate(next, { replace: true });
    }

    void completeAuth();
  }, [navigate, searchParams]);

  return (
    <main className={styles.page}>
      <section className={styles.setup}>
        <h1>Finishing sign in...</h1>
        <p>Taking you back to your LocalMapr workspace.</p>
      </section>
    </main>
  );
}
