// color-engine.check.ts — asserts the theme builder's colour maths.
// Run: npx tsx --test src/lib/color-engine.check.ts
//
// WHY THIS FILE EXISTS: generateVariant() decides the readability of every
// user-created theme, and a user theme syncs to every device the owner owns.
// A wrong contrast verdict ships an unreadable UI silently — the kind of bug
// that only surfaces as "the text looks muddy" months later. So the generator's
// contract is asserted here, not eyeballed in the builder UI.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hexToRgb, rgbToHex, hexToOklabFull, oklabToHex, contrastRatio, wcagAA,
  mixOklab, shiftLightness, generateVariant, alphaOf, slugifyThemeName,
  CONTRACT_TOKENS, TEXT_ROLES, readUserThemes, writeUserThemes, saveUserTheme,
  deleteUserTheme, type UserTheme,
} from "./color-engine.ts";

// localStorage + window shims so the storage helpers are testable outside a browser.
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
};
// saveUserTheme/deleteUserTheme announce themselves so the sync layer can push
// them to other devices; the event is asserted below, not stubbed away.
const events: string[] = [];
(globalThis as any).window = {
  dispatchEvent: (e: any) => { events.push(String(e?.type)); return true; },
};

test("hex <-> rgb round-trips, and short hex expands", () => {
  assert.deepEqual(hexToRgb("#ffffff"), [255, 255, 255]);
  assert.deepEqual(hexToRgb("#000"), [0, 0, 0]);
  assert.deepEqual(hexToRgb("#f00"), [255, 0, 0]);
  assert.deepEqual(hexToRgb("#22d3ee"), [0x22, 0xd3, 0xee]);
  assert.equal(hexToRgb("nope"), null);
  assert.equal(hexToRgb("#12345"), null);
  assert.equal(rgbToHex([0x22, 0xd3, 0xee]), "#22d3ee");
  assert.equal(rgbToHex([-5, 300, 128]), "#00ff80"); // clamped
});

test("OKLab round-trips within 1/255 per channel", () => {
  for (const hex of ["#22d3ee", "#34d399", "#0a0a0f", "#f5f2ec", "#d946ef", "#ffffff", "#000000"]) {
    const lab = hexToOklabFull(hex);
    assert.ok(lab, `${hex} parses`);
    const back = oklabToHex(lab);
    const [a1, b1, c1] = hexToRgb(hex)!;
    const [a2, b2, c2] = hexToRgb(back)!;
    assert.ok(
      Math.abs(a1 - a2) <= 1 && Math.abs(b1 - b2) <= 1 && Math.abs(c1 - c2) <= 1,
      `${hex} -> oklab -> ${back} stays within 1/255`,
    );
  }
});

test("contrastRatio matches the WCAG reference values", () => {
  // The spec's canonical pair: black on white is exactly 21.
  const bw = contrastRatio("#000000", "#ffffff");
  assert.ok(bw !== null && Math.abs(bw - 21) < 0.01, `black/white = 21, got ${bw}`);
  // Identical colours = 1.
  const same = contrastRatio("#22d3ee", "#22d3ee");
  assert.ok(same !== null && Math.abs(same - 1) < 0.001, `same = 1, got ${same}`);
  // Order-independent.
  const ab = contrastRatio("#22d3ee", "#0a0a0f");
  const ba = contrastRatio("#0a0a0f", "#22d3ee");
  assert.equal(ab, ba);
  assert.equal(contrastRatio("#zzz", "#fff"), null);
});

test("wcagAA applies the right threshold per size", () => {
  // #767676 on white is the classic 4.54:1 AA boundary case.
  const normal = wcagAA("#767676", "#ffffff");
  assert.equal(normal.need, 4.5);
  assert.ok(normal.ratio !== null && Math.abs(normal.ratio - 4.54) < 0.05, `ratio ${normal.ratio}`);
  assert.equal(normal.pass, true);
  const large = wcagAA("#767676", "#ffffff", true);
  assert.equal(large.need, 3);
  assert.equal(large.pass, true);
  // #999999 on white is 2.85:1 — below even the 3:1 large-text minimum.
  const fails = wcagAA("#999999", "#ffffff");
  assert.ok(fails.ratio !== null && Math.abs(fails.ratio - 2.85) < 0.05, `ratio ${fails.ratio}`);
  assert.equal(fails.pass, false);
  assert.equal(wcagAA("#999999", "#ffffff", true).pass, false); // still fails at 3.0
  // A colour that clears the large-text bar but not normal text proves the split.
  const mid = wcagAA("#8a8a8a", "#ffffff");
  assert.equal(mid.pass, false, "#8a8a8a fails normal text");
  assert.equal(wcagAA("#8a8a8a", "#ffffff", true).pass, true, "…but passes large text");
});

