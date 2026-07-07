/* eslint-disable @typescript-eslint/no-require-imports */

const {
  createStripeClient,
  getAdminClient,
  getStripeWebhookSecret,
  readRawBody,
  sendJson,
} = require("../billing/runtime.js");

function objectId(value) {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.id ?? null;
}

function periodEnd(subscription) {
  const currentPeriodEnd = subscription.items.data[0]?.current_period_end;
  return currentPeriodEnd
    ? new Date(currentPeriodEnd * 1000).toISOString()
    : null;
}

function stringId(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object" && "id" in value) {
    return typeof value.id === "string" ? value.id : null;
  }

  return null;
}

function adminClient() {
  const { supabase } = getAdminClient();
  return supabase;
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

async function userIdForCustomer(customerId) {
  const supabase = adminClient();

  if (!supabase) {
    return null;
  }

  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  return data?.id ?? null;
}

async function recordBillingEvent(event) {
  const supabase = adminClient();

  if (!supabase) {
    return;
  }

  const object = event.data.object ?? {};
  const customerId = stringId(object.customer);
  const subscriptionId = stringId(object.subscription) ?? stringId(object.id);
  const metadata =
    typeof object.metadata === "object" && object.metadata !== null
      ? object.metadata
      : {};
  const metadataUserId =
    typeof metadata.supabase_user_id === "string"
      ? metadata.supabase_user_id
      : null;
  const userId =
    metadataUserId ?? (customerId ? await userIdForCustomer(customerId) : null);

  const { error } = await supabase.from("billing_events").upsert(
    {
      event_type: event.type,
      payload: event,
      stripe_customer_id: customerId,
      stripe_event_id: event.id,
      stripe_subscription_id: subscriptionId,
      user_id: userId,
    },
    { onConflict: "stripe_event_id" },
  );

  if (error) {
    throw new Error(error.message || "Billing event could not be recorded.");
  }
}

async function syncSubscription(
  subscription,
  options = { fallbackCustomerId: null, fallbackUserId: null },
) {
  const supabase = adminClient();

  if (!supabase) {
    return;
  }

  const customerId =
    objectId(subscription.customer) ?? options.fallbackCustomerId ?? null;

  if (!customerId) {
    return;
  }

  const userId =
    subscription.metadata.supabase_user_id ??
    options.fallbackUserId ??
    (await userIdForCustomer(customerId));

  if (!userId) {
    return;
  }

  const item = subscription.items.data[0];
  const priceId = item?.price.id ?? null;
  const currentPeriodEnd = periodEnd(subscription);

  const { error: subscriptionError } = await supabase.from("subscriptions").upsert(
    {
      current_period_end: currentPeriodEnd,
      price_id: priceId,
      status: subscription.status,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      user_id: userId,
    },
    { onConflict: "stripe_subscription_id" },
  );

  if (subscriptionError) {
    throw new Error(subscriptionError.message || "Subscription could not be recorded.");
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      current_period_end: currentPeriodEnd,
      stripe_customer_id: customerId,
      subscription_price_id: priceId,
      subscription_status: subscription.status,
    })
    .eq("id", userId);

  if (profileError) {
    throw new Error(profileError.message || "Profile subscription could not be recorded.");
  }
}

async function syncCheckoutSession(session) {
  const supabase = adminClient();
  const stripe = createStripeClient();

  if (!supabase || !stripe) {
    return;
  }

  const userId = session.metadata?.supabase_user_id;
  const customerId = objectId(session.customer);

  if (userId && customerId) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        stripe_customer_id: customerId,
      })
      .eq("id", userId);

    if (profileError) {
      throw new Error(profileError.message || "Stripe customer could not be recorded.");
    }
  }

  if (typeof session.subscription === "string") {
    const subscription = await stripe.subscriptions.retrieve(
      session.subscription,
    );
    await syncSubscription(subscription, {
      fallbackCustomerId: customerId,
      fallbackUserId: userId ?? null,
    });
  }

  const creditType = session.metadata?.credit_type;
  const status = paidCreditStatus(session);

  if (userId && creditType === "tour" && status) {
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : null;

    const { error: purchaseError } = await supabase.from("map_tour_purchases").upsert(
      {
        credit_type: "tour",
        map_app_id: null,
        status,
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: paymentIntentId,
        user_id: userId,
      },
      { onConflict: "stripe_checkout_session_id" },
    );

    if (purchaseError) {
      throw new Error(purchaseError.message || "Map Story credit could not be recorded.");
    }
  }
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const stripe = createStripeClient();
  const webhookSecret = getStripeWebhookSecret();

  if (!stripe || !webhookSecret) {
    sendJson(response, 500, { error: "Stripe webhook is not configured." });
    return;
  }

  const signatureHeader = request.headers["stripe-signature"];
  const signature = Array.isArray(signatureHeader)
    ? signatureHeader[0]
    : signatureHeader;

  if (!signature) {
    sendJson(response, 400, { error: "Missing Stripe signature." });
    return;
  }

  let event;

  try {
    const body = await readRawBody(request);
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook.";
    sendJson(response, 400, { error: message });
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await syncCheckoutSession(event.data.object);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object);
        break;
      default:
        break;
    }

    await recordBillingEvent(event);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Stripe webhook could not be processed.";
    console.error("stripe/webhook handler failed:", error);
    sendJson(response, 500, { error: message });
    return;
  }

  sendJson(response, 200, { received: true });
};
