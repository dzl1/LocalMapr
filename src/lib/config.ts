export function getAppBaseUrl(requestUrl?: string) {
  const configuredUrl = process.env.VITE_APP_URL;

  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  if (requestUrl) {
    const url = new URL(requestUrl);
    return url.origin;
  }

  return "http://localhost:3000";
}

export function getSupabaseConfig() {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  try {
    new URL(url);
  } catch {
    return null;
  }

  return { anonKey, url };
}

export function getSupabaseAdminConfig() {
  const publicConfig = getSupabaseConfig();
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

  if (!publicConfig || !serviceRoleKey) {
    return null;
  }

  return { ...publicConfig, serviceRoleKey };
}

export function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY ?? null;
}

export function getStripeConfig() {
  const secretKey = getStripeSecretKey();
  const priceId = process.env.STRIPE_PRO_PRICE_ID;

  if (!secretKey || !priceId) {
    return null;
  }

  return { priceId, secretKey };
}

export function getMapTourStripeConfig() {
  const secretKey = getStripeSecretKey();
  const tourCreditPriceId = process.env.STRIPE_MAP_TOUR_CREDIT_PRICE_ID;
  const pointUpgradePriceId = process.env.STRIPE_MAP_POINT_UPGRADE_PRICE_ID;

  if (!secretKey || !tourCreditPriceId || !pointUpgradePriceId) {
    return null;
  }

  return { pointUpgradePriceId, secretKey, tourCreditPriceId };
}
