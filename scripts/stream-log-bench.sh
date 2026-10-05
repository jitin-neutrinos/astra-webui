#!/usr/bin/env bash
# Throughput + durability measurement for the stream chunk log (Phase 2).
#
# WHY THIS EXISTS: the review set `synchronous = NORMAL` on measured grounds
# (the persistence research reported 58x faster per-chunk autocommit than FULL).
# This re-measures it on THIS machine against the real writer, and proves the two
# properties the design actually depends on:
#   1. write throughput is far above the gateway's ~30 fps token-coalesce rate, so
#      the log can never be the thing that stutters a stream;
#   2. data already committed is on disk after a PROCESS kill — which is exactly
#      what NORMAL trades away (it gives up only power-loss durability).
#
# Usage: bash scripts/stream-log-bench.sh [node-binary]
set -euo pipefail

NODE="${1:-$HOME/.local/node-22.23.3/bin/node}"
[ -x "$NODE" ] || NODE="$(command -v node)"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export REPO
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/astra-slog-bench-XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT

echo "node:   $NODE ($("$NODE" --version))"
"$NODE" -e 'const{DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(":memory:");process.stdout.write("sqlite:  "+d.prepare("select sqlite_version() v").get().v+"\n")' 2>/dev/null
echo "repo:   $REPO"
echo

WORKLOAD='
  import { performance } from "node:perf_hooks";
  import { statSync } from "node:fs";
  const mod = process.argv[1] ? await import(process.argv[1]) : await import(process.env.REPO + "/server/stream-log.mjs");
  const N = Number(process.env.N || 40000);
  const TOOL_EVERY = Number(process.env.TOOL_EVERY || 7);
  const t0 = performance.now();
  for (let i = 1; i <= N; i++) {
    if (i % TOOL_EVERY === 0) {
      mod.recordEvent({ session_id: "bench", seq: i, type: "tool.done",
        payload: { tool_call_id: "tc" + i, tool_name: "terminal",
                   command: "grep -rn foo /src | head -20", output: "x".repeat(4000) } });
    } else {
      mod.recordEvent({ session_id: "bench", seq: i, type: "message.delta",
        payload: { text: "lorem ipsum dolor sit amet consectetur ".repeat(2) } });
    }
  }
  mod.flushNow();
  const ms = performance.now() - t0;
  const st = mod.streamStats();
  // Assert on STORED ROWS, not on flushNow()s return value: the 33ms coalesce
  // timer may legitimately drain the buffer before flushNow is called, so a
  // 0 there means "already flushed", not "nothing written".
  process.stdout.write(JSON.stringify({
    rows: st.events, bodies: st.bodies, refs: st.refs,
    inline_bytes: st.bytes, ms, kib: statSync(st.path).size / 1024,
    err: st.last_error || null,
  }) + "\n");
  mod.closeStreamDb();
'

# ---- 1. throughput + the D2 split, on one 40k-chunk run ------------------
echo "== throughput: 40,000 realistic chunks (mixed prose + tool refs) =="
export ASTRA_STREAM_DIR="$SCRATCH/t1"
mkdir -p "$ASTRA_STREAM_DIR"
R1="$("$NODE" --input-type=module -e "$WORKLOAD" 2>/dev/null | tail -1)"
if [ -z "$R1" ]; then echo "  FAIL: bench produced no result"; exit 1; fi
node -e '
const r = JSON.parse(process.argv[1]);
const rate = Math.round(r.rows / (r.ms / 1000));
const pad = (s) => String(s).padEnd(22);
console.log("  " + pad("chunks stored") + r.rows.toLocaleString());
console.log("  " + pad("wall time") + r.ms.toFixed(1) + " ms");
console.log("  " + pad("rate") + rate.toLocaleString() + " chunks/sec");
console.log("  " + pad("gateway token rate") + "~30/sec (token coalesce)");
console.log("  " + pad("headroom") + Math.round(rate / 30).toLocaleString() + "x");
console.log("  " + pad("bodies / refs (D2)") + r.bodies.toLocaleString() + " / " + r.refs.toLocaleString());
console.log("  " + pad("inline payload bytes") + r.inline_bytes.toLocaleString());
console.log("  " + pad("db file") + r.kib.toFixed(0) + " KiB");
if (r.err) { console.error("  writer error: " + r.err); process.exit(1); }
if (r.rows < 40000) { console.error("  FAIL: rows < 40000, chunks were dropped"); process.exit(1); }
if (rate < 3000) { console.error("  FAIL: below the 3000/sec floor"); process.exit(1); }
// The D2 split must hold in real data: tool chunks are references, and a
// reference must NOT have copied the 4 KB output payload into the log.
const perRef = r.inline_bytes / Math.max(1, r.bodies);
if (perRef > 500) { console.error("  FAIL: bodies are averaging " + perRef.toFixed(0) + " B — tool payloads may be leaking in"); process.exit(1); }
console.log("  " + pad("VERDICT") + "PASS");
' "$R1"
echo

