import { getStripeConfig } from "../../src/lib/config";
import { createStripeClient } from "../../src/lib/stripe";
import {
  getAdminClient,
  getAuthenticatedUser,
  getRequestOrigin,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../_utils";

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
  const stripeConfig = getStripeConfig();

  if (authError || !user) {
    sendJson(response, 401, { error: authError });
    return;
  }

  if (supabaseError || !supabase) {
    sendJson(response, 500, { error: supabaseError });
    return;
  }

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

  const session = await stripe.checkout.sessions.create({
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

  if (!session.url) {
    sendJson(response, 500, { error: "Checkout session is missing a URL." });
    return;
  }

  sendJson(response, 200, { url: session.url });
}
