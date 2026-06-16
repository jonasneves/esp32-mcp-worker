import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import type { Env, Props } from "./types";

/** The remote MCP server. Its verbs are the board-reachable subset of the
 *  esp32-loop runtime surface — control + observe over the WiFi relay. BLE/USB
 *  discovery verbs (scan/gatt/detect) have no meaning here: those are bench-local
 *  to the esp32-loop CLI. Each tool proxies through the BoardLink DO. */
export class EspMcp extends McpAgent<Env, {}, Props> {
  server = new McpServer({ name: "esp32-mcp", version: "0.0.1" });

  private board() {
    const id = this.env.BOARD_LINK.idFromName(this.env.BOARD_ID ?? "robot");
    return this.env.BOARD_LINK.get(id);
  }

  private text(v: unknown) {
    return { content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] };
  }

  async init() {
    this.server.registerTool(
      "status",
      {
        description: "Is the board online (currently dialed into the relay)? Returns last-seen + the hello info it announced.",
        inputSchema: {},
      },
      async () => this.text(await this.board().isOnline()),
    );

    this.server.registerTool(
      "telemetry",
      {
        description: "The latest telemetry snapshot the board pushed over its WiFi link (any JSON). Null if it hasn't sent any yet.",
        inputSchema: {},
      },
      async () => this.text(await this.board().getTelemetry()),
    );

    this.server.registerTool(
      "gpio",
      {
        description: "Drive a GPIO pin on the board: set <pin> to level 0 or 1, and await the board's ack. The control half of the loop.",
        inputSchema: { pin: z.number().int().min(0).max(48), level: z.number().int().min(0).max(1) },
      },
      async ({ pin, level }) => this.text(await this.board().sendCommand("gpio", { pin, level })),
    );

    this.server.registerTool(
      "command",
      {
        description: "Send a raw command op to the board firmware and await its ack — for board-specific verbs beyond gpio (e.g. a robot's 'drive'). args is an arbitrary JSON object.",
        inputSchema: { op: z.string(), args: z.record(z.string(), z.any()).optional() },
      },
      async ({ op, args }) => this.text(await this.board().sendCommand(op, args ?? {})),
    );
  }
}
