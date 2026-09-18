# Astra Web UI — Enhancement Plan

**Repo:** `/home/notjitin/Work/projects/astra-webui`
**Serves:** `astra.jitinnair.com` (cloudflared → `127.0.0.1:3011`), systemd user unit `astra-webui.service`
**Written:** 2026-09-18
**Status of inputs:** every finding below was re-verified against source in this pass. Findings that did not survive verification are marked **REJECTED** and must not be implemented.

---

## 1. Executive summary

### What is actually broken

The reported symptom — "switch to openrouter / inkling free with reasoning effort ultra, send a message, get absolutely nothing back" — is produced by **three independent defects stacked in series**. Each one is individually confirmed in source. All three must be fixed; fixing any one alone changes the symptom without curing it.

1. **The model picker sends garbage.** `onPickModel`'s parameters are transposed between the component that declares the prop and the handler that implements it. Picking provider `openrouter` + model `inkling:free` emits the RPC value `"openrouter --provider inkling:free --session"` — a model named `openrouter` on a provider named `inkling:free`. Both parameters are plain `string`, so TypeScript's structural check passes and the compiler is silent.
2. **The rejection that follows is thrown on the floor.** `prompt.submit` is raw-sent on the socket with a freshly generated RPC id that is never registered in `pendingRpcs`. When Hermes replies `{id, error}`, `onMessage` walks every branch, matches none, and returns. Nothing rejects, nothing logs, nothing renders.
3. **Nothing ever times out.** `isStreaming` is cleared only by `message.complete`, `message.error`, `ws.closed`, or `proxy.status: reconnecting`. A turn that dies upstream while the shared relay socket stays healthy clears none of them. The composer stays disabled behind `disabled={isStreaming}`, the Stop button stays swapped in, and the placeholder reads "Astra is replying…" forever.

That is the whole bug. It is not an OpenRouter problem, not a reasoning-effort problem, and not a provider problem. Those may also be true — but they are currently **unobservable**, and will stay unobservable until (2) and (3) land.

### What the upstream audit got wrong

This plan corrects a substantial amount of upstream material. Implementing agents must read §2.4 and §3 before touching anything.

- **The entire `resilience-approvals` dimension audited the wrong repository.** Every line reference in it points at `/home/notjitin/Work/astra/scratch/impl/v371/core.js` — a 185 KB single-file build of the *old dashboard takeover*, a different project. astra-webui's approvals live in the segment timeline (`chat-segments.ts` + `chat-timeline.tsx`) and share no code with it. Six of that dimension's nine findings are false here; one survives in rewritten form.
- **Four of the seven `responsive-a11y` findings are false.** The login password input already has `<label htmlFor="password">`, `id`, `name`, `autoComplete="current-password"` and `autoFocus`. The show/hide toggle already has a state-dependent `aria-label`. The login error already has `role="alert"`. The WebGL canvas already has `aria-hidden="true"` and a `prefers-reduced-motion` gate. That evidence pass appears to have been produced without reading the source.
- **The reasoning-effort enum claim is backwards.** `VALID_REASONING_EFFORTS = ("minimal","low","medium","high","xhigh","max","ultra")` in `hermes_constants.py:927`, and `parse_reasoning_effort` additionally accepts `none`/`false`/`disabled` → `{"enabled": False}`. **All eight values in the UI's `EFFORTS` array are server-valid.** Do not trim the list. The real defect is the opposite one: there is no value that *clears* a session override once set.
- **The Playwright repro did not reproduce the reported bug.** It never selected openrouter, never selected inkling, never selected ultra. Its `modelPickerFound=true` matched a dead `alert()` stub in the sidebar (`App.tsx:257`), not the real picker. Its "session loss" is a harness artifact: the run used `http://127.0.0.1:3011` while the session cookie is issued `Secure` (`server.mjs:101`), so the cookie was never stored and `/api/me` correctly 401'd.

### Priority frame

Correctness first, token-efficiency a close second. Concretely, in this codebase that means:

- **Be lazy where the diff is the fix.** The transposition is a parameter rename plus a prop-shape change. The watchdog is one `setTimeout` and three `clearTimeout` call sites. The missing `scope: "session"` is one added object key. These are single-line-class changes with large blast radius — take them and move on.
- **Spend real engineering only on three things:** the segment-id namespacing in `chat-segments.ts` (it is a correctness bug at a data-addressing boundary and a sloppy fix mis-routes tool output), the reveal/parse decoupling in `chat-timeline.tsx` (naive fixes here trade a lag bug for a jank bug), and the pre-turn RPC queue settlement in `hermes-ws.ts` (promises that neither resolve nor reject are the hardest class of state divergence to debug later).
- **Do not build what was not asked for.** No abstraction layer over RPC. No state-management library. No reconnection/resume protocol — the relay already has capped backoff and the gateway already replays open approval requests on `session.resume`. No new dependencies; every fix below uses what is already installed.

---

## 2. P0 — the no-response bug

### 2.0 Pre-work: the deployment is stale (must be done first)

`dist/` was built **2026-09-18 15:51**. `src/App.tsx`, `src/components/chat-landing.tsx` and `src/components/chats-panel.tsx` are modified-uncommitted with mtimes 16:01–16:28. `server.mjs:177` serves `/assets` with `cache-control: public, max-age=31536000, immutable`, so a stale hashed bundle is cached in browsers indefinitely.

Also present and untracked: `patch_app.cjs`, `patch_app2.cjs` (ad-hoc string-replace scripts against `src/App.tsx`), plus `src/lib/source-filter.ts` and `src/lib/source-filter.check.ts`.

**Do this before writing any fix:**

```bash
cd /home/notjitin/Work/projects/astra-webui
git diff --stat                      # 3 files, +56/-22 — review before committing
git add -A && git commit -m "wip: pre-fix baseline (uncommitted sidebar/chats edits)"
rm -f patch_app.cjs patch_app2.cjs   # one-shot patch scripts, superseded by the commit
```

Verified: the uncommitted diff does **not** touch `onPickModel`, `onPickEffort` or `submitPrompt`, so it neither causes nor masks the P0 bug. It just needs to be a known tree state so the built artifact corresponds to something.

Deploy ritual after every phase:

```bash
npm run build \
  && systemctl --user restart astra-webui.service \
  && ASTRA_WEBUI_PASSWORD=<from ~/.config/astra-webui/env> scripts/selfcheck.sh http://127.0.0.1:3011
```

Then hard-reload the test browser (Ctrl+Shift+R) — the immutable cache-control will otherwise serve the old bundle and you will "verify" a fix that is not running.

---

### 2.1 P0-A — `onPickModel` argument transposition

**Severity:** critical. **Confidence:** confirmed in source.

#### Root cause

`src/components/composer-controls.tsx:62` declares:

```ts
onPickModel: (provider: string, model: string) => void;
```

and both call sites honour that order:

```ts
// :166-169  provider row
onClick={() => { setMenuProvider(p.slug); onPickModel(p.slug, p.models[0]); }}
// :178      model row
onClick={() => { onPickModel(menuProvider || provider, m); setOpen(false); }}
```

`src/components/chat-landing.tsx:375` implements it the other way round:

```ts
const onPickModel = async (model: string, provider: string) => {
  const prevModel = sessionInfo?.model;
  const prevProv  = sessionInfo?.provider;
  setSessionInfo((prev: any) => ({ ...(prev || {}), model, provider }));
  try {
    await rpc("config.set", { key: "model", value: `${model} --provider ${provider} --session` });
  } catch {
    setSessionInfo((prev: any) => ({ ...(prev || {}), model: prevModel, provider: prevProv }));
  }
};
```

Wired straight through at `chat-landing.tsx:741`. Both parameters are `string`, so the prop assignment type-checks: arity matches, types match, only the *names* are transposed, and names carry no type information.

Consequence for the reported case: selecting provider `openrouter` and model `inkling:free` sends

```
config.set { key: "model", value: "openrouter --provider inkling:free --session" }
```

`parse_model_switch_args` (`hermes_cli/model_switch.py:581`) reads `target="openrouter"`, `explicit_provider="inkling:free"`, `scope="session"`. The provider does not exist; the switch fails.

Two independent corroborations that this is live, not theoretical:
- The `setSessionInfo` optimistic write stores the provider slug under `model`, so the model rows' checkmark test `m === model` (`composer-controls.tsx:177`) can never match after a pick. Nobody has ever seen a model row check itself.
- The sidebar's dead stub (`App.tsx:257`) hardcodes the string `"Model: openrouter / inkling:free (configured)"` — which is almost certainly where the bug report's phrasing came from, not from the real picker.

#### Exact fix

Make the class of bug unrepresentable rather than merely correcting the order — a two-string positional signature will drift again.

**1. New shared module `src/lib/model-switch.ts`** (one definition of the grammar):

```ts
// The ONE place the /model switch string is built. Grammar verified against
// hermes_cli/model_switch.py parse_model_switch_args: "<model> --provider <p> --session".
export function modelSwitchValue({ provider, model }: { provider: string; model: string }): string {
  return `${model} --provider ${provider} --session`;
}
```

