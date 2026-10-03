// Canvas fullscreen host — expands an embedded block to a full-bleed surface.
//
// Contract copied from src/components/media-viewer.tsx, the one overlay already
// proven against the native shell:
//   - ONE owned history entry (pushState on open, close via history.back()).
//     Never history.back() in unmount cleanup — popstate already handled it.
//   - window.__astraBack so Android's back button closes THIS overlay instead of
//     exiting the app. MainActivity's handler only falls through to app-exit
//     when the hook is absent or returns false.
//
// The store is a MODULE SINGLETON, not component state: `Blocks` is rendered by
// several hosts at once (each canvas card, each gate body). A per-component
// provider would let two overlays open simultaneously — each owning a history
// entry, so Android back would close the wrong one. Mounting this provider
// anywhere is therefore safe and idempotent: it only subscribes.
//
// The expanded surface is the SAME live DOM node moved into the overlay by
// portal — not a second render. One render means embedded and fullscreen can
// never drift, and edits made fullscreen survive the collapse.
import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
  useSyncExternalStore, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";

interface FullscreenCtx {
  openId: string | null;
  expand: (id: string, title: string) => void;
  close: () => void;
}
const Ctx = createContext<FullscreenCtx>({ openId: null, expand: () => {}, close: () => {} });

// ── singleton store ──────────────────────────────────────────────────────────
let openId: string | null = null;
let openTitle = "";
const listeners = new Set<() => void>();

function setOpen(next: string | null, title = "") {
  if (openId === next && openTitle === title) return;
  openId = next;
  openTitle = title;
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

export function useCanvasExpand() {
  return useContext(Ctx);
}
const useOpen = () => useSyncExternalStore(subscribe, () => openId, () => null);
const useTitle = () => useSyncExternalStore(subscribe, () => openTitle, () => "");

export function CanvasFullscreenProvider({ children }: { children: ReactNode }) {
  const id = useOpen();
  const title = useTitle();
  const open = id !== null;

  // History + Android back, registered only while open so a canvas in the
  // background never swallows the native back button.
  useEffect(() => {
    if (!open) return;
    const prev = history.state as Record<string, unknown> | null;
    history.pushState({ ...prev, astraCanvasFull: 1 }, "");
    const onPop = () => setOpen(null);
    window.addEventListener("popstate", onPop);
    (window as unknown as Record<string, unknown>).__astraBack = () => {
      setOpen(null);
      return true;
    };
    return () => {
      window.removeEventListener("popstate", onPop);
      delete (window as unknown as Record<string, unknown>).__astraBack;
    };
  }, [open]);

  // Escape + scroll-lock, so the chat behind cannot scroll away underneath.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const ctx = useMemo<FullscreenCtx>(
    () => ({ openId: id, expand: (k, t) => setOpen(k, t), close: () => setOpen(null) }),
    [id],
  );

  return (
    <Ctx.Provider value={ctx}>
      {children}
      {open && <FullscreenShell title={title} onClose={() => setOpen(null)} />}
    </Ctx.Provider>
  );
}

// The shell owns the slot; the expanded block portals its live node into it.
function FullscreenShell({ title, onClose }: { title: string; onClose: () => void }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  return (
    <div
      className="ast-cv-full"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => closeRef.current()} // backdrop closes
    >
      <div className="ast-cv-full-pane" onClick={(e) => e.stopPropagation()}>
        <header className="ast-cv-full-head">
          <span className="ast-cv-full-title">{title}</span>
          <button
            type="button"
            className="ast-cv-full-close"
            onClick={() => closeRef.current()}
            aria-label="Close fullscreen view"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="ast-cv-full-body" data-cv-slot="1" />
      </div>
    </div>
  );
}

/**
 * Wraps a block so it can expand. `id` must be unique across the whole page — it
 * is the singleton fullscreen key, so a collision expands the wrong card.
 */
export function Expandable({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const { expand } = useCanvasExpand();
  const isOpen = useOpen() === id;
  const slot = useCanvasSlot(isOpen);

  return (
    <div className="ast-cv-expandable">
      <button
        type="button"
        className="ast-cv-expand-btn"
        onClick={() => expand(id, title)}
        aria-label={`Expand ${title} to fullscreen`}
        title="Expand to fullscreen"
      >
        <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {/* The live node MOVES into the overlay — one render, so an edit made
          fullscreen is still there on collapse. Its old spot says so rather
          than collapsing to an unexplained gap. */}
      {isOpen && slot
        ? createPortal(children, slot)
        : isOpen
          ? <div className="ast-cv-expand-note">Showing fullscreen</div>
          : children}
    </div>
  );
}

// The overlay mounts in the same commit that flips `openId`, so on the first
// render the slot does not exist yet — take one frame to find it.
function useCanvasSlot(active: boolean): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) { setSlot(null); return; }
    const el = document.querySelector<HTMLElement>('[data-cv-slot="1"]');
    if (el) { setSlot(el); return; }
    const raf = requestAnimationFrame(() => {
      setSlot(document.querySelector<HTMLElement>('[data-cv-slot="1"]'));
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return slot;
}