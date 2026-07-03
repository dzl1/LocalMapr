import type {
  RealtimeClientOptions,
  WebSocketLikeConstructor,
} from "@supabase/supabase-js";
import type { Database } from "../../src/lib/database.types";

type ApiRequest = {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  [Symbol.asyncIterator]?: unknown;
};

type ApiResponse = {
  end: (chunk?: string) => void;
  setHeader: (name: string, value: string) => void;
  statusCode: number;
};

const EMAIL_VERIFICATION_REQUIRED_MESSAGE =
  "Please verify your email before signing in. Check your inbox for the confirmation link.";

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

async function readLocalEnvFile() {
  if (cachedFileEnv) {
    return cachedFileEnv;
  }

  try {
    const [{ existsSync, readFileSync }, { resolve }] = await Promise.all([
      import("node:fs"),
      import("node:path"),
    ]);
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

async function getEnv(name: string) {
  return process.env[name] ?? (await readLocalEnvFile())[name] ?? null;
}

function sendJson(response: ApiResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isUserEmailVerified(user?: {
  confirmed_at?: string | null;
  email?: string | null;
  email_confirmed_at?: string | null;
} | null) {
  return Boolean(user?.email && (user.email_confirmed_at || user.confirmed_at));
}

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function getAppBaseUrl(requestUrl?: string) {
  if (requestUrl) {
    try {
      return new URL(requestUrl).origin;
    } catch {
      // Fall through to configured URL when the request URL is unusable.
    }
  }

  const configuredUrl = await getEnv("VITE_APP_URL");

  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  return "http://localhost:3000";
}

async function getRequestOrigin(request: ApiRequest) {
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

async function getSupabaseConfig() {
  const url = await getEnv("VITE_SUPABASE_URL");
  const anonKey = await getEnv("VITE_SUPABASE_ANON_KEY");

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

async function getSupabaseAdminConfig() {
  const publicConfig = await getSupabaseConfig();
  const serviceRoleKey =
    (await getEnv("SUPABASE_SERVICE_ROLE_KEY")) ??
    (await getEnv("SUPABASE_SERVICE_KEY")) ??
    (await getEnv("VITE_SUPABASE_SERVICE_ROLE_KEY"));

  if (!publicConfig || !serviceRoleKey) {
    return null;
  }

  return { ...publicConfig, serviceRoleKey };
}

async function getNodeRealtimeOptions() {
  if (typeof globalThis.WebSocket === "function") {
    return {
      transport: globalThis.WebSocket as unknown as WebSocketLikeConstructor,
    } satisfies Pick<RealtimeClientOptions, "transport">;
  }

  const ws = await import("ws");
  return {
    transport: ws.default as unknown as WebSocketLikeConstructor,
  } satisfies Pick<RealtimeClientOptions, "transport">;
}

function getBearerToken(request: ApiRequest) {
  const value = firstHeaderValue(request.headers.authorization);

  if (!value?.startsWith("Bearer ")) {
    return null;
  }

  return value.slice("Bearer ".length);
}

async function createSupabaseClient(key: string, url: string) {
  const { createClient } = await import("@supabase/supabase-js");

  return createClient<Database, "public", "public">(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: await getNodeRealtimeOptions(),
  });
}

async function getAuthenticatedUser(request: ApiRequest) {
  const token = getBearerToken(request);
  const config = await getSupabaseConfig();

  if (!token || !config) {
    return { error: "Authentication is required.", user: null };
  }

  const supabase = await createSupabaseClient(config.anonKey, config.url);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return { error: error?.message ?? "Authentication is required.", user: null };
  }

  if (!isUserEmailVerified(data.user)) {
    return { error: EMAIL_VERIFICATION_REQUIRED_MESSAGE, user: null };
  }

  return { error: null, user: data.user };
}

async function getAdminClient() {
  const config = await getSupabaseAdminConfig();

  if (!config) {
    return { error: "Supabase admin is not configured.", supabase: null };
  }

  const supabase = await createSupabaseClient(config.serviceRoleKey, config.url);
  return { error: null, supabase };
}

async function createStripeClient() {
  const secretKey = await getEnv("STRIPE_SECRET_KEY");

  if (!secretKey) {
    return null;
  }

  const { default: Stripe } = await import("stripe");

  return new Stripe(secretKey, {
    apiVersion: "2026-05-27.dahlia",
  });
}

async function getStripeConfig() {
  const secretKey = await getEnv("STRIPE_SECRET_KEY");
  const priceId = await getEnv("STRIPE_PRO_PRICE_ID");

  if (!secretKey || !priceId) {
    return null;
  }

  return { priceId, secretKey };
}

export default async function handler(
  request: ApiRequest,
  response: ApiResponse,
) {
  try {
    await handleCheckout(request, response);
  } catch (error) {
    console.error("billing/checkout handler failed:", error);
    sendJson(response, 500, {
      error: errorMessage(error, "Checkout failed unexpectedly."),
    });
  }
}

async function handleCheckout(request: ApiRequest, response: ApiResponse) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const baseUrl = await getRequestOrigin(request);
  const { user, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user) {
    sendJson(response, 401, { error: authError });
    return;
  }

  const { supabase, error: supabaseError } = await getAdminClient();

  if (supabaseError || !supabase) {
    sendJson(response, 500, { error: supabaseError });
    return;
  }

  let stripe;

  try {
    stripe = await createStripeClient();
  } catch (error) {
    sendJson(response, 500, {
      error: errorMessage(error, "Stripe is not configured."),
    });
    return;
  }

  const stripeConfig = await getStripeConfig();

  if (!stripe || !stripeConfig) {
    sendJson(response, 500, { error: "Stripe is not configured." });
    return;
  }

  const { data: profileResult } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  const profile = profileResult as { stripe_customer_id: string | null } | null;

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
