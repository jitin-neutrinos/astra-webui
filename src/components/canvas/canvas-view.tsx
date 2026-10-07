// CanvasView — the composed generative-UI surface rendered between prose.
// Lazy-loaded chunk: this module (and its recharts import) never enters the
// main bundle; only chats that actually contain a canvas pay for it.
//
// Two modes:
//   spec    — the finished canvas (parsed from a closed fence)
//   partial — a canvas still STREAMING: blocks paint the moment each one
//             completes, so the user watches the card build in real time
//             instead of waiting for the closing fence.
//
// v5: reactive canvases — `spec.state` seeds a per-canvas store wrapped around
// the body; control blocks (slider/select/…) write it; reader blocks resolve
// `{bind, where, visible,…}` against it. A spec with no `state` renders exactly
// as before (the provider is inert when nothing binds).
import { Loader2 } from "lucide-react";
import { canvasToMarkdown } from "../../lib/canvas-markdown";
import { AnimatedCopyButton } from "../../lib/animated-copy";
import { Blocks } from "./canvas-blocks";
import { CanvasStateProvider } from "./canvas-state";
import type { CanvasSpec, CanvasBlock } from "../../lib/canvas-schema";

// The heading is ALWAYS derived from the data, so a canvas never reads as a
// generic "Canvas". An owner-supplied title is kept but enriched with the first
// real figure, so it stays contextually relevant to what is on screen.
/** A reactive KPI authors its figure as a binding object. A title is derived from the spec alone (no
 *  card state to resolve it in), so a bound figure is omitted instead of printing "[object Object]". */
const figure = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" ? String(v) : null);

function deriveTitle(spec: { title?: string; blocks: CanvasBlock[] }): string {
  const b = spec.blocks.find((x) => x.type !== "data"); // data carriers never title the card
  const fromData = (blk: CanvasBlock | undefined): string | null => {
    if (!blk) return null;
    switch (blk.type) {
      case "kpi": { const f = figure(blk.value); return blk.label ? (f ? `${blk.label}: ${f}` : blk.label) : null; }
      case "compare": return blk.items?.[0]?.name ? `Compare — ${blk.items[0].name}` : "Comparison";
      case "table": return blk.columns?.length ? blk.columns.join(" · ") : "Data table";
      case "chart": return blk.series?.[0]?.name ? `${blk.series[0].name} · ${blk.chart} chart` : blk.title || "Chart";
      case "diagram": return blk.nodes?.[0]?.label ? `${blk.layout} — ${blk.nodes[0].label}` : "Diagram";
      case "timeline": return blk.items?.[0]?.title ? `Timeline — ${blk.items[0].title}` : "Timeline";
      case "progress": return blk.label ? `Progress — ${blk.label}` : "Progress";
      case "steps": return "Status";
      case "checklist": return "Checklist";
      case "callout": return blk.title || (blk.tone ? blk.tone.charAt(0).toUpperCase() + blk.tone.slice(1) : "Note");
      case "code": return blk.filename || (blk.language ? `${blk.language} snippet` : "Snippet");
      case "references": return "References";
      case "spreadsheet": return blk.title || `Spreadsheet — ${blk.rows?.[0]?.length ?? 0} cols`;
      case "slides": return blk.title || `Slides — ${blk.slides?.length ?? 0} deck`;
      case "document": return blk.title || "Document";
      case "text": return blk.title || "Text";
      case "quote": return blk.attribution ? `Quote — ${blk.attribution}` : "Quote";
      case "keyvalue": return blk.title || (blk.items?.[0]?.key ? `${blk.items[0].key}: ${blk.items[0].value}` : "Facts");
      case "diff": return blk.filename ? `Diff — ${blk.filename}` : "Changes";
      case "heatmap": return blk.title || (blk.rows?.length ? `${blk.rows.length}×${blk.cols?.length ?? 0} intensity grid` : "Heatmap");
      case "tabs": return blk.items?.[0]?.label ? `Tabs — ${blk.items[0].label}` : "Tabs";
      case "accordion": return blk.items?.[0]?.title ? `Details — ${blk.items[0].title}` : "Details";
      case "terminal": return blk.command ? blk.command.slice(0, 60) : blk.title || "Terminal";
      case "badges": return "Status";
      case "divider": return blk.label || "—";
      case "slider": return blk.label || "Slider";
      case "select": case "multiselect": case "segmented": return blk.label || "Controls";
      case "toggle": return blk.label || "Toggle";
      case "search": return blk.label || "Filter";
      case "graph": return blk.title || `Graph — ${blk.nodes?.length ?? 0} entities · ${blk.edges?.length ?? 0} connections`;
      case "image": return blk.alt || blk.caption || "Image";
      case "gallery": return `Gallery — ${blk.items?.length ?? 0}`;
      case "video": return blk.caption || "Video";
      default: return null;
    }
  };
  const derived = fromData(b);
  if (spec.title) {
    const first = b?.type === "kpi" ? figure(b.value) : null;
    return first && !spec.title.includes(first) ? `${spec.title} ·\u00A0${first}` : spec.title;
  }
  return derived || "Canvas";
}

export default function CanvasView({ spec, partial, canvasId = "0" }: { spec?: CanvasSpec; partial?: { title?: string; blocks: CanvasBlock[] }; canvasId: string }) {
  // A card with a CONTROL needs its own store even with no authored `state`:
  // without the provider the control would write into the module-level
  // FALLBACK_STORE, which is shared by every such card on the page (one card's
  // slider moving every other card's KPI).
  const hasControls = spec?.blocks.some((b) => ["slider", "select", "multiselect", "segmented", "toggle", "search"].includes(b.type));
  const reactive = !!(spec?.state && Object.keys(spec.state).length > 0) || !!hasControls;

  // Streaming mode: paint the blocks that have completed so far, with a live
  // building indicator. No copy button — nothing final to copy yet.
  if (partial) {
    const liveTitle = deriveTitle(partial);
    return (
        <section className="ast-canvas ast-canvas-live" aria-label={liveTitle} aria-busy="true">
          <header className="ast-canvas-head">
            <span className="ast-canvas-title">{liveTitle}</span>
            <span className="ast-canvas-building" role="status" aria-live="polite">
              <Loader2 className="h-3.5 w-3.5 ast-canvas-spin" aria-hidden="true" />
              <span>Building…</span>
            </span>
          </header>
          <div className="ast-canvas-body">
            <Blocks blocks={partial.blocks} canvasId={`${canvasId}-p`} />
          </div>
        </section>
    );
  }

  if (!spec) return null;
  const title = deriveTitle(spec);

  const body = (
    <div className="ast-canvas-body">
      <Blocks blocks={spec.blocks} canvasId={canvasId} />
    </div>
  );

  return (
      <section className="ast-canvas" aria-label={title}>
        <header className="ast-canvas-head">
          <span className="ast-canvas-title">{title}</span>
          <div className="ast-canvas-actions">
            <AnimatedCopyButton
              variant="chip"
              label="Copy"
              title="Copy canvas as markdown"
              text={() => canvasToMarkdown(spec)}
            />
          </div>
        </header>
        {reactive ? <CanvasStateProvider canvasId={canvasId} initial={spec.state ?? {}}>{body}</CanvasStateProvider> : body}
      </section>
  );
}
