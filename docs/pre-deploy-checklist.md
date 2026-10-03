# Pre-deploy checklist — astra-webui

Fixes are committed as they are found, but **nothing is live until it is deployed**. When an
owner report says a fix is going "on the list to change before deploying", it lands here so
the set survives session boundaries.

Last reviewed: 2026-10-04.

## Ready to deploy (committed, NOT live)

| # | Fix | Commit | Surface it affects |
|---|---|---|---|
| 1 | Tool cards rendered the raw result envelope; nested/array/error shapes leaked `"output"` keys into the card body | `34e76a0` | every tool card with output |
| 2 | **The actual duplication cause**: `chat-timeline` described the RAW envelope, yielding an `Output` row whose value *was* the payload, while the terminal window rendered the same text again. Now unwrapped first, so the payload appears exactly once. | `3687adf` | edit-file + code-execute cards, and every non-terminal card with output |

Why it varied ("duplicated 2 or 3 times"): the number of rows the envelope produced decided
how many times the payload was rendered. A richer envelope → more rows → more copies.

Verified for fix 2: 6/6 envelope shapes render one field and no window; `term-envelope.check.ts`
16 → 18 tests pinning the composition; `npm run check` 60 passed.

## Known failure that is NOT mine

- `scripts/regression-gate.check.mjs` fails on a clean tree: it wants
  `src/lib/skeleton-grey.check.ts` added to its manifest ("unpinned"). Predates both fixes
  above; reproduced with them removed.

## Deploy steps

1. `npm run verify` — lint, build, and the full check suite.
2. Restart the server serving `astra.jitinnair.com` (the `next start` process, up since 2026-09-29).
3. Verify live: open an `edit_file` or `execute_code` card, expand it, and confirm the output
   text appears **once** and no `"output"` key line is visible.
4. Hard-refresh the Android app (Capacitor loads the same URL).

Roughly 10–30s of downtime at step 2. Reversible by restarting the previous build.

## Rules for this file

- Add the row **when the fix is committed**, not when it is deployed.
- Mark it live only after step 3 above actually passes on the live URL.
- A fix that was never verified against a rendered DOM goes in a separate "needs DOM check"
  section, not the ready list.