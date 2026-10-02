Query: # TASK: Plan the "End session" cleanup pipeline for Astra web UI

You are the planning phase. Produce a build plan only — no code changes. The 
implementer never needs a clarifying question.

## Role
Senior systems planner. Output: file-by-file plan, API surface, DB schema, 
worker design, UI states, per-requirement test checklist, top-3 risks. Terse.

## Verified product context (frozen facts — do not re-verify, do not guess 
beyond these)
- Repo: `~/Work/projects/astra-webui` (vite react-ts + tailwind v4). Zero-dep 
Node server `server/server.mjs` on 127.0.0.1:3011, systemd 
`astra-webui.service`, runs `/usr/bin/node` v22.22.2. Public via CF tunnel.
- `/usr/bin/node` v22.22.2 has `node:sqlite` (`DatabaseSync`, WAL capable). 
Server currently uses NO npm runtime deps; keep it that way.
- Gateway (Hermes) at 127.0.0.1:9119, reached only through server proxy 
`/api/hx/*` (browser cookie-checked, proxy injects its own gateway session).
- History API semantics (MEASURED): rows always oldest-first ascending; 
`order=latest` anchors window at END (offset skips back from newest); 
`order=oldest` anchors at START; use `order=oldest` + paged offsets for a full 
dump.
- `DELETE /api/hx/sessions/<sid>` (through proxy to gateway) deletes the 
session; WS event `sessions.changed` already refreshes the chats sidebar 
(handled in `src/components/chats-panel.tsx`).
- `broadcastFrame(payload)` exported from `server/hermes-proxy.mjs` — 
server→browser WS push, envelope `{method:"event",params:{type,...}}`.
- Chat header with New chat button: `src/components/chat-landing.tsx` (~line 
1537 `onNewChatClick`). Landing/welcome screen = path `/` with `resetSignal` 
bump (App.tsx `onNewChat` handler pattern).
- `hermes` CLI at `/home/notjitin/.local/bin/hermes` supports: `hermes chat 
--oneshot --query-file <f> -m <model> --provider <p> -q <cwd>`; provider `zai`, 
model `glm-5.3-flash`.
- Repo checks pattern: standalone `scripts/*.check.mjs` / `*.ts` run with `npx 
tsx`, assert-based, no test framework.
- Data dir `data/` already holds runtime JSON/ledger files (gitignored 
selectively).

## Requirements
- R1 "End session" button in the chat header, LEFT of the existing New chat 
button. Icon + label, brand style, disabled while a stream is active.
- R2 Click (with one plain-language confirm — the chat will disappear after 
processing) → server dumps the ENTIRE transcript of the current session into a 
new SQLite DB `data/astra-training.db`: sessions table (id, title, source, 
timestamps, message counts, token-ish stats where cheaply available) + messages 
table (full fidelity: role, content, tool_calls JSON, reasoning, timestamps, row
ids) + review_jobs table. Dump must be paged and idempotent (upsert by row id).
- R3 After dump, a review agent (worker) reads the entire session and 
creates/updates relevant skill files, agent docs, and project documentation on 
disk. Worker = `hermes chat` oneshot, model pinned `glm-5.3-flash` provider 
`zai`. It gets: transcript path, current skill/doc inventory paths (READ-ONLY 
listing passed in), and instructions to write/update docs itself. Keep the 
prompt template in a server-side module, versioned.
- R4 Model pin is absolute: glm-5.3-flash or nothing. Worker failure (nonzero 
exit, timeout 20 min, empty output) → job status `awaiting_retry`, 
`next_attempt_at = now + 5h`. A sweeper (60s interval + on boot) retries due 
jobs. Cap retries at 6, then `failed` (visible, kept, transcript still in DB).
- R5 Review success → server deletes the session through the gateway → 
`sessions.changed` refreshes sidebar; job `done`.
- R6 Transcripts stay retrievable: `GET /api/training/sessions` (list) and `GET 
/api/training/sessions/<id>` (full transcript JSON). No UI for retrieval yet — 
API is the contract.
- R7 Ending session returns the user to the landing page with the welcome 
message immediately (UI-side; processing continues server-side).
- R8 Live job status in UI: small status chip + a status panel (recent jobs, 
state, retry countdown) fed by a `training.updated` WS event broadcast on every 
job transition. States: `dumping → reviewing → done | awaiting_retry | failed`. 
Failures always visible in UI, never silent.

