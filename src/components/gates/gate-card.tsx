import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Segment } from "../../lib/chat-segments";
import { draftKey } from "./gate-envelope";
import type { GateReply, GateAction } from "./gate-envelope";
import { RichText } from "../chat-timeline";
import { FinalReportCard } from "./final-report";

export function GateCard({ seg, sessionId, onRespond, onOpenMedia: _onOpenMedia }: {
  seg: Segment;
  sessionId: string | null;
  onRespond: (reqId: string, reply: GateReply) => void;
  onOpenMedia?: (items: import("@/lib/media-paths").MediaItem[], index: number) => void;
}) {
  const env = seg.gate!;
  const reqId = seg.reqId!;

  const dk = draftKey(sessionId, env.gate_id);
  
  const getStored = () => {
    if (seg.resolved || seg.superseded) return {};
    try {
      const stored = sessionStorage.getItem(dk);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  };

  const [mode, setMode] = useState<"view" | "edit" | "changing" | "sending">("view");
  const [draft, setDraft] = useState<string>(() => getStored().draft ?? (env.kind === "plan" ? (env.body as any).content : ""));
  const [changeText, setChangeText] = useState(() => getStored().changeText ?? "");
  const [items, _setItems] = useState<Record<string, { dismissed?: boolean; note?: string }>>(() => getStored().items ?? {});

  useEffect(() => {
    if (seg.resolved || seg.superseded) return;
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(dk, JSON.stringify({ draft, changeText, items }));
      } catch { }
    }, 400);
    return () => clearTimeout(t);
  }, [draft, changeText, items, dk, seg.resolved, seg.superseded]);

  const gateState = useMemo(() => {
    if (seg.resolved === "cancelled") return "expired";
    if (seg.resolved === "dismiss") return "dismissed";
    if (seg.resolved === "approve" || seg.resolved === "reject") return seg.resolved + "d";
    if (seg.resolved === "change") return "change-sent";
    if (seg.superseded) return "superseded";
    return mode === "view" ? "presented" : mode;
  }, [seg.resolved, seg.superseded, mode]);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const changeRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = env.kind === "plan" && draft !== (env.body as any).content || Object.keys(items).length > 0;

  const handleAction = (a: GateAction) => {
    if (a.opens_input) {
      setMode("changing");
      setTimeout(() => changeRef.current?.focus(), 60);
      return;
    }
    
    setMode("sending");
    try { sessionStorage.removeItem(dk); } catch { }

    const reply: GateReply = { action: a.id };
    if (isDirty) reply.edited = true;
    
    if (env.kind === "plan" && isDirty) {
      reply.content = draft;
    } else if ((env.kind === "review" || env.kind === "fix") && Object.keys(items).length > 0) {
      reply.items = items;
    }

    onRespond(reqId, reply);
  };

  const submitChange = () => {
    if (!changeText.trim()) return;
    setMode("sending");
    try { sessionStorage.removeItem(dk); } catch { }
    
    const reply: GateReply = { action: "change", request: changeText };
    if (isDirty) {
      reply.edited = true;
      if (env.kind === "plan") reply.content = draft;
      else if (env.kind === "review" || env.kind === "fix") reply.items = items;
    }
    onRespond(reqId, reply);
  };

  const handleAutoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target;
    el.style.height = "0px";
    el.style.height = el.scrollHeight + "px";
    if (el === taRef.current) setDraft(el.value);
    else setChangeText(el.value);
  };

  if (gateState === "superseded") {
    return (
      <div className="gate-card is-superseded" data-gate-state="superseded">
        <details>
          <summary className="gate-subtitle cursor-pointer select-none m-0 hover:text-slate-300 transition-colors">
            <span className="flex items-center gap-2">
              <ChevronRight className="h-3.5 w-3.5 inline transition-transform" />
              v{env.version} · changes requested · {changeText ? changeText.slice(0, 60) : "superseded"}
            </span>
          </summary>
          <div className="mt-4 pointer-events-none">
            {env.kind === "report" ? (
               <FinalReportCard body={env.body as any} title={env.title} reduced={false} />
            ) : (
               <div className="gate-body"><RichText text={(env.body as any).content || JSON.stringify(env.body)} /></div>
            )}
          </div>
        </details>
      </div>
    );
  }

  const isApproved = gateState === "approved";
  const isRejected = gateState === "rejected";
  const isDismissed = gateState === "dismissed";
  // report with no agent-defined actions: nothing to decide, so give it a local Dismiss
  const isDismissable = env.kind === "report" && env.actions.length === 0 && !seg.resolved;

  return (
    <div id={`chat-gate-${reqId}`} className={cn("gate-card", `is-${gateState}`)} data-gate-state={gateState}>
      <p className="gate-eyebrow">
        {isApproved ? `APPROVED · v${env.version}` : isRejected ? `REJECTED · v${env.version}` : isDismissed ? `DISMISSED · v${env.version}` : `${env.title.toUpperCase()} GATE · V${env.version}`}
      </p>
      
      <div className="flex justify-between items-baseline">
        <h3 className="gate-title">{env.title}</h3>
      </div>
      
      {env.subtitle && <p className="gate-subtitle">{env.subtitle}</p>}

      {env.kind === "report" ? (
        <FinalReportCard body={env.body as any} title={env.title} reduced={false} />
      ) : env.kind === "plan" ? (
        <div className="gate-body">
          {mode === "edit" ? (
            <textarea
              ref={taRef}
              className="gate-edit"
              rows={1}
              value={draft}
              onChange={handleAutoResize}
            />
          ) : (
            <RichText text={isDirty ? draft : (env.body as any).content} />
          )}
        </div>
      ) : (env.kind === "review" || env.kind === "fix") ? (
        <div className="gate-body">
          {env.kind === "review" ? (
            ((env.body as any).findings || []).map((f: any) => (
              <div key={f.id} className="gate-finding-row">
                <div className={cn("gate-finding-rail", f.severity)} />
                <div className="gate-finding-content">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn("gate-finding-chip", f.severity)}>{f.severity}</span>
                    <span className="gate-finding-file">{f.file}{f.line ? `:${f.line}` : ""}</span>
                  </div>
                  <h4 className="gate-finding-title">{f.title}</h4>
                  <RichText text={f.detail} />
                </div>
              </div>
            ))
          ) : null}
        </div>
      ) : null}

      {gateState === "presented" || gateState === "changing" || gateState === "edit" || isDismissable ? (
        <div className="gate-actions">
          {isDismissable ? (
            <button className="gate-btn quiet" onClick={() => handleAction({ id: "dismiss", label: "Dismiss", tone: "quiet" })}>
              Dismiss
            </button>
          ) : (
          env.actions.map(a => (
            <button
              key={a.id}
              className={cn("gate-btn", a.tone)}
              onClick={() => handleAction(a)}
            >
              {a.label}
            </button>
          )))}
          {env.editable && (
            <button className="gate-btn quiet ml-auto" onClick={() => setMode(mode === "edit" ? "view" : "edit")}>
              {mode === "edit" ? "Read" : "Edit"}
            </button>
          )}
        </div>
      ) : null}

      <div className="gate-change-area">
        <div className="gate-change-inner">
          <textarea
            ref={changeRef}
            className="gate-textarea"
            placeholder="What should be changed?"
            value={changeText}
            onChange={handleAutoResize}
          />
          <div className="flex gap-2">
            <button className="gate-btn primary" onClick={submitChange}>Send request</button>
            <button className="gate-btn quiet" onClick={() => setMode("view")}>Cancel</button>
          </div>
        </div>
      </div>

    </div>
  );
}
