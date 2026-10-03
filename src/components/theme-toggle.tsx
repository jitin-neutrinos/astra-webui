import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { wipeClipFromRect } from "@/lib/theme-wipe";
import { isLowSpec } from "./composer-trace";


import { cn } from "@/lib/utils";

const KEY = "astra-theme";

/* Theme wipe + icon morph — ported from comindash
 * (~/Work/Neutrinos/community-insights-dashboard/app/frontend/src/components/
 *  ThemeToggle.jsx), itself adapted from Magic UI's animated-theme-toggler (MIT).
 * Two coordinated layers:
 *   1. FULL-PAGE WIPE — View Transitions circular clip-path expanding FROM THE
 *      TOGGLE BUTTON. Percentage radius so fractional display scales stay
 *      covered; WAAPI drives ::view-transition-new(root) after `ready`.
 *      No VT (Firefox) → CSS cross-fade via `.theme-fading`; reduced motion →
 *      plain flip.
 *   2. ICON MORPH — the moon is the sun's circle with a masking circle that
 *      slides diagonally out (waning) / in (waxing), while the rays recede into
 *      the core and rotate 90°. One continuous celestial object, not two icons
 *      swapping. Comindash drives this with GSAP; astra has no GSAP and uses
 *      motion/react everywhere, so the same keyframes/eases are expressed as
 *      motion values (power3.inOut ≈ cubic-bezier(.65,0,.35,1)).
 *
 * ORIGIN (the owner-reported bug): the origin MUST come from the button that
 * was clicked. Reading `document.activeElement` instead made the wipe start
 * from screen centre — or from whatever last had focus — whenever the toggle
 * didn't hold focus (touch taps, after clicking into the chat, etc). Every
 * entry point now passes its own button ref.
 */
const WIPE_MS = 550;

function runThemeTransition(apply: () => void, btn: HTMLElement | null) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // LOW-SPEC BAIL-OUT. `document.startViewTransition` snapshots the WHOLE viewport and animates
  // a clip-path over it; on a weak phone (few cores / little memory) that snapshot + composite
  // is the multi-second hang the owner reported on the dark/light toggle. The theme flip itself
  // is a variable swap and is instant — only the transition is expensive — so on low-spec we do
  // the flip directly and skip the wipe entirely. Same helper the composer trace uses, so the
  // "is this device weak" judgement stays in one place.
  const lowSpec = isLowSpec();
  if (reduce || lowSpec || typeof document.startViewTransition !== "function") {
    if (!reduce && !lowSpec) {
      const root = document.documentElement;
      root.classList.add("theme-fading");
      apply();
      window.setTimeout(() => root.classList.remove("theme-fading"), 300);
    } else {
      // No transition at all: still flip synchronously so there is zero perceived delay.
      apply();
    }
    return;
  }
  const w = window.innerWidth;   // innerWidth: snapshot box incl. scrollbars
  const h = window.innerHeight;
  // Origin = centre of the control that was clicked — never
  // document.activeElement (see theme-wipe.ts for why that was the bug).
  const { clip } = wipeClipFromRect(btn?.getBoundingClientRect(), w, h);
  const vt = document.startViewTransition(apply);
  vt.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: clip },
        { duration: WIPE_MS, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => {});
  vt.finished.catch(() => {});
}

function applyTheme(theme: "dark" | "light") {
  // Target the plain meta only — the media-variant is the no-JS fallback.
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    meta?.setAttribute("content", "#f5f2ec");
  } else {
    document.documentElement.removeAttribute("data-theme");
    meta?.setAttribute("content", "#0a0a0f");
  }
  // broadcast so every listener (login toggle, background canvas, …) re-renders
  window.dispatchEvent(new CustomEvent("astra-theme-change", { detail: theme }));
}

