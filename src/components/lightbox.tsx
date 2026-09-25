import { useCallback, useEffect, useState, useRef, type ReactPortal } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "../lib/utils";
import { usePrefersReducedMotion } from "./chat-timeline";

export interface LightboxImage {
  id: string;
  url: string;
  alt?: string;
}

export function Lightbox({
  open,
  images,
  index,
  onClose,
  onIndex,
}: {
  open: boolean;
  images: LightboxImage[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}): ReactPortal | null {
  const [zoomed, setZoomed] = useState(false);
  const hasMultiple = images.length > 1;
  const instant = usePrefersReducedMotion();
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const prev = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    onIndex(index > 0 ? index - 1 : images.length - 1);
    setZoomed(false);
  }, [index, images.length, onIndex]);

  const next = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    onIndex(index < images.length - 1 ? index + 1 : 0);
    setZoomed(false);
  }, [index, images.length, onIndex]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement;
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
        case "ArrowLeft":
          if (hasMultiple) prev();
          break;
        case "ArrowRight":
          if (hasMultiple) next();
          break;
        case "Tab": {
          const container = containerRef.current;
          if (!container) break;
          const focusable = container.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])');
          if (focusable.length === 0) break;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
          break;
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, hasMultiple, onClose, prev, next]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    
    // Focus trap
    const container = containerRef.current;
    if (container) {
      container.focus();
    }
    
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus();
    };
  }, [open]);

  if (typeof document === "undefined" || !open) return null;
  const currentImage = images[index] ?? images[0];
  if (!currentImage?.url) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      ref={containerRef}
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface-base)] outline-none",
        instant ? "transition-opacity duration-[var(--motion-slow)]" : "transition-all duration-[var(--motion-slow)] ease-[var(--ease-brand)]"
      )}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-expanded="true"
        className="absolute top-4 right-4 z-10 flex h-11 w-11 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--surface-overlay)] text-white hover:bg-[var(--surface-step-2)] transition-colors duration-[var(--motion-fast)]"
      >
        <X className="h-5 w-5" />
      </button>

      {hasMultiple && (
        <button
          type="button"
          onClick={prev}
          className="absolute left-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--surface-overlay)] text-white hover:bg-[var(--surface-step-2)] transition-colors duration-[var(--motion-fast)]"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}

      <div 
        className={cn(
          "h-full w-full flex items-center justify-center",
          zoomed ? "overflow-auto items-start justify-start" : "overflow-hidden"
        )}
      >
        <img
          src={currentImage.url}
          alt={currentImage.alt ?? "Image preview"}
          className={cn(
            "transition-transform duration-[var(--motion-slow)] ease-[var(--ease-brand)] select-none",
            zoomed ? "max-h-none max-w-none cursor-zoom-out" : "max-h-[90vh] max-w-[90vw] object-contain cursor-zoom-in",
            !instant && !zoomed && "scale-100"
          )}
          onClick={(e) => {
            e.stopPropagation();
            setZoomed(!zoomed);
          }}
          draggable={false}
        />
      </div>

      {hasMultiple && (
        <button
          type="button"
          onClick={next}
          className="absolute right-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--surface-overlay)] text-white hover:bg-[var(--surface-step-2)] transition-colors duration-[var(--motion-fast)]"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}
    </div>,
    document.body
  );
}
