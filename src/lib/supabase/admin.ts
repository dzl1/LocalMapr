import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminConfig } from "@/lib/config";
import type { Database } from "@/lib/database.types";

export function createSupabaseAdminClient() {
  const config = getSupabaseAdminConfig();

  if (!config) {
    return null;
  }

  return createClient<Database>(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
