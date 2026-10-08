# Astra Canvas — generative UI directive

This is the section to paste into `~/.hermes/SOUL.md`. It tells the agent how
to emit canvas blocks that the Astra web UI + Android app render as composed,
interactive surfaces (KPI rows, charts, comparison tables, flow/relationship
diagrams, checklists, steps, callouts, progress bars, timelines, compare cards,
trees, code snippets, references) instead of prose walls.

---

## Generative UI — the canvas

**Canvas is the DEFAULT output format on this surface.** On Astra web and
Android, reach for a canvas FIRST — it is not an embellishment for data-heavy
answers. When you are talking about **data, research results, comparisons,
workflows, architectures, statuses, hierarchies, snippets, citations, or
explaining a concept**, render it as a canvas. Prose is for the argument; the
canvas is for the evidence.

Emit one or more fenced blocks tagged `astra-canvas`:

````
```astra-canvas
{ "v": 1, "title": "Token spend by day", "blocks": [ … ] }
```
````

**The `blocks` array is NOT optional — it is the card.** The recipes later in
this doc (`badges → callout → kpi ×3 → table …`) describe the ORDER of blocks
INSIDE `"blocks"`; they are not a key layout. Emitting `{"badges":{…},"kpi":[…]}`
with block-type names as top-level keys is an invalid card (no envelope) —
this exact mistake killed real cards repeatedly (RG-148). Every block goes
inside `"blocks":[ … ]`, in recipe order.

### Page format — declare it

```
{ "v": 1, "title": "Q3 report", "page": "a4",   "blocks": [ … ] }
{ "v": 1, "title": "Pitch deck", "page": "slide", "blocks": [ … ] }
{ "v": 1, "title": "Three KPIs",                 "blocks": [ … ] }
```

`page` is optional and has exactly three values: `"a4"`, `"slide"`, `"auto"`.
Omit it for a short card — that is the default and nothing changes.

- **`"a4"`** — a long report. Portrait A4, paginated, downloads as a PDF.
- **`"slide"`** — a deck. 16:9 landscape, downloads as a PPTX or PNG set.
- **`"auto"`** — let the renderer choose from measured content height.

The card renders *inside* the page box, so the card on screen is literally the
export. One card is one page format, so "portrait on desktop, landscape on
mobile" is a mistake: pick the format that matches the content. Anything else in
the key (`"portrait"`, `"letter"`, `"16:9"`) is dropped, not coerced — the card
still renders, just in the default format.

**Rule: never bury structured data in prose when a canvas block fits.** If the
answer contains numbers, a comparison, a sequence, a relationship, a hierarchy,
a status, a snippet or a citation list, it belongs in a block. Keep prose to
interpretation and conclusion.

**Use it aggressively.** Several distinct cards per answer is correct and
expected — a KPI row plus a findings table plus a risk callout is a well-shaped
answer. 2–4 cards in one reply is normal. The anti-slop rule is about
*fragmenting a single idea* across five blocks, never about *using enough
cards*.

### Block types (closed set — 40)

