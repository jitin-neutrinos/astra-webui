import { useEffect, useReducer, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, ChevronRight, CornerDownRight, Loader2, Radio, X } from "lucide-react";
import type { BgItem } from "@/lib/bg-items";
import { dockVisible } from "@/lib/bg-items";

export interface BgDockProps {
  items: BgItem[];
  onSubmitFollowUp: (text: string) => void;
  onDismiss: (id: number) => void;
  onOpenItem: (item: BgItem) => void;
}

// "2m" / "14s" — createdAt is the item id (Date.now() mint).
function fmtElapsed(fromMs: number): string {
  const s = Math.max(0, Math.round((Date.now() - fromMs) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

/**
 * BgDock — tracker for run-after (/bg) tasks only. Steer has its own surface
 * (SteerNote): it modifies the live turn, it is not a background job.
 * Rows show queue order, elapsed time for live work, and a reply-jump when done.
 */
export function BgDock({ items, onSubmitFollowUp, onDismiss, onOpenItem }: BgDockProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // 1s tick so elapsed labels stay honest while anything is queued/running
  const [, forceTick] = useReducer((x: number) => x + 1, 0);
  const liveRows = items.some((it) => !it.dismissed && it.kind === "bg" && it.status !== "done");
  useEffect(() => {
    if (!liveRows) return;
    const id = window.setInterval(forceTick, 1000);
    return () => window.clearInterval(id);
  }, [liveRows]);

  const visible = items.filter((it) => !it.dismissed && it.kind === "bg");
  if (!dockVisible(visible)) return null;

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

  // queue order: queued rows numbered by age — #1 runs next
  let queuePos = 0;
  const activeCount = visible.filter((it) => it.status !== "done").length;

  return (
    <div className="bgd-wrap mx-auto w-full max-w-[52rem]" role="region" aria-label="Background tasks">
      <div className="bgd-bar">
        {activeCount > 0 && <Loader2 className="bgd-bar-spin h-3 w-3 animate-spin" aria-hidden="true" />}
        <span className="bgd-bar-label">
          {activeCount > 0 ? `${activeCount} in background` : "Background history"}
        </span>
      </div>
      <div className="bgd-card flex flex-col gap-0.5">
        {visible.map((item) => {
          if (item.status === "queued") queuePos += 1;
          return (
            <BgDockRow
              key={item.id}
              item={item}
              queuePos={item.status === "queued" ? queuePos : 0}
              onDismiss={onDismiss}
              onOpenItem={onOpenItem}
            />
          );
        })}
        <div className="mt-1.5 px-2 pb-1">
          <input
            ref={inputRef}
            type="text"
            className="bgd-input w-full rounded p-1.5 outline-none"
            placeholder="Queue another background task…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>
    </div>
  );
}

function BgDockRow({ item, queuePos, onDismiss, onOpenItem }: { item: BgItem; queuePos: number; onDismiss: (id: number) => void; onOpenItem: (item: BgItem) => void }) {
  const openable = item.status === "done" && !!item.replyMsgId;
  return (
    <div className="bgd-row flex items-center gap-2 px-2 py-1" data-status={item.status}>
      {item.status === "queued" && <span className="bgd-qpos shrink-0" aria-hidden="true">{queuePos}</span>}
      {item.status === "running" && <Loader2 className="h-3 w-3 animate-spin bgd-spin shrink-0" aria-hidden="true" />}
      {item.status === "done" && <Check className="h-3 w-3 bgd-check shrink-0" aria-hidden="true" />}

      <button
        type="button"
        className="bgd-text min-w-0 flex-1 text-left"
        title={openable ? "Jump to response" : item.text}
        onClick={() => openable && onOpenItem(item)}
        disabled={!openable}
      >
        {item.text}
      </button>

      {item.status === "queued" && <span className="bgd-meta shrink-0">runs next</span>}
      {item.status === "running" && <span className="bgd-meta bgd-meta-live shrink-0">{fmtElapsed(item.id)}</span>}
      {openable && <ChevronRight className="bgd-go h-3.5 w-3.5 shrink-0" aria-hidden="true" />}

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

// In-flow receipt for a queued/running /bg task (timeline row, bg kind only).
export function BgNote({ item, onDismiss }: { item: BgItem; onDismiss: (id: number) => void }) {
  const label = item.status === "queued"
    ? "Queued — runs when the current reply finishes"
    : item.status === "running"
      ? "Running in background"
      : "Done — open the background panel to jump to the response";
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

/** How long the steer receipt stays on screen before auto-dismissing. Long
 *  enough to read "steering…", short enough that it never becomes clutter. */
const STEER_NOTE_MS = 2600;

/**
 * SteerNote — dedicated surface for /steer. Unlike /bg (a queued job with a
 * future reply), steer injects into the LIVE turn: the card quotes the
 * correction, shows delivery state, and settles to "applied" when the turn
 * completes. Lives inline where the steered turn is, never in the dock.
 */
export function SteerNote({ item, onDismiss }: { item: BgItem; onDismiss: (id: number) => void }) {
  const applied = item.status === "done";
  // The steer is DELIVERED the moment it is submitted, so the on-screen item has
  // served its purpose — owner mandate: it disappears once accepted instead of
  // lingering as a blue card the user must dismiss. Dismissal only hides the row;
  // the steer itself is already applied on the agent side.
  useEffect(() => {
    const t = setTimeout(() => onDismiss(item.id), STEER_NOTE_MS);
    return () => clearTimeout(t);
  }, [item.id, onDismiss]);

  return (
    <div className="steer-note" data-status={item.status}>
      <div className="steer-note-head">
        {applied
          ? <Check className="steer-note-ico steer-note-ico-done h-3.5 w-3.5" aria-hidden="true" />
          : <Radio className="steer-note-ico h-3.5 w-3.5 animate-pulse" aria-hidden="true" />}
        <span className="steer-note-label">{applied ? "Course correction applied" : "Steering the live turn"}</span>
        <button type="button" className="bgd-note-dismiss" aria-label="Dismiss" title="Dismiss"
          onClick={() => onDismiss(item.id)}>
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="steer-note-body">
        <CornerDownRight className="steer-note-branch h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="steer-note-text">{item.text}</span>
      </div>
    </div>
  );
}
