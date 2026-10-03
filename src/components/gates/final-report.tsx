import type { ReportBody } from "./gate-envelope";
import { reportBodyToBlocks } from "../../lib/canvas-gates";
import { Blocks } from "../canvas/canvas-blocks";

// Final report rendered as canvas blocks: verdict callout, stats KPI row,
// phase steps, coverage gauges as radial charts, links table. Same design
// language as every other canvas surface (owner: gates ARE canvases now).
export function FinalReportCard({ body, reduced }: { body: ReportBody; title: string; reduced: boolean }) {
  return (
    <div className="gate-canvas-report">
      <Blocks blocks={reportBodyToBlocks(body)} animate={!reduced} />
    </div>
  );
}
