// Canvas sanitization — clean LLM output before rendering.
//
// The LLM emits canvas JSON that can contain:
// - Unknown block types (hallucinated or renamed)
// - Invalid enum values (tone: "warning" instead of "warn")
// - Missing required fields (kpi without label)
// - Unsupported properties (extra keys that break rendering)
// - Overly long strings (content that overflows)
// - Malformed structures (arrays where objects expected)
//
// This module sanitizes the spec so the renderer always gets valid input.
// Called in CanvasHost before passing to CanvasView.
import type { CanvasSpec, CanvasBlock } from "./canvas-schema";

// Known block types (must match canvas-schema.ts BLOCK_TYPES)
const KNOWN_TYPES = new Set([
  "kpi", "chart", "table", "diagram", "checklist", "steps", "callout",
  "progress", "timeline", "compare", "tree", "code", "references",
  "quote", "keyvalue", "diff", "heatmap", "tabs",
  "accordion", "terminal", "badges", "divider",
  "spreadsheet", "slides", "document", "text",
  "slider", "select", "multiselect", "segmented", "toggle", "search", "data",
  "graph", "image", "gallery", "video", "layout", "math", "gitgraph",
]);

// Valid enum values
const VALID_TONES = new Set(["info", "warn", "success", "danger"]);
const VALID_TRENDS = new Set(["up", "down", "flat"]);
const VALID_STATUSES = new Set(["done", "open", "fail", "active", "todo"]);
const VALID_CHART_KINDS = new Set([
  "line", "area", "bar", "radial", "pie", "donut", "stack",
  "sankey", "treemap", "funnel", "radar", "scatter", "box", "histogram",
  "errorbar", "candlestick", "waterfall", "violin"
]);

// `table.stats.compute` — the same closed set the parser uses, so a footer the
// sanitizer keeps is a footer the renderer can actually compute.
const VALID_TABLE_STATS = new Set(["mean", "median", "sd", "min", "max", "p95", "count"]);

// Layout composite modes. An unknown mode degrades to "stack" (always correct),
// never drops the container — the children are the content, not the frame.
const VALID_LAYOUTS = new Set(["stack", "bento", "split", "masonry", "grid"]);

// gitgraph caps. The PARSER caps commits at 40 (canvas-schema.ts `MAX_GIT_ROWS`),
// so this repeats the same ceiling rather than inventing one — the two layers
// agreeing on the cap is what makes "which layer dropped it" answerable.
const MAX_GIT_COMMITS = 40;
const MAX_GIT_BRANCHES = 12;

// Maximum string lengths (prevent overflow)
const MAX_STRING = 10000;
const MAX_TITLE = 500;
const MAX_BLOCKS = 100;
const MAX_ITEMS = 50;

/** Truncate a string to max length with ellipsis. */
function truncate(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

/** Sanitize a value: strings truncated, numbers clamped, booleans preserved. */
function sanitizeValue(v: unknown, max: number = MAX_STRING): unknown {
  if (typeof v === "string") return truncate(v, max);
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.slice(0, MAX_ITEMS).map((x) => sanitizeValue(x, max));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = sanitizeValue(val, max);
    }
    return out;
  }
  return null;
}

/**
 * Reactive keys carried through the sanitizer (2026-10-05). These are the
 * fields the v5 milestone depends on; dropping them made every interactive
 * card inert. `bind` is the control's state key, `value`/`delta`/`spark`/
 * `format`/`points`/`from`/`unit` may each hold a `{$expr}` or literal.
 */
const REACTIVE_KEYS = [
  "bind", "value", "delta", "spark", "points", "from",
  "format", "unit", "default", "name", "options",
] as const;

/**
 * Carry one authored field through the sanitizer.
 *
 * - a BINDING object (has `$expr` / `$from` / `path`) is kept AS A BINDING —
 *   this is the whole point of the fix. Only its string/number leaves are
 *   capped, so a hostile `{$expr:"<10KB>"}` still cannot bloat the card.
 * - any other value falls through to the existing `sanitizeValue` caps, so a
 *   plain value keeps exactly the behaviour it had before.
 *
 * Returns `undefined` for an object that is NOT a known binding shape, so the
 * caller can leave the key absent rather than writing a bogus field.
 */
function carryBinding(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const isBinding = "$expr" in o || "$from" in o || typeof o.path === "string";
    if (isBinding) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(o)) {
        if (typeof val === "string") out[k] = truncate(val, MAX_STRING);
        else if (typeof val === "number") out[k] = Number.isFinite(val) ? val : 0;
        else if (typeof val === "boolean") out[k] = val;
        else if (Array.isArray(val)) out[k] = val.slice(0, MAX_ITEMS).map((x) => sanitizeValue(x));
        else if (val && typeof val === "object") {
          // nested filter/sort clauses — cap depth and key count
          const n: Record<string, unknown> = {};
          let nKeys = 0;
          for (const [k2, v2] of Object.entries(val as Record<string, unknown>)) {
            if (nKeys++ >= MAX_ITEMS) break;
            n[k2] = sanitizeValue(v2);
          }
          out[k] = n;
        } else out[k] = sanitizeValue(val);
      }
      return out;
    }
    return undefined;
  }
  return sanitizeValue(v);
}

/** How deep container blocks (tabs / accordion) may nest. The PARSER does not
 *  cap depth, so an agent-authored card can nest arbitrarily; without a cap here
 *  the recursive descent below (and the renderer's own recursion through
 *  `Blocks`) is a stack-overflow crash on a card that parsed fine. */
const MAX_NEST_DEPTH = 6;

/**
 * Sanitize a NESTED block list (the `blocks` of a tab / accordion item).
 *
 * These are the very same blocks the card dispatcher renders, so they must be
 * sanitized by the very same function — a nested block is not a lesser citizen
 * and must not be a way around the caps, the enum normalisation or the
 * binding carry-over. Returns `undefined` when nothing usable is left, which is
 * the caller's signal to degrade that item to its own body text.
 */
function sanitizeBlockList(v: unknown, depth: number): CanvasBlock[] | undefined {
  if (!Array.isArray(v) || depth > MAX_NEST_DEPTH) return undefined;
  const out: CanvasBlock[] = [];
  for (const b of v) {
    const s = sanitizeBlock(b, depth);
    if (s) out.push(s);
    if (out.length >= MAX_BLOCKS) break;
  }
  return out.length > 0 ? out : undefined;
}

