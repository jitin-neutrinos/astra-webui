// Gate bodies → canvas blocks (pure mapping, no React). Review findings become
// a severity KPI row + table; fix bodies become checklists; report bodies
// become verdict/stats/steps/gauges; plan bodies stay markdown prose (the gate
// shell already renders RichText). Used by gate-card and approvals-page.
import type { ReportBody, ReviewBody, FixBody } from "../components/gates/gate-envelope";
import type { CanvasBlock } from "./canvas-schema";

export function reviewBodyToBlocks(body: ReviewBody): CanvasBlock[] {
  const blocks: CanvasBlock[] = [];
  const f = body.findings || [];
  const sev = (s: string) => f.filter((x) => x.severity === s).length;
  const kpis: CanvasBlock[] = [
    { type: "kpi", label: "Critical", value: sev("critical"), trend: sev("critical") > 0 ? "up" : "flat" },
    { type: "kpi", label: "High", value: sev("high"), trend: sev("high") > 0 ? "up" : "flat" },
    { type: "kpi", label: "Medium", value: sev("medium") },
    { type: "kpi", label: "Low / info", value: sev("low") + sev("info") },
  ];
  blocks.push(...kpis);
  if (f.length > 0) {
    blocks.push({
      type: "table",
      columns: ["Severity", "Finding", "Location"],
      rows: f.map((x) => [x.severity, x.title, `${x.file || ""}${x.line ? ":" + x.line : ""}`.trim() || "—"]),
    });
  }
  return blocks;
}

export function fixBodyToBlocks(body: FixBody): CanvasBlock[] {
  const st = (s: string) => (s === "applied" ? "done" : s === "skipped" ? "fail" : "open") as "done" | "fail" | "open";
  return [{
    type: "checklist",
    items: (body.fixes || []).map((x) => ({
      text: x.title + (x.file ? ` · ${x.file}${x.line ? ":" + x.line : ""}` : ""),
      status: st(x.status),
    })),
  }];
}

export function reportBodyToBlocks(body: ReportBody): CanvasBlock[] {
  const blocks: CanvasBlock[] = [];
  if (body.verdict) {
    blocks.push({
      type: "callout",
      tone: body.verdict === "pass" ? "success" : body.verdict === "fail" ? "danger" : "warn",
      title: `Verdict: ${body.verdict.toUpperCase()}`,
      body: body.notes || "",
    });
  }
  if ((body.stats || []).length > 0) {
    blocks.push(...(body.stats as any[]).map((s): CanvasBlock => ({
      type: "kpi",
      label: s.label,
      value: s.unit ? `${s.value}${s.unit}` : s.value,
      delta: s.delta != null ? `${s.delta > 0 ? "+" : ""}${s.delta}` : undefined,
      trend: s.delta > 0 ? "up" : s.delta < 0 ? "down" : undefined,
    })));
  }
  if ((body.phases || []).length > 0) {
    const st = (s: string) => (s === "pass" ? "done" : s === "fail" ? "fail" : s === "warn" ? "active" : "todo") as "done" | "fail" | "active" | "todo";
    blocks.push({
      type: "steps",
      items: body.phases.map((p) => ({
        title: `${p.name} · ${p.ms != null ? (p.ms < 1000 ? `${parseFloat(p.ms.toFixed(2))}ms` : `${parseFloat((p.ms / 1000).toFixed(2))}s`) : p.status}`,
        detail: p.detail,
        status: st(p.status),
      })),
    });
  }
  for (const g of body.gauges || []) {
    blocks.push({
      type: "chart",
      chart: "radial",
      title: g.label + (g.unit ? ` (${g.unit})` : ""),
      series: [{ name: g.label, points: [Math.max(0, Math.min(1, g.max ? g.value / g.max : 0)) * 100] }],
    });
  }
  const links = body.links || [];
  if (links.length > 0) {
    blocks.push({
      type: "table",
      columns: ["Links"],
      rows: links.map((l) => [`${l.label} — ${l.href}`]),
    });
  }
  return blocks;
}
