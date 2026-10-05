// Browser-side probe for the L1 guarantee. Bundled by
// scripts/canvas-raw-code.browser.mts and executed in a real Chromium page so
// DOMPurify has a real DOM (it is inert under bare node).
import { renderRichHtml } from "./rich-html";
import DOMPurify from "dompurify";

interface R { name: string; ok: boolean; detail: string }
const results: R[] = [];

const good = JSON.stringify({ v: 1, blocks: [{ type: "kpi", label: "A", value: 1 }] });
const big = JSON.stringify({
  v: 1, title: "Audit", state: { n: 3 },
  blocks: [
    { type: "kpi", label: "A", value: 1 },
    { type: "kpi", label: "B", value: 2 },
    { type: "table", columns: ["a", "b"], rows: [["x", 1], ["y", 2]] },
    { type: "callout", tone: "info", title: "Note", body: "body" },
  ],
});

// FIRST: which carrier survives DOMPurify's ACTUAL sanitize config?
// (Test DOMPurify directly — routing it through a markdown code block escapes
// the HTML and tells us nothing.) The <script> result is RECORDED, not
// asserted-to-pass: script is not in DOMPurify's default allow-list, which is
// exactly why the implementation uses a data attribute instead.
{
  const spec = { v: 1, blocks: [{ type: "kpi", label: "A", value: 1 }] };
  const json = JSON.stringify(spec);
  const carriers: Record<string, string> = {
    "script (must be STRIPPED)": `<div data-cv-mount></div><script type="application/json" data-cv-spec>${json}</script>`,
    "attr (must SURVIVE)": `<div data-cv-mount data-cv-spec='${json.replace(/'/g, "&#39;")}'></div>`,
  };
  // The exact config renderRichHtml uses.
  const CFG = { ADD_ATTR: ["target", "loading"], FORBID_TAGS: ["style", "form"], FORBID_ATTR: ["srcset"] };
  for (const [name, htmlIn] of Object.entries(carriers)) {
    const mustSurvive = !name.startsWith("script");
    const sanitized = DOMPurify.sanitize(htmlIn, CFG);
    const box = document.createElement("div");
    box.innerHTML = sanitized;
    const node = box.querySelector("[data-cv-spec]");
    let detail = "carrier stripped by DOMPurify";
    let roundTrips = false;
    if (node) {
      const raw = (node.tagName === "DIV" ? node.getAttribute("data-cv-spec") : node.textContent) ?? "";
      try {
        const parsed = JSON.parse(raw) as { blocks?: unknown[] };
        roundTrips = Array.isArray(parsed.blocks) && parsed.blocks.length === 1;
        detail = roundTrips ? "survives, spec round-trips" : "parsed but wrong shape";
      } catch (e) {
        detail = "carrier present but JSON invalid: " + (e as Error).message.slice(0, 40);
      }
    }
    results.push({
      name: `carrier: ${name}`,
      ok: roundTrips === mustSurvive,
      detail: `${detail} on <${node ? node.tagName : "none"}>`,
    });
  }
}

// Every shape measured as leaking, plus well-formed and ordinary-code controls.
const cases: [string, string, boolean][] = [
  ["valid card", "p\n\n```astra-canvas\n" + good + "\n```\n\nafter", true],
  ["unquoted + prose", "p\n\n```astra-canvas\nHere: {v:1,blocks:[{type:\"kpi\",label:\"A\",value:1}]} Hope!\n```", false],
  ["single quotes", "p\n\n```astra-canvas\n{'v':1,'blocks':[{'type':'kpi','label':'A','value':1}]}\n```", false],
  ["truncated body", "p\n\n```astra-canvas\n{\"v\":1,\"blocks\":[{\"type\":\"kpi\",\"label\":\"A\",\"val\n```", false],
  ["empty body", "p\n\n```astra-canvas\n\n```\n\nafter", false],
  ["garbage body", "p\n\n```astra-canvas\nnot json at all {{{\n```", false],
  ["realistic 4-block card", "p\n\n```astra-canvas\n" + big + "\n```\n\nafter", true],
  ["4-tick wrapper", "p\n\n````astra-canvas\n" + good + "\n````", true],
  ["with lang suffix", "p\n\n```astra-canvas title=x\n" + good + "\n```", true],
];

