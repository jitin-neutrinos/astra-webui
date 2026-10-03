// Canvas markdown serialization — the copy-as-markdown representation of a
// canvas spec. Pure; tested in canvas-schema.check.ts.
import type { CanvasSpec, CanvasBlock } from "./canvas-schema";

function blockToMd(b: CanvasBlock): string {
  switch (b.type) {
    case "kpi": {
      const d = b.delta != null ? ` (${b.trend === "up" ? "↑" : b.trend === "down" ? "↓" : ""} ${b.delta})` : "";
      return `- **${b.label}:** ${b.value}${d}`;
    }
    case "chart": {
      const head = `**${b.title || b.chart + " chart"}**`;
      const cols = (b.labels || b.series[0].points.map((_, i) => String(i + 1))).join(" | ");
      const rows = b.series.map((s) => `${s.name} | ${s.points.join(" | ")}`);
      return [head, "", `| label | ${cols} |`, `|---|${cols.split(" | ").map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r} |`)].join("\n");
    }
    case "table": {
      const head = `| ${b.columns.join(" | ")} |`;
      const sep = `|${b.columns.map(() => "---").join("|")}|`;
      return [head, sep, ...b.rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
    }
    case "diagram": {
      const nodes = b.nodes.map((n) => `- ${n.label}${n.detail ? ` — ${n.detail}` : ""}`).join("\n");
      const edges = b.edges.map((e) => `- ${nodeLabel(b, e.from)} → ${nodeLabel(b, e.to)}${e.label ? ` (${e.label})` : ""}`).join("\n");
      return `**${b.layout === "flow" ? "Flow" : "Relationships"}**\n\n${nodes}\n\n${edges}`;
    }
    case "checklist":
      return b.items.map((it) => `- [${it.status === "done" ? "x" : it.status === "fail" ? "!" : " "}] ${it.text}`).join("\n");
    case "steps":
      return b.items.map((it, i) => `${i + 1}. **${it.title}**${it.status ? ` _(${it.status})_` : ""}${it.detail ? ` — ${it.detail}` : ""}`).join("\n");
    case "callout":
      return `> ${b.title ? `**${b.title}** — ` : ""}${b.body}`;
  }
}

function nodeLabel(b: Extract<CanvasBlock, { type: "diagram" }>, id: string): string {
  return b.nodes.find((n) => n.id === id)?.label || id;
}

export function canvasToMarkdown(spec: CanvasSpec): string {
  const parts = spec.blocks.map(blockToMd);
  return (spec.title ? `## ${spec.title}\n\n` : "") + parts.join("\n\n");
}
