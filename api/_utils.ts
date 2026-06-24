import type { IncomingMessage, ServerResponse } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { getAppBaseUrl, getSupabaseConfig } from "../src/lib/config";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/lib/database.types";

export type ApiRequest = IncomingMessage & {
  method?: string;
  headers: IncomingMessage["headers"];
};

export type ApiResponse = ServerResponse;

export function sendJson(
  response: ApiResponse,
  statusCode: number,
  payload: unknown,
) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

export function getRequestOrigin(request: ApiRequest) {
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  const protocol = request.headers["x-forwarded-proto"] ?? "http";
  const normalizedHost = Array.isArray(host) ? host[0] : host;
  const normalizedProtocol = Array.isArray(protocol) ? protocol[0] : protocol;

  if (!normalizedHost) {
    return getAppBaseUrl();
  }

  return getAppBaseUrl(`${normalizedProtocol}://${normalizedHost}`);
}

export function getBearerToken(request: ApiRequest) {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;

  if (!value?.startsWith("Bearer ")) {
    return null;
  }

  return value.slice("Bearer ".length);
}

export async function getAuthenticatedUser(request: ApiRequest) {
  const token = getBearerToken(request);
  const config = getSupabaseConfig();

  if (!token || !config) {
    return { error: "Authentication is required.", user: null };
  }

  const supabase = createClient<Database>(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return { error: error?.message ?? "Authentication is required.", user: null };
  }

  return { error: null, user: data.user };
}

export function getAdminClient() {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return { error: "Supabase admin is not configured.", supabase: null };
  }

  return { error: null, supabase };
}

export async function readRawBody(request: ApiRequest) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}
