import { getMapTourStripeConfig } from "../../src/lib/config";
import { createStripeClient } from "../../src/lib/stripe";
import {
  getAdminClient,
  getAuthenticatedUser,
  getRequestOrigin,
  readRawBody,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../_utils";

type CheckoutPayload = {
  creditType?: string;
  mapAppId?: string;
};

export default async function handler(
  request: ApiRequest,
  response: ApiResponse,
) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const baseUrl = getRequestOrigin(request);
  const { user, error: authError } = await getAuthenticatedUser(request);
  const { supabase, error: supabaseError } = getAdminClient();
  const stripe = createStripeClient();
  const stripeConfig = getMapTourStripeConfig();

  if (authError || !user) {
    sendJson(response, 401, { error: authError });
    return;
  }

  if (supabaseError || !supabase) {
    sendJson(response, 500, { error: supabaseError });
    return;
  }

  if (!stripe || !stripeConfig) {
    sendJson(response, 500, { error: "Map Tour Stripe billing is not configured." });
    return;
  }

  let payload: CheckoutPayload = {};

  try {
    const body = await readRawBody(request);
    payload = JSON.parse(String(body || "{}")) as CheckoutPayload;
  } catch {
    sendJson(response, 400, { error: "Invalid request body." });
    return;
  }

  const creditType = payload.creditType === "points" ? "points" : "tour";
  const mapAppId = String(payload.mapAppId || "").trim() || null;

  if (creditType === "points") {
    if (!mapAppId) {
      sendJson(response, 400, { error: "Map app ID is required for point upgrades." });
      return;
    }

    const { data: app } = await supabase
      .from("map_apps")
      .select("id")
      .eq("id", mapAppId)
      .eq("owner_id", user.id)
      .eq("app_type", "map_tour")
      .maybeSingle();

    if (!app) {
      sendJson(response, 404, { error: "Map tour app was not found." });
      return;
    }
  }

  const { data: profileResult } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  const profile = profileResult as { stripe_customer_id: string | null } | null;

  let customerId = profile?.stripe_customer_id ?? null;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: {
        supabase_user_id: user.id,
      },
    });

    customerId = customer.id;

    await supabase.from("profiles").upsert({
      email: user.email,
      id: user.id,
      stripe_customer_id: customerId,
    });
  }

  const priceId =
    creditType === "tour"
      ? stripeConfig.tourCreditPriceId
      : stripeConfig.pointUpgradePriceId;

  const session = await stripe.checkout.sessions.create({
    allow_promotion_codes: true,
    cancel_url: `${baseUrl}/dashboard?checkout=cancelled`,
    customer: customerId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    metadata: {
      credit_type: creditType,
      map_app_id: mapAppId ?? "",
      supabase_user_id: user.id,
    },
    mode: "payment",
    success_url:
      creditType === "points" && mapAppId
        ? `${baseUrl}/map-tour/${encodeURIComponent(mapAppId)}?checkout=success&credit=points`
        : `${baseUrl}/dashboard?checkout=success&credit=tour`,
  });

  if (!session.url) {
    sendJson(response, 500, { error: "Checkout session is missing a URL." });
    return;
  }

  sendJson(response, 200, { url: session.url });
}
