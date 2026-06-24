import Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";
import type { Json } from "@/lib/database.types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";

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

  await supabase.from("profiles").update({
    current_period_end: currentPeriodEnd,
    stripe_customer_id: customerId,
    subscription_price_id: priceId,
    subscription_status: subscription.status,
  }).eq("id", userId);
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
    await supabase.from("profiles").update({
      stripe_customer_id: customerId,
    }).eq("id", userId);
  }

  if (typeof session.subscription === "string") {
    const subscription = await stripe.subscriptions.retrieve(
      session.subscription,
    );
    await syncSubscription(subscription);
  }
}

export async function POST(request: NextRequest) {
  const stripe = createStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook is not configured." },
      { status: 500 },
    );
  }

  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing Stripe signature." },
      { status: 400 },
    );
  }

  let event: Stripe.Event;

  try {
    const body = await request.text();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook.";
    return NextResponse.json({ error: message }, { status: 400 });
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

  return NextResponse.json({ received: true });
}
