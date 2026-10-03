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
  /** Optional inline sparkline (3-24 finite points). Degrades silently if bad. */
  spark?: number[];
}

export interface ChartBlock {
  type: "chart";
  chart: "line" | "area" | "bar" | "radial" | "pie" | "donut" | "stack";
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

export interface QuoteBlock {
  type: "quote";
  text: string;
  attribution?: string;
  role?: string;
  context?: string;
}

export interface KeyValueBlock {
  type: "keyvalue";
  title?: string;
  items: { key: string; value: string | number; mono?: boolean }[];
}

export type DiffOp = "add" | "del" | "ctx";

export interface DiffBlock {
  type: "diff";
  language?: string;
  filename?: string;
  /** One hunk = one titled change. `lines` carries the unified-diff rows. */
  hunks: { header?: string; lines: { op: DiffOp; text: string }[] }[];
}

export interface HeatmapBlock {
  type: "heatmap";
  title?: string;
  rows: string[];
  cols: string[];
  /** values[r][c] — must match rows×cols; numbers are scaled to the grid max. */
  values: number[][];
}

export interface TabsBlock {
  type: "tabs";
  items: { label: string; blocks: CanvasBlock[] }[];
}

export type CanvasBlock =
  | KpiBlock | ChartBlock | TableBlock | DiagramBlock
  | ChecklistBlock | StepsBlock | CalloutBlock
  | ProgressBlock | TimelineBlock | CompareBlock | TreeBlock
  | CodeBlock | ReferencesBlock
  | QuoteBlock | KeyValueBlock | DiffBlock | HeatmapBlock | TabsBlock;

export interface CanvasSpec {
  v: 1;
  title?: string;
  blocks: CanvasBlock[];
}

export type CanvasPart =
  | { kind: "md"; text: string }
  | { kind: "canvas"; spec: CanvasSpec };

// Fence discovery lives in scanFences() — a regex cannot respect the author's
// fence length, which a `code` block containing ``` requires.
// A still-open fence at the tail (streaming in progress). NO `^` anchor: the open
// fence is usually mid-message ("done. ```astra-canvas"), and an anchored pattern
// silently fails to strip it — raw JSON then streams to the user.
const OPEN_FENCE_RE = /`{3,}astra-canvas[^\n]*\n([\s\S]*)$/;

const BLOCK_TYPES = new Set([
  "kpi", "chart", "table", "diagram", "checklist", "steps", "callout",
  "progress", "timeline", "compare", "tree", "code", "references",
  "quote", "keyvalue", "diff", "heatmap", "tabs",
]);
const CHART_KINDS = new Set(["line", "area", "bar", "radial", "pie", "donut", "stack"]);
const TONES = new Set(["info", "warn", "success", "danger"]);
const TRENDS = new Set(["up", "down", "flat"]);

// Alias table shared by validateBlock AND the top-level coercer, so "is this a
// block type" can never drift from "what does it normalize to". Replay of 27
// real fences showed the model reaches for these near-miss names constantly.
const TYPE_ALIASES: Record<string, string> = {
  metric: "kpi", stat: "kpi", kpis: "kpi",
  graph: "chart", plot: "chart",
  flowchart: "diagram", flow: "diagram", map: "diagram", "graph-map": "diagram",
  list: "checklist", todo: "checklist", tasks: "checklist",
  "ordered-list": "steps", process: "steps",
  note: "callout", warning: "callout", insight: "callout",
  meter: "progress", bar: "progress", gauge: "progress",
  sources: "references", citations: "references", links: "references",
  snippet: "code",
  quotation: "quote", testimonial: "quote",
  kv: "keyvalue", "key-value": "keyvalue", "keyvalue-pairs": "keyvalue", fields: "keyvalue",
  patch: "diff", "code-diff": "diff", "unified-diff": "diff", changeset: "diff",
  "heat-map": "heatmap", heat: "heatmap",
  "tab-group": "tabs", tabbed: "tabs",
};

// kpi `trend` is a DIRECTION. Models reuse severity/status words for it
// (observed live: "good", "warn"). Map the near-misses; a genuinely unknown
// word still rejects the block rather than inventing a direction.
const TREND_ALIASES: Record<string, Trend> = {
  good: "up", ok: "up", positive: "up", success: "up", improved: "up", increase: "up", higher: "up",
  bad: "down", negative: "down", poor: "down", fail: "down", decrease: "down", lower: "down", worse: "down",
  warn: "flat", neutral: "flat", same: "flat", stable: "flat", none: "flat",
};

function looksLikeBlockType(v: unknown): boolean {
  return isStr(v) && (TYPE_ALIASES[v] !== undefined || BLOCK_TYPES.has(v));
}

function isStr(v: unknown): v is string { return typeof v === "string"; }
function isNum(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }
function isStrArr(v: unknown): v is string[] { return Array.isArray(v) && v.every(isStr); }

/** Validate one parsed block object; null = invalid. Exported for the
 *  streaming partial parser, which validates blocks as they arrive. */
export function validateBlock(b: any): CanvasBlock | null {
  if (!b || typeof b !== "object" || !isStr(b.type)) return null;
  // Aliases: models reach for near-miss names. Accept the obvious ones instead
  // of dropping the block (and, before per-block tolerance, the whole card).
  const T = b.type;
  b.type = TYPE_ALIASES[T] ?? T;

  // chart kind aliases + `type` used instead of `chart`
  if (b.type === "chart" && !CHART_KINDS.has(b.chart)) {
    const kind = b.chart ?? b.kind ?? b.chartType;
    if (kind === "donut" || kind === "doughnut" || kind === "circular") b.chart = "donut";
    else if (kind === "stack" || kind === "stacked" || kind === "stacked-bar") b.chart = "stack";
    else if (kind === "bars" || kind === "columns") b.chart = "bar";
    else if (kind === "lines") b.chart = "line";
    else if (kind === "areas") b.chart = "area";
    else if (kind === "gauge" || kind === "circular-bar") b.chart = "radial";
  }
  // diagram layout alias: a `flowchart` block usually omits `layout`
  if (b.type === "diagram" && b.layout == null) {
    b.layout = b.kind === "relationship" || b.kind === "map" ? "relationship" : "flow";
  }

  switch (b.type) {
    case "kpi":
      if (!isStr(b.label) || (!isStr(b.value) && !isNum(b.value))) return null;
      if (b.delta != null && !isStr(b.delta)) return null;
      if (b.trend != null) {
        if (!TRENDS.has(b.trend)) {
          const mapped = TREND_ALIASES[b.trend];
          if (!mapped) return null; // genuinely unknown direction → no silent lie
          b.trend = mapped;
        }
      }
      // spark: 3-24 finite points, else silently dropped (the tile stays useful)
      let spark: number[] | undefined;
      if (b.spark != null) {
        if (Array.isArray(b.spark) && b.spark.length >= 3 && b.spark.length <= 24 && b.spark.every(isNum)) spark = b.spark;
      }
      return { type: "kpi", label: b.label, value: b.value, delta: b.delta, trend: b.trend, spark };
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
    case "quote": {
      if (!isStr(b.text) || b.text.trim() === "") return null;
      return {
        type: "quote",
        text: b.text,
        attribution: isStr(b.attribution) ? b.attribution : isStr(b.author) ? b.author : undefined,
        role: isStr(b.role) ? b.role : undefined,
        context: isStr(b.context) ? b.context : isStr(b.source) ? b.source : undefined,
      };
    }
    case "keyvalue": {
      if (!Array.isArray(b.items) || b.items.length === 0) return null;
      const items: KeyValueBlock["items"] = [];
      for (const it of b.items) {
        if (!it || !isStr(it.key)) return null;
        if (!isStr(it.value) && !isNum(it.value)) return null;
        items.push({ key: it.key, value: it.value, mono: it.mono === true ? true : undefined });
      }
      return { type: "keyvalue", title: isStr(b.title) ? b.title : undefined, items };
    }
    case "diff": {
      // Accept either the structured `hunks` shape or a raw `lines` array
      // (models paste unified diffs as flat lines: "+ added", "- removed").
      let hunks: DiffBlock["hunks"] | null = null;
      if (Array.isArray(b.hunks) && b.hunks.length > 0) {
        hunks = [];
        for (const h of b.hunks) {
          if (!h || !Array.isArray(h.lines) || h.lines.length === 0) return null;
          const lines: DiffBlock["hunks"][number]["lines"] = [];
          for (const l of h.lines) {
            if (!l || !isStr(l.text) || !isStr(l.op)) return null;
            if (l.op !== "add" && l.op !== "del" && l.op !== "ctx") {
              // alias the near-miss op names; unknown ops reject the hunk
              if (l.op === "+" || l.op === "added" || l.op === "insert") l.op = "add";
              else if (l.op === "-" || l.op === "removed" || l.op === "delete") l.op = "del";
              else if (l.op === " " || l.op === "context" || l.op === "same") l.op = "ctx";
              else return null;
            }
            lines.push({ op: l.op as DiffOp, text: l.text });
          }
          hunks.push({ header: isStr(h.header) ? h.header : undefined, lines });
        }
      } else if (Array.isArray(b.lines) && b.lines.length > 0) {
        hunks = [{ header: isStr(b.header) ? b.header : undefined, lines: [] }];
        for (const l of b.lines) {
          if (!l) return null;
          if (isStr(l)) {
            // raw unified-diff row: "+foo", "-foo", " foo", "@@ hunk header @@"
            if (l.startsWith("@@")) { hunks.push({ header: l, lines: [] }); continue; }
            const op = l[0] === "+" ? "add" : l[0] === "-" ? "del" : "ctx";
            hunks[hunks.length - 1].lines.push({ op, text: l.replace(/^[+-]?[ \t]?/, "") });
          } else if (typeof l === "object" && isStr(l.text) && isStr(l.op)) {
            if (!["add", "del", "ctx", "+", "-", " "].includes(l.op)) return null;
            hunks[hunks.length - 1].lines.push({
              op: (l.op === "+" || l.op === "add" ? "add" : l.op === "-" || l.op === "del" ? "del" : "ctx") as DiffOp,
              text: l.text,
            });
          } else return null;
        }
        if (hunks[0].lines.length === 0) hunks.shift();
      }
      if (!hunks || hunks.length === 0) return null;
      return {
        type: "diff",
        language: isStr(b.language) ? b.language : undefined,
        filename: isStr(b.filename) ? b.filename : undefined,
        hunks,
      };
    }
    case "heatmap": {
      if (!isStrArr(b.rows) || b.rows.length === 0) return null;
      if (!isStrArr(b.cols) || b.cols.length === 0) return null;
      if (!Array.isArray(b.values) || b.values.length !== b.rows.length) return null;
      const values: number[][] = [];
      for (const row of b.values) {
        if (!Array.isArray(row) || row.length !== b.cols.length || !row.every(isNum)) return null;
        values.push(row);
      }
      return { type: "heatmap", title: isStr(b.title) ? b.title : undefined, rows: b.rows, cols: b.cols, values };
    }
    case "tabs": {
      if (!Array.isArray(b.items) || b.items.length === 0) return null;
      const items: TabsBlock["items"] = [];
      for (const it of b.items) {
        if (!it || !isStr(it.label)) return null;
        // tabs contain other blocks; keep every valid one, drop bad ones
        const inner: CanvasBlock[] = [];
        for (const x of Array.isArray(it.blocks) ? it.blocks : Array.isArray(it.items) ? it.items : []) {
          const v = validateBlock(x);
          if (v) inner.push(v);
        }
        if (inner.length === 0) return null; // a tab with nothing to show is not a tab
        items.push({ label: it.label, blocks: inner });
      }
      return { type: "tabs", items };
    }
    default:
      return null;
  }
}

/**
 * Quote bare object keys: `{label:"x",value:1}` → `{"label":"x","value":1}`.
 *
 * Observed live: when the model writes a canvas under a type-tagging inner fence
 * (```kpi) it emits JS-object-literal keys, not JSON keys. JSON.parse rejects
 * the whole line, so the card degraded.
 *
 * String-aware on purpose: a regex alone would also rewrite text INSIDE string
 * values (`"see { a: 1 }"`), silently corrupting displayed data. This tracks
 * string/escape state, so only real keys are touched.
 */
