// Per-canvas reactive state: three defects, pinned by source shape (2026-10-05).
//
// A. A re-parse that emitted the SAME state values with a DIFFERENT key order
//    silently reset every slider the user had moved. canvasStore compared
//    `JSON.stringify(initial)`, which makes key order part of the identity;
//    model output is not key-stable and the sanitizer copies `state` through
//    untouched, so nothing normalised it.
// B. The store LRU evicted by INSERTION ORDER with no liveness check, so on a
//    page with >24 canvases it could evict the store of a card still on screen.
//    That card's control snapped back and every later write went to an orphan
//    store no mounted component was subscribed to — permanently frozen.
// C. useCanvasReset read `(store as {__id?: string}).__id`, and `__id` was never
//    assigned anywhere in the repo, so reset was always a silent no-op.
//
// All three were live while the whole existing suite passed.
//
// WHY THIS FILE ASSERTS SOURCE TEXT INSTEAD OF IMPORTING THE MODULE:
// canvas-state.tsx is a .tsx, and Node cannot type-strip JSX at all
// (ERR_UNKNOWN_FILE_EXTENSION). The runner is bare `node` +
// scripts/ts-resolve-hooks.mjs, whose CANDIDATE_EXTS has no `.tsx` entry, and
// no existing check in this repo imports a .tsx either — so an import-based
// version of this gate dies under `npm run check` while passing standalone
// under tsx. (Repo lesson, 2026-10-03: 22 of 50 checks were dead for exactly
// this reason.) The BEHAVIOUR is verified against the real module by
// src/lib/canvas-state.behaviour.mts under tsx; this gate keeps `npm run
// check` honest about the source that produces it.
//
// Run: node --import ./scripts/ts-resolve-hooks.mjs src/lib/canvas-state-keepalive.check.ts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(HERE, "../components/canvas/canvas-state.tsx"), "utf8");
// Strip comments first, so a comment can never satisfy an assertion.
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// A — key-order-independent change detection
assert.ok(
  !/const\s+(?:authored|sig)\s*=\s*JSON\.stringify/.test(code),
  "canvasStore still derives its change signature from raw JSON.stringify — key order becomes part of the identity",
);
assert.ok(/function stableSig/.test(code), "stableSig (key-order-independent signature) is missing");
assert.ok(/Object\.keys\([^)]*\)\.sort\(\)/.test(code), "stableSig must sort keys before comparing");

// B — eviction must skip mounted stores, and prune sAuthored with it
assert.ok(/mounted\s*=\s*0/.test(code), "CanvasStore has no `mounted` counter");
assert.ok(
  /\.mounted > 0\) continue;/.test(code),
  "eviction does not skip MOUNTED stores — a visible card can be evicted and then frozen",
);
assert.ok(
  /storeMap\.delete\(id\);[\s\S]{0,140}sAuthored\.delete\(id\);/.test(code),
  "sAuthored is not pruned alongside storeMap — it leaks one entry per canvas id, forever",
);

// C — the store must carry the id reset reads; never read an unassigned field
assert.ok(/readonly id: string/.test(code), "CanvasStore must carry its own id");
assert.ok(/sAuthored\.get\(s\.id\)/.test(code), "useCanvasReset must look up by the store's real id");
assert.ok(!/__id/.test(code), "`__id` is referenced but was never assigned anywhere — reset was a silent no-op");

console.log("canvas-state-keepalive: 8 source-shape asserts OK");