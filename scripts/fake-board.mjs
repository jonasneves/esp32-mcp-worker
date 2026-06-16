// A fake ESP32: dials the relay over WS, announces itself, pushes telemetry
// every 3s, and acks commands (simulating GPIO). Lets you exercise the whole
// cloud path — OAuth, MCP tools, DO relay — before flashing real firmware.
//
//   wrangler dev                       # relay on ws://localhost:8787
//   TOKEN=<your DEVICE_TOKEN> npm run fake-board
//
// Against a deployed Worker:
//   RELAY=wss://esp32-mcp.<acct>.workers.dev TOKEN=... node scripts/fake-board.mjs
//
// Node >= 22 (global WebSocket). No dependencies.

const relay = process.env.RELAY || "ws://localhost:8787";
const token = process.env.TOKEN || "dev-token";
const board = process.env.BOARD || "robot";
const url = `${relay.replace(/\/$/, "")}/link?board=${encodeURIComponent(board)}&token=${encodeURIComponent(token)}`;

const pins = {};
const ws = new WebSocket(url);

ws.addEventListener("open", () => {
  console.log("dialed", url);
  ws.send(JSON.stringify({ t: "hello", board, fw: "fake-board/0.1" }));
  setInterval(() => {
    ws.send(JSON.stringify({ t: "telemetry", data: { uptime_s: Math.floor(process.uptime()), pins }, ts: Date.now() }));
  }, 3000);
});

ws.addEventListener("message", (ev) => {
  let f;
  try { f = JSON.parse(ev.data); } catch { return; }
  if (f.t !== "cmd") return;
  if (f.op === "gpio") {
    pins[f.pin] = f.level;
    console.log(`cmd gpio ${f.pin} <- ${f.level}`);
    ws.send(JSON.stringify({ t: "ack", id: f.id, ok: true, result: { pin: f.pin, level: f.level } }));
  } else {
    console.log("cmd", f.op, f);
    ws.send(JSON.stringify({ t: "ack", id: f.id, ok: true, result: { op: f.op } }));
  }
});

ws.addEventListener("close", () => { console.log("closed"); process.exit(0); });
ws.addEventListener("error", (e) => console.error("error:", e.message || e));
