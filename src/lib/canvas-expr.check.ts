// Self-check for the reactive-canvas expression language.
// Run: npx tsx --test src/lib/canvas-expr.check.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, interpolate, toNum, compact } from "./canvas-expr.ts";

const ok = (src: string, scope: Record<string, unknown> = {}) => {
  const r = evaluate(src, scope);
  assert.ok(r.ok, `expected ok for ${src}: ${(r as { error?: string }).error}`);
  return (r as { value: unknown }).value;
};
const bad = (src: string, scope: Record<string, unknown> = {}) => {
  const r = evaluate(src, scope);
  assert.equal(r.ok, false, `expected failure for ${src}`);
  return (r as { error: string }).error;
};

test("arithmetic + precedence", () => {
  assert.equal(ok("1 + 2 * 3"), 7);
  assert.equal(ok("(1 + 2) * 3"), 9);
  assert.equal(ok("2 ^ 3 ^ 2"), 512); // right-assoc
  assert.equal(ok("2 ** 3"), 8);
  assert.equal(ok("-2 ^ 2"), -4);
  assert.equal(ok("10 % 4"), 2);
  assert.equal(ok("7 / 2"), 3.5);
  assert.equal(ok("1e3 + .5"), 1000.5);
});

test("identifiers resolve from scope only ($-prefix optional)", () => {
  const s = { price: 49, seats: 20 };
  assert.equal(ok("price * seats", s), 980);
  assert.equal(ok("$price * $seats", s), 980);
  assert.match(bad("tax", s), /unknown name/);
});

test("comparison, logic, ternary, word operators", () => {
  const s = { seats: 25, region: "EU", on: false };
  assert.equal(ok("seats > 10 ? 'team' : 'solo'", s), "team");
  assert.equal(ok("region == 'EU' || region == 'All'", s), true);
  assert.equal(ok("not on and seats >= 25", s), true);
  assert.equal(ok("'10' == 10"), true);
  assert.equal(ok("'b' > 'a'"), true);
});

test("formatting helpers", () => {
  assert.equal(ok("money(1234.5)"), "$1,235");
  assert.equal(ok("money(12.5)"), "$12.50");
  assert.equal(ok("money(-980, '₹')"), "-₹980");
  assert.equal(ok("pct(0.123)"), "12%");
  assert.equal(ok("pct(0.1234, 1)"), "12.3%");
  assert.equal(ok("compact(1280000)"), "1.3M");
  assert.equal(ok("fmt(1234.567, 2)"), "1,234.57");
  assert.equal(compact(950), "950");
});

test("arrays: literals, vector math, generators, reducers", () => {
  assert.equal(ok("sum([1, 2, 3])"), 6);
  assert.equal(ok("avg(xs)", { xs: [2, 4] }), 3);
  assert.deepEqual(ok("[1, 2, 3] * 2"), [2, 4, 6]);
  assert.deepEqual(ok("cumsum([1, 2, 3])"), [1, 3, 6]);
  assert.deepEqual(ok("range(3)"), [0, 1, 2]);
  assert.deepEqual((ok("compound(100, 10, 3)") as number[]).map((x) => Math.round(x)), [100, 110, 121]);
  assert.equal(ok("len(xs)", { xs: [1, 2, 3, 4] }), 4);
  assert.equal(ok("includes(tags, 'beta')", { tags: ["alpha", "beta"] }), true);
  assert.equal((ok("range(100000)") as number[]).length, 1000); // clamped, not exploded
});

test("lenient numbers: numeric strings coerce, junk does not", () => {
  assert.equal(ok("'1,234' * 2"), 2468);
  assert.equal(ok("'12%' * 1"), 12);
  assert.equal(toNum("abc"), NaN);
  assert.equal(ok("1 / 0"), null); // non-finite → null, never Infinity on screen
  assert.equal(ok("9 ^ 9 ^ 9"), null);
});

test("sandbox: no prototype, global or member access", () => {
  assert.match(bad("__proto__"), /not allowed/);
  assert.match(bad("constructor"), /not allowed/);
  assert.match(bad("globalThis"), /not allowed/);
  assert.match(bad("eval('1')"), /unknown function/);
  assert.match(bad("toString()"), /unknown function/);
  bad("x.constructor", { x: 1 }); // '.' is not an operator
  bad("this");
  // inherited properties are invisible — only OWN scope keys resolve
  bad("secret", Object.create({ secret: 1 }));
  // a JSON-parsed "__proto__" own key is still refused by name
  bad("__proto__", JSON.parse('{"__proto__": {"x": 1}}'));
  // objects never cross into the language
  assert.match(bad("o", { o: { a: 1 } }), /unsupported value/);
});

test("resource limits", () => {
  assert.match(bad("1+".repeat(400) + "1"), /too long/);
  assert.match(bad("(".repeat(60) + "1" + ")".repeat(60)), /nested too deeply/);
  bad("'unterminated");
  bad("");
  bad("1 +");
  bad("(1");
});

test("templates interpolate slots and leave prose braces alone", () => {
  const s = { seats: 20, price: 49 };
  assert.equal(interpolate("MRR at {seats} seats is {money(price * seats)}", s), "MRR at 20 seats is $980");
  assert.equal(interpolate("use {curly} braces", s), "use {curly} braces");
  assert.equal(interpolate("broken {1 +} slot", s), "broken {1 +} slot");
  assert.equal(interpolate("no slots", s), "no slots");
});

test("compile cache does not leak results between scopes", () => {
  assert.equal(ok("a + 1", { a: 1 }), 2);
  assert.equal(ok("a + 1", { a: 41 }), 42);
  bad("a + 1", {});
});