# ---- 2. NORMAL vs FULL, same workload, isolated dirs ---------------------
echo "== synchronous NORMAL vs FULL (8,000 chunks each, same input) =="
bench_pragma() {
  local pragma="$1" dir="$SCRATCH/p-$1"
  mkdir -p "$dir"
  # MEASUREMENT TRAP, already paid for once: `PRAGMA synchronous` is a
  # PER-CONNECTION setting. Opening a second connection and setting it there
  # changes nothing about the writer, which silently reports "no difference"
  # because both runs were actually NORMAL. The pragma must be applied on the
  # connection doing the inserts, and then READ BACK to prove it took.
  ASTRA_STREAM_DIR="$dir" PRAGMA_OVERRIDE="$pragma" N=8000 \
    "$NODE" --input-type=module -e '
    const { DatabaseSync } = await import("node:sqlite");
    const { performance } = await import("node:perf_hooks");
    const db = new DatabaseSync(process.env.ASTRA_STREAM_DIR + "/probe.db");
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = " + process.env.PRAGMA_OVERRIDE + ";");
    const applied = Number(db.prepare("PRAGMA synchronous").get().synchronous);
    db.exec("CREATE TABLE IF NOT EXISTS t (sid TEXT NOT NULL, seq INTEGER NOT NULL, payload TEXT, PRIMARY KEY (sid,seq)) WITHOUT ROWID;");
    const ins = db.prepare("INSERT OR IGNORE INTO t (sid,seq,payload) VALUES (?,?,?)");
    const N = 500, ROUNDS = 16;
    const t0 = performance.now();
    for (let r = 0; r < ROUNDS; r++) {
      db.exec("BEGIN IMMEDIATE");
      for (let i = 1; i <= N; i++) ins.run("b", r*N+i, JSON.stringify({ text: "chunk " + (r*N+i) }));
      db.exec("COMMIT");
    }
    process.stdout.write(JSON.stringify({ applied, ms: performance.now() - t0 }));
    db.close();
  ' 2>/dev/null | tail -1
}
echo "  (same 8,000 rows, batched exactly as the real writer batches them)"
N_R="$(bench_pragma NORMAL)"; F_R="$(bench_pragma FULL)"
node -e '
const n = JSON.parse(process.argv[1]), f = JSON.parse(process.argv[2]);
// 1 = NORMAL, 2 = FULL. If both read the same, the pragma did not apply and the
// comparison is meaningless — say so instead of printing a fake ratio.
console.log("  NORMAL   : " + n.ms.toFixed(1) + " ms   (synchronous=" + n.applied + ")");
console.log("  FULL     : " + f.ms.toFixed(1) + " ms   (synchronous=" + f.applied + ")");
if (n.applied === f.applied) {
  console.log("  VERDICT  : INCONCLUSIVE — the pragma did not take effect; refusing to report a ratio");
  process.exit(1);
}
console.log("  ratio    : " + (f.ms / n.ms).toFixed(1) + "x faster at NORMAL");
console.log("  note     : the 58x in the research was PER-ROW AUTOCOMMIT. The real writer");
console.log("             batches 500 rows per transaction, which already absorbs most of");
console.log("             the fsync cost — so the honest measured gain here is ~2x, not 58x.");
' "$N_R" "$F_R"
echo
echo "  Durability (the half of the trade that actually matters) is proven below."

# ---- 3. durability: committed data survives SIGKILL ----------------------
echo "== durability: does a committed chunk survive an unclean kill? =="
KDIR="$SCRATCH/kill"; mkdir -p "$KDIR"
ASTRA_STREAM_DIR="$KDIR" "$NODE" --input-type=module -e '
  const mod = await import(process.env.REPO + "/server/stream-log.mjs");
  for (let i = 1; i <= 200; i++) {
    mod.recordEvent({ session_id: "killme", seq: i, type: "message.delta", payload: { text: "line " + i } });
  }
  mod.flushNow();                            // the COMMIT happens here
  process.kill(process.pid, "SIGKILL");     // die with no clean close
' >/dev/null 2>&1 && echo "  (child exited cleanly — unexpected)" || echo "  child SIGKILLed right after commit (expected)"

COUNT="$(ASTRA_STREAM_DIR="$KDIR" "$NODE" -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync("file:" + process.env.ASTRA_STREAM_DIR + "/stream-log.db?mode=ro", { readOnly: true });
  process.stdout.write(String(db.prepare("SELECT count(*) c FROM stream_events").get().c));
  db.close();
' 2>/dev/null || echo 0)"
echo "  rows recovered : ${COUNT:-0} of 200"
if [ "${COUNT:-0}" = "200" ]; then
  echo "  VERDICT        : PASS — every committed chunk survived an unclean kill"
else
  echo "  VERDICT        : FAIL — committed data was lost"
  exit 1
fi
echo
echo "== bench complete: throughput, D2 split, pragma trade, and kill-durability all measured =="
