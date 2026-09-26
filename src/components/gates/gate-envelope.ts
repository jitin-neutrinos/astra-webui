export const GATE_OPEN = "<!--astra-gate/1";
export const GATE_RE = /<!--astra-gate\/1\s*([\s\S]*?)\s*-->/;

export type GateKind = "plan" | "review" | "fix" | "report";

export interface GateAction {
  id: "approve" | "change" | "reject" | "dismiss";
  label: string;
  tone: "primary" | "quiet" | "danger";
  opens_input?: boolean;
}

export interface PlanBody {
  format: "markdown";
  content: string;
  meta?: { key: string; value: string }[];
}

export interface ReviewBody {
  findings: {
    id: string;
    severity: "critical" | "high" | "medium" | "low" | "info";
    title: string;
    file?: string;
    line?: number;
    detail: string;
    suggestion?: string;
  }[];
  summary?: string;
}

export interface FixBody {
  fixes: {
    id: string;
    status: "proposed" | "applied" | "skipped";
    title: string;
    file?: string;
    line?: number;
    detail: string;
    finding_id?: string;
  }[];
  summary?: string;
}

export interface ReportBody {
  verdict: "pass" | "fail" | "partial";
  stats: { label: string; value: number; unit?: string; delta?: number }[];
  phases: {
    name: string;
    status: "pass" | "fail" | "skipped" | "warn";
    ms: number;
    detail?: string;
  }[];
  gauges?: { label: string; value: number; max: number; unit?: string }[];
  links?: { label: string; href: string }[];
  notes?: string;
}

export interface GateEnvelope {
  v: 1;
  kind: GateKind;
  gate_id: string;
  version: number;
  supersedes?: string;
  title: string;
  subtitle?: string;
  editable: boolean;
  actions: GateAction[];
  body: PlanBody | ReviewBody | FixBody | ReportBody;
  resolved?: "approve" | "reject" | "change" | "cancelled" | null;
  resolved_at?: number;
}

export interface GateReply {
  action: "approve" | "change" | "reject" | "dismiss";
  request?: string; // used for 'change' fallback or rejection reason?
  reason?: string; // used for 'reject'
  edited?: boolean;
  content?: string; // full markdown string replacement
  items?: Record<string, { dismissed?: boolean; note?: string }>;
}

export function parseGate(question?: string): { env: GateEnvelope; summary: string } | null {
  if (!question) return null;
  const match = question.match(GATE_RE);
  if (!match) return null;
  
  try {
    const env = JSON.parse(match[1]) as GateEnvelope;
    if (env.v !== 1 || !env.kind || !env.gate_id) return null;
    
    // Summary is the string before the comment
    const summary = question.substring(0, match.index).trim();
    return { env, summary };
  } catch {
    return null; // Malformed JSON
  }
}

export function serializeReply(gateId: string, version: number, r: GateReply): string {
  // {"astra_gate":1,"gate_id":"plan-7f3a91c2","version":1,"action":"approve","edited":false}
  const reply: any = {
    astra_gate: 1,
    gate_id: gateId,
    version,
    // dismiss is a UI state; the agent-facing wire still says approve
    action: r.action === "dismiss" ? "approve" : r.action,
  };
  
  if (r.action === "change" && r.request) {
    reply.request = r.request;
  } else if (r.action === "reject" && r.reason) {
    reply.reason = r.reason;
  }

  if (r.edited !== undefined) {
    reply.edited = r.edited;
  }
  if (r.content !== undefined) {
    reply.content = r.content;
  }
  if (r.items !== undefined) {
    reply.items = r.items;
  }
  
  return JSON.stringify(reply);
}

export function supersedes(prev: GateEnvelope, next: GateEnvelope): boolean {
  if (prev.gate_id !== next.gate_id) return false;
  return next.version > prev.version;
}

export const draftKey = (sid: string | null, gateId: string) =>
  `astra-gate-draft:${sid ?? "global"}:${gateId}`;

export function parseArchivedGate(assistantText: string): GateEnvelope | null {
  const match = assistantText.match(GATE_RE);
  if (!match) return null;
  try {
    const env = JSON.parse(match[1]) as GateEnvelope;
    if (env.v !== 1 || !env.kind || !env.gate_id) return null;
    return env;
  } catch {
    return null;
  }
}
