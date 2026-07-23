import Stripe from "stripe";
import { getEnv } from "./_utils";

export function createStripeClient() {
  const secretKey = getEnv("STRIPE_SECRET_KEY");

  if (!secretKey) {
    return null;
  }

  return new Stripe(secretKey, {
    apiVersion: "2026-05-27.dahlia",
  });
}
