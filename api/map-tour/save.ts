import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "../../src/lib/database.types";
import type { Database } from "../../src/lib/database.types";
import {
  FREE_MAP_TOUR_POINT_LIMIT,
  getMapTourPointCount,
  getMapTourPointLimit,
  getPointCreditCount,
  isMissingMapTourPurchasesTable,
  MAP_TOUR_CREDIT_PRICE_LABEL,
  PAID_MAP_TOUR_POINT_BLOCK,
} from "../../src/lib/mapTourBilling";
import {
  errorMessage,
  getAdminClient,
  getAuthenticatedUser,
  readRawBody,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../_utils";

type SavePayload = {
  appId?: string;
  config?: Json;
  description?: string | null;
  isPublished?: boolean;
  title?: string;
};

async function isSuperAdmin(
  supabase: SupabaseClient<Database>,
  email?: string | null,
) {
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

export default async function handler(
  request: ApiRequest,
  response: ApiResponse,
) {
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

  let payload: SavePayload = {};

  try {
    const body = await readRawBody(request);
    payload = JSON.parse(String(body || "{}")) as SavePayload;
  } catch {
    sendJson(response, 400, { error: "Invalid request body." });
    return;
  }

  const appId = String(payload.appId || "").trim();

  if (!appId || !payload.config) {
    sendJson(response, 400, { error: "Map Tour app ID and config are required." });
    return;
  }

  const { data: app } = await supabase
    .from("map_apps")
    .select("id,owner_id,app_type,status,published_at")
    .eq("id", appId)
    .eq("owner_id", user.id)
    .eq("app_type", "map_tour")
    .maybeSingle();

  if (!app) {
    sendJson(response, 404, { error: "Map Tour was not found." });
    return;
  }

  let admin = false;

  try {
    admin = await isSuperAdmin(supabase, user.email);
  } catch (error) {
    sendJson(response, 500, {
      error: errorMessage(error, "Could not check admin access."),
    });
    return;
  }

  const { data: purchases, error: purchasesError } = await supabase
    .from("map_tour_purchases")
    .select("credit_type,map_app_id,status,used_for_app_id")
    .eq("user_id", user.id);

  if (purchasesError && !isMissingMapTourPurchasesTable(purchasesError)) {
    sendJson(response, 500, {
      error: purchasesError.message || "Could not load Map Tour credits.",
    });
    return;
  }

  const safePurchases = isMissingMapTourPurchasesTable(purchasesError)
    ? []
    : purchases ?? [];
  const pointCreditCount = getPointCreditCount(safePurchases, appId);
  const pointLimit = getMapTourPointLimit(pointCreditCount, admin);
  const pointCount = getMapTourPointCount(payload.config);

  if (!admin && pointCount > pointLimit) {
    const nextBlock = pointCreditCount > 0 ? PAID_MAP_TOUR_POINT_BLOCK : FREE_MAP_TOUR_POINT_LIMIT;
    sendJson(response, 402, {
      error:
        pointCreditCount > 0
          ? `This Map Tour has ${pointLimit} paid points available. Buy another ${MAP_TOUR_CREDIT_PRICE_LABEL} point credit to add the next ${nextBlock}.`
          : `Free Map Tours can include up to ${FREE_MAP_TOUR_POINT_LIMIT} points. Buy a ${MAP_TOUR_CREDIT_PRICE_LABEL} point credit to unlock ${PAID_MAP_TOUR_POINT_BLOCK}.`,
    });
    return;
  }

  const shouldUpdatePublishState = typeof payload.isPublished === "boolean";
  const nextIsPublished = payload.isPublished ?? app.status === "published";
  const publishedAt = nextIsPublished ? new Date().toISOString() : null;
  const updatePayload: {
    config: Json;
    description: string | null;
    published_at?: string | null;
    status?: string;
    title: string;
  } = {
    config: payload.config,
    description: String(payload.description || "").trim() || null,
    title: String(payload.title || "").trim() || "Untitled map tour",
  };

  if (shouldUpdatePublishState) {
    updatePayload.status = nextIsPublished ? "published" : "draft";
    updatePayload.published_at = publishedAt;
  }

  const { data: updated, error: updateError } = await supabase
    .from("map_apps")
    .update(updatePayload)
    .eq("id", app.id)
    .select("*")
    .single();

  if (updateError || !updated) {
    sendJson(response, 400, {
      error: updateError?.message || "Could not save Map Tour.",
    });
    return;
  }

  sendJson(response, 200, { app: updated });
}