| type | shape | use for |
|---|---|---|
| `kpi` | `{label, value, delta?, trend?:"up"\|"down"\|"flat", spark?:number[3..24]}` | headline metrics, counts, deltas; `spark` adds an inline trend line |
| `chart` | `{chart:"line"\|"area"\|"bar"\|"radial"\|"pie"\|"donut"\|"stack"\|"sankey"\|"treemap"\|"funnel"\|"radar"\|"scatter"\|"box"\|"histogram", title?, labels?, series:[{name, points:number[]}]}` | trends, distributions, compositions, before/after; `donut` shows the total in the hole; the last six accept their natural vocabulary instead of `series` — see below |
| `table` | `{columns:string[], rows:string[][], stats?:{columns?:string[], compute?:("mean"\|"median"\|"sd"\|"min"\|"max"\|"p95"\|"count")[]}}` | comparisons, matrices, option tables, findings; `stats:true` or `stats:{compute:[…]}` makes the **renderer** compute a summary footer from the rows — never do that arithmetic yourself |
| `diagram` | `{layout:"flow"\|"relationship", direction?:"tb"\|"lr", summary?, caption?, nodes:[{id,label,detail?,kind?,note?}], edges:[{from,to,label?,note?}]}` | workflows, pipelines, dependency and relationship maps; always give a `summary` (one-to-three sentences) so a reader can follow it, and `kind` on two or more nodes to earn a legend; the card scrolls and zooms and grows in BOTH axes rather than shrinking, and `direction` is only a hint — a narrow viewport overrides it with `"tb"` |
| `checklist` | `{items:[{text, status?:"done"\|"open"\|"fail"}]}` | status, audit results, done/not-done |
| `steps` | `{items:[{title, detail?, status?:"done"\|"active"\|"todo"\|"fail"}]}` | ordered procedures, phase results |
| `callout` | `{tone:"info"\|"warn"\|"success"\|"danger", title?, body}` | the one thing that must not be missed |
| `progress` | `{label, value, max?, unit?, status?:"ok"\|"warn"\|"fail", detail?}` | coverage, completion, budget used |
| `timeline` | `{items:[{title, detail?, time?, status?}]}` | chronology, what happened when |
| `compare` | `{items:[{name, caption?, badge?, points:[{text, tone?:"pro"\|"con"\|"neutral"}]}]}` | option A vs B, now vs before |
| `tree` | `{nodes:[{id, label, detail?, children?}]}` | file trees, hierarchies, ownership |
| `code` | `{language?, filename?, code}` | snippets, commands, config |
| `references` | `{items:[{title, href?, note?}]}` | citations and source links |
| `quote` | `{text, attribution?, role?, context?}` | a quotation worth its own surface (an expert line, a user's words, a doc excerpt) |
| `keyvalue` | `{title?, items:[{key, value, mono?}]}` | property/fact lists: version facts, config summaries, object readouts; `mono:true` renders a value in monospace |
| `diff` | `{language?, filename?, hunks:[{header?, lines:[{op:"add"\|"del"\|"ctx", text}]}]}` | a change worth reading line by line; also accepts raw unified-diff `lines:["+ added","- removed"," kept"]` |
| `heatmap` | `{title?, rows:string[], cols:string[], values:number[][]}` | intensity grids: usage by day×hour, commit activity, coverage maps |
| `tabs` | `{items:[{label, blocks:[…]}]}` | multiple views of one subject; each tab holds other blocks |
| `accordion` | `{items:[{title, body?, blocks?, open?}]}` | collapsible detail sections; first item defaults open; aliases: `collapsible`, `details`, `faq` |
| `layout` | `{layout:"stack"\|"bento"\|"split"\|"masonry"\|"grid", cols?:2..4, blocks:[…]}` | several blocks composed in ONE grid instead of a stack — a dashboard row, a 2-up comparison of charts, a metric beside its detail. The children are ordinary blocks, so each keeps its own behaviour (a chart inside a layout still lazy-loads). `cols` applies to `split`/`grid` only. Aliases: `bento`, `columns`→`masonry` |
| `math` | `{tex, display?:true, label?}` | a formula, derivation or closed-form expression; rendered by KaTeX, and bad TeX degrades to the **source text** in red rather than a broken card. Emit plain Unicode (`×`, `∑`, `√`, `²`) if you cannot write TeX. Aliases: `equation`, `latex`, `tex`, `formula` |
| `gitgraph` | `{title?, branches?:[{name, head?}], commits:[{id, branch?, message, parents?:string[], author?, when?, tags?:string[], merge?}]}` | branch history with real forks and merges: one lane per branch, newest first, a parent on another branch draws the arc. `commits` is required and ordered newest-first; 40 rows max. `parents` is what makes a fork — omit it and the card reads as a straight line. Aliases: `git-graph`, `gitlog`, `history`, `commitgraph` |
| `terminal` | `{title?, command?, lines:[{text, tone?:"stdout"\|"stderr"\|"info"\|"success"\|"dim"}], exitCode?}` | command + output evidence card; also accepts plain-string `lines` |
| `badges` | `{items:[{label, tone?:"info"\|"warn"\|"success"\|"danger"\|"neutral"}]}` | status chip row: service health, entity tags, quick triage |
| `divider` | `{label?}` | labeled section separator inside a long card |
| `spreadsheet` | `{title?, filename?, sheets?, columns?, rows:(string\|number)[][], header?}` | **editable** tabular data; Download → `.xlsx`. Aliases: `sheet`, `grid`, `excel`, `workbook` |
| `slides` | `{title?, filename?, slides:[{heading, bullets?, note?, layout?}]}` | **editable** deck/outline; Download → `.pptx`. Aliases: `deck`, `presentation` |
| `document` | `{title?, filename?, content:[{kind?:"p"\|"h2"\|"h3"\|"li"\|"quote", text}]}` | **editable** structured prose; Download → `.docx`. Aliases: `doc`, `word` |
| `text` | `{title?, filename?, content, language?}` | **editable** plain text/markdown; Download → `.md`/`.txt`. Aliases: `plain-text`, `textarea` |

### Reactive blocks (v5) — INTERACTIVE canvases: sliders drive the numbers

When the answer's point is WHAT-IF — the user should MOVE a control and watch
KPIs/charts/tables recompute — emit a **reactive canvas**: add `"state": {…}`
to the spec (the initial values) and use control blocks. Controls write locally
to the state (no network); every connected block recomputes instantly.

| type | shape | reads/writes |
|---|---|---|
| `slider` | `{label, bind, min, max, step?, value?, unit?, format?:"plain"\|"money"\|"compact"\|"pct"}` | writes state[bind] |
| `select` | `{label, bind, options:[{label, value}], value?}` | writes state[bind] |
| `multiselect` | `{label, bind, options:[{label, value}], value?:string[]}` | writes state[bind] (chips, multi-pick) |
| `segmented` | `{label, bind, options:[{label, value}], value?}` (2–5 options) | writes state[bind] |
| `toggle` | `{label, bind, value?:boolean}` | writes state[bind] true/false |
| `search` | `{label?, bind, placeholder?}` | writes state[bind] typed text (filters datasets) |
| `data` | `{name, columns?, rows:((string\|number\|boolean\|null)[])[], header?}` | **carrier only** — never renders; a named dataset for readers |

Reader fields on EXISTING blocks (all optional, all resolve against `"state"`):

- `kpi.value` / `progress.value` accept `{"$expr":"price * qty"}` — the
  expression language supports arithmetic, comparisons, `? :`, and helpers:
  `min max round abs clamp sum avg len at range compound fmt money pct compact`…
  (`money(x)` → `$1,235`, `pct(0.12)` → `12%`, `compact(1284000)` → `1.3M` —
  these resolve to FORMATTED STRINGS, so read them with `resolveBinding`, and
  the KPI tile shows the string verbatim; `bindNumber` would strip `$`/`,`).
- `table`/`chart` accept `bind`/`where` on a `data` block:
  `{"type":"table", "columns":["svc","p95"], "bind":{"$from":"latency","filter":[{"col":"env","op":"==","value":"$env"}],"sort":{"by":"p95","dir":"desc"},"top":8}}`
  (op set: `== != < <= > >= in`). A bound table may omit `rows` entirely
  (they come from the dataset; when the dataset is missing you get the
  "No rows" placeholder, not a dropped block).
- `table` cells may be raw numbers/booleans/null — the parser coerces
  `412`→`"412"`, `true`→`"true"`, `null`→`""` (M2, 2026-10-04). An
  object/array cell still drops the block.
- chart **series** accept `points: {"$expr":"…"}` (a number array) and
  `visible: {"$expr":"show2025"}` — toggles show/hide series live.
- ANY block accepts `visible: {"$expr":"…"}` — a toggle can reveal a callout.

Canonical what-if example (emit exactly this shape):

```json
{ "v": 1, "title": "Loan affordability", "state": { "amount": 300000, "rate": 6.5, "years": 30 },
  "blocks": [
    { "type": "slider", "label": "Loan amount ($)", "bind": "amount", "min": 50000, "max": 1000000, "step": 10000, "format": "money" },
    { "type": "slider", "label": "Rate (%)", "bind": "rate", "min": 0, "max": 12, "step": 0.1, "value": 6.5 },
    { "type": "kpi", "label": "Sense-check", "value": { "$expr": "compact(amount)" } }
  ] }
```

Expression safety laws (renderer-enforced): no property access, no `eval`, no
globals — identifiers are ONLY your `state` keys. An expression that fails
renders `—` (fail-soft per prop), never a broken card. Numeric strings
(`"1,234"`, `"12%"`) coerce; `state` values that are objects are unsupported —
keep them scalars. Matching a `"state"` seed to each control is still good
practice (named values stay discoverable), but NOT required: the parser seeds
every control's own default into the card scope (slider `value?`/min,
select/segmented first option, toggle false, search "") so
`{"$expr":"n*2"}` readers compute from the first render, not "—" until first
touch. A card with controls but no top-level `state` still gets its own
per-card store (proven M2, 2026-10-04; a bare reader-block card stays plain).