/** Sanitize a single block. Returns null if block is invalid. */
export function sanitizeBlock(b: unknown, depth = 0): CanvasBlock | null {
  if (!b || typeof b !== "object") return null;
  const obj = b as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== "string" || !KNOWN_TYPES.has(type)) return null;

  // Required fields per type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sanitized: any = { type };

  // Common optional fields
  if (typeof obj.title === "string") sanitized.title = truncate(obj.title, MAX_TITLE);
  if (typeof obj.filename === "string") sanitized.filename = truncate(obj.filename, 200);

  // Type-specific validation
  switch (type) {
    case "kpi": {
      if (typeof obj.label !== "string" || !obj.label.trim()) return null;
      sanitized.label = truncate(obj.label, 200);
      const val = obj.value;
      if (typeof val === "string" || typeof val === "number") {
        sanitized.value = typeof val === "string" ? truncate(val, 100) : val;
      }
      if (typeof obj.delta === "string") sanitized.delta = truncate(obj.delta, 50);
      if (typeof obj.trend === "string" && VALID_TRENDS.has(obj.trend)) {
        sanitized.trend = obj.trend;
      }
      if (Array.isArray(obj.spark)) {
        sanitized.spark = obj.spark
          .filter((x: unknown) => typeof x === "number")
          .slice(0, 24);
      }
      break;
    }
    case "chart": {
      if (typeof obj.chart === "string" && VALID_CHART_KINDS.has(obj.chart)) {
        sanitized.chart = obj.chart;
      } else {
        return null; // chart without valid kind is useless
      }
      if (typeof obj.title === "string") sanitized.title = truncate(obj.title, MAX_TITLE);
      if (Array.isArray(obj.labels)) {
        sanitized.labels = obj.labels
          .map((x: unknown) => String(x))
          .slice(0, 100);
      }
      if (Array.isArray(obj.series)) {
        sanitized.series = obj.series
          .map((s: unknown) => {
            if (!s || typeof s !== "object") return null;
            const so = s as Record<string, unknown>;
            const name = typeof so.name === "string" ? truncate(so.name, 100) : "";
            // Canonical parser shape is `points` (canvas-schema ChartBlock); older
            // authors used `data`. Reading only `data` zeroed every bar: series
            // arrived as {name, points:[…]}, mapped to {name, data:[]}, and
            // recharts rendered empty bars ("chart shows no data"). Accept both.
            const rawPoints = Array.isArray(so.points) ? so.points : Array.isArray(so.data) ? so.data : [];
            const data = rawPoints
                  .map((d: unknown) => {
                    if (typeof d === "number") return d;
                    if (d && typeof d === "object") {
                      const dObj = d as Record<string, unknown>;
                      if (typeof dObj.y === "number") return dObj.y;
                      if (typeof dObj.value === "number") return dObj.value;
                    }
                    return null;
                  })
                  .filter((x: unknown): x is number => x !== null)
                  .slice(0, 200);
            const out: Record<string, unknown> = { name, data };
            // The RENDERER (canvas-chart.tsx) reads series[i].points for literal
            // arrays, not .data — keep `points` on the sanitized series whenever
            // the source carried it as an array, or the chart draws all-zero bars.
            // For scatter/candlestick pairs/ohlc, keep the raw array instead of the filtered scalar data.
            if (Array.isArray(so.points)) {
              out.points = (obj.chart === "scatter" || obj.chart === "candlestick") ? so.points : data;
            }
            // Preserve binding/scatter extras the renderer reads.
            else if (so.points != null) out.points = so.points;
            if (so.error) out.error = so.error;
            if (so.ohlc) out.ohlc = so.ohlc;
            if (so.waterfallKinds) out.waterfallKinds = so.waterfallKinds;
            if (Array.isArray(so.items)) out.items = so.items;
            if (Array.isArray(so.links)) out.links = so.links;
            if (so.visible !== undefined) out.visible = so.visible;
            return out;
          })
          .filter((s: unknown): s is { name: string; data: number[] } => s !== null)
          .slice(0, 10);
      }
      if (obj.refline) sanitized.refline = obj.refline;
      if (obj.scale === "log") sanitized.scale = "log";
      if (typeof obj.p === "number") sanitized.p = obj.p;
      break;
    }
    case "table": {
      // BUG (pre-existing, found 2026-10-05 while adding table.stats): this case
      // required BOTH `columns` and `rows` to be arrays, so a REACTIVE table —
      // `{bind:{"$from":"name"}, rows:[]}` — was dropped from the card entirely.
      // The parser has always accepted it (canvas-schema.ts returns early for
      // `bind.$from` precisely because the rows are NOT in the block yet), and
      // reactiveRows() in canvas-blocks resolves the carrier at render time, so a
      // what-if table worked in every unit gate and rendered as nothing in
      // production. Same bug class as tabs/accordion/tree/detail: the sanitizer is
      // the only call on the render path, and it is the only layer that drops it.
      //
      // So: accept the block when it is a reactive one (columns present, bind is a
      // $from binding) even with no rows, and carry the binding through REACTIVE_KEYS
      // below as every other block does.
      const bound = !!(obj.bind && typeof obj.bind === "object" && !Array.isArray(obj.bind)
        && typeof (obj.bind as Record<string, unknown>).$from === "string");
      if (!Array.isArray(obj.columns)) return null;
      if (!Array.isArray(obj.rows) && !bound) return null;
      sanitized.columns = obj.columns
        .map((c: unknown) => String(c))
        .slice(0, 20);
      sanitized.rows = (Array.isArray(obj.rows) ? obj.rows : [])
        .map((r: unknown) => {
          if (!Array.isArray(r)) return null;
          return r.map((c: unknown) => {
            if (typeof c === "string") return truncate(c, 500);
            if (typeof c === "number") return c;
            return String(c ?? "");
          }).slice(0, 20);
        })
        .filter((r: unknown): r is string[] => r !== null)
        .slice(0, MAX_ITEMS);
      // A header with no body is still the "table looks mangled" defect — UNLESS the
      // rows are coming from a `data` carrier at render time, in which case empty is
      // exactly what the block should carry. The renderer prints its own "no rows"
      // state if the carrier turns out to be empty, so the honest message wins.
      if (sanitized.rows.length === 0 && !bound) return null;
      if (Array.isArray(obj.colTypes)) {
        sanitized.colTypes = obj.colTypes
          .filter(t => typeof t === "string")
          .map(t => ["color", "contrast", "bar", "delta", "status"].includes(t as string) ? t : "text");
      }
      if (Array.isArray(obj.colMeta)) {
        sanitized.colMeta = obj.colMeta.map(m => {
          if (m && typeof m === "object" && Array.isArray((m as any).levels)) {
            return { levels: (m as any).levels.filter((l: any) => typeof l === "string") };
          }
          return null;
        });
      }
      if (typeof obj.footnote === "string") sanitized.footnote = truncate(obj.footnote, 500);
      if (Array.isArray(obj.units)) {
        sanitized.units = obj.units.filter(u => typeof u === "string").map(u => truncate(u as string, 50));
      }
      if (obj.sig && typeof obj.sig === "object" && typeof (obj.sig as any).column === "string") {
        const s: any = { column: truncate((obj.sig as any).column, 100) };
        if (Array.isArray((obj.sig as any).thresholds)) s.thresholds = (obj.sig as any).thresholds.filter((n: any) => typeof n === "number");
        sanitized.sig = s;
      }
      // `stats` is a REQUEST for the renderer to compute, not data. It has to be
      // carried through or the footer never appears — the same drop-the-key class
      // as `detail` on a tree node (8d09c60) and `blocks` on an accordion item.
      // A bad request is dropped here exactly as the parser drops it, so both
      // layers agree on what "asked for stats" means — including `stats:true`,
      // which both normalise to `{}` (the default footer).
      if (obj.stats === true) {
        sanitized.stats = {};
      } else if (obj.stats && typeof obj.stats === "object" && !Array.isArray(obj.stats)) {
        const so = obj.stats as Record<string, unknown>;
        const st: Record<string, unknown> = {};
        if (Array.isArray(so.columns)) {
          const cols = so.columns.filter((c: unknown): c is string => typeof c === "string").map((c) => truncate(c, 60));
          if (cols.length > 0) st.columns = [...new Set(cols)].slice(0, 20);
        }
        if (Array.isArray(so.compute)) {
          const compute = so.compute
            .filter((c: unknown): c is string => typeof c === "string")
            .map((c) => truncate(c.trim().toLowerCase(), 30))
            .filter((c) => VALID_TABLE_STATS.has(c));
          if (compute.length > 0) st.compute = [...new Set(compute)];
        }
        sanitized.stats = st;
      }
      break;
    }
    case "callout": {
      if (typeof obj.tone === "string" && VALID_TONES.has(obj.tone)) {
        sanitized.tone = obj.tone;
      } else {
        sanitized.tone = "info";
      }
      if (typeof obj.title === "string") sanitized.title = truncate(obj.title, MAX_TITLE);
      if (typeof obj.body === "string") sanitized.body = truncate(obj.body, MAX_STRING);
      break;
    }
    case "checklist": {
      if (!Array.isArray(obj.items)) return null;
      sanitized.items = obj.items
        .map((item: unknown) => {
          if (!item || typeof item !== "object") return null;
          const io = item as Record<string, unknown>;
          const text = typeof io.text === "string" ? truncate(io.text, 500) : "";
          if (!text) return null;
          const status = typeof io.status === "string" && VALID_STATUSES.has(io.status)
            ? io.status
            : "open";
          return { text, status };
        })
        .filter((x: unknown): x is { text: string; status: string } => x !== null)
        .slice(0, MAX_ITEMS);
      if (sanitized.items.length === 0) return null;
      break;
    }
    case "steps": {
      if (!Array.isArray(obj.items)) return null;
      sanitized.items = obj.items
        .map((item: unknown) => {
          if (!item || typeof item !== "object") return null;
          const io = item as Record<string, unknown>;
          const title = typeof io.title === "string" ? truncate(io.title, 200) : "";
          if (!title) return null;
          const detail = typeof io.detail === "string" ? truncate(io.detail, 500) : undefined;
          const status = typeof io.status === "string" && VALID_STATUSES.has(io.status)
            ? io.status
            : "todo";
          return { title, detail, status };
        })
        .filter((x: unknown): x is { title: string; detail?: string; status: string } => x !== null)
        .slice(0, MAX_ITEMS);
      if (sanitized.items.length === 0) return null;
      break;
    }
    case "badges": {
      if (!Array.isArray(obj.items)) return null;
      sanitized.items = obj.items
        .map((item: unknown) => {
          if (!item || typeof item !== "object") return null;
          const io = item as Record<string, unknown>;
          const label = typeof io.label === "string" ? truncate(io.label, 100) : "";
          if (!label) return null;
          const tone = typeof io.tone === "string" && VALID_TONES.has(io.tone)
            ? io.tone
            : "info";
          return { label, tone };
        })
        .filter((x: unknown): x is { label: string; tone: string } => x !== null)
        .slice(0, 20);
      if (sanitized.items.length === 0) return null;
      break;
    }
    case "progress": {
      if (typeof obj.label !== "string" || !obj.label.trim()) return null;
      sanitized.label = truncate(obj.label, 200);
      const value = typeof obj.value === "number" ? Math.max(0, Math.min(100, obj.value)) : 0;
      sanitized.value = value;
      if (typeof obj.max === "number" && obj.max > 0) sanitized.max = obj.max;
      if (typeof obj.unit === "string") sanitized.unit = truncate(obj.unit, 20);
      break;
    }
    case "timeline": {
      if (!Array.isArray(obj.items)) return null;
      sanitized.items = obj.items
        .map((item: unknown) => {
          if (!item || typeof item !== "object") return null;
          const io = item as Record<string, unknown>;
          const title = typeof io.title === "string" ? truncate(io.title, 200) : "";
          if (!title) return null;
          const detail = typeof io.detail === "string" ? truncate(io.detail, 500) : undefined;
          const time = typeof io.time === "string" ? truncate(io.time, 50) : undefined;
          const status = typeof io.status === "string" && VALID_STATUSES.has(io.status)
            ? io.status
            : "todo";
          return { title, detail, time, status };
        })
        .filter((x: unknown): x is { title: string; detail?: string; time?: string; status: string } => x !== null)
        .slice(0, MAX_ITEMS);
      if (sanitized.items.length === 0) return null;
      break;
    }
    case "keyvalue": {
      if (!Array.isArray(obj.items)) return null;
      sanitized.items = obj.items
        .map((item: unknown) => {
          if (!item || typeof item !== "object") return null;
          const io = item as Record<string, unknown>;
          const key = typeof io.key === "string" ? truncate(io.key, 100) : "";
          const value = typeof io.value === "string" ? truncate(io.value, 500) : "";
          if (!key) return null;
          return { key, value };
        })
        .filter((x: unknown): x is { key: string; value: string } => x !== null)
        .slice(0, MAX_ITEMS);
      if (sanitized.items.length === 0) return null;
      break;
    }
    case "code": {
      if (typeof obj.code !== "string") return null;
      sanitized.code = truncate(obj.code, MAX_STRING);
      if (typeof obj.language === "string") sanitized.language = truncate(obj.language, 20);
      if (typeof obj.filename === "string") sanitized.filename = truncate(obj.filename, 200);
      // `highlight:false` opts a block out of the lazy syntax highlighter; the
      // block then always renders the bare <pre>. Unknown keys are dropped, so
      // this cannot become a way to smuggle data through.
      if (obj.highlight === false) sanitized.highlight = false;
      break;
    }
    case "references": {
      if (!Array.isArray(obj.items)) return null;
      sanitized.items = obj.items
        .map((item: unknown) => {
          if (!item || typeof item !== "object") return null;
          const io = item as Record<string, unknown>;
          const title = typeof io.title === "string" ? truncate(io.title, 200) : "";
          if (!title) return null;
          const href = typeof io.href === "string" ? truncate(io.href, 500) : undefined;
          const note = typeof io.note === "string" ? truncate(io.note, 500) : undefined;
          return { title, href, note, cite: io.cite };
        })
        .filter((x: unknown): x is { title: string; href?: string; note?: string } => x !== null)
        .slice(0, MAX_ITEMS);
      if (sanitized.items.length === 0) return null;
      break;
    }
    case "quote": {
      if (typeof obj.text !== "string" || !obj.text.trim()) return null;
      sanitized.text = truncate(obj.text, MAX_STRING);
      if (typeof obj.attribution === "string") sanitized.attribution = truncate(obj.attribution, 200);
      break;
    }
    case "image": {
      if (typeof obj.src !== "string" || !obj.src.trim()) return null;
      sanitized.src = truncate(obj.src, 500);
      if (typeof obj.alt === "string") sanitized.alt = truncate(obj.alt, 200);
      if (typeof obj.caption === "string") sanitized.caption = truncate(obj.caption, 500);
      break;
    }
    case "gallery": {
      if (!Array.isArray(obj.items)) return null;
      sanitized.items = obj.items
        .map((item: unknown) => {
          if (!item || typeof item !== "object") return null;
          const io = item as Record<string, unknown>;
          const src = typeof io.src === "string" ? truncate(io.src, 500) : "";
          if (!src) return null;
          const alt = typeof io.alt === "string" ? truncate(io.alt, 200) : undefined;
          const caption = typeof io.caption === "string" ? truncate(io.caption, 500) : undefined;
          return { src, alt, caption };
        })
        .filter((x: unknown): x is { src: string; alt?: string; caption?: string } => x !== null)
        .slice(0, 12);
      if (sanitized.items.length === 0) return null;
      break;
    }
    case "video": {
      if (typeof obj.src !== "string" || !obj.src.trim()) return null;
      sanitized.src = truncate(obj.src, 500);
      if (typeof obj.caption === "string") sanitized.caption = truncate(obj.caption, 500);
      break;
    }
    case "spreadsheet": {
      if (!Array.isArray(obj.rows)) return null;
      sanitized.rows = obj.rows
        .map((r: unknown) => {
          if (!Array.isArray(r)) return null;
          return r.map((c: unknown) => {
            if (typeof c === "string") return truncate(c, 500);
            if (typeof c === "number") return c;
            return String(c ?? "");
          }).slice(0, 50);
        })
        .filter((r: unknown): r is (string | number)[] => r !== null)
        .slice(0, 500);
      if (sanitized.rows.length === 0) return null;
      if (Array.isArray(obj.columns)) {
        sanitized.columns = obj.columns.map((c: unknown) => String(c)).slice(0, 50);
      }
      if (typeof obj.header === "boolean") sanitized.header = obj.header;
      break;
    }
    case "slides": {
      if (!Array.isArray(obj.slides)) return null;
      sanitized.slides = obj.slides
        .map((s: unknown) => {
          if (!s || typeof s !== "object") return null;
          const so = s as Record<string, unknown>;
          const heading = typeof so.heading === "string" ? truncate(so.heading, 200) : "";
          if (!heading) return null;
          const bullets = Array.isArray(so.bullets)
            ? so.bullets
                .map((b: unknown) => typeof b === "string" ? truncate(b, 500) : "")
                .filter((b: string) => b)
                .slice(0, 20)
            : undefined;
          const note = typeof so.note === "string" ? truncate(so.note, 500) : undefined;
          return { heading, bullets, note };
        })
        .filter((x: unknown): x is { heading: string; bullets?: string[]; note?: string } => x !== null)
        .slice(0, 100);
      if (sanitized.slides.length === 0) return null;
      break;
    }
    case "document": {
      if (!Array.isArray(obj.content)) return null;
      sanitized.content = obj.content
        .map((c: unknown) => {
          if (!c || typeof c !== "object") return null;
          const co = c as Record<string, unknown>;
          const text = typeof co.text === "string" ? truncate(co.text, MAX_STRING) : "";
          if (!text) return null;
          const kind = typeof co.kind === "string" ? co.kind : "p";
          return { text, kind };
        })
        .filter((x: unknown): x is { text: string; kind: string } => x !== null)
        .slice(0, 100);
      if (sanitized.content.length === 0) return null;
      break;
    }
    case "text": {
      if (typeof obj.content !== "string") return null;
      sanitized.content = truncate(obj.content, MAX_STRING);
      if (typeof obj.language === "string") sanitized.language = truncate(obj.language, 20);
      break;
    }
    case "divider": {
      if (typeof obj.label === "string") sanitized.label = truncate(obj.label, 100);
      break;
    }
    case "slider": {
      if (typeof obj.label !== "string" || !obj.label.trim()) return null;
      sanitized.label = truncate(obj.label, 200);
      if (typeof obj.bind === "string") sanitized.bind = truncate(obj.bind, 50);
      if (typeof obj.min === "number") sanitized.min = obj.min;
      if (typeof obj.max === "number") sanitized.max = obj.max;
      if (typeof obj.step === "number" && obj.step > 0) sanitized.step = obj.step;
      if (typeof obj.value === "number") sanitized.value = obj.value;
      break;
    }
    case "select":
    case "multiselect":
    case "segmented":
    case "toggle":
    case "search": {
      if (typeof obj.label !== "string" || !obj.label.trim()) return null;
      sanitized.label = truncate(obj.label, 200);
      if (typeof obj.bind === "string") sanitized.bind = truncate(obj.bind, 50);
      if (Array.isArray(obj.options)) {
        sanitized.options = obj.options
          .map((o: unknown) => {
            if (typeof o === "string") return { label: truncate(o, 100), value: truncate(o, 100) };
            if (o && typeof o === "object") {
              const oo = o as Record<string, unknown>;
              const label = typeof oo.label === "string" ? truncate(oo.label, 100) : "";
              const value = typeof oo.value === "string" ? truncate(oo.value, 100) : label;
              return { label, value };
            }
            return null;
          })
          .filter((x: unknown): x is { label: string; value: string } => x !== null)
          .slice(0, 20);
      }
      break;
    }
    case "data": {
      // Data blocks are carriers — pass through with sanitized content
      if (Array.isArray(obj.rows)) {
        sanitized.rows = obj.rows
          .map((r: unknown) => {
            if (!Array.isArray(r)) return null;
            return r.map((c: unknown) => {
              if (typeof c === "string") return truncate(c, 500);
              if (typeof c === "number") return c;
              return String(c ?? "");
            }).slice(0, 50);
          })
          .filter((r: unknown): r is (string | number)[] => r !== null)
          .slice(0, 500);
      }
      if (Array.isArray(obj.columns)) {
        sanitized.columns = obj.columns.map((c: unknown) => String(c)).slice(0, 50);
      }
      break;
    }
    case "graph": {
      if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) return null;
      sanitized.nodes = obj.nodes
        .map((n: unknown) => {
          if (!n || typeof n !== "object") return null;
          const no = n as Record<string, unknown>;
          const id = typeof no.id === "string" ? truncate(no.id, 50) : "";
          if (!id) return null;
          const label = typeof no.label === "string" ? truncate(no.label, 200) : id;
          return { id, label };
        })
        .filter((x: unknown): x is { id: string; label: string } => x !== null)
        .slice(0, 100);
      sanitized.edges = obj.edges
        .map((e: unknown) => {
          if (!e || typeof e !== "object") return null;
          const eo = e as Record<string, unknown>;
          const source = typeof eo.source === "string" ? truncate(eo.source, 50) : "";
          const target = typeof eo.target === "string" ? truncate(eo.target, 50) : "";
          if (!source || !target) return null;
          return { source, target };
        })
        .filter((x: unknown): x is { source: string; target: string } => x !== null)
        .slice(0, 200);
      if (sanitized.nodes.length === 0) return null;
      break;
    }
    case "diagram": {
      if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) return null;
      // The sanitizer REBUILDS each node/edge from a literal field list, so any
      // key it does not name here is DROPPED on the render path — the diagram
      // arrives at the renderer stripped. That is how `kind` (the legend and the
      // dim-on-filter behaviour) used to disappear. ER fields, symbols and
      // cardinality are carried for the same reason.
      const SHAPES = new Set(["box", "entity", "store", "note"]);
      const SYMBOLS = new Set(["resistor", "capacitor", "inductor", "diode", "ground", "battery", "opamp", "led"]);
      const CARDS = new Set(["1", "0..1", "1..*", "0..*"]);
      sanitized.nodes = obj.nodes
        .map((n: unknown) => {
          if (!n || typeof n !== "object") return null;
          const no = n as Record<string, unknown>;
          const id = typeof no.id === "string" ? truncate(no.id, 50) : "";
          if (!id) return null;
          const label = typeof no.label === "string" ? truncate(no.label, 200) : id;
          const out: Record<string, unknown> = { id, label };
          if (typeof no.detail === "string") out.detail = truncate(no.detail, 400);
          if (typeof no.kind === "string") out.kind = truncate(no.kind, 40);
          if (typeof no.note === "string") out.note = truncate(no.note, 400);
          if (typeof no.shape === "string" && SHAPES.has(no.shape)) out.shape = no.shape;
          if (typeof no.symbol === "string" && SYMBOLS.has(no.symbol)) out.symbol = no.symbol;
          if (Array.isArray(no.fields)) {
            const rows: Record<string, unknown>[] = [];
            for (const f of no.fields) {
              if (!f || typeof f !== "object") continue;
              const fo = f as Record<string, unknown>;
              if (typeof fo.name !== "string" || !fo.name.trim()) continue;
              const row: Record<string, unknown> = { name: truncate(fo.name, 80) };
              if (typeof fo.type === "string") row.type = truncate(fo.type, 40);
              if (fo.pk === true) row.pk = true;
              if (fo.fk === true) row.fk = true;
              if (fo.nullable === true) row.nullable = true;
              rows.push(row);
              if (rows.length >= 24) break;
            }
            if (rows.length > 0) out.fields = rows;
          }
          return out;
        })
        .filter((x: unknown): x is Record<string, unknown> => x !== null)
        .slice(0, 100);
      sanitized.edges = obj.edges
        .map((e: unknown) => {
          if (!e || typeof e !== "object") return null;
          const eo = e as Record<string, unknown>;
          const from = typeof eo.from === "string" ? truncate(eo.from, 50) : "";
          const to = typeof eo.to === "string" ? truncate(eo.to, 50) : "";
          if (!from || !to) return null;
          const out: Record<string, unknown> = { from, to };
          if (typeof eo.label === "string") out.label = truncate(eo.label, 200);
          if (typeof eo.note === "string") out.note = truncate(eo.note, 400);
          if (typeof eo.cardinality === "string" && CARDS.has(eo.cardinality)) out.cardinality = eo.cardinality;
          return out;
        })
        .filter((x: unknown): x is Record<string, unknown> => x !== null)
        .slice(0, 200);
      if (sanitized.nodes.length === 0) return null;
      if (typeof obj.layout === "string" && (obj.layout === "flow" || obj.layout === "relationship")) sanitized.layout = obj.layout;
      if (obj.route === "smooth" || obj.route === "orthogonal") sanitized.route = obj.route;
      if (typeof obj.direction === "string" && obj.direction === "lr") sanitized.direction = "lr";
      if (typeof obj.summary === "string") sanitized.summary = truncate(obj.summary, 400);
      if (typeof obj.caption === "string") sanitized.caption = truncate(obj.caption, 400);
      break;
    }
    case "heatmap": {
      if (!Array.isArray(obj.rows) || !Array.isArray(obj.cols) || !Array.isArray(obj.values)) {
        return null;
      }
      sanitized.rows = obj.rows.map((r: unknown) => String(r)).slice(0, 50);
      sanitized.cols = obj.cols.map((c: unknown) => String(c)).slice(0, 50);
      sanitized.values = obj.values
        .map((row: unknown) => {
          if (!Array.isArray(row)) return null;
          return row.map((v: unknown) => {
            if (typeof v === "number") return Math.max(0, Math.min(1, v));
            return 0;
          }).slice(0, 50);
        })
        .filter((r: unknown): r is number[] => r !== null)
        .slice(0, 50);
      if (sanitized.values.length === 0) return null;
      break;
    }
    case "compare": {
      if (!Array.isArray(obj.items)) return null;
      sanitized.items = obj.items
        .map((item: unknown) => {
          if (!item || typeof item !== "object") return null;
          const io = item as Record<string, unknown>;
          const name = typeof io.name === "string" ? truncate(io.name, 200) : "";
          if (!name) return null;
          const points = Array.isArray(io.points)
            ? io.points
                .map((p: unknown) => {
                  if (!p || typeof p !== "object") return null;
                  const po = p as Record<string, unknown>;
                  const text = typeof po.text === "string" ? truncate(po.text, 500) : "";
                  if (!text) return null;
                  const tone = typeof po.tone === "string" && VALID_TONES.has(po.tone)
                    ? po.tone
                    : "info";
                  return { text, tone };
                })
                .filter((x: unknown): x is { text: string; tone: string } => x !== null)
                .slice(0, 10)
            : undefined;
          return { name, points };
        })
        .filter((x: unknown): x is { name: string; points?: { text: string; tone: string }[] } => x !== null)
        .slice(0, 10);
      if (sanitized.items.length === 0) return null;
      break;
    }
    case "tree": {
      // BUG (fixed 2026-10-05, "the file tree shows no hierarchy"): this case
      // rebuilt every node as {id,label} and DROPPED `detail` and `children`.
      // canvas-schema.ts validated both and TreeView rendered both, so the parser
      // and the renderer were both already correct — but sanitizeCanvasSpec is the
      // ONE call on the render path (chat-timeline.tsx:70), so every tree reached
      // the renderer as a FLAT list of top-level rows: `detail` gone and the whole
      // nesting flattened, because `children` was the only thing that expressed it.
      // Same bug class as tabs (b1ec4e9) and accordion: the sanitizer silently
      // discards what the other two layers carry.
      if (!Array.isArray(obj.nodes)) return null;
      const nodes: Record<string, unknown>[] = [];
      const ids = new Set<string>();
      for (const n of obj.nodes) {
        if (nodes.length >= 1200) break;
        if (!n || typeof n !== "object") continue;
        const no = n as Record<string, unknown>;
        const id = typeof no.id === "string" ? truncate(no.id, 50) : "";
        if (!id || ids.has(id)) continue;
        ids.add(id);
        const out: Record<string, unknown> = { id, label: typeof no.label === "string" ? truncate(no.label, 200) : id };
        if (typeof no.detail === "string") out.detail = truncate(no.detail, 500);
        // children are IDs: only strings, only ones that survive the same cap.
        if (Array.isArray(no.children)) {
          const kids = no.children
            .filter((c: unknown): c is string => typeof c === "string")
            .slice(0, MAX_ITEMS)
            .map((c: string) => truncate(c, 50));
          if (kids.length > 0) out.children = kids;
        }
        nodes.push(out);
      }
      if (nodes.length === 0) return null;
      sanitized.nodes = nodes;
      break;
    }
    case "terminal": {
      if (typeof obj.command !== "string") return null;
      sanitized.command = truncate(obj.command, 500);
      if (obj.highlight === false) sanitized.highlight = false;
      if (Array.isArray(obj.lines)) {
        sanitized.lines = obj.lines
          .map((l: unknown) => {
            if (typeof l === "string") return { text: truncate(l, 500) };
            if (l && typeof l === "object") {
              const lo = l as Record<string, unknown>;
              const text = typeof lo.text === "string" ? truncate(lo.text, 500) : "";
              return { text };
            }
            return null;
          })
          .filter((x: unknown): x is { text: string } => x !== null)
          .slice(0, 50);
      }
      break;
    }
    case "accordion": {
      if (!Array.isArray(obj.items)) return null;
      // Items nest OTHER BLOCKS (docs: `{title, body?, blocks?, open?}`), so they
      // are sanitized with the same per-block validator as a top-level card.
      //
      // BUG (2026-10-05, "accordion dropdown renders with NO content"): this case
      // used to rebuild each item as `{ title, body }` only. The parser preserved
      // `blocks` and `AccordionView` rendered them, but sanitizeCanvasSpec — the
      // ONE call on the render path (chat-timeline.tsx:70) — threw the blocks away
      // on the way to the renderer. An item whose only content was nested blocks
      // therefore arrived as a title with `body: undefined`, i.e. an empty
      // dropdown. Same rebuild also discarded `open`, so an explicitly-opened item
      // lost its state. Proved: sanitizer is the only drop; parser and renderer
      // were both already correct.
      const items: Record<string, unknown>[] = [];
      for (const item of obj.items) {
        if (!item || typeof item !== "object") continue;
        const io = item as Record<string, unknown>;
        const title = typeof io.title === "string" ? truncate(io.title, 200) : "";
        if (!title) continue;
        const body = typeof io.body === "string" ? truncate(io.body, MAX_STRING) : undefined;
        const blocks = sanitizeBlockList(io.blocks, depth + 1);
        // Fail-soft per ITEM: an item that has nothing to reveal is not a
        // disclosure at all, so drop it rather than render a dead header. This
        // never reaches the card as a whole — the other items survive.
        if (body === undefined && blocks === undefined) continue;
        const out: Record<string, unknown> = { title };
        if (body !== undefined) out.body = body;
        if (blocks !== undefined) out.blocks = blocks;
        if (io.open === true) out.open = true;
        items.push(out);
        if (items.length >= 20) break;
      }
      if (items.length === 0) return null;
      sanitized.items = items;
      break;
    }
    case "tabs": {
      // Same class of bug, same fix: `tabs` items nest blocks too, and this case
      // was absent entirely, so EVERY tabs card fell through to `default: return
      // null` and vanished from the card. Nested blocks are sanitized the same
      // way, so a chart inside a tab keeps its lazy-load dispatch and its caps.
      if (!Array.isArray(obj.items)) return null;
      const items: Record<string, unknown>[] = [];
      for (const item of obj.items) {
        if (!item || typeof item !== "object") continue;
        const io = item as Record<string, unknown>;
        const label = typeof io.label === "string" ? truncate(io.label, 200) : "";
        if (!label) continue;
        const blocks = sanitizeBlockList(io.blocks, depth + 1);
        if (blocks === undefined) continue; // a tab with nothing to show is not a tab
        items.push({ label, blocks });
        if (items.length >= 20) break;
      }
      if (items.length === 0) return null;
      sanitized.items = items;
      break;
    }
    case "layout": {
      // Composite container: children are BLOCKS, sanitized by the same
      // per-block validator at the same MAX_NEST_DEPTH as tabs/accordion — a
      // nested block is not a lesser citizen and must not route around the caps.
      // Without this case the block falls through to `default: return null` and
      // vanishes from the card — the exact bug class that shipped twice.
      const raw = Array.isArray(obj.blocks) ? obj.blocks : Array.isArray(obj.items) ? obj.items : null;
      if (!raw) return null;
      const blocks = sanitizeBlockList(raw, depth + 1);
      // Fail-soft: an empty frame is not a layout — the children ARE the content.
      if (blocks === undefined) return null;
      const layout = typeof obj.layout === "string" && VALID_LAYOUTS.has(obj.layout) ? obj.layout : "stack";
      const cols = typeof obj.cols === "number" && Number.isFinite(obj.cols)
        ? Math.max(2, Math.min(4, Math.round(obj.cols)))
        : undefined;
      sanitized.layout = layout;
      if (cols !== undefined) sanitized.cols = cols;
      sanitized.blocks = blocks;
      break;
    }
    
    case "theorem": {
      sanitized.kind = obj.kind;
      sanitized.statement = obj.statement;
      sanitized.proof = obj.proof;
      sanitized.refs = obj.refs;
      sanitized.number = obj.number;
      break;
    }
    case "algorithm": {
      if (!Array.isArray(obj.steps)) return null;
      sanitized.steps = obj.steps;
      sanitized.number = obj.number;
      break;
    }
    
    case "palette": {
      sanitized.title = obj.title;
      sanitized.against = obj.against;
      if (!Array.isArray(obj.colors)) return null;
      sanitized.colors = obj.colors;
      sanitized.scale = obj.scale;
      sanitized.space = obj.space;
      sanitized.radius = obj.radius;
      sanitized.shadow = obj.shadow;
      break;
    }
    case "scorecard": {
      if (typeof obj.method !== "string") return null;
      sanitized.title = obj.title;
      sanitized.method = obj.method;
      sanitized.max = obj.max;
      if (!Array.isArray(obj.items)) return null;
      sanitized.items = obj.items;
      sanitized.verdict = obj.verdict;
      break;
    }
    case "compliance": {
      if (typeof obj.regime !== "string") return null;
      sanitized.regime = obj.regime;
      sanitized.asOf = obj.asOf;
      sanitized.source = obj.source;
      if (!Array.isArray(obj.items)) return null;
      sanitized.items = obj.items;
      break;
    }
    case "clause": {
      sanitized.title = obj.title;
      if (!Array.isArray(obj.items)) return null;
      sanitized.items = obj.items;
      break;
    }
    case "obligations": {
      sanitized.title = obj.title;
      if (!Array.isArray(obj.rows)) return null;
      sanitized.rows = obj.rows;
      break;
    }
    
    case "schema": {
      sanitized.title = obj.title;
      if (!Array.isArray(obj.tables)) return null;
      sanitized.tables = obj.tables;
      break;
    }
    case "sequence": {
      sanitized.title = obj.title;
      if (!Array.isArray(obj.actors) || !Array.isArray(obj.messages)) return null;
      sanitized.actors = obj.actors;
      sanitized.messages = obj.messages;
      break;
    }
    case "math": {
      // TeX source, capped. katex renders it in a lazy chunk with
      // throwOnError:false, so bad TeX degrades to source text at paint time;
      // a block with no TeX at all is a formula-less formula and is dropped.
      if (typeof obj.tex !== "string" || !obj.tex.trim()) return null;
      sanitized.tex = truncate(obj.tex, 4000);
      // Emit the SAME shape the parser does: `display` is always an explicit
      // boolean there (default true), so writing it only when false left the two
      // layers disagreeing about an omitted key. The renderer treats `!== false`
      // as display, so both forms painted the same — but "the serialized shape
      // is what a consumer sees" is the rule, so the sanitizer matches.
      sanitized.display = obj.display === false ? false : true;
      if (typeof obj.label === "string") sanitized.label = truncate(obj.label, 200);
      break;
    }
    case "gitgraph": {
      // BUG (2026-10-05): this case did not exist while the parser, the CSS and
      // the markdown projection all knew `gitgraph`, so the block fell through to
      // `default: return null` and was DROPPED from the card entirely — a gitgraph
      // card rendered with the commit history silently missing. This is the third
      // instance of the same bug class (tabs b1ec4e9, accordion/tree 2026-10-05):
      // a type exists in the parser but not in this switch, so the ONLY call on
      // the render path (chat-timeline.tsx:70) throws the block away.
      //
      // Every field the renderer reads is kept, and each is capped:
      //   commits  → 40 rows, deduped by id (React keys the node circles by id,
      //              so a duplicate id would lose a row)
      //   message  → 200 chars (the label column; a log line is not a paragraph)
      //   parents  → strings only. A non-string parent is DROPPED, not coerced:
      //              the renderer does indexOf on it, so a number would silently
      //              resolve to no lane and fake a root commit.
      if (!Array.isArray(obj.commits)) return null;
      const commits: Record<string, unknown>[] = [];
      const seen = new Set<string>();
      for (const c of obj.commits) {
        if (commits.length >= MAX_GIT_COMMITS) break;
        if (!c || typeof c !== "object") continue;
        const co = c as Record<string, unknown>;
        const id = typeof co.id === "string" ? truncate(co.id, 40) : "";
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const out: Record<string, unknown> = {
          id,
          message: typeof co.message === "string" ? truncate(co.message, 200) : "",
        };
        const branch = typeof co.branch === "string" ? truncate(co.branch, 40) : "";
        if (branch) out.branch = branch;
        const author = typeof co.author === "string" ? truncate(co.author, 60) : "";
        if (author) out.author = author;
        const when = typeof co.when === "string" ? truncate(co.when, 40) : "";
        if (when) out.when = when;
        if (Array.isArray(co.parents)) {
          const parents = co.parents
            .filter((p: unknown): p is string => typeof p === "string")
            .slice(0, 8)
            .map((p: string) => truncate(p, 40));
          if (parents.length > 0) out.parents = parents;
        }
        if (Array.isArray(co.tags)) {
          const tags = co.tags
            .filter((t: unknown): t is string => typeof t === "string")
            .slice(0, 6)
            .map((t: string) => truncate(t, 30));
          if (tags.length > 0) out.tags = tags;
        }
        // `merge` is a DRAW directive (the node is hollow, the lane merges). Only
        // an explicit true means merge; anything else leaves it unset, matching the
        // parser's `c.merge === true ? true : undefined`.
        if (co.merge === true) out.merge = true;
        commits.push(out);
      }
      // Fail-soft at the block level: a graph with no row left is not a graph.
      if (commits.length === 0) return null;
      sanitized.commits = commits;
      if (Array.isArray(obj.branches)) {
        const branches: { name: string; head?: string }[] = [];
        const bn = new Set<string>();
        for (const br of obj.branches) {
          if (branches.length >= MAX_GIT_BRANCHES) break;
          if (!br || typeof br !== "object") continue;
          const bo = br as Record<string, unknown>;
          const name = typeof bo.name === "string" ? truncate(bo.name, 40) : "";
          if (!name || bn.has(name)) continue;
          bn.add(name);
          const head = typeof bo.head === "string" ? truncate(bo.head, 40) : "";
          branches.push(head ? { name, head } : { name });
        }
        // A declared-but-empty branch list is not a branch list — omit the key so
        // the renderer derives lanes from the commits (which is always correct).
        if (branches.length > 0) sanitized.branches = branches;
      }
      if (typeof obj.title === "string") sanitized.title = truncate(obj.title, MAX_TITLE);
      break;
    }
    case "diff": {
      if (typeof obj.filename === "string") sanitized.filename = truncate(obj.filename, 200);
      if (Array.isArray(obj.hunks)) {
        sanitized.hunks = obj.hunks
          .map((h: unknown) => {
            if (!h || typeof h !== "object") return null;
            const ho = h as Record<string, unknown>;
            const lines = Array.isArray(ho.lines)
              ? ho.lines
                  .map((l: unknown) => {
                    if (typeof l === "string") return { op: "ctx" as const, text: truncate(l, 500) };
                    if (l && typeof l === "object") {
                      const lo = l as Record<string, unknown>;
                      const op = typeof lo.op === "string" ? lo.op : "ctx";
                      const text = typeof lo.text === "string" ? truncate(lo.text, 500) : "";
                      return { op: op as "add" | "del" | "ctx", text };
                    }
                    return null;
                  })
                  .filter((x: unknown): x is { op: "add" | "del" | "ctx"; text: string } => x !== null)
                  .slice(0, 100)
              : [];
            return { lines };
          })
          .filter((x: unknown): x is { lines: { op: "add" | "del" | "ctx"; text: string }[] } => x !== null)
          .slice(0, 20);
      }
      break;
    }
    default:
      // Unknown type — strip it
      return null;
  }

  // Handle reactive bindings — ONE place, every block type (2026-10-05).
  //
  // CRITICAL: the sanitizer rebuilt each block from a literal per-type field
  // list, so every reactive field was silently DROPPED on the only render path
  // (chat-timeline.tsx:70). Measured before this fix:
  //   kpi value {$expr:"seats*price"} -> {"type":"kpi","label":"MRR"}  (no value)
  //   progress value {$expr:"pct"}    -> value: 0   (binding -> literal 0)
  //   table bind {$from:"latency"}    -> WHOLE BLOCK DROPPED
  //   data name "latency"             -> name gone, so $from can never resolve
  // The v5 reactive milestone was inert in production while every unit gate
  // stayed green, because the gates test the parser and the bind layer, never
  // the sanitizer.
  //
  // Fix: carry the binding SHAPES through (never authoring arbitrary objects),
  // so a bound value stays a binding and a plain value keeps its old cap path.
  for (const k of REACTIVE_KEYS) {
    if (obj[k] === undefined) continue;
    const carried = carryBinding(obj[k]);
    if (carried !== undefined) sanitized[k] = carried;
  }

  // Handle visible binding (reactive blocks)
  if (obj.visible !== undefined) {
    sanitized.visible = sanitizeValue(obj.visible);
  }

  return sanitized as unknown as CanvasBlock;
}

/**
 * Sanitize a canvas spec: remove invalid blocks, normalize enums,
 * strip unknown properties, cap lengths.
 *
 * Returns a clean spec ready for rendering. If no valid blocks remain,
 * returns null (caller should degrade to markdown).
 */
export function sanitizeCanvasSpec(spec: CanvasSpec | null): CanvasSpec | null {
  if (!spec || typeof spec !== "object") return null;
  if (!Array.isArray(spec.blocks)) return null;

  const blocks: CanvasBlock[] = [];
  for (const b of spec.blocks) {
    const sanitized = sanitizeBlock(b);
    if (sanitized) blocks.push(sanitized);
    if (blocks.length >= MAX_BLOCKS) break;
  }

  if (blocks.length === 0) return null;

  const out: CanvasSpec = { v: 1, blocks };
  if (typeof spec.title === "string") {
    out.title = truncate(spec.title, MAX_TITLE);
  }
  if (spec.state && typeof spec.state === "object") {
    out.state = spec.state;
  }

  return out;
}
