import { hashKey } from "./step-prefs";

export type PhaseId = "implementation" | "review" | "debugging" | "report";

export interface PlanItem { id: string; text: string; done: boolean }
export interface PlanSection { id: string; heading: string; body?: string; items: PlanItem[] }
export interface Plan { v: 1; id: string; title: string; summary?: string; sections: PlanSection[]; phases: PhaseId[] }
export interface PlanResponse { v: 1; planId: string; decision: "approved" | "changes_requested"; note?: string; plan?: Plan }
export interface ReportBlock { v: 1; planId?: string; title?: string; headline?: string; notes?: string[] }

export const PLAN_CONTRACT = `When you present a plan for approval, emit it as a fenced block with info string
astra-plan containing one JSON object: {"v":1,"id":"<kebab-slug>","title":"...",
"summary":"...","sections":[{"heading":"...","body":"<markdown>","items":[{"text":"...","done":false}]}]}
Emit the block INSTEAD of a markdown plan, not in addition. Then stop and wait.
The user replies with a fenced astra-plan-response block: decision "approved" means
proceed with the plan object in that block if present, otherwise the original;
"changes_requested" means revise and emit a new astra-plan block with the same id.
When the work is finished, emit a fenced astra-report block:
{"v":1,"planId":"<same id>","title":"...","headline":"<one line>","notes":["..."]}
Do not put numbers in the report block; the UI computes them.`;

export const DEFAULT_PHASES: PhaseId[] = ["implementation", "review", "debugging", "report"];
const VALID_PHASES = new Set(DEFAULT_PHASES);

export function extractFences(text: string, info: string): { raw: string; start: number; end: number }[] {
  const result: { raw: string; start: number; end: number }[] = [];
  const lines = text.split("\n");
  let inFence = false;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matchOpen = line.match(/^```([a-z-]*)\s*$/);
    if (!inFence && matchOpen) {
      if (matchOpen[1] === info) {
        inFence = true;
        start = i;
      }
    } else if (inFence && line.match(/^```\s*$/)) {
      result.push({ raw: lines.slice(start, i + 1).join("\n"), start, end: i });
      inFence = false;
      start = -1;
    }
  }
  return result;
}

export function hasOpenFence(text: string, info: string): boolean {
  const lines = text.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matchOpen = line.match(/^```([a-z-]*)\s*$/);
    if (!inFence && matchOpen && matchOpen[1] === info) {
      inFence = true;
    } else if (inFence && line.match(/^```\s*$/)) {
      inFence = false;
    }
  }
  return inFence;
}

function parseJSON<T>(raw: string): T | null {
  try {
    const jsonStr = raw.replace(/^```[a-z-]*\n/, "").replace(/\n```$/, "");
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}

export function parsePlan(raw: string): Plan | null {
  const p = parseJSON<any>(raw);
  if (!p || p.v !== 1 || typeof p.title !== "string" || !Array.isArray(p.sections)) return null;

  const plan = { ...p } as Plan;
  
  plan.title = plan.title.slice(0, 160);
  if (plan.summary) plan.summary = plan.summary.slice(0, 400);
  plan.id = plan.id || hashKey(plan.title);
  
  plan.sections = plan.sections.slice(0, 12).map((s: any, i: number) => {
    const sec = { ...s } as PlanSection;
    sec.heading = (sec.heading || "").slice(0, 120);
    if (sec.body) sec.body = sec.body.slice(0, 2000);
    sec.id = sec.id || `s${i}`;
    sec.items = (Array.isArray(sec.items) ? sec.items : []).slice(0, 30).map((it: any, j: number) => {
      const item = { ...it } as PlanItem;
      item.text = item.text || "";
      item.done = !!item.done;
      item.id = item.id || `${sec.id}-i${j}`;
      return item;
    });
    return sec;
  });

  if (Array.isArray(plan.phases)) {
    plan.phases = plan.phases.filter((ph: any) => VALID_PHASES.has(ph)) as PhaseId[];
    if (plan.phases.length === 0) plan.phases = DEFAULT_PHASES;
  } else {
    plan.phases = DEFAULT_PHASES;
  }
  
  return plan;
}

export function parseResponse(raw: string): PlanResponse | null {
  const r = parseJSON<any>(raw);
  if (!r || r.v !== 1 || !r.planId || (r.decision !== "approved" && r.decision !== "changes_requested")) return null;
  return r as PlanResponse;
}

export function parseReport(raw: string): ReportBlock | null {
  const r = parseJSON<any>(raw);
  if (!r || r.v !== 1) return null;
  if (r.notes && Array.isArray(r.notes)) {
    r.notes = r.notes.slice(0, 8).map((n: string) => (n || "").slice(0, 240));
  }
  return r as ReportBlock;
}

export function extractPlans(text: string): Plan[] {
  const fences = extractFences(text, "astra-plan");
  const plans: Plan[] = [];
  for (const f of fences) {
    const p = parsePlan(f.raw);
    if (p) plans.push(p);
  }
  return plans;
}

export function extractResponses(text: string): PlanResponse[] {
  const fences = extractFences(text, "astra-plan-response");
  const resps: PlanResponse[] = [];
  for (const f of fences) {
    const r = parseResponse(f.raw);
    if (r) resps.push(r);
  }
  return resps;
}

export function extractReports(text: string): ReportBlock[] {
  const fences = extractFences(text, "astra-report");
  const reports: ReportBlock[] = [];
  for (const f of fences) {
    const r = parseReport(f.raw);
    if (r) reports.push(r);
  }
  return reports;
}

export function stripAstraFences(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matchOpen = line.match(/^```(astra-plan|astra-plan-response|astra-report)\s*$/);
    
    if (!inFence && matchOpen) {
      inFence = true;
    } else if (inFence && line.match(/^```\s*$/)) {
      inFence = false;
    } else if (!inFence) {
      out.push(line);
    }
  }
  return out.join("\n");
}

export function planToMarkdown(plan: Plan): string {
  let md = `### ${plan.title}\n`;
  if (plan.summary) md += `${plan.summary}\n\n`;
  for (const sec of plan.sections) {
    md += `**${sec.heading}**\n`;
    if (sec.body) md += `${sec.body}\n`;
    for (const item of sec.items) {
      md += `- [${item.done ? "x" : " "}] ${item.text}\n`;
    }
    md += "\n";
  }
  return md.trim();
}

export function serializeDecision(plan: Plan, decision: PlanResponse["decision"], note: string, edited: boolean): string {
  let text = "";
  let payload: any = { v: 1, planId: plan.id, decision };
  
  if (decision === "approved") {
    if (edited) {
      text = `Plan approved with edits — proceed with the plan below.\n\n${planToMarkdown(plan)}\n\n`;
      payload.plan = plan;
    } else {
      text = `Plan approved — proceed.\n\n`;
    }
  } else {
    text = `Requested changes to the plan:\n\n${note}\n\n`;
    payload.note = note;
    if (edited) payload.plan = plan;
  }
  
  text += "```astra-plan-response\n" + JSON.stringify(payload) + "\n```";
  return text;
}
