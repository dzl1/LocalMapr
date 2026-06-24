import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type BrowserSupabaseClient = ReturnType<typeof createClient<Database>>;

let browserClient: BrowserSupabaseClient | null = null;

export function getSupabaseBrowserConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  try {
    new URL(url);
  } catch {
    return null;
  }

  return { anonKey, url };
}

export function createBrowserSupabaseClient() {
  const config = getSupabaseBrowserConfig();

  if (!config) {
    throw new Error("Supabase is not configured.");
  }

  if (browserClient) {
    return browserClient;
  }

  browserClient = createClient<Database>(config.url, config.anonKey, {
    auth: {
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  return browserClient;
}
