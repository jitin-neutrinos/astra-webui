// Connection banner state machine — pure, testable (see connection-banner.check.ts).
//
// Sources of truth, merged:
//   • browser-leg socket (open/closed) — the tab's own wire to the proxy
//   • proxy.status frames — upstream (proxy → gateway) transport state
//   • manual retry — user pressed Retry in the banner
//
// States:
//   online    — fully connected; no banner
//   offline   — down; banner shows live countdown to next auto-retry + Retry button
//   checking  — a manual retry is in flight (button disabled, spinner)
//   restored  — connection just came back; green "Connected" banner auto-dismisses
//               after RESTORED_MS (timer owned by the component)

export type ConnState = "online" | "offline" | "checking" | "restored";

export const RESTORED_MS = 2400;

export type ConnEvent =
  | { type: "ws-open" }
  | { type: "ws-closed" }
  | { type: "proxy-online" }
  | { type: "proxy-reconnecting" }
  | { type: "retry-begin" }
  | { type: "retry-ok" }
  | { type: "retry-fail" }
  | { type: "restored-timeout" };

// Upstream-down + browser-up is still "offline" to the USER (their messages
// can't reach the agent) — the proxy broadcasts its own reconnecting state for
// exactly this reason. And browser-down with upstream-up self-heals via
// auto-reconnect, but the banner must say so while it does.
export function nextConnState(prev: ConnState, ev: ConnEvent): ConnState {
  switch (ev.type) {
    case "ws-open":
      // Browser leg recovered from a visible outage → confirm, then dismiss.
      // (prev online stays online — an already-good connection never re-banners.)
      return prev === "online" ? "online" : "restored";
    case "proxy-online":
      return prev === "online" ? "online" : "restored";
    case "proxy-reconnecting":
    case "ws-closed":
      return "offline";
    case "retry-begin":
      return "checking";
    case "retry-ok":
      return "restored";
    case "retry-fail":
      return "offline";
    case "restored-timeout":
      return prev === "restored" ? "online" : prev;
    default:
      return prev;
  }
}

// Human copy for the countdown, e.g. "4s" — user-facing durations rule:
// max 2 decimals, trailing zeros trimmed.
export function fmtSeconds(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${+s.toFixed(2)}s`;
}
