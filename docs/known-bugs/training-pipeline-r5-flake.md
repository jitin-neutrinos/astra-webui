# scripts/training-pipeline.check.mjs — R5 flake (FIXED 2026-10-03)

## Status

**FIXED.** 12/12 consecutive passes after the change. No longer excluded from
the live regression gate (RG-028 runs live again).

This file is kept as the record of *why* the harness was wrong, so the same
shape is not reintroduced.

## What R5 proves

The training sweeper must survive a gateway delete that fails **after** the
review step succeeds:

1. `dumpAndReview` completes → `review_status = 'reviewed'`
2. gateway `DELETE /api/sessions/<sid>` returns **500**
3. job goes to `awaiting_retry`, and the retry must be **delete-only** (docs
   already written; only the delete is retried)
4. once the gateway recovers, the retry lands → `review_status = 'deleted'`,
   `status = 'done'`, delete attempted **>= 2** times

The product behaviour is and was correct — `finishReview` writes `'deleted'`
before `'done'`, which is the required order.

## Two independent races, both in the harness

### Race 1 — the parent's timer flip

The old fake gateway shared a mutable `deleteStatus`, flipped 500 → 200 by the
parent only after a **fixed 500 ms settle**:

```js
for (let i = 0; i < 400 && (deleteCounts.sess_del || 0) < 1; i++) await sleep(100);
await sleep(500);
deleteStatus = 200;
```

The scenario child runs with `TRAINING_RETRY_DELAY_MS=100` and
`TRAINING_SWEEP_INTERVAL_MS=200`, so retries fired roughly every 200 ms —
**three times inside that 500 ms window**, each answered 500. Whether the
child's poll ever saw `done` was therefore timing-dependent.

Instrumented fake-gateway log from a failing run:

```
[gw] DELETE sess_del attempt=1 status=500 t=14922
[gw] DELETE sess_del attempt=2 status=500 t=15121
[gw] DELETE sess_del attempt=3 status=500 t=15322
[gw] DELETE sess_del attempt=4 status=200 t=15523
```

**Fix:** fail exactly the first delete for `sess_del`, answer 200 from then on.
No parent-side timer participates:

```js
const status =
  del[1] === "sess_del" && failFirstDelete && deleteCounts[del[1]] === 1 ? 500 : 200;
```

Note the gate is on the **attempt number**, not on the flag — `failFirstDelete`
stays true for the whole scenario, so keying the failure on the flag alone
would 500 every retry and fail deterministically instead.

### Race 2 — sampling a transient state

The old child loop also gated on *catching* `awaiting_retry` mid-flight:

```js
if (j.status === "awaiting_retry" && j.last_error.includes("delete")) { sawDeleteRetry = true; break; }
if (j.status === "done") break;
...
if (!sawDeleteRetry) { say({ ... note: "no delete failure observed" }); process.exit(0); }
```

The retry period (200 ms) equals the poll period (200 ms), so the retry could
land and reach `done` **before the poll ever sampled `awaiting_retry`**. The
loop then broke on `done` with `sawDeleteRetry === false` and took the early
exit, which surfaced as the misleading `"no delete failure observed"`.

**Fix:** wait for the **terminal** state only, and prove the retry from the
parent's authoritative attempt counter, which cannot be raced:

```js
if (j && (j.status === "done" || j.status === "failed")) break;
...
assert.ok((deleteCounts.sess_del || 0) >= 2, `expected >=2 delete attempts, got ${deleteCounts.sess_del}`);
```

## Ruled out (do not re-investigate)

- **WAL sidecars.** `rmSync(t.db)` leaves `-wal`/`-shm`, but `node:sqlite`
  checkpoints and removes them on clean close. Verified with a standalone repro.
- **Leftover scratch.** `mkdtempSync` is unique per run; `finally` wipes it.
- **Port reuse.** The fake gateway binds port `0` (ephemeral).

## Lesson

A test that asserts on a *transient* state is a timing test wearing a
correctness costume. Assert on terminal states and on counters owned by the
harness, never on a state that a background worker passes through.
