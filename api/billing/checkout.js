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

function getBearerToken(request) {
  const value = firstHeaderValue(request.headers.authorization);

  if (!value?.startsWith("Bearer ")) {
    return null;
  }

  return value.slice("Bearer ".length);
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

function getStripeConfig() {
  const secretKey = getEnv("STRIPE_SECRET_KEY");
  const priceId = getEnv("STRIPE_PRO_PRICE_ID");

  if (!secretKey || !priceId) {
    return null;
  }

  return { priceId, secretKey };
}

async function handleCheckout(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const baseUrl = getRequestOrigin(request);
  const { user, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user) {
    sendJson(response, 401, { error: authError });
    return;
  }

  const { supabase, error: supabaseError } = getAdminClient();

  if (supabaseError || !supabase) {
    sendJson(response, 500, { error: supabaseError });
    return;
  }

  let stripe;

  try {
    stripe = createStripeClient();
  } catch (error) {
    sendJson(response, 500, {
      error: errorMessage(error, "Stripe is not configured."),
    });
    return;
  }

  const stripeConfig = getStripeConfig();

  if (!stripe || !stripeConfig) {
    sendJson(response, 500, { error: "Stripe is not configured." });
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  let customerId = profile?.stripe_customer_id ?? null;

  if (!customerId) {
    let customer;

    try {
      customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: {
          supabase_user_id: user.id,
        },
      });
    } catch (error) {
      sendJson(response, 502, {
        error: errorMessage(error, "Stripe customer could not be created."),
      });
      return;
    }

    customerId = customer.id;

    await supabase.from("profiles").upsert({
      email: user.email,
      id: user.id,
      stripe_customer_id: customerId,
    });
  }

  let session;

  try {
    session = await stripe.checkout.sessions.create({
      allow_promotion_codes: true,
      cancel_url: `${baseUrl}/dashboard?checkout=cancelled`,
      customer: customerId,
      line_items: [
        {
          price: stripeConfig.priceId,
          quantity: 1,
        },
      ],
      metadata: {
        supabase_user_id: user.id,
      },
      mode: "subscription",
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
        },
      },
      success_url: `${baseUrl}/dashboard?checkout=success`,
    });
  } catch (error) {
    sendJson(response, 502, {
      error: errorMessage(error, "Stripe checkout could not be started."),
    });
    return;
  }

  if (!session.url) {
    sendJson(response, 500, { error: "Checkout session is missing a URL." });
    return;
  }

  sendJson(response, 200, { url: session.url });
}

module.exports = async function handler(request, response) {
  try {
    await handleCheckout(request, response);
  } catch (error) {
    console.error("billing/checkout handler failed:", error);
    sendJson(response, 500, {
      error: errorMessage(error, "Checkout failed unexpectedly."),
    });
  }
};
