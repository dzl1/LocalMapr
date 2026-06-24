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

  if (authError || !user) {
    sendJson(response, 401, { error: authError });
    return;
  }

  if (supabaseError || !supabase) {
    sendJson(response, 500, { error: supabaseError });
    return;
  }

  if (!stripe) {
    sendJson(response, 500, { error: "Stripe is not configured." });
    return;
  }

  const { data: profileResult } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  const profile = profileResult as { stripe_customer_id: string | null } | null;

  if (!profile?.stripe_customer_id) {
    sendJson(response, 400, { error: "No Stripe customer exists yet." });
    return;
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${baseUrl}/dashboard`,
  });

  sendJson(response, 200, { url: portal.url });
}
