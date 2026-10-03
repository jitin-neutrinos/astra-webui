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

export interface ProgressBlock {
  type: "progress";
  label: string;
  value: number;
  max?: number;
  unit?: string;
  status?: "ok" | "warn" | "fail";
  detail?: string;
}

export interface TimelineBlock {
  type: "timeline";
  items: { title: string; detail?: string; time?: string; status?: "done" | "active" | "todo" | "fail" }[];
}

export interface CompareBlock {
  type: "compare";
  items: {
    name: string;
    caption?: string;
    badge?: string;
    points: { text: string; tone?: "pro" | "con" | "neutral" }[];
  }[];
}

export interface TreeBlock {
  type: "tree";
  nodes: { id: string; label: string; detail?: string; children?: string[] }[];
}

export interface CodeBlock {
  type: "code";
  language?: string;
  filename?: string;
  code: string;
}

export interface ReferencesBlock {
  type: "references";
  items: { title: string; href?: string; note?: string }[];
}

export type CanvasBlock =
  | KpiBlock | ChartBlock | TableBlock | DiagramBlock
  | ChecklistBlock | StepsBlock | CalloutBlock
  | ProgressBlock | TimelineBlock | CompareBlock | TreeBlock
  | CodeBlock | ReferencesBlock;

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
    case "progress":
      if (!isStr(b.label) || !isNum(b.value)) return null;
      if (b.max != null && !isNum(b.max)) return null;
      if (b.unit != null && !isStr(b.unit)) return null;
      if (b.detail != null && !isStr(b.detail)) return null;
      return {
        type: "progress",
        label: b.label,
        value: b.value,
        max: isNum(b.max) ? b.max : undefined,
        unit: isStr(b.unit) ? b.unit : undefined,
        status: b.status === "warn" || b.status === "fail" ? b.status : "ok",
        detail: isStr(b.detail) ? b.detail : undefined,
      };
    case "timeline": {
      if (!Array.isArray(b.items) || b.items.length === 0) return null;
      const items: TimelineBlock["items"] = [];
      for (const it of b.items) {
        if (!it || !isStr(it.title)) return null;
        items.push({
          title: it.title,
          detail: isStr(it.detail) ? it.detail : undefined,
          time: isStr(it.time) ? it.time : undefined,
          status: it.status === "done" || it.status === "active" || it.status === "fail" ? it.status : "todo",
        });
      }
      return { type: "timeline", items };
    }
    case "compare": {
      if (!Array.isArray(b.items) || b.items.length === 0) return null;
      const items: CompareBlock["items"] = [];
      for (const it of b.items) {
        if (!it || !isStr(it.name) || !Array.isArray(it.points) || it.points.length === 0) return null;
        const points: CompareBlock["items"][number]["points"] = [];
        for (const p of it.points) {
          if (!p || !isStr(p.text)) return null;
          points.push({ text: p.text, tone: p.tone === "pro" || p.tone === "con" ? p.tone : "neutral" });
        }
        items.push({
          name: it.name,
          caption: isStr(it.caption) ? it.caption : undefined,
          badge: isStr(it.badge) ? it.badge : undefined,
          points,
        });
      }
      return { type: "compare", items };
    }
    case "tree": {
      if (!Array.isArray(b.nodes) || b.nodes.length === 0) return null;
      const ids = new Set<string>();
      const nodes: TreeBlock["nodes"] = [];
      for (const n of b.nodes) {
        if (!n || !isStr(n.id) || !isStr(n.label)) return null;
        ids.add(n.id);
        nodes.push({
          id: n.id,
          label: n.label,
          detail: isStr(n.detail) ? n.detail : undefined,
          children: Array.isArray(n.children) ? n.children.filter(isStr) : undefined,
        });
      }
      for (const n of nodes) {
        for (const c of n.children || []) if (!ids.has(c)) return null; // dangling child = invalid
      }
      return { type: "tree", nodes };
    }
    case "code":
      if (!isStr(b.code) || b.code.trim() === "") return null;
      if (b.language != null && !isStr(b.language)) return null;
      if (b.filename != null && !isStr(b.filename)) return null;
      return { type: "code", code: b.code, language: isStr(b.language) ? b.language : undefined, filename: isStr(b.filename) ? b.filename : undefined };
    case "references": {
      if (!Array.isArray(b.items) || b.items.length === 0) return null;
      const items: ReferencesBlock["items"] = [];
      for (const it of b.items) {
        if (!it || !isStr(it.title)) return null;
        if (it.href != null && !isStr(it.href)) return null;
        items.push({ title: it.title, href: isStr(it.href) ? it.href : undefined, note: isStr(it.note) ? it.note : undefined });
      }
      return { type: "references", items };
    }
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

