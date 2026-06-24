import Stripe from "stripe";
import { getStripeConfig } from "@/lib/config";

export function createStripeClient() {
  const config = getStripeConfig();

  if (!config) {
    return null;
  }

  return new Stripe(config.secretKey, {
    apiVersion: "2026-05-27.dahlia",
  });
}
