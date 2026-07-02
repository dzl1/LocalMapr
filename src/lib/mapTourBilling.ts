export const FREE_MAP_TOUR_LIMIT = 2;
export const FREE_MAP_TOUR_POINT_LIMIT = 4;
export const PAID_MAP_TOUR_POINT_BLOCK = 100;
export const MAP_TOUR_CREDIT_PRICE_LABEL = "$1";

export type MapTourCreditLike = {
  credit_type: string;
  map_app_id: string | null;
  status: string;
  used_at?: string | null;
  used_for_app_id?: string | null;
};

export function isMissingMapTourPurchasesTable(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const value = error as Record<string, unknown>;
  const code = typeof value.code === "string" ? value.code : "";
  const message = typeof value.message === "string" ? value.message : "";

  return (
    (code === "PGRST205" || code === "42P01") &&
    message.toLowerCase().includes("map_tour_purchases")
  );
}

export function isPaidMapTourCreditStatus(status?: string | null) {
  return status === "paid" || status === "completed";
}

export function getUnusedTourCreditCount(purchases: MapTourCreditLike[]) {
  return purchases.filter(
    (purchase) =>
      purchase.credit_type === "tour" &&
      !purchase.used_at &&
      isPaidMapTourCreditStatus(purchase.status),
  ).length;
}

export function getPointCreditCount(
  purchases: MapTourCreditLike[],
  mapAppId?: string | null,
) {
  if (!mapAppId) {
    return 0;
  }

  return purchases.filter(
    (purchase) =>
      isPaidMapTourCreditStatus(purchase.status) &&
      ((purchase.credit_type === "points" && purchase.map_app_id === mapAppId) ||
        (purchase.credit_type === "tour" &&
          purchase.used_for_app_id === mapAppId)),
  ).length;
}

export function getMapTourPointLimit(
  pointCreditCount: number,
  isAdmin = false,
) {
  if (isAdmin) {
    return Number.POSITIVE_INFINITY;
  }

  return pointCreditCount > 0
    ? pointCreditCount * PAID_MAP_TOUR_POINT_BLOCK
    : FREE_MAP_TOUR_POINT_LIMIT;
}

export function getMapTourPointCount(config: unknown) {
  const value =
    typeof config === "object" && config ? (config as Record<string, unknown>) : {};
  return Array.isArray(value.cards) ? value.cards.length : 0;
}
