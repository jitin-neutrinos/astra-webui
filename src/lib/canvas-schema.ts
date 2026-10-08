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

import type { Binding } from "./canvas-bind.ts";

export type Trend = "up" | "down" | "flat";

export interface KpiBlock {
  type: "kpi";
  label: string;
  /** A reactive card may author the figure as a binding instead of a literal. */
  value: string | number | Binding;
  delta?: string | Binding;
  trend?: Trend;
  /** Optional inline sparkline (3-24 finite points). Degrades silently if bad. */
  spark?: number[];
}

export interface ChartBlock {
  type: "chart";
  chart: "line" | "area" | "bar" | "radial" | "pie" | "donut" | "stack"
    // v5: these four ride the ALREADY-INSTALLED recharts 2.15 components —
    // sankey/treemap/funnel/radar/scatter — so zero new bytes ship.
    | "sankey" | "treemap" | "funnel" | "radar" | "scatter"
    // canvas v1 expansion: `box` is recharts Bar + ErrorBar with the quartiles
    // computed in the renderer; `histogram` is d3-array `bin` feeding the SAME
    // bar path. Both take the ordinary `{labels, series[].points}` shape — a box
    // is one series per group, a histogram is one series of raw samples — so
    // neither needs a new authoring key.
    | "box" | "histogram" | "errorbar" | "candlestick" | "waterfall" | "violin";
  title?: string;
  labels?: string[];
  series: {
    name: string;
    points: number[];
    items?: { name: string; value: number }[];
    links?: { source: string; target: string; value: number }[];
    ohlc?: number[][];
    error?: { lo: number[]; hi: number[] };
    waterfallKinds?: string[];
    kde?: { x: number; y: number }[];
    visible?: unknown;
  }[];
  scale?: string;
  p?: number;
  refline?: { value: number; tone?: string; label?: string };
}

export interface TableBlock {
  type: "table";
  columns: string[];
  rows: (string | number | boolean | null)[][];
  /** Reactive: rows come from a `data` carrier through this reader. */
  bind?: unknown;
  /** Renderer-computed summary footer. The MODEL NEVER does this arithmetic:
   *  ask for the statistics instead of inventing a mean in prose. */
  stats?: TableStats;
  colTypes?: ("text" | "color" | "contrast" | "bar" | "delta" | "status")[];
  colMeta?: ({ levels?: string[] } | null)[];
  footnote?: string;
  sig?: { column: string; thresholds?: number[] };
  units?: string[];
}

/** The summary statistics `table.stats` may request. All computed in the
 *  renderer from the rendered rows, so a wrong number cannot be authored. */
export type TableStat = "mean" | "median" | "sd" | "min" | "max" | "p95" | "count";

export interface TableStats {
  /** Which columns to summarise. Omitted = every numeric column. */
  columns?: string[];
  /** Omitted = every statistic, for the chosen columns. */
  compute?: TableStat[];
}

export interface DiagramBlock {
  type: "diagram";
  layout: "flow" | "relationship";
  direction?: "tb" | "lr";
  /** One-to-three sentence reading of the diagram (shown as the summary + used as the aria description). */
  summary?: string;
  caption?: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** Edge routing: orthogonal (dagre's default, right-angle segments) or smooth. */
  route?: "orthogonal" | "smooth";
}

/** A node with `fields` renders as an ENTITY box: header bar + one row per field.
 *  `shape` only changes the box treatment; the dagre layout already takes an
 *  explicit {width,height}, so a taller box with internal text needs no layout
 *  engine work and no new dependency. */
export interface DiagramNode {
  id: string;
  label: string;
  detail?: string;
  kind?: string;
  note?: string;
  shape?: "box" | "entity" | "store" | "note";
  /** Column list; only meaningful when shape is "entity" (the ER default for
   *  layout:"relationship"). pk → key glyph, fk → arrow, nullable → dimmed. */
  fields?: { name: string; type?: string; pk?: boolean; fk?: boolean; nullable?: boolean }[];
  /** A standard circuit glyph drawn inside the node box. */
  symbol?: "resistor" | "capacitor" | "inductor" | "diode" | "ground" | "battery" | "opamp" | "led";
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  note?: string;
  /** Crow's-foot terminator at the far end. */
  cardinality?: "1" | "0..1" | "1..*" | "0..*";
}

export interface ChecklistBlock {
  type: "checklist";
  items: { text: string; status?: "done" | "open" | "fail"; severity?: "critical" | "high" | "medium" | "low"; due?: string; ref?: string; consequence?: string }[];
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
  /** Reactive cards may author the figure as a binding. */
  value: number | Binding;
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
  nodes: { id: string; label: string; detail?: string; children?: string[]; size?: number; lines?: number; kind?: string }[];
  sort?: "manual" | "name" | "size" | "kind";
  defaultDepth?: number;
  pruned?: boolean;
}

export interface CodeBlock {
  type: "code";
  language?: string;
  filename?: string;
  code: string;
  /** false = skip the (lazy) syntax highlighter; render the bare <pre>. */
  highlight?: boolean;
}

export interface ReferencesBlock {
  type: "references";
  items: { title: string; href?: string; note?: string; cite?: { case?: string; neutral?: string; reporter?: string; parallel?: string; scr?: string; pinpoints?: number[]; coram?: string[]; court?: string; date?: string; style?: "neutral-first" | "scc" | "scr" | "air" | "bluebook" } }[];
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
  /** false = skip the (lazy) syntax highlighter on the row text. */
  highlight?: boolean;
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

export interface AccordionBlock {
  type: "accordion";
  /** Collapsed by default unless `open: true`; first item defaults open. */
  items: { title: string; body?: string; blocks?: CanvasBlock[]; open?: boolean }[];
}

export type TermTone = "stdout" | "stderr" | "info" | "success" | "dim";

export interface TerminalBlock {
  type: "terminal";
  title?: string;
  command?: string;
  /** Raw output lines; accept {text, tone} objects or plain strings. */
  lines: { text: string; tone?: TermTone }[];
  exitCode?: number;
  /** false = skip the (lazy) syntax highlighter on the command / flagged lines. */
  highlight?: boolean;
}

export interface BadgesBlock {
  type: "badges";
  items: { label: string; tone?: "info" | "warn" | "success" | "danger" | "neutral" }[];
}

export interface DividerBlock {
  type: "divider";
  label?: string;
}

// ── reactive canvas (v5) — controls + data carrier ───────────────────────────
// A control block writes its value into the card's per-canvas state (canvas-
// state.tsx) under `bind`; reader props on other blocks (kpi undecided value,
// table/chart `where`, series `visible`, …) resolve against that state through
// canvas-bind.ts + the closed expression language (canvas-expr.ts). Absent in
// a spec ⇒ exactly the v1 rendering.

export interface SliderBlock {
  type: "slider";
  label: string;
  /** State key the current value is stored under. */
  bind: string;
  min: number;
  max: number;
  step?: number;
  /** Initial/current value; a control with no current state writes this first. */
  value?: number;
  unit?: string;
  /** Free-text format shown beside the value ("$18,000" via money/compact…). */
  format?: "plain" | "money" | "compact" | "pct";
}

export interface SelectBlock {
  type: "select";
  label: string;
  bind: string;
  options: { label: string; value: string }[];
  value?: string;
}

export interface MultiSelectBlock {
  type: "multiselect";
  label: string;
  bind: string;
  options: { label: string; value: string }[];
  value?: string[];
}

export interface SegmentedBlock {
  type: "segmented";
  label?: string;
  bind: string;
  options: { label: string; value: string }[];
  value?: string;
}

export interface ToggleBlock {
  type: "toggle";
  label: string;
  bind: string;
  value?: boolean;
}

export interface SearchBlock {
  type: "search";
  label?: string;
  bind: string;
  placeholder?: string;
}

export interface DataBlock {
  type: "data";
  /** Name every `$from` points at. Never rendered as a surface. */
  name: string;
  columns?: string[];
  rows: (string | number | boolean | null)[][];
  header?: boolean;
}

export interface ReactiveExtra {
  /** Per-canvas initial state (written before the blocks render). */
  state?: Record<string, string | number | boolean | null>;
  /** Hide a block when this binding evaluates falsy (unset = visible). */
  visible?: unknown;
}


// ── knowledge graph (v5) — ported from the comindash dashboard ───────────────
// Deterministic force layout (d3-force port, no dependency): same graph → same
// picture every visit, so people build a mental map. Node KIND separates by
// radius + opacity tier + shape, never hue (owner law: one accent).

export interface GraphNode {
  id: string;
  label: string;
  /** Free-form grouping; drives the cross-filter chips and the opacity tier. */
  kind?: string;
  weight?: number;
  detail?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** "asserted" (dashed, analyst-added) vs anything else (solid, measured). */
  kind?: string;
  label?: string;
  weight?: number;
}

export interface GraphBlock {
  type: "graph";
  nodes: GraphNode[];
  edges: GraphEdge[];
  title?: string;
  /** Render height clamp (320..720); the card fits it, fullscreen uses more. */
  height?: number;
}

export interface ImageBlock {
  type: "image";
  /** Host file path or /api/… URL; mapped through linkHref(). */
  src: string;
  alt?: string;
  caption?: string;
}

export interface GalleryBlock {
  type: "gallery";
  items: { src: string; alt?: string; caption?: string }[];
  layout?: "2col" | "3col";
}

export interface VideoBlock {
  type: "video";
  src: string;
  poster?: string;
  captions?: string;
  caption?: string;
}


// ── layout composite (canvas v1 expansion) ────────────────────────────────────
// A container whose CHILDREN are blocks, so a card can say "KPI row + chart +
// image" as one coherent surface instead of three stacked blocks. It reuses the
// .mg-* grid templates that already exist for the media grid, so the two
// surfaces cannot drift; masonry is CSS multi-column (no JS measurement on a
// streaming surface).

export type LayoutMode = "stack" | "bento" | "split" | "masonry" | "grid";

export interface LayoutBlock {
  type: "layout";
  layout: LayoutMode;
  /** Grid columns for `grid`/`split` (2-4); masonry ignores it. */
  cols?: number;
  blocks: CanvasBlock[];
}

// ── math (canvas v1 expansion) ────────────────────────────────────────────────
// LaTeX/TeX, rendered by katex in a lazy chunk. `throwOnError:false` is the
// contract: bad TeX degrades to the red SOURCE text the reader can correct,
// never to a thrown card.

// ── gitgraph (canvas v1 expansion) ─────────────────────────────────────────────
// Hand-rolled SVG (~4-6 kB, no dependency). Both candidate libraries are
// deprecated/archived and mermaid measured 5253 kB raw / 1490 kB gz — 5.3x the
// whole main chunk. What a library would buy here is a DSL; this block keeps
// structured JSON, which is the whole point of the canvas.

export interface GitCommit {
  /** Opaque short id; the only identity the renderer needs. */
  id: string;
  branch?: string;
  message: string;
  author?: string;
  when?: string;
  /** Parent commit ids. A parent on ANOTHER branch is what draws the fork. */
  parents?: string[];
  tags?: string[];
  /** Rounds the row and merges lanes (a merge commit). */
  merge?: boolean;
}

export interface GitGraphBlock {
  type: "gitgraph";
  title?: string;
  branches?: { name: string; head?: string }[];
  /** Newest first — the order they are drawn in. */
  commits: GitCommit[];
}


export interface TheoremBlock {
  type: "theorem";
  kind: "lemma" | "proposition" | "corollary" | "theorem" | "proof";
  statement: string;
  proof?: string;
  refs?: string[];
  number?: number;
}
export interface AlgorithmBlock {
  type: "algorithm";
  steps: { text: string; indent?: number; complexity?: string }[];
  number?: number;
}

export interface PaletteBlock {
  type: "palette";
  title?: string;
  against?: string;
  colors: { name?: string; value: string; role?: string; note?: string }[];
  scale?: boolean;
  space?: string;
  radius?: boolean;
  shadow?: boolean;
}

export interface ScorecardBlock {
  type: "scorecard";
  title?: string;
  method: "heuristic" | "sus" | "rice" | "custom";
  max?: number;
  items: { criterion: string; score?: number; severity?: "info" | "warn" | "danger"; note?: string; evidence?: string }[];
  verdict?: string;
}

export interface ComplianceBlock {
  type: "compliance";
  regime: string;
  asOf?: string;
  source?: string;
  items: { ref: string; provision: string; obligation: string; due?: string; status: "pass" | "fail" | "warn" | "na" | "pending"; severity?: "info" | "warn" | "danger"; owner?: string; evidence?: string; consequence?: string; penalty?: string }[];
}

export interface ClauseBlock {
  type: "clause";
  title?: string;
  items: { ref: string; heading?: string; text: string; children?: boolean; status?: string; risk?: "info" | "warn" | "danger"; flags?: string[]; playbook?: string; note?: string; source?: string }[];
}

export interface ObligationsBlock {
  type: "obligations";
  title?: string;
  rows: { ref?: string; obligation: string; party: string; trigger?: string; due?: string; recurrence?: string; severity?: "info" | "warn" | "danger"; status?: string; consequence?: string; owner?: string; evidence?: string }[];
}

export interface MathBlock {
  type: "math";
  tex?: string;
  /** Display (centred, own lines). Default true. */
  display?: boolean;
  label?: string;
  number?: number | true;
  lines?: { tex: string; number?: string }[];
}


// ── Editable + downloadable blocks (v4) ──────────────────────────────────────
// Every one of these is BOTH embedded and expandable to fullscreen, and has a
// working Download. The shape stays plain JSON: an agent emits rows/slides/text,
// never an engine-specific object.

export interface SpreadsheetBlock {
  type: "spreadsheet";
  title?: string;
  filename?: string;
  /** Sheet names in tab order. First one is shown when nothing else applies. */
  sheets?: string[];
  /** Each row is a cell array; ragged rows are allowed and pad on render. */
  rows: (string | number)[][];
  /** Row 0 treated as the header row. Default true. */
  header?: boolean;
  /** Explicit column labels; derived from row 0 when omitted. */
  columns?: string[];
}

export interface SlidesBlock {
  type: "slides";
  title?: string;
  filename?: string;
  slides: {
    heading: string;
    bullets?: string[];
    /** Optional speaker note, rendered small under the slide. */
    note?: string;
    /** Optional per-slide layout hint. */
    layout?: "title" | "bullets";
  }[];
}

export interface DocumentBlock {
  type: "document";
  title?: string;
  filename?: string;
  /** Heading + paragraph + bullet outline. */
  content: {
    heading?: string;
    /** "p" | "h2" | "h3" | "li" — plain text, rendered in order. */
    kind?: string;
    text: string;
    level?: 1 | 2 | 3;
  }[];
}

export interface TextBlock {
  type: "text";
  title?: string;
  filename?: string;
  /** Plain text or markdown source; edited as text, copied verbatim. */
  content: string;
  /** language tag for the download extension when filename has none. */
  language?: string;
}

// `visible` is accepted on EVERY block (json-render semantics: a binding gates
// the whole block), so it rides on the union once instead of on 35 interfaces.

export interface SchemaBlock {
  type: "schema";
  title?: string;
  tables: {
    name: string;
    rows?: number;
    columns: { name: string; type: string; key?: "PK" | "FK" | "NN" | "UQ"; ref?: string; note?: string }[];
    indexes?: string[];
    note?: string;
  }[];
}

export interface SequenceBlock {
  type: "sequence";
  title?: string;
  actors: { id: string; label: string; kind?: string }[];
  messages: { from: string; to: string; label?: string; kind?: "sync" | "async" | "return" | "self"; at?: string }[];
}

export type CanvasBlock = (
  | KpiBlock | ChartBlock | TableBlock | DiagramBlock
  | ChecklistBlock | StepsBlock | CalloutBlock
  | ProgressBlock | TimelineBlock | CompareBlock | TreeBlock
  | CodeBlock | ReferencesBlock
  | QuoteBlock | KeyValueBlock | DiffBlock | HeatmapBlock | TabsBlock
  | AccordionBlock | TerminalBlock | BadgesBlock | DividerBlock
  | SpreadsheetBlock | SlidesBlock | DocumentBlock | TextBlock
  | SliderBlock | SelectBlock | MultiSelectBlock | SegmentedBlock | ToggleBlock | SearchBlock | DataBlock
  | GraphBlock | ImageBlock | GalleryBlock | VideoBlock
  | LayoutBlock | MathBlock | GitGraphBlock | TheoremBlock | AlgorithmBlock | PaletteBlock | ScorecardBlock | ComplianceBlock | ClauseBlock | ObligationsBlock | SchemaBlock | SequenceBlock
) & { visible?: unknown };

export interface CanvasSpec {
  v: 1;
  title?: string;
  /** Per-canvas initial state for reactive blocks (controls write here). */
  state?: Record<string, string | number | boolean | null>;
  /**
   * The page geometry the card renders into. A card is ONE page format, not a
   * document direction, so there are exactly two values and no third: a report
   * that is portrait A4 is `a4`, one that is a 16:9 deck is `slide`. `auto`
   * lets the renderer pick from measured content height.
   *
   * Omitted = `auto`, so a card written before this key existed is unchanged.
   */
  page?: CanvasPageFormat;
  blocks: CanvasBlock[];
}

export type CanvasPageFormat = "a4" | "slide" | "auto";

const PAGE_FORMATS = new Set<CanvasPageFormat>(["a4", "slide", "auto"]);

/**
 * Read a `page` key off a parsed spec object.
 *
 * WHY A CLOSED SET: an unknown value is DROPPED, not coerced. A card that said
 * `page: "portrait"` used to vanish silently (the whole key was discarded),
 * which is exactly how a rule that names an unsupported value looks like a
 * renderer bug. Two real formats plus one explicit fallback, nothing else.
 */
function pickPage(v: unknown): CanvasPageFormat | undefined {
  if (typeof v === "string" && PAGE_FORMATS.has(v as CanvasPageFormat)) return v as CanvasPageFormat;
  // Accept the object spelling too (`page: {format: "a4"}`) since that is how
  // every other key in the envelope reads, and silently ignoring it would be
  // the same class of bug this function exists to prevent.
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const f = (v as { format?: unknown }).format;
    if (typeof f === "string" && PAGE_FORMATS.has(f as CanvasPageFormat)) return f as CanvasPageFormat;
  }
  return undefined;
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
  "accordion", "terminal", "badges", "divider",
  "spreadsheet", "slides", "document", "text",
  // v5 reactive + media
  "slider", "select", "multiselect", "segmented", "toggle", "search", "data",
  "graph", "image", "gallery", "video",
  // canvas v1 expansion
  "layout", "math", "gitgraph", "theorem", "algorithm", "palette", "scorecard", "compliance", "clause", "obligations", "schema", "sequence",
]);
const CHART_KINDS = new Set(["line", "area", "bar", "radial", "pie", "donut", "stack", "sankey", "treemap", "funnel", "radar", "scatter", "box", "histogram", "errorbar", "candlestick", "waterfall", "violin"]);
const TONES = new Set(["info", "warn", "success", "danger"]);
// `table.stats` requests. A closed set for the same reason CHART_KINDS is: an
// unknown statistic name is dropped, so the renderer never has to guess.
const TABLE_STATS = new Set(["mean", "median", "sd", "min", "max", "p95", "count"]);
const TRENDS = new Set(["up", "down", "flat"]);

