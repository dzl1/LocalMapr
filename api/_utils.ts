import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import Stripe from "stripe";
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

let cachedFileEnv: Record<string, string> | null = null;

function parseEnvFile(content: string) {
  const result: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");

    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function readLocalEnvFile() {
  if (cachedFileEnv) {
    return cachedFileEnv;
  }

  const candidatePaths = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), ".env.local"),
  ];

  for (const filePath of candidatePaths) {
    if (!existsSync(filePath)) {
      continue;
    }

    cachedFileEnv = parseEnvFile(readFileSync(filePath, "utf8"));
    return cachedFileEnv;
  }

  cachedFileEnv = {};
  return cachedFileEnv;
}

function getEnv(name: string) {
  return process.env[name] ?? readLocalEnvFile()[name] ?? null;
}

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
  if (requestUrl) {
    try {
      return new URL(requestUrl).origin;
    } catch {
      // Fall through to configured URL when the request URL is unusable.
    }
  }

  const configuredUrl = getEnv("VITE_APP_URL");

  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  return "http://localhost:3000";
}

export function getSupabaseConfig() {
  const url = getEnv("VITE_SUPABASE_URL");
  const anonKey = getEnv("VITE_SUPABASE_ANON_KEY");

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
    getEnv("SUPABASE_SERVICE_ROLE_KEY") ??
    getEnv("SUPABASE_SERVICE_KEY") ??
    getEnv("VITE_SUPABASE_SERVICE_ROLE_KEY");

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

  return createClient<Database, "public", "public">(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function getStripeSecretKey() {
  return getEnv("STRIPE_SECRET_KEY");
}

export function getStripeConfig() {
  const secretKey = getStripeSecretKey();
  const priceId = getEnv("STRIPE_PRO_PRICE_ID");

  if (!secretKey || !priceId) {
    return null;
  }

  return { priceId, secretKey };
}

export function getMapTourStripeConfig() {
  const secretKey = getStripeSecretKey();
  const tourCreditPriceId = getEnv("STRIPE_MAP_TOUR_CREDIT_PRICE_ID");

  if (!secretKey || !tourCreditPriceId) {
    return null;
  }

  return { secretKey, tourCreditPriceId };
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

  const supabase = createClient<Database, "public", "public">(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
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
