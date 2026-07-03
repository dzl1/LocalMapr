import type {
  RealtimeClientOptions,
  WebSocketLikeConstructor,
} from "@supabase/supabase-js";
import WebSocket from "ws";

const NodeWebSocket = WebSocket as unknown as WebSocketLikeConstructor;

export const nodeRealtimeOptions = {
  transport: NodeWebSocket,
} satisfies Pick<RealtimeClientOptions, "transport">;