// Alias table shared by validateBlock AND the top-level coercer, so "is this a
// block type" can never drift from "what does it normalize to". Replay of 27
// real fences showed the model reaches for these near-miss names constantly.
const TYPE_ALIASES: Record<string, string> = {
  metric: "kpi", stat: "kpi", kpis: "kpi",
  // NB: `graph` is a real block type now (v5) — it must NOT alias to chart;
  // validateBlock checks TYPE_ALIASES before BLOCK_TYPES, so a real type needs
  // no entry here. `plot` stays an alias for a chart.
  plot: "chart",
  flowchart: "diagram", flow: "diagram", map: "diagram", "graph-map": "diagram",
  er: "diagram", erd: "diagram", "entity-relationship": "diagram", circuit: "diagram", schematic: "diagram",
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
  accordion: "accordion", collapsible: "accordion", collapse: "accordion", details: "accordion", faq: "accordion",
  "term": "terminal", console: "terminal", shell: "terminal", cli: "terminal", output: "terminal",
  badge: "badges", chips: "badges", "status-badges": "badges", tags: "badges",
  separator: "divider", rule: "divider", hr: "divider",
  // v4 editable surfaces. `note` is deliberately NOT here — it already aliases
  // to callout above, and a callout rendered as an editable box would be a
  // silent behaviour change for existing cards.
  sheet: "spreadsheet", grid: "spreadsheet", excel: "spreadsheet", xlsx: "spreadsheet", workbook: "spreadsheet",
  deck: "slides", presentation: "slides", pptx: "slides", "slide-deck": "slides",
  doc: "document", docx: "document", word: "document", "word-doc": "document", editor: "document",
  "plain-text": "text", textarea: "text", "text-editor": "text", "code-editor": "text",
  // v5 reactive near-misses. `range`/`chips`/`grid`/`tags`/`rows`/`filter` names
  // already exist above pointing elsewhere (grid→spreadsheet, chips/tags→badges);
  // LAST WINS in a JS object literal, so reactive reads deliberately re-point
  // them — the alias entry that survives replay-verified corpus matters more.
  "range-slider": "slider", "input-slider": "slider",
  dropdown: "select", picker: "select", "single-select": "select",
  multi: "multiselect", "multi-select": "multiselect",
  "toggle-group": "segmented", radiogroup: "segmented", pills: "segmented",
  switch: "toggle", checkbox: "toggle", bool: "toggle", boolean: "toggle",
  query: "search", "filter-input": "search",
  dataset: "data", "data-table": "data", tabledata: "data",
  picture: "image", img: "image", screenshot: "image", thumbnail: "image",
  comparison: "gallery", images: "gallery", photos: "gallery",
  clip: "video", movie: "video", mp4: "video", "video-clip": "video",
  // v5 graph
  network: "graph", "knowledge-graph": "graph", relationmap: "graph", "force-graph": "graph",
  topology: "graph", nodegraph: "graph", websvg: "graph",
  // v1 expansion: the LAYOUT MODES are the near-miss names a model reaches for
  // when it means "compose these blocks" (see LAYOUT_MODE_ALIAS below).
  bento: "layout", "grid-layout": "layout", columns: "layout", masonry: "layout",
  // math: every name a model reaches for when it means "render this formula".
  // `math` itself is a real block type, so (like `graph` vs `plot`) it needs no
  // entry here — validateBlock checks TYPE_ALIASES BEFORE BLOCK_TYPES.
  equation: "math", latex: "math", tex: "math", formula: "math", "tex-block": "math",
  // git graph near-misses
  "git-graph": "gitgraph", gitlog: "gitgraph", history: "gitgraph", commitgraph: "gitgraph",
};

/** Block TYPES that are inherently relationship (ER) diagrams: an omitted layout
 *  on one of these means "relationship", not the "flow" default. */
const ER_TYPES = new Set(["er", "erd", "entity-relationship"]);

/** A `layout` block whose TYPE is one of these carries its mode in the type
 *  itself (`{type:"bento", blocks:[…]}`) — the alias above normalises the type to
 *  "layout", so the mode has to be rescued from the original name. */
const LAYOUT_MODE_ALIAS: Record<string, LayoutMode> = {
  bento: "bento", masonry: "masonry", columns: "masonry", "grid-layout": "grid",
};

// kpi `trend` is a DIRECTION. Models reuse severity/status words for it
// (observed live: "good", "warn"). Map the near-misses; a genuinely unknown
// word still rejects the block rather than inventing a direction.
const TREND_ALIASES: Record<string, Trend> = {
  good: "up", ok: "up", positive: "up", success: "up", improved: "up", increase: "up", higher: "up",
  bad: "down", negative: "down", poor: "down", fail: "down", decrease: "down", lower: "down", worse: "down",
  warn: "flat", neutral: "flat", same: "flat", stable: "flat", none: "flat",
};

/** Model near-misses for `table.stats.compute` names (mean/avg, stddev, …). */
const STAT_ALIASES: Record<string, TableStat> = {
  avg: "mean", average: "mean", stdev: "sd", stddev: "sd", std: "sd", sigma: "sd",
  q95: "p95", "95": "p95", p95th: "p95", lowest: "min", highest: "max",
  n: "count", rows: "count", total: "count",
};

/**
 * Normalise an authored `table.stats` request. NEVER throws and NEVER rejects:
 * an unrecognised statistic is dropped and a `stats` that ends up with nothing
 * usable returns `undefined`, which is the same as not asking for a footer.
 *
 * Why it is this forgiving: the statistics are the renderer's job. A typo in the
 * request must cost the reader a footer line, never the table it sits under.
 */
function parseTableStats(v: unknown): TableStats | undefined {
  // `stats:true` is the shortest useful form ("give me the default footer") and a
  // boolean is exactly what a model writes when it wants it, so it is accepted and
  // normalised to the empty request. `stats:false` means no footer, same as absent.
  if (v === true) return {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const out: TableStats = {};
  if (Array.isArray(o.columns)) {
    // Column names are matched against the table's own header by the renderer,
    // so only strings are kept and the list is capped by the column count anyway.
    const cols = o.columns.filter(isStr).map((c) => c.slice(0, 60));
    if (cols.length > 0) out.columns = [...new Set(cols)].slice(0, 20);
  }
  if (Array.isArray(o.compute)) {
    const names = o.compute
      .filter(isStr)
      .map((c) => STAT_ALIASES[c.trim().toLowerCase()] ?? (TABLE_STATS.has(c.trim().toLowerCase()) ? c.trim().toLowerCase() as TableStat : undefined))
      .filter((c): c is TableStat => c !== undefined);
    if (names.length > 0) out.compute = [...new Set(names)];
  }
  // `stats: true` / `stats: {}` means "every statistic on every numeric column",
  // which is the same as asking for the default — emit the empty object so the
  // renderer can tell "asked" from "did not ask".
  return out.columns || out.compute ? out : {};
}

function looksLikeBlockType(v: unknown): boolean {
  return isStr(v) && (TYPE_ALIASES[v] !== undefined || BLOCK_TYPES.has(v));
}

function isStr(v: unknown): v is string { return typeof v === "string"; }
function isNum(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }
function isStrArr(v: unknown): v is string[] { return Array.isArray(v) && v.every(isStr); }

/** A reactive binding is any object ({$expr}|{expr}|{path}|{$state}); resolution
 *  lives in canvas-bind.ts and never throws. */
function isBind(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** Per-card initial state: scalars only (the store is flat), anything else is ignored. */
function pickState(v: unknown): Record<string, string | number | boolean | null> | undefined {
  if (!isBind(v)) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, x] of Object.entries(v)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)) continue;
    if (typeof x === "string" || typeof x === "boolean" || x === null || (typeof x === "number" && Number.isFinite(x))) out[k] = x;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Validate one parsed block object; null = invalid. Exported for the
 *  streaming partial parser, which validates blocks as they arrive. */
