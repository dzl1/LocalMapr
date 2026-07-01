import {
  getAdminClient,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../_utils";

export default async function handler(
  request: ApiRequest,
  response: ApiResponse,
) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const requestUrl = new URL(
    request.url ?? "",
    `http://${request.headers.host ?? "localhost"}`,
  );
  const slug = String(requestUrl.searchParams.get("slug") || "").trim();

  if (!slug) {
    sendJson(response, 400, { error: "Map tour slug is required." });
    return;
  }

  const { supabase, error: supabaseError } = getAdminClient();

  if (supabaseError || !supabase) {
    sendJson(response, 500, { error: supabaseError });
    return;
  }

  const { data, error } = await supabase
    .from("map_apps")
    .select("*")
    .eq("slug", slug)
    .eq("app_type", "map_tour")
    .eq("status", "published")
    .maybeSingle();

  if (error) {
    sendJson(response, 500, { error: error.message });
    return;
  }

  if (!data) {
    sendJson(response, 404, { error: "This published map tour could not be found." });
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  sendJson(response, 200, { app: data });
}
