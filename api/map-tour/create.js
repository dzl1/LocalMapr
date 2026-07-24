/* eslint-disable @typescript-eslint/no-require-imports */

const { randomUUID } = require("node:crypto");
const {
  errorMessage,
  getAdminClient,
  getAuthenticatedUser,
  readRawBody,
  sendJson,
} = require("../billing/runtime.js");

const FREE_MAP_TOUR_LIMIT = 2;
const FREE_MAP_TOUR_POINT_LIMIT = 4;
const MAP_TOUR_CREDIT_PRICE_LABEL = "$1";
const defaultCenter = [-35.205, 173.95];
const defaultZoom = 11;
const colors = ["#1f4834", "#2563eb", "#be123c", "#b45309", "#6d28d9"];

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 52);
}

function createDefaultCard(index) {
  return {
    body: "",
    color: colors[index % colors.length],
    hoverText: "",
    id: `tour-card-${Date.now()}-${index}`,
    imageTimerSeconds: 4,
    imageUrls: [],
    lat: defaultCenter[0],
    lng: defaultCenter[1],
    title: `Story point ${index + 1}`,
  };
}

function defaultConfig() {
  return {
    cards: [createDefaultCard(0)],
    center: defaultCenter,
    zoom: defaultZoom,
  };
}

function getMapTourPointCount(config) {
  return Array.isArray(config?.cards) ? config.cards.length : 0;
}

function isMissingMapTourPurchasesTable(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = typeof error?.message === "string" ? error.message : "";

  return (
    (code === "PGRST205" || code === "42P01") &&
    message.toLowerCase().includes("map_tour_purchases")
  );
}

function getUnusedTourCreditCount(purchases) {
  return purchases.filter(
    (purchase) =>
      purchase.credit_type === "tour" &&
      !purchase.used_at &&
      (purchase.status === "paid" || purchase.status === "completed"),
  ).length;
}

async function isSuperAdmin(supabase, email) {
  if (!email) {
    return false;
  }

  const { data } = await supabase
    .from("super_admins")
    .select("id")
    .eq("email", email.toLowerCase())
    .eq("is_active", true)
    .maybeSingle();

  return Boolean(data);
}

async function handleCreateMapTour(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const { user, error: authError } = await getAuthenticatedUser(request);
  const { supabase, error: supabaseError } = getAdminClient();

  if (authError || !user) {
    sendJson(response, 401, { error: authError });
    return;
  }

  if (supabaseError || !supabase) {
    sendJson(response, 500, { error: supabaseError });
    return;
  }

  let payload = {};

  try {
    const body = await readRawBody(request);
    payload = JSON.parse(String(body || "{}"));
  } catch {
    sendJson(response, 400, { error: "Invalid request body." });
    return;
  }

  const title = String(payload.title || "").trim() || "Untitled map story";
  const description = String(payload.description || "").trim() || null;
  const config = payload.config ?? defaultConfig();
  const pointCount = getMapTourPointCount(config);
  let admin = false;

  try {
    admin = await isSuperAdmin(supabase, user.email);
  } catch (error) {
    sendJson(response, 500, {
      error: errorMessage(error, "Could not check admin access."),
    });
    return;
  }

  if (!admin && pointCount > FREE_MAP_TOUR_POINT_LIMIT) {
    sendJson(response, 402, {
      error: `Map Stories can include up to ${FREE_MAP_TOUR_POINT_LIMIT} points.`,
    });
    return;
  }

  if (!admin) {
    const [
      { count: tourCount, error: tourCountError },
      { data: purchases, error: purchasesError },
    ] = await Promise.all([
      supabase
        .from("map_apps")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", user.id)
        .eq("app_type", "map_tour"),
      supabase
        .from("map_tour_purchases")
        .select("credit_type,map_app_id,status,used_at")
        .eq("user_id", user.id),
    ]);

    if (tourCountError) {
      sendJson(response, 500, {
        error: tourCountError.message || "Could not count Map Stories.",
      });
      return;
    }

    if (purchasesError && !isMissingMapTourPurchasesTable(purchasesError)) {
      sendJson(response, 500, {
        error: purchasesError.message || "Could not load Map Story credits.",
      });
      return;
    }

    const safePurchases = isMissingMapTourPurchasesTable(purchasesError)
      ? []
      : purchases ?? [];

    if (
      (tourCount ?? 0) >= FREE_MAP_TOUR_LIMIT &&
      getUnusedTourCreditCount(safePurchases) < 1
    ) {
      sendJson(response, 402, {
        error: `Your ${FREE_MAP_TOUR_LIMIT} free Map Stories are used. Buy a ${MAP_TOUR_CREDIT_PRICE_LABEL} story credit to create another.`,
      });
      return;
    }
  }

  const slugBase = slugify(payload.slug || title || "map-story") || "map-story";
  const { data: inserted, error: insertError } = await supabase
    .from("map_apps")
    .insert({
      app_type: "map_tour",
      config,
      description,
      owner_id: user.id,
      slug: `${slugBase}-${randomUUID().slice(0, 8)}`,
      title,
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    sendJson(response, 400, {
      error: insertError?.message || "Could not create Map Story.",
    });
    return;
  }

  sendJson(response, 200, { app: inserted });
}

module.exports = async function handler(request, response) {
  try {
    await handleCreateMapTour(request, response);
  } catch (error) {
    console.error("map-tour/create handler failed:", error);
    sendJson(response, 500, {
      error: errorMessage(error, "Could not create Map Story."),
    });
  }
};
