import { createContext, useContext, useState } from "react";
import type { Plan, PlanResponse, ReportBlock } from "../lib/plan-block";
import type { PhaseState } from "../lib/plan-phases";
import type { SessionStats } from "../lib/session-stats";
import { getDraft, setDraft } from "../lib/plan-draft";
import { ArrowUp, ArrowDown } from "lucide-react";

export interface PlanGateCtx {
  sessionId: string;
  decisions: Map<string, PlanResponse>;
  phases: Map<string, PhaseState[]>;
  stats: Map<string, SessionStats>;
  reports: Map<string, ReportBlock>;
  onDecide: (plan: Plan, decision: PlanResponse["decision"], note: string, edited: boolean) => void;
  busy: boolean;
}
export const PlanGateContext = createContext<PlanGateCtx | null>(null);

function usePlanGate() {
  const ctx = useContext(PlanGateContext);
  if (!ctx) throw new Error("Missing PlanGateContext");
  return ctx;
}

export function PhaseRail({ phases }: { phases: PhaseState[] }) {
  return (
    <ol role="list" className="chat-phase-rail flex items-center gap-1 mt-4 pt-4 border-t border-slate-800">
      {phases.map((ph, i) => {
        const isLast = i === phases.length - 1;
        const active = ph.status === "active";
        return (
          <li key={ph.id} aria-current={active ? "step" : undefined} className="flex items-center flex-1" title={ph.evidence}>
            <span className="sr-only">{ph.status}</span>
            <div className={`chat-phase-node shrink-0 w-3 h-3 rounded-full border border-slate-700 ${ph.status === 'complete' ? 'bg-cyan-400 border-cyan-400' : ph.status === 'active' ? 'is-active bg-cyan-400/50 border-cyan-400/50' : ph.status === 'skipped' ? 'bg-slate-700' : ''}`} />
            {!isLast && (
              <div className="flex-1 h-px mx-1 bg-slate-800 overflow-hidden">
                <div className="h-full bg-cyan-400/50 origin-left chat-phase-line" style={{ transform: ph.status === 'complete' ? 'scaleX(1)' : 'scaleX(0)' }} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function PlanCard({ plan }: { plan: Plan }) {
  const { decisions, onDecide, sessionId, busy } = usePlanGate();
  
  const [editing, setEditing] = useState(false);
  const [draft, setDraftState] = useState<Plan>(() => getDraft(sessionId, plan.id) ?? plan);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");

  const decision = decisions.get(plan.id);
  const settled = decision != null;
  const shown = decision?.plan ?? draft;
  const edited = JSON.stringify(draft) !== JSON.stringify(plan);

  const mutate = (fn: (p: Plan) => Plan) => setDraftState(prev => {
    const next = fn(prev);
    setDraft(sessionId, plan.id, next);
    return next;
  });

  const stateClass = settled
    ? (decision.decision === "approved" ? "is-approved" : "is-changes")
    : (editing ? "is-editing" : "is-pending");

  const eyebrow = settled
    ? (decision.decision === "approved" ? "PLAN" : "PLAN · CHANGES REQUESTED")
    : "PLAN";

  const toggleItem = (secIdx: number, itemIdx: number) => {
    mutate(p => {
      const copy = { ...p, sections: [...p.sections] };
      copy.sections[secIdx] = { ...copy.sections[secIdx], items: [...copy.sections[secIdx].items] };
      copy.sections[secIdx].items[itemIdx] = { 
        ...copy.sections[secIdx].items[itemIdx], 
        done: !copy.sections[secIdx].items[itemIdx].done 
      };
      return copy;
    });
  };

  const moveItem = (secIdx: number, itemIdx: number, dir: -1 | 1) => {
    mutate(p => {
      const copy = { ...p, sections: [...p.sections] };
      const items = [...copy.sections[secIdx].items];
      const target = itemIdx + dir;
      if (target < 0 || target >= items.length) return p;
      [items[itemIdx], items[target]] = [items[target], items[itemIdx]];
      copy.sections[secIdx].items = items;
      return copy;
    });
  };

  return (
    <section aria-labelledby={`plan-title-${plan.id}`} className={`chat-plan chat-clarify ${stateClass}`}>
      <div className="chat-plan-eyebrow chat-clarify-eyebrow">{eyebrow}</div>
      <h3 id={`plan-title-${plan.id}`} className="chat-plan-title font-medium text-[15px] mb-2">{shown.title}</h3>
      {shown.summary && <p className="chat-plan-summary text-[13.5px] text-slate-300 mb-4">{shown.summary}</p>}
      
      <div className="chat-plan-sections flex flex-col gap-4">
        {shown.sections.map((sec, sIdx) => (
          <div key={sec.id} className="chat-plan-section">
            {editing ? (
               <input className="chat-plan-input w-full bg-transparent border border-slate-700 rounded px-2 py-1 mb-2 text-sm text-cyan-100" value={sec.heading} onChange={e => mutate(p => {
                 const np = {...p, sections: [...p.sections]};
                 np.sections[sIdx] = {...np.sections[sIdx], heading: e.target.value};
                 return np;
               })} />
            ) : (
               <h4 className="font-medium text-sm text-cyan-100/90 mb-2">{sec.heading}</h4>
            )}
            
            <div className="flex flex-col gap-2">
              {sec.items.map((item, iIdx) => (
                <div key={item.id} className="flex gap-2 items-center chat-plan-item">
                   <button 
                     role="checkbox" 
                     aria-checked={item.done}
                     onClick={() => editing && toggleItem(sIdx, iIdx)}
                     disabled={!editing}
                     className={`chat-clarify-row !w-auto flex-1 !p-2 ${item.done ? 'selected' : ''}`}
                   >
                     <div className="chat-clarify-control box">
                       {item.done && <div className="chat-clarify-dot" />}
                     </div>
                     <span className="chat-clarify-label">{item.text}</span>
                   </button>
                   {editing && (
                     <div className="flex flex-col gap-0.5">
                       <button onClick={() => moveItem(sIdx, iIdx, -1)} disabled={iIdx === 0} aria-label={`Move ${item.text} up`} className="chat-plan-move p-1 text-slate-500 hover:text-slate-300 disabled:opacity-30"><ArrowUp size={14}/></button>
                       <button onClick={() => moveItem(sIdx, iIdx, 1)} disabled={iIdx === sec.items.length - 1} aria-label={`Move ${item.text} down`} className="chat-plan-move p-1 text-slate-500 hover:text-slate-300 disabled:opacity-30"><ArrowDown size={14}/></button>
                     </div>
                   )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!settled && (
        <div className="chat-plan-footer mt-4 pt-4 border-t border-slate-800">
          {asking ? (
            <div className="flex flex-col gap-2">
              <textarea 
                value={note} 
                onChange={e => setNote(e.target.value)}
                placeholder="What should be changed?"
                className="chat-clarify-free min-h-[80px]"
                aria-label="Change request note"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setAsking(false)} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
                <button 
                  disabled={!note.trim() || busy} 
                  onClick={() => onDecide(draft, "changes_requested", note, edited)}
                  className="chat-clarify-submit"
                >Send request</button>
              </div>
            </div>
          ) : editing ? (
            <div className="flex justify-end">
              <button onClick={() => setEditing(false)} className="chat-clarify-submit">Done editing</button>
            </div>
          ) : (
            <div className="flex gap-2 items-center flex-wrap">
              <button onClick={() => setEditing(true)} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 chat-plan-btn">Edit</button>
              <button onClick={() => setAsking(true)} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 chat-plan-btn">Request changes</button>
              <div className="flex-1"/>
              <button disabled={busy} onClick={() => onDecide(draft, "approved", "", edited)} className="chat-clarify-submit">Approve</button>
            </div>
          )}
        </div>
      )}

      {settled && decision.decision === "approved" && (
        <PhaseRail phases={usePlanGate().phases.get(plan.id) ?? []} />
      )}
      
      {settled && decision.decision === "changes_requested" && decision.note && (
        <div className="mt-4 pt-4 border-t border-slate-800 text-sm text-slate-400 italic">
          "{decision.note}"
        </div>
      )}
    </section>
  );
}