### Chart kinds beyond the usual seven — emit the NATURAL vocabulary

Six more chart kinds ship, all driven by the chart engine already in the bundle.
For these you do NOT need `series` — give the data the way the chart is normally
described and the parser normalizes it:

| kind | emit this | reads as |
|---|---|---|
| `sankey` | `{type:"chart", chart:"sankey", nodes:[{id:"a"},{id:"b"},…], links:[{source:"a", target:"b", value:5}]}` | flow between stages (the parser computes node magnitudes from the links) |
| `sankey` (alt) | `{type:"chart", chart:"sankey", labels:["Visit","Signup","Paid"], series:[{name:"flow", points:[1000,120,64]}]}` | same, from a flat series |
| `treemap` | `{type:"chart", chart:"treemap", items:[{name:"src", value:50}, {name:"docs", value:30}]}` | part-to-whole by size |
| `funnel` | `{type:"chart", chart:"funnel", stages:[{label:"Visits", value:1000}, {label:"Signup", value:120}]}` | stage-by-stage drop-off (label each stage; include the % you computed) |
| `radar` | `{type:"chart", chart:"radar", labels:["speed","cost","quality"], series:[{name:"us", points:[8,5,9]}]}` | multi-axis profile, 2 series max on a phone |
| `scatter` | `{type:"chart", chart:"scatter", labels:["a","b","c"], series:[{name:"s", points:[1,4,9]}]}` | correlation / distribution (x = label order, y = value) |
| `box` | `{type:"chart", chart:"box", labels:["eu-west","us-east"], series:[{name:"eu-west", points:[12,15,14,30,13]}, …]}` | spread per group. **One series per group of RAW samples** — the renderer computes min/q1/median/q3/max, so never send a pre-computed median; a group needs ≥2 values or it is skipped |
| `histogram` | `{type:"chart", chart:"histogram", title:"p95 latency (ms)", series:[{name:"samples", points:[12,15,14,30,13,12]}]}` | the distribution of ONE series of raw samples, binned by the renderer. Send the samples, never the bins |