export function validateBlock(b: any): CanvasBlock | null {
  const v = validateBlockInner(b);
  // `visible` is a WHOLE-block binding on any block type — copying it here
  // beats teaching 35 cases about it, and a literal is ignored by bindVisible.
  if (v && b && isBind(b.visible) && v.visible == null) v.visible = b.visible;
  return v;
}

export function validateBlockInner(b: any): CanvasBlock | null {
  if (!b || typeof b !== "object" || !isStr(b.type)) return null;
  // Aliases: models reach for near-miss names. Accept the obvious ones instead
  // of dropping the block (and, before per-block tolerance, the whole card).
  const T = b.type;
  const origType = T;
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
    else if (kind === "flow" || kind === "flow-diagram") b.chart = "sankey";
    else if (kind === "sunburst" || kind === "icicle" || kind === "rectangle-treemap") b.chart = "treemap";
    else if (kind === "conversion" || kind === "pyramid") b.chart = "funnel";
    else if (kind === "spider" || kind === "polar") b.chart = "radar";
    else if (kind === "bubble" || kind === "xy" || kind === "points") b.chart = "scatter";
  }
  // diagram layout aliases, both BEFORE the switch case:
  //  - `layout:"er"` is a LAYOUT NAME, so it must be normalised before the case
  //    reads b.layout (and it also means b.layout is non-null, so the omitted-
  //    layout default must not overwrite it).
  //  - an omitted layout on an ER block means "relationship". The alias table has
  //    already rewritten `type`, so the ORIGINAL type name is the only signal that
  //    this was `{type:"er"}` rather than a flowchart — without it every ER block
  //    that omitted `layout` rendered as a flowchart.
  if (b.type === "diagram") {
    if (b.layout === "er" || b.layout === "erd") b.layout = "relationship";
    if (b.layout == null) {
      b.layout = b.kind === "relationship" || b.kind === "map" || b.kind === "er" || b.kind === "erd" || ER_TYPES.has(origType)
        ? "relationship" : "flow";
    }
  }

  switch (b.type) {
    case "kpi":
      // A reactive card authors the figure as a BINDING ({$expr:…} etc.); the
      // renderer resolves it against the card's state.
      if (!isStr(b.label) || (!isStr(b.value) && !isNum(b.value) && !isBind(b.value))) return null;
      if (b.delta != null && !isStr(b.delta) && !isBind(b.delta)) return null;
      if (b.trend != null) {
        if (!TRENDS.has(b.trend)) {
          const mapped = TREND_ALIASES[b.trend];
          if (!mapped) return null; // genuinely unknown direction → no silent lie
          b.trend = mapped;
        }
      }
      // spark: 3-24 finite points, else silently dropped (the tile stays useful)
      let spark: number[] | undefined;
      if (b.spark != null && !isBind(b.spark)) {
        if (Array.isArray(b.spark) && b.spark.length >= 3 && b.spark.length <= 24 && b.spark.every(isNum)) spark = b.spark;
      }
      return {
        type: "kpi",
        label: b.label,
        value: b.value,
        delta: b.delta,
        trend: b.trend,
        // a bound spark rides through as-is; the tile resolves it through bindPoints
        spark: isBind(b.spark) ? (b.spark as unknown as number[]) : spark,
      };
    case "chart": {
      if (b.chart === "candles" || b.chart === "ohlc") b.chart = "candlestick";
      if (b.chart === "bridge") b.chart = "waterfall";
      if (!CHART_KINDS.has(b.chart)) return null;
      const chart = b.chart;
      const NEW_KINDS = chart === "sankey" || chart === "treemap" || chart === "funnel" ||
        chart === "radar" || chart === "scatter";
      if (b.labels != null && !isStrArr(b.labels)) return null;

      // v5 shapes. A model reaches for the natural vocabulary per chart
      // (sankey nodes/links, treemap items, funnel stages), not for a flat
      // series — normalise all of them to the canonical series form here so the
      // renderer has ONE shape to draw and a near-miss shape never degrades.
      if (NEW_KINDS && (!Array.isArray(b.series) || b.series.length === 0)) {
        // A sankey authored the natural way carries nodes + links, NOT series.
        // This branch must run FIRST: the generic items-collection below also
        // looks at `nodes`, consumed it, and left the block with no series at
        // all — which the renderer then rejected ("no data"), so the flow chart
        // rendered empty.
        if (chart === "sankey" && Array.isArray(b.nodes) && Array.isArray(b.links)) {
          const nodeNames: string[] = [];
          const index = new Map<string, number>();
          for (const n of b.nodes) {
            const nm = isStr(n) ? n : isStr(n?.id) ? n.id : isStr(n?.name) ? n.name : null;
            if (nm == null) return null;
            index.set(nm, nodeNames.length);
            nodeNames.push(nm);
          }
          if (nodeNames.length === 0) return null;
          const vals = nodeNames.map(() => 0);
          for (const l of b.links) {
            if (!l || typeof l !== "object") continue;
            const a = isStr(l.source) ? l.source : isStr(l.from) ? l.from : null;
            const z = isStr(l.target) ? l.target : isStr(l.to) ? l.to : null;
            const v = isNum(l.value) ? l.value : 1;
            if (a == null || z == null || !index.has(a) || !index.has(z)) continue;
            vals[index.get(a)!] += v;
            vals[index.get(z)!] += v;
          }
          const links: { source: string; target: string; value: number }[] = [];
          for (const l of b.links) {
            if (!l || typeof l !== "object") continue;
            const a = isStr(l.source) ? l.source : isStr(l.from) ? l.from : null;
            const z = isStr(l.target) ? l.target : isStr(l.to) ? l.to : null;
            if (a == null || z == null || !index.has(a) || !index.has(z)) continue;
            links.push({ source: a, target: z, value: isNum(l.value) ? l.value : 1 });
          }
          return {
            type: "chart", chart,
            title: isStr(b.title) ? b.title : undefined,
            labels: nodeNames,
            series: [{ name: "flow", points: vals, links }],
          };
        }

        const items = Array.isArray(b.items) ? b.items
          : Array.isArray(b.stages) ? b.stages
          : Array.isArray(b.nodes) && b.nodes.every((n: any) => n && typeof n === "object" && isNum(n.value))
            ? b.nodes : null;
        if (items && items.length > 0) {
          const labels: string[] = [];
          const points: number[] = [];
          const kids: { name: string; value: number }[] = [];
          for (const it of items) {
            const label = isStr(it) ? it : isStr(it.label) ? it.label : isStr(it.name) ? it.name : isStr(it.stage) ? it.stage : null;
            const value = isNum(it) ? it : isNum(it.value) ? it.value : isNum(it.count) ? it.count : null;
            if (label == null || value == null) return null;
            labels.push(label);
            points.push(value);
            kids.push({ name: label, value });
          }
          const series = [{ name: isStr(b.title) ? b.title : chart, points, items: kids }];
          return {
            type: "chart",
            chart,
            title: isStr(b.title) ? b.title : undefined,
            labels,
            series,
            scale: isStr(b.scale) ? b.scale : undefined,
            p: typeof b.p === "number" ? b.p : undefined,
            refline: b.refline && typeof b.refline === "object" && typeof b.refline.value === "number" ? {
              value: b.refline.value,
              tone: isStr(b.refline.tone) ? b.refline.tone : undefined,
              label: isStr(b.refline.label) ? b.refline.label : undefined
            } : undefined
          };
        }
      }

      if (!Array.isArray(b.series) || b.series.length === 0) return null;
      const series: { name: string; points: number[]; items?: { name: string; value: number }[]; links?: { source: string; target: string; value: number }[]; visible?: unknown }[] = [];
      for (const s of b.series) {
        if (!s || !isStr(s.name)) return null;
        // points: a numeric array (canonical) OR a binding — a bound series
        // keeps its binding in `points`, exactly where the renderer looks.
        const bound = isBind(s.points);
        const hasOhlc = Array.isArray(s.ohlc);
        const hasKde = Array.isArray(s.kde);
        const hasError = s.error && typeof s.error === "object" && Array.isArray(s.error.lo) && Array.isArray(s.error.hi);
        // SCATTER: the natural data is PAIRS. A model writes [[x, y], …] or [{x, y}, …]; both used to fail the
        // numeric-array test below and silently DROP the whole card ("Latency vs payload is blank"). Normalise
        // them to canonical [x, y] pairs, which the renderer reads. Every other chart still demands numbers.
        let pts: unknown = s.points;
        if (chart === "scatter" && !bound && Array.isArray(pts) && pts.length > 0) {
          const pairs = pts.map((p: any) =>
            Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]) ? [p[0], p[1]]
            : p && typeof p === "object" && isNum(p.x) && isNum(p.y) ? [p.x, p.y]
            : null);
          if (pairs.every((p) => p !== null)) pts = pairs;
        }
        const isPairs = chart === "scatter" && Array.isArray(pts) && pts.length > 0 && (pts as unknown[]).every((p) => Array.isArray(p));
        if (!bound && !isPairs && (!Array.isArray(pts) || !(pts as unknown[]).every(isNum)) && !hasOhlc && !hasKde && !hasError) return null;
        const kids = Array.isArray(s.items)
          ? s.items.filter((it: any) => it && (isStr(it.name) || isStr(it.label)) && isNum(it.value))
              .map((it: any) => ({ name: isStr(it.name) ? it.name : it.label, value: it.value, kind: isStr(it.kind) ? it.kind : undefined }))
          : undefined;
        const links = Array.isArray(s.links)
          ? s.links.filter((l: any) => l && isStr(l.source) && isStr(l.target))
              .map((l: any) => ({ source: l.source, target: l.target, value: isNum(l.value) ? l.value : 1 }))
          : undefined;
        series.push({
          name: s.name,
          points: bound ? (s.points as unknown as number[]) : (pts as number[]),
          ...(hasOhlc ? { ohlc: s.ohlc } : {}),
          ...(hasKde ? { kde: s.kde } : {}),
          ...(hasError ? { error: { lo: s.error.lo, hi: s.error.hi } } : {}),
          ...(chart === "waterfall" && kids ? { waterfallKinds: kids.map((k: any) => k.kind || "delta") } : {}),
          items: kids,
          links,
          visible: isBind(s.visible) ? s.visible : undefined,
        });
      }
      return {
        type: "chart",
        chart,
        title: isStr(b.title) ? b.title : undefined,
        labels: b.labels,
        series,
        scale: isStr(b.scale) ? b.scale : undefined,
        p: typeof b.p === "number" ? b.p : undefined,
        refline: b.refline && typeof b.refline === "object" && typeof b.refline.value === "number" ? {
          value: b.refline.value,
          tone: isStr(b.refline.tone) ? b.refline.tone : undefined,
          label: isStr(b.refline.label) ? b.refline.label : undefined
        } : undefined
      };
    }
    case "table": {
      // Model near-miss (2026-10-05): `{from:"d"}` instead of `bind:{$from:"d"}`
      // — the same reach-for-the-obvious-key behaviour the alias table covers
      // for TYPES, here for the binding key. Normalised before anything reads it.
      if (!isBind(b.bind) && isStr(b.from)) b.bind = { $from: b.from };
      // A REACTIVE table does not need authored columns: the data carrier
      // defines them. A model that omits columns used to lose the WHOLE table
      // at this line. Resolve what the sibling `data` blocks carry:
      const dsCols = (() => {
        const name = isBind(b.bind) && isStr((b.bind as any).$from) ? (b.bind as any).$from : null;
        if (!name || !Array.isArray(b.__datasets)) return null;
        const d = (b.__datasets as { name?: unknown; columns?: unknown }[]).find((x) => x && x.name === name);
        return Array.isArray(d?.columns) ? d!.columns.filter(isStr) : null;
      })();
      if (!isStrArr(b.columns) || b.columns.length === 0) {
        // Bound + a named dataset with columns → synthesise; otherwise reject.
        if (!dsCols || dsCols.length === 0) return null;
        b.columns = dsCols;
      }
      if (b.columns.length === 0) return null;
      // `stats` is validated HERE and stored on both return paths. It is an
      // instruction to the renderer ("compute these numbers for me"), not data,
      // so it must never be able to reject an otherwise valid table: a bad stat
      // name is DROPPED, not fatal. Losing a footer is recoverable; losing the
      // table is not.
      const stats = parseTableStats(b.stats);

      let colTypes: any;
      if (Array.isArray(b.colTypes)) colTypes = b.colTypes.map((t: any) => ["text", "color", "contrast", "bar", "delta", "status"].includes(t) ? t : "text");
      let colMeta: any;
      if (Array.isArray(b.colMeta)) colMeta = b.colMeta.map((m: any) => m && Array.isArray(m.levels) ? { levels: m.levels } : null);
      let footnote = isStr(b.footnote) ? b.footnote : undefined;
      let sig: any;
      if (b.sig && typeof b.sig === "object" && isStr((b.sig as any).column)) sig = { column: (b.sig as any).column, thresholds: Array.isArray((b.sig as any).thresholds) ? (b.sig as any).thresholds : undefined };
      let units: any;
      if (Array.isArray(b.units)) units = b.units.filter((u: any) => typeof u === "string");

      // Reactive table: rows come from a `data` carrier through `bind.$from`,
      // so an absent/empty `rows` is EXPECTED, not the mangled-header defect.
      if (isBind(b.bind) && isStr(b.bind.$from)) {
        return { type: "table", columns: b.columns, rows: [], bind: b.bind, stats, colTypes, colMeta, footnote, sig, units };
      }
      if (!Array.isArray(b.rows) || b.rows.length === 0) return null;
      // A header row with NO body is the "table looks mangled" report (measured:
      // 2 of 51 real cards shipped exactly `{"columns":[…],"rows":[]}`). An empty
      // array satisfies `.every()` so it passed validation and rendered as a
      // bare header — a table with nothing in it is not a table, so it degrades
      // like any other invalid block rather than showing an empty shell.
      // Cells are coerced to strings: a model emits `412`, not `"412"`.
      const rows: string[][] = [];
      for (const r of b.rows) {
        if (!Array.isArray(r) || r.length === 0) return null;
        const out: string[] = [];
        for (const c of r) {
          if (isStr(c)) { out.push(c); continue; }
          if (isNum(c)) { out.push(String(c)); continue; }
          if (typeof c === "boolean") { out.push(String(c)); continue; }
          if (c === null) { out.push(""); continue; }
          return null; // object/array cell is a malformed row, not a table
        }
        rows.push(out);
      }
      return { type: "table", columns: b.columns, rows, stats, colTypes, colMeta, footnote, sig, units };
    }
    case "diagram": {
      if (b.layout !== "flow" && b.layout !== "relationship") return null;
      if (!Array.isArray(b.nodes) || b.nodes.length === 0) return null;
      // A reader gets a text explanation of the diagram (summary + caption) and a
      // kind/note per node — without these the block was a shape with no prose.
      // Long agent-authored text is capped so one field cannot bloat the card.
      const nodes: DiagramBlock["nodes"] = [];
      const ids = new Set<string>();
      const SHAPES = new Set(["box", "entity", "store", "note"]);
      const SYMBOLS = new Set(["resistor", "capacitor", "inductor", "diode", "ground", "battery", "opamp", "led"]);
      for (const n of b.nodes) {
        if (!n || !isStr(n.id) || !isStr(n.label)) return null;
        ids.add(n.id);
        // A node with fields IS an entity box even when `shape` was omitted —
        // models that write an ER diagram rarely restate the shape they just
        // used fields for.
        const shape = isStr(n.shape) && SHAPES.has(n.shape) ? n.shape
          : Array.isArray(n.fields) && n.fields.length > 0 ? "entity" : undefined;
        let fields: DiagramNode["fields"];
        if (Array.isArray(n.fields)) {
          const rows: NonNullable<DiagramNode["fields"]> = [];
          for (const f of n.fields) {
            if (!f || !isStr(f.name) || !f.name.trim()) continue;   // fail-soft per field
            rows.push({
              name: f.name.slice(0, 80),
              type: isStr(f.type) ? f.type.slice(0, 40) : undefined,
              pk: f.pk === true ? true : undefined,
              fk: f.fk === true ? true : undefined,
              nullable: f.nullable === true ? true : undefined,
            });
            if (rows.length >= 24) break;
          }
          fields = rows.length > 0 ? rows : undefined;
        }
        nodes.push({
          id: n.id,
          label: n.label,
          detail: isStr(n.detail) ? n.detail : undefined,
          kind: isStr(n.kind) ? n.kind : undefined,
          note: isStr(n.note) ? n.note.slice(0, 400) : undefined,
          shape,
          fields,
          symbol: isStr(n.symbol) && SYMBOLS.has(n.symbol) ? (n.symbol as NonNullable<DiagramNode["symbol"]>) : undefined,
        });
      }
      if (!Array.isArray(b.edges)) return null;
      const CARDS = new Set(["1", "0..1", "1..*", "0..*"]);
      const edges: DiagramBlock["edges"] = [];
      for (const e of b.edges) {
        if (!e || !isStr(e.from) || !isStr(e.to) || !ids.has(e.from) || !ids.has(e.to)) return null;
        edges.push({
          from: e.from,
          to: e.to,
          label: isStr(e.label) ? e.label : undefined,
          note: isStr(e.note) ? e.note.slice(0, 400) : undefined,
          cardinality: isStr(e.cardinality) && CARDS.has(e.cardinality)
            ? (e.cardinality as NonNullable<DiagramEdge["cardinality"]>)
            : undefined,
        });
      }
      return {
        type: "diagram",
        layout: b.layout,
        direction: b.direction === "lr" ? "lr" : "tb",
        route: b.route === "smooth" ? "smooth" : b.route === "orthogonal" ? "orthogonal" : undefined,
        summary: isStr(b.summary) ? b.summary.slice(0, 400) : undefined,
        caption: isStr(b.caption) ? b.caption.slice(0, 400) : undefined,
        nodes,
        edges,
      };
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
    case "callout": {
      // Model-variant alias (RG-147, 56651cd3): the model sometimes writes the
      // callout text as `detail` (steps/algorithm vocabulary) instead of `body`
      // — spec validation then rejects EVERY block and the whole card dies as
      // "unreadable payload" even though the JSON is valid. Accept `detail`
      // as a fallback; `body` keeps precedence.
      const text = isStr(b.body) ? b.body : isStr(b.detail) ? b.detail : undefined;
      if (!TONES.has(b.tone) || !text) return null;
      return { type: "callout", tone: b.tone, title: isStr(b.title) ? b.title : undefined, body: text };
    }
    case "progress":
      if (!isStr(b.label) || (!isNum(b.value) && !isBind(b.value))) return null;
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
      let rawNodes = b.nodes;
      let forcePruned = false;
      if (rawNodes.length > 1200) {
        rawNodes = rawNodes.slice(0, 1200);
        forcePruned = true;
      }
      for (const n of rawNodes) {
        if (!n || !isStr(n.id) || !isStr(n.label)) return null;
        ids.add(n.id);
        nodes.push({
          id: n.id,
          label: n.label,
          detail: isStr(n.detail) ? n.detail : undefined,
          children: Array.isArray(n.children) ? n.children.filter(isStr) : undefined,
          size: typeof n.size === "number" ? n.size : undefined,
          lines: typeof n.lines === "number" ? n.lines : undefined,
          kind: isStr(n.kind) ? n.kind : undefined,
        });
      }
      for (const n of nodes) {
        if (n.children) {
          if (forcePruned) n.children = n.children.filter(c => ids.has(c));
          else for (const c of n.children) if (!ids.has(c)) return null; // dangling child = invalid
        }
      }
      return { type: "tree", nodes, sort: ["manual", "name", "size", "kind"].includes(b.sort as any) ? b.sort : undefined, defaultDepth: typeof b.defaultDepth === "number" ? b.defaultDepth : undefined, pruned: forcePruned ? true : (typeof b.pruned === "boolean" ? b.pruned : undefined) };
    }
    case "code":
      if (!isStr(b.code) || b.code.trim() === "") return null;
      if (b.language != null && !isStr(b.language)) return null;
      if (b.filename != null && !isStr(b.filename)) return null;
      return { type: "code", code: b.code, language: isStr(b.language) ? b.language : undefined, filename: isStr(b.filename) ? b.filename : undefined, highlight: b.highlight === false ? false : undefined };
    case "references": {
      if (!Array.isArray(b.items) || b.items.length === 0) return null;
      const items: ReferencesBlock["items"] = [];
      for (const it of b.items) {
        if (!it || !isStr(it.title)) return null;
        if (it.href != null && !isStr(it.href)) return null;
        items.push({
    title: it.title,
    href: isStr(it.href) ? it.href : undefined,
    note: isStr(it.note) ? it.note : undefined,
    cite: typeof it.cite === "object" && it.cite ? {
      case: isStr((it.cite as any).case) ? (it.cite as any).case : undefined,
      neutral: isStr((it.cite as any).neutral) ? (it.cite as any).neutral : undefined,
      reporter: isStr((it.cite as any).reporter) ? (it.cite as any).reporter : undefined,
      parallel: isStr((it.cite as any).parallel) ? (it.cite as any).parallel : undefined,
      scr: isStr((it.cite as any).scr) ? (it.cite as any).scr : undefined,
      pinpoints: Array.isArray((it.cite as any).pinpoints) ? (it.cite as any).pinpoints.filter(isNum) : undefined,
      coram: Array.isArray((it.cite as any).coram) ? (it.cite as any).coram.filter(isStr) : undefined,
      court: isStr((it.cite as any).court) ? (it.cite as any).court : undefined,
      date: isStr((it.cite as any).date) ? (it.cite as any).date : undefined,
      style: ["neutral-first", "scc", "scr", "air", "bluebook"].includes((it.cite as any).style) ? (it.cite as any).style : undefined,
    } : undefined
  });
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
        highlight: b.highlight === false ? false : undefined,
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
    case "accordion": {
      if (!Array.isArray(b.items) || b.items.length === 0) return null;
      const items: AccordionBlock["items"] = [];
      for (const it of b.items) {
        if (!it || !isStr(it.title)) return null;
        let blocks: CanvasBlock[] | undefined;
        if (Array.isArray(it.blocks) && it.blocks.length > 0) {
          blocks = [];
          for (const x of it.blocks) {
            const v = validateBlock(x);
            if (v) blocks.push(v);
          }
          if (blocks.length === 0) blocks = undefined;
        }
        const hasBody = isStr(it.body) && it.body.trim() !== "";
        if (!hasBody && !blocks) return null; // an item with nothing to reveal
        items.push({
          title: it.title,
          body: hasBody ? it.body! : undefined,
          blocks,
          open: it.open === true ? true : undefined,
        });
      }
      // nothing open by default → open the first, so the block is not a wall of headers
      if (!items.some((x) => x.open)) items[0].open = true;
      return { type: "accordion", items };
    }
    case "layout": {
      // Composite container — the same composition contract as tabs/accordion:
      // `blocks` hold blocks, each validated by validateBlock, so a nested
      // block keeps its own caps, enum normalisation and lazy-load dispatch.
      // A layout with no usable child is not a layout.
      if (!Array.isArray(b.items) && !Array.isArray(b.blocks)) return null;
      const raw = (Array.isArray(b.blocks) ? b.blocks : Array.isArray(b.items) ? b.items : []) as unknown[];
      const inner: CanvasBlock[] = [];
      for (const x of raw) {
        const v = validateBlock(x);
        if (v) inner.push(v);
      }
      if (inner.length === 0) return null;
      // Mode: explicit `layout` wins; a mode named in the block TYPE (the
      // LAYOUT_MODE_ALIAS rescue) is next; anything unknown degrades to stack,
      // which always reads correctly. cols is clamped to a sane 2-4.
      const fromType = LAYOUT_MODE_ALIAS[T];
      const mode = b.layout === "bento" || b.layout === "split" || b.layout === "masonry" || b.layout === "grid" ? b.layout
        : b.layout === "stack" ? "stack"
        : fromType ?? "stack";
      const cols = isNum(b.cols) ? Math.max(2, Math.min(4, Math.round(b.cols))) : undefined;
      return { type: "layout", layout: mode, cols, blocks: inner };
    }
    
    case "theorem": {
      if (!isStr(b.kind) || !isStr(b.statement)) return null;
      return {
        type: "theorem",
        kind: ["lemma", "proposition", "corollary", "theorem", "proof"].includes(b.kind) ? b.kind : "theorem",
        statement: b.statement.slice(0, 4000),
        proof: isStr(b.proof) ? b.proof.slice(0, 4000) : undefined,
        refs: Array.isArray(b.refs) ? b.refs.filter(isStr) : undefined,
        number: typeof b.number === "number" ? b.number : undefined
      };
    }
    case "algorithm": {
      if (!Array.isArray(b.steps)) return null;
      return {
        type: "algorithm",
        steps: b.steps.slice(0, 60).map((s: any) => ({
          text: isStr(s.text) ? s.text : "",
          indent: typeof s.indent === "number" ? s.indent : undefined,
          complexity: isStr(s.complexity) ? s.complexity : undefined
        })),
        number: typeof b.number === "number" ? b.number : undefined
      };
    }
    
    case "palette": {
      if (!Array.isArray(b.colors)) return null;
      return {
        type: "palette",
        title: isStr(b.title) ? b.title : undefined,
        against: isStr(b.against) ? b.against : undefined,
        colors: b.colors.filter((c: any) => c && isStr(c.value)).map((c: any) => ({
          name: isStr(c.name) ? c.name : undefined,
          value: c.value,
          role: isStr(c.role) ? c.role : undefined,
          note: isStr(c.note) ? c.note : undefined
        })),
        scale: typeof b.scale === "boolean" ? b.scale : undefined,
        space: isStr(b.space) ? b.space : undefined,
        radius: typeof b.radius === "boolean" ? b.radius : undefined,
        shadow: typeof b.shadow === "boolean" ? b.shadow : undefined,
      };
    }
    case "scorecard": {
      if (!isStr(b.method)) return null;
      if (!Array.isArray(b.items)) return null;
      return {
        type: "scorecard",
        title: isStr(b.title) ? b.title : undefined,
        method: b.method as any,
        max: typeof b.max === "number" ? b.max : undefined,
        items: b.items.filter((i: any) => i && isStr(i.criterion)).map((i: any) => ({
          criterion: i.criterion,
          score: typeof i.score === "number" ? i.score : undefined,
          severity: isStr(i.severity) ? i.severity : undefined,
          note: isStr(i.note) ? i.note : undefined,
          evidence: isStr(i.evidence) ? i.evidence : undefined
        })),
        verdict: isStr(b.verdict) ? b.verdict : undefined
      };
    }
    case "compliance": {
      if (!isStr(b.regime)) return null;
      if (!Array.isArray(b.items)) return null;
      return {
        type: "compliance",
        regime: b.regime,
        asOf: isStr(b.asOf) ? b.asOf : undefined,
        source: isStr(b.source) ? b.source : undefined,
        items: b.items.filter((i: any) => i && isStr(i.ref) && isStr(i.provision) && isStr(i.obligation) && isStr(i.status)).map((i: any) => ({
          ref: i.ref,
          provision: i.provision,
          obligation: i.obligation,
          due: isStr(i.due) ? i.due : undefined,
          status: i.status as any,
          severity: isStr(i.severity) ? i.severity : undefined,
          owner: isStr(i.owner) ? i.owner : undefined,
          evidence: isStr(i.evidence) ? i.evidence : undefined,
          consequence: isStr(i.consequence) ? i.consequence : undefined,
          penalty: isStr(i.penalty) ? i.penalty : undefined
        }))
      };
    }
    case "clause": {
      if (!Array.isArray(b.items)) return null;
      return {
        type: "clause",
        title: isStr(b.title) ? b.title : undefined,
        items: b.items.filter((i: any) => i && isStr(i.ref) && isStr(i.text)).map((i: any) => ({
          ref: i.ref,
          heading: isStr(i.heading) ? i.heading : undefined,
          text: i.text,
          children: typeof i.children === "boolean" ? i.children : undefined,
          status: isStr(i.status) ? i.status : undefined,
          risk: isStr(i.risk) ? i.risk : undefined,
          flags: Array.isArray(i.flags) ? i.flags.filter(isStr) : undefined,
          playbook: isStr(i.playbook) ? i.playbook : undefined,
          note: isStr(i.note) ? i.note : undefined,
          source: isStr(i.source) ? i.source : undefined
        }))
      };
    }
    case "obligations": {
      if (!Array.isArray(b.rows)) return null;
      return {
        type: "obligations",
        title: isStr(b.title) ? b.title : undefined,
        rows: b.rows.filter((r: any) => r && isStr(r.obligation) && isStr(r.party)).map((r: any) => ({
          ref: isStr(r.ref) ? r.ref : undefined,
          obligation: r.obligation,
          party: r.party,
          trigger: isStr(r.trigger) ? r.trigger : undefined,
          due: isStr(r.due) ? r.due : undefined,
          recurrence: isStr(r.recurrence) ? r.recurrence : undefined,
          severity: isStr(r.severity) ? r.severity : undefined,
          status: isStr(r.status) ? r.status : undefined,
          consequence: isStr(r.consequence) ? r.consequence : undefined,
          owner: isStr(r.owner) ? r.owner : undefined,
          evidence: isStr(r.evidence) ? r.evidence : undefined
        }))
      };
    }

    case "schema": {
      if (!Array.isArray(b.tables)) return null;
      return {
        type: "schema",
        title: isStr(b.title) ? b.title : undefined,
        tables: b.tables.filter((t: any) => t && isStr(t.name) && Array.isArray(t.columns)).map((t: any) => ({
          name: t.name,
          rows: typeof t.rows === "number" ? t.rows : undefined,
          columns: t.columns.filter((c: any) => c && isStr(c.name) && isStr(c.type)).map((c: any) => ({
            name: c.name,
            type: c.type,
            key: isStr(c.key) ? c.key : undefined,
            ref: isStr(c.ref) ? c.ref : undefined,
            note: isStr(c.note) ? c.note : undefined
          })),
          indexes: Array.isArray(t.indexes) ? t.indexes.filter(isStr) : undefined,
          note: isStr(t.note) ? t.note : undefined
        }))
      };
    }
    case "sequence": {
      if (!Array.isArray(b.actors) || !Array.isArray(b.messages)) return null;
      return {
        type: "sequence",
        title: isStr(b.title) ? b.title : undefined,
        actors: b.actors.filter((a: any) => a && isStr(a.id) && isStr(a.label)).map((a: any) => ({
          id: a.id,
          label: a.label,
          kind: isStr(a.kind) ? a.kind : undefined
        })),
        messages: b.messages.filter((m: any) => m && isStr(m.from) && isStr(m.to)).map((m: any) => ({
          from: m.from,
          to: m.to,
          label: isStr(m.label) ? m.label : undefined,
          kind: isStr(m.kind) ? m.kind : undefined,
          at: isStr(m.at) ? m.at : undefined
        }))
      };
    }

    case "math": {
      // TeX source. It is NOT rendered here — katex runs in a lazy chunk at
      // paint time with throwOnError:false — so the parser only has to reject a
      // block that carries no formula at all. A formula the highlighter cannot
      // typeset is the RENDERER's problem to degrade, never the parser's.
      if ((!isStr(b.tex) || b.tex.trim() === "") && (!Array.isArray(b.lines) || b.lines.length === 0)) return null;
      if (b.display != null && typeof b.display !== "boolean") return null;
      return {
        type: "math",
        tex: isStr(b.tex) ? b.tex.slice(0, 4000) : undefined,
        display: b.display === false ? false : true,
        label: isStr(b.label) ? b.label.slice(0, 200) : undefined,
        number: b.number === true || typeof b.number === "number" ? b.number : undefined,
        lines: Array.isArray(b.lines) ? b.lines.map((l: any) => ({ tex: isStr(l.tex) ? l.tex : "", number: isStr(l.number) ? l.number : undefined })) : undefined
      };
    }
    case "gitgraph": {
      // Lanes are assigned here, not in the renderer: a commit with no `branch`
      // joins the lane of its first parent, which is what makes a fork draw as a
      // fork instead of a column of unrelated rows.
      if (!Array.isArray(b.commits) || b.commits.length === 0) return null;
      const commits: GitGraphBlock["commits"] = [];
      const seen = new Set<string>();
      for (const c of b.commits) {
        if (!c || !isStr(c.id) || !c.id.trim()) return null;
        if (seen.has(c.id)) continue;                       // a repeated id is a duplicate row
        seen.add(c.id);
        commits.push({
          id: c.id.slice(0, 40),
          branch: isStr(c.branch) ? c.branch.slice(0, 40) : undefined,
          message: isStr(c.message) ? c.message.slice(0, 200) : "",
          author: isStr(c.author) ? c.author.slice(0, 60) : undefined,
          when: isStr(c.when) ? c.when.slice(0, 40) : undefined,
          parents: Array.isArray(c.parents) ? c.parents.filter(isStr).slice(0, 8).map((p: string) => p.slice(0, 40)) : undefined,
          tags: Array.isArray(c.tags) ? c.tags.filter(isStr).slice(0, 6).map((t: string) => t.slice(0, 30)) : undefined,
          merge: c.merge === true ? true : undefined,
        });
        if (commits.length >= 40) break;                     // maxRows cap: see MAX_GIT_ROWS
      }
      if (commits.length === 0) return null;
      let branches: GitGraphBlock["branches"];
      if (Array.isArray(b.branches)) {
        const out: { name: string; head?: string }[] = [];
        const bn = new Set<string>();
        for (const br of b.branches) {
          if (!br || !isStr(br.name) || !br.name.trim()) continue;
          if (bn.has(br.name)) continue;
          bn.add(br.name);
          out.push({ name: br.name.slice(0, 40), head: isStr(br.head) ? br.head.slice(0, 40) : undefined });
          if (out.length >= 12) break;
        }
        branches = out.length > 0 ? out : undefined;
      }
      return {
        type: "gitgraph",
        title: isStr(b.title) ? b.title.slice(0, 200) : undefined,
        branches,
        commits,
      };
    }
    case "terminal": {
      const lines: TerminalBlock["lines"] = [];
      const rawLines = Array.isArray(b.lines) ? b.lines : isStr(b.lines) ? b.lines.split("\n") : null;
      if (!rawLines || rawLines.length === 0) return null;
      const toneOk = new Set(["stdout", "stderr", "info", "success", "dim"]);
      for (const l of rawLines) {
        if (isStr(l)) { lines.push({ text: l }); continue; }
        if (l && typeof l === "object" && isStr(l.text)) {
          lines.push({ text: l.text, tone: toneOk.has(l.tone) ? (l.tone as TermTone) : undefined });
          continue;
        }
        return null;
      }
      if (b.exitCode != null && !isNum(b.exitCode)) return null;
      return {
        type: "terminal",
        title: isStr(b.title) ? b.title : undefined,
        command: isStr(b.command) ? b.command : undefined,
        lines,
        exitCode: isNum(b.exitCode) ? b.exitCode : undefined,
        highlight: b.highlight === false ? false : undefined,
      };
    }
    case "badges": {
      if (!Array.isArray(b.items) || b.items.length === 0) return null;
      const toneOk = new Set(["info", "warn", "success", "danger", "neutral"]);
      const items: BadgesBlock["items"] = [];
      for (const it of b.items) {
        if (!it || !isStr(it.label)) return null;
        items.push({ label: it.label, tone: toneOk.has(it.tone) ? it.tone as any : "neutral" });
      }
      return { type: "badges", items };
    }
    case "divider":
      return { type: "divider", label: isStr(b.label) ? b.label : undefined };
    case "spreadsheet": {
      // rows may arrive as `rows`, `data`, or `cells`; every cell must be a
      // scalar (models sometimes nest {v:…}) — a non-scalar rejects the block.
      const raw = Array.isArray(b.rows) ? b.rows : Array.isArray(b.data) ? b.data : Array.isArray(b.cells) ? b.cells : null;
      if (!raw || raw.length === 0) return null;
      const rows: (string | number)[][] = [];
      for (const r of raw) {
        if (isStr(r)) { rows.push([r]); continue; } // one cell per line is a common slip
        if (!Array.isArray(r) || r.length === 0) return null;
        const row: (string | number)[] = [];
        for (const c of r) {
          if (isStr(c) || isNum(c)) { row.push(c); continue; }
          if (c == null) { row.push(""); continue; }
          if (isStr(c.v) || isNum(c.v)) { row.push(c.v as string | number); continue; }
          if (isStr(c.value) || isNum(c.value)) { row.push(c.value as string | number); continue; }
          return null;
        }
        rows.push(row);
      }
      const sheets = isStrArr(b.sheets) ? b.sheets : undefined;
      const columns = isStrArr(b.columns) ? b.columns : undefined;
      return {
        type: "spreadsheet",
        title: isStr(b.title) ? b.title : undefined,
        filename: isStr(b.filename) ? b.filename : undefined,
        sheets,
        columns,
        rows,
        header: b.header === false ? false : true,
      };
    }
    case "slides": {
      // accept `slides` or `pages` or `deck`
      const raw = Array.isArray(b.slides) ? b.slides : Array.isArray(b.pages) ? b.pages : Array.isArray(b.deck) ? b.deck : null;
      if (!raw || raw.length === 0) return null;
      const slides: SlidesBlock["slides"] = [];
      for (const s of raw) {
        if (!s || typeof s !== "object") return null;
        const heading = isStr(s.heading) ? s.heading : isStr(s.title) ? s.title : isStr(s.text) ? s.text : undefined;
        const bullets: string[] = [];
        for (const src of [s.bullets, s.points, s.items]) {
          if (isStrArr(src)) bullets.push(...src);
          else if (Array.isArray(src)) for (const x of src) if (isStr(x)) bullets.push(x);
        }
        if (!heading && bullets.length === 0) return null; // a slide with nothing on it
        slides.push({
          heading: heading ?? "",
          bullets: bullets.length > 0 ? bullets : undefined,
          note: isStr(s.note) ? s.note : undefined,
          layout: s.layout === "title" ? "title" : "bullets",
        });
      }
      return { type: "slides", title: isStr(b.title) ? b.title : undefined, filename: isStr(b.filename) ? b.filename : undefined, slides };
    }
    case "document": {
      // accept `content` or `body` or `sections`; plain strings allowed (a para each)
      const raw = Array.isArray(b.content) ? b.content : Array.isArray(b.body) ? b.body : Array.isArray(b.sections) ? b.sections : null;
      if (!raw || raw.length === 0) return null;
      const content: DocumentBlock["content"] = [];
      for (const c of raw) {
        if (isStr(c)) {
          if (c.trim() === "") continue;
          content.push({ text: c });
          continue;
        }
        if (!c || typeof c !== "object" || !isStr(c.text)) return null;
        const kindOk = c.kind === "p" || c.kind === "h2" || c.kind === "h3" || c.kind === "li" || c.kind === "quote";
        content.push({
          kind: kindOk ? c.kind : undefined,
          level: c.level === 1 || c.level === 2 || c.level === 3 ? c.level : undefined,
          text: c.text,
        });
      }
      if (content.length === 0) return null;
      return { type: "document", title: isStr(b.title) ? b.title : undefined, filename: isStr(b.filename) ? b.filename : undefined, content };
    }
    case "text": {
      // `content`/`text`/`value`/`body` all name the same string
      const src = b.content ?? b.text ?? b.value ?? b.body;
      if (!isStr(src)) return null;
      return {
        type: "text",
        title: isStr(b.title) ? b.title : undefined,
        filename: isStr(b.filename) ? b.filename : undefined,
        content: src,
        language: isStr(b.language) ? b.language : isStr(b.lang) ? b.lang : undefined,
      };
    }
    // ── v5 reactive + media ──────────────────────────────────────────────────
    case "slider": {
      if (!isStr(b.label) || !isStr(b.bind)) return null;
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(b.bind)) return null;
      let min = isNum(b.min) ? b.min : 0;
      let max = isNum(b.max) ? b.max : 100;
      if (min > max) { const t = min; min = max; max = t; } // bounds confusion: swap, never reject
      if (max === min) max = min + 1;
      let step = isNum(b.step) && b.step > 0 ? b.step : (max - min) / 100;
      const span = max - min;
      if (step > span) step = span;
      // snap step onto a sane decimal grid so the value never reads 33.33333334
      const mag = Math.pow(10, Math.floor(Math.log10(step)) - 2);
      step = Math.max(mag, Math.round(step / mag) * mag);
      return {
        type: "slider",
        label: b.label,
        bind: b.bind,
        min, max, step,
        value: isNum(b.value) ? Math.min(max, Math.max(min, b.value)) : undefined,
        unit: isStr(b.unit) ? b.unit : undefined,
        format: b.format === "money" || b.format === "compact" || b.format === "pct" ? b.format : "plain",
      };
    }
    case "select":
    case "multiselect":
    case "segmented": {
      const maxOpts = b.type === "segmented" ? 5 : 24;
      if (!isStr(b.bind) || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(b.bind)) return null;
      if (!Array.isArray(b.options) || b.options.length === 0 || b.options.length > maxOpts) return null;
      const options: { label: string; value: string }[] = [];
      const seen = new Set<string>();
      for (const o of b.options) {
        if (!o || typeof o !== "object") return null;
        // near-miss: scalar option list (["prod","stage"] or strings as labels)
        const label = isStr(o.label) ? o.label : isStr(o) ? o : isStr(o.value) ? o.value : isStr(o.name) ? o.name : null;
        if (!label) return null;
        const value = isStr(o.value) ? o.value : label;
        if (seen.has(value)) continue; // duplicate values collapse silently
        seen.add(value);
        options.push({ label, value });
      }
      if (options.length === 0) return null;
      if (b.type === "multiselect") {
        const val = Array.isArray(b.value) ? b.value.filter((v: unknown): v is string => isStr(v)).filter((v: string) => seen.has(v)) : undefined;
        return { type: "multiselect", label: isStr(b.label) ? b.label : "", bind: b.bind, options, value: val };
      }
      const val = isStr(b.value) && seen.has(b.value) ? b.value : options[0].value;
      return b.type === "segmented"
        ? { type: "segmented", label: isStr(b.label) ? b.label : undefined, bind: b.bind, options, value: val }
        : { type: "select", label: isStr(b.label) ? b.label : "", bind: b.bind, options, value: val };
    }
    case "toggle": {
      if (!isStr(b.label) || !isStr(b.bind)) return null;
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(b.bind)) return null;
      return { type: "toggle", label: b.label, bind: b.bind, value: b.value === true ? true : b.value === false ? false : undefined };
    }
    case "search": {
      if (!isStr(b.bind) || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(b.bind)) return null;
      return {
        type: "search",
        label: isStr(b.label) ? b.label : undefined,
        bind: b.bind,
        placeholder: isStr(b.placeholder) ? b.placeholder : undefined,
      };
    }
    case "data": {
      // Named dataset: a carrier for `$from` readers — validated like a table,
      // but cells may also be booleans and rows may be ragged (padded).
      if (!isStr(b.name) || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(b.name)) return null;
      const raw = Array.isArray(b.rows) ? b.rows : Array.isArray(b.data) ? b.data : null;
      if (!raw || raw.length === 0) return null;
      const rows: (string | number | boolean | null)[][] = [];
      let width = 0;
      for (const r of raw) {
        if (!Array.isArray(r) || r.length === 0) return null;
        width = Math.max(width, r.length);
        const row: (string | number | boolean | null)[] = [];
        for (const c of r) {
          if (isStr(c) || isNum(c)) { row.push(c); continue; }
          if (typeof c === "boolean") { row.push(c); continue; }
          if (c == null) { row.push(null); continue; }
          return null;
        }
        rows.push(row);
      }
      const columns = isStrArr(b.columns) ? b.columns : undefined;
      return {
        type: "data",
        name: b.name,
        columns,
        rows: rows.map((r) => (r.length < width ? [...r, ...new Array(width - r.length).fill(null)] : r)),
        header: b.header === false ? false : true,
      };
    }
    case "graph": {
      if (!Array.isArray(b.nodes) || b.nodes.length === 0) return null;
      if (b.nodes.length > 400) return null; // a card is not a data dump
      const nodes: GraphNode[] = [];
      const ids = new Set<string>();
      for (const n of b.nodes) {
        if (!n || !isStr(n.id) || !isStr(n.label)) return null;
        if (ids.has(n.id)) continue; // duplicate ids collapse (last label wins)
        ids.add(n.id);
        nodes.push({
          id: n.id,
          label: n.label,
          kind: isStr(n.kind) ? n.kind : undefined,
          weight: isNum(n.weight) ? Math.max(0, n.weight) : 1,
          detail: isStr(n.detail) ? n.detail : undefined,
        });
      }
      if (nodes.length === 0) return null;
      // A dangling edge is worse than no edge (comindash drops them, not the graph).
      const edges: GraphEdge[] = [];
      const rawEdges = Array.isArray(b.edges) ? b.edges : [];
      for (const e of rawEdges) {
        if (!e || typeof e !== "object") continue;
        const src = isStr(e.source) ? e.source : isStr(e.from) ? e.from : null;
        const tgt = isStr(e.target) ? e.target : isStr(e.to) ? e.to : null;
        if (!src || !tgt || !ids.has(src) || !ids.has(tgt)) continue;
        edges.push({
          source: src,
          target: tgt,
          kind: isStr(e.kind) ? e.kind : undefined,
          label: isStr(e.label) ? e.label : undefined,
          weight: isNum(e.weight) ? e.weight : 1,
        });
      }
      const height = isNum(b.height) ? Math.min(720, Math.max(320, b.height)) : undefined;
      return { type: "graph", nodes, edges, title: isStr(b.title) ? b.title : undefined, height };
    }
    case "image": {
      const src = b.src ?? b.path ?? b.url;
      if (!isStr(src) || src.trim() === "") return null;
      return {
        type: "image",
        src,
        alt: isStr(b.alt) ? b.alt : undefined,
        caption: isStr(b.caption) ? b.caption : undefined,
      };
    }
    case "gallery": {
      const raw = Array.isArray(b.items) ? b.items : Array.isArray(b.images) ? b.images : null;
      if (!raw || raw.length === 0) return null;
      const items: GalleryBlock["items"] = [];
      for (const it of raw) {
        // Common slips: a bare string path, or {src} unnamed
        if (isStr(it)) { items.push({ src: it }); continue; }
        if (!it || typeof it !== "object") return null;
        const src = it.src ?? it.path ?? it.url ?? it.image;
        if (!isStr(src)) return null;
        items.push({ src, alt: isStr(it.alt) ? it.alt : undefined, caption: isStr(it.caption) ? it.caption : undefined });
      }
      if (items.length === 0) return null;
      return { type: "gallery", items: items.slice(0, 24), layout: b.layout === "3col" ? "3col" : "2col" };
    }
    case "video": {
      const src = b.src ?? b.path ?? b.url;
      if (!isStr(src) || src.trim() === "") return null;
      return {
        type: "video",
        src,
        poster: isStr(b.poster) ? b.poster : undefined,
        captions: isStr(b.captions) ? b.captions : undefined,
        caption: isStr(b.caption) ? b.caption : undefined,
      };
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
  // HIGH (2026-10-05): the last non-whitespace char emitted, tracked in a var.
  // The old `out.replace(/\s+$/,"").slice(-1)` re-scanned the whole accumulator
  // PER INPUT CHARACTER — O(n^2). Measured 82 KB = 1.1 s, 334 KB = 17.3 s, a
  // realistic 342 KB bare-key payload = 21 s, on the SYNC path (once per
  // streaming delta) => a ~20 s tab freeze per frame on a common shape.
  let lastSig = "";
  while (i < s.length) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') { inStr = false; lastSig = '"'; }
      i++;
      continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    // `prev` must be the last non-whitespace char of `out` BEFORE appending c
    // — that is exactly what the old `out.replace(/\s+$/,"").slice(-1)`
    // returned, and it must be sampled BEFORE lastSig is refreshed below or the
    // key at this position is tested against itself instead of its predecessor.
    const prev = lastSig;
    if (prev === "{" || prev === ",") {
      const m = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/.exec(s.slice(i));
      if (m) {
        out += m[0].replace(m[1], `"${m[1]}"`);
        lastSig = ":"; // out now ends with the key's colon
        i += m[0].length;
        continue;
      }
    }
    if (c.trim() !== "") lastSig = c;
    out += c;
    i++;
  }
  return out;
}

