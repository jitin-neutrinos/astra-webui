import { useState, useRef, useEffect } from "react";
import type { KeyboardEvent } from "react";
import { Check, Loader2 } from "lucide-react";
import type { BgItem } from "@/lib/bg-items";
import { dockVisible } from "@/lib/bg-items";

export interface BgDockProps {
  items: BgItem[];
  onSubmitFollowUp: (text: string) => void;
  onRemove: (id: number) => void;
}

export function BgDock({ items, onSubmitFollowUp, onRemove }: BgDockProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  if (!dockVisible(items)) return null;

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const val = input.trim();
      if (val) {
        onSubmitFollowUp(val);
        setInput("");
      }
    }
  };

  return (
    <div className="bgd-wrap mx-auto max-w-3xl" role="region" aria-label="Background tasks">
      <div className="bgd-bar">
        <span className="bgd-bar-label">
          {items.length} in background
        </span>
      </div>
      <div className="bgd-card flex flex-col gap-1">
        {items.map((item) => (
          <BgDockRow key={item.id} item={item} onRemove={onRemove} />
        ))}
        <div className="mt-2 px-2 pb-1">
          <input
            ref={inputRef}
            type="text"
            className="bgd-input w-full rounded p-1.5 outline-none"
            placeholder="Queue a follow-up…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>
    </div>
  );
}

function BgDockRow({ item, onRemove }: { item: BgItem; onRemove: (id: number) => void }) {
  useEffect(() => {
    if (item.status !== "done") return;
    const t = window.setTimeout(() => onRemove(item.id), 450);
    return () => window.clearTimeout(t);
  }, [item.status, item.id, onRemove]);

  return (
    <div className="bgd-row flex items-center gap-2 px-2 py-1" data-status={item.status}>
      {item.status === "queued" && <span className="bgd-pulse" aria-hidden="true" />}
      {item.status === "running" && <Loader2 className="h-3 w-3 animate-spin text-cyan-400 shrink-0" />}
      {item.status === "done" && <Check className="h-3 w-3 text-emerald-400 shrink-0" />}
      
      {item.status === "running" ? (
        <span className="bgd-text" title={item.text}>running now</span>
      ) : (
        <span className="bgd-text" title={item.text}>{item.text}</span>
      )}
    </div>
  );
}

export function SysNoteRow({ item, onRemove }: { item: BgItem; onRemove: (id: number) => void }) {
  useEffect(() => {
    if (item.status !== "done") return;
    const t = window.setTimeout(() => onRemove(item.id), 450);
    return () => window.clearTimeout(t);
  }, [item.status, item.id, onRemove]);

  let label = "";
  if (item.status === "queued") label = "Queued — will run when the current reply finishes";
  else if (item.status === "running") {
    label = item.kind === "bg" ? "Running now" : "Steered — course correction sent into the live turn";
  } else {
    // done
    label = item.kind === "bg" ? "Running now" : "Steered — course correction sent into the live turn";
  }

  return (
    <div className="chat-sys-note" data-status={item.status === "done" ? "done" : item.status}>
      ◈ {label}
    </div>
  );
}
