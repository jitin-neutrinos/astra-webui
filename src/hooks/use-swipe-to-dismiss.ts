import { useEffect } from "react";
import type { RefObject } from "react";

export function useSwipeToDismiss(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const el = ref.current;

    let startX = 0;
    let startY = 0;
    let startT = 0;
    let pointerId: number | null = null;
    let dragging = false;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (pointerId !== null) return;
      if (mq.matches) return; // if reduced-motion, skip tracking entirely

      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startT = performance.now();
      dragging = false;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already inactive (synthetic events, browser takeover) — tracking still works */
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!dragging && Math.abs(dx) < 8) return;
      if (!dragging && Math.abs(dy) > Math.abs(dx)) {
        cancel(e);
        return;
      }

      dragging = true;

      // visual dx: raw = dx < 0 ? dx : dx * 0.15
      const raw = dx < 0 ? dx : dx * 0.15;
      el.style.transition = "none";
      el.style.transform = `translateX(${raw}px)`;
    };

    const releaseCapture = (e: PointerEvent) => {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* capture already released or never set — non-fatal */
      }
    };

    const cancel = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      releaseCapture(e);
      pointerId = null;
      if (!dragging) {
        el.style.transform = "";
        el.style.transition = "";
        return;
      }
      el.style.transition = "transform 200ms cubic-bezier(0.23,1,0.32,1)";
      el.style.transform = "";
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      releaseCapture(e);
      pointerId = null;

      if (!dragging) {
        el.style.transform = "";
        el.style.transition = "";
        return;
      }

      const dt = Math.max(1, performance.now() - startT);
      const velocity = (e.clientX - startX) / dt; // px/ms
      const width = el.offsetWidth;
      const dismiss = velocity < -0.11 || (e.clientX - startX) < -width * 0.4;

      el.style.transition = "transform 200ms cubic-bezier(0.23,1,0.32,1)";
      el.style.transform = dismiss ? "translateX(-100%)" : "";

      if (dismiss) {
        setTimeout(() => {
          el.style.transform = "";
          el.style.transition = "";
          onDismiss();
        }, 200);
      } else {
        setTimeout(() => {
          el.style.transform = "";
          el.style.transition = "";
        }, 200);
      }
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", cancel);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", cancel);
      el.style.transform = "";
      el.style.transition = "";
    };
  }, [enabled, onDismiss, ref]);
}
