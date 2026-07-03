import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminConfig } from "../config";
import type { Database } from "../database.types";
import { nodeRealtimeOptions } from "./nodeRealtime";

export function createSupabaseAdminClient() {
  const config = getSupabaseAdminConfig();

  if (!config) {
    return null;
  }

  return createClient<Database, "public", "public">(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: nodeRealtimeOptions,
  });
}
