// canvas-expr.ts — the expression language behind REACTIVE canvases.
//
// An agent authors `{"$expr": "price * seats"}` (or a `{seats}` template) inside
// an astra-canvas fence; this module evaluates it against that card's state.
// It is a closed, deliberately tiny language:
//   • no eval / new Function / with — a hand-written tokenizer + precedence
//     parser (expr-eval, the usual pick, shipped a prototype-pollution → code
//     execution CVE in 2025; a 200-line parser has no such surface)
//   • no member access and no string indexing — identifiers resolve ONLY from
//     the card's own state (own properties), so there is no path to __proto__,
//     constructor, globalThis or the DOM
//   • whitelisted pure functions only (math, array, format helpers)
//   • hard limits on source length, nesting depth, steps, array and string size
// Failure never throws to the caller: evaluate() returns {ok:false, error}.
// Self-check: npx tsx --test src/lib/canvas-expr.check.ts

export type Value = number | string | boolean | null | Value[];
export type Scope = Readonly<Record<string, unknown>>;
export type EvalResult = { ok: true; value: Value } | { ok: false; error: string };

const MAX_SRC = 600;
const MAX_DEPTH = 40;
const MAX_STEPS = 20_000;
const MAX_ARR = 1000;
const MAX_STR = 4000;
const BANNED = new Set(["__proto__", "prototype", "constructor", "globalThis", "window", "document", "eval", "Function"]);

// ── tokens ────────────────────────────────────────────────────────────────────

type Tok = { t: "num"; v: number } | { t: "str"; v: string } | { t: "id"; v: string } | { t: "op"; v: string };

// Longest first so "===" wins over "==" and "**" over "*".
const OPS = ["===", "!==", "**", "==", "!=", "<=", ">=", "&&", "||", "+", "-", "*", "/", "%", "^", "<", ">", "!", "?", ":", "(", ")", "[", "]", ","];
const NUM_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const ID_RE = /^\$?[A-Za-z_][A-Za-z0-9_]*/;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if ((c >= "0" && c <= "9") || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      const m = NUM_RE.exec(src.slice(i))!;
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) {
          const n = src[j + 1];
          s += n === "n" ? "\n" : n === "t" ? "\t" : n;
          j += 2;
          continue;
        }
        s += src[j++];
      }
      if (j >= src.length) throw new Error("unterminated string");
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (c === "$" || c === "_" || (c >= "A" && c <= "Z") || (c >= "a" && c <= "z")) {
      const m = ID_RE.exec(src.slice(i));
      if (!m) throw new Error(`unexpected '${c}'`);
      const name = m[0].replace(/^\$/, "");
      // word operators read naturally in authored expressions
      if (name === "and") out.push({ t: "op", v: "&&" });
      else if (name === "or") out.push({ t: "op", v: "||" });
      else if (name === "not") out.push({ t: "op", v: "!" });
      else out.push({ t: "id", v: name });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Error(`unexpected '${c}'`);
    out.push({ t: "op", v: op === "**" ? "^" : op });
    i += op.length;
  }
  return out;
}

// ── parser (precedence climbing) ──────────────────────────────────────────────

type Node =
  | { k: "lit"; v: Value }
  | { k: "id"; n: string }
  | { k: "arr"; items: Node[] }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "tern"; c: Node; a: Node; b: Node }
  | { k: "call"; f: string; args: Node[] };

const PREC: Record<string, number> = {
  "||": 1, "&&": 2,
  "==": 3, "!=": 3, "===": 3, "!==": 3,
  "<": 4, "<=": 4, ">": 4, ">=": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6, "%": 6,
};