for (const [name, md, shouldMount] of cases) {
  for (const streaming of [false, true]) {
    const html = renderRichHtml(md, streaming);
    const rawLeak = /<pre>/.test(html) && /language-astra-canvas/.test(html);
    const mount = html.includes("data-cv-mount");
    const pending = html.includes("data-cv-pending");
    // THE GUARANTEE: never a canvas code block.
    const ok = !rawLeak && (mount || pending) && mount === shouldMount;
    results.push({
      name: `${name}${streaming ? " [stream]" : ""}`,
      ok,
      detail: `pre=${/<pre>/.test(html)} mount=${mount} pending=${pending} rawLeak=${rawLeak}`,
    });
  }
}

// Control: an ordinary code fence must still be a code block.
{
  const html = renderRichHtml("p\n\n```js\nconst x = 1;\n```", false);
  results.push({
    name: "CONTROL: normal code fence",
    ok: /<pre>/.test(html) && /const x = 1/.test(html) && !html.includes("data-cv-pending"),
    detail: "must still render as <pre>",
  });
}

// The mount marker must be emitted for a PARSEABLE body, and must never carry
// the payload. (L1 was deliberately simplified: splitCanvasBlocks already claims
// every parseable fence, so the marker only has to stop a second paint. It
// therefore carries NO spec — proven here, so nobody re-adds one by accident.)
{
  const html = renderRichHtml("```astra-canvas\n" + good + "\n```", false);
  const box = document.createElement("div");
  box.innerHTML = html;
  const mount = box.querySelector("[data-cv-mount]");
  const carriesSpec = !!box.querySelector("[data-cv-spec]");
  const leaksJson = /&quot;v&quot;|\{\\?"v\\?"/.test(html);
  results.push({
    name: "parseable fence: marker, no payload",
    ok: !!mount && !carriesSpec && !leaksJson,
    detail: `mount=${!!mount} carriesSpec=${carriesSpec} payloadInHtml=${leaksJson}`,
  });
}

// The label must tell the two dead-end cases apart (2026-10-05): a body still
// arriving says "Generating Data Points…"; a FINISHED-but-unusable payload says
// so plainly, because no repair tier can rescue it (measured sync=0 async=0).
{
  const label = (body: string) => {
    const box = document.createElement("div");
    box.innerHTML = renderRichHtml("```astra-canvas\n" + body + "\n```", false);
    // Read the TEXT, not the markup: an escaped ellipsis is still an ellipsis,
    // and asserting on the raw HTML made this test lie about a working feature.
    return (box.querySelector("[data-cv-pending]")?.textContent ?? "").trim();
  };
  const truncated = label('{"v":1,"blocks":[{"type":"kpi","label":"A","val');
  // A COMPLETE but unusable payload: brackets balanced, but not a canvas spec.
  // (The old probe used "not json at all {{{" — three unbalanced braces, so it was
  // correctly classified as still-arriving. The input was wrong, not the code.)
  const garbage = label("[1,2,3]");
  results.push({
    name: "label: truncated body says Generating",
    ok: /Generating Data Points/.test(truncated),
    detail: truncated,
  });
  results.push({
    name: "label: balanced-but-unusable says so",
    ok: /could not be read/i.test(garbage),
    detail: garbage,
  });
}

// Frame-by-frame sweep of a realistic streaming reveal: no frame may ever paint
// the canvas body as code. This is the exact thing the user saw.
{
  const full = "Intro prose.\n\n```astra-canvas\n" + big + "\n```\n\nClosing prose.";
  let leaks = 0, frames = 0, first = "";
  for (let n = 0; n <= full.length; n++) {
    frames++;
    const html = renderRichHtml(full.slice(0, n), true);
    if (/<pre>/.test(html) && /language-astra-canvas/.test(html)) { leaks++; if (!first) first = `n=${n}`; }
  }
  results.push({
    name: `streaming sweep (${frames} frames)`,
    ok: leaks === 0,
    detail: leaks === 0 ? "zero leaking frames" : `${leaks} leaking frames, first ${first}`,
  });
}

(window as unknown as { __results: R[] }).__results = results;
(window as unknown as { __done: boolean }).__done = true;