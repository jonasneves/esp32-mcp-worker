import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { EspMcp } from "./mcp";
import { BoardLink } from "./board-link";
import { handler } from "./handler";

// DO classes must be exported from the entry for the runtime to instantiate them.
export { EspMcp, BoardLink };

// OAuthProvider protects /mcp (the MCP API); everything else — the board's /link
// WSS and the GitHub auth flow — falls through to `handler`.
export default new OAuthProvider({
  apiRoute: "/mcp",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiHandler: EspMcp.serve("/mcp", { binding: "ESP_MCP" }) as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultHandler: handler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