function readTheme(): "dark" | "light" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/** Shared theme state: follows the data-theme attribute + cross-tab storage. */
export function useTheme(): ["dark" | "light", (btn?: HTMLElement | null) => void] {
  const [theme, setTheme] = useState<"dark" | "light">(readTheme);
  useEffect(() => {
    const onChange = (e: Event) => {
      const t = (e as CustomEvent<"dark" | "light">).detail;
      if (t === "dark" || t === "light") setTheme(t);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && (e.newValue === "light" || e.newValue === "dark")) {
        setTheme(e.newValue);
        applyTheme(e.newValue);
      }
    };
    window.addEventListener("astra-theme-change", onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("astra-theme-change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const toggle = (btn?: HTMLElement | null) => {
    const next = theme === "dark" ? "light" : "dark";
    // flushSync: the DOM flip must land synchronously inside the view
    // transition's update callback or the snapshot misses the new theme.
    runThemeTransition(() => {
      flushSync(() => setTheme(next));
      applyTheme(next);
      try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
    }, btn ?? null);
  };
  return [theme, toggle];
}

/**
 * Theme icon — comindash sun↔moon morph (ported, GSAP → CSS transitions).
 * The moon is the sun's core with a mask circle that slides diagonally out
 * (waxing) or in (waning); rays recede/rotate. One continuous celestial
 * object, not two icons swapping. Reduced motion snaps (CSS handles it).
 */
function ThemeGlyph({ dark }: { dark: boolean }) {
  const id = useId().replace(/[:]/g, "");
  const maskId = `tt-mask-${id}`;
  return (
    <span className="theme-glyph" data-mode={dark ? "dark" : "light"}>
      <span className="theme-glyph-slot tt-morph" data-dark={dark ? "1" : "0"}>
        <svg width="22" height="22" viewBox="0 0 25 25" fill="none" aria-hidden="true">
          <defs>
            <mask id={maskId}>
              <rect x="0" y="0" width="25" height="25" fill="white" />
              {/* the sliding bite: dark => moon (bite in at 15.4,6.6), light => hidden (20,6) */}
              <circle className="tt-morph-mask" cx={dark ? 15.4 : 20} cy={dark ? 6.6 : 6} r="7" fill="black" />
            </mask>
          </defs>
          <g mask={`url(#${maskId})`}>
            <circle className="tt-morph-core" cx="12.5" cy="12.5" r={dark ? 8.4 : 6.9} fill="currentColor" />
          </g>
          <g className="tt-morph-rays" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <line x1="12.5" y1="1.6" x2="12.5" y2="4.2" />
            <line x1="12.5" y1="20.8" x2="12.5" y2="23.4" />
            <line x1="1.6" y1="12.5" x2="4.2" y2="12.5" />
            <line x1="20.8" y1="12.5" x2="23.4" y2="12.5" />
            <line x1="4.8" y1="4.8" x2="6.6" y2="6.6" />
            <line x1="18.4" y1="18.4" x2="20.2" y2="20.2" />
            <line x1="4.8" y1="20.2" x2="6.6" y2="18.4" />
            <line x1="18.4" y1="6.6" x2="20.2" y2="4.8" />
          </g>
        </svg>
      </span>
    </span>
  );
}

/** Sidebar row variant. Wipe origin = this button, always. */
export function ThemeToggle({ expanded }: { expanded: boolean }) {
  const [theme, toggle] = useTheme();
  const btn = useRef<HTMLButtonElement>(null);
  const light = theme === "light";
  return (
    <button
      ref={btn}
      type="button"
      onClick={() => toggle(btn.current)}
      role="switch"
      aria-checked={light}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      title={expanded ? (light ? "Light mode" : "Dark mode") : undefined}
      className={cn(
        "group relative flex h-11 w-full items-center rounded-md text-slate-400 transition-colors duration-200 hover:bg-cyanx/10 hover:text-cyanx press-feedback",
        // Collapsed rail: the glyph IS the button — centred square with padding
        // instead of the 48px edge-to-edge icon well, so the artwork sits inset
        // in the 64px rail rather than filling it.
        !expanded && "justify-center px-1.5",
      )}
    >
      <span className={cn("grid h-full shrink-0 place-content-center", expanded ? "w-12" : "w-full")}>
        <ThemeGlyph dark={!light} />
      </span>
      {expanded && (
        <span className="truncate text-sm font-medium">
          {light ? "Light mode" : "Dark mode"}
        </span>
      )}
    </button>
  );
}

/** Compact icon-only variant for the login card. Same morph, own mask id. */
export function ThemeIconButton() {
  const [theme, toggle] = useTheme();
  const btn = useRef<HTMLButtonElement>(null);
  const light = theme === "light";
  return (
    <button
      ref={btn}
      type="button"
      onClick={() => toggle(btn.current)}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      title={light ? "Switch to dark mode" : "Switch to light mode"}
      className="absolute right-4 top-4 z-[60] grid h-9 w-9 place-content-center rounded-[10px] border border-white/10 bg-black/30 text-slate-300 transition-colors duration-200 hover:border-cyanx/50 hover:bg-cyanx/10 hover:text-cyanx press-feedback"
    >
      <ThemeGlyph dark={!light} />
    </button>
  );
}