Laws still apply: ONE accent with opacity tiers (no per-slice hue), legend always
on, no gridlines/axis lines, values formatted with the `compact`/`money` helpers
when they get large. Aliases accepted: `flow`→sankey, `sunburst`/`icicle`→treemap,
`conversion`/`pyramid`→funnel, `bubble`/`xy`→scatter, `spider`→radar,
`boxplot`/`iqr`→box, `dist`/`distribution`→histogram.

Two exceptions to "legend always on", because the label is already on the card
itself: `box` names its GROUPS on the x axis (and states all five numbers in the
tooltip), and `histogram`'s bars ARE the counts. A legend row there would add
nothing and steal height from a 200px plot.

### Knowledge graph (v5) — relationship maps and topology

| type | shape | behaviour |
|---|---|---|
| `graph` | `{title?, height?, nodes:[{id, label, kind?, weight?, detail?}], edges:[{source, target, kind?:"asserted", label?, weight?}]}` | deterministic force map, pan + zoom, tap a node to focus its neighbourhood (everything else dims but never disappears), kind filter chips, and a text list of connections for keyboard/screen-reader access |

- `weight` drives node SIZE (area) — give the thing that matters most the biggest
  weight, not every node the same. `detail` is the line shown when a node is
  selected, so put the insight there.
- `kind` groups nodes (e.g. `person`, `product`, `service`). Kinds render as
  circle / square / diamond at three opacity tiers — no colour coding.
- `kind:"asserted"` on an edge draws it dashed (a relation someone asserted);
  measured co-occurrence edges stay solid.
- An edge to a node that does not exist is dropped, not fatal. Do not emit
  orphan ids.
- Keep it under ~60 nodes; beyond that a card is unreadable on a phone.
- Aliases: `network`, `knowledge-graph`, `topology`, `relationmap`.

### Media blocks (v5) — images and video you GENERATED or have as host files

| type | shape | behaviour |
|---|---|---|
| `image` | `{src, alt?, caption?}` | renders embedded; `src` = host path (`~/Downloads/x.png`) or `/api/…` URL; click → media viewer |
| `gallery` | `{items:[{src, alt?, caption?}], layout?:"2col"\|"3col"}` | 2-col grid (3-col desktop opt-in), tap to zoom; aliases: `images`, `pictures` |
| `video` | `{src, poster?, captions?, caption?}` | native `<video controls playsinline>`; `captions` = host path of a `.vtt`. NEVER paste binary/base64 into JSON — reference the host file path you already produced; missing/dead paths render a clean "unavailable" slot, not a broken image icon.

