/* eslint-disable @typescript-eslint/no-require-imports */

const EMAIL_VERIFICATION_REQUIRED_MESSAGE =
  "Please verify your email before signing in. Check your inbox for the confirmation link.";

let cachedFileEnv = null;

function parseEnvFile(content) {
  const result = {};

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

  try {
    const { existsSync, readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
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
  } catch {
    // Production providers inject env vars directly; local env files are best effort.
  }

  cachedFileEnv = {};
  return cachedFileEnv;
}

function getEnv(name) {
  return process.env[name] ?? readLocalEnvFile()[name] ?? null;
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function errorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isUserEmailVerified(user) {
  return Boolean(user?.email && (user.email_confirmed_at || user.confirmed_at));
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function getAppBaseUrl(requestUrl) {
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

function getRequestOrigin(request) {
  const host = firstHeaderValue(
    request.headers["x-forwarded-host"] ?? request.headers.host,
  );
  const protocol = firstHeaderValue(
    request.headers["x-forwarded-proto"] ?? "http",
  );

  if (!host) {
    return getAppBaseUrl();
  }

  return getAppBaseUrl(`${protocol}://${host}`);
}

function getSupabaseConfig() {
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

function getSupabaseAdminConfig() {
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

function getNodeRealtimeOptions() {
  if (typeof globalThis.WebSocket === "function") {
    return { transport: globalThis.WebSocket };
  }

  return { transport: require("ws") };
}

function createSupabaseClient(key, url) {
  const { createClient } = require("@supabase/supabase-js");

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: getNodeRealtimeOptions(),
  });
}

function getBearerToken(request) {
  const value = firstHeaderValue(request.headers.authorization);

  if (!value?.startsWith("Bearer ")) {
    return null;
  }

  return value.slice("Bearer ".length);
}

async function getAuthenticatedUser(request) {
  const token = getBearerToken(request);
  const config = getSupabaseConfig();

  if (!token || !config) {
    return { error: "Authentication is required.", user: null };
  }

  const supabase = createSupabaseClient(config.anonKey, config.url);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return { error: error?.message ?? "Authentication is required.", user: null };
  }

  if (!isUserEmailVerified(data.user)) {
    return { error: EMAIL_VERIFICATION_REQUIRED_MESSAGE, user: null };
  }

  return { error: null, user: data.user };
}

function getAdminClient() {
  const config = getSupabaseAdminConfig();

  if (!config) {
    return { error: "Supabase admin is not configured.", supabase: null };
  }

  const supabase = createSupabaseClient(config.serviceRoleKey, config.url);
  return { error: null, supabase };
}

function createStripeClient() {
  const secretKey = getEnv("STRIPE_SECRET_KEY");

  if (!secretKey) {
    return null;
  }

  const Stripe = require("stripe");

  return new Stripe(secretKey, {
    apiVersion: "2026-05-27.dahlia",
  });
}

function getMapTourStripeConfig() {
  const secretKey = getEnv("STRIPE_SECRET_KEY");
  const tourCreditPriceId = getEnv("STRIPE_MAP_TOUR_CREDIT_PRICE_ID");

  if (!secretKey || !tourCreditPriceId) {
    return null;
  }

  return { secretKey, tourCreditPriceId };
}

function getStripeWebhookSecret() {
  return getEnv("STRIPE_WEBHOOK_SECRET");
}

async function assertStripeOneTimePrice(stripe, priceId, envName) {
  const price = await stripe.prices.retrieve(priceId);
  const isRecurring = Boolean(price.recurring) || price.type === "recurring";

  if (!price.active) {
    throw new Error(`${envName} points to an inactive Stripe Price.`);
  }

  if (isRecurring) {
    throw new Error(`${envName} must point to a one-time payment Price.`);
  }

  return price;
}

async function readRawBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

module.exports = {
  assertStripeOneTimePrice,
  createStripeClient,
  errorMessage,
  getAdminClient,
  getEnv,
  getAuthenticatedUser,
  getMapTourStripeConfig,
  getRequestOrigin,
  getStripeWebhookSecret,
  readRawBody,
  sendJson,
};
