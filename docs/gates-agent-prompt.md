# Generative Gates — agent-side emission requirements

Include this block in ANY pipeline/agent prompt whose plan/review/debug/report steps should
surface as interactive gate cards in the Astra web UI (astra.jitinnair.com).
Source of truth: `~/Work/projects/astra-webui/src/components/gates/gate-envelope.ts`
UI spec: `~/Work/scratch/generative-gates/SPEC.md` §1, Appendix A.

---

## How to emit a gate

When you reach a GATE step (plan approval, review sign-off, fix-list approval, final report):

1. Call the `clarify` tool with EXACTLY:
   - `question` = one human-readable summary line, then a newline, then an HTML comment
     wrapping the JSON envelope (byte-exact format — the web UI parses this):

     ```
     <summary line>
     <!--astra-gate/1
     { ...envelope JSON... }
     -->
     ```

   - `choices` = the action labels, same order as `actions[]` in the envelope:
     - plan gate: `["Approve", "Request changes"]`
     - review gate: `["Approve", "Request changes", "Reject"]`
     - report gate: `["Approve"]` (report has no decision to make)
   - `multi_select` = false

2. Envelope JSON (all fields required unless marked optional):

```json
{
  "v": 1,
  "kind": "plan" | "review" | "fix" | "report",
  "gate_id": "plan-<8hex>",        // STABLE across revisions of the same gate
  "version": 1,                     // increment on every re-presentation
  "title": "Build plan",
  "subtitle": "optional · 12 steps · 4 files",
  "editable": true,                 // false for report
  "actions": [
    {"id": "approve", "label": "Approve", "tone": "primary"},
    {"id": "change", "label": "Request changes", "tone": "quiet", "opens_input": true},
    {"id": "reject", "label": "Reject", "tone": "danger"}
  ],
  "body": { "format": "markdown", "content": "<the full plan/review/fix markdown>" }
}
```

   Review body variant: `"body": {"findings": [{"id":"f1","severity":"critical|high|medium|low|info","title":"...","file":"src/x.ts","line":42,"detail":"markdown","suggestion":"markdown"}], "summary": "optional markdown"}`
   Report body variant: `"body": {"verdict":"pass|fail|partial","stats":[{"label":"Files","value":14}],"phases":[{"name":"plan","status":"pass","ms":4000}],"notes":"optional"}`

## How to consume the reply

3. The clarify `answer` string is JSON: `{"astra_gate":1,"gate_id":"...","version":N,"action":"approve|change|reject","edited":bool,"content":"...","request":"...","items":{...}}`.
   Parse it. On a PARSE FAILURE, apply the plain-text fallback map:
   - starts with `Approve` → treat as approve
   - starts with `Reject` → treat as reject
   - anything else → treat as a change request with that text

4. On `action:"approve"` with `edited:true`: the `content` field is the AUTHORITATIVE plan/fix
   list — use it, discard your own copy.

5. On `action:"change"`: revise the plan/review IN THIS SAME TURN (you are unblocked in place —
   do not start a new turn) and call `clarify` AGAIN with the SAME `gate_id` and
   `version: N+1`. The UI supersedes the old card automatically.

6. After a gate resolves, emit the final envelope ONCE as ordinary assistant text (same
   `<!--astra-gate/1 ... -->` comment with `"resolved":"approve"` added) so the gate survives
   in chat history. Then continue the pipeline.

## Constraints

7. Max 4 choices (host silently drops extras). First choice gets "(Recommended)" appended by
   the host — never add it yourself.
8. `content` ≤ 64 KB; findings/fixes ≤ 80 entries; stats ≤ 6; phases ≤ 12.
9. `gate_id` must be unique per gate but stable across its revisions. Use `plan-`, `rev-`,
   `fix-`, `rep-` prefixes + 8 hex chars.
10. Set/keep `agent.clarify_timeout` high enough for human review (3600 s default is fine).
