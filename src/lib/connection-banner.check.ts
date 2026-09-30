// Connection banner state machine checks. Run: npx tsx src/lib/connection-banner.check.ts
import { nextConnState, fmtSeconds, RESTORED_MS, bannerVisible, BANNER_AFTER_MS } from "./connection-state.ts";

let failures = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error("FAIL:", msg); }
}

// ws open while previously offline → restored (green confirmation, then dismiss)
ok(nextConnState("offline", { type: "ws-open" }) === "restored", "offline + ws-open → restored");
// upstream reconnecting while browser leg is fine → offline (user-facing truth)
ok(nextConnState("online", { type: "proxy-reconnecting" }) === "offline", "online + proxy-reconnecting → offline");
// upstream back → restored (the green confirmation)
ok(nextConnState("offline", { type: "proxy-online" }) === "restored", "offline + proxy-online → restored");
ok(nextConnState("checking", { type: "proxy-online" }) === "restored", "checking + proxy-online → restored");
// restored auto-dismiss
ok(nextConnState("restored", { type: "restored-timeout" }) === "online", "restored + timeout → online");
ok(nextConnState("offline", { type: "restored-timeout" }) === "offline", "offline + timeout (stale) → offline (no-op)");
// browser leg drops → offline, even mid-restored
ok(nextConnState("restored", { type: "ws-closed" }) === "offline", "restored + ws-closed → offline");
// manual retry flow
ok(nextConnState("offline", { type: "retry-begin" }) === "checking", "offline + retry-begin → checking");
ok(nextConnState("checking", { type: "retry-ok" }) === "restored", "checking + retry-ok → restored");
ok(nextConnState("checking", { type: "retry-fail" }) === "offline", "checking + retry-fail → offline");
// ticks never change state
ok(nextConnState("online", { type: "proxy-online" }) === "online", "online + proxy-online stays online (no re-banner)");
// drop while online, then leg reopens before upstream confirms → online only if it was offline
ok(nextConnState("online", { type: "ws-open" }) === "online", "online + ws-open stays online");

// fmtSeconds: max 2 decimals, trailing zeros trimmed
ok(fmtSeconds(4000) === "4s", "4000ms → 4s");
ok(fmtSeconds(1500) === "1.5s", "1500ms → 1.5s");
ok(fmtSeconds(1234) === "1.23s", "1234ms → 1.23s");
ok(fmtSeconds(0) === "0s", "0ms → 0s");
ok(fmtSeconds(-500) === "0s", "negative clamps to 0s");
ok(RESTORED_MS >= 1500 && RESTORED_MS <= 4000, "restored confirmation lives 1.5-4s");

// Banner chrome: never before 60s down, any non-online state after that.
ok(BANNER_AFTER_MS === 60_000, "banner delay is 60s");
ok(!bannerVisible("online", 120_000), "online never banners");
ok(!bannerVisible("offline", 59_999), "59.999s offline stays hidden");
ok(bannerVisible("offline", 60_000), "60s offline shows");
ok(!bannerVisible("checking", 1_000), "brief checking stays hidden");
ok(bannerVisible("checking", 60_000), "long checking shows");
ok(!bannerVisible("restored", 10_000), "brief restored confirmation stays hidden");
ok(bannerVisible("restored", 70_000), "restored after a long outage still confirms");

if (failures) { console.error(`${failures} check(s) failed`); throw new Error(`${failures} connection-banner check(s) failed`); }
console.log("PASS: connection-banner checks");
