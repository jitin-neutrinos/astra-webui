// Canvas markdown serialization — the copy-as-markdown representation of a
// canvas spec. Pure; tested in canvas-schema.check.ts.
import type { CanvasSpec, CanvasBlock } from "./canvas-schema";

/** A reactive block authors values as bindings ({$expr:…}), so the markdown copy
 *  must never print "[object Object]" — it shows "(live)" instead. */
function live(v: unknown): string {
  return typeof v === "object" && v !== null ? "(live)" : String(v ?? "");
}
/** A series' `points` may BE a binding; the markdown table treats it as empty. */
const pts = (s: { points: unknown }): number[] => (Array.isArray(s.points) ? s.points : []);

function blockToMd(b: CanvasBlock): string {
  switch (b.type) {
    case "kpi": {
      const d = b.delta != null ? ` (${b.trend === "up" ? "↑" : b.trend === "down" ? "↓" : ""} ${live(b.delta)})` : "";
      const spark = b.spark && Array.isArray(b.spark) && b.spark.length >= 3
        ? ` · trend: ${b.spark.map((x) => Math.round(Number(x) * 10) / 10).join(", ")}`
        : "";
      return `- **${b.label}:** ${live(b.value)}${d}${spark}`;
    }
    case "chart": {
      const head = `**${b.title || b.chart + " chart"}**`;
      if (b.chart === "sankey" || b.chart === "treemap" || b.chart === "funnel") {
        const cols = b.labels ?? [];
        return [head, "", `| ${cols.join(" | ")} |`, `|${cols.map(() => "---").join("|")}|`,
          ...b.series.map((sr) => `| ${pts(sr).join(" | ")} |`)].join("\n");
      }
      const cols = (b.labels || pts(b.series[0]).map((_, i) => String(i + 1))).join(" | ");
      const rows = b.series.map((s) => `${s.name} | ${pts(s).join(" | ")}`);
      return [head, "", `| label | ${cols} |`, `|---|${cols.split(" | ").map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r} |`)].join("\n");
    }
    case "table": {
      if (b.bind && b.rows.length === 0) return `**Live table:** ${b.columns.join(" · ")} _(rows come from the card's data)_`;
      const head = `| ${b.columns.join(" | ")} |`;
      const sep = `|${b.columns.map(() => "---").join("|")}|`;
      return [head, sep, ...b.rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
    }
    case "diagram": {
      // ER fields and cardinality are part of the reading, so the markdown copy
      // carries them: a copied card must not lose the schema a reader is judging.
      const nodes = b.nodes.map((n) => {
        const head = `- ${n.label}${n.detail ? ` — ${n.detail}` : ""}`;
        const cols = (n.fields ?? []).map((f) => `    - ${f.pk ? "🔑 " : ""}${f.fk ? "→ " : ""}${f.name}${f.type ? ` : ${f.type}${f.nullable ? "?" : ""}` : ""}`);
        return cols.length ? `${head}\n${cols.join("\n")}` : head;
      }).join("\n");
      const edges = b.edges.map((e) => `- ${nodeLabel(b, e.from)} →${e.cardinality ? ` ${e.cardinality}` : " "}${nodeLabel(b, e.to)}${e.label ? ` (${e.label})` : ""}`).join("\n");
      return `**${b.layout === "flow" ? "Flow" : "Relationships"}**\n\n${nodes}\n\n${edges}`;
    }
    case "checklist":
      return b.items.map((it) => `- [${it.status === "done" ? "x" : it.status === "fail" ? "!" : " "}] ${it.text}`).join("\n");
    case "steps":
      return b.items.map((it, i) => `${i + 1}. **${it.title}**${it.status ? ` _(${it.status})_` : ""}${it.detail ? ` — ${it.detail}` : ""}`).join("\n");
    case "callout":
      return `> ${b.title ? `**${b.title}** — ` : ""}${b.body}`;
    case "progress":
      return `- **${b.label}:** ${live(b.value)}${b.unit || ""}${b.detail ? ` (${b.detail})` : ""}`;
    case "timeline":
      return b.items.map((it) => `- ${it.time ? `**${it.time}** — ` : ""}**${it.title}**${it.detail ? ` — ${it.detail}` : ""}`).join("\n");
    case "compare":
      return b.items.map((it) => `**${it.name}**${it.badge ? ` _(${it.badge})_` : ""}\n${it.points.map((p) => `- ${p.text}`).join("\n")}`).join("\n\n");
    case "tree": {
      const byId = new Map(b.nodes.map((n) => [n.id, n]));
      const roots = b.nodes.filter((n) => !b.nodes.some((o) => (o.children || []).includes(n.id)));
      const walk = (n: (typeof b.nodes)[number], depth: number): string =>
        `${"  ".repeat(depth)}- **${n.label}**${n.detail ? ` — ${n.detail}` : ""}\n` +
        (n.children || []).map((c) => { const k = byId.get(c); return k ? walk(k, depth + 1) : ""; }).join("");
      return roots.map((n) => walk(n, 0)).join("");
    }
    case "code":
      return `\`\`\`${b.language || ""}\n${b.code}\n\`\`\``;
    case "references":
      return b.items.map((it, i) => `${i + 1}. [${it.title}](${it.href || ""})${it.note ? ` — ${it.note}` : ""}`).join("\n");
    case "quote":
      return `> ${b.text}${b.attribution ? `\n> — **${b.attribution}**${b.role ? `, ${b.role}` : ""}` : ""}`;
    case "keyvalue":
      return `${b.title ? `**${b.title}**\n` : ""}${b.items.map((it) => `- **${it.key}:** ${it.value}`).join("\n")}`;
    case "diff":
      return `${b.filename ? `**${b.filename}**\n\n` : ""}${b.hunks.map((h) => `${h.header ? `${h.header}\n` : ""}${h.lines.map((l) => `${l.op === "add" ? "+" : l.op === "del" ? "-" : " "} ${l.text}`).join("\n")}`).join("\n\n")}`;
    case "heatmap": {
      const head = `| ${["", ...b.cols].join(" | ")} |`;
      const sep = `|${["", ...b.cols].map(() => "---").join("|")}|`;
      const rows = b.rows.map((r, i) => `| ${[r, ...b.values[i]].join(" | ")} |`);
      return [head, sep, ...rows].join("\n");
    }
    case "tabs":
      return b.items.map((it) => `**${it.label}**\n\n${it.blocks.map(blockToMd).join("\n\n")}`).join("\n\n---\n\n");
    case "accordion":
      return b.items.map((it) => {
        const inner = it.blocks && it.blocks.length ? `\n\n${it.blocks.map(blockToMd).join("\n\n")}` : "";
        return `<details${it.open ? " open" : ""}><summary>${it.title}</summary>\n\n${it.body || ""}${inner}\n\n</details>`;
      }).join("\n\n");
    case "terminal": {
      const head = b.command ? `$ ${b.command}\n` : b.title ? `${b.title}\n` : "";
      const exit = b.exitCode != null ? `\n\n(exit ${b.exitCode})` : "";
      return "```\n" + head + b.lines.map((l) => l.text).join("\n") + exit + "\n```";
    }
    case "badges":
      return b.items.map((it) => `\`${it.label}\``).join(" · ");
    case "divider":
      return b.label ? `--- ${b.label} ---` : "---";
    case "spreadsheet": {
      const width = Math.max(...b.rows.map((r) => r.length), b.columns?.length ?? 0);
      const head = b.header !== false && b.rows[0] ? b.rows[0].map((c) => String(c)) : Array.from({ length: width }, (_, i) => b.columns?.[i] ?? "");
      const body = b.header !== false ? b.rows.slice(1) : b.rows;
      return [
        b.title ? `**${b.title}**` : "",
        `| ${head.join(" | ")} |`,
        `|${Array.from({ length: width }, () => " ---").join("|")}|`,
        ...body.map((r) => `| ${Array.from({ length: width }, (_, i) => String(r[i] ?? "")).join(" | ")} |`),
      ].filter(Boolean).join("\n");
    }
    case "slides":
      return [
        b.title ? `**${b.title}**` : "",
        ...b.slides.flatMap((s, i) => [
          `### ${i + 1}. ${s.heading}`,
          ...(s.bullets ?? []).map((x) => `- ${x}`),
          s.note ? `\n> ${s.note}` : "",
        ]),
      ].filter(Boolean).join("\n\n");
    case "document":
      return [
        b.title ? `**${b.title}**` : "",
        ...b.content.map((c) => {
          if (c.kind === "h2") return `## ${c.text}`;
          if (c.kind === "h3") return `### ${c.text}`;
          if (c.kind === "li") return `- ${c.text}`;
          if (c.kind === "quote") return `> ${c.text}`;
          if (!c.kind && c.level === 2) return `## ${c.text}`;
          if (!c.kind && c.level === 3) return `### ${c.text}`;
          return c.text;
        }),
      ].filter(Boolean).join("\n\n");
    case "text":
      return b.title ? `**${b.title}**\n\n\`\`\`\n${b.content}\n\`\`\`` : `\`\`\`\n${b.content}\n\`\`\``;
    // ── v5 reactive + media ───────────────────────────────────────────────────
    case "slider":
      return `${b.value ?? "—"}${b.unit ?? ""}`;
    case "select":
      return `- Environment-style choice: **${b.options.find((o) => o.value === b.value)?.label ?? b.value ?? "—"}**`;
    case "multiselect":
      return b.value?.length ? b.value.map((v) => `- ${b.options.find((o) => o.value === v)?.label ?? v}`).join("\n") : "- none selected";
    case "segmented":
      return `**${b.label ?? "Choice"}:** ${b.options.find((o) => o.value === b.value)?.label ?? b.value ?? "—"}`;
    case "toggle":
      return `- [${b.value ? "x" : " "}] ${b.label}`;
    case "search":
      return `- filter: ${b.placeholder || "—"}`;
    case "data": {
      const cols = b.columns ?? (b.rows[0]?.every((c) => typeof c === "string") ? (b.rows[0] as string[]) : []);
      const body = b.columns ? b.rows : b.rows.slice(1);
      const head = `| ${cols.join(" | ")} |`;
      const sep = `|${cols.map(() => "---").join("|")}|`;
      return [head, sep, ...body.map((r) => `| ${r.map((c) => (c == null ? "" : String(c))).join(" | ")} |`)].join("\n");
    }
    case "graph": {
      const kinds = [...new Set(b.nodes.map((n) => n.kind || "node"))];
      const top = [...b.nodes].sort((a, z) => (z.weight ?? 1) - (a.weight ?? 1)).slice(0, 8);
      const byId = new Map(b.nodes.map((n) => [n.id, n.label]));
      return [
        b.title ? `**${b.title}**` : "",
        `${b.nodes.length} entities · ${b.edges.length} connections · ${kinds.length} kinds`,
        ...top.map((n) => `- **${n.label}**${n.kind && n.kind !== "node" ? ` (${n.kind})` : ""} — ${n.weight ?? 1}${n.detail ? ` · ${n.detail}` : ""}`),
        ...b.edges.slice(0, 12).map((e) => `- ${byId.get(e.source) ?? e.source} → ${byId.get(e.target) ?? e.target}${e.label ? ` (${e.label})` : ""}`),
      ].filter(Boolean).join("\n");
    }
    case "image":
      return `![${b.alt || ""}](${b.src})${b.caption ? `\n\n${b.caption}` : ""}`;
    case "gallery":
      return b.items.map((it) => `![${it.alt || ""}](${it.src})${it.caption ? ` — ${it.caption}` : ""}`).join("\n\n");
    case "layout": {
      // Composite container — the children serialize exactly as they would at the
      // top level, so a copied card reads in document order.
      const head = `**Layout (${b.layout})**\n`;
      return head + b.blocks.map(blockToMd).join("\n\n");
    }
    case "math":
      // TeX is copied verbatim inside a `$$` fence: that is what every markdown
      // reader (and GitHub) understands, and it round-trips the exact source the
      // card rendered from rather than the flattened glyphs. Inline formulas use
      // the single-dollar form so the copy is usable inline too.
      return (b.display === false ? `$${b.tex}$` : `$$\n${b.tex}\n$$`) + (b.label ? `\n*${b.label}*` : "");
    case "video":
      return `[video: ${b.src}]${b.caption ? `\n\n${b.caption}` : ""}`;
  }
}

function nodeLabel(b: Extract<CanvasBlock, { type: "diagram" }>, id: string): string {
  return b.nodes.find((n) => n.id === id)?.label || id;
}

export function canvasToMarkdown(spec: CanvasSpec): string {
  const parts = spec.blocks.map(blockToMd);
  return (spec.title ? `## ${spec.title}\n\n` : "") + parts.join("\n\n");
}
