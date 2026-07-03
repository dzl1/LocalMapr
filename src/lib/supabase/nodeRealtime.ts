import type {
  RealtimeClientOptions,
  WebSocketLikeConstructor,
} from "@supabase/supabase-js";

let cachedTransport: WebSocketLikeConstructor | null = null;

function getNodeWebSocketTransport() {
  if (cachedTransport) {
    return cachedTransport;
  }

  if (typeof globalThis.WebSocket === "function") {
    cachedTransport = globalThis.WebSocket as unknown as WebSocketLikeConstructor;
    return cachedTransport;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cachedTransport = require("ws") as WebSocketLikeConstructor;
  return cachedTransport;
}

export function getNodeRealtimeOptions() {
  return {
    transport: getNodeWebSocketTransport(),
  } satisfies Pick<RealtimeClientOptions, "transport">;
}
