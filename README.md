# esp32-mcp

> **Archived — superseded.** This Worker translated MCP tool calls into a private
> frame protocol the board understood. The successor design deletes the translation
> layer: the ESP32 runs the MCP server *on-chip* (JSON-RPC over its outbound
> WebSocket) and the cloud shrinks to an OAuth front + byte-for-byte relay. Same
> dial-out topology, no protocol of its own to maintain. The deployed Worker and
> domain are gone; the code remains as a reference for the relay/OAuth patterns.

A remote **MCP control plane for an ESP32 over WiFi**. An LLM client (claude.ai,
Claude Desktop, any MCP client) connects to one authenticated endpoint and gets
hands on the board — set a pin, read telemetry, send a command — from anywhere.

The board has WiFi but no public address, and the Worker has no radio, so the
board **dials out**: it opens one WebSocket to the relay and keeps it. The Worker
is a rendezvous, not a poller.

```
LLM client ──MCP (HTTP, OAuth)──► /mcp  ┐
                                        │  Cloudflare Worker
   board ──WSS (device token)──► /link  ┘   ├─ EspMcp        Durable Object (MCP session)
                                            └─ BoardLink     Durable Object (holds the board's WSS)
                                                  │ cmd ↓ / ack ↑ / telemetry ↑
                                                  ▼
                                              ESP32 (robot)
```

This is the **cloud consumer** of [`esp32-loop`](../esp32-loop) — the bench tool
that flashes the board and provisions its WiFi over BLE. esp32-loop owns the
local write→flash→observe→control loop; esp32-mcp re-exposes the *control + observe*
half to remote LLMs once the board is on the network. The verb surface is the
board-reachable subset (no BLE/USB discovery — that's bench-local).

## Tools

| Tool | Does |
|------|------|
| `status` | Is the board dialed in? Last-seen + its `hello` info. |
| `telemetry` | Latest JSON snapshot the board pushed. |
| `gpio(pin, level)` | Set a GPIO pin (0/1), await the board's ack. |
| `command(op, args)` | Any board-specific op (e.g. a robot's `drive`), await ack. |

Generic by design — the board (or a robot layer on top) maps its own semantics
onto `gpio`/`command`.

## Auth

- **Humans** → OAuth, GitHub as the upstream IdP, restricted to
  `ALLOWED_GITHUB_LOGINS`. It controls physical hardware; keep the list tight.
- **The board** → a `DEVICE_TOKEN` on `/link` (a microcontroller can't run a browser
  OAuth flow) — a `wrangler secret`, never committed. Per-board keys are the planned
  next step.

## Wire protocol (DO ↔ board)

Small JSON frames over the WSS link (see `src/types.ts`):

```
board → relay   {"t":"hello","board":"robot","fw":"..."}
                {"t":"telemetry","data":{...},"ts":1234}
                {"t":"ack","id":"<uuid>","ok":true,"result":{...}}
relay → board   {"t":"cmd","id":"<uuid>","op":"gpio","pin":2,"level":1}
```

The board keeps one socket open, pushes telemetry, and acks each `cmd` by `id`.

## Setup

```bash
npm install
wrangler kv namespace create OAUTH_KV     # paste the id into wrangler.jsonc
npm run oauth-app                         # opens GitHub's New OAuth App form, prefilled
cp .dev.vars.example .dev.vars            # fill in the Client ID/secret + a DEVICE_TOKEN
```

`npm run oauth-app` prefills name/homepage/callback; you still generate the client
secret by hand. For a local-dev app, override the callback:
`npm run oauth-app -- --callback http://localhost:8787/callback`. Then:

```bash
npm run dev                               # relay on http://localhost:8787

# in another shell — a simulated board, no hardware needed:
TOKEN=<your DEVICE_TOKEN> npm run fake-board

# point an MCP client at http://localhost:8787/mcp, or inspect it:
npx @modelcontextprotocol/inspector@latest
```

Call `status` → online; `gpio 2 1` → the fake board logs the command and acks.

Deploy:

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put DEVICE_TOKEN
wrangler deploy
```

Point `neves.cloud/esp32-mcp` at the Worker with a route or custom domain.

## Firmware contract

Any board that (1) joins WiFi — esp32-loop's `wifi_provision` example hands creds
over BLE — and (2) opens a WSS to `wss://<host>/link?board=<id>&token=<DEVICE_TOKEN>`
speaking the frames above is controllable. `scripts/fake-board.mjs` is the
reference implementation; the on-chip version is the next build.
