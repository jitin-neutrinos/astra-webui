import { deepStrictEqual, strictEqual, ok } from "node:assert";
import { readFileSync } from "node:fs";
import { splitCanvasBlocks } from "./canvas-schema";
import { sanitizeCanvasSpec } from "./canvas-sanitize";

// REGRESSIONS
// RG-125: Wave-1 canvas enrichments for charts (errorbar, candlestick, waterfall, violin, scale, refline, p)
const spec = `\`\`\`astra-canvas
{
  "v": 1,
  "blocks": [
    {
      "type": "chart",
      "chart": "candlestick",
      "scale": "log",
      "refline": { "value": 100, "tone": "danger" },
      "p": 0.05,
      "series": [
        {
          "name": "AAPL",
          "points": [155],
          "ohlc": [[150, 160, 140, 155]]
        }
      ]
    },
    {
      "type": "chart",
      "chart": "waterfall",
      "series": [
        {
          "name": "Cash",
          "points": [1000, 500],
          "items": [
            { "name": "Start", "value": 1000, "kind": "total" },
            { "name": "Income", "value": 500 }
          ]
        }
      ]
    },
    {
      "type": "chart",
      "chart": "errorbar",
      "series": [
        {
          "name": "Exp",
          "points": [10],
          "error": { "lo": [8], "hi": [12] }
        }
      ]
    }
  ]
}
\`\`\``;

const parts = splitCanvasBlocks(spec, true);
strictEqual(parts.length, 1);
const blocks = (parts[0] as any).spec.blocks;
strictEqual(blocks.length, 3);
const [c1, c2, c3] = blocks;

ok(c1.type === "chart" && c1.chart === "candlestick");
strictEqual(c1.scale, "log");
strictEqual(c1.p, 0.05);
deepStrictEqual(c1.refline, { value: 100, tone: "danger", label: undefined });
deepStrictEqual(c1.series[0].ohlc, [[150, 160, 140, 155]]);

ok(c2.type === "chart" && c2.chart === "waterfall");
deepStrictEqual(c2.series[0].waterfallKinds, ["total", "delta"]);

ok(c3.type === "chart" && c3.chart === "errorbar");
deepStrictEqual(c3.series[0].error, { lo: [8], hi: [12] });

// Sanitize passes new fields through
const san = sanitizeCanvasSpec({ v: 1, blocks: [c1, c2, c3] })!;
const s1 = san.blocks[0] as any;
strictEqual(s1.scale, "log");
strictEqual(s1.p, 0.05);
deepStrictEqual(s1.refline, { value: 100, tone: "danger", label: undefined });
deepStrictEqual(s1.series[0].ohlc, [[150, 160, 140, 155]]);

const s2 = san.blocks[1] as any;
deepStrictEqual(s2.series[0].waterfallKinds, ["total", "delta"]);

const s3 = san.blocks[2] as any;
deepStrictEqual(s3.series[0].error, { lo: [8], hi: [12] });

console.log("ok");

// ── renderer source pins (operator acceptance test, 2026-10-06) ────────────────
// Parsing is not rendering: these four kinds can survive the parser and still
// paint NOTHING. The pin asserts the render branches EXIST and every one of them
// draws the axes (the axes-always law) plus the shape/ErrorBar that IS the kind.
{
  const chartSrc = readFileSync(new URL("../components/canvas/canvas-chart.tsx", import.meta.url), "utf8");
  const kinds: [string, string][] = [
    ["candlestick", "CANDLE"],
    ["waterfall", "WATERFALL"],
    ["errorbar", "ERRBAND"],
    ["violin", "VIOLIN"],
  ];
  for (const [kind, flag] of kinds) {
    ok(chartSrc.includes(`const ${flag} = block.chart === "${kind}";`), `${kind}: adapter flag declared`);
    const at = chartSrc.indexOf(`) : ${flag} ? (`);
    ok(at > 0, `${kind}: render branch exists`);
    const seg = chartSrc.slice(at, chartSrc.indexOf(") : block.chart", at + 1) > 0 ? chartSrc.indexOf(") : block.chart", at + 1) : chartSrc.indexOf(") : (", at + 1));
    ok(seg.includes("{X}"), `${kind}: x axis drawn (axes-always law)`);
    ok(seg.includes("<YAxis"), `${kind}: y axis drawn (axes-always law)`);
    ok(seg.includes("{REF}"), `${kind}: reference line wired`);
  }
  ok(chartSrc.includes('shape={<CandleShape />}'), "candlestick: custom shape wired");
  ok(chartSrc.includes('shape={<ViolinShape />}'), "violin: custom shape wired");
  ok(chartSrc.includes('<ErrorBar dataKey="err"'), "errorbar: ErrorBar wired to the err offsets");
  ok(chartSrc.includes('shape={<WaterShape />}'), "waterfall: custom shape wired (the stacked base+delta trick composed empty rects; measured 2026-10-06)");
  ok(chartSrc.includes('shape={<ErrShape />}'), "errorbar: bar body drawn by shape (box pattern: shape + ErrorBar)");
  ok(chartSrc.includes('scale={block.scale === "log" ? "log" : "auto"}'), "log scale carried on the value axis (explicit 'auto', never undefined — an undefined scale prop silently becomes a POINT scale and flattens every bar; measured 2026-10-06)");
  ok(!chartSrc.includes('"log" : undefined'), "no explicit-undefined scale prop anywhere (the point-scale trap)");
  ok(chartSrc.includes("block.refline"), "refline reads the parsed field");
  ok(chartSrc.includes("ast-cv-chart-p"), "p-value chip wired to the caption");
}
