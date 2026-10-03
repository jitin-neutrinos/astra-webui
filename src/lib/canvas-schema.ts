// Astra canvas schema v1 — generative-UI blocks embedded in assistant markdown.
// An assistant message may carry fenced ```astra-canvas blocks containing a
// JSON spec; splitCanvasBlocks() splits message text into ordered md/canvas
// parts so the timeline can interleave prose and rendered surfaces.
//
// Fail-soft law: an INVALID canvas (bad JSON, unknown block type, bad shape)
// degrades to plain markdown — the fence renders as a normal code block and
// content is never dropped. A still-streaming (unterminated) fence is hidden
// until it closes; if the stream finalizes while unterminated, it is preserved
// as markdown (streaming=false path).

export type Trend = "up" | "down" | "flat";

export interface KpiBlock {
  type: "kpi";
  label: string;
  value: string | number;
  delta?: string;
  trend?: Trend;
}

export interface ChartBlock {
  type: "chart";
  chart: "line" | "area" | "bar" | "radial" | "pie";
  title?: string;
  labels?: string[];
  series: { name: string; points: number[] }[];
}

export interface TableBlock {
  type: "table";
  columns: string[];
  rows: string[][];
}

export interface DiagramBlock {
  type: "diagram";
  layout: "flow" | "relationship";
  direction?: "tb" | "lr";
  nodes: { id: string; label: string; detail?: string }[];
  edges: { from: string; to: string; label?: string }[];
}

export interface ChecklistBlock {
  type: "checklist";
  items: { text: string; status?: "done" | "open" | "fail" }[];
}

export interface StepsBlock {
  type: "steps";
  items: { title: string; detail?: string; status?: "done" | "active" | "todo" | "fail" }[];
}

export interface CalloutBlock {
  type: "callout";
  tone: "info" | "warn" | "success" | "danger";
  title?: string;
  body: string;
}

export type CanvasBlock =
  | KpiBlock | ChartBlock | TableBlock | DiagramBlock
  | ChecklistBlock | StepsBlock | CalloutBlock;

export interface CanvasSpec {
  v: 1;
  title?: string;
  blocks: CanvasBlock[];
}

export type CanvasPart =
  | { kind: "md"; text: string }
  | { kind: "canvas"; spec: CanvasSpec };

