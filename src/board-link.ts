import { DurableObject } from "cloudflare:workers";
import type { Env, BoardFrame } from "./types";

/** One per board id. Holds the board's single outbound WebSocket (the board
 *  dials in — the Worker can't reach it), keeps the latest telemetry durably,
 *  and exposes an RPC surface the MCP DO calls to drive the board.
 *
 *  The WS is accepted with hibernation, so an idle board costs no DO wall-time;
 *  sending a command wakes it. Command↔ack is correlated by id in memory — safe
 *  because the awaiting RPC call keeps this DO alive across the round-trip. */
export class BoardLink extends DurableObject<Env> {
  private pending = new Map<string, { resolve: (v: BoardFrame) => void; reject: (e: Error) => void }>();

  /** The board's outbound dial-in: GET /link (Upgrade: websocket). Routed here
   *  by the Worker only after the device token checks out. */
  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server); // hibernatable
    await this.ctx.storage.put("lastSeen", Date.now());
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(_ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let frame: BoardFrame;
    try {
      frame = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return; // ignore non-JSON noise
    }
    await this.ctx.storage.put("lastSeen", Date.now());
    if (frame.t === "telemetry") {
      await this.ctx.storage.put("telemetry", { data: frame.data, ts: frame.ts ?? Date.now() });
    } else if (frame.t === "hello") {
      await this.ctx.storage.put("info", { board: frame.board, fw: frame.fw });
    } else if (frame.t === "ack") {
      this.pending.get(frame.id)?.resolve(frame);
      this.pending.delete(frame.id);
    }
  }

  async webSocketClose(): Promise<void> {
    await this.ctx.storage.put("closedAt", Date.now());
  }
  async webSocketError(): Promise<void> {
    await this.ctx.storage.put("closedAt", Date.now());
  }

  // ── RPC surface, called by the MCP DO over a stub ────────────────────────

  async isOnline(): Promise<{ online: boolean; lastSeen: number | null; info: unknown }> {
    return {
      online: this.ctx.getWebSockets().length > 0,
      lastSeen: (await this.ctx.storage.get<number>("lastSeen")) ?? null,
      info: (await this.ctx.storage.get("info")) ?? null,
    };
  }

  async getTelemetry(): Promise<unknown> {
    return (await this.ctx.storage.get("telemetry")) ?? null;
  }

  /** Send a command and await the board's ack. Rejects if the board is offline
   *  or doesn't ack in time — the caller surfaces that as a tool error. */
  async sendCommand(op: string, args: Record<string, unknown>, timeoutMs = 8000): Promise<unknown> {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) throw new Error("board offline — it hasn't dialed into the relay");
    const id = crypto.randomUUID();
    const ack = new Promise<BoardFrame>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`board did not ack '${op}' within ${timeoutMs}ms`));
      }, timeoutMs);
    });
    sockets[0].send(JSON.stringify({ t: "cmd", id, op, ...args }));
    const reply = (await ack) as Extract<BoardFrame, { t: "ack" }>;
    if (!reply.ok) throw new Error(reply.error || `board rejected '${op}'`);
    return reply.result ?? { ok: true };
  }
}
