/* eslint-disable @typescript-eslint/no-require-imports */

const {
  createStripeClient,
  errorMessage,
  getAdminClient,
  getAuthenticatedUser,
  readRawBody,
  sendJson,
} = require("./runtime.js");

function objectId(value) {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.id ?? null;
}

function paidCreditStatus(session) {
  if (session.payment_status === "paid") {
    return "paid";
  }

  if (
    session.payment_status === "no_payment_required" &&
    session.status === "complete"
  ) {
    return "completed";
  }

  return null;
}

async function handleCreditSync(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

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

  if (!stripe) {
    sendJson(response, 500, { error: "Stripe is not configured." });
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

  const sessionId = String(payload.sessionId || "").trim();

  if (!sessionId) {
    sendJson(response, 400, { error: "Checkout session ID is required." });
    return;
  }

  let session;

  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (error) {
    sendJson(response, 502, {
      error: errorMessage(error, "Stripe checkout session could not be loaded."),
    });
    return;
  }

  if (
    session.metadata?.supabase_user_id !== user.id ||
    session.metadata?.credit_type !== "tour"
  ) {
    sendJson(response, 403, { error: "Checkout session does not match this user." });
    return;
  }

  const status = paidCreditStatus(session);

  if (!status) {
    sendJson(response, 409, { error: "Checkout session is not paid yet." });
    return;
  }

  const customerId = objectId(session.customer);
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : null;

  if (customerId) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ stripe_customer_id: customerId })
      .eq("id", user.id);

    if (profileError) {
      sendJson(response, 500, {
        error: profileError.message || "Stripe customer could not be recorded.",
      });
      return;
    }
  }

  const { error: upsertError } = await supabase.from("map_tour_purchases").upsert(
    {
      credit_type: "tour",
      map_app_id: null,
      status,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      user_id: user.id,
    },
    { onConflict: "stripe_checkout_session_id" },
  );

  if (upsertError) {
    sendJson(response, 500, {
      error: upsertError.message || "Map Tour credit could not be recorded.",
    });
    return;
  }

  const { data: purchases, error: purchasesError } = await supabase
    .from("map_tour_purchases")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (purchasesError) {
    sendJson(response, 500, {
      error: purchasesError.message || "Map Tour credits could not be loaded.",
    });
    return;
  }

  sendJson(response, 200, { purchases: purchases ?? [] });
}

module.exports = async function handler(request, response) {
  try {
    await handleCreditSync(request, response);
  } catch (error) {
    console.error("billing/map-tour-credit-sync handler failed:", error);
    sendJson(response, 500, {
      error: errorMessage(error, "Credit sync failed unexpectedly."),
    });
  }
};
