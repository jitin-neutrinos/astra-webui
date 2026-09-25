import type { PhaseId } from "./plan-block";
import type { Segment } from "./chat-segments";
import { describeTool } from "./tool-identity";

export type PhaseStatus = "pending" | "active" | "complete" | "skipped";
export interface PhaseState { id: PhaseId; status: PhaseStatus; evidence?: string }

export function classifySegment(seg: Segment): { phase: PhaseId; evidence: string } | null {
  if (seg.kind !== "tool") return null;
  const info = describeTool(seg.label, seg.argsText, seg.command);
  const cmd = (seg.command || info.meta || "");
  const resultText = seg.resultText ?? "";

  // 1. FAILURE -> "debugging"
  const failedCode = seg.exitCode != null && seg.exitCode !== 0;
  const failedStr = /\b(FAIL|FAILED|Traceback|error TS\d+|AssertionError|✗)\b/.test(resultText);
  if (failedCode || failedStr) {
    return { phase: "debugging", evidence: info.name + (info.meta ? " " + info.meta : "") };
  }

  // 2. WRITE -> "implementation"
  const isWriteLabel = seg.label === "write_file" || seg.label === "patch";
  const isWriteCmd = info.kind === "terminal" && /\b(git (add|commit|apply)|mkdir|cp |mv |npm (install|run build)|tsc -b)\b/.test(cmd);
  if (isWriteLabel || isWriteCmd) {
    return { phase: "implementation", evidence: info.name + (info.meta ? " " + info.meta : "") };
  }

  // 3. VERIFY -> "review"
  const isVerifyCmd = info.kind === "terminal" && /\b(npm (test|run lint)|oxlint|eslint|tsc --noEmit|pytest|git diff|git status|node scripts\/verify)\b/.test(cmd);
  const isBrowser = info.kind === "browser";
  if (isVerifyCmd || isBrowser) {
    return { phase: "review", evidence: info.name + (info.meta ? " " + info.meta : "") };
  }

  // 4. otherwise -> null
  return null;
}

export function computePhases(declared: PhaseId[], segsAfterApproval: Segment[], hasReport: boolean, _turnStreaming: boolean): PhaseState[] {
  const states: Record<string, PhaseState> = {};
  for (const p of declared) {
    states[p] = { id: p, status: "pending" };
  }

  const defaultIndexes = new Map<PhaseId, number>();
  DEFAULT_PHASES.forEach((p, i) => defaultIndexes.set(p, i));

  // Find hits
  const hits = new Map<PhaseId, string>();
  for (const seg of segsAfterApproval) {
    const hit = classifySegment(seg);
    if (hit && declared.includes(hit.phase)) {
      hits.set(hit.phase, hit.evidence);
    }
  }
  if (hasReport && declared.includes("report")) {
    hits.set("report", "report block");
  }

  // Apply hits and determine complete/skipped
  let highestHitOrdinal = -1;
  for (const p of declared) {
    if (hits.has(p)) {
      states[p].status = "active";
      states[p].evidence = hits.get(p);
      const ord = defaultIndexes.get(p) ?? -1;
      if (ord > highestHitOrdinal) highestHitOrdinal = ord;
    }
  }

  for (const p of declared) {
    const ord = defaultIndexes.get(p) ?? -1;
    if (p === "report") {
      if (hasReport) {
        states[p].status = "complete";
      }
    } else {
      let laterHasHit = false;
      for (const [hitPhase, _] of hits.entries()) {
        const hitOrd = defaultIndexes.get(hitPhase) ?? -1;
        if (hitOrd > ord) {
          laterHasHit = true;
          break;
        }
      }
      
      if (laterHasHit) {
        if (hits.has(p)) {
          states[p].status = "complete";
        } else {
          states[p].status = "skipped";
        }
      } else if (hasReport && hits.has(p)) {
        states[p].status = "complete";
      }
    }
  }

  return declared.map(p => states[p]);
}
