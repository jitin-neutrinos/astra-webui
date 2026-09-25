import { useState, useEffect } from "react";
import type { ReportBlock } from "../lib/plan-block";

export function useCountUp(target: number, instant: boolean) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (instant) {
      setVal(target);
      return;
    }
    const start = Date.now();
    const duration = 600;
    let frame: number;
    const tick = () => {
      const elapsed = Date.now() - start;
      if (elapsed >= duration) {
        setVal(target);
      } else {
        // ease-out cubic
        const t = elapsed / duration;
        const e = 1 - Math.pow(1 - t, 3);
        setVal(Math.floor(target * e));
        frame = window.setTimeout(tick, 16);
      }
    };
    frame = window.setTimeout(tick, 16);
    return () => window.clearTimeout(frame);
  }, [target, instant]);
  return val;
}

export function ReportCard({ report }: { report: ReportBlock }) {
  return (
    <div className="chat-plan chat-report chat-clarify is-approved">
      <div className="chat-plan-eyebrow chat-clarify-eyebrow">REPORT</div>
      <h3 className="chat-plan-title font-medium text-[15px] mb-2">{report.title || "Done"}</h3>
      {report.headline && <p className="chat-plan-summary text-[13.5px] text-slate-300 mb-4">{report.headline}</p>}
      {report.notes && report.notes.length > 0 && (
        <ul className="list-disc pl-4 text-sm text-slate-300 mb-4">
          {report.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}