/**
 * Tier 1.65 — a key:value pair emitted INSIDE an array. Real kill (2026-10-08,
 * RG-146): a 25 KB A4 report card died on
 *   `"rows":[["What is this?","…evidence packs.","tone":"neutral"],["Why…" ]]`
 * — the model lost track of container type mid-row and wrote an object pair
 * into a string array. JSON.parse dies at the `:`; jsonrepair (async tier) only
 * "fixes" it by splitting the pair into three junk elements, so the row renders
 * as a broken 5-cell row. Here the stray pair is DROPPED cleanly: the row keeps
 * its real cells. `tone` on a table row carries no rendering meaning, so losing
 * it loses nothing.
 *
 * Fires only when ALL hold (string-aware scan, like every tier here):
 *   - a string's closing quote is followed (after whitespace) by `:`,
 *   - the innermost open container is an ARRAY (in an object this is just a
 *     normal key:value pair),
 *   - the value after the `:` is a scalar (string/number/true/false/null).
 * A structured value (`{`/`[`) bails on the site — no speculative surgery;
 * the async tier owns that case. Consecutive pairs (`,"k2":"v2"` …) are
 * consumed until the `]`.
 */
function fixKeyValueInArray(s: string): string {
  const out: string[] = [];
  const stack: ("{" | "[")[] = [];
  let inString = false;
  let escaped = false;
  let i = 0;
  const wsAt = (p: number) => { let j = p; while (j < s.length && /\s/.test(s[j])) j++; return j; };

  while (i < s.length) {
    const c = s[i];
    if (inString) {
      out.push(c);
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === "{" || c === "[") { stack.push(c); out.push(c); i++; continue; }
    if (c === "}" || c === "]") { stack.pop(); out.push(c); i++; continue; }
    // Quote inside an ARRAY goes through the defect-aware handler below (a
    // plain string-open here would swallow the key and let the stray `:`
    // through). Object context keeps the plain handler.
    if (c === '"' && stack.length && stack[stack.length - 1] === "[") {
      // Defect check FIRST (a generic open-quote handler would swallow the key
      // string and let the stray `:` through): is this string a KEY?
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === "\\") { j += 2; continue; }
        if (s[j] === '"') break;
        j++;
      }
      // "key":  inside an array? (colon right after the closing quote)
      let k = wsAt(j + 1);
      if (j < s.length && s[k] === ":") {
        // Peek the value BEFORE touching the output: a structured (`{`/`[`) or
        // unrecognizable value means this is NOT a pair-in-array defect — it is
        // a legit object key seen through a MISNESTED context (RG-147: the
        // callout object is still open, so the root key `"badges":[…]` looks
        // like an array element with a colon). Emit the key string untouched;
        // the misnested-closer healer owns the structure. The old bail here
        // stripped the preceding comma and left a stray quote — active corrupt-
        // ion on every misnested body that reached this tier.
        let v = wsAt(k + 1);
        let consumeEnd = -1;
        if (s[v] === '"') {
          v++;
          while (v < s.length) {
            if (s[v] === "\\") { v += 2; continue; }
            if (s[v] === '"') { v++; break; }
            v++;
          }
          consumeEnd = v;
        } else {
          const scalar = /^(true|false|null|-?[0-9][0-9.eE+]*)/.exec(s.slice(v));
          if (scalar) consumeEnd = v + scalar[0].length;
        }
        if (consumeEnd === -1) {
          out.push(s.slice(i, j + 1));
          i = j + 1;
          continue;
        }
        // Confirmed defect (scalar/string value). Strip the comma that precedes
        // this key (if any), consume `key : value` — and any further
        // `,"key" : value` pairs — up to the array's `]`.
        let end = out.length;
        while (end > 0 && /\s/.test(out[end - 1])) end--;
        if (end > 0 && out[end - 1] === ",") out.length = end - 1;
        // consume the key token
        i = k + 1;
        i = consumeEnd;
        // more pairs? `,"k":"v"` … until `]`
        for (;;) {
          const a = wsAt(i);
          if (s[a] !== ",") break;
          const b = wsAt(a + 1);
          if (s[b] !== '"') break;
          // key token
          let m = b + 1;
          while (m < s.length) {
            if (s[m] === "\\") { m += 2; continue; }
            if (s[m] === '"') break;
            m++;
          }
          const n2 = wsAt(m + 1);
          if (s[n2] !== ":") break;
          // value token
          let v2 = wsAt(n2 + 1);
          if (s[v2] === '"') {
            v2++;
            while (v2 < s.length) {
              if (s[v2] === "\\") { v2 += 2; continue; }
              if (s[v2] === '"') { v2++; break; }
              v2++;
            }
          } else {
            const scalar2 = /^(true|false|null|-?[0-9][0-9.eE+]*)/.exec(s.slice(v2));
            if (!scalar2) break;
            v2 += scalar2[0].length;
          }
          i = v2;
        }
        continue; // next loop iteration sees the `]` (or whatever follows)
      }
      // normal string element: emit it wholesale
      out.push(s.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (c === '"') { inString = true; out.push(c); i++; continue; }
    out.push(c);
    i++;
  }
  return out.join("");
}

