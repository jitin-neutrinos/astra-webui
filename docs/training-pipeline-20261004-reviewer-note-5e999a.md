# End-session review — session 20261004_170210_5e999a (append-only note)

Reviewer pass 2026-10-04, one-shot worker reviewing the 2026-10-03 session
`20261003_173159_ef777e` (Taal row-67 port + Astra tool-card duplication fix;
11,172 transcript lines / 2.0 MB). Third same-day reviewer note — see also
`training-pipeline-20261004-reviewer-note.md` and
`training-pipeline-20261004-reviewer-note-93a8db.md`.

## What this run proved about the pipeline (for the next maintainer)

- **Review-prompt pairing differs between end-session and backfill.** The
  reviewed sid 20261003_173159_ef777e was dumped by its own session on
  2026-10-03, and its `.review-prompt.md` was already on disk when this run
  started; yesterday's backfill exports (93a8db / c3d723 / b3ddb0) carry
  prompt files with same-day (2026-10-04) stamps. When a backfill job sits
  without a review, check the prompt file first — end-session and backfill
  fan out from different call sites.
- **A review of a 2 MB transcript is not the 197-row one-read case.** 70
  exported rows of THIS transcript render to ~11k output lines; the "one
  read_file pass is enough" estimate from the a69306 note does not transfer to
  long multi-arc transcripts — size the read plan from the byte/x-count, then
  page with read_file offset calls.

## Evidence base (all verified on disk, not from the prior session's claims alone)

- Verified the prior reviewer session's FILE: claims landed before trusting
  them: 4/4 markers present in
  `~/.hermes/skills/dev/strangler-fig-rust-port/SKILL.md` (mutation-list
  partitioning when a file is ported in layers, the cross-file anchor race,
  survivor triage into no-op/broken/gap, boundary-fixture constructibility);
  2/2 markers present in
  `~/.hermes/skills/projects/astra-webui/SKILL.md` (the two-layer
  duplicated-output root cause with both commit hashes 34e76a0/3687adf; the
  repo-file pre-deploy-checklist convention).
- `docs/pre-deploy-checklist.md` exists in-repo (created by the reviewed
  session itself, commit c11151d) — verified via transcript; no edit needed.
- No SOUL.md change: nothing in the reviewed session established a durable
  owner preference not already recorded (the "add to the list before
  deploying" operating rule lives in the repo checklist file where it
  belongs).
- The TAAL repo (~\/Work/taal, outside the ~/Work/projects/ inventory this
  prompt indexes): its HANDOFF.md / PORT-STATUS.md were already updated by
  the reviewed session itself (commits 6a3399f, 2537359) — the reviewer did
  not duplicate that, only referenced it from the strangler skill.

## Reviewer-mode environment facts (this run, 2026-10-04)

- `terminal` and `execute_code` shell/Python-exec calls are approval-gated in
  one-shot reviewer mode (profile `default`, no user present; each attempt
  returns BLOCKED with the `approvals.single_query_mode` hint) — while file
  tools (read_file, write_file, patch, search_files) run ungated. A reviewer
  session must scope its evidence base to file reads/writes alone, or budget
  one wasted call per shell need. Same fail-open class as the `tool-router`
  block already documented in docs/training-pipeline.md §"Pitfalls proven the
  hard way", but this applies to EVERY shell/exec tool in a reviewer session,
  not just the router.
- `search_files` with bare `file_glob: SKILL.md` is the right form — matches
  the 93a8db skill note ("use bare SKILL.md, not `**/SKILL.md`"); a
  repo-wide content scan for the inventory wastes rows.

## Self-correction proven this run

- First use of `patch` to rewrite half the note failed with "Could not find a
  match" (the old_string was composed from memory, not from the read file) —
  read_file, then write_file with verified content, is the reliable loop when
  composing a fresh append-only note.