**2. `src/lib/model-switch.check.ts`** (runnable, matches the `safe-tail.check.ts` house style — no framework):

```ts
import { modelSwitchValue } from "./model-switch.ts";

function assertEq(actual: string, expected: string) {
  if (actual !== expected) throw new Error(`Expected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
}

// The reported case. Model FIRST, provider after the flag — never the reverse.
assertEq(modelSwitchValue({ provider: "openrouter", model: "inkling:free" }),
         "inkling:free --provider openrouter --session");
assertEq(modelSwitchValue({ provider: "anthropic", model: "claude-opus-4-6" }),
         "claude-opus-4-6 --provider anthropic --session");

console.log("ok");
```

**3. `composer-controls.tsx`** — change the prop to one object:

```ts
// :62
onPickModel: (sel: { provider: string; model: string }) => void;

// :166-169  provider row is now BROWSE-ONLY (see 3.2-D — same edit, do it once)
onClick={() => setMenuProvider(p.slug)}

// :178
onClick={() => { onPickModel({ provider: menuProvider || provider, model: m }); setOpen(false); }}
```

**4. `chat-landing.tsx:375`** — destructure, and use the shared builder:

```ts
const onPickModel = async ({ provider, model }: { provider: string; model: string }) => {
  const prev = getLastSessionInfo();            // ref, not the render-scoped closure (see 3.2-H)
  setSessionInfo((p: any) => ({ ...(p || {}), model, provider }));
  try {
    const res = await rpc("config.set", { key: "model", value: modelSwitchValue({ provider, model }) });
    if (res?.confirm_required) { /* see 3.2-B */ }
    if (res?.warning) setErrorBanner(String(res.warning));
  } catch (err: any) {
    setSessionInfo((p: any) => ({ ...(p || {}), model: prev?.model, provider: prev?.provider }));
    setErrorBanner(`Could not switch model: ${err?.message || String(err)}`);
  }
};
```

**Effort note (ponytail):** this is the laziest correct fix. The object parameter is not a speculative abstraction — it is the thing that makes the compiler catch the recurrence, and it is a smaller diff than any runtime guard would be. Extracting `modelSwitchValue` is justified solely because the string grammar is the entire bug and it now has exactly one definition and one assertion. Do not build a "ModelSelection" type hierarchy around it.

#### Verification

```bash
node src/lib/model-switch.check.ts   # prints "ok"
npm run build                        # must type-check clean; a leftover positional call site now FAILS
```

Live, via Playwright against `https://astra.jitinnair.com` (see §5 for the full recipe): open the composer options popover, click provider `openrouter`, click model `inkling:free`, and assert on the **outbound** WS frame:

```js
// injected before navigation
const send = WebSocket.prototype.send;
WebSocket.prototype.send = function (d) { (window.__frames ||= []).push(String(d)); return send.call(this, d); };
```

The captured `config.set` frame must contain `"value":"inkling:free --provider openrouter --session"`. That single frame is the whole confirmation — no 20-second wait needed.

---

### 2.2 P0-B — `prompt.submit` errors are silently discarded

**Severity:** critical. **Confidence:** confirmed in source. **This is why the failure is silent rather than an error message.**

#### Root cause

Every other RPC in `src/lib/hermes-ws.ts` goes through `rpc()` (`:51`), which registers its id in `pendingRpcs` so `onMessage` can resolve or reject it (`:138-144`). Two call sites bypass that entirely:

```ts
// :215-228 submitPrompt
ws.current.send(JSON.stringify({
  method: "prompt.submit",
  params: { session_id: liveSessionId || storedSessionId, text: content, surface: "webui" },
  id: generateRpcId()            // <- never registered anywhere
}));

// :85-91 flushPendingPrompt — same pattern for the queued first-turn path
```

Trace an `{id, error}` reply through `onMessage` (`:130-201`):

| Branch | Line | Matches? |
|---|---|---|
| `data.method === "approval"` | 134 | no |
| `data.id && pendingRpcs.has(data.id)` | 138 | no — never registered |
| `data.id && pendingResumes.has(data.id)` | 146 | no |
| `data.id && data.result && data.result.session_id` | 158 | no — an error reply has `data.error`, not `data.result` |
| `data.method === "event"` | 170 | no — it is an RPC reply |

The function returns having done nothing.

Meanwhile `submitPrompt` has already called `setIsStreaming(true)` (`:217`), and `send()` has already appended an assistant bubble with `isStreaming: true` and set `activeIdRef` (`chat-landing.tsx:342-344`). Nothing will ever clear them. The composer is `disabled={isStreaming}` (`:735`), the send button is swapped for Stop (`:746-753`), and the placeholder reads "Astra is replying…" (`:712`, `:724`).

This is the same bug class the code's own comment already names at `chat-landing.tsx:235` — *"Interrupted/dropped turns never emit message.complete — finalize here too"* — correctly applied to `ws.closed` and never applied to the RPC-error path.

#### Exact fix

Route `prompt.submit` through the same `rpc()` helper as everything else, and add one catch-all guard in the shared message handler so no future fire-and-forget send can reintroduce this.

**1. `hermes-ws.ts` — `submitPrompt` (`:215`) and `flushPendingPrompt` (`:85`):**

```ts
rpc("prompt.submit", { session_id: sid, text, surface: "webui" })
  .catch((err: any) => {
    setIsStreaming(false);
    onEventRef.current({
      type: "message.error",
      payload: { error: err?.message || err?.data?.message || String(err) },
    });
  });
```

`message.error` already routes to `finalizeActive()` at `chat-landing.tsx:218-221`, so the half-built assistant bubble collapses and the composer unlocks with no further changes.

**2. `hermes-ws.ts` `onMessage` — add a final catch-all branch** (place it after the `pendingResumes` block, before the `data.method === "event"` block):

```ts
// Any {id, error} reply nobody is tracking — a fire-and-forget send whose
// rejection would otherwise be dropped. One guard covers every present and
// future raw send on this socket.
if (data.id && data.error && !pendingRpcs.current.has(data.id)) {
  setIsStreaming(false);
  onEventRef.current({ type: "message.error", payload: { error: data.error?.message || JSON.stringify(data.error) } });
  return;
}
```

**3. `chat-landing.tsx:218` — surface the reason, don't just finalize:**

```ts
if (type === "message.complete" || type === "message.error") {
  if (type === "message.error") {
    const msg = payload?.error?.message || payload?.error || "The agent turn failed.";
    setErrorBanner(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  finalizeActive();
  return;
}
```

**Effort note (ponytail):** the catch-all branch is the root-cause fix — it is one guard in the shared handler rather than a guard at every send site, and it is a smaller diff than auditing each caller. Take both halves: routing through `rpc()` gives a precise error for the known path, the catch-all covers the paths nobody has written yet.

#### Verification

Reproduce deliberately, with the frame monitor from §5 attached: send `config.set { key: "model", value: "definitely-not-a-model --provider nope --session" }` from the browser console (or pick a provider whose model list you know is wrong), then send any prompt. Expected after the fix: within a second or two the red error banner appears carrying the gateway's message, the assistant bubble collapses, the Stop button reverts to Send, and the textarea is enabled. Before the fix: nothing, forever.

---

### 2.3 P0-C — no turn watchdog

**Severity:** high. **Confidence:** confirmed in source.

#### Root cause

`isStreaming` clears on exactly four events:

| Event | Location |
|---|---|
| `message.complete` / `message.error` | `hermes-ws.ts:197` |
| `proxy.status: reconnecting` | `hermes-ws.ts:173-175` |
| `ws.onclose` | `hermes-ws.ts:115-118` |

There is no timeout anywhere in the client.

The relay makes `ws.onclose` far less likely than it looks. `server/hermes-proxy.mjs:146` holds **one module-global `upstreamWs`** shared by all browser sockets, and `broadcastFrame` (`:162-167`) fans every upstream frame out to every browser socket. The browser's socket therefore only closes if the relay process itself dies or the browser socket drops — **not** when a single turn fails upstream while the relay stays healthy. The existing `ws.closed → finalizeActive` mitigation covers the rare case and misses the common one.

So whether the cause is P0-A's bad model id, an OpenRouter 402/429, a provider rejecting a reasoning parameter, or Hermes dying mid-turn, the UI outcome is identical and permanent.

**Secondary defect in the same path:** `flushPendingPrompt` (`:74-91`) sends queued `config.set` frames and then `prompt.submit` back-to-back without awaiting the `config.set` replies. A first-turn model or effort switch therefore races the turn it is meant to configure.

#### Exact fix

One timer, cleared at one place.

