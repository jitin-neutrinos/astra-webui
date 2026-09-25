import { cn } from "../../lib/utils";
import type { ReportBody } from "./gate-envelope";

function SVGDonut({ percent, reduced }: { percent: number; reduced: boolean }) {
  const c = 2 * Math.PI * 45;
  const dashoffset = c - (percent / 100) * c;
  
  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(248,250,252,.04)" strokeWidth="8" />
        <circle 
          cx="50" cy="50" r="45" fill="none" stroke="var(--color-cyanx)" strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={reduced ? dashoffset : c}
          style={{ transition: reduced ? "none" : "stroke-dashoffset 1.2s cubic-bezier(.2,0,0,1)" }}
          ref={el => { if (el && !reduced) setTimeout(() => { el.style.strokeDashoffset = dashoffset.toString(); }, 50); }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono font-medium text-xl text-brandtext leading-none">{percent}%</span>
      </div>
    </div>
  );
}

export function FinalReportCard({ body, reduced }: { body: ReportBody; title: string; reduced: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="gate-stat-grid">
        {body.stats.map((s: any) => (
          <div key={s.label} className="gate-stat-tile">
            <span className="gate-stat-label">{s.label}</span>
            <span className="gate-stat-value gate-counter" style={{"--gate-n": s.value} as any}>{s.value}</span>
            <span className="gate-counter-fallback">{s.value}</span>
            {s.delta && (
              <span className={cn("gate-stat-delta", s.delta.trend)}>
                {s.delta.trend === "up" ? "↑" : s.delta.trend === "down" ? "↓" : ""} {Math.abs(s.delta.value)}
              </span>
            )}
          </div>
        ))}
      </div>
      
      {(body as any).coverage !== undefined && (
         <div className="flex items-center gap-6 p-4 bg-[var(--surface-step-1)] rounded-[12px] border border-[rgba(248,250,252,0.08)]">
           <SVGDonut percent={(body as any).coverage} reduced={reduced} />
           <div>
             <h4 className="font-sans font-medium text-sm text-brandtext mb-1">Coverage / Quality</h4>
             <p className="font-sans text-xs text-slate-400 m-0">Generated code quality meets the configured project thresholds.</p>
           </div>
         </div>
      )}
    </div>
  );
}
