// canvas-bind.ts — reactive binding layer for canvas blocks.
//
// Pure + node-safe (no React, no DOM): a Binding value comes off the wire as an
// authored literal (`"$key"`, `"$rate"`), an expression string ("price*qty"), or
// a JSON-Logic-ish {expr/path/op/val} object (R1's grammar, kept for weight
// parity); resolve() evaluates it against the canvas scope through
// canvas-expr.ts (the closed expression language — no eval/new Function, no
// member access, hardcoded resource caps). Failure NEVER throws: a failed
// binding resolves to its literal fallback (or UNSET) and the block renders
// "—" or stays visible — one bad expression must not sink a whole card.
//
// Self-check: npx tsx --test src/lib/canvas-bind.check.ts
import { evaluate } from "./canvas-expr.ts";

export type EvalScope = Record<string, unknown>;

export interface FilterSpec {
  col: string;
  op: "==" | "!=" | "<" | "<=" | ">" | ">=" | "in";
  value: unknown; // literal or Binding
}
export interface FromBinding {
  $from: string;          // name of a `data` block in the same canvas
  filter?: FilterSpec[];
  sort?: { col?: string; by?: string; dir?: "asc" | "desc" };
  top?: unknown;          // Binding → first N rows
}
/** Anything a block prop can carry: scalar, expression, or pointer. */
export type Binding = string | number | boolean | null
  | { $expr: string } | { expr: string } | { path: string } | { $state: string };

export const UNSET: unique symbol = Symbol("unset");

const BIND_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;

/** Resolve one binding against a scope. Never throws. */
export function resolveBinding(b: unknown, scope: EvalScope): { value: unknown; unset: boolean } {
  if (b == null) return { value: null, unset: false };
  if (typeof b === "number" || typeof b === "boolean") return { value: b, unset: false };
  if (typeof b === "string") {
    // "$key" pointer form: read from state directly, no expression.
    const m = BIND_RE.exec(b.trim());
    if (m) {
      const k = m[1];
      if (Object.prototype.hasOwnProperty.call(scope, k)) return { value: scope[k], unset: false };
      return { value: null, unset: true };
    }
    // A bare "/path"-style pointer from the v2 sketch — treat as a state key.
    if (/^\/[A-Za-z_][A-Za-z0-9_/]*$/.test(b.trim())) {
      const k = b.trim().split("/").filter(Boolean)[0];
      if (Object.prototype.hasOwnProperty.call(scope, k)) return { value: scope[k], unset: false };
      return { value: null, unset: true };
    }
    return { value: b, unset: false }; // ordinary text passthrough
  }
  if (typeof b === "object") {
    const o = b as Record<string, unknown>;
    const expr = typeof o.$expr === "string" ? o.$expr : typeof o.expr === "string" ? o.expr : null;
    if (expr) {
      const r = evaluate(expr, scope);
      return r.ok ? { value: r.value, unset: false } : { value: null, unset: true };
    }
    const path = typeof o.path === "string" ? o.path : typeof o.$state === "string" ? o.$state : null;
    if (path) return resolveBinding(path, scope);
  }
  return { value: null, unset: true };
}

/** Narrow to number for numeric props (kpi value, progress, chart points). */
export function bindNumber(b: unknown, scope: EvalScope): number | null {
  const r = resolveBinding(b, scope);
  if (r.unset || r.value == null) return null;
  if (typeof r.value === "number" && Number.isFinite(r.value)) return r.value;
  if (typeof r.value === "boolean") return r.value ? 1 : 0;
  if (typeof r.value === "string") {
    const s = r.value.trim().replace(/[,$€£₹¥%\s]/g, "");
    const n = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(s) ? Number(s) : NaN;
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Narrow to number[] for chart series points (points may BE an expression). */
export function bindPoints(b: unknown, scope: EvalScope): number[] | null {
  const r = resolveBinding(b, scope);
  if (r.unset) return null;
  if (Array.isArray(r.value)) {
    const pts = r.value.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : null));
    return pts.every((x) => x != null) && pts.length > 0 ? (pts as number[]) : null;
  }
  const n = bindNumber(r.value, scope);
  return n != null ? [n] : null;
}

/** Narrow to rows for the `data`/`$from` pipeline. */
export type DataRow = Record<string, string | number | null>;

export function bindRows(b: unknown, scope: EvalScope): { rows: DataRow[]; unset: boolean } {
  const r = resolveBinding(b, scope);
  if (r.unset) return { rows: [], unset: true };
  let rows: DataRow[] = [];
  if (Array.isArray(r.value)) {
    rows = r.value
      .filter((x): x is DataRow => !!x && typeof x === "object" && !Array.isArray(x))
      .map((o) => {
        const out: DataRow = {};
        for (const [k, v] of Object.entries(o)) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
          else out[k] = v == null ? null : String(v);
        }
        return out;
      });
  }
  return { rows: rows.slice(0, 2000), unset: rows.length === 0 };
}