```ts
// hermes-ws.ts — module scope near generateRpcId
const TURN_WATCHDOG_MS = 120_000;
// ponytail: fixed ceiling, sized for high reasoning effort (ultra turns legitimately
// run minutes of silent reasoning). Make it per-model only if a real turn trips it.

// inside useHermesWS
const watchdogRef = useRef<number | null>(null);
const clearWatchdog = useCallback(() => {
  if (watchdogRef.current) { window.clearTimeout(watchdogRef.current); watchdogRef.current = null; }
}, []);
const armWatchdog = useCallback(() => {
  clearWatchdog();
  watchdogRef.current = window.setTimeout(() => {
    watchdogRef.current = null;
    setIsStreaming(false);
    onEventRef.current({ type: "message.error", payload: { error: "No response from the agent (timed out after 120s)." } });
  }, TURN_WATCHDOG_MS);
}, [clearWatchdog]);
```

Arm it in `submitPrompt` and in `flushPendingPrompt`'s prompt send. Clear it in `onMessage` on the **first inbound sign of life for the live session** — `message.start`, `message.delta`, `thinking.delta`/`reasoning.delta`, `tool.start`, or an `approval` frame — and again on `message.complete`, `message.error`, `ws.onclose`, `interrupt()` and `resetSession()`.

Clearing on the first delta rather than re-arming per delta is the deliberate simplification: it bounds "the agent never started" (the actual failure class here) and does not attempt to bound "the agent started and then stalled mid-stream". The latter needs an inter-chunk stall timer, which belongs in Hermes where the upstream SSE stream actually is — see §6, open question 3.

**Also fix the race in `flushPendingPrompt`:** await the queued `config.set` replies before sending the prompt.

```ts
const flushPendingPrompt = useCallback(async (sid: string) => {
  const queue = pendingPreTurnRpcs.current;
  pendingPreTurnRpcs.current = [];
  const sent: Promise<any>[] = [];
  for (const req of queue) {
    if (ws.current && ws.current.readyState === 1) {
      req.params.session_id = sid;
      pendingRpcs.current.set(req.id, { resolve: req.resolve, reject: req.reject });
      ws.current.send(JSON.stringify({ method: req.method, params: req.params, id: req.id }));
      sent.push(new Promise((r) => { const o = req.resolve; req.resolve = (v: any) => { o(v); r(v); }; }));
    } else {
      req.reject(new Error("WebSocket not connected"));   // <- see 3.2-I, same edit
    }
  }
  await Promise.allSettled(sent);
  const text = pendingPromptRef.current;
  if (text === null) return;
  pendingPromptRef.current = null;
  armWatchdog();
  rpc("prompt.submit", { session_id: sid, text, surface: "webui" }).catch(/* as 2.2 */);
}, [rpc, armWatchdog]);
```

**Effort note (ponytail):** the watchdog is deliberately one fixed-ceiling timer with one clear point. Do not build a per-event-type timeout matrix, do not make the ceiling configurable, do not add a progress-based heuristic. One timer converts every silent-death cause into a legible error at once — which is the root-cause fix, and chasing each upstream failure mode individually is the symptom patch.

#### Verification

With the service stopped mid-turn (`systemctl --user stop hermes-gateway.service` right after pressing Enter), the UI must show the timeout error banner within ~120s and unlock the composer, instead of spinning forever. Restart the gateway afterwards.

---

### 2.4 Repro-method corrections — read before re-running the repro

The Playwright pass that produced the "BUG REPRODUCED" payload did **not** reproduce the reported bug. Three verifiable problems:

**(a) It found a dead stub, not the picker.** `src/App.tsx:257`:

```tsx
{ name: "Model", icon: <Cpu … />, onClick: () => { alert("Model: openrouter / inkling:free (configured). Click to switch (dropdown coming in Phase 2)."); } }
```

The real picker is inside the composer popover in `ComposerControls`, behind an icon-only button whose accessible name is **"Composer options"** (`composer-controls.tsx:120-125`). No text matching "model", "provider", "openrouter" or "reasoning" exists in the DOM until that popover is open. An automated search for those strings finds the sidebar stub, clicks it, gets an `alert()` (which Playwright auto-dismisses), and reports "button selector not clickable" and "options not found" — exactly the step list in the payload.

**Action:** delete the `onClick` alert from `App.tsx:257` in Phase 4. It actively misleads both automated tests and users about what model is configured.

**(b) The "session loss" is a cookie artifact.** The run used `http://127.0.0.1:3011` (plain HTTP, per its own network summary). The session cookie is issued `HttpOnly; Secure; SameSite=Lax` (`server.mjs:101`). Over plain HTTP the browser does not store it, `/api/me` correctly returns 401, and the SPA renders the login screen. This is correct server behaviour, not a bug.

**(c) The app cannot log itself out.** `App.tsx:38-44` checks `/api/me` once on mount; the only code path that sets `status` back to `"login"` is the explicit `logout()` at `:72-75`. There is no 401 interceptor and no session-expiry handler. "Returned to login after send" therefore proves a **remount** (navigation, reload, or crash+reload) with no valid cookie — a harness artifact.

**Correct repro procedure:** see §5.1.

---

## 3. All other findings, by dimension

Each entry carries a verification verdict. **CONFIRMED** = verified against source in this pass. **CORRECTED** = the finding is real but its description or fix was wrong. **REJECTED** = not a defect in this repository; do not implement.

### 3.1 Streaming / timeline (`chat-landing.tsx`, `chat-timeline.tsx`, `chat-segments.ts`)

#### 3.1-A — Duplicate sockets can deliver every frame twice — **CONFIRMED, high**

*Root cause.* `hermes-ws.ts:19` holds a module-level `sharedSocket`. The connect effect reuses it only when `sharedSocket.readyState === 1` (`:99`). On a double-invoked mount (StrictMode in dev, or any remount landing while the socket is still CONNECTING) the first socket is in readyState 0, the guard fails, and a second `new WebSocket(url)` is created at `:108`. The cleanup is `return () => { ws.current = null; };` (`:212`) — it never calls `socket.close()` and never detaches `onmessage`/`onclose`, so socket #1 stays open with its handler bound to the same hook instance's `onEventRef`. `hermes-proxy.mjs:162-167` broadcasts every upstream frame to every browser socket, so both deliver the same `message.delta`, `tool.start`, `thinking.delta` and `approval` frames and `handleEvent` runs twice per event.

Because bubbles are created by local state (`send()` / `ensureActive()` guarded by `activeIdRef`), this never shows as an extra bubble. It shows as **doubled text inside one bubble**, doubled tool rows, and two approval cards sharing the DOM id `chat-approval-<id>`. Counting bubbles in a screenshot cannot detect it — which is why the upstream "no StrictMode duplicates observed" conclusion is unsupported.

*Fix.* Two lines:

```ts
// :99 — reuse a CONNECTING socket too
if (sharedSocket && (sharedSocket.readyState === 0 || sharedSocket.readyState === 1)) { … }

// :212 — detach so a leaked socket can never dispatch into a live component
return () => { socket.onmessage = null; socket.onclose = null; ws.current = null; };
```

Note the `attachHandlers` path rebinds handlers on reuse, so detaching on cleanup is safe.

*Verify.* Send `reply with exactly: ABCDEF` and assert the rendered assistant text equals `ABCDEF` once — never count bubbles. Additionally log `browserSockets.size` on connect in `hermes-proxy.mjs:299` and assert it is 1 per open tab.

#### 3.1-B — A turn can be left permanently streaming — **CONFIRMED, high**

*Root cause.* `send()` at `chat-landing.tsx:342-344` assigns `activeIdRef.current = id` for the new turn **without calling `finalizeActive()` first**. It is guarded by the hook's `isStreaming`, but the hook clears that flag on `proxy.status: reconnecting` (`hermes-ws.ts:174`) while the *message-level* `isStreaming` stays `true`. A reconnect blip therefore lets the user start turn N+1 while turn N is still flagged streaming, and turn N is orphaned forever. The action row is gated on `!m.isStreaming` (`:630`), so an orphaned turn never gets its copy/regenerate buttons.

*Fix.* One line at the top of `send()`, before `activeIdRef.current = id`:

```ts
finalizeActive();
```

Additionally, in the `ws.closed` branch of `handleEvent` (`:234`), only finalize when the closing socket is the current one — once 3.1-A's detach lands, a leaked socket can no longer dispatch `ws.closed` at all, so no extra work is needed here.

*Verify.* Force `proxy.status: reconnecting` (bounce `hermes-gateway.service` mid-turn), then send a second message; both turns must end with visible copy/regenerate rows.

#### 3.1-C — Typewriter reveal is hard-capped far below real throughput — **CONFIRMED, high**

*Root cause.* `chat-timeline.tsx:135`:

```ts
const CPS_MIN = 120, CPS_MAX = 160; // 30-40 tokens/s (~4 chars avg)
```

and `:150-152`, while `done` is false, advances at `CPS_MIN + wobble` chars/sec **regardless of how much text is already buffered**. A backend streaming at 80-150 tok/s produces roughly 320-600 chars/s, so the backlog grows monotonically for the whole turn: a 6,000-character answer the model finished in 15s keeps drawing for ~40s. Only when `seg.status` flips to `"done"` does the rate jump to `max(360, backlog/0.4)` — which is why the text appears to dump all at once at the end.

