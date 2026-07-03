import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createClient,
  type SupabaseClient,
  type WebSocketLikeConstructor,
} from "@supabase/supabase-js";
import Stripe from "stripe";
import WebSocket from "ws";
import type { Database } from "../src/lib/database.types";

export type ApiRequest = IncomingMessage & {
  method?: string;
  headers: IncomingMessage["headers"];
};

export type ApiResponse = ServerResponse;

const EMAIL_VERIFICATION_REQUIRED_MESSAGE =
  "Please verify your email before signing in. Check your inbox for the confirmation link.";

type EmailVerificationUser = {
  confirmed_at?: string | null;
  email?: string | null;
  email_confirmed_at?: string | null;
};

function isUserEmailVerified(user?: EmailVerificationUser | null) {
  return Boolean(user?.email && (user.email_confirmed_at || user.confirmed_at));
}

const realtimeTransport = WebSocket as unknown as WebSocketLikeConstructor;

export function sendJson(
  response: ApiResponse,
  statusCode: number,
  payload: unknown,
) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function getAppBaseUrl(requestUrl?: string) {
  const configuredUrl = process.env.VITE_APP_URL;

  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  if (requestUrl) {
    const url = new URL(requestUrl);
    return url.origin;
  }

  return "http://localhost:3000";
}

export function getSupabaseConfig() {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

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

export function getSupabaseAdminConfig() {
  const publicConfig = getSupabaseConfig();
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

  if (!publicConfig || !serviceRoleKey) {
    return null;
  }

  return { ...publicConfig, serviceRoleKey };
}

export function createSupabaseAdminClient():
  | SupabaseClient<Database, "public", "public">
  | null {
  const config = getSupabaseAdminConfig();

  if (!config) {
    return null;
  }

  return createClient<Database, "public">(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      transport: realtimeTransport,
    },
  });
}

function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY ?? null;
}

export function getStripeConfig() {
  const secretKey = getStripeSecretKey();
  const priceId = process.env.STRIPE_PRO_PRICE_ID;

  if (!secretKey || !priceId) {
    return null;
  }

  return { priceId, secretKey };
}

export function getMapTourStripeConfig() {
  const secretKey = getStripeSecretKey();
  const tourCreditPriceId = process.env.STRIPE_MAP_TOUR_CREDIT_PRICE_ID;
  const pointUpgradePriceId = process.env.STRIPE_MAP_POINT_UPGRADE_PRICE_ID;

  if (!secretKey || !tourCreditPriceId || !pointUpgradePriceId) {
    return null;
  }

  return { pointUpgradePriceId, secretKey, tourCreditPriceId };
}

export function createStripeClient() {
  const secretKey = getStripeSecretKey();

  if (!secretKey) {
    return null;
  }

  return new Stripe(secretKey, {
    apiVersion: "2026-05-27.dahlia",
  });
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

  const supabase = createClient<Database, "public">(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      transport: realtimeTransport,
    },
  });
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return { error: error?.message ?? "Authentication is required.", user: null };
  }

  if (!isUserEmailVerified(data.user)) {
    return { error: EMAIL_VERIFICATION_REQUIRED_MESSAGE, user: null };
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
