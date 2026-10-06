
import type { SequenceBlock } from "../../lib/canvas-schema";
import { layoutSequence } from "../../lib/sequence-layout";

export default function SequenceView({ block }: { block: SequenceBlock }) {
  const { actors, messages, bounds, headerHeight } = layoutSequence(block.actors, block.messages);
  
  return (
    <div className="ast-cv-sequence" style={{ overflowX: "auto", paddingBottom: 16 }}>
      {block.title && <div className="ast-cv-sequence-title"><strong>{block.title}</strong></div>}
      <svg width={bounds.w} height={bounds.h} viewBox={`0 0 ${bounds.w} ${bounds.h}`} style={{ minWidth: bounds.w }}>
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
        
        {actors.map(a => (
          <g key={`head-${a.id}`}>
            <rect x={a.x - 50} y={10} width={100} height={32} rx={4} fill="var(--cv-paper)" stroke="var(--cv-border-strong)" strokeWidth={1.5} />
            <text x={a.x} y={30} textAnchor="middle" fill="var(--color-brandtext)" fontSize={11} fontWeight={600}>
              {a.label}
            </text>
          </g>
        ))}
        
        {messages.map((m, i) => {
          const isReturn = m.kind === "return";
          const isAsync = m.kind === "async";
          const marker = isAsync ? "url(#ast-cv-seq-arrow-async)" : "url(#ast-cv-seq-arrow)";
          if (m.isSelf) {
            return (
              <g key={`msg-${i}`}>
                <path d={`M ${m.x1} ${m.y} h 30 v 14 h -30`} fill="none" stroke="var(--color-brandtext)" strokeWidth={1.5} strokeDasharray={isReturn ? "4 4" : "none"} markerEnd={marker} />
                <text x={m.x1 + 36} y={m.y + 11} fill="var(--color-brandtext)" fontSize={10}>{m.label}</text>
              </g>
            );
          }
          
          const labelX = (m.x1 + m.x2) / 2;
          return (
            <g key={`msg-${i}`}>
              <line x1={m.x1} y1={m.y} x2={m.x2} y2={m.y} stroke="var(--color-brandtext)" strokeWidth={1.5} strokeDasharray={isReturn ? "4 4" : "none"} markerEnd={marker} />
              <text x={labelX} y={m.y - 6} textAnchor="middle" fill="var(--color-brandtext)" fontSize={10}>
                {m.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
