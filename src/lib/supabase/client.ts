import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "@/lib/config";
import type { Database } from "@/lib/database.types";

export function createBrowserSupabaseClient() {
  const config = getSupabaseConfig();

  if (!config) {
    throw new Error("Supabase is not configured.");
  }

  return createBrowserClient<Database>(config.url, config.anonKey);
}
