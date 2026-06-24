export function getAppBaseUrl(requestUrl?: string) {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  }

  if (requestUrl) {
    const url = new URL(requestUrl);
    return url.origin;
  }

  return "http://localhost:3000";
}

export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return { anonKey, url };
}

export function getSupabaseAdminConfig() {
  const publicConfig = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!publicConfig || !serviceRoleKey) {
    return null;
  }

  return { ...publicConfig, serviceRoleKey };
}

export function getStripeConfig() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRO_PRICE_ID;

  if (!secretKey || !priceId) {
    return null;
  }

  return { priceId, secretKey };
}