This is the most likely reason the audit's screenshots showed responses "still processing" long after the model had finished.

*Fix.* Make the not-done branch backlog-aware so the reveal is a smoothing filter rather than a throttle:

```ts
const back = text.length - nRef.current;
const cps = done
  ? Math.max(CPS_MIN * 3, back / 0.4)
  : Math.max(CPS_MIN + (Math.sin(now / 900) + 1) * (CPS_MAX - CPS_MIN) / 2, back / 0.35);
```

The wobble stays the floor so short deltas still look typed; the visible text can never fall more than ~350 ms behind what has been received. The `usePrefersReducedMotion` instant path (`:140`) already covers accessibility.

*Verify.* Prompt for a ~4,000-character response. Measure wall-clock from the last `message.delta` frame to the caret disappearing — must be under ~1s, not tens of seconds.

#### 3.1-D — Rendering cost is quadratic in response length — **CONFIRMED, medium**

*Root cause.* `TextRow` (`:209-215`) recomputes `shown = safeTail(text.slice(0, n))` on every `n` change, and `RichText` memoizes on the resulting `text` (`:22-32`), so `md.parse()` + `DOMPurify.sanitize()` run over the entire prefix once per 16 ms tick. For an N-character response that is O(N) work repeated ~N/cps×60 times — O(N²). The code-copy effect (`:34-48`) then runs `root.querySelectorAll("pre:not([data-cb])")` per new html and re-creates a button per `<pre>`, because `dangerouslySetInnerHTML` replaces the subtree wholesale and wipes the `data-cb` marker every tick. `applySegmentOps` additionally shallow-clones every segment of the active turn on each 40 ms flush (`chat-segments.ts:48`).

*Fix.* Decouple parse frequency from reveal frequency. While `seg.status === "run"`, render the streaming tail as `whitespace-pre-wrap` plain text and only run the markdown pipeline on a throttled boundary — at most every ~120 ms, or when the revealed prefix crosses a newline — swapping to fully parsed markdown at completion. Replace the per-`<pre>` button creation with one delegated `onClick` on the container that walks up to the nearest `<pre>` and copies its `textContent`.

*Effort note (ponytail):* this is one of the three places worth real engineering. A naive throttle that also throttles the caret produces visible stutter; a naive "parse only at completion" loses live code-fence rendering that the `safeTail` hold-back logic was specifically built for. Read `src/lib/safe-tail.ts` and `safe-tail.check.ts` before touching this, and extend `safe-tail.check.ts` rather than writing a new harness.

*Verify.* Prompt for a long code-heavy answer (e.g. "write a 300-line Python script with explanation"). Record a Chrome performance trace during streaming; long tasks must stay under 50 ms and the frame rate must not degrade as the response grows.

#### 3.1-E — History reconciliation compares prose, not identity — **CONFIRMED but already largely mitigated, medium→low**

*Root cause.* `loadHistory`'s `sameMsg` (`chat-landing.tsx:291-296`) joins the live turn's text segments with `"\n\n"` and compares against `row.content` after stripping only attachment lines and trailing whitespace. Any interleaved tool or thinking segment splits text into several `text` segments, producing `A\n\nB` where the server stored `AB`. The tail-match loop then stops at the first mismatch and returns `[...rows.slice(0, ri + 1).map(toMsg), ...live.slice(li + 1)]` — on total mismatch, every history row followed by every live message, i.e. a duplicated transcript.

**Mitigating context the upstream finding missed:** `:303-304` already guards the two dangerous cases — a wholesale replace when `liveSidRef.current !== sid || live.length === 0`, and `return live` untouched when `activeIdRef.current != null`. These were added deliberately (commit `c8911e5`, the "first-message vanish" P0). The residual exposure is narrow: a completed turn containing tool calls, followed by a session-id flip.

*Fix.* Lazy version, one line: skip the merge entirely when `liveSidRef.current === sid && live.length > 0` — the live list is authoritative for the session the user is watching. Do **not** build an id-passthrough layer unless the lazy version proves insufficient; `normalizeMessages` currently discards row ids and adding them is a wider change than the problem justifies.

*Verify.* Send a message that triggers a tool call, wait for completion, reload the page, and assert the message count does not double.

#### 3.1-F — Stick-to-bottom misses reveal growth and media loads — **CONFIRMED, medium**

*Root cause.* The auto-scroll effect (`:509-512`) depends on `[messages, atBottom, reducedMotion]`. During streaming the container also grows from `TextRow`'s internal `n` state (which never touches `messages`) and from `MediaCard` images/videos that use `loading="lazy"` with no `onLoad` handler. Worst case is the end of a turn: after `message.complete`, `useReveal` keeps drawing for up to ~400 ms at 360+ chars/s with no further `messages` update.

*Fix.* Replace the messages-dependent effect with a `ResizeObserver` on the inner list wrapper that pins `el.scrollTop = el.scrollHeight` whenever `atBottom` is true, and add `onLoad={pin}` to the `img`/`video` in `MediaCard`. One mechanism covers deltas, reveal growth, media and fold/expand toggles. Keep `behavior: "auto"` — the existing comment at `:506-508` explains why smooth scrolling re-cancels itself under 40 ms batching, and that reasoning is still correct.

*Verify.* Stream a long response with `atBottom` true; the last rendered line must be within 80 px of the container bottom at every point, including ~500 ms after the final delta.

#### 3.1-G — Jump-to-latest pill is gated on `isStreaming` — **CONFIRMED, medium**

*Root cause.* `chat-landing.tsx:676`: `{isStreaming && !atBottom && …}`. `isStreaming` clears on `proxy.status: reconnecting` and on any socket close, so the pill vanishes mid-turn during a reconnect, and never appears at all once the turn completes — exactly when a user who scrolled up to read a tool block needs it.

*Fix.* Delete the `isStreaming &&`. One condition removed.

*Verify.* Complete a turn, scroll up, confirm the pill is present and returns the view to the bottom.

#### 3.1-H — Tool segments use the raw `tool_id` as their React key and segment id — **CONFIRMED, medium**

*Root cause.* `chat-segments.ts:64`: `out.push({ id: op.key || nextSegId(), … })` where `op.key` is `payload.tool_id` straight off the wire (`chat-landing.tsx:175`). Nothing namespaces it per turn and nothing checks for an existing segment with that id, so a second `tool.start` with the same id creates a duplicate React key inside one `TurnTimeline`. The `tool-done` keyed branch (`:82-84`) is:

```ts
const t = op.key
  ? out.find((s) => s.id === op.key && s.kind === "tool")
  : [...out].reverse().find((s) => s.kind === "tool" && s.status === "run");
```

The keyed path has **no `status === "run"` filter** — unlike the keyless fallback right beside it, and unlike `tool-update` at `:68` which does filter. `find` therefore returns the *first* match, i.e. the already-completed earlier block, and overwrites its `resultText`/`exitCode`/`collapsed` while the genuinely running block never leaves `"run"`.

*Fix.* Namespace the segment id and add the status preference:

```ts
// op.op === "tool": never collide across turns or repeats
out.push({ id: `${op.key || "k"}:${nextSegId()}`, … });
// keep a per-batch Map<wireKey, segId> so tool-update/tool-done can address it

// op.op === "tool-done": prefer the newest RUNNING match, fall back to newest match
const candidates = out.filter((s) => s.kind === "tool" && keyOf(s) === op.key);
const t = [...candidates].reverse().find((s) => s.status === "run") ?? candidates[candidates.length - 1];
```

*Effort note (ponytail):* this is the second place worth real engineering. It is a data-addressing bug at the boundary between wire ids and render ids, and a sloppy fix routes tool output onto the wrong block — a correctness failure the user cannot detect. `applySegmentOps` is a pure function with an existing node-runnable harness; use it.

*Verify.* Add a case to `scripts/verify-chat-timeline.ts`: feed two `tool` ops with the same key plus two `tool-done` ops, and assert both segments end `"done"` with their own distinct results and distinct ids. Run `node scripts/verify-chat-timeline.ts` — the tail line must read `16/16` (or higher) and exit 0.

#### 3.1-I — History messages have no timestamps — **CONFIRMED, low**

*Root cause.* `ts` is set only in `send()` (`:340`, `:344`) and `ensureActive()` (`:106`) from the browser clock. `normalizeMessages` (`src/lib/normalize-messages.ts`) keeps only `role` and `content` and discards any server timestamp, and `toMsg` (`:297-299`) builds messages without a `ts`, so the `{m.ts != null && …}` block at `:609` renders nothing for restored turns.

*Fix.* Add `ts` to the `Msg` interface and pass the server field through: `ts: row.created_at ?? row.ts ?? row.timestamp ?? undefined`, then set it in `toMsg`. Falling back to the client clock only when the server supplies nothing preserves current live behaviour.