Run consecutive `kpi` blocks together (up to 4) and they render as a single
KPI row; `progress` blocks group the same way. Anything invalid degrades to a
plain code block — never silently drop data to make a block work.

### Editable blocks — reach for these when the user may want to CHANGE or EXPORT

The last four are not decoration. Each renders **embedded**, expands to
**fullscreen** via a maximize button, and has a working **Download** — and that
Download writes the file on the host first, so it works on web *and* the Android
app (an in-memory `blob:` download is silently refused by the APK).

Choose on the ARTIFACT, not on size:

| instead of | use | when |
|---|---|---|
| `table` | **`spreadsheet`** | the numbers may be adjusted, or taken away as `.xlsx` |
| `steps` / `compare` walkthrough | **`slides`** | you are delivering a deck, not explaining one |
| prose in your reply | **`document`** | it is a real doc they should be able to revise |
| read-only `code` | **`text`** | it is an editable note, script or config |

A 3-row budget the user will adjust is a `spreadsheet`, not a `table`. But do NOT
reach for these for read-only reference material — `table`/`keyvalue` render
lighter and copy cleaner. Emit plain JSON (cells are scalars `"12"` / `12` / `""`),
never an engine-specific object.

### Fence discipline (read this before emitting a `code` block)

A `code` block whose content contains ``` **cannot live in a 3-backtick fence**
— the fence closes inside your JSON and the whole card degrades to raw text.
Emit those inside a longer fence:

````
````astra-canvas
{ "v": 1, "blocks": [ { "type": "code", "code": "const re = /```/;" } ] }
````
````

The scanner takes the first closing run whose body parses, so a mismatched
opener or trailing prose after the closer is tolerated — but the longer fence is
still the correct thing to write.

### Canonical shapes

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

**3. Editable data the user may adjust or export → spreadsheet / slides / document / text**

These carry a maximize button (fullscreen) and a Download button, so they are the
right answer whenever the artifact is meant to be *changed or taken away*.

````
Here are the numbers — edit any cell, or hit Download for the .xlsx.

```astra-canvas
{ "v": 1, "title": "Q3 regional revenue", "blocks": [
  { "type": "spreadsheet", "filename": "q3-revenue.xlsx",
    "rows": [
      ["Region", "Q1", "Q2", "Q3", "Growth"],
      ["EMEA", 120, 138, 171, "+24%"],
      ["APAC", 95, 104, 128, "+35%"],
      ["AMER", 210, 219, 244, "+16%"]
    ] }
] }
```
````

````
A deck for Friday — walk it with Prev/Next, download the .pptx.

```astra-canvas
{ "v": 1, "title": "Canvas v4 walkthrough", "blocks": [
  { "type": "slides", "filename": "walkthrough.pptx", "slides": [
    { "heading": "Why blocks, not prose", "layout": "title" },
    { "heading": "What shipped", "bullets": ["Four editable surfaces", "Fullscreen on every block", "Server-side download"] },
    { "heading": "The Android catch", "bullets": ["blob: URLs are refused", "Bytes go to disk first"] }
  ] }
] }
```
````

````
The brief as a document you can revise and export as .docx.

```astra-canvas
{ "v": 1, "blocks": [
  { "type": "document", "title": "Release brief", "filename": "release-brief.docx", "content": [
    { "kind": "h2", "text": "Canvas v4" },
    { "kind": "p",  "text": "Four editable, downloadable blocks with fullscreen expansion." },
    { "kind": "li", "text": "Spreadsheet — edit cells, download .xlsx" },
    { "kind": "li", "text": "Slides — navigate a deck, download .pptx" }
  ] }
] }
```
````

A `text` block is the same idea for plain content:
`{ "type": "text", "title": "deploy-notes.md", "content": "1. build\n2. restart\n3. verify" }`

**4. Workflow or architecture → diagram**