/**
 * Tier 1 — locate the outermost JSON value in text that may be wrapped in prose.
 *
 * Ported from the Smartslate Polaris v4 AI-response validator
 * (`frontend/src/lib/integrations/claude/validation.ts`), whose string-aware
 * brace counter is genuinely good. Why it matters HERE specifically: a raw
 * repair library run on fence content that still has prose around it returns an
 * ARRAY of the prose and the object as siblings — measured with jsonrepair —
 * which would destroy an otherwise-valid card. Extracting the outermost value
 * FIRST makes that impossible, and handles the "Here is the card: {...}" shape
 * that models emit constantly.
 *
 * String-aware on purpose: a brace or bracket inside a JSON string value must
 * never affect the nesting count, or the extracted range is cut short.
 *
 * Returns null when there is no balanced outermost value (a genuinely truncated
 * payload), so the caller falls through to the repair tiers.
 */

function lenientJson(raw: string): unknown {
  const attempt = (s: string) => JSON.parse(s);
  try { return attempt(raw); } catch { /* fall through to repair */ }

  const repaired = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")      // block comments
    .replace(/(^|[^:"'\\])\/\/.*$/gm, "$1") // line comments (not inside strings)
    .replace(/,(\s*[}\]])/g, "$1");         // trailing commas
  try { return attempt(repaired); } catch { /* try bare-key quoting */ }
  try { return attempt(quoteBareKeys(repaired)); } catch { /* fall through to depth repair */ }

  // Tier 1.5: unescaped newlines inside string literals (LLM emits literal
  // newlines in markdown content instead of \n escapes). Scan string-aware.
  const newlineFixed = fixUnescapedNewlines(repaired);
  try { return attempt(newlineFixed); } catch { /* fall through */ }

  // Tier 1.6: missing commas between array elements (LLM forgets commas
  // between table rows). Insert commas between ]/} and [/{.
  const commaFixed = fixMissingCommas(newlineFixed);
  try { return attempt(commaFixed); } catch { /* fall through to depth repair */ }

  // Tier 1.65: key:value pair emitted INSIDE an array (model loses track of
  // container type mid-row: `["cell","cell","tone":"neutral"]`). Dropped
  // cleanly so table rows keep their real cells — see fixKeyValueInArray.
  const pairFixed = fixKeyValueInArray(commaFixed);
  try { return attempt(pairFixed); } catch { /* fall through to depth repair */ }

  // Tier 1.7: truncated string (LLM ran out of tokens mid-emission).
  // Close any unterminated string at the end of the JSON. Operates on the
  // pair-fixed text — the tiers chain, each building on the previous fix
  // (b679d5eb had BOTH defects: a pair-in-array mid-body AND a truncated
  // final string; feeding commaFixed here dropped the first fix on the floor).
  const truncated = fixTruncatedString(pairFixed);
  try { return attempt(truncated); } catch { /* fall through */ }

  // Tier 1.75: misnested closers — BEFORE truncation completion in spirit, so
  // it runs on text the truncation tier has not yet "completed" (fixTruncatedString
  // closes phantom brackets around a misnesting and makes it unhealable; heal
  // the structure FIRST, then completion is unnecessary — the healer also
  // completes EOF itself). RG-147 (c03b8079).
  const healed = healMisnestedClosers(truncated);
  try { return attempt(healed); } catch { /* fall through */ }

  // The truncation tier's phantom-completion can corrupt a healable body; if
  // healing the UN-completed text works, prefer that answer.
  const healedRaw = healMisnestedClosers(pairFixed);
  try { return attempt(healedRaw); } catch { /* fall through to depth repair */ }

  // Tier 2: bracket-depth repair (see balanceBrackets). Handles the surplus
  // trailing closer the model emits at the end of a card.
  return attempt(balanceBrackets(quoteBareKeys(truncated)));
}

/**
 * Replace literal newline characters inside JSON string literals with \\n.
 * Scans character-by-character tracking whether we're inside a string.
 */
function fixUnescapedNewlines(s: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escaped) {
      result += c;
      escaped = false;
      continue;
    }
    if (c === "\\" && inString) {
      result += c;
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      result += c;
      continue;
    }
    if (inString && (c === "\n" || c === "\r")) {
      result += c === "\n" ? "\\n" : "\\r";
      continue;
    }
    result += c;
  }
  return result;
}