test("mixOklab endpoints and midpoint are exact", () => {
  assert.equal(mixOklab("#ff0000", "#0000ff", 0), "#ff0000");
  assert.equal(mixOklab("#ff0000", "#0000ff", 1), "#0000ff");
  const mid = hexToRgb(mixOklab("#000000", "#ffffff", 0.5))!;
  // Mid grey in OKLab is DARKER in sRGB bytes than the naive 128 midpoint. That
  // is the defining property of the space: equal perceptual steps, so L=0.5
  // lands at byte 99 rather than sRGB's gamma-distorted 128.
  assert.ok(Math.abs(mid[0] - 99) <= 1, `oklab midpoint ${mid[0]} == 99 (not sRGB's 128)`);
  assert.ok(Math.abs(mid[0] - mid[1]) <= 1 && Math.abs(mid[1] - mid[2]) <= 1, "midpoint stays neutral");
});

test("shiftLightness clamps instead of wrapping", () => {
  const up = shiftLightness("#000000", 0.5);
  assert.ok(contrastRatio(up, "#000000")! > 1.5, "black lifted is lighter");
  const down = shiftLightness("#ffffff", -0.5);
  assert.ok(contrastRatio(down, "#ffffff")! > 1.5, "white lowered is darker");
  // A huge delta must clamp to the gamut, not produce NaN.
  const wild = shiftLightness("#22d3ee", 99);
  assert.ok(hexToRgb(wild) !== null, `clamped to a real colour, got ${wild}`);
});

