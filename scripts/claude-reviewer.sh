#!/usr/bin/env bash
# claude-reviewer.sh — run ONE documentation review through Claude Code.
#
# The backfill's reviewer is normally `hermes chat --oneshot`. This is the same
# job on a different harness: Claude Code reads the review prompt, does the
# review, and prints the result (including its FILE: lines) to stdout. The
# runner only needs stdout, so this drops straight in as TRAINING_HERMES_BIN.
#
# Usage: claude-reviewer.sh chat --oneshot --query-file <prompt> -m <model> --provider <p> --in <dir> ...
#   The extra flags the runner passes are accepted and ignored (--provider is a
#   hermes concept; Claude Code takes its model from --model).
set -uo pipefail

PROMPT=""
MODEL="${CLAUDE_REVIEW_MODEL:-claude-haiku-4-5-20251001}"

while [ $# -gt 0 ]; do
  case "$1" in
    --query-file) PROMPT="$2"; shift 2 ;;
    -m|--model)   MODEL="$2";  shift 2 ;;
    # runner-supplied flags that do not apply to Claude Code
    --provider|--max-turns|--run-budget|--in|--oneshot|chat) shift ;;
    *) shift ;;
  esac
done

[ -n "$PROMPT" ] || { echo "claude-reviewer: no --query-file given" >&2; exit 2; }
[ -f "$PROMPT" ] || { echo "claude-reviewer: prompt not found: $PROMPT" >&2; exit 2; }

# The reviewer edits real files, so it must not run in a sandbox that blocks
# writes. Accept edits non-interactively; the prompt is the only instruction.
exec claude -p "$(cat "$PROMPT")" \
  --model "$MODEL" \
  --permission-mode acceptEdits \
  --allowedTools "Read,Edit,Write,Glob,Grep,Bash"
