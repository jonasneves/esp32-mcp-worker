import type { Env } from "./types";

/** OAuthProvider's defaultHandler: everything that isn't the protected /mcp API.
 *  Two unrelated concerns share it because both are "not the MCP API":
 *
 *  1. /link  — the board's outbound WiFi WebSocket. NO OAuth: a microcontroller
 *     can't run a browser auth flow, so it authenticates with a device token
 *     (a wrangler secret), then we hand the upgrade to its BoardLink DO.
 *  2. /authorize + /callback — the human OAuth flow, GitHub as the upstream IdP,
 *     gated by an allow-list (this controls physical hardware). On success we
 *     call completeAuthorization so the user's identity rides on every tool call. */
export const handler = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // ── 1. board's outbound link ──────────────────────────────────────────
    if (url.pathname === "/link") {
      const board = url.searchParams.get("board") || env.BOARD_ID || "robot";
      const token = url.searchParams.get("token") || request.headers.get("x-device-token") || "";
      if (!env.DEVICE_TOKEN || token !== env.DEVICE_TOKEN) {
        return new Response("bad device token", { status: 401 });
      }
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected a websocket upgrade", { status: 426 });
      }
      return env.BOARD_LINK.get(env.BOARD_LINK.idFromName(board)).fetch(request);
    }

    // ── 2a. start GitHub OAuth ────────────────────────────────────────────
    if (url.pathname === "/authorize") {
      const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      // Round-trip the MCP client's auth request through GitHub's state param.
      const state = btoa(JSON.stringify(oauthReq));
      const gh = new URL("https://github.com/login/oauth/authorize");
      gh.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      gh.searchParams.set("redirect_uri", new URL("/callback", url).href);
      gh.searchParams.set("scope", "read:user");
      gh.searchParams.set("state", state);
      return Response.redirect(gh.href, 302);
    }

    // ── 2b. finish GitHub OAuth ───────────────────────────────────────────
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) return new Response("missing code/state", { status: 400 });
      const oauthReq = JSON.parse(atob(state));

      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: new URL("/callback", url).href,
        }),
      });
      const tok = (await tokenRes.json()) as { access_token?: string };
      if (!tok.access_token) return new Response("GitHub token exchange failed", { status: 401 });

      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          authorization: `Bearer ${tok.access_token}`,
          "user-agent": "esp32-mcp",
          accept: "application/vnd.github+json",
        },
      });
      const user = (await userRes.json()) as { login: string; name: string | null };

      const allow = (env.ALLOWED_GITHUB_LOGINS || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (allow.length && !allow.includes(user.login.toLowerCase())) {
        return new Response(`'${user.login}' is not allowed to control this board`, { status: 403 });
      }

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReq,
        userId: user.login,
        metadata: { label: user.name || user.login },
        scope: oauthReq.scope,
        props: { login: user.login, name: user.name || user.login },
      });
      return Response.redirect(redirectTo, 302);
    }

    if (url.pathname === "/") {
      return new Response(
        "esp32-mcp — remote MCP control plane for an ESP32 over WiFi.\nMCP endpoint: /mcp   ·   board link: /link",
        { headers: { "content-type": "text/plain" } },
      );
    }

    return new Response("Not found", { status: 404 });
  },
};
