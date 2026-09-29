import { useState, useRef } from "react";
import type { KeyboardEvent } from "react";
import { Check, Circle, Loader2, X } from "lucide-react";
import type { BgItem } from "@/lib/bg-items";
import { dockVisible } from "@/lib/bg-items";

export interface BgDockProps {
  items: BgItem[];
  onSubmitFollowUp: (text: string) => void;
  onDismiss: (id: number) => void;
  onOpenItem: (item: BgItem) => void;
}

export function BgDock({ items, onSubmitFollowUp, onDismiss, onOpenItem }: BgDockProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = items.filter((it) => !it.dismissed);
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

  const activeCount = visible.filter((it) => it.status !== "done").length;

  return (
    <div className="bgd-wrap mx-auto max-w-3xl" role="region" aria-label="Background tasks">
      <div className="bgd-bar">
        <span className="bgd-bar-label">
          {activeCount > 0 ? `${activeCount} in background` : "Background history"}
        </span>
      </div>
      <div className="bgd-card flex flex-col gap-1">
        {visible.map((item) => (
          <BgDockRow key={item.id} item={item} onDismiss={onDismiss} onOpenItem={onOpenItem} />
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

function BgDockRow({ item, onDismiss, onOpenItem }: { item: BgItem; onDismiss: (id: number) => void; onOpenItem: (item: BgItem) => void }) {
  const openable = item.status === "done" && !!item.replyMsgId;
  return (
    <div className="bgd-row flex items-center gap-2 px-2 py-1" data-status={item.status}>
      {item.status === "queued" && <Circle className="h-2.5 w-2.5 bgd-pulse shrink-0" aria-hidden="true" />}
      {item.status === "running" && <Loader2 className="h-3 w-3 animate-spin bgd-spin shrink-0" aria-hidden="true" />}
      {item.status === "done" && <Check className="h-3 w-3 bgd-check shrink-0" aria-hidden="true" />}

      <button
        type="button"
        className="bgd-text min-w-0 flex-1 text-left"
        title={openable ? "Jump to response" : item.text}
        onClick={() => openable && onOpenItem(item)}
        disabled={!openable}
      >
        {item.status === "running" ? (item.kind === "steer" ? "steered — running in live turn" : "running now") : item.text}
      </button>

      <button
        type="button"
        className="bgd-dismiss shrink-0"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={() => onDismiss(item.id)}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// Timeline note — persistent now: states change in place, no auto-fade. The row is
// removed only when the user dismisses the item (onDismiss flips dismissed → row unmounts).
export function SysNoteRow({ item, onDismiss }: { item: BgItem; onDismiss: (id: number) => void }) {
  let label = "";
  if (item.status === "queued") label = "Queued — will run when the current reply finishes";
  else if (item.status === "running") {
    label = item.kind === "bg" ? "Running now" : "Steered — course correction sent into the live turn";
  } else {
    label = item.kind === "bg" ? "Done — click the background panel to jump to the response" : "Steered — applied";
  }

  return (
    <div className="chat-sys-note" data-status={item.status}>
      <span>◈ {label}</span>
      <button type="button" className="bgd-note-dismiss" aria-label="Dismiss note" title="Dismiss"
        onClick={() => onDismiss(item.id)}>
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
