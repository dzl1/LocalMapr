import type { IncomingMessage, ServerResponse } from "node:http";

type ApiRequest = IncomingMessage & {
  method?: string;
  headers: IncomingMessage["headers"];
};

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function getSupabaseAdminConfig() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  try {
    new URL(url);
  } catch {
    return null;
  }

  return { serviceRoleKey, url };
}

export default async function handler(
  request: ApiRequest,
  response: ServerResponse,
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

  const config = getSupabaseAdminConfig();

  if (!config) {
    sendJson(response, 500, {
      error: "Supabase admin is not configured for public map tours.",
    });
    return;
  }

  const params = new URLSearchParams({
    app_type: "eq.map_tour",
    limit: "1",
    select: "*",
    slug: `eq.${slug}`,
    status: "eq.published",
  });
  const supabaseResponse = await fetch(`${config.url}/rest/v1/map_apps?${params}`, {
    headers: {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`,
    },
  });
  const payload = await supabaseResponse.json().catch(() => null);

  if (!supabaseResponse.ok) {
    sendJson(response, 500, {
      error:
        payload && typeof payload === "object" && "message" in payload
          ? String(payload.message)
          : "Could not load public map tour.",
    });
    return;
  }

  const data = Array.isArray(payload) ? payload[0] : null;

  if (!data) {
    sendJson(response, 404, { error: "This published map tour could not be found." });
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  sendJson(response, 200, { app: data });
}
