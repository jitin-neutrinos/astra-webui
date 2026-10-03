// CanvasView — the composed generative-UI surface rendered between prose.
// Lazy-loaded chunk: this module (and its recharts import) never enters the
// main bundle; only chats that actually contain a canvas pay for it.
//
// Two modes:
//   spec    — the finished canvas (parsed from a closed fence)
//   partial — a canvas still STREAMING: blocks paint the moment each one
//             completes, so the user watches the card build in real time
//             instead of waiting for the closing fence.
import { useReducer } from "react";
import { Copy, Check, Loader2 } from "lucide-react";
import { canvasToMarkdown } from "../../lib/canvas-markdown";
import { copyText } from "../../lib/copy-text";
import { Blocks } from "./canvas-blocks";
import { CanvasFullscreenProvider } from "./canvas-fullscreen";
import type { CanvasSpec, CanvasBlock } from "../../lib/canvas-schema";

// The heading is ALWAYS derived from the data, so a canvas never reads as a
// generic "Canvas". An owner-supplied title is kept but enriched with the first
// real figure, so it stays contextually relevant to what is on screen.
function deriveTitle(spec: { title?: string; blocks: CanvasBlock[] }): string {
  const b = spec.blocks[0];
  const fromData = (blk: CanvasBlock | undefined): string | null => {
    if (!blk) return null;
    switch (blk.type) {
      case "kpi": return blk.label ? `${blk.label}: ${blk.value}` : null;
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
      default: return null;
    }
  };
  const derived = fromData(b);
  if (spec.title) {
    const first = b?.type === "kpi" ? String(b.value) : null;
    return first && !spec.title.includes(first) ? `${spec.title} · ${first}` : spec.title;
  }
  return derived || "Canvas";
}

export default function CanvasView({ spec, partial, canvasId = "0" }: { spec?: CanvasSpec; partial?: { title?: string; blocks: CanvasBlock[] }; canvasId?: string }) {
  const [copied, ping] = useReducer((x: number) => x + 1, 0);
  const done = copied > 0;

  // Streaming mode: paint the blocks that have completed so far, with a live
  // building indicator. No copy button — nothing final to copy yet.
  if (partial) {
    const liveTitle = deriveTitle(partial);
    return (
      <CanvasFullscreenProvider>
        <section className="ast-canvas ast-canvas-live" aria-label={liveTitle} aria-busy="true">
          <header className="ast-canvas-head">
            <span className="ast-canvas-title">{liveTitle}</span>
            <span className="ast-canvas-building" role="status">
              <Loader2 className="h-3.5 w-3.5 ast-canvas-spin" aria-hidden="true" />
              <span>Building…</span>
            </span>
          </header>
          <div className="ast-canvas-body">
            <Blocks blocks={partial.blocks} canvasId={`${canvasId}-p`} />
          </div>
        </section>
      </CanvasFullscreenProvider>
    );
  }

  if (!spec) return null;
  const title = deriveTitle(spec);

  const onCopy = async () => {
    const ok = await copyText(canvasToMarkdown(spec));
    if (ok) {
      ping();
      setTimeout(() => ping(), 1600);
    }
  };

  return (
    <CanvasFullscreenProvider>
      <section className="ast-canvas" aria-label={title}>
        <header className="ast-canvas-head">
          <span className="ast-canvas-title">{title}</span>
          <div className="ast-canvas-actions">
            <button type="button" className="ast-canvas-copy" onClick={onCopy} aria-label="Copy canvas as markdown">
              {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{done ? "Copied" : "Copy"}</span>
            </button>
          </div>
        </header>
        <div className="ast-canvas-body">
          <Blocks blocks={spec.blocks} canvasId={canvasId} />
        </div>
      </section>
    </CanvasFullscreenProvider>
  );
}
