// Deterministic mock backend for the visual-parity harness. Same data on both
// sides (baseline build vs candidate build) so any rendered difference is the
// build's, not the data's.
export const SID = "s-parity-1";
const T0 = 1790000000; // epoch seconds, fixed

export const sessions = [
  { id: SID, title: "Theme engine parity", preview: "Check the colours", last_reply: "All clear — nothing moved.", source: "webui", model: "glm-5.3", message_count: 9, last_activity_at: T0, is_active: true, pinned: true },
  { id: "s2", title: "Taal gateway port", preview: "session_state next", last_reply: "Ported 267 lines, suite green.", source: "webui", model: "glm-5.3", message_count: 41, last_activity_at: T0 - 3600, is_active: false },
  { id: "s3", title: null, preview: "what is the weather", last_reply: null, source: "telegram", model: "glm-5.3-flash", message_count: 2, last_activity_at: T0 - 86400 * 2, is_active: false },
  { id: "s4", title: "Android gate popup", preview: "teal accent only", last_reply: "Shipped v1.11.10.", source: "android", model: "glm-5.3", message_count: 17, last_activity_at: T0 - 86400 * 9, is_active: false },
];

const md = [
  "## Findings",
  "",
  "Everything **renders the same**. _Emphasis_, ~~strike~~, `inline code`, and a [link](https://example.com).",
  "",
  "- first bullet",
  "- second bullet with `code`",
  "",
  "1. numbered one",
  "2. numbered two",
  "",
  "> A quoted remark that wraps onto more than one line so the quote rule has something to hold.",
  "",
  "| Token | Dark | Light |",
  "| --- | --- | --- |",
  "| accent | #22d3ee | #0369a1 |",
  "| void | #0a0a0f | #f5f2ec |",
  "",
  "```ts",
  "export const answer = (n: number): number => n * 42; // glow stays",
  "```",
].join("\n");

export const messages = [
  { id: "m1", role: "user", content: "Run the parity check and tell me what changed.", timestamp: T0 - 400 },
  { id: "m2", role: "assistant", content: "", reasoning: "The owner wants zero visual change. I should diff computed styles first, then pixels.", tool_calls: [{ id: "call_1", function: { name: "terminal", arguments: JSON.stringify({ command: "node scripts/theme/parity/run.mjs" }) } }], timestamp: T0 - 390 },
  { id: "m3", role: "tool", tool_call_id: "call_1", tool_name: "terminal", content: JSON.stringify({ output: "states: 38\nelements: 91422\ndiff: 0\n", exit_code: 0 }), timestamp: T0 - 380 },
  { id: "m4", role: "assistant", content: md, timestamp: T0 - 370 },
  { id: "m5", role: "user", content: "And the light mode?", timestamp: T0 - 200 },
  { id: "m6", role: "assistant", content: "Same story in light mode: **0 differences** across every state.", timestamp: T0 - 190 },
];

export const modelOptions = { providers: [{ slug: "zai", name: "Z.AI", models: ["glm-5.3", "glm-5.3-flash"], is_current: true }], model: "glm-5.3", provider: "zai" };

export const sessionInfo = { model: "glm-5.3", provider: "zai", reasoning_effort: "low", yolo: false, cwd: "/home/notjitin" };

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Install all /api/* mocks + the WebSocket mock on a Playwright page. */
export async function installMocks(page, { authed = true, wsOffline = false } = {}) {
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    if (u.hostname.includes("googleapis.com") || u.hostname.includes("gstatic.com")) return route.abort(); // fonts: system fallback on both sides
    if (!p.startsWith("/api/")) return route.fallback();
    if (p === "/api/me") return authed ? json(route, { ok: true, user: "jitin" }) : json(route, { ok: false }, 401);
    if (p === "/api/login") return json(route, { ok: true });
    if (p === "/api/logout") return json(route, { ok: true });
    if (p === "/api/diag" || p === "/api/read" || p === "/api/ntfy") return json(route, { ok: true });
    if (p === "/api/hx/sessions") return json(route, { sessions, total: sessions.length });
    if (p === "/api/hx/sessions/search") return json(route, { sessions: sessions.slice(0, 2), total: 2 });
    if (p.startsWith(`/api/hx/sessions/${SID}/messages`)) return json(route, { messages });
    if (p.startsWith("/api/hx/sessions/") && p.endsWith("/messages")) return json(route, { messages: [] });
    if (p.startsWith("/api/hx/sessions/")) return json(route, sessions.find((s) => p.endsWith(s.id)) || {});
    if (p === "/api/hx/model/options") return json(route, modelOptions);
    if (p.startsWith("/api/hx/config")) return json(route, {});
    if (p === "/api/hx/files") return json(route, { path: "/home/jitin", entries: [] });
    if (p === "/api/gates") return json(route, { gates: [] });
    if (p.startsWith("/api/beacon/")) return json(route, {});
    if (p.startsWith("/api/vault/status")) return json(route, { initialized: true, unlocked: false });
    if (p.startsWith("/api/training/")) return json(route, { jobs: [] });
    return json(route, { error: "mock" }, 404);
  });

  await page.routeWebSocket(/\/api\/hx\/ws/, (ws) => {
    if (wsOffline) { ws.close({ code: 1006, reason: "mock offline" }); return; }
    const reply = (id, result) => ws.send(JSON.stringify({ id, result }));
    ws.onMessage((raw) => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.method === "session.create") reply(m.id, { session_id: SID, session_key: SID, info: sessionInfo });
      else if (m.method === "session.resume") reply(m.id, { session_id: SID, session_key: SID, info: sessionInfo, running: false, status: "idle", open_requests: [] });
      else if (m.method === "config.get") reply(m.id, { value: "interrupt" });
      else if (m.id != null) reply(m.id, { ok: true });
    });
  });
}