*Verify.* Reload a session with history; every message must carry a timestamp.

#### 3.1-J — `aria-live="polite"` on a container whose innerHTML is rewritten every tick — **CONFIRMED, low**

*Root cause.* `chat-landing.tsx:578` sets `role="log" aria-live="polite"` on the scroll container. Inside it, `RichText` renders via `dangerouslySetInnerHTML`, so each ~16 ms reveal tick replaces the entire subtree of the streaming segment. Live-region semantics treat that as repeated additions, producing an announcement storm for the duration of the turn.

*Fix.* Set `aria-live="off"` on the container and add one visually hidden `role="status" aria-live="polite"` node that receives the final text once per turn on `seg.status === "done"`. Keep `role="log"` for structure. This also satisfies the research brief's WCAG 2.2 SC 4.1.3 point — pair the error banner at `:562-567` with `role="alert" aria-live="assertive"` in the same edit.

*Verify.* With a screen reader (Orca on this host), stream a response: exactly one completion announcement, not a per-token storm; an error banner announces immediately.

#### 3.1-K — `SESSION // N MSGS` counts things that are not messages — **CONFIRMED, low**

*Root cause.* `:571` renders `session // ${messages.length} msgs`. `messages` also holds `isSysNote` rows (the yolo notices pushed at `:364-367`) and the empty assistant placeholder created at send time, which `finalizeActive` may later filter out (`:121`) — so the count can visibly go 6 → 5.

*Fix.* One expression:

```ts
messages.filter((m) => !m.isSysNote && (m.role === "user" || m.segments.length > 0)).length
```

---

### 3.2 Model / reasoning switcher (`composer-controls.tsx`, `chat-landing.tsx`, `session-files.ts`)

#### 3.2-A — Argument transposition — **see §2.1 (P0-A)**

#### 3.2-B — `confirm_required` and `warning` in the `config.set` response are discarded — **CONFIRMED, high**

*Root cause.* Verified gateway-side. `tui_gateway/methods_config_set.py:66-70`:

```python
def _cfgset_model_ok(rid, key, value, warning="", confirm_message="", scope="session", **extra):
    """Model-switch envelope; ``confirm_required`` follows ``confirm_message``…"""
    return _kv(rid, key, value, warning=warning, confirm_required=bool(confirm_message),
               confirm_message=confirm_message, scope=scope, **extra)
```

and `:151-154` returns `confirm_required` / `confirm_message` / `warning` from `_apply_model_switch`, gated on `params.get("confirm_expensive_model", False)` (`:111`) which the web UI never sends.

Client-side, `chat-landing.tsx:381` is `await rpc(…)` with **no assignment** — the resolved value is discarded entirely. A `confirm_required: true` response is a *successful* JSON-RPC result, not an error, so the `catch` never fires and the optimistic `setSessionInfo` stands. The user sees the expensive model checkmarked and selected while the gateway is still on the previous model, awaiting a confirmation the web UI has no code path to send.

The correct pattern already exists two functions up — `onToggleYolo` at `:362-363` captures `const res = await rpc(…)` and inspects `res.key`.