/**
 * Fix truncated JSON where the LLM ran out of tokens mid-string.
 * Closes the unterminated string, then closes any open brackets/braces.
 */
/**
 * Tier 1.7 — misnested closer healing + EOF completion (RG-147, c03b8079).
 *
 * Two defects the depth counter cannot see because they cancel out numerically:
 *   a) the model writes a closer that does not match the innermost open
 *      container (`blocks:[ … {"x":1}],` — the `]` closes the array while the
 *      object is still open, so its implied `}` is missing);
 *   b) a whole run of closers is missing at EOF (a truncated fence whose brace
 *      COUNT happens to balance because early misnesting paid for it —
 *      `fixTruncatedString`'s naive count then appends nothing).
 *
 * Healing rule: a closer matching an outer container first closes everything
 * inside it (emitting the implied closers), then itself. At EOF the remaining
 * open containers close in reverse order. Valid JSON passes through untouched
 * (every closer matches the top of the stack) — this is a no-op unless the
 * text is already broken, and it never DROPS content: everything written is
 * kept, only implied closers are added.
 */
function healMisnestedClosers(s: string): string {
  const out: string[] = [];
  const stack: ("{" | "[")[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      out.push(c);
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out.push(c); continue; }
    if (c === "{" || c === "[") { stack.push(c); out.push(c); continue; }
    if (c === "}" || c === "]") {
      const want = c === "}" ? "{" : "[";
      const at = stack.lastIndexOf(want);
      if (at === -1) {
        // closer with nothing open of its kind: stray — drop it (the depth
        // repair tier used to balance around it; dropping the stray is the
        // minimal honest repair)
        continue;
      }
      // close everything above the matching container, then the container
      for (let k = stack.length - 1; k >= at; k--) out.push(stack[k] === "{" ? "}" : "]");
      stack.length = at;
      continue;
    }
    out.push(c);
  }
  // EOF: close whatever is still open, innermost first
  for (let k = stack.length - 1; k >= 0; k--) out.push(stack[k] === "{" ? "}" : "]");
  return out.join("");
}