test("generateVariant satisfies the full 12-token contract in BOTH modes", () => {
  for (const [primary, secondary] of [
    ["#22d3ee", "#34d399"], // cyan + emerald (Astra-ish)
    ["#e11d48", "#f59e0b"], // rose + amber (hot)
    ["#3b82f6", "#a855f7"], // blue + purple (cool)
    ["#22c55e", "#14b8a6"], // green + teal
  ] as const) {
    for (const mode of ["dark", "light"] as const) {
      const { tokens } = generateVariant(primary, secondary, mode);
      for (const t of CONTRACT_TOKENS) {
        assert.ok(tokens[t], `${primary}/${mode}: ${t} generated`);
        assert.match(tokens[t], /^#[0-9a-f]{6}$/, `${primary}/${mode}: ${t} is a real hex, got ${tokens[t]}`);
      }
      // Glow contract: dark glows, light stays flat.
      assert.match(tokens["--glow-accent"], mode === "dark" ? /^0 0 10px rgba\(/ : /^none$/,
        `${primary}/${mode}: glow contract`);
    }
  }
});

test("generateVariant output PASSES its own contrast audit for every palette", () => {
  // The generator reports failures rather than throwing — assert there are none
  // for every accent pair, in both modes. A failure here is an unreadable theme.
  const pairs = [
    ["#22d3ee", "#34d399"], ["#e11d48", "#f59e0b"], ["#3b82f6", "#a855f7"],
    ["#22c55e", "#14b8a6"], ["#f43f5e", "#8b5cf6"], ["#06b6d4", "#eab308"],
    ["#7c3aed", "#ec4899"], ["#0ea5e9", "#84cc16"],
  ];
  for (const [p, s] of pairs) {
    for (const mode of ["dark", "light"] as const) {
      const { tokens, ratios, failing } = generateVariant(p, s, mode);
      assert.deepEqual(failing, [], `${p}+${s} ${mode} should have no contrast failures`);
      for (const role of TEXT_ROLES) {
        const r = ratios[role];
        assert.ok(r !== undefined && r >= 4.5, `${p}+${s} ${mode}: ${role} is ${r?.toFixed(2)} >= 4.5`);
      }
      for (const role of ["--color-cyanx", "--color-violetx", "--color-redx", "--color-emerald", "--color-amber"]) {
        const r = ratios[role];
        assert.ok(r !== undefined && r >= 3, `${p}+${s} ${mode}: ${role} is ${r?.toFixed(2)} >= 3`);
      }
      // The reported ratio must equal a fresh computation — no stale/lying numbers.
      for (const role of TEXT_ROLES) {
        assert.ok(
          Math.abs((ratios[role] ?? 0) - (contrastRatio(tokens[role], tokens["--color-midnight"]) ?? -1)) < 0.01,
          `${p}+${s} ${mode}: ${role} reported ratio is honest`,
        );
      }
    }
  }
});

test("generated grounds are ordered and carry the accent's hue without going brown", () => {
  for (const [p, s] of [["#e11d48", "#f59e0b"], ["#3b82f6", "#a855f7"], ["#22c55e", "#14b8a6"]] as const) {
    const { tokens } = generateVariant(p, s, "dark");
    // Dark ground ramp must ascend in lightness.
    const ls = CONTRACT_TOKENS.slice(0, 4).map((t) => hexToOklabFull(tokens[t])![0]);
    for (let i = 1; i < ls.length; i++) {
      assert.ok(ls[i] > ls[i - 1], `${p}: ground ascends (${ls[i - 1].toFixed(2)} -> ${ls[i].toFixed(2)})`);
    }
    // A saturated ground reads as brown/espresso — chroma must stay LOW.
    const groundC = Math.hypot(hexToOklabFull(tokens["--color-void"])![1], hexToOklabFull(tokens["--color-void"])![2]);
    assert.ok(groundC <= 0.06, `${p}: void chroma ${groundC.toFixed(3)} <= 0.06 (not brown)`);
    // ...but not ZERO, or every theme is the same neutral grey app.
    assert.ok(groundC >= 0.005, `${p}: void keeps a hue trace (${groundC.toFixed(3)} >= 0.005)`);
  }
});

test("generated light grounds are paper-bright and light grounds ascend DOWNWARD", () => {
  const { tokens } = generateVariant("#3b82f6", "#a855f7", "light");
  const ls = CONTRACT_TOKENS.slice(0, 4).map((t) => hexToOklabFull(tokens[t])![0]);
  for (let i = 1; i < ls.length; i++) {
    assert.ok(ls[i] < ls[i - 1], `light ground descends (${ls[i - 1].toFixed(2)} -> ${ls[i].toFixed(2)})`);
  }
  assert.ok(ls[0] > 0.9, `light void is paper-bright (${ls[0].toFixed(2)} > 0.9)`);
});

test("accent hues actually differ between primary and secondary slots", () => {
  const { tokens } = generateVariant("#3b82f6", "#a855f7", "dark");
  const hueOf = (hex: string) => {
    const [, a, b] = hexToOklabFull(hex)!;
    return (Math.atan2(b, a) * 180) / Math.PI;
  };
  const d = Math.abs(hueOf(tokens["--color-cyanx"]) - hueOf(tokens["--color-violetx"]));
  // atan2 wraps: compare on a circle.
  const diff = Math.min(d, 360 - d);
  assert.ok(diff > 12, `primary vs secondary hue separation ${diff.toFixed(1)}deg > 12deg`);
});

test("alphaOf builds a valid rgba string and survives a bad hex", () => {
  assert.equal(alphaOf("#22d3ee", 0.25), "rgba(34,211,238,0.25)");
  assert.equal(alphaOf("garbage", 0.5), "garbage");
});

test("slugifyThemeName produces safe, non-empty ids", () => {
  assert.equal(slugifyThemeName("My Theme"), "my-theme");
  assert.equal(slugifyThemeName("  Deep Ocean!!  "), "deep-ocean");
  assert.equal(slugifyThemeName("---"), "theme");
  assert.equal(slugifyThemeName(""), "theme");
  assert.equal(slugifyThemeName("Ünïcødé Näme"), "n-c-d-n-me");
});

test("user themes persist, replace by id, and delete", () => {
  mem.clear();
  assert.deepEqual(readUserThemes(), []);
  const mk = (id: string): UserTheme => ({
    id, name: id, source: "user", license: "—", createdAt: 1,
    variants: { dark: { "--color-void": "#000000" }, light: { "--color-void": "#ffffff" } },
  });
  saveUserTheme(mk("a"));
  assert.equal(readUserThemes().length, 1);
  saveUserTheme(mk("b"));
  assert.equal(readUserThemes().length, 2);
  // Same id replaces rather than duplicating.
  saveUserTheme({ ...mk("a"), name: "a2" });
  const after = readUserThemes();
  assert.equal(after.length, 2);
  assert.equal(after.find((t) => t.id === "a")!.name, "a2");
  // Delete.
  assert.equal(deleteUserTheme("a").length, 1);
  assert.equal(readUserThemes()[0].id, "b");
  // Survives a fresh read (i.e. it really hit storage).
  assert.equal(readUserThemes().length, 1);
  // ...and every mutation ANNOUNCED itself, which is what pushes a created theme
  // to the owner's other devices and the Android app.
  assert.ok(events.length >= 4, `save/delete dispatch change events, got ${events.length}`);
  assert.ok(events.every((e) => e === "astra-user-themes-change"), `only the themes event is used: ${[...new Set(events)].join(",")}`);
});

test("a dark-only or light-only user theme is REJECTED on read", () => {
  mem.clear();
  // This is the owner's rule: a user theme must define BOTH modes. A stored
  // theme missing a variant is corrupt and must not reach the picker.
  writeUserThemes([
    { id: "ok", name: "ok", source: "user", license: "—", createdAt: 1,
      variants: { dark: { "--color-void": "#000" }, light: { "--color-void": "#fff" } } },
    { id: "darkonly", name: "darkonly", source: "user", license: "—", createdAt: 1,
      variants: { dark: { "--color-void": "#000" } } } as any,
    { id: "empty", name: "empty", source: "user", license: "—", createdAt: 1,
      variants: { dark: {}, light: {} } } as any,
    null as any,
  ]);
  const ids = readUserThemes().map((t) => t.id);
  assert.deepEqual(ids, ["ok"], `only the both-modes theme survives, got ${ids.join(",")}`);
});

test("corrupt storage does not throw", () => {
  mem.clear();
  mem.set("astra-user-themes", "{not json");
  assert.deepEqual(readUserThemes(), []);
  mem.set("astra-user-themes", '{"not":"an array"}');
  assert.deepEqual(readUserThemes(), []);
});
