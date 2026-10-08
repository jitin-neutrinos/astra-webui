// Card repair turn — retry-with-feedback so mangled cards never reach the screen.
//
// Flow: a turn completes (message.complete) → every ```astra-canvas fence in the
// final text is checked with BOTH the renderer's real parser AND the strict
// validator. A fence the renderer already renders is left alone (the lenient
// ladder owns it). A fence that is DEAD — not JSON, or JSON the renderer rejects
// — triggers ONE repair turn submitted into the same session:
//
//   "The canvas card in your previous reply could not be parsed: <errors>.
//    Re-emit ONLY the card, corrected, as one ```astra-canvas fence."
//
// The model sees its own output plus the exact parse errors and fixes it — the
// same validate-and-retry loop as structured-output pipelines, but over chat.
//
// Guards: once per message id (a Map), one repair in flight, max 1 retry per
// session per minute (a model that cannot fix it must not loop), and the repair
// turn is marked silent so it never touches the composer.
import { validateCanvasSpec, type CanvasIssue } from "./canvas-validate.ts";

const FENCE_RE = /```astra-canvas[^\n]*\n([\s\S]*?)```/g;
const repaired = new Set<string>();          // message ids already repaired
let lastRepairAt = 0;
let repairInFlight = false;
const MIN_GAP_MS = 60_000;
export const MAX_REPAIRS_PER_SESSION = 5;
let sessionRepairs = 0;

export function resetCardRepairForTests() {
  repaired.clear();
  sessionRepairs = 0;
  repairInFlight = false;
  lastRepairAt = 0;
}

export interface DeadCard {
  index: number;          // which fence in the message
  issues: CanvasIssue[];  // strict validation errors (exact, model-readable)
  excerpt: string;        // first 240 chars of the dead body
}

/**
 * Find fences that are genuinely dead: the renderer's lenient parser rejects
 * them AND the strict schema flags why. Returns [] when nothing needs repair.
 */
export function findDeadCards(
  finalText: string,
  renders: (body: string) => boolean,
): DeadCard[] {
  const dead: DeadCard[] = [];
  let m: RegExpExecArray | null;
  FENCE_RE.lastIndex = 0;
  let i = 0;
  while ((m = FENCE_RE.exec(finalText)) !== null) {
    const body = m[1];
    if (!renders(body)) {
      const issues = validateCanvasSpec(body);
      dead.push({
        index: i,
        issues: issues.length ? issues : [{ path: "(json)", message: "body is not valid JSON" }],
        excerpt: body.trim().slice(0, 240),
      });
    }
    i++;
  }
  return dead;
}

export function repairPromptFor(dead: DeadCard[]): string {
  const lines = dead.map((d) =>
    d.issues.map((iss) => `- ${iss.path}: ${iss.message}`).join("\n") +
    `\n  (card started: ${JSON.stringify(d.excerpt)})`
  );
  return [
    "One of the astra-canvas cards in your previous reply could not be parsed by the UI and rendered as an error placeholder instead.",
    "Parse errors:",
    lines.join("\n"),
    "",
    "Re-emit ONLY the corrected card as ONE ```astra-canvas fence — same content, fixed structure. Every card MUST be {\"v\":1,\"title\":…,\"blocks\":[…]} with all blocks inside the blocks array. Do not repeat the surrounding prose.",
  ].join("\n");
}

export interface RepairGate {
  allowed: boolean;
  reason?: string;
}

/** Rate/loop guards. messageId dedupes; caller passes a stable per-turn id. */
export function repairAllowed(messageId: string, isStreaming: boolean): RepairGate {
  if (repaired.has(messageId)) return { allowed: false, reason: "already repaired" };
  if (isStreaming) return { allowed: false, reason: "turn still streaming" };
  if (repairInFlight) return { allowed: false, reason: "repair in flight" };
  if (sessionRepairs >= MAX_REPAIRS_PER_SESSION) return { allowed: false, reason: "session repair budget spent" };
  if (Date.now() - lastRepairAt < MIN_GAP_MS) return { allowed: false, reason: "cooling down" };
  return { allowed: true };
}

export function markRepairAttempted(messageId: string) {
  repaired.add(messageId);
  sessionRepairs++;
  lastRepairAt = Date.now();
  repairInFlight = true;
}

export function markRepairSettled() {
  repairInFlight = false;
}