function fixTruncatedString(s: string): string {
  let inString = false;
  let escaped = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\" && inString) { escaped = true; continue; }
    if (c === '"') {
      inString = !inString;
    }
  }

  // If we're still inside a string, close it
  let result = s;
  if (inString) {
    result += '"';
  }

  // Count open brackets/braces and close them
  let openBraces = 0;
  let openBrackets = 0;
  inString = false;
  escaped = false;
  for (let i = 0; i < result.length; i++) {
    const c = result[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\" && inString) { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") openBraces++;
    if (c === "}") openBraces--;
    if (c === "[") openBrackets++;
    if (c === "]") openBrackets--;
  }

  // Close in reverse order (braces first, then brackets)
  result += "}".repeat(Math.max(0, openBraces));
  result += "]".repeat(Math.max(0, openBrackets));

  return result;
}

/**
 * Insert missing commas between array elements. Finds places where a ] or }
 * is followed by a [ or { (with only whitespace between) and inserts a comma.
 * String-aware: does not modify commas inside string literals.
 */
function fixMissingCommas(s: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escaped) {
      result += c;
      escaped = false;
      continue;
    }
    if (c === "\\" && inString) {
      result += c;
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      result += c;
      continue;
    }
    if (!inString && (c === "]" || c === "}")) {
      // Look ahead for [ or { (skip whitespace)
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (j < s.length && (s[j] === "[" || s[j] === "{")) {
        result += c + ",";
        continue;
      }
    }
    result += c;
  }
  return result;
}

/**
 * Tier 1 — locate the outermost JSON value in text that may be wrapped in prose.
 *
 * Ported from the Smartslate Polaris v4 AI-response validator
 * (`frontend/src/lib/integrations/claude/validation.ts`), whose string-aware
 * brace counter is genuinely good.
 *
 * NOT called from lenientJson, and that is deliberate. parseCanvasSpec falls back
 * to parseNdjson ONLY when lenientJson throws, so any tier that returns a
 * successful parse pre-empts it: an NDJSON body has no envelope, so isolating the
 * outermost value yields the FIRST object alone and the rest of the card is
 * silently dropped (measured — the NDJSON, bare-block and misnested-fence tests
 * all broke when this ran in the sync path).
 *
 * So tier 1 lives on the ASYNC path only, as a precondition for the repair
 * library. Measured reason: handed `Here is the card:\n{...}\nHope that helps.`,
 * jsonrepair returns an ARRAY of [prose, object, prose] — which would destroy an
 * otherwise-valid card. Isolating the outermost value first makes that
 * impossible.
 */
export function extractOutermostJson(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "{" || c === "[") { depth++; stack.push(c); continue; }
    if (c === "}" || c === "]") {
      const want = c === "}" ? "{" : "[";
      if (stack[stack.length - 1] !== want) return null; // crossed brackets
      stack.pop();
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // never closed — a truncated stream, not a repair candidate
}

/**
 * Tier 3 — a real repair library, behind a dynamic import so its~2.5 kB only
 * loads on a canvas that actually needed it.
 *
 * Guarded twice, because a repair library will happily "fix" things it should
 * not. Measured: handed `Here is the card:\n{...}\nHope that helps.` it returns
 * an ARRAY of the prose and the object as siblings, which would destroy an
 * otherwise-valid card. So it only ever receives an ALREADY-ISOLATED value
 * (tier 1 guarantees that), and its output must still yield a usable `blocks`
 * array or we treat it as unrecoverable. A repair that fabricates structure is
 * worse than raw JSON shown honestly.
 */
let repairLib: ((text: string) => string) | null = null;

export async function loadRepairLib(): Promise<((text: string) => string) | null> {
  if (repairLib) return repairLib;
  try {
    const mod = await import("jsonrepair");
    repairLib = mod.jsonrepair;
    return repairLib;
  } catch {
    return null; // chunk failed to load — degrade exactly as before
  }
}

/**
 * Repair an already-isolated value with the library. Returns a full spec or
 * null — NEVER a fabricated structure.
 *
 * coerceToBlocks returns the BLOCK LIST, not a spec, so this builds the
 * envelope itself and runs the same per-block validation parseCanvasSpec uses.
 * Returning the bare list here was the bug that made tier 3 a silent no-op:
 * callers read `.blocks` off the result and got undefined, so every repaired
 * card was discarded.
 */
export function repairIsolated(raw: string, repair: (t: string) => string): CanvasSpec | null {
  const isolated = extractOutermostJson(raw);
  if (!isolated) return null;
  let out: unknown;
  try {
    out = JSON.parse(repair(isolated));
  } catch {
    return null;
  }
  if (!out || typeof out !== "object") return null;
  const list = coerceToBlocks(out);
  // Per-block tolerance, exactly like parseCanvasSpec: keep what validates,
  // degrade only when NOTHING does.
  const blocks: CanvasBlock[] = [];
  for (const b of list) {
    const v = validateBlock(b);
    if (v) blocks.push(v);
  }
  if (blocks.length === 0) return null;
  const title = isStr((out as { title?: unknown }).title) ? (out as { title: string }).title : undefined;
  // `state` seeds the card's store; omit the key entirely when absent so a
  // state-less card stays deepEqual to its old shape.
  const state = pickState((out as { state?: unknown }).state);
  const page = pickPage((out as { page?: unknown }).page);
  return buildSpec(title, state, page, blocks);
}

/**
 * Async parse: identical to parseCanvasSpec, but allowed to pull the repair
 * library in on demand for the defect classes tiers 1-2 cannot fix. A strict
 * superset of the sync result, so callers can always fall back to it.
 */
export async function parseCanvasSpecAsync(raw: string): Promise<CanvasSpec | null> {
  const direct = parseCanvasSpec(raw);
  if (direct) return direct;
  const repair = await loadRepairLib();
  if (!repair) return null;
  return repairIsolated(raw, repair);
}

/**
 * Make bracket nesting self-consistent without touching string contents.
 * Idempotent: returns the input unchanged when it is already balanced.
 */
