
import type { SequenceBlock } from "../../lib/canvas-schema";
import { layoutSequence } from "../../lib/sequence-layout";

/**
 * SequenceView — layered-message renderer.
 *
 * Owner report 2026-10-07: with 8 actors the old fixed 160px lanes forced a
 * 1280px svg minWidth inside a mobile card, long labels overlapped neighbours,
 * and the 100px actor head clipped wide names. The layout now derives lane
 * width from the widest actor label and pre-wraps message labels to the drawn
 * segment; this renderer follows those numbers:
 *   - actor heads use a.headW (label-fitted) and support 2-line head labels;
 *   - message labels render as m.lines (1-3 <tspan> rows) ABOVE the arrow,
 *     stacked upward so they never cross the lifelines;
 *   - the svg keeps overflow-x auto for genuinely wide n-actor specs (the
 *     fullscreen view shows it without the card's width clamp).
 */
export default function SequenceView({ block }: { block: SequenceBlock }) {
  const { actors, messages, bounds, headerHeight } = layoutSequence(block.actors, block.messages);

  const headLines = (label: string, max: number): string[] => {
    const t = (label || "").trim();
    if (!t) return [];
    const approx = (s: string) => s.length * 6.2;
    if (approx(t) <= max) return [t];
    // one balanced 2-line wrap
    const words = t.split(/\s+/);
    let best: string[] | null = null;
    let bestScore = Infinity;
    for (let cut = 1; cut < words.length; cut++) {
      const a = words.slice(0, cut).join(" ");
      const b = words.slice(cut).join(" ");
      const score = Math.abs(approx(a) - approx(b));
      if (score < bestScore) { bestScore = score; best = [a, b]; }
    }
    return best || [t];
  };

  return (
    <div className="ast-cv-sequence" style={{ overflowX: "auto", paddingBottom: 16 }}>
      {block.title && <div className="ast-cv-sequence-title"><strong>{block.title}</strong></div>}
      <svg width={bounds.w} height={bounds.h} viewBox={`0 0 ${bounds.w} ${bounds.h}`} style={{ minWidth: bounds.w, maxWidth: "none" }}>
        <defs>
          <marker id="ast-cv-seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--color-brandtext)" />
          </marker>
          <marker id="ast-cv-seq-arrow-async" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9" fill="none" stroke="var(--color-brandtext)" strokeWidth="1.5" />
          </marker>
        </defs>

        {actors.map(a => (
          <line key={`ll-${a.id}`} x1={a.x} y1={headerHeight} x2={a.x} y2={bounds.h} stroke="var(--cv-border-strong)" strokeDasharray="4 4" />
        ))}

        {actors.map(a => {
          const headLinesArr = headLines(a.label, a.headW - 12);
          const headH = Math.max(32, headLinesArr.length * 15 + 12);
          return (
            <g key={`head-${a.id}`}>
              <rect x={a.x - a.headW / 2} y={headerHeight - headH - 16} width={a.headW} height={headH} rx={4} fill="var(--cv-paper)" stroke="var(--cv-border-strong)" strokeWidth={1.5} />
              {headLinesArr.map((ln, li) => (
                <text key={li} x={a.x} y={headerHeight - headH - 16 + 19 + li * 15} textAnchor="middle" fill="var(--color-brandtext)" fontSize={11} fontWeight={600}>
                  {ln}
                </text>
              ))}
            </g>
          );
        })}

        {messages.map((m, i) => {
          const isReturn = m.kind === "return";
          const isAsync = m.kind === "async";
          const marker = isAsync ? "url(#ast-cv-seq-arrow-async)" : "url(#ast-cv-seq-arrow)";
          if (m.isSelf) {
            return (
              <g key={`msg-${i}`}>
                <path d={`M ${m.x1} ${m.y} h 30 v 14 h -30`} fill="none" stroke="var(--color-brandtext)" strokeWidth={1.5} strokeDasharray={isReturn ? "4 4" : "none"} markerEnd={marker} />
                {m.lines.map((ln, li) => (
                  <text key={li} x={m.x1 + 36} y={m.y - 4 + (li + 1) * 13} fill="var(--color-brandtext)" fontSize={11}>{ln}</text>
                ))}
              </g>
            );
          }

          const labelX = (m.x1 + m.x2) / 2;
          const nLines = Math.max(1, m.lines.length);
          const firstLineY = m.y - 6 - (nLines - 1) * 13; // stack upward from the arrow
          return (
            <g key={`msg-${i}`}>
              <line x1={m.x1} y1={m.y} x2={m.x2} y2={m.y} stroke="var(--color-brandtext)" strokeWidth={1.5} strokeDasharray={isReturn ? "4 4" : "none"} markerEnd={marker} />
              <text x={labelX} y={firstLineY} textAnchor="middle" fill="var(--color-brandtext)" fontSize={11}>
                {m.lines.map((ln, li) => (
                  <tspan key={li} x={labelX} dy={li === 0 ? 0 : 13}>{ln}</tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