const FENCE_RE = /```astra-canvas[^\n]*\n([\s\S]*?)```/g;
// trailing UNTERMINATED fence (streaming in progress)
const OPEN_FENCE_RE = /```astra-canvas[^\n]*\n([\s\S]*)$/;

const BLOCK_TYPES = new Set(["kpi", "chart", "table", "diagram", "checklist", "steps", "callout"]);
const CHART_KINDS = new Set(["line", "area", "bar", "radial", "pie"]);
const TONES = new Set(["info", "warn", "success", "danger"]);
const TRENDS = new Set(["up", "down", "flat"]);

function isStr(v: unknown): v is string { return typeof v === "string"; }
function isNum(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }
function isStrArr(v: unknown): v is string[] { return Array.isArray(v) && v.every(isStr); }

/** Validate one parsed block object; null = invalid. */
function validateBlock(b: any): CanvasBlock | null {
  if (!b || typeof b !== "object" || !isStr(b.type)) return null;
  switch (b.type) {
    case "kpi":
      if (!isStr(b.label) || (!isStr(b.value) && !isNum(b.value))) return null;
      if (b.delta != null && !isStr(b.delta)) return null;
      if (b.trend != null && !TRENDS.has(b.trend)) return null;
      return { type: "kpi", label: b.label, value: b.value, delta: b.delta, trend: b.trend };
    case "chart": {
      if (!CHART_KINDS.has(b.chart)) return null;
      if (!Array.isArray(b.series) || b.series.length === 0) return null;
      const series: { name: string; points: number[] }[] = [];
      for (const s of b.series) {
        if (!s || !isStr(s.name) || !Array.isArray(s.points) || !s.points.every(isNum)) return null;
        series.push({ name: s.name, points: s.points });
      }
      if (b.labels != null && !isStrArr(b.labels)) return null;
      return { type: "chart", chart: b.chart, title: isStr(b.title) ? b.title : undefined, labels: b.labels, series };
    }
    case "table":
      if (!isStrArr(b.columns) || !Array.isArray(b.rows) || !b.rows.every(isStrArr)) return null;
      return { type: "table", columns: b.columns, rows: b.rows };
    case "diagram": {
      if (b.layout !== "flow" && b.layout !== "relationship") return null;
      if (!Array.isArray(b.nodes) || b.nodes.length === 0) return null;
      const nodes: DiagramBlock["nodes"] = [];
      const ids = new Set<string>();
      for (const n of b.nodes) {
        if (!n || !isStr(n.id) || !isStr(n.label)) return null;
        ids.add(n.id);
        nodes.push({ id: n.id, label: n.label, detail: isStr(n.detail) ? n.detail : undefined });
      }
      if (!Array.isArray(b.edges)) return null;
      const edges: DiagramBlock["edges"] = [];
      for (const e of b.edges) {
        if (!e || !isStr(e.from) || !isStr(e.to) || !ids.has(e.from) || !ids.has(e.to)) return null;
        edges.push({ from: e.from, to: e.to, label: isStr(e.label) ? e.label : undefined });
      }
      return { type: "diagram", layout: b.layout, direction: b.direction === "lr" ? "lr" : "tb", nodes, edges };
    }
    case "checklist":
      if (!Array.isArray(b.items)) return null;
      const citems: ChecklistBlock["items"] = [];
      for (const it of b.items) {
        if (!it || !isStr(it.text)) return null;
        citems.push({ text: it.text, status: it.status === "done" || it.status === "fail" ? it.status : "open" });
      }
      return { type: "checklist", items: citems };
    case "steps":
      if (!Array.isArray(b.items)) return null;
      const sitems: StepsBlock["items"] = [];
      for (const it of b.items) {
        if (!it || !isStr(it.title)) return null;
        sitems.push({
          title: it.title,
          detail: isStr(it.detail) ? it.detail : undefined,
          status: it.status === "done" || it.status === "active" || it.status === "fail" ? it.status : "todo",
        });
      }
      return { type: "steps", items: sitems };
    case "callout":
      if (!TONES.has(b.tone) || !isStr(b.body)) return null;
      return { type: "callout", tone: b.tone, title: isStr(b.title) ? b.title : undefined, body: b.body };
    default:
      return null;
  }
}

/** Parse fence content into a spec; null = invalid → degrade to markdown. */
export function parseCanvasSpec(raw: string): CanvasSpec | null {
  let data: any;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== "object") return null;
  if (!Array.isArray(data.blocks) || data.blocks.length === 0) return null;
  const blocks: CanvasBlock[] = [];
  for (const b of data.blocks) {
    const v = validateBlock(b);
    if (!v) return null;
    blocks.push(v);
  }
  return { v: 1, title: isStr(data.title) ? data.title : undefined, blocks };
}

/**
 * Split message text into ordered md/canvas parts.
 * streaming=true: a trailing unterminated canvas fence is OMITTED (hidden
 *   until it closes — raw JSON mid-stream is noise, and the spec renders the
 *   moment the fence completes).
 * streaming=false (finalized): an unterminated fence is preserved as markdown.
 * Invalid closed canvases degrade to markdown (rendered as code blocks).
 */
export function splitCanvasBlocks(text: string, streaming = false): CanvasPart[] {
  const parts: CanvasPart[] = [];
  let last = 0;
  FENCE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE_RE.exec(text)) !== null) {
    const spec = parseCanvasSpec(m[1]);
    if (!spec) continue; // invalid → leave the fence inside the md flow
    if (m.index > last) parts.push({ kind: "md", text: text.slice(last, m.index) });
    parts.push({ kind: "canvas", spec });
    last = m.index + m[0].length;
  }

  let tail = text.slice(last);
  if (streaming) {
    // hide a still-open canvas fence; keep any text before it
    const open = OPEN_FENCE_RE.exec(tail);
    if (open) tail = tail.slice(0, open.index);
  }
  if (tail) parts.push({ kind: "md", text: tail });
  return parts;
}

/** True when the text contains at least one VALID closed canvas (mount gate for lazy chunk). */
export function hasCanvas(text: string): boolean {
  FENCE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE_RE.exec(text)) !== null) {
    if (parseCanvasSpec(m[1])) return true;
  }
  return false;
}

void BLOCK_TYPES;
