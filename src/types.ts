import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { BoardLink } from "./board-link";

/** Worker bindings + config. `wrangler types` regenerates binding types from
 *  wrangler.jsonc; OAUTH_PROVIDER is injected at runtime by OAuthProvider. */
export interface Env {
  ESP_MCP: DurableObjectNamespace; // the McpAgent (one instance per MCP session)
  BOARD_LINK: DurableObjectNamespace<BoardLink>; // one per board id; holds its WSS
  OAUTH_KV: KVNamespace; // OAuthProvider stores grants/tokens here
  OAUTH_PROVIDER: OAuthHelpers;

  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string; // secret
  ALLOWED_GITHUB_LOGINS: string; // comma list; empty = anyone who can log in
  DEVICE_TOKEN: string; // secret the board presents on /link
  BOARD_ID?: string; // which board a session controls (v0: one board)
}

/** The authenticated human, as it reaches every tool via `this.props`. */
export interface Props extends Record<string, unknown> {
  login: string;
  name: string;
}

// ── DO ↔ board wire protocol: small JSON frames over the outbound WSS link ──
//
//   board → relay   hello      announce + firmware id on connect
//                   telemetry  push a state snapshot (any JSON)
//                   ack        reply to a cmd, by id
//   relay → board   cmd        a verb to run (op + args), correlated by id
//
// The board dials OUT (it has WiFi, the Worker has no radio), so the relay is a
// rendezvous: the board keeps one WSS open, the MCP tools speak through it.

export type BoardFrame =
  | { t: "hello"; board: string; fw?: string }
  | { t: "telemetry"; data: unknown; ts?: number }
  | { t: "ack"; id: string; ok: boolean; result?: unknown; error?: string };

export type RelayFrame = { t: "cmd"; id: string; op: string } & Record<string, unknown>;
