// R11: assert-based checks for the streaming-resilience logic. No framework.
// Run: node src/lib/streaming-resilience.check.ts
import {
  nextReconnectDelay, RECONNECT_MAX_MS, RECONNECT_BASE_MS,
  transportSilent, TRANSPORT_SILENCE_MS,
  applyTurnTruth, watchdogAction,
} from "./hermes-ws.ts";

let failures = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error("FAIL:", msg); }
}

// --- R3: backoff schedule math (1s base, 2x steps, 30s cap, ±15% jitter) ---
// jitter(r) models a [0,1] random draw: r=0.5 → ×1.0, r=1 → ×1.15, r=0 → ×0.85.
ok(nextReconnectDelay(0, () => 1) === 1150, "attempt 0, +15% jitter = 1150");
ok(nextReconnectDelay(0, () => 0.5) === 1000, "attempt 0, centered = 1000");
ok(nextReconnectDelay(0, () => 0) === 850, "attempt 0, -15% jitter = 850");
ok(nextReconnectDelay(1, () => 0.5) === 2000, "attempt 1 = 2000");
ok(nextReconnectDelay(4, () => 0.5) === 16000, "attempt 4 = 16000");
ok(nextReconnectDelay(5, () => 0.5) === RECONNECT_MAX_MS, "attempt 5 caps at 30s");
ok(nextReconnectDelay(50, () => 0.5) === RECONNECT_MAX_MS, "attempt 50 still 30s (indefinite retry)");
ok(nextReconnectDelay(50, () => 1) === RECONNECT_MAX_MS, "cap holds at max jitter");
ok(nextReconnectDelay(50, () => 0) === Math.round(RECONNECT_MAX_MS * 0.85), "cap jitters down to 25.5s, never above 30s");
// Every random draw lands inside [0.85x, 1.15x] of raw, clamped to [250, 30000].
for (let i = 0; i < 500; i++) {
  const a = Math.floor(Math.random() * 20);
  const d = nextReconnectDelay(a);
  const raw = Math.min(RECONNECT_BASE_MS * 2 ** a, RECONNECT_MAX_MS);
  ok(d >= Math.min(Math.round(raw * 0.85), RECONNECT_MAX_MS) && d <= Math.min(Math.round(raw * 1.15), RECONNECT_MAX_MS),
    `delay ${d} within jitter band for raw ${raw}`);
}

// --- R4: tick-liveness decision (ticks every 25s; 60s silence = dead) ---
ok(TRANSPORT_SILENCE_MS === 60_000, "silence threshold is 60s");
const t0 = 1_000_000;
ok(!transportSilent(t0, t0 + 59_999), "59.9s since last frame = alive");
ok(transportSilent(t0, t0 + 60_001), "60.001s since last frame = dead transport");
ok(!transportSilent(t0, t0 + 25_000), "a 25s tick always keeps it alive");
ok(transportSilent(t0, t0 + 120_000), "two missed ticks = dead");

// --- R5: running-flag/status → isStreaming mapping ---
ok(applyTurnTruth(true, undefined) === "streaming", "running:true → streaming");
ok(applyTurnTruth(undefined, "streaming") === "streaming", "status:streaming → streaming");
ok(applyTurnTruth(false, "streaming") === "streaming", "running:false but status streaming → streaming (gateway wins)");
ok(applyTurnTruth(false, undefined) === "idle", "running:false → idle");
ok(applyTurnTruth(undefined, "idle") === "idle", "status:idle → idle");
ok(applyTurnTruth(undefined, undefined) === "unknown", "no truth fields → unknown (touch nothing)");
ok(applyTurnTruth(undefined, "weird") === "unknown", "unrecognized status → unknown");

// --- R6: watchdog probe decision table ---
ok(watchdogAction(false, true) === "stay", "probe ok + running → stay streaming");
ok(watchdogAction(false, false) === "finalize", "probe ok + not running → finalize");
ok(watchdogAction(true, true) === "wait", "probe error → wait (never false-kill)");
ok(watchdogAction(true, false) === "wait", "probe error even with running:false → wait");
ok(watchdogAction(false, undefined) === "wait", "reply without running → wait");

if (failures) { console.error(`${failures} check(s) failed`); throw new Error(`${failures} streaming-resilience check(s) failed`); }
console.log("PASS: streaming-resilience checks");