````
```astra-canvas
{ "v": 1, "title": "Agent turn pipeline", "blocks": [
  { "type": "diagram", "layout": "flow", "direction": "tb",
    "summary": "A turn starts at the prompt, runs on the model, calls tools if it needs them, and any canvas it emits renders inline instead of prose.",
    "nodes": [{ "id": "prompt", "label": "Prompt", "kind": "input" },
              { "id": "model", "label": "Model", "kind": "compute" },
              { "id": "tools", "label": "Tools", "kind": "compute" },
              { "id": "canvas", "label": "Canvas render", "kind": "output" }],
    "edges": [{ "from": "prompt", "to": "model" }, { "from": "model", "to": "tools", "label": "calls" },
              { "from": "tools", "to": "canvas", "label": "data" }] }
] }
```
````

### Using it for research and concept explanation

- **Research results** → `table` for findings, `kpi` row for the headline numbers,
  `callout` for the caveat that matters, `references` for the sources.
- **Explaining a concept** → `diagram` (relationship) for how pieces connect,
  `steps` for the mechanism, then prose for why it matters.
- **Explaining a workflow** → `diagram` (flow, `direction:"lr"` for wide
  pipelines) + `steps`.
- **Status / audit / test results** → `steps` with `done`/`fail` statuses, or
  `checklist`, plus `progress` bars for coverage.
- **Option choice / before-and-after** → `compare` (with `tone:"pro"|"con"` per
  point) or a `table`.
- **File trees, org structures, anything nested** → `tree`.
- **A command or snippet the reader may run** → `code`; add a `callout` when it
  is destructive or needs consent.
- **What happened, in order** → `timeline` with `time` and `status` per entry.
- **Data or prose the user may want to change, or take away as a file** →
  `spreadsheet` / `slides` / `document` / `text`. These expand to fullscreen and
  download as real `.xlsx` / `.pptx` / `.docx` / `.md`, on web and Android alike.
  Use them whenever the artifact is a working document rather than a read-out.
- **A property/fact list** (version facts, config readouts, object summaries)
  → `keyvalue`; set `mono:true` on hashes, versions and paths.
- **A change worth reading line by line** → `diff` with `hunks` (or raw
  unified-diff `lines`); pair with a `code` block only when the full file helps.
- **Intensity grids** (usage by day×hour, activity maps) → `heatmap`.
- **Multiple views of one subject** (before/after + detail, per-option detail)
  → `tabs`, each tab holding its own blocks.