function quoteBareKeys(s: string): string {
  let out = "";
  let i = 0;
  let inStr = false;
  let esc = false;
  while (i < s.length) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    const prev = out.replace(/\s+$/, "").slice(-1);
    if (prev === "{" || prev === ",") {
      const m = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/.exec(s.slice(i));
      if (m) {
        out += m[0].replace(m[1], `"${m[1]}"`);
        i += m[0].length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

/** Strip comments + trailing commas before JSON.parse (models emit both). */
function lenientJson(raw: string): unknown {
  const attempt = (s: string) => JSON.parse(s);
  try { return attempt(raw); } catch { /* fall through to repair */ }
  const repaired = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")      // block comments
    .replace(/(^|[^:"'\\])\/\/.*$/gm, "$1") // line comments (not inside strings)
    .replace(/,(\s*[}\]])/g, "$1");         // trailing commas
  try { return attempt(repaired); } catch { /* try bare-key quoting */ }
  return attempt(quoteBareKeys(repaired));
}

/**
 * Coerce whatever the fence contained into `{ blocks: [...] }`.
 *
 * Replay of every real fence in the DB (27 attempts) found the parser was fine
 * and the EMISSION shape was wrong in four recurring ways, each of which used
 * to render as raw JSON:
 *
 *   A. bare block          { "type":"kpi", "label":… }            → 1 block
 *   B. block with `blocks` { "type":"kpi", "blocks":[{label,value}] } → N blocks
 *                          (the model used `blocks` as the ITEM list of one
 *                           logical block, not as the envelope)
 *   C. bare `items`        { "type":"steps", "items":[…] }         → 1 block
 *   D. NDJSON body         one {…} object per line, no envelope
 *
 * B is the ambiguous one and the alias table resolves it: the inner objects
 * have NO `type`, so they cannot be blocks on their own — they are items of
 * the outer `type`. When the inner objects DO carry a type, the envelope
 * reading wins.
 */
/** Stamp a default `type` on items that carry none (see the misnested fence). */
function applyHint(list: any[], hint?: string): any[] {
  if (!hint) return list;
  return list.map((x) =>
    x && typeof x === "object" && !Array.isArray(x) && !isStr(x.type) ? { ...x, type: hint } : x,
  );
}

function coerceToBlocks(data: any): any[] {
  if (Array.isArray(data)) return applyHint(data, markerHint(data));
  if (!data || typeof data !== "object") return [];

  const hint = isStr(data.__defaultType) ? data.__defaultType : undefined;

  if (Array.isArray(data.blocks)) {
    // B: `blocks` as the item list of a single logical block. The inner objects
    // have no `type` of their own → they are items, and the outer type applies.
    if (looksLikeBlockType(data.type) && data.blocks.every((x: any) => x && typeof x === "object" && !isStr(x.type))) {
      return data.blocks.map((x: any) => ({ ...x, type: data.type }));
    }
    return applyHint(data.blocks, hint);
  }
  // A / C: one bare block, or a bare `items` collection.
  if (looksLikeBlockType(data.type)) return [{ ...data, __defaultType: undefined }];
  // D: a wrapper whose only content is a known collection field.
  for (const field of ["items", "nodes", "series", "rows"]) {
    if (Array.isArray(data[field]) && data[field].length > 0) return [{ ...data, items: data[field] }];
  }
  return [];
}

/** A healed misnested fence leaves its type as a lone marker object. */
function markerHint(list: any[]): string | undefined {
  for (const x of list) {
    if (x && typeof x === "object" && !Array.isArray(x) && isStr(x.__defaultType) && Object.keys(x).length === 1) {
      return x.__defaultType;
    }
  }
  return undefined;
}

/** NDJSON body (one JSON object per line, no envelope). */
function parseNdjson(raw: string): any[] | null {
  const objs: any[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim().replace(/,$/, "");
    if (!t || (t[0] !== "{" && t[0] !== "[")) continue;
    try {
      const v = JSON.parse(t);
      if (v && typeof v === "object") { if (Array.isArray(v)) objs.push(...v); else objs.push(v); }
    } catch {
      // Bare keys (JS-object-literal style) are the common case here — retry
      // with the same repair lenientJson uses before giving up on the line.
      try {
        const v = lenientJson(t);
        if (v && typeof v === "object") { if (Array.isArray(v)) objs.push(...v); else objs.push(v); continue; }
      } catch { /* fall through */ }
      return null; // a line we cannot read → not NDJSON
    }
  }
  return objs.length ? objs : null;
}

/**
 * The model sometimes opens ```astra-canvas and then IMMEDIATELY another fence
 * (```kpi) before writing its objects. The outer fence then closes on the empty
 * first line, the payload lands OUTSIDE the fence, and the body handed to the
 * parser is "" — the card is lost with no way to recover it downstream.
 *
 * Runs on the WHOLE message text before the fence regex, because the damage is
 * to the fence delimiters, not to the payload.
 */
function healMisnestedFence(text: string): string {
  return text.replace(
    /```astra-canvas[^\n]*\n```([a-zA-Z0-9_-]*)\n/g,
    (_m, lang: string) => "```astra-canvas\n" + (lang ? `{ "__defaultType": "${lang}" }\n` : ""),
  );
}

/** Parse fence content into a spec; null = invalid → degrade to markdown. */
export function parseCanvasSpec(raw: string): CanvasSpec | null {
  let data: any;
  try { data = lenientJson(raw); } catch { data = null; }
  if (data == null) {
    // Last resort before degrading: NDJSON. Never reached for a well-formed
    // envelope, so it cannot change the behaviour of any spec that already parsed.
    const nd = parseNdjson(raw);
    if (!nd) return null;
    data = nd;
  }
  if (!data || typeof data !== "object") return null;
  const list = coerceToBlocks(data);
  if (list.length === 0) return null;
  // PER-BLOCK tolerance: one malformed block must not sink a whole card. Keep
  // every block that validates; degrade to markdown only if NONE do (otherwise
  // a single unexpected block shape silently turned the entire canvas into a
  // wall of raw JSON in the chat).
  const blocks: CanvasBlock[] = [];
  for (const b of list) {
    const v = validateBlock(b);
    if (v) blocks.push(v);
  }
  if (blocks.length === 0) return null;
  const title = isStr(data.title) ? data.title : undefined;
  return { v: 1, title, blocks };
}

interface FenceMatch { start: number; end: number; body: string; }

/**
 * Find canvas fences, respecting the authorable fence LENGTH.
 *
 * A regex cannot do this: `/```astra-canvas…```/` closes on the first ``` inside
 * the body, so a `code` block whose content contains triple backticks (a markdown
 * example, a template literal, a regex) truncated the JSON and the whole card
 * degraded to raw text. Verified against a real emitted card.
 *
 * The fence is markdown's own rule: the opener declares its length and it closes
 * on a run of AT LEAST that many backticks **on its own line**. That line anchor
 * is load-bearing — a 4-backtick run sitting mid-line inside a JSON string
 * (```` ```` ```` in the directive text) must NOT close a 3-backtick fence, or
 * real cards stop parsing. Anchoring was what made the first attempt break.
 */
function scanFences(text: string): FenceMatch[] {
  const out: FenceMatch[] = [];
  const re = /(`{3,})astra-canvas[^\n]*\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const bodyStart = m.index + m[0].length;
    // Candidate closers, in the order they OCCUR. The closer is any run of >= 3
    // backticks; the one that wins is the FIRST whose BODY PARSES. That single
    // rule satisfies every case at once:
    //   • the canonical "\n```\n" closes immediately;
    //   • "\n``` outro" (trailing prose) still closes;
    //   • a ```` ```` ```` run sitting INSIDE the JSON is skipped, because the
    //     body cut there does not parse while the real closer's does;
    //   • two canvases in one message each close at their own run;
    //   • a mismatched opener (replaying history, the model emitted a SEVEN-backtick
    //     opener closed by three) still parses, because the opener's length is
    //     not used to gate the closer.
    // Preferring a "lone line" closer instead let a LATER run swallow an earlier
    // legitimate one and ate the following canvas.
    const anyRe = /`{3,}/g;
    anyRe.lastIndex = bodyStart;
    let close: RegExpExecArray | null = null;
    let fallback: RegExpExecArray | null = null; // earliest lone-line run
    for (let c = anyRe.exec(text); c; c = anyRe.exec(text)) {
      if (/^[ \t]*(?=\r?$)/.test(text.slice(c.index + c[0].length)) && !fallback) fallback = c;
      if (parseCanvasSpec(text.slice(bodyStart, c.index))) { close = c; break; }
    }
    if (!close) close = fallback;
    if (!close) continue; // unterminated — caller decides (stream vs finalized)
    const end = close.index + close[0].length;
    out.push({ start: m.index, end, body: text.slice(bodyStart, close.index) });
    re.lastIndex = end;
  }
  return out;
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
  text = healMisnestedFence(text);
  const parts: CanvasPart[] = [];
  let last = 0;
  for (const f of scanFences(text)) {
    const spec = parseCanvasSpec(f.body);
    if (!spec) {
      // Surface WHY a card silently became a code block — this used to fail
      // invisibly, which cost a debugging round every time.
      if (import.meta.env?.DEV) {
        console.warn("[canvas] fence failed to parse, rendering as code block:", f.body.slice(0, 160));
      }
      continue;
    }
    if (f.start > last) parts.push({ kind: "md", text: text.slice(last, f.start) });
    parts.push({ kind: "canvas", spec });
    last = f.end;
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
  text = healMisnestedFence(text);
  return scanFences(text).some((f) => parseCanvasSpec(f.body) !== null);
}

export interface TurnCanvasPlan {
  /** Per text-segment markdown with every canvas fence removed. */
  mdPerSeg: string[];
  /** Canvases found, each anchored to the segment in which its closing fence lands. */
  canvases: { spec: CanvasSpec; afterSeg: number }[];
}

/**
 * Streaming incremental parse of an OPEN canvas fence body.
 *
 * The body is partial JSON (`{ "blocks": [ {...}, {...}, {`half). We walk it
 * brace-by-brace, tracking string/escape state, and validate every COMPLETE
 * top-level element of `blocks` as soon as its closing brace lands. That lets
 * the UI paint each block the moment it finishes instead of waiting for the
 * whole fence — "watch the canvas render", not "card appears at the end".
 *
 * Returns only blocks that are fully formed AND valid; a half-written block is
 * skipped until more text arrives (its next render picks it up).
 *
 * v3: an element that fails strict JSON.parse gets the lenient repair pass
 * (comments, trailing commas, bare keys) before being dropped — the model
 * streams the same sloppy shapes it writes closed, and a mid-stream element
 * ending in `,` would otherwise wait for the closing fence. The repair never
 * touches a well-formed element: it only runs after strict parse throws.
 */
export function parseStreamingBlocks(body: string): CanvasBlock[] {
  const blocksKey = body.indexOf('"blocks"');
  if (blocksKey === -1) return [];
  const arrStart = body.indexOf("[", blocksKey);
  if (arrStart === -1) return [];

  const out: CanvasBlock[] = [];
  let depth = 0;          // depth of the CURRENT element (0 = between elements)
  let inStr = false;
  let esc = false;
  let elemStart = -1;

  for (let i = arrStart + 1; i < body.length; i++) {
    const ch = body[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; if (depth === 0) { /* string start is not an element start */ } continue; }
    if (ch === "{" || ch === "[") {
      if (depth === 0) elemStart = i;
      depth++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0 && elemStart !== -1) {
        const raw = body.slice(elemStart, i + 1);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          try { parsed = lenientJson(raw); } catch { parsed = null; }
        }
        if (parsed) {
          const v = validateBlock(parsed);
          if (v) out.push(v);
        }
        elemStart = -1;
      }
      if (depth < 0) break; // the blocks array closed
      continue;
    }
  }
  return out;
}

/** Pull the partial canvas state out of a still-open fence at the tail of text. */
export function parseStreamingCanvas(text: string): { title?: string; blocks: CanvasBlock[] } | null {
  const open = OPEN_FENCE_RE.exec(text);
  if (!open) return null;
  const body = open[1];
  const blocks = parseStreamingBlocks(body);
  if (blocks.length === 0) return null;
  const tm = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(body);
  let title: string | undefined;
  if (tm) { try { title = JSON.parse(`"${tm[1]}"`); } catch { title = tm[1]; } }
  return { title, blocks };
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
  const texts = segTexts.map((t) => healMisnestedFence(t ?? ""));
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

  // Classify every valid fence:
  //   CONTAINED (opens and closes inside one segment) → leave it in the
  //     markdown. RichText splits and renders it INLINE, so prose that follows
  //     the canvas stays BELOW it — this is the common case and it must not be
  //     hoisted to the end of the segment.
  //   SPANNING (opens in one segment, closes in another) → cannot be parsed
  //     from either half, so cut it out and anchor it to the closing segment.
  const cuts: number[][] = texts.map(() => []);
  for (const f of scanFences(total)) {
    const spec = parseCanvasSpec(f.body);
    if (!spec) continue; // invalid → leave the fence in the markdown
    const s = f.start;
    const e = f.end;
    const startSeg = segOf(s);
    const endSeg = segOf(e - 1);
    if (startSeg === endSeg) continue; // contained → inline, no cut
    for (let i = startSeg; i <= endSeg; i++) {
      const ss = starts[i];
      const se = ss + texts[i].length;
      const cs = Math.max(s, ss);
      const ce = Math.min(e, se);
      if (cs < ce) cuts[i].push(cs - ss, ce - ss);
    }
    canvases.push({ spec, afterSeg: endSeg });
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