export interface TurnCanvasPlan {
  /** Per text-segment markdown with every canvas fence removed. */
  mdPerSeg: string[];
  /** Canvases found, each anchored to the segment in which its closing fence lands. */
  canvases: { spec: CanvasSpec; afterSeg: number }[];
}

/**
 * Turn-level canvas planning.
 *
 * A single assistant message is NOT one string: the segment engine opens a NEW
 * text segment whenever the previous one is not a running text segment — a tool
 * call, a message boundary, or a `text-final` that does not extend the live
 * text all split it (chat-segments.ts). An ```astra-canvas fence that spans such
 * a boundary used to be unparseable in BOTH halves, so the canvas silently
 * degraded to a code block — the "canvas missing from mid-response" bug.
 *
 * This stitches the turn's text segments back together, parses canvases out of
 * the whole, and hands each canvas back anchored to the segment where it
 * COMPLETES, so it still renders in the right place in the transcript.
 *
 * Fail-soft is unchanged: an invalid fence stays in the markdown, and while
 * streaming a still-open fence is withheld rather than flashed as raw JSON.
 */
export function planTurnCanvases(segTexts: string[], streaming = false): TurnCanvasPlan {
  const texts = segTexts.map((t) => t ?? "");
  const mdPerSeg = texts.slice();
  const canvases: TurnCanvasPlan["canvases"] = [];
  if (texts.length === 0) return { mdPerSeg, canvases };

  const starts: number[] = [];
  let total = "";
  for (const t of texts) {
    starts.push(total.length);
    total += t;
  }
  const segOf = (pos: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= pos) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  };

  // Collect removals per segment first, then apply RIGHT-TO-LEFT so earlier
  // splices cannot shift the offsets of later ones.
  const cuts: number[][] = texts.map(() => []);
  FENCE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE_RE.exec(total)) !== null) {
    const spec = parseCanvasSpec(m[1]);
    if (!spec) continue; // invalid → leave the fence in the markdown
    const s = m.index;
    const e = m.index + m[0].length;
    for (let i = 0; i < texts.length; i++) {
      const ss = starts[i];
      const se = ss + texts[i].length;
      const cs = Math.max(s, ss);
      const ce = Math.min(e, se);
      if (cs < ce) cuts[i].push(cs - ss, ce - ss);
    }
    canvases.push({ spec, afterSeg: segOf(e - 1) });
  }

  for (let i = 0; i < texts.length; i++) {
    if (cuts[i].length === 0) continue;
    let out = mdPerSeg[i];
    for (let k = cuts[i].length - 2; k >= 0; k -= 2) {
      out = out.slice(0, cuts[i][k]) + out.slice(cuts[i][k + 1]);
    }
    mdPerSeg[i] = out;
  }

  // Streaming: withhold a still-open fence at the tail instead of flashing raw
  // JSON. Anything already closed above rendered above.
  if (streaming) {
    for (let i = texts.length - 1; i >= 0; i--) {
      if (!mdPerSeg[i].includes("```astra-canvas")) continue;
      const open = OPEN_FENCE_RE.exec(mdPerSeg[i]);
      if (open) mdPerSeg[i] = mdPerSeg[i].slice(0, open.index);
      break;
    }
  }

  return { mdPerSeg, canvases };
}

void BLOCK_TYPES;
