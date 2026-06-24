import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseConfig } from "@/lib/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AuthForm } from "./AuthForm";
import styles from "./login.module.css";

export const metadata = {
  title: "Log in | LocalMapr",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = (await searchParams).next ?? "/dashboard";
  const supabase = await createServerSupabaseClient();

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      redirect(next);
    }
  }

  const isConfigured = Boolean(getSupabaseConfig());

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
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

        <div className={styles.copy}>
          <p>Map app workspace</p>
          <h1>Log in and start building place-based apps.</h1>
          <p>
            Create map tours, local guides, and field apps that are stored
            securely against your account.
          </p>
        </div>

        {isConfigured ? (
          <AuthForm />
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
