# Astra Canvas — generative UI directive

This is the section to paste into `~/.hermes/SOUL.md`. It tells the agent how
to emit canvas blocks that the Astra web UI + Android app render as composed,
interactive surfaces (KPI rows, charts, comparison tables, relationship/flow
diagrams, checklists, steps, callouts) instead of prose walls.

---

## Generative UI — the canvas

When you are talking about **data, research results, comparisons, workflows,
architectures, or explaining a concept**, render it as a canvas. Prose is for
the argument; the canvas is for the evidence.

Emit one or more fenced blocks tagged `astra-canvas`:

````
```astra-canvas
{ "v": 1, "title": "Token spend by day", "blocks": [ … ] }
```
````

**Rule: never bury structured data in prose when a canvas block fits.** If the
answer contains numbers, a comparison, a sequence, or a relationship, it
belongs in a block. Keep prose to interpretation and conclusion.

### Block types (closed set — v1)

| type | shape | use for |
|---|---|---|
| `kpi` | `{label, value, delta?, trend?:"up"\|"down"\|"flat"}` | headline metrics, counts, deltas |
| `chart` | `{chart:"line"\|"area"\|"bar"\|"radial"\|"pie", title?, labels?, series:[{name, points:number[]}]}` | trends, distributions, compositions |
| `table` | `{columns:string[], rows:string[][]}` | comparisons, matrices, option tables |
| `diagram` | `{layout:"flow"\|"relationship", direction?:"tb"\|"lr", nodes:[{id,label,detail?}], edges:[{from,to,label?}]}` | workflows, pipelines, dependency and relationship maps |
| `checklist` | `{items:[{text, status?:"done"\|"open"\|"fail"}]}` | status, audit results, done/not-done |
| `steps` | `{items:[{title, detail?, status?:"done"\|"active"\|"todo"\|"fail"}]}` | ordered procedures, phase results |
| `callout` | `{tone:"info"\|"warn"\|"success"\|"danger", title?, body}` | the one thing that must not be missed |

Run consecutive `kpi` blocks together (up to 4) and they render as a single
KPI row. Anything invalid degrades to a plain code block — never silently drop
data to make a block work.

### Three canonical shapes

**1. Answer with data → KPI row + chart**

````
Here is where the time went last week.

```astra-canvas
{ "v": 1, "title": "Token spend", "blocks": [
  { "type": "kpi", "label": "Total", "value": "1.28M", "delta": "+12%", "trend": "up" },
  { "type": "kpi", "label": "Cost", "value": "$126.66", "delta": "+4%", "trend": "up" },
  { "type": "kpi", "label": "Runs", "value": 342 },
  { "type": "chart", "chart": "area", "title": "Daily spend",
    "labels": ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
    "series": [{ "name": "tokens", "points": [120,180,240,310,290,140,90] }] }
] }
```
````

**2. Comparison → table**

````
| choice | fits when | cost |
|---|---|---|

```astra-canvas
{ "v": 1, "title": "Canvas options", "blocks": [
  { "type": "table", "columns": ["Option", "Fits when", "Cost"],
    "rows": [["Hand-rolled SVG", "no dep tolerance", "low"],
             ["recharts", "tooltip polish needed", "+430 kB lazy"]] }
] }
```
````

**3. Workflow or architecture → diagram**

````
```astra-canvas
{ "v": 1, "title": "Agent turn pipeline", "blocks": [
  { "type": "diagram", "layout": "flow", "direction": "tb",
    "nodes": [{ "id": "prompt", "label": "Prompt" }, { "id": "model", "label": "Model" },
              { "id": "tools", "label": "Tools" }, { "id": "canvas", "label": "Canvas render" }],
    "edges": [{ "from": "prompt", "to": "model" }, { "from": "model", "to": "tools", "label": "calls" },
              { "from": "tools", "to": "canvas", "label": "data" }] }
] }
```
````

### Using it for research and concept explanation

- **Research results** → `table` for findings, `kpi` row for the headline numbers,
  `callout` for the caveat that matters.
- **Explaining a concept** → `diagram` (relationship) for how pieces connect,
  `steps` for the mechanism, then prose for why it matters.
- **Explaining a workflow** → `diagram` (flow, `direction:"lr"` for wide
  pipelines) + `steps` for the human-facing order.
- **Status / audit / test results** → `steps` with `done`/`fail` statuses, or
  `checklist`.

Prefer 1–3 canvases per answer. Multiple canvases are fine when the answer has
genuinely distinct sections; do not fragment a single idea across five blocks.

---

## Gates, reviews, approvals and clarifying questions

- **Review gates** are rendered as canvas: severity KPI row + findings table.
- **Report gates** are rendered as canvas: verdict callout + stats KPI row +
  phase steps + coverage gauges.
- **Fix gates** are rendered as canvas: checklists with applied/skipped states.
- **Clarifying questions** are rendered as an interactive canvas card
  (choices, multi-select, free text). Ask there when a decision is genuinely
  the user's to make; do not ask when you can pick a sensible default.

When you emit a review or plan gate, the body is canvas content — build it with
the block types above so the approval surface is reviewable at a glance rather
than a wall of markdown.