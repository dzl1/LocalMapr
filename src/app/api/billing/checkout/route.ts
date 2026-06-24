import { NextResponse, type NextRequest } from "next/server";
import { getAppBaseUrl, getStripeConfig } from "@/lib/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createStripeClient } from "@/lib/stripe";

export async function POST(request: NextRequest) {
  const baseUrl = getAppBaseUrl(request.url);
  const supabase = await createServerSupabaseClient();
  const stripe = createStripeClient();
  const stripeConfig = getStripeConfig();

  if (!supabase) {
    return NextResponse.redirect(
      new URL("/dashboard?error=supabase-not-configured", baseUrl),
    );
  }

  if (!stripe || !stripeConfig) {
    return NextResponse.redirect(
      new URL("/dashboard?error=stripe-not-configured", baseUrl),
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/dashboard", baseUrl));
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
    return NextResponse.redirect(
      new URL("/dashboard?error=checkout-session-missing-url", baseUrl),
    );
  }

  return NextResponse.redirect(session.url, 303);
}