function parse(toks: Tok[]): Node {
  let p = 0;
  const isOp = (v: string) => toks[p]?.t === "op" && toks[p].v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`expected '${v}'`);
    p++;
  };
  const guard = (d: number) => {
    if (d > MAX_DEPTH) throw new Error("expression nested too deeply");
  };

  function expr(d: number): Node {
    guard(d);
    const c = binary(0, d + 1);
    if (!isOp("?")) return c;
    p++;
    const a = expr(d + 1);
    expect(":");
    const b = expr(d + 1);
    return { k: "tern", c, a, b };
  }
  function binary(min: number, d: number): Node {
    guard(d);
    let left = unary(d + 1);
    for (;;) {
      const t = toks[p];
      if (!t || t.t !== "op") break;
      const prec = PREC[t.v];
      if (prec === undefined || prec < min) break;
      p++;
      left = { k: "bin", op: t.v, a: left, b: binary(prec + 1, d + 1) };
    }
    return left;
  }
  function unary(d: number): Node {
    guard(d);
    const t = toks[p];
    if (t?.t === "op" && (t.v === "-" || t.v === "+" || t.v === "!")) {
      p++;
      return { k: "un", op: t.v, a: unary(d + 1) };
    }
    const base = primary(d + 1);
    // right-associative power that binds tighter than unary minus: -2^2 = -4
    if (isOp("^")) {
      p++;
      return { k: "bin", op: "^", a: base, b: unary(d + 1) };
    }
    return base;
  }
  function list(close: string, d: number): Node[] {
    const items: Node[] = [];
    if (isOp(close)) { p++; return items; }
    for (;;) {
      items.push(expr(d + 1));
      if (isOp(",")) { p++; continue; }
      expect(close);
      return items;
    }
  }
  function primary(d: number): Node {
    guard(d);
    const t = toks[p++];
    if (!t) throw new Error("unexpected end of expression");
    if (t.t === "num" || t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "id") {
      if (t.v === "true") return { k: "lit", v: true };
      if (t.v === "false") return { k: "lit", v: false };
      if (t.v === "null") return { k: "lit", v: null };
      if (isOp("(")) {
        p++;
        return { k: "call", f: t.v, args: list(")", d) };
      }
      return { k: "id", n: t.v };
    }
    if (t.v === "(") {
      const e = expr(d + 1);
      expect(")");
      return e;
    }
    if (t.v === "[") return { k: "arr", items: list("]", d) };
    throw new Error(`unexpected '${t.v}'`);
  }

  const root = expr(0);
  if (p !== toks.length) throw new Error(`unexpected '${(toks[p] as { v: unknown }).v}'`);
  return root;
}

// ── values ────────────────────────────────────────────────────────────────────

/** Only plain data crosses into the language: numbers, strings, booleans, null, arrays. */
export function sanitize(v: unknown, depth = 0): Value {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v.length > MAX_STR ? v.slice(0, MAX_STR) : v;
  if (typeof v === "boolean") return v;
  if (Array.isArray(v) && depth < 4) {
    if (v.length > MAX_ARR) throw new Error("array too large");
    return v.map((x) => sanitize(x, depth + 1));
  }
  throw new Error("unsupported value");
}

const NUMERIC_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

/** Lenient number coercion: booleans 1/0, null 0, numeric strings (commas,
 *  currency signs and % stripped). Anything else is NaN. */
export function toNum(v: Value): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null) return 0;
  if (typeof v === "string") {
    const s = v.trim().replace(/[,$€£₹¥%\s]/g, "");
    return NUMERIC_RE.test(s) ? Number(s) : NaN;
  }
  return NaN;
}

export function truthy(v: Value): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return !!v;
}

function eq(a: Value, b: Value): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  if (typeof a === typeof b) return a === b;
  if (typeof a === "number" && typeof b === "string") return a === toNum(b);
  if (typeof b === "number" && typeof a === "string") return b === toNum(a);
  return false;
}