/** Apply `where` filters + `sort` + `top` over a row set. Unknown op on any spec
 *  drops that ONE spec (fail-soft), never the whole filter list. */
export function applyWhere(rows: DataRow[], filters: FilterSpec[] | undefined, scope: EvalScope): DataRow[] {
  if (!filters?.length) return rows;
  let out = rows;
  for (const f of filters) {
    const rv = resolveBinding(f.value, scope);
    const val = rv.unset ? UNSET : rv.value;
    out = out.filter((row) => {
      const cell = row[f.col];
      if (val === UNSET) return true; // an unset binding cannot filter; keep the row
      const cv = cell ?? null;
      switch (f.op) {
        case "==": return cv == val && String(cv) === String(val) || cv === val;
        case "!=": return !(cv == val && String(cv) === String(val) || cv === val);
        case "<": case "<=": case ">": case ">=": {
          const a = typeof cv === "number" ? cv : Number(cv);
          const b = typeof val === "number" ? val : Number(val);
          if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
          return f.op === "<" ? a < b : f.op === "<=" ? a <= b : f.op === ">" ? a > b : a >= b;
        }
        case "in": {
          const list = Array.isArray(val) ? val : typeof val === "string" ? [val] : null;
          return list ? list.some((x) => cv === x || (typeof cv === "number" && typeof x === "string" && String(cv) === x)) : false;
        }
        default: return true; // unknown op (validated already) — spec dropped upstream
      }
    });
  }
  return out;
}

export function applySort(rows: DataRow[], sort: FromBinding["sort"]): DataRow[] {
  const col = sort?.col ?? sort?.by;
  if (!col) return rows;
  const dir = sort?.dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = a[col], y = b[col];
    if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
    return String(x ?? "").localeCompare(String(y ?? "")) * dir;
  });
}

/** Truthiness for `visible` bindings; unset ⇒ visible (show by default). */
export function bindVisible(b: unknown, scope: EvalScope): boolean {
  if (b == null) return true;
  const r = resolveBinding(b, scope);
  if (r.unset) return true;
  const v = r.value;
  if (Array.isArray(v)) return v.length > 0;
  return !!v;
}

// ── data block registry (per canvas) ─────────────────────────────────────────

/** Named datasets: the `data` blocks of one canvas, keyed by their `name`.
 *  Built once per canvas render; `$from` consumers read through it. */
export function collectData(blocks: unknown[]): Map<string, DataRow[]> {
  const map = new Map<string, DataRow[]>();
  for (const b of blocks as { type?: string; name?: string; rows?: unknown[][]; columns?: string[]; header?: boolean }[]) {
    const b2 = b as { type?: string; name?: string; rows?: unknown[][]; columns?: unknown; header?: unknown };
    if (b2?.type !== "data" || !b2.name || b2.header === false) continue;
    const raw = b.rows ?? [];
    const explicitCols = Array.isArray(b.columns) && b.columns.length > 0 && typeof b.columns[0] === "string";
    const header = b.header !== false;
    const cols =
      explicitCols ? (b.columns as string[])
      : header && raw[0]?.every((c) => typeof c === "string" && c !== "") ? (raw[0] as string[])
      : undefined;
    const body = cols && !explicitCols && header ? raw.slice(1) : raw;
    const names = (cols ?? (body[0] as unknown[] | undefined)?.map((_, i) => `col${i + 1}`) ?? []) as string[];
    const rows: DataRow[] = [];
    for (const r of body) {
      if (!Array.isArray(r)) continue;
      const row: DataRow = {};
      names.forEach((n, i) => {
        const v = r[i];
        row[String(n)] = v == null ? null : typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : String(v);
      });
      rows.push(row);
    }
    map.set(String(b.name), rows);
  }
  return map;
}

/** Resolve a `$from` reader (dataset + filters + sort + top) to final rows. */
export function resolveFrom(fb: FromBinding, datasets: Map<string, DataRow[]>, scope: EvalScope): DataRow[] {
  let rows = datasets.get(fb.$from);
  if (!rows) return [];
  rows = applyWhere(rows, fb.filter, scope);
  rows = applySort(rows, fb.sort);
  if (fb.top != null) {
    const n = bindNumber(fb.top, scope);
    if (n != null && n >= 0) rows = rows.slice(0, Math.floor(n));
  }
  return rows;
}
