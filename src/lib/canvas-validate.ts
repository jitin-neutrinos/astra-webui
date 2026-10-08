// Canvas emission validator — STRICT gate for pipelines that promise schema
// conformance (structured-output tool calls, retry-with-feedback loops).
//
//   import { validateCanvasSpec } from "./canvas-validate";
//   const errs = validateCanvasSpec(jsonText);
//   if (errs.length) retryWithFeedback(errs);   // feed errs back to the model
//
// The RENDERER deliberately does NOT use this: chat-timeline's lenientJson
// ladder is looser by design (it repairs past violations the schema rejects).
// Schema source of truth: docs/canvas.schema.json, generated from
// canvas-schema.ts (ts-json-schema-generator; wrapper: blocks = array of
// CanvasBlock union). Regenerate on schema change:
//   npx ts-json-schema-generator --path src/lib/canvas-schema.ts \
//     --type CanvasBlock --no-type-check --out /tmp/cb.json
// then wrap: {v:const 1, blocks:{type:array, items:<cb.anyOf>, minItems:1}}.
//
// Browser-safe: no ajv — validation is hand-rolled from the same rules the
// generator encodes, kept in step by canvas-validate.check.mjs which compares
// this function's verdicts against the jsonschema library on golden shapes.

export interface CanvasIssue {
  path: string;      // "blocks.2.body" — dotted JSON path
  message: string;   // human-readable, safe to feed back to a model
}

const TONES = new Set(["info", "warn", "success", "danger", "pro", "neutral"]);

export function validateCanvasSpec(raw: string): CanvasIssue[] {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return [{ path: "(json)", message: "body is not valid JSON" }]; }
  const issues: CanvasIssue[] = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return [{ path: "(root)", message: "card must be a JSON object {v:1, blocks:[...]}" }];
  }
  const obj = data as Record<string, unknown>;
  if (obj.v !== 1) issues.push({ path: "v", message: 'must be exactly 1' });
  if (!Array.isArray(obj.blocks)) {
    issues.push({ path: "blocks", message: 'missing required "blocks" array — every block goes inside it (block-type names as top-level keys are NOT a valid card)' });
    return issues;
  }
  obj.blocks.forEach((b, i) => {
    for (const e of validateBlock(b, `blocks.${i}`)) issues.push(e);
  });
  if (obj.title !== undefined && typeof obj.title !== "string") issues.push({ path: "title", message: "must be a string" });
  if (obj.page !== undefined && !["a4", "slide", "auto"].includes(String(obj.page))) issues.push({ path: "page", message: 'must be "a4", "slide" or "auto"' });
  return issues;
}

function validateBlock(b: unknown, path: string): CanvasIssue[] {
  if (!b || typeof b !== "object" || Array.isArray(b)) {
    return [{ path, message: "block must be an object with a type field" }];
  }
  const blk = b as Record<string, unknown>;
  const type = blk.type;
  const out: CanvasIssue[] = [];
  const need = (cond: boolean, field: string, why: string) => {
    if (!cond) out.push({ path: `${path}.${field}`, message: why });
  };
  switch (type) {
    case "callout":
      need(blk.tone === undefined || TONES.has(String(blk.tone)), "tone", `tone must be one of ${[...TONES].join("|")}`);
      need(typeof blk.body === "string", "body", "callout needs a body string (detail: is accepted by the renderer but not by this strict schema)");
      break;
    case "kpi":
      need(typeof blk.label === "string" || typeof blk.name === "string", "label", "kpi needs label (or name)");
      need(blk.value !== undefined, "value", "kpi needs a value");
      break;
    case "table":
      need(Array.isArray(blk.columns), "columns", "table needs columns[]");
      need(Array.isArray(blk.rows), "rows", "table needs rows[] (arrays of strings)");
      break;
    case "checklist":
      need(Array.isArray(blk.items), "items", "checklist needs items[] ({text,status})");
      break;
    case "steps":
      need(Array.isArray(blk.items), "items", "steps needs items[] ({title,status})");
      break;
    case "badges":
      need(Array.isArray(blk.items), "items", "badges needs items[] ({label,tone})");
      break;
    case "code":
      need(typeof blk.code === "string", "code", "code block needs a code string");
      break;
    case "chart":
      need(typeof blk.chart === "string", "chart", "chart needs a chart kind (line|bar|pie|…)");
      need(Array.isArray(blk.series), "series", "chart needs series[]");
      break;
    default:
      out.push({ path: `${path}.type`, message: `unknown block type "${String(type)}"` });
  }
  return out;
}