function finite(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

function arith(op: string, a: Value, b: Value): Value {
  if (Array.isArray(a) || Array.isArray(b)) {
    const n = Math.max(Array.isArray(a) ? a.length : 1, Array.isArray(b) ? b.length : 1);
    if (n > MAX_ARR) throw new Error("array too large");
    const out: Value[] = [];
    for (let i = 0; i < n; i++) {
      out.push(arith(op, Array.isArray(a) ? a[i] ?? null : a, Array.isArray(b) ? b[i] ?? null : b));
    }
    return out;
  }
  if (op === "+" && (typeof a === "string" || typeof b === "string")) {
    const s = display(a) + display(b);
    if (s.length > MAX_STR) throw new Error("string too long");
    return s;
  }
  const x = toNum(a);
  const y = toNum(b);
  switch (op) {
    case "+": return finite(x + y);
    case "-": return finite(x - y);
    case "*": return finite(x * y);
    case "/": return finite(x / y);
    case "%": return finite(x % y);
    case "^": return finite(Math.pow(x, y));
  }
  throw new Error(`bad operator ${op}`);
}

function compare(op: string, a: Value, b: Value): boolean {
  if (typeof a === "string" && typeof b === "string" && !(NUMERIC_RE.test(a.trim()) && NUMERIC_RE.test(b.trim()))) {
    return op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b;
  }
  const x = toNum(a);
  const y = toNum(b);
  return op === "<" ? x < y : op === "<=" ? x <= y : op === ">" ? x > y : x >= y;
}

// ── formatting helpers (also used by renderers) ───────────────────────────────

export function group(n: number, digits = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 1234 → "1.2k", 3_400_000 → "3.4M". Matches the chart tooltip formatter. */
export function compact(n: number): string {
  const a = Math.abs(n);
  const f = (x: number, s: string) => (x.toFixed(1).replace(/\.0$/, "") + s);
  if (a >= 1e12) return f(n / 1e12, "T");
  if (a >= 1e9) return f(n / 1e9, "B");
  if (a >= 1e6) return f(n / 1e6, "M");
  if (a >= 1e4) return f(n / 1e3, "k");
  return Number.isInteger(n) ? group(n) : group(n, 2).replace(/\.?0+$/, "");
}

/** Human display of any value — what a template slot shows. */
export function display(v: Value): string {
  if (v === null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? group(v) : group(v, 2).replace(/\.?0+$/, "");
  if (Array.isArray(v)) return v.map(display).join(", ");
  return String(v);
}

const flat = (args: Value[]): Value[] => args.flatMap((a) => (Array.isArray(a) ? a : [a]));
const nums = (args: Value[]): number[] => flat(args).map(toNum).filter((x) => Number.isFinite(x));
const int = (v: Value, lo: number, hi: number, dflt: number) => {
  const n = Math.round(toNum(v ?? dflt));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};
const arr = (v: Value): Value[] => (Array.isArray(v) ? v : [v]);
const capArr = (xs: Value[]): Value[] => {
  if (xs.length > MAX_ARR) throw new Error("array too large");
  return xs;
};

const FN: Record<string, (a: Value[]) => Value> = {
  // math
  min: (a) => finite(Math.min(...nums(a))),
  max: (a) => finite(Math.max(...nums(a))),
  abs: ([x]) => finite(Math.abs(toNum(x))),
  round: ([x, d]) => { const k = 10 ** int(d, 0, 10, 0); return finite(Math.round(toNum(x) * k) / k); },
  floor: ([x]) => finite(Math.floor(toNum(x))),
  ceil: ([x]) => finite(Math.ceil(toNum(x))),
  trunc: ([x]) => finite(Math.trunc(toNum(x))),
  sign: ([x]) => finite(Math.sign(toNum(x))),
  sqrt: ([x]) => finite(Math.sqrt(toNum(x))),
  pow: ([x, y]) => finite(Math.pow(toNum(x), toNum(y))),
  exp: ([x]) => finite(Math.exp(toNum(x))),
  log: ([x]) => finite(Math.log(toNum(x))),
  log10: ([x]) => finite(Math.log10(toNum(x))),
  clamp: ([x, lo, hi]) => finite(Math.min(Math.max(toNum(x), toNum(lo)), toNum(hi))),
  // arrays
  sum: (a) => nums(a).reduce((s, x) => s + x, 0),
  avg: (a) => { const n = nums(a); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : null; },
  mean: (a) => FN.avg(a),
  len: ([x]) => (Array.isArray(x) ? x.length : typeof x === "string" ? x.length : x === null ? 0 : 1),
  count: (a) => FN.len(a),
  first: ([x]) => (Array.isArray(x) ? x[0] ?? null : x),
  last: ([x]) => (Array.isArray(x) ? x[x.length - 1] ?? null : x),
  at: ([x, i]) => { const xs = arr(x); const k = int(i, -MAX_ARR, MAX_ARR, 0); return xs.at(k) ?? null; },
  range: ([a, b]) => {
    const lo = b === undefined ? 0 : int(a, -1e6, 1e6, 0);
    const hi = b === undefined ? int(a, 0, MAX_ARR, 0) : int(b, -1e6, 1e6, 0);
    if (hi - lo > MAX_ARR) throw new Error("array too large");
    const out: number[] = [];
    for (let i = lo; i < hi; i++) out.push(i);
    return out;
  },
  seq: (a) => FN.range(a),
  linspace: ([a, b, n]) => {
    const k = int(n, 1, MAX_ARR, 2);
    const x = toNum(a), y = toNum(b);
    return Array.from({ length: k }, (_, i) => finite(k === 1 ? x : x + ((y - x) * i) / (k - 1)));
  },
  // compound(start, ratePercent, n): [start, start·(1+r), start·(1+r)², …]
  compound: ([s, r, n]) => {
    const k = int(n, 1, MAX_ARR, 12);
    const x = toNum(s), g = 1 + toNum(r) / 100;
    return Array.from({ length: k }, (_, i) => finite(x * Math.pow(g, i)));
  },
  cumsum: ([x]) => { let s = 0; return capArr(arr(x).map((v) => finite((s += toNum(v))))); },
  scale: ([x, k]) => arith("*", x, k),
  slice: ([x, a, b]) => capArr(arr(x).slice(int(a, -MAX_ARR, MAX_ARR, 0), b === undefined ? undefined : int(b, -MAX_ARR, MAX_ARR, MAX_ARR))),
  reverse: ([x]) => [...arr(x)].reverse(),
  sort: ([x]) => [...arr(x)].sort((p, q) => toNum(p) - toNum(q)),
  includes: ([x, v]) => (typeof x === "string" ? x.toLowerCase().includes(display(v).toLowerCase()) : arr(x).some((y) => eq(y, v))),
  join: ([x, sep]) => arr(x).map(display).join(sep === undefined ? ", " : display(sep)),
  // logic
  if: ([c, a, b]) => (truthy(c) ? a ?? null : b ?? null),
  // strings + formatting
  str: ([x]) => display(x),
  lower: ([x]) => display(x).toLowerCase(),
  upper: ([x]) => display(x).toUpperCase(),
  fmt: ([x, d]) => { const n = toNum(x); return Number.isFinite(n) ? group(n, int(d, 0, 6, 0)) : "—"; },
  compact: ([x]) => { const n = toNum(x); return Number.isFinite(n) ? compact(n) : "—"; },
  // money(x, symbol = "$", decimals = auto: 2 under 100, else 0)
  money: ([x, sym, d]) => {
    const n = toNum(x);
    if (!Number.isFinite(n)) return "—";
    const digits = d === undefined ? (Math.abs(n) < 100 ? 2 : 0) : int(d, 0, 4, 0);
    const s = sym === undefined ? "$" : display(sym);
    return (n < 0 ? "-" : "") + s + group(Math.abs(n), digits);
  },
  // pct(fraction, decimals = 0): pct(0.123) → "12%"
  pct: ([x, d]) => { const n = toNum(x); return Number.isFinite(n) ? group(n * 100, int(d, 0, 4, 0)) + "%" : "—"; },
};

export const FUNCTION_NAMES = Object.freeze(Object.keys(FN));

// ── evaluation ────────────────────────────────────────────────────────────────

const CONSTS: Record<string, number> = { PI: Math.PI, E: Math.E };

function run(n: Node, scope: Scope, budget: { steps: number }): Value {
  if (++budget.steps > MAX_STEPS) throw new Error("expression too expensive");
  switch (n.k) {
    case "lit": return n.v;
    case "id": {
      if (BANNED.has(n.n)) throw new Error(`'${n.n}' is not allowed`);
      if (Object.prototype.hasOwnProperty.call(scope, n.n)) return sanitize(scope[n.n]);
      if (Object.prototype.hasOwnProperty.call(CONSTS, n.n)) return CONSTS[n.n];
      throw new Error(`unknown name '${n.n}'`);
    }
    case "arr": {
      if (n.items.length > MAX_ARR) throw new Error("array too large");
      return n.items.map((x) => run(x, scope, budget));
    }
    case "un": {
      const a = run(n.a, scope, budget);
      if (n.op === "!") return !truthy(a);
      return n.op === "-" ? arith("*", a, -1) : arith("*", a, 1);
    }
    case "tern":
      return truthy(run(n.c, scope, budget)) ? run(n.a, scope, budget) : run(n.b, scope, budget);
    case "bin": {
      if (n.op === "&&") { const a = run(n.a, scope, budget); return truthy(a) ? run(n.b, scope, budget) : a; }
      if (n.op === "||") { const a = run(n.a, scope, budget); return truthy(a) ? a : run(n.b, scope, budget); }
      const a = run(n.a, scope, budget);
      const b = run(n.b, scope, budget);
      switch (n.op) {
        case "==": case "===": return eq(a, b);
        case "!=": case "!==": return !eq(a, b);
        case "<": case "<=": case ">": case ">=": return compare(n.op, a, b);
        default: return arith(n.op, a, b);
      }
    }
    case "call": {
      if (BANNED.has(n.f) || !Object.prototype.hasOwnProperty.call(FN, n.f)) throw new Error(`unknown function '${n.f}'`);
      const args = n.args.map((x) => run(x, scope, budget));
      const out = FN[n.f](args);
      if (typeof out === "string" && out.length > MAX_STR) throw new Error("string too long");
      if (Array.isArray(out) && out.length > MAX_ARR) throw new Error("array too large");
      return out;
    }
  }
}

const cache = new Map<string, Node | Error>();

function compile(src: string): Node {
  const hit = cache.get(src);
  if (hit instanceof Error) throw hit;
  if (hit) return hit;
  let out: Node | Error;
  try {
    if (src.length > MAX_SRC) throw new Error("expression too long");
    const toks = tokenize(src);
    if (toks.length === 0) throw new Error("empty expression");
    out = parse(toks);
  } catch (e) {
    out = e instanceof Error ? e : new Error(String(e));
  }
  if (cache.size > 500) cache.clear();
  cache.set(src, out);
  if (out instanceof Error) throw out;
  return out;
}

/** Evaluate `src` against `scope`. Never throws. */
export function evaluate(src: string, scope: Scope = {}): EvalResult {
  try {
    return { ok: true, value: run(compile(String(src)), scope, { steps: 0 }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Replace `{expr}` slots in a template. A slot that does not evaluate stays
 *  verbatim, so ordinary braces in prose are never mangled. */
export function interpolate(tpl: string, scope: Scope): string {
  if (!tpl.includes("{")) return tpl;
  return tpl.replace(/\{([^{}\n]{1,200})\}/g, (m, inner: string) => {
    const r = evaluate(inner, scope);
    return r.ok ? display(r.value) : m;
  });
}
