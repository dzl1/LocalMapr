import Stripe from "stripe";
import type { Json } from "../../src/lib/database.types";
import { createSupabaseAdminClient } from "../../src/lib/supabase/admin";
import { createStripeClient } from "../../src/lib/stripe";
import {
  readRawBody,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../_utils";

function objectId(
  value:
    | string
    | { id?: string }
    | Stripe.DeletedCustomer
    | Stripe.Customer
    | null,
) {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.id ?? null;
}

function periodEnd(subscription: Stripe.Subscription) {
  const currentPeriodEnd = subscription.items.data[0]?.current_period_end;
  return currentPeriodEnd
    ? new Date(currentPeriodEnd * 1000).toISOString()
    : null;
}

function stringId(value: unknown) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }

  return null;
}

async function userIdForCustomer(customerId: string) {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return null;
  }

  const { data: profileResult } = await supabase
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  const data = profileResult as { id: string } | null;

  return data?.id ?? null;
}

async function recordBillingEvent(event: Stripe.Event) {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return;
  }

  const object = event.data.object as unknown as Record<string, unknown>;
  const customerId = stringId(object.customer);
  const subscriptionId = stringId(object.subscription) ?? stringId(object.id);
  const metadata =
    typeof object.metadata === "object" && object.metadata !== null
      ? (object.metadata as Record<string, unknown>)
      : {};
  const metadataUserId =
    typeof metadata.supabase_user_id === "string"
      ? metadata.supabase_user_id
      : null;
  const userId =
    metadataUserId ?? (customerId ? await userIdForCustomer(customerId) : null);

  await supabase.from("billing_events").upsert(
    {
      event_type: event.type,
      payload: event as unknown as Json,
      stripe_customer_id: customerId,
      stripe_event_id: event.id,
      stripe_subscription_id: subscriptionId,
      user_id: userId,
    },
    { onConflict: "stripe_event_id" },
  );
}

async function syncSubscription(subscription: Stripe.Subscription) {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return;
  }

  const customerId = objectId(subscription.customer);

  if (!customerId) {
    return;
  }

  const userId =
    subscription.metadata.supabase_user_id ??
    (await userIdForCustomer(customerId));

  if (!userId) {
    return;
  }

  const item = subscription.items.data[0];
  const priceId = item?.price.id ?? null;
  const currentPeriodEnd = periodEnd(subscription);

  await supabase.from("subscriptions").upsert(
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

  await supabase
    .from("profiles")
    .update({
      current_period_end: currentPeriodEnd,
      stripe_customer_id: customerId,
      subscription_price_id: priceId,
      subscription_status: subscription.status,
    })
    .eq("id", userId);
}

async function syncCheckoutSession(session: Stripe.Checkout.Session) {
  const supabase = createSupabaseAdminClient();
  const stripe = createStripeClient();

  if (!supabase || !stripe) {
    return;
  }

  const userId = session.metadata?.supabase_user_id;
  const customerId = objectId(session.customer);

  if (userId && customerId) {
    await supabase
      .from("profiles")
      .update({
        stripe_customer_id: customerId,
      })
      .eq("id", userId);
  }

  if (typeof session.subscription === "string") {
    const subscription = await stripe.subscriptions.retrieve(
      session.subscription,
    );
    await syncSubscription(subscription);
  }

  const creditType = session.metadata?.credit_type;

  if (userId && (creditType === "tour" || creditType === "points")) {
    const mapAppId =
      typeof session.metadata?.map_app_id === "string" &&
      session.metadata.map_app_id.trim()
        ? session.metadata.map_app_id.trim()
        : null;
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : null;

    await supabase.from("map_tour_purchases").upsert(
      {
        credit_type: creditType,
        map_app_id: creditType === "points" ? mapAppId : null,
        status: session.payment_status || "completed",
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: paymentIntentId,
        user_id: userId,
      },
      { onConflict: "stripe_checkout_session_id" },
    );
  }
}

export default async function handler(
  request: ApiRequest,
  response: ApiResponse,
) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const stripe = createStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

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

  let event: Stripe.Event;

  try {
    const body = await readRawBody(request);
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook.";
    sendJson(response, 400, { error: message });
    return;
  }

  switch (event.type) {
    case "checkout.session.completed":
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

  sendJson(response, 200, { received: true });
}
