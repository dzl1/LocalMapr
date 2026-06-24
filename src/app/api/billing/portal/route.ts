import { NextResponse, type NextRequest } from "next/server";
import { getAppBaseUrl } from "@/lib/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createStripeClient } from "@/lib/stripe";

export async function POST(request: NextRequest) {
  const baseUrl = getAppBaseUrl(request.url);
  const supabase = await createServerSupabaseClient();
  const stripe = createStripeClient();

  if (!supabase) {
    return NextResponse.redirect(
      new URL("/dashboard?error=supabase-not-configured", baseUrl),
    );
  }

  if (!stripe) {
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

  if (!profile?.stripe_customer_id) {
    return NextResponse.redirect(
      new URL("/dashboard?error=no-stripe-customer", baseUrl),
    );
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${baseUrl}/dashboard`,
  });

  return NextResponse.redirect(portal.url, 303);
}
