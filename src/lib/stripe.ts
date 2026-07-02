import Stripe from "stripe";
import { getStripeSecretKey } from "./config";

export function createStripeClient() {
  const secretKey = getStripeSecretKey();

  if (!secretKey) {
    return null;
  }

  return new Stripe(secretKey, {
    apiVersion: "2026-05-27.dahlia",
  });
}
