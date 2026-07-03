import {
  createStripeClient,
  errorMessage,
  getAdminClient,
  getAuthenticatedUser,
  getMapTourStripeConfig,
  getRequestOrigin,
  readRawBody,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../_utils";

type CheckoutPayload = {
  creditType?: string;
};

export default async function handler(
  request: ApiRequest,
  response: ApiResponse,
) {
  try {
    await handleMapTourCheckout(request, response);
  } catch (error) {
    console.error("billing/map-tour-checkout handler failed:", error);
    sendJson(response, 500, {
      error: errorMessage(error, "Checkout failed unexpectedly."),
    });
  }
}

async function handleMapTourCheckout(
  request: ApiRequest,
  response: ApiResponse,
) {
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

  const stripeConfig = getMapTourStripeConfig();

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

  if (payload.creditType && payload.creditType !== "tour") {
    sendJson(response, 400, { error: "Point upgrades are not available." });
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
          price: stripeConfig.tourCreditPriceId,
          quantity: 1,
        },
      ],
      metadata: {
        credit_type: "tour",
        supabase_user_id: user.id,
      },
      mode: "payment",
      success_url: `${baseUrl}/dashboard?checkout=success&credit=tour`,
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