*Fix.* Capture the result (already shown in §2.1's fix body). On `res.confirm_required`, do **not** commit the optimistic state — render `res.confirm_message` and, on assent, re-issue `config.set` with `confirm_expensive_model: true`. Render `res.warning` as an `isSysNote` message through the channel `onToggleYolo` already uses.

*Verify.* Pick a model the gateway flags as expensive; confirm the UI asks rather than silently claiming success. If no such model exists in the current catalog, verify by temporarily stubbing the RPC response in the browser console.

#### 3.2-C — Reasoning effort is sent without `scope` and can rewrite the global config — **CONFIRMED, high**

*Root cause.* Verified on both sides.

Client: `chat-landing.tsx:392` — `await rpc("config.set", { key: "reasoning", value: effort })`, no `scope`.

Gateway: `methods_config_set.py:300` — `scope = _word(params.get("scope"))` with **no `or "session"` default**, versus the yolo setter at `:263` which *does* default: `scope = _word(params.get("scope") or "session")`. Then `:310`:

```python
if scope == "global" or session is None:
    _write_config_key("agent.reasoning_effort", arg)
```

So an absent `scope` is safe **only while the gateway resolves a live session** from `session_id`. `rpc()` attaches `session_id` from `liveIdRef.current` (`hermes-ws.ts:59-60`), a ref set on session create/resume that is never invalidated when the gateway drops or expires a session (`resetSession` clears it locally; a server-side expiry does not). A `config.set reasoning` carrying a stale session id resolves to `session is None` and takes the global branch — and because Hermes drives the TUI, desktop and CLI from the same `config.yaml`, a browser menu pick becomes the reasoning default for every surface, indefinitely.

The gateway's own comment at `:319` states the intent — *"a menu pick must not rewrite the global"* — the web UI just never sends the parameter that guarantees it.

*Fix.* One added object key, client-side:

```ts
await rpc("config.set", { key: "reasoning", value: effort, scope: "session" });
```

That alone makes the global branch unreachable regardless of session resolution. **Do this first and independently** — it is a one-token fix for a cross-surface persistent side effect.

Separately, hardening the gateway to match `_set_yolo` (`scope = _word(params.get("scope") or "session")`) would close it for every client. That is a `~/.hermes/hermes-agent` edit — see §6, open question 1.

*Verify.*

```bash
cp ~/.hermes/config.yaml /tmp/claude-1000/.../config-before.yaml
# pick every effort level in the UI, then:
diff /tmp/claude-1000/.../config-before.yaml ~/.hermes/config.yaml   # must be empty
```

#### 3.2-D — Clicking a provider row immediately commits a model switch — **CONFIRMED, high**

*Root cause.* `composer-controls.tsx:166-169` does two things at once:

```ts
onClick={() => { setMenuProvider(p.slug); onPickModel(p.slug, p.models[0]); }}
```

There is no separation between *browsing* a provider's model list and *committing* to it, so a user cannot see what another provider offers without mutating the live session. Worse, `getCatalog()` in `session-files.ts:41` deliberately normalises a null model list to `[]` (`models: p.models ?? []`, with the comment at `:38` acknowledging the host payload can omit models) — and `[][0]` is `undefined`, which flows unguarded into the template literal, producing `config.set model = "undefined --provider <x> --session"`.

*Fix.* Make the provider row browse-only — this is the same edit as §2.1 step 3, do it once:

```ts
onClick={() => setMenuProvider(p.slug)}
```

The model row below becomes the only thing that commits. This also fixes the "model not preserved on provider switch" complaint for free, because nothing is sent until a model is chosen. Add `disabled={!p.models.length}` on provider rows with an empty model list.

*Verify.* Open the popover, click through three providers without clicking a model, and assert **zero** outbound `config.set` frames.

#### 3.2-E — Catalog cache is never invalidated; a failed fetch shows "Loading catalog..." forever — **CONFIRMED, high**

*Root cause.* `session-files.ts:30-36`:

```ts
export async function getCatalog() {
  if (catalogCache) return catalogCache;
  let res = await fetch("/api/hx/model/options");
  if (res.status === 503) { res = await fetch("/api/hx/model/options"); }   // immediate, no delay
  if (!res.ok) throw new Error("Failed to load catalog");
  …
}
```

Module-scope memo with no TTL, no invalidation hook and no forced refresh short of a page reload, so a catalog change on the host never reaches a long-lived tab. The 503 retry is a single immediate re-fetch with no backoff — and a 503 is the gateway announcing it is not up yet, so an immediate retry is the one timing guaranteed to fail.

The failure path is worse than the staleness. `chat-landing.tsx:76`:

```ts
getCatalog().then((c) => setCatalog(c)).catch(() => { /* popover shows fallback rows */ });
```

The comment is wrong about its own UI. On failure `catalog` stays `null`, and `composer-controls.tsx:157` branches on `!catalog` first — so the menu renders **"Loading catalog..." permanently**. The "Catalog unavailable" branch at `:159` is only reachable when the fetch *succeeded* and returned zero providers.

*Fix.* Add a `catalogError` state beside `catalog`, branch the menu on it, render "Catalog unavailable — Retry" with a button that calls a new `refreshCatalog()` in `session-files.ts` (nulls `catalogCache` then re-fetches). Put a short delay (~1500 ms) on the 503 retry.

*Verify.* Stop `hermes-gateway.service`, reload the page, open the popover: it must say "Catalog unavailable" with a working Retry, not spin on "Loading catalog...". Restart the gateway and click Retry — the providers must appear without a page reload.

#### 3.2-F — The `EFFORTS` list is correct; the one-way door is the real bug — **CORRECTED, medium**

**Correction to the upstream finding.** The claim that four of the eight effort values are invalid is **false**. Verified at `hermes_constants.py:927`:

```python
VALID_REASONING_EFFORTS = ("minimal", "low", "medium", "high", "xhigh", "max", "ultra")
```

and `parse_reasoning_effort` (`:930-943`) additionally maps `"none"`/`"false"`/`"disabled"` → `{"enabled": False}`. **All eight values in `composer-controls.tsx:16-25` are server-valid.** Do not trim the list. `ultra` in particular is a perfectly well-formed value and is *not* the cause of the reported bug.

*The real defect.* Once any effort is chosen there is no way back to provider default. The "Provider default" row is rendered only under `effort === ""` (`:141`) **and is rendered `disabled`** — a status indicator, not a control, and unreachable by keyboard. The moment any level is picked, `sessionInfo.reasoning_effort` becomes non-empty and the row unmounts.

The obvious client-side fix is blocked server-side: `parse_reasoning_effort("")` returns `None` (the empty string matches neither set), and `_set_reasoning` turns a `None` parse into `_err(rid, 4002, "unknown reasoning value: ")` (`:308-309`). The session branch only ever *assigns* `session["create_reasoning_override"] = parsed` (`:320`) — there is no value that pops the override back off. Note `none` is **not** a substitute: it maps to `{"enabled": False}`, which disables reasoning outright rather than deferring to the provider.

*Fix.* Client-side half only, unless the gateway edit is approved (§6 q1): always render the "Provider default" row, enabled, checkmarked when `effort === ""`. Wiring it to actually clear requires the gateway to accept a clearing value (`"default"`, or an empty arg under session scope → `session.pop("create_reasoning_override", None)` plus a re-derive from `config.yaml`, mirroring the `/new` boundary already implemented at `:318`).

If the gateway edit is declined, the minimum honest client behaviour is: keep the row visible and disabled, with a `<small>` reading "start a new chat to restore". Do not fake it.

#### 3.2-G — Model and effort changes leave no transcript record and carry no cost signal — **CONFIRMED, medium**

*Root cause.* `onToggleYolo` pushes an `isSysNote` message on success (`:364-367`), so the transcript records when tool auto-approval changed. Neither `onPickModel` nor `onPickEffort` does anything equivalent — the only feedback is a checkmark inside a popover that then closes. The two settings that actually drive token spend are the two with no audit trail.

The `EFFORTS` array renders all eight levels as flat equal-weight rows with bare labels, no sublabel, no cost or latency hint, no confirmation, and no visual separation between the cheap and expensive ends. `Ultra` is indistinguishable in the UI from `Low`. Contrast the yolo row, which already carries `<small>Auto-approve tool calls in this chat</small>` (`:136`).

*Fix.* Reuse the pattern already in the file. On a successful model or effort change push an `isSysNote` ("Model → inkling:free on openrouter", "Reasoning effort → Ultra"). Add a `<small>` to the top three effort rows naming the tradeoff. A few lines, gives the transcript an audit trail, and is the cheapest possible fix.

#### 3.2-H — `config.set` failures revert silently using stale closure values — **CONFIRMED, medium**

*Root cause.* All three handlers follow optimistic-set-then-revert-on-catch with an empty catch. The revert baseline is captured from `sessionInfo` at call time — `const prevModel = sessionInfo?.model` (`:376`) — which is the render-scoped value, not a ref. Two picks in quick succession capture the same `prev` from the first render.

The user-facing half is worse: the catch produces no message at all. `rpc()` rejects with `new Error("WebSocket not connected")` whenever the socket is down (`hermes-ws.ts:63-64`), so during a gateway restart every model and effort pick appears to take, then silently reverts, with the UI never saying why.

The hook already exports the right state for this and the handlers use neither: `hermes-ws.ts:16` `export let lastSessionInfo` / `:17` `getLastSessionInfo()`, and `:34` `sessionInfoRef`.

*Fix.* Read the revert baseline from `getLastSessionInfo()` (shown in §2.1's fix body). On catch, `setErrorBanner` with the failure reason. Disable the model and effort menu rows while the socket is not in `readyState === 1`, since every config RPC is guaranteed to fail in that state.

#### 3.2-I — Pre-turn RPC queue entries are dropped without settling their promises — **CONFIRMED, medium**

*Root cause.* `rpc()` diverts `config.set` and `image.attach` into `pendingPreTurnRpcs` whenever there is no live session id (`hermes-ws.ts:54-56`) — exactly the case for a fresh chat where the user sets model or effort before typing. That queue has no timeout and three paths drop entries without settling them:

- `flushPendingPrompt` (`:72-80`) clears the array up front, then guards each send on `readyState === 1` **with no `else`** — if the socket closed between session create and flush, the request is gone and its promise hangs forever.
- `resetSession` (`:250`) does `pendingPreTurnRpcs.current = []` with no rejection at all.
- If the user configures a new chat and never sends a prompt, nothing ever triggers a flush.

A hung promise means the `await` in `onPickModel`/`onPickEffort` never resolves **or** rejects, so neither the success path nor the revert path runs — the optimistic state stands indefinitely, showing a model or effort the gateway was never told about. This is the most likely way for the UI and the session to diverge with no error anywhere.

*Fix.* Settle every entry. Add the `else { req.reject(new Error("WebSocket not connected")); }` branch in `flushPendingPrompt` (already shown in §2.3's fix body). Reject the queue before clearing it in `resetSession`. Add a timeout on queued entries (30 s) so an abandoned configured chat does not hold promises for the life of the tab.

*Effort note (ponytail):* this is the third place worth real engineering. Promises that neither resolve nor reject are the hardest state divergence to debug later, and with rejection properly wired the existing catch blocks in the handlers revert correctly on their own — so the fix is *removing* a failure mode rather than adding handling.

#### 3.2-J — `menuProvider` is initialised once and never resynced — **CONFIRMED, low**

*Root cause.* `composer-controls.tsx:94-98`:

```ts
useEffect(() => { if (open && !menuProvider) setMenuProvider(provider); }, [open, provider, menuProvider]);
```

The `!menuProvider` guard makes this one-shot: after the first open, `menuProvider` is a non-empty string forever and the effect can never fire again despite `provider` being in the deps. It is also never reset on close. Since `menuProvider || provider` selects both the checkmarked provider row (`:165`) and the model sublist (`:175`), a provider change from any other source (a `session.info` push after resume, or a change from another Hermes surface) leaves the menu showing a confident but wrong picture.

*Fix.* Delete the `!menuProvider` condition. One removed condition.

#### 3.2-K — `aria-selected` on plain buttons — **CONFIRMED, low**

*Root cause.* Every model, provider and effort row is a bare `<button>` carrying `aria-selected` (`:149`, `:165`, `:177`). `aria-selected` is only supported on roles `option`, `row`, `tab`, `gridcell`, `treeitem` and `columnheader`/`rowheader`; a button's implicit role is `button`, so the attribute is dropped from the accessibility tree. Selected state is conveyed only by the cyan `<Check/>` icon — colour and glyph, no text alternative. The correct pattern is already in the same file at `:135`: the yolo row uses `role="switch"` with `aria-checked`.

*Fix.* Give the popover `role="menu"` and the option rows `role="menuitemradio"` with `aria-checked` in place of `aria-selected`. Mark the `<Check/>` `aria-hidden`.

---

### 3.3 Responsive / accessibility — mostly REJECTED

**The evidence pass for this dimension produced claims that source contradicts.** Verify before implementing anything from it.

| Upstream finding | Verdict | Evidence |
|---|---|---|
| "Password input has no accessible name, only a bullet placeholder" | **REJECTED** | `App.tsx:119-130` — `<label htmlFor="password">Security Key</label>` plus `id="password" name="password" autoComplete="current-password" autoFocus required` |
| "No aria-live regions, so login errors are silent" | **CORRECTED → low** | `App.tsx:144-148` — the error is `<p role="alert">`. Residual: it mounts conditionally, and some screen readers do not announce a live region that appears in the same tick as its content. Fix: render the `<p role="alert">` unconditionally (empty when no error) and add `aria-describedby="login-error" aria-invalid={!!error}` to the input |
| "Show/hide password toggle communicates no state" | **CORRECTED → trivial** | `App.tsx:135` already has `aria-label={showPw ? "Hide password" : "Show password"}` and `type="button"`. Only `aria-pressed={showPw}` is missing. One attribute |
| "Login card is described as modal, no focus management, no autofocus" | **REJECTED** | `autoFocus` is present at `App.tsx:124`. The card is the entire page, not an overlay — `role="dialog"` would be cargo-culting |
| "Canvas not hidden from AT, no reduced-motion gate" | **REJECTED** | `tubes-background.tsx:152` `aria-hidden="true"`; `:62` `const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches`. Only surviving nit: no `setPixelRatio` clamp — optional battery win, not a defect |
| "`inset-0 overflow-hidden` gives no scroll path; form clips at zoom" | **UNVERIFIED, keep as a test case** | The markup is real (`App.tsx:108`). Nobody has actually tested 200% zoom or a 320 px viewport. Add both to the §5 battery before deciding — do not restructure the layer stack on an untested hypothesis |
| "401 on `/api/me` fires on every cold load" | **CONFIRMED, low** | `App.tsx:38-44` probes `/api/me` unconditionally on mount; `server.mjs` correctly answers 401 with `{"authenticated":false}`. The 401 is the right protocol answer, but the browser logs it as a resource error on every visit, which poisons any zero-console-errors assertion. Fix: return `200 {"authenticated":false}` and branch on the body. **Note this changes `scripts/selfcheck.sh:23`**, which currently asserts the `/api/me` body — update both together or leave it alone |

**Genuinely open and worth checking (not found, but not ruled out):** the authenticated shell's overlays. The composer popover is `role="dialog"` with outside-click and Escape dismissal via `useDismiss` (`composer-controls.tsx:32-48`) — that part is fine. The sidebar drawer has Escape handling and focus restore at `App.tsx` (`closeDrawer` refocuses `burgerRef`). The popped-out composer (`chat-landing.tsx:695-717`) is `role="dialog"` with Escape, but has **no focus trap and no `aria-modal`**. Low severity; fix in Phase 4 if convenient.

---

### 3.4 Resilience / approvals — WRONG REPOSITORY

**Every finding in this dimension cites `/home/notjitin/Work/astra/scratch/impl/v371/core.js`.** That is a 185 KB single-file build of the *old dashboard takeover* project (`~/Work/astra`), not astra-webui. astra-webui's approval handling lives in `src/lib/chat-segments.ts` + `src/components/chat-timeline.tsx` + `src/lib/hermes-ws.ts` and shares no code with it.

Verdicts after checking astra-webui's actual implementation:

| Upstream finding | Verdict in astra-webui |
|---|---|
| "`approvals.reset()` on socket close discards pending approvals; nothing replays them" | **REJECTED — already handled.** `hermes-ws.ts:121-128` defines `replayOpenRequests(result)`, called on both the `session.resume` reply (`:156`) and the `session.create` reply (`:167`). The gateway supplies `result.open_requests` and each is re-dispatched as an `approval` event. Approvals survive reconnect and reload |
| "`respond()` has no `readyState` check; a dropped send still dismisses the card" | **CONFIRMED in rewritten form, high.** `sendApprovalResponse` **does** guard (`hermes-ws.ts:231`: `if (!ws.current \|\| ws.current.readyState !== 1) return;`) — but it returns `void` and `respondApproval` (`chat-landing.tsx:243-246`) calls `resolveApproval(reqId, choice)` unconditionally afterwards. **Same user-visible bug, different code:** the card is marked resolved even when nothing was sent. **Fix:** make `sendApprovalResponse` return `boolean` and only call `resolveApproval` on `true`; on `false`, leave the card mounted and show "Not delivered — reconnecting" |
| "Only `approvals[0]` is rendered" | **REJECTED.** `TurnTimeline` (`chat-timeline.tsx:276-281`) maps every segment including every approval |
| "Unguarded `JSON.parse` in `onmessage`" | **REJECTED.** `hermes-ws.ts:132`: `try { data = JSON.parse(e.data); } catch { return; }` |
| "Flat 3s reconnect, comment falsely claims backoff" | **REJECTED, with one real residual.** `hermes-proxy.mjs:148-149` has a genuine `BACKOFF_TABLE = [1000, 2000, 4000, 8000]` used by `scheduleReconnect` (`:276-288`). **Real bug found in this pass:** `backoffStep` is never reset to 0 on a successful connect (`:223-224` sets `upstreamWs = socket; reconnecting = false;` and nothing more), so after four transient drops every later reconnect waits the full 8 s forever. **Fix: one line —** `backoffStep = 0;` next to `reconnecting = false;` at `:224` |
| "Stale approval id answered over a new socket" | **NOT APPLICABLE as written.** Since approvals are replayed by the gateway on resume with the gateway's own ids, the client never answers an id the gateway did not just re-issue. No action |
| "Playwright harness pins `chromium-1234`" | **Applies to `~/Work/astra`, not this repo.** astra-webui has no pinned Playwright path. The symlink workaround (`ln -s chromium-1243 ~/.cache/ms-playwright/chromium-1234`) is a real stopgap and is recorded in the skill; the real fix is in the other repo |

**Also verified and correct (no action):** the WS upgrade is auth-gated (`server.mjs:186-200` validates the session cookie and answers `401` before `handleWsUpgrade`), and approval cards use `role="alertdialog"` with a labelled heading (`chat-timeline.tsx:236`).

---

## 4. Implementation phases

Run in order. Each phase ends with its §5 battery and a commit. Do not start a phase before the previous one's battery is green.

### Phase 0 — Deploy hygiene (no code)
1. Review and commit the three dirty files; delete `patch_app.cjs` / `patch_app2.cjs`.
2. `npm run build && systemctl --user restart astra-webui.service`.
3. `scripts/selfcheck.sh http://127.0.0.1:3011` → ALL PASS.
4. Hard-reload the browser; confirm the served `/assets/index-*.js` hash differs from `index-CU7EUQZL.js`.

**Cost:** near zero. **Blocking:** everything — a fix verified against a cached stale bundle is not verified.

### Phase 1 — P0: make the turn work and make failure visible
- 2.1 P0-A: object-parameter `onPickModel` + `src/lib/model-switch.ts` + `.check.ts`.
- 2.2 P0-B: route `prompt.submit` through `rpc()`; add the `{id, error}` catch-all branch; wire `message.error` → `setErrorBanner`.
- 2.3 P0-C: turn watchdog; await queued `config.set` before `prompt.submit`.
- 3.2-C: add `scope: "session"` to the reasoning RPC. **One key — take it here, it prevents an ongoing cross-surface side effect.**

**Diff size:** ~80 lines across 3 files + 2 new small files. Everything in this phase is small-diff / high-blast-radius. Nothing here is speculative.

### Phase 2 — Kill the rest of the silent-failure class
- 3.2-I: settle every `pendingPreTurnRpcs` entry (flush `else`, `resetSession` reject, 30 s timeout).
- 3.2-B: capture the `config.set` result; honour `confirm_required` and `warning`.
- 3.2-H: revert from `getLastSessionInfo()`; banner on every catch; disable config rows when the socket is down.
- 3.2-D: provider row browse-only + `disabled` on empty model lists.
- 3.2-E: catalog error state, Retry, `refreshCatalog()`, delayed 503 retry.
- 3.4: `sendApprovalResponse` returns `boolean`; `respondApproval` only resolves on `true`.
- 3.4: `backoffStep = 0` on successful upstream connect in `hermes-proxy.mjs`.

**Rationale for ordering:** after Phase 1 the user can see *that* something failed. Phase 2 makes every remaining path that can fail actually say so. These are the fixes that turn the next bug report into a one-look diagnosis.

### Phase 3 — Timeline correctness and performance
- 3.1-A: socket reuse at `readyState 0 || 1`; detach handlers on cleanup.
- 3.1-B: `finalizeActive()` at the top of `send()`.
- 3.1-H: namespace tool segment ids; status-preferring `tool-done` match. **Extend `scripts/verify-chat-timeline.ts`.**
- 3.1-C: backlog-aware reveal rate.
- 3.1-D: throttled markdown parse; delegated code-copy handler. **Real engineering — read `safe-tail.ts` first.**
- 3.1-F: `ResizeObserver` pin + `onLoad` on media.

### Phase 4 — Legibility, a11y and cleanup
- Delete the `App.tsx:257` `alert()` stub (it misleads tests and users).
- 3.1-G jump pill; 3.1-K message count; 3.1-I history timestamps.
- 3.1-J `aria-live` restructure (container off, one `role="status"` completion node, `role="alert"` banner).
- 3.2-K `role="menu"` / `menuitemradio` / `aria-checked` on the popover rows.
- 3.2-G `isSysNote` records for model and effort changes; effort sublabels.
- 3.2-J delete the `!menuProvider` guard.
- 3.2-F "Provider default" row always rendered.
- 3.3 residuals: `aria-pressed` on the show/hide toggle; unconditional `role="alert"` container on login; focus trap on the popped-out composer.
- Optional: `setPixelRatio(Math.min(devicePixelRatio, 1.5))` in `tubes-background.tsx`.

### Phase 5 — Repro harness
- Write `scripts/repro-model-switch.mjs` per §5.1 so the P0 path has a permanent regression test that drives the **real** controls.
- Decide on the `/api/me` 200-vs-401 change together with `scripts/selfcheck.sh:23`.

---

## 5. Verification battery

### 5.1 The canonical Playwright repro (use this, not the one that produced the bad payload)

```js
// scripts/repro-model-switch.mjs — run against the REAL origin
// Login over http://127.0.0.1:3011 (Cloudflare 403s a server-side POST to the public URL),
// then plant the cookie on the public domain. The cookie is Secure — never test auth over plain http.
```

1. `POST http://127.0.0.1:3011/api/login {password: $ASTRA_WEBUI_PASSWORD}` → capture `astra_session`.
2. Plant it on `astra.jitinnair.com` via CDP `Network.setCookie` (`secure: true, httpOnly: true, path: "/"`), then `goto("https://astra.jitinnair.com")`.
3. **Before navigation**, inject the frame monitor:
   ```js
   const send = WebSocket.prototype.send;
   WebSocket.prototype.send = function (d) { (window.__out ||= []).push(String(d)); return send.call(this, d); };
   const OW = window.WebSocket;
   window.WebSocket = function (...a) { const s = new OW(...a); s.addEventListener("message", (e) => (window.__in ||= []).push(String(e.data))); return s; };
   ```
   Monitor `/api/hx/ws` — the browser↔relay socket. There is no other socket.
4. Poll for `.app-shell` (the app renders `null` while auth state is `"checking"` — never assert selectors immediately).
5. Click the button with accessible name **"Composer options"** — *not* the sidebar "Model" item.
6. Click provider row `openrouter` → assert **zero** new outbound frames (Phase 2 browse-only fix).
7. Click model row `inkling:free` → assert exactly one outbound `config.set` whose `value` is `"inkling:free --provider openrouter --session"`.
8. Click effort row `Ultra` → assert one outbound `config.set` with `{key:"reasoning", value:"ultra", scope:"session"}`.
9. Type `Test` in the composer, press Enter.
10. Assert within 5 s: an inbound `message.start` **or** a visible error banner. Assert within 130 s: `isStreaming` is false either way (composer enabled, Send button not Stop).

**Known harness traps (from prior sessions, still true):**
- Synthetic React submit needs `keyCode: 13` on the KeyboardEvent — a plain `key: "Enter"` is dropped.
- On React-controlled inputs inside `browser_evaluate`, set values via the native prototype setter plus a dispatched `input` event before clicking.
- Use the Playwright MCP tools (isolated browser instance), never `browser_exec` on the user's own Chrome — concurrent browsing steals the tab pointer mid-script.
- If Playwright reports "Browser is already in use": `pkill -f 'ms-playwright-mcp/mcp-chrome-<profile>'`, then delete `Singleton{Lock,Socket,Cookie}` in the profile dir. Never `pkill` the user's own Chrome.

### 5.2 Per-phase gates

**After every phase, always:**
```bash
npm run build                                  # tsc -b must pass
npm run lint                                   # oxlint
npx tsx scripts/verify-chat-timeline.ts        # must print N/N passed, exit 0
node src/lib/safe-tail.check.ts                # "ok"
node src/lib/model-switch.check.ts             # "ok"  (from Phase 1)
systemctl --user restart astra-webui.service
scripts/selfcheck.sh http://127.0.0.1:3011     # ALL PASS
scripts/selfcheck.sh https://astra.jitinnair.com
```

**Phase 1 additionally:**
- §5.1 steps 1-10 complete, with the exact `config.set` value asserted at step 7.
- Deliberate-failure test: send a bogus model value from the console, then a prompt → error banner within 2 s, composer unlocks.
- Watchdog test: `systemctl --user stop hermes-gateway.service` immediately after Enter → timeout banner within 130 s, composer unlocks. Restart the gateway.
- Config isolation: `diff` `~/.hermes/config.yaml` before and after exercising every effort level → empty.

**Phase 2 additionally:**
- Stop the gateway, reload, open the popover → "Catalog unavailable" with a working Retry (not a permanent "Loading catalog..."). Restart, click Retry → providers appear without reloading.
- Click three provider rows without picking a model → zero `config.set` frames.
- Stop the gateway, pick a model → banner naming the failure, chip reverts, no silent snap-back.
- With the gateway down, click an approval action → the card stays mounted and says "not delivered"; it must not show "Resolved".

**Phase 3 additionally:**
- Duplicate-delivery: prompt `reply with exactly: ABCDEF`; the rendered assistant text equals `ABCDEF` exactly once. Log `browserSockets.size` in the relay = 1 per tab.
- Reveal latency: prompt for ~4,000 characters; wall-clock from the last `message.delta` frame to caret-gone must be < 1 s.
- Performance trace during a long code-heavy response: no long tasks > 50 ms; no frame-rate degradation as the response grows.
- Tool-id reuse: the new `verify-chat-timeline.ts` case passes.
- Orphaned turn: bounce the gateway mid-turn, send a second message; both turns show copy/regenerate rows.
- Scroll pin: last line within 80 px of the container bottom throughout streaming and 500 ms after the final delta.

**Phase 4 additionally:**
- Keyboard-only pass over the whole authenticated shell: every popover row reachable and operable; Escape closes each; focus returns to the trigger.
- Screen reader (Orca): one completion announcement per turn, not a per-token storm; the error banner announces immediately; each model/effort row announces its checked state.
- Viewport matrix on the **login screen specifically** (the untested 3.3 hypothesis): 1920×1080 at 100% and **200% browser zoom**, and **320×256 CSS px**. In every case the submit button must be reachable — scrolling permitted, clipping not. If it clips, then and only then restructure the canvas/content layers.
- Viewport matrix on the chat shell: 390×844 and 1920×1080. Assert `documentElement.scrollHeight - clientHeight === 0` and the composer bottom lands at `window.innerHeight` (the `dvh` rule from the existing skill).
- Console must be clean of unexpected errors at every step.

---

## 6. Open questions — owner decision required

**1. May we edit `~/.hermes/hermes-agent`?**
The standing rule recorded for the Astra project is *zero edits to `~/.hermes/hermes-agent` so `hermes update` can never erase the work*. Three fixes want gateway changes:
- `_set_reasoning` defaulting `scope` to `"session"` (one word, closes 3.2-C for every client, not just this one)
- `_set_reasoning` accepting a clearing value so "Provider default" can actually work (3.2-F)
- mapping non-2xx provider responses to a `message.error` on the session stream (the research brief's core recommendation)

The client-side workarounds in Phase 1 and Phase 2 make all three *safe* without gateway edits, but 3.2-F stays cosmetically broken and any other Hermes surface remains exposed to the scope-omission bug. **Decision needed:** patch the gateway, file it upstream, or accept the client-only ceiling.

**2. Which relay is the research brief about?**
The OpenRouter recommendations (parse `body.error` on a 200, handle `finish_reason: "error"`, treat empty `choices` as `empty_completion`, SSE `: ping` keepalives, raise `max_tokens` under high reasoning effort) all describe the component that talks to OpenRouter. **That is Hermes, not astra-webui.** `server/hermes-proxy.mjs` is a WebSocket relay to the Hermes gateway on `127.0.0.1:9119`; it never sees an OpenRouter response. This plan deliberately implements only the *client* half — watchdog plus legible terminal state — because that is what astra-webui owns and it is sufficient to make the failure visible. **Decision needed:** is the OpenRouter-facing work in scope for this effort at all, and if so does it go in Hermes (see q1) or is it filed separately?

**3. Should there be an inter-chunk stall watchdog as well as a time-to-first-response one?**
Phase 1 bounds "the agent never started" (the actual reported failure) with a 120 s ceiling. It does not bound "the agent started streaming and then stalled at token 400". Bounding that properly needs the stall timer where the SSE stream is — in Hermes. A client-side stall timer is possible but will produce false positives on long reasoning phases, since `thinking.delta` frames may or may not be forwarded depending on provider. **Decision needed:** accept the time-to-first-response bound for now, or invest in a stall bound (and at which layer).

**4. Is the 120 s watchdog ceiling right for `ultra`?**
High reasoning effort on a slow free-tier provider can legitimately produce minutes of silence before the first token. 120 s is a guess. If a real `ultra` turn trips it, raise the constant rather than making it per-model — that is the marked upgrade path in the `ponytail:` comment.

**5. `/api/me`: 401 or 200?**
Returning `200 {"authenticated":false}` cleans the console and makes a zero-console-errors assertion meaningful, but it changes the auth contract and requires updating `scripts/selfcheck.sh:23`, which currently asserts `'{"authenticated":false}'` at an unspecified status. **Decision needed:** change both together, or keep the 401 and just stop the client from surfacing it.

**6. Free-tier OpenRouter — verify before designing around it.**
Nothing in the supplied evidence touches OpenRouter: the run captured zero WebSocket frames, established no WS connection, and never selected the provider. Before any provider-specific work, run one bare `curl` against the exact model id and headers Hermes uses and read the **full body** — `thinkingmachines/inkling:free` reportedly enforces an agentic-harness-only restriction that returns a body-level error on an HTTP 200, and free-tier rate limits key off all-time credits purchased (under $10 lifetime = 20 req/min, 50 req/day, with failed requests counting against the daily quota). If the model is simply not callable, no amount of client work fixes it — but after Phases 1-2 the error text will say so plainly, which is the point.

**7. Domain naming.** `astra-webui.service` is described as "Astra WebUI (test.jitinnair.com)" while the tunnel now serves `astra.jitinnair.com` from `:3011`. Cosmetic, but the unit description is stale and will mislead the next person. Worth one `sed` during Phase 0 if the owner confirms both hostnames should keep resolving.
