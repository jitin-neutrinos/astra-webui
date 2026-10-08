# End-session review — session 20261004_170204_93a8db (append-only note)

Reviewer pass 2026-10-04. What this session proved about the pipeline and the
tools — nothing here changes the pipeline itself.

**What the session did:** reviewed transcript 20261004_103900_c3d723 (the Taal
code-only port review) end to end in one read_file pass (336 lines), judged
c3d723's main durable lessons already encoded in
`~/.hermes/skills/dev/strangler-fig-rust-port/SKILL.md` (completion-status
review recipe: ps-first campaign poll, git-log ground truth, ledger-as-code-truth,
both percent-from-ledger parse traps, live-campaign read-only), and pinned the
one genuinely new lesson there — the execute_code kernel-cwd trap (relative
`read_text('parity/audit_symbols.py')` under the kernel's scratch cwd →
FileNotFoundError; run scripts with explicit `cwd=` / absolute paths). That
patch is verified present live (line 184) during this note's pass.

**Tool gotcha — search_files nested globs score 0 on this data. In-session
proof: `file_glob: "**/SKILL.md"` returned total_count 0 twice; the follow-up
with bare `SKILL.md` returned both Taal-related skills. Re-verified live during
this note's pass (same content pattern, only the glob differing): `**/SKILL.md`
→ 0, bare `SKILL.md` → 2.** Confounded within the session itself (pattern also
differed), hence the independent re-run before recording. Use the bare filename
when content-searching SKILL.md files; a leading `**/` silently narrows to
nothing here.

**Second pass 2026-10-05 (same sid, re-review):** read the transcript again in one
`read_file` pass and found no new delta on the reviewed work — the `strangler-fig-rust-port`
cwd-trap patch is still verified live at SKILL.md:179-184, and both this note's tool-gotcha
paragraphs are already generalised into
`~/.hermes/skills/projects/astra-webui/references/training-pipeline.md`. The only new fact
the re-pass produced was environmental: `execute_code` was blocked again, with different
wording than the message quoted above (see the training-pipeline bullet). Captured there.

**No other estate changes:** no SOUL.md edit, no new skill, no taal repo edits
(~/Work/taal is outside the ~/Work/projects estate and the underlying session
was review-only by owner instruction). Deliverable was one skill patch + FILE:
line, and that is all this reviewer pass adds.