## Constraints (ponytail — non-negotiable)
- Zero new npm dependencies. stdlib only (`node:sqlite`, `child_process`, `fs`).
- New server module `server/training.mjs` (worker + DB + sweeper), wired into 
`server/server.mjs` routes. UI additions in `chat-landing.tsx` (+ small 
component file if cleaner). No redesign of existing flows.
- Anti-slop: no stubs, no silent excepts, no dead config. Every state transition
has a real trigger.
- Follow existing code style (2-space, ES modules, React function components).

## Output format (exact)
1. File map: each file → what changes (new/modified, key functions/exports).
2. DB schema: exact CREATE TABLE statements.
3. API surface: method, path, request/response shapes.
4. Worker design: spawn args, prompt template outline, timeout, retry math, 
state machine.
5. UI: component tree for button + status chip/panel, WS event handling, 
navigation on end.
6. Per-requirement test checklist (R1–R8), each with a concrete command or UI 
step.
7. Top-3 risks with mitigations.

## Non-goals
- No actual fine-tuning, no dataset export formats, no training pipeline.
- No retrieval UI.
- No changes to chat streaming, auth, vault, uploads.
- No deletion of anything except the single ended session after successful 
review.

Initializing agent...
────────────────────────────────────────

  ┊ 💻 preparing terminal…
  ┊ 🔎 preparing search_files…
  ┊ 💻 $         ~/.tool-router/route "Plan the End session cleanup pipeline for Astra web UI: SQLite transcript dump, hermes oneshot review worker, retry sweeper, UI status chip"  0.3s [BLOCKED: Security scan — [HIGH] Nested execut...]
  ┊ 🔎 grep      sessions\.changed  0.0s
  ┊ 🔎 grep      order=(oldest|latest)|offset|limit  0.1s
  ┊ 🔎 grep      history  0.0s
  ┊ 🔎 grep      url === |pathname|startsWith\('/api  0.0s
  ┊ 📖 preparing read_file…
  ┊ 🔎 preparing search_files…
  ┊ 📖 read      training.mjs  0.0s
  ┊ 📖 read      server.mjs L60-179  0.0s
  ┊ 🔎 grep      onNewChatClick|New chat  0.0s
  ┊ 🔎 grep      broadcastFrame|export function|export const  0.0s

╭─ ☤ Hermes ───────────────────────────────────────────────────────────────────╮
server/training.mjs already exists (386 lines) — a prior pass landed part of this. Checking how far it got before planning the deltas.
╰──────────────────────────────────────────────────────────────────────────────╯
  ┊ 🔎 preparing search_files…
  ┊ 💻 preparing terminal…
  ┊ 🔎 grep      training|startEndSession|setGatewayCookieProvider|startTrainingSweeper|listReviewJobs  0.0s
  ┊ 🔎 grep      End session|end-session|training\.updated|endSession  0.0s
  ┊ 💻 $         git status --short -- server/ src/ scripts/ + 1 command  0.1s

╭─ ☤ Hermes ───────────────────────────────────────────────────────────────────╮
Draft training.mjs is untracked and unwired (no routes, no boot hook, no UI). Now pulling the exact wiring points for the plan: proxy cookie helper, header markup, WS event pattern, boot section.
╰──────────────────────────────────────────────────────────────────────────────╯
  ┊ 🔎 preparing search_files…
  ┊ 📖 preparing read_file…
  ┊ 🔎 grep      cookie|Cookie|login|auth|session  0.0s
  ┊ 📖 read      chat-landing.tsx L1525-1579  0.0s
  ┊ 📖 read      chats-panel.tsx L95-134  0.0s
  ┊ 📖 read      server.mjs L380-459  0.0s

╭─ ☤ Hermes ───────────────────────────────────────────────────────────────────╮
Two final wiring facts needed: the proxy's /api/hx/ → gateway path rewrite, and App.tsx's onNewChat/resetSignal handler shape.
╰──────────────────────────────────────────────────────────────────────────────╯
  ┊ 🔎 preparing search_files…
  ┊ 🔎 grep      replace.*api/hx|/api/hx/|rewrite|UPSTREAM|target  0.0s
  ┊ 🔎 grep      resetSignal|onNewChat  0.0s

╭─ ☤ Hermes ───────────────────────────────────────────────────────────────────╮
Planning done. Recon found one thing that changes the plan's shape: server/training.mjs already exists as an untracked 386-line draft (dump + worker + sweeper skeleton, zero wiring into server.mjs, zero UI, several defects). Plan below treats it as a draft to revise, not greenfield.

BUILD PLAN — Astra "End session" cleanup pipeline

0. Found state (verified this session)

- server/training.mjs — untracked draft: DB schema, paged dump, worker spawn, retry/sweeper. NOT wired: no route in server.mjs, setGatewayCookieProvider never called, hermes-proxy.mjs exports no cookie getter, no UI, no check script.
- Draft defects the implementer MUST fix (beyond wiring):
  - (a) writeFile(..., () => {}) fire-and-forget — worker can spawn before transcript file exists. Use writeFileSync.
  - (b) docInventory() is dead code — R3 requires the inventory INSIDE the prompt. Wire it into buildReviewPrompt.
  - (c) Spawn uses bare "hermes" + unsupported --no-restore-cwd flag. Use absolute /home/notjitin/.local/bin/hermes, flags only from the frozen verified set.
  - (d) No in-flight guard → user double-click or sweeper-resume spawns duplicate workers for same sid.
  - (e) Sweeper resume passes title=null → title lost after restart. Read back from sessions row.
  - (f) Timeout detected by elapsed-time comparison at exit — misclassifies clean exits near 20 min. Use a timedOut flag set by the timer.
  - (g) No HTTP status check on history pages (401 HTML → confusing parse error). Check statusCode === 200, retry-once after cookie clear on 401.
  - (h) created_at always NULL; no token-ish stats (R2). Fill from first message ts; add token_stats.
  - (i) Review-success path marks done before gateway delete; delete failure only logged. R5 wants delete→done; failure must go to awaiting_retry with a delete-only retry path.
  - (j) .catch(() => {}) silent excepts — replace with logged error path.
  - (k) Hardcoded constants block testing. Env-overridable: TRAINING_DB_PATH, TRAINING_HERMES_BIN, ASTRA_HERMES_URL (draft has this one), TRAINING_REVIEW_TIMEOUT_MS, TRAINING_RETRY_DELAY_MS, TRAINING_SWEEP_INTERVAL_MS.
  - (l) WS payload uses {type, job}; existing events use {type, payload}. Standardize to payload.

1. File map

File: server/hermes-proxy.mjs
New/Mod: mod
Changes: Export existing getHermesCookie and clearHermesCookie (currently
  module-private, lines 13/51). No behavior change.
────────────────────────────────────────
File: server/training.mjs
New/Mod: new (revise draft)
Changes: Exports: openTrainingDb, startEndSession(sid, title, source) → job
  row, listTrainingSessions(), getTrainingSession(sid), listReviewJobs(limit),
  startTrainingSweeper() → interval, setGatewayCookieProvider(fn). Internal:
  dumpAndReview, runReviewWorker, scheduleRetry, deleteSessionViaGateway,
  writeTranscriptExport (sync), docInventory (wired into prompt),
  buildReviewPrompt (+REVIEW_PROMPT_TEMPLATE_VERSION), in-flight running:Set.
  All draft fixes (a)–(l) applied.
────────────────────────────────────────
File: server/server.mjs
New/Mod: mod
Changes: Import training module. Add 4 routes before the /api/hx/ block (line
  ~396), cookie-authed via existing validToken(cookies[COOKIE]) pattern: POST
  /api/training/end-session, GET /api/training/sessions, GET
  /api/training/sessions/<sid>, GET /api/training/jobs. Boot (before
  server.listen, line ~457): setGatewayCookieProvider(getHermesCookie);
  startTrainingSweeper();.
────────────────────────────────────────
File: src/components/chat-landing.tsx
New/Mod: mod
Changes: Header right cluster (line ~1557): insert TrainingStatus chip +
  End-session button LEFT of New chat. onEndSession: two-step inline confirm
  (first click arms "End it? / Keep", auto-disarm 4 s) → POST
  /api/training/end-session {sid,title} → on 2xx call existing
  onNewChatClick() (resetSignal bump + setSelectedSessionId(null) → landing +
  welcome, R7). disabled={isStreaming} (var already exists, used line 1536).
────────────────────────────────────────
File: src/components/training-status.tsx
New/Mod: new
Changes: TrainingStatus() — chip (latest active job state, colored dot) +
  dropdown panel (recent jobs: sid tail, title, state, attempts/6, retry
  countdown from next_attempt_at, last_error on hover/collapsed row). Listens
  window.addEventListener("astra-ws-event") for type === "training.updated"
  (same pattern as chats-panel line 114). Initial + on-open fetch GET
  /api/training/jobs?limit=20. 1 s interval tick ONLY while panel open and an
  awaiting_retry job visible (countdown).
────────────────────────────────────────
File: scripts/training-pipeline.check.mjs
New/Mod: new
Changes: Assert-based, no framework, node scripts/training-pipeline.check.mjs.
  Stubs: local http.createServer fake gateway (scripted pages + DELETE
  counter), fake hermes shell scripts (success+FILE: lines / exit 1 /
  sleep-timeout / empty), scratch TRAINING_DB_PATH under
  ~/.hermes/cache/scratch. Covers R2/R3/R4/R5 logic.
────────────────────────────────────────
File: .gitignore
New/Mod: mod
Changes: Add data/astra-training.db* (covers -wal/-shm),
  data/training-exports/.

2. DB schema (data/astra-training.db, WAL)

sql
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  title TEXT,
  source TEXT,
  created_at INTEGER,            -- ts of first message (was NULL in draft)
  ended_at INTEGER NOT NULL,
  message_rows INTEGER NOT NULL,
  token_stats TEXT,              -- JSON: {user_msgs,assistant_msgs,tool_calls,total_chars}
  review_status TEXT NOT NULL DEFAULT 'dumped'  -- dumped|reviewed|deleted
);
CREATE TABLE IF NOT EXISTS messages (
  sid TEXT NOT NULL,
  row_id TEXT NOT NULL,
  ts REAL,
  role TEXT NOT NULL,
  content TEXT,
  tool_calls TEXT,               -- JSON exactly as gateway returned
  reasoning TEXT,
  PRIMARY KEY (sid, row_id)      -- upsert key = idempotent dump
);
CREATE TABLE IF NOT EXISTS review_jobs (
  sid TEXT PRIMARY KEY,
  status TEXT NOT NULL,          -- dumping|reviewing|done|awaiting_retry|failed
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,       -- epoch ms
  last_error TEXT,
  worker_log TEXT,               -- last 8 KB of worker output incl. FILE: lines
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_sid ON messages(sid);


3. API surface (all cookie-authed, JSON)


POST /api/training/end-session
  req  {sid: string, title?: string}
  res  202 {job: review_jobs row}           -- returns immediately, processing async
       409 {error:"already active"}         -- non-terminal job exists (returned, not restarted)
       400 {error:"sid required"}

GET /api/training/sessions
  res  200 {sessions: [{sid,title,source,created_at,ended_at,message_rows,token_stats,
                        review_status, job_status, attempts, next_attempt_at, last_error}]}

GET /api/training/sessions/<sid>
  res  200 {session: {...}, messages: [{row_id,ts,role,content,tool_calls,reasoning}...],
            job: {...}}                     -- messages ordered ts ASC, row_id ASC
       404 {error:"not found"}

GET /api/training/jobs?limit=20
  res  200 {jobs: [review_jobs rows ORDER BY updated_at DESC]}

WS event (existing /api/hx/ws): {method:"event",params:{type:"training.updated",
                                   payload:<review_jobs row>}}  on every transition


4. Worker design

Spawn (absolute path, frozen flag set only):

/home/notjitin/.local/bin/hermes chat --oneshot \
  --query-file data/training-exports/<sid>.review-prompt.md \
  -m glm-5.3-flash --provider zai -q "$HOME"
stdio: ["ignore","pipe","pipe"], env: process.env


Prompt template (module const, REVIEW_PROMPT_TEMPLATE_VERSION = 1 stamped into prompt header + worker_log):
1. Role: session reviewer for Astra's end-of-session pipeline.
2. Input: transcript path (markdown export, full fidelity incl. <reasoning>/<tool_calls> blocks), session id/title.
3. Inventory (READ-ONLY listing, from docInventory()): skills ~/.hermes/skills/ dirs (cap 200), agent docs ~/.hermes/, projects ~/Work/projects/ dirs.
4. Tasks: update touched skills' SKILL.md lessons; new skill only if repeatable procedure with no home; SOUL.md only for durable owner preference; project AGENTS.md/docs with proven commands/pitfalls.
5. Rules: surgical edits; only what the transcript PROVES (commands actually run + real outcomes); trivial session → write nothing.
6. Output contract: last lines FILE: <path> per touched file, else FILE: none (parsed into worker_log).

Timeout/retry math:
- Timeout 20 min (TRAINING_REVIEW_TIMEOUT_MS): SIGKILL + timedOut=true flag → failure.
- Failure = nonzero exit | timeout | empty stdout. → attempts += 1; awaiting_retry, next_attempt_at = now + 5h (TRAINING_RETRY_DELAY_MS); attempts >= 6 → failed (terminal, transcript kept, visible).
- Sweeper: boot + every 60 s. Due awaiting_retry → reviewing → worker. Stale dumping|reviewing (>25 min unchanged, restart recovery) → re-run full dump (idempotent upserts) with title read back from sessions.
- In-flight Set<sid> guards every spawn path against duplicates.
- Delete-only path: if sessions.review_status = 'reviewed' and job is due, skip worker, retry only the gateway delete.

State machine:

click → dumping → reviewing → [worker ok] → DELETE gateway → done
                 ↘ dump error → awaiting_retry ──(60s sweeper, due)──→ reviewing
                 ↘ worker fail/timeout/empty → awaiting_retry (attempts++, +5h)
                 ↘ delete fail (post-review) → awaiting_retry (delete-only retry)
awaiting_retry ×6 failures → failed (terminal)
every transition → training.updated WS push


5. UI


header (chat-landing.tsx ~1557)
└─ span (right cluster)
   ├─ <TrainingStatus/>                      (new component)
   │  ├─ chip: dot + state text (latest non-done job) | nothing when idle
   │  └─ panel (toggle): job rows — state badge, title/sid tail,
   │      attempts/6, countdown "retry in 4:59:xx" (awaiting_retry),
   │      last_error; live via astra-ws-event training.updated
   ├─ [End session] LogOut icon + label      (LEFT of New chat)
   │   disabled: isStreaming || endFlow!=="idle"
   │   click 1 → armed: "This chat gets saved for review, then removed
   │             from your list. [End it] [Keep]" (4 s auto-disarm)
   │   click 2 → POST /api/training/end-session → onNewChatClick()
   │             → resetSignal++ + selectedSessionId(null) → "/" landing
   │             + welcome (immediate, R7; processing continues server-side)
   └─ [New chat] (existing, untouched)


WS: training.updated → TrainingStatus state (payload = job row upsert by sid). Sidebar refresh needs zero new code — gateway delete emits sessions.changed, chats-panel line 116 already handles it (R5).

6. Per-requirement test checklist

R: R1
Check: npm run build (tsc) clean. UI: button renders left of New chat; while
  streaming, disabled; label+icon present.
────────────────────────────────────────
R: R2
Check: node scripts/training-pipeline.check.mjs — stub gateway serves 450 msgs
  across 3 pages → assert message_rows=450, ordering, created_at=first ts,
  token_stats JSON; re-run dump → still 450 rows (idempotent upsert).
────────────────────────────────────────
R: R3
Check: Same script, fake hermes success: assert spawn args contain -m
  glm-5.3-flash --provider zai; prompt file contains transcript path,
  inventory lines, version stamp; FILE: lines captured in worker_log.
────────────────────────────────────────
R: R4
Check: Same script: fake hermes exit 1 → awaiting_retry, next_attempt_at ≈
  now+5h, attempts=1; sleep-fake + shrunk TRAINING_REVIEW_TIMEOUT_MS → timeout
  path; loop 6 failures → failed, transcript rows still queryable.
────────────────────────────────────────
R: R5
Check: Same script: stub gateway DELETE counter ≥1 and 2xx → done,
  review_status='deleted'; DELETE 500 → awaiting_retry, delete-only retry
  fires without worker re-run. Manual: end a real session, sidebar entry
  disappears via sessions.changed with no reload.
────────────────────────────────────────
R: R6
Check: curl -b "$COOKIE" http://127.0.0.1:3011/api/training/sessions and
  .../sessions/<sid> → JSON shapes above; unknown sid → 404. (Cookie via
  existing POST /api/login.)
────────────────────────────────────────
R: R7
Check: UI: confirm End session → landing + welcome instantly while chip shows
  Reviewing (proves processing continued).
────────────────────────────────────────
R: R8
Check: UI: chip transitions dumping→reviewing→done without reload (WS); sudo
  systemctl stop gateway mid-job → chip shows awaiting_retry + countdown;
  failed job stays listed in panel. Unauth'd curl (no cookie) → 401.

7. Top-3 risks

1. Gateway cookie expiry mid-dump/delete — cached hermes_session ages out during a long job → 401s, jobs churn retries. Mitigation: status-check every page, on 401 clearHermesCookie() + retry page once (proxy's getHermesCookie re-logins); persistent failure → awaiting_retry, self-heals at next attempt.
2. Worker blast radius on the real doc estate — a hallucinating review edits SOUL.md/skills wrongly, and ~/.hermes is not git-tracked. Mitigation: conservative prompt (PROVEN facts only, surgical edits, "write nothing if trivial"), model pin, FILE: audit lines persisted in worker_log; optional pre-run tar snapshot of touched roots listed in inventory is a one-liner the implementer may add if trivial.
3. Duplicate/concurrent workers (double-click, sweeper-vs-running, restart resume) — double doc edits, wasted burns. Mitigation: in-flight Set on every spawn path + POST returns existing non-terminal job as 409 instead of restarting + stale-resume only after 25 min quiet.

Non-goals held: no fine-tuning/export, no retrieval UI, streaming/auth/vault/uploads untouched, only deletion is the single ended session post-successful-review.
╰──────────────────────────────────────────────────────────────────────────────╯

Resume this session with:
  hermes --resume 20261001_013509_2ce345
  hermes -c "Plan end session cleanup pipeline"

Session:        20261001_013509_2ce345
Title:          Plan end session cleanup pipeline
Duration:       5m 44s
Messages:       25 (1 user, 23 tool calls)