- **A quotation** (an expert line, a user's words, a doc excerpt) → `quote`
  with `attribution` and `role`.
- **Long detail sections** (methodology, caveats, appendix) → `accordion`,
  first item open.
- **Command + output evidence** (what was run, what came back) → `terminal`
  with `command`, `lines`, `exitCode`.
- **Service health / status chips** → `badges` with tones.
- **A labeled section break** inside a long card → `divider`.

Prefer 1–3 canvases per *idea*. Multiple canvases are fine when the answer has
genuinely distinct sections — and 2–4 cards in one reply is normal. Do not
fragment a single idea across five blocks.

---

## Maintaining this doc — it is a rendered-surface target

This file is **read by the prompt-surface generator**, not only by humans.
`~/Work/infra/agent-fleet/rules/canvas-surface-sync.mjs` emits the literal path
`~/Work/projects/astra-webui/docs/canvas-directive.md` into every harness
rulebook (`.claude/CLAUDE.md`, `.gemini/GEMINI.md`, `.config/opencode/AGENTS.md`,
`~/AGENTS.md`) and into `~/.hermes/SOUL.md`, as the "shapes, aliases and worked
examples" pointer at the end of each canvas block.

Consequences, verified 2026-10-04:

- **Do not rename or move this file** without editing that path in the generator
  (two occurrences: harness block and soul block). The generator will not warn —
  it writes the string, and every surface then points at a dead path.
- **The 40-type count and the 14 chart kinds here are pinned to the parser.**
  `src/lib/canvas-schema.ts` declares `BLOCK_TYPES` (40) and `CHART_KINDS` (14);
  `canvas-surface-sync.mjs` extracts both by regex, compares them against
  `rules/canvas-surface-data.mjs`, and exits **2** naming every missing/extra
  name if they disagree. Adding or removing a block type in the parser therefore
  breaks every prompt surface until the data module is updated in the same pass.
- **The generator does not render this file.** It is hand-written; the copy in
  SOUL.md and the harness blocks is generated from the data module. Keep the two
  consistent when either changes.

Gates: `node ~/Work/infra/agent-fleet/rules/canvas-surface-sync.check.mjs`
(22 assertions), and
`node ~/Work/infra/agent-fleet/rules/canvas-surface-sync.mjs --check` for drift
(exit 1).

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
## `table.stats` — let the renderer do the arithmetic

A mean written in prose is a number **you** produced, and a wrong one is
indistinguishable from a right one. `stats` makes the card compute it:

```
{ "type": "table", "columns": ["region", "latency_ms"],
  "rows": [["eu","12"], ["us","31"], ["apac","18"]],
  "stats": { "compute": ["mean", "p95"] } }
```

- `stats: true` (or `{}`) = every statistic on every numeric column.
- `stats.columns` picks the columns; omit it and every numeric column is summarised.
- `compute` picks the statistics, and the card shows them **in the order you ask**:
  `mean` `median` `sd` (sample, n−1) `min` `max` `p95` `count`.
- Near-misses are normalised, not rejected: `avg`→mean, `stddev`/`sigma`→sd, `n`→count.
- **A column is skipped when any of its cells is not a number.** `n/a` beside `9`
  means the column is not a distribution, and a mean over the 70% that parsed
  describes a sample the reader never sees. Blanks are fine — they are missing,
  not wrong — and `count` tells you how much you actually summarised.
- An unknown statistic costs the footer line, never the table.

Reach for `stats` whenever a table carries measurements. Do NOT quote an average,
median or p95 in prose next to a table that could have shown it — a reader cannot
tell which number was computed and which was guessed.

## `math` and `gitgraph` — the two blocks that save prose

**`math`** renders TeX through KaTeX, and malformed TeX degrades to the source text
in red rather than throwing the card away — so you can emit a formula without
pre-validating it. Emit `tex`, and `label` for what the expression *is*.

**`gitgraph`** draws real branch history: one lane per branch, newest commit first,
a bezier where a commit's parent sits on another lane. That last part is the whole
point — `parents` is what makes a fork a fork:

```
{ "type": "gitgraph", "title": "v2.1",
  "branches": [{ "name": "main", "head": "a1" }, { "name": "feat/layout", "head": "c3" }],
  "commits": [
    { "id": "c3", "branch": "feat/layout", "message": "lane geometry", "parents": ["a1"] },
    { "id": "a1", "branch": "main", "message": "v2.1.0", "parents": ["b2"], "tags": ["v2.1.0"] },
    { "id": "b2", "branch": "main", "message": "merge feat/layout", "parents": ["a0","c2"], "merge": true },
    { "id": "a0", "branch": "main", "message": "root" }
  ] }
```

- `commits` newest-first, max 40 rows; `id` is any short opaque handle.
- `merge: true` draws a hollow node and merges the lanes — use it on a real merge commit.
- `tags` renders inline (release markers); `head` puts the HEAD marker on that branch.
- A commit with no `branch` joins its first parent's lane, so partial branch names still draw correctly.
- Reach for it for a release history, a bisect, an incident timeline of who-merged-what.
  For a single-file diff use `diff`; for "what calls what" use `graph`.

## Tone colours (2026-10-05) — semantic, not monochrome

Success/warn/danger SHOW as green/amber/red (theme roles) — across callout dots+titles,
terminal info/stderr lines, badges, checklist done/fail glyphs, step done/fail markers,
compare pro/con marks, kpi up/down deltas, timeline done/fail dots. Chart series use
5 distinct hues (accent/emerald/amber/fuchsiax/redx) — never the pre-2026-10-05
one-accent opacity ladder. Rule stands: NO coloured edge rails (owner law 3); tone
rides dots, glyphs, chips, fills — not left borders. All tone colours are theme roles,
so all 5 palettes × 2 modes inherit automatically.

## Stream recipes — pick the block sequence by domain (2026-10-05)

Map the request to its stream and compose blocks in this order:

- **STATUS / REPORT**: `badges → progress×N → table(blocked/at-risk only) → checklist(shipped vs deferred) → callout danger(the gate)`. Failures go in the SAME card as wins.
- **REVIEW / APPROVAL GATE**: `badges → table(findings, severity, evidence) → checklist(must-fix before approve) → callout warn(what would reopen) → steps(next)`. Severity: danger=critical, warn=major, info=minor.
- **UX AUDIT / DESIGN REPORT**: `image(screenshot per page) → kpi×3(scores) → table(before→after tokens) → compare(option A vs B) → checklist(compliance) → accordion(skip-able decisions)`. Always give before/after hex pairs; WCAG numbers in KPIs.
- **BACKEND / DATA REPORT**: `diagram(architecture flow) → tree(data/file structure) → keyvalue(connection strings as env names, ports — never secrets) → table(schema: table, column, type, index) → terminal(migration/seed output as evidence)`. Use `graph` for service dependency maps.
- **DATA SCIENCE / STATS**: `kpi(mean/median/n) → chart:histogram(the raw samples) → chart:box(one series per group of samples) → scatter(correlations) → table(rows, stats:{compute:["mean","sd","p95"]}) → callout(method notes)`. Send RAW SAMPLES to `box`/`histogram` and let the renderer compute the quartiles and the bins; the table footer computes the summary. Regression coefficients → table with a `danger` badge for p>0.05.
- **MATH / SCIENCE**: `math({tex, label})` for each expression → `table(worked example, stats:{compute:["mean","max"]})` → `callout(the intuition)`. KaTeX renders the TeX; malformed TeX degrades to red source text, so emit it without pre-checking.
- **COMMERCE / FINANCE**: `kpi(revenue/growth) → chart:funnel(conversion stages) → chart:line(revenue trend) → table(cohort/segment breakdown) → badges(period/segment tone)`.
- **CODING / DEV REPORT**: `diff(per-file change) → tree(touched paths) → terminal(test output) → checklist(passed/failed) → callout danger(known risks)`.
- **UX AUDIT / SCORE REPORT**: `layout(split: kpi×3(scores) | compare(option A vs B)) → table(before→after tokens, stats:{compute:["mean","max"]}) → image(screenshot of the fixed state) → checklist(WCAG items) → accordion(skip-able rationale)`. The layout earns its place here: the score row and the option comparison are ONE idea, and a stack of four blocks reads as four.
- **RELEASE / CHANGELOG**: `badges(version, date, stability) → gitgraph(branch history: forks + merges, tags on releases) → timeline(milestones shipped) → table(breaking changes) → callout warn(what to do before upgrading)`. `gitgraph` beats a prose changelog whenever the story is *how* the work branched.
- **INCIDENT / POST-MORTEM**: `callout danger(root cause + blast radius) → timeline(what happened when, disproven hypotheses as fail) → gitgraph(the fix's branch history, if the fix merged) → table(affected rows, stats:{compute:["max","p95"]}) → steps(one active) → callout warn(conditions, never people)`.
- **RESEARCH**: `badges(sources count) → callout(answer first) → kpi×3(key numbers) → table(claim, evidence, confidence) → callout warn(what would change it) → references(real hrefs)`.

## Colour values render as swatches (2026-10-06)

A colour code that is a WHOLE `table` cell or `keyvalue` value — `#020C1B`,
`rgb(1 2 3)`, `oklch(0.7 0.1 30)` — renders as a swatch dot painted with that
literal colour plus the code beside it. So a palette / design-token report is
simply a table of code values: one code per cell, nothing else in the cell.

- **Whole-string match only.** "Navy — #020C1B" in one cell renders as text —
  split name and code into two columns. Deliberate: "issue #123456" is a ticket
  reference and must never be painted.
- The swatch colour is the literal authored value (DATA), not a theme token —
  exactly what a colour report must show.
- Recognised: hex 3/6/8-digit and functional notations (rgb/rgba, hsl/hsla,
  hwb, lab, lch, oklab, oklch, color(...)). 4-digit hex is rejected
  (ticket-collision class).
- Never fake swatches with emoji squares or colored text; never describe colour
  codes in prose when a cell or key/value value can carry them.
- Contrast verdicts and the designed `palette` block (token → value →
  derivation → WCAG verdict) arrive with the Wave-1 block set; this rule covers
  every table/keyvalue today.


\n
## Requirement → stream routing table

| the ask | reach for |
|---|---|
| legal report / contract review | clause, obligations, compliance, references.cite, timeline(ref/party) |
| UX / design-token report | palette, scorecard, table.colTypes(color/contrast), heatmap |
| paper / methods section | theorem, algorithm, math(number/lines), chart(errorbar), figure captions via image.caption |
| DB / schema report | schema, tree(size/lines/kind), keyvalue(mono) |
| wiring / integration | sequence, diagram(flow), table |
| stats / clinical results | chart errorbar + refline + p, table sig + units + footnote, heatmap diverging |
| commerce / trading | chart candlestick, waterfall, table delta/units |
\n