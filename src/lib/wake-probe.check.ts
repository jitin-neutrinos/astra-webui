// wake-probe.check.ts — R9 behavioral checks for the engine's wake probe.
// Run: npx tsx src/lib/wake-probe.check.ts  (plain node can't resolve ./.ts
// extensionless imports; NOT part of the vite build).
// Minimal global shims FIRST — ws-store touches localStorage at module load.
import { strict as assert } from "node:assert";

type Timer = { id: number; fn: () => void };
const timers: Timer[] = [];
let timerSeq = 1;

(globalThis as any).window = {
  setTimeout: (fn: () => void, _ms: number) => { const id = timerSeq++; timers.push({ id, fn }); return id; },
  clearTimeout: (id: number) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  setInterval: () => 0,
  clearInterval: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};
(globalThis as any).location = { protocol: "https:", pathname: "/c/test", host: "x" };
(globalThis as any).window.location = (globalThis as any).location;
(globalThis as any).document = { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} };
(globalThis as any).sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
(globalThis as any).localStorage = {
  _m: new Map<string, string>(),
  getItem(k: string) { return this._m.get(k) ?? null; },
  setItem(k: string, v: string) { this._m.set(k, v); },
  removeItem(k: string) { this._m.delete(k); },
};

const engine = await import("./ws-engine");
const { __eng } = engine as any;
assert.ok(__eng, "test hook exported");

// fireTimer: run the LAST armed timer (the probe deadline is always armed last).
function fireLastDeadline() {
  assert.ok(timers.length > 0, "a deadline timer is armed");
  const t = timers.splice(timers.findIndex((x) => x.id === timers[timers.length - 1].id), 1)[0];
  t.fn();
}

// 1. No socket → wake dials now (WebSocket undefined; connect() guards hold).
(globalThis as any).WebSocket = class { static CONNECTING = 0; static OPEN = 1; readyState = 0; onopen: any = null; onmessage: any = null; onclose: any = null; close() {} send() {} };
engine.wakeProbe(); // must not throw

// 2. OPEN socket + probe fail → force-close + null for immediate redial.
const sent: string[] = [];
const fakeSock: any = { readyState: 1, send: (d: string) => sent.push(d), close: () => { fakeSock.closed = true; } };
__eng.socket = fakeSock;
engine.wakeProbe();
assert.equal(sent.length, 1, "probe RPC sent");
assert.ok(sent[0].includes("config.get"), "probe is the cheap mtime RPC");
fireLastDeadline(); // 3s deadline wins → done(true)
assert.equal(fakeSock.closed, true, "zombie-OPEN socket force-closed");
assert.equal(__eng.socket, null, "socket nulled for redial");

// 3. Single-flight: a second wake while a probe is in flight is a no-op.
let sendCount = 0;
const sock2: any = { readyState: 1, send: () => { sendCount++; }, close: () => {} };
__eng.socket = sock2;
engine.wakeProbe();
assert.equal(sendCount, 1, "first probe sent");
engine.wakeProbe(); // in-flight guard must swallow this
assert.equal(sendCount, 1, "duplicate wake did NOT send a second probe");
fireLastDeadline(); // settle as failure → close (no-op on the stub)

// 4. Pending reconnect timer + dead socket → timer cancelled, dial now.
__eng.reconnectTimer = window.setTimeout(() => {}, 60_000);
__eng.socket = { readyState: 3 } as any;
const before = timers.length;
engine.wakeProbe();
assert.ok(timers.length < before, "pending backoff timer cancelled");

// 5. R5 prune helper — same run, cheap coverage.
const { bgItemKeysToPrune } = await import("./prune");
const kept = bgItemKeysToPrune(["bg_items_a", "bg_items_b", "other"], new Set(["a"]));
assert.deepEqual(kept, ["bg_items_b"], "only dead-session keys pruned");

console.log("wake-probe.check: all assertions passed");