function balanceBrackets(s: string): string {
  let body = s.trim();
  for (let pass = 0; pass < 5; pass++) {
    const stack: string[] = [];
    let droppedStrayCloser = false;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '"') {
        // Step over the string so a brace or quote inside it is never structural.
        i++;
        while (i < body.length) {
          if (body[i] === "\\") { i += 2; continue; }
          if (body[i] === '"') break;
          i++;
        }
        continue;
      }
      if (c === "{" || c === "[") { stack.push(c); continue; }
      if (c === "}" || c === "]") {
        const want = c === "}" ? "{" : "[";
        if (stack[stack.length - 1] === want) stack.pop();
        else { body = body.slice(0, i) + body.slice(i + 1); droppedStrayCloser = true; break; }
      }
    }
    if (droppedStrayCloser) continue;          // retry against the shortened text
    if (stack.length === 0) return body;        // balanced
    body += stack.reverse().map((c) => (c === "{" ? "}" : "]")).join("");
  }
  return body;
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
  // E: block-type-keyed root — the directive's recipe shorthand
  // (`badges → callout → kpi ×3 → table`) emitted WITHOUT the blocks envelope:
  // {"badges":{…},"kpi":[{…},{…}],"callout":{…}}. Valid JSON, every block
  // valid — and every prior case returned [] here, so the whole card died as
  // "unreadable payload" (RG-148: the canvas system itself hit this live).
  // Collect each KNOWN block-type key in order: object → one block of that
  // type; array of objects → one block per element. Non-type keys (title,
  // state, page) are untouched — parseCanvasSpec reads them from `data`.
  const typeKeys = Object.keys(data).filter((k) => looksLikeBlockType(k));
  if (typeKeys.length > 0) {
    const out: any[] = [];
    for (const k of typeKeys) {
      const v = (data as Record<string, unknown>)[k];
      if (Array.isArray(v)) {
        for (const x of v) {
          if (x && typeof x === "object" && !Array.isArray(x)) out.push({ ...x, type: k });
        }
      } else if (v && typeof v === "object") {
        out.push({ ...v, type: k });
      }
    }
    if (out.length > 0) return out;
  }
  // F: cross-harness canvas envelopes (Android app shape, 2026-10-08 live RG):
  // {markdown, artifacts:{blocks:[…]}, spec:{page}} — the block LIST nests one
  // level down under a wrapper key ("artifacts") that is not itself a block
  // type. Alias IN PLACE on the throwaway parse object (blocks to the root,
  // title/page/state hoisted from `spec`), then re-enter: parseCanvasSpec reads
  // title/state/page off `data` after this returns, so the hoist must land there.
  for (const k of Object.keys(data)) {
    if (k === "blocks") continue;
    const v = (data as Record<string, unknown>)[k];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const wrapper = v as { blocks?: unknown };
    if (!Array.isArray(wrapper.blocks)) continue;
    const root: Record<string, unknown> = {};
    for (const o of [data.spec, data]) {
      if (o && typeof o === "object" && !Array.isArray(o)) Object.assign(root, o);
    }
    const blocks: any[] = wrapper.blocks.filter(
      (x: any) => x && typeof x === "object" && !Array.isArray(x),
    );
    // Residual prose the sender carried alongside the card (the Android
    // `markdown`) is not lost: it ships as a text block AFTER the real ones.
    if (isStr(root.markdown) && root.markdown.trim()) {
      blocks.push({ type: "text", title: "Summary", content: root.markdown });
    }
    if (blocks.length === 0) continue;
    const d = data as Record<string, unknown>;
    if (d.blocks === undefined) d.blocks = blocks;
    if (d.title === undefined && isStr(root.title)) d.title = root.title;
    if (d.page === undefined && root.page !== undefined) d.page = root.page;
    if (d.state === undefined && root.state !== undefined) d.state = root.state;
    return coerceToBlocks(d);
  }
  return [];
}

/**
 * G — the UNFENCED card (2026-10-08 live RG): a sender wrapped its card in the
 * wrong envelope AND never claimed a fence at all, so the body sits in plain
 * message text between prose ("Report:\n{...}\nPhone note: …"). The fence
 * pipeline never sees it and the card paints as raw JSON.
 *
 * `aliasSpecFromText` is the last-resort consumer guardrail for that shape:
 * isolate the outermost JSON value from the surrounding prose, parse it, and
 * require the result to read as a CANVAS (a blocks list, a bare block, or the
 * alias envelope F). Anything else — code samples, config snippets, a model's
 * literal JSON example — returns null and renders exactly as it did before.
 * Cheap pre-gates keep the O(n) isolation off ordinary chat text.
 */
export function aliasSpecFromText(text: string): CanvasSpec | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;
  const candidate = extractOutermostJson(text.slice(start));
  if (!candidate || candidate.length < 24) return null;
  const spec = parseCanvasSpec(candidate);
  if (spec && spec.blocks.length > 0) return spec;
  return null;
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
  // KPI fan-out: a model naturally writes one kpi block carrying an items/kpis
  // array of tiles (label+value rows). The schema's kpi is a SINGLE tile — the
  // composite block used to fail validation and drop silently (KPI cards
  // rendered as raw JSON). Fan it out into one kpi block per tile here so the
  // per-block validator sees tiles it accepts. Applies to every collection key
  // models reach for (items, kpis, tiles).
  const list2: any[] = [];
  for (const b of list) {
    if (b && b.type === "kpi" && !isStr(b.label) && Array.isArray(b.items) && b.items.length > 0) {
      for (const tile of b.items) {
        if (tile && typeof tile === "object" && (isStr(tile.label) || isStr(tile.name))) {
          list2.push({ type: "kpi", label: isStr(tile.label) ? tile.label : tile.name, value: tile.value, delta: tile.delta, trend: tile.trend, spark: tile.spark });
        }
      }
      continue;
    }
    list2.push(b);
  }

  // PER-BLOCK tolerance: one malformed block must not sink a whole card. Keep
  // every block that validates; degrade to markdown only if NONE do (otherwise
  // a single unexpected block shape silently turned the entire canvas into a
  // wall of raw JSON in the chat).
  const blocks: CanvasBlock[] = [];
  for (const b of list2) {
    // Sibling injection: a table that binds `$from` may omit `columns` — the
    // referenced `data` block defines them. Pass the top-level datasets down so
    // the table case can synthesise them; the key is stripped by per-type
    // validation, never rendered.
    if (b && b.type === "table") {
      b.__datasets = list2
        .filter((x: any) => x && x.type === "data" && isStr(x.name))
        .map((x: any) => ({ name: x.name, columns: x.columns }));
    }
    const v = validateBlock(b);
    if (v) blocks.push(v);
  }
  if (blocks.length === 0) return null;
  const title = isStr(data.title) ? data.title : undefined;
  const state = pickState(data.state);
  const page = pickPage(data.page);
  return buildSpec(title, state, page, blocks);
}

/**
 * Assemble the envelope from its optional keys.
 *
 * An absent key is OMITTED, not set to undefined: several checks deepEqual a
 * parsed spec against a literal, and a present-but-undefined key fails that
 * comparison. A card written before `page` existed must keep parsing to the
 * exact same object it always did.
 */
function buildSpec(
  title: string | undefined,
  state: Record<string, string | number | boolean | null> | undefined,
  page: CanvasPageFormat | undefined,
  blocks: CanvasBlock[],
): CanvasSpec {
  const spec: CanvasSpec = { v: 1, title, blocks };
  if (state) spec.state = state;
  if (page) spec.page = page;
  return spec;
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
    // Collect ALL parseable closers; prefer the LAST (longest body).
    // fixTruncatedString makes truncated JSON parseable, so inner triple
    // backticks in code blocks now parse as valid — we must skip them.
    const parseable: RegExpExecArray[] = [];
    for (let c = anyRe.exec(text); c; c = anyRe.exec(text)) {
      if (/^[ \t]*(?=\r?$)/.test(text.slice(c.index + c[0].length)) && !fallback) fallback = c;
      if (parseCanvasSpec(text.slice(bodyStart, c.index))) parseable.push(c);
    }
    if (parseable.length > 0) close = parseable[parseable.length - 1];
    if (!close) {
      // No closer at all — genuinely unterminated. The stream/finalized
      // distinction depends on this staying true, so `continue`.
      //
      // But a CLOSED fence whose body merely fails to parse must still be
      // returned, or tier 3 is unreachable: the async splitter can only retry
      // fences this function reports. Measured failure without this — single-quoted
      // JSON was dropped here and never reached jsonrepair.
      const lone = fallback;
      if (!lone) continue;
      close = lone;
    }
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
  // Last-resort rescue (2026-10-08 RG): a sender left the card UNFENCED in the
  // text — no `astra-canvas` opener anywhere, so no fence scan can claim it.
  // Only a valid canvas payload aliases out; ordinary prose/JSON renders as
  // before. FINALIZED turns only: mid-stream a bare `{` is far more likely a
  // half-written fence than a finished card.
  if (!streaming && tail) {
    const rescued = aliasSpecFromText(tail);
    if (rescued) {
      if (tail.slice(0, tail.search(/[{[]/)).trim()) {
        parts.push({ kind: "md", text: tail.slice(0, tail.search(/[{[]/)) });
      }
      parts.push({ kind: "canvas", spec: rescued });
      return parts;
    }
  }
  if (tail) parts.push({ kind: "md", text: tail });
  return parts;
}

/** True when the text contains at least one VALID closed canvas (mount gate for lazy chunk). */
export function hasCanvas(text: string): boolean {
  text = healMisnestedFence(text);
  if (scanFences(text).some((f) => parseCanvasSpec(f.body) !== null)) return true;
  return aliasSpecFromText(text) !== null;
}

/**
 * Async twin of splitCanvasBlocks: identical output, but a fence that tiers 1-2
 * could not parse gets one more attempt with the repair library loaded on demand.
 *
 * This is the ONLY entry point that can reach tier 3, which is deliberate — the
 * repair library must never be on the synchronous path the mount gate and the
 * streaming parser share, or a chat with no canvas would pay for it.
 *
 * `streaming` behaves exactly as in the sync version: an unterminated fence is
 * hidden while streaming and preserved as markdown once finalized.
 */
export async function splitCanvasBlocksAsync(text: string, streaming = false): Promise<CanvasPart[]> {
  const sync = splitCanvasBlocks(text, streaming);
  const healed = healMisnestedFence(text);

  // Count fences with a plain opener scan rather than trusting scanFences: the
  // scanner only reports fences whose body PARSES (its "first closer that wins"
  // rule), so it reports none for the malformed payloads tier 3 exists to fix.
  // Depending on it made the whole async path unreachable.
  const openers = healed.match(/`{3,}astra-canvas/g)?.length ?? 0;
  const parsedCount = sync.filter((p) => p.kind === "canvas").length;
  if (openers - parsedCount <= 0) return sync;

  const repair = await loadRepairLib();
  if (!repair) return sync;

  // Walk the healed text with a NON-GREEDY-per-fence delimiter that cannot span
  // a fence boundary: the body stops at the first closer of the SAME length, and
  // if the body does not parse, retry against the next opener (a code block
  // containing ``` produces a closer of a DIFFERENT length, so length-matching
  // alone is not enough and a lazy [\s\S]*? swallowed the following canvas).
  const parts: CanvasPart[] = [];
  let cursor = 0;
  let searchFrom = 0;
  while (searchFrom < healed.length) {
    const open = healed.indexOf("astra-canvas", searchFrom);
    if (open === -1) break;
    const runStart = open - (() => { let n = 0, i = open - 1; while (i >= 0 && healed[i] === "`") { n++; i--; } return n; })();
    const bodyStart = open + "astra-canvas".length;
    const nl = healed.indexOf("\n", bodyStart);
    if (nl === -1 || runStart < 0) { searchFrom = bodyStart; continue; }

    // Candidate closers: every backtick run after the body.
    const anyRe = /`{3,}/g;
    anyRe.lastIndex = nl + 1;
    let chosen: { body: string; end: number } | null = null;
    for (let c = anyRe.exec(healed); c; c = anyRe.exec(healed)) {
      const spec = parseCanvasSpec(healed.slice(nl + 1, c.index));
      if (spec) { chosen = { body: healed.slice(nl + 1, c.index), end: c.index + c[0].length }; break; }
    }
    if (!chosen) {
      const spec = repairIsolated(healed.slice(nl + 1), repair);
      // Only accept the repaired body if it is followed by a real closer.
      if (spec) {
        const tailRe = /`{3,}/g;
        tailRe.lastIndex = nl + 1;
        const first = tailRe.exec(healed);
        if (first) chosen = { body: healed.slice(nl + 1, first.index), end: first.index + first[0].length };
      }
    }
    if (!chosen) { searchFrom = nl + 1; continue; }

    if (runStart > cursor) parts.push({ kind: "md", text: healed.slice(cursor, runStart) });
    const spec = parseCanvasSpec(chosen.body) ?? repairIsolated(chosen.body, repair);
    if (spec) parts.push({ kind: "canvas", spec });
    cursor = chosen.end;
    searchFrom = chosen.end;
  }
  if (parts.length === 0) return sync; // nothing rescued — keep the sync result
  const tail = healed.slice(cursor);
  if (tail) parts.push({ kind: "md", text: tail });
  return parts.filter((p) => p.kind === "canvas" || p.text.length > 0);
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
  //
  // CRITICAL (2026-10-05): withhold ONLY when the tail fence is genuinely
  // UNTERMINATED. OPEN_FENCE_RE matches the first opener and captures to end of
  // string regardless of whether a closer follows, so the old unconditional
  // slice deleted a CLOSED card plus every word of prose after it, for the whole
  // duration of the stream. Measured: "intro\n```astra-canvas\n{...}\n```\nAFTER"
  // -> mdPerSeg ["intro\n"] and canvases [] — card AND prose both gone.
  if (streaming) {
    for (let i = texts.length - 1; i >= 0; i--) {
      if (!mdPerSeg[i].includes("```astra-canvas")) continue;
      const open = OPEN_FENCE_RE.exec(mdPerSeg[i]);
      // A closed fence is already a card (spanning) or inline for RichText
      // (contained); cutting it deletes both it and the prose after it.
      if (open && !/`{3,}/.test(open[1])) mdPerSeg[i] = mdPerSeg[i].slice(0, open.index);
      break;
    }
  }

  return { mdPerSeg, canvases };
}

void BLOCK_TYPES;
