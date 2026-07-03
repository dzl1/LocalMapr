/* eslint-disable @typescript-eslint/no-require-imports */

const {
  createStripeClient,
  errorMessage,
  getAdminClient,
  getAuthenticatedUser,
  getMapTourStripeConfig,
  getRequestOrigin,
  readRawBody,
  sendJson,
} = require("./runtime.js");

async function handleMapTourCheckout(request, response) {
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

  const stripe = createStripeClient();
  const stripeConfig = getMapTourStripeConfig();

  if (!stripe || !stripeConfig) {
    sendJson(response, 500, { error: "Map Tour Stripe billing is not configured." });
    return;
  }

  let payload = {};

  try {
    const body = await readRawBody(request);
    payload = JSON.parse(String(body || "{}"));
  } catch {
    sendJson(response, 400, { error: "Invalid request body." });
    return;
  }

  if (payload.creditType && payload.creditType !== "tour") {
    sendJson(response, 400, { error: "Point upgrades are not available." });
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
          price: stripeConfig.tourCreditPriceId,
          quantity: 1,
        },
      ],
      metadata: {
        credit_type: "tour",
        supabase_user_id: user.id,
      },
      mode: "payment",
      success_url: `${baseUrl}/dashboard?checkout=success&credit=tour&session_id={CHECKOUT_SESSION_ID}`,
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
    await handleMapTourCheckout(request, response);
  } catch (error) {
    console.error("billing/map-tour-checkout handler failed:", error);
    sendJson(response, 500, {
      error: errorMessage(error, "Checkout failed unexpectedly."),
    });
  }
};
