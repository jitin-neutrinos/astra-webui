import type { ReportBody } from "./gate-envelope";
import { reportBodyToBlocks } from "../../lib/canvas-gates";
import { Blocks } from "../canvas/canvas-blocks";
import { sanitizeCanvasSpec } from "../../lib/canvas-sanitize";

// Final report rendered as canvas blocks: verdict callout, stats KPI row,
// phase steps, coverage gauges as radial charts, links table. Same design
// language as every other canvas surface (owner: gates ARE canvases now).
//
// 2026-10-05: sanitize here too, and give it a unique canvasId. This was the
// third `Blocks` call site rendering agent-authored blocks with no sanitiser
// and the default canvasId "0" — which namespaces the page-wide singleton
// fullscreen slot, so two reports could resolve to the same slot.
export function FinalReportCard({ body, reduced, canvasId }: { body: ReportBody; title: string; reduced: boolean; canvasId?: string }) {
  const safe = sanitizeCanvasSpec({ v: 1, blocks: reportBodyToBlocks(body) });
  if (!safe) return null;
  return (
    <div className="gate-canvas-report">
      <Blocks blocks={safe.blocks} animate={!reduced} canvasId={canvasId ?? "final-report"} />
    </div>
  );
}