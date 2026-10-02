import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { wipeClipFromRect } from "@/lib/theme-wipe";
import { LottieIcon, useLottieAssets } from "./theme-lottie";

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
  if (reduce || typeof document.startViewTransition !== "function") {
    if (!reduce) {
      const root = document.documentElement;
      root.classList.add("theme-fading");
      apply();
      window.setTimeout(() => root.classList.remove("theme-fading"), 300);
    } else {
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
 * Illustrated sun — warm gradient core, eight tapered rays, slow rotation.
 * Light-mode icon. Kept as inline SVG rather than a PNG/WebM: it stays crisp at
 * any DPR, recolours with the theme, animates in CSS, and costs ~1KB.
 */
function SunIcon() {
  const reduce = useReducedMotion();
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true" className="theme-sun">
      <defs>
        <radialGradient id="astra-sun-core" cx="0.4" cy="0.35" r="0.75">
          <stop offset="0%" stopColor="#FEF3C7" />
          <stop offset="45%" stopColor="#FCD34D" />
          <stop offset="100%" stopColor="#F59E0B" />
        </radialGradient>
        <linearGradient id="astra-sun-ray" x1="16" y1="6" x2="16" y2="2" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
      </defs>
      {/* rays: a slow turn is what makes it read as animated rather than static */}
      <motion.g
        stroke="url(#astra-sun-ray)" strokeWidth="2.6" strokeLinecap="round"
        style={{ transformOrigin: "16px 16px" }}
        animate={{ rotate: reduce ? 0 : 360 }}
        transition={{ duration: reduce ? 0 : 48, ease: "linear", repeat: Infinity }}
      >
        <line x1="16" y1="9.4" x2="16" y2="3.4" />
        <line x1="16" y1="22.6" x2="16" y2="28.6" />
        <line x1="9.4" y1="16" x2="3.4" y2="16" />
        <line x1="22.6" y1="16" x2="28.6" y2="16" />
        <line x1="11.4" y1="11.4" x2="7.2" y2="7.2" strokeWidth="2.1" />
        <line x1="20.6" y1="20.6" x2="24.8" y2="24.8" strokeWidth="2.1" />
        <line x1="20.6" y1="11.4" x2="24.8" y2="7.2" strokeWidth="2.1" />
        <line x1="11.4" y1="20.6" x2="7.2" y2="24.8" strokeWidth="2.1" />
      </motion.g>
      {/* core with a soft inner highlight so it reads dimensional, not flat */}
      <circle cx="16" cy="16" r="6.6" fill="url(#astra-sun-core)" />
      <circle cx="13.8" cy="13.6" r="2.1" fill="#FFFBEB" opacity="0.55" />
    </svg>
  );
}

/**
 * Illustrated moon — crescent carved by a masking circle, with three craters and
 * a cool rim light. Dark-mode icon. The craters are the point: a plain crescent
 * reads as a generic glyph, the pitting reads as "the moon".
 */
function MoonIcon() {
  const reduce = useReducedMotion();
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true" className="theme-moon">
      <defs>
        <linearGradient id="astra-moon-body" x1="8" y1="6" x2="24" y2="27" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#E2E8F0" />
          <stop offset="45%" stopColor="#94A3B8" />
          <stop offset="100%" stopColor="#64748B" />
        </linearGradient>
        <mask id="astra-moon-crescent">
          <rect x="0" y="0" width="32" height="32" fill="black" />
          <circle cx="15" cy="16" r="12" fill="white" />
          {/* carve the crescent */}
          <circle cx="23.5" cy="12.5" r="11" fill="black" />
        </mask>
        <clipPath id="astra-moon-clip">
          <circle cx="15" cy="16" r="12" />
        </clipPath>
      </defs>
      {/* The crescent carries its own dark edge. Light mode has no glow (owner
          rule), so on the paper theme a silver moon vanished — the silhouette
          stroke is what keeps it legible there, in both themes. */}
      <g mask="url(#astra-moon-crescent)">
        <circle cx="15" cy="16" r="12" fill="url(#astra-moon-body)" />
        <circle cx="15" cy="16" r="11.6" fill="none" stroke="#334155" strokeWidth="1.6" opacity="0.85" />
        {/* craters — a lighter lip and a darker floor sell the depression */}
        <g clipPath="url(#astra-moon-clip)">
          <circle cx="11.4" cy="12.2" r="3.1" fill="#94A3B8" opacity="0.55" />
          <circle cx="10.7" cy="11.2" r="2.4" fill="#E2E8F0" opacity="0.45" />
          <circle cx="15.6" cy="20.4" r="2.4" fill="#64748B" opacity="0.5" />
          <circle cx="15.1" cy="19.7" r="1.7" fill="#E2E8F0" opacity="0.35" />
          <circle cx="9.6" cy="20.6" r="1.5" fill="#64748B" opacity="0.42" />
          <circle cx="19.4" cy="16.2" r="1.2" fill="#64748B" opacity="0.35" />
        </g>
        {/* rim light along the lit edge */}
        <path
          d="M6.2 9.4a12 12 0 0 0 0 13.2"
          stroke="#F1F5F9" strokeWidth="1.1" strokeLinecap="round" opacity="0.75"
        />
      </g>
      {/* a slow drift so the moon breathes instead of sitting dead still */}
      <motion.g
        style={{ transformOrigin: "15px 16px" }}
        animate={{ rotate: reduce ? 0 : -6 }}
        transition={{ duration: reduce ? 0 : 9, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" }}
      >
        <circle cx="26.4" cy="7.6" r="0.9" fill="#E2E8F0" opacity="0.8" />
        <circle cx="5.4" cy="6.2" r="0.65" fill="#CBD5E1" opacity="0.7" />
        <circle cx="28.2" cy="20.4" r="0.55" fill="#CBD5E1" opacity="0.55" />
      </motion.g>
    </svg>
  );
}

/**
 * Theme icon: an ILLUSTRATED sun (light mode) or moon (dark mode), crossfaded
 * and scaled on switch. `id` is unique per instance so the gradient/mask defs
 * of two toggles on one page never collide.
 */
function ThemeGlyph({ dark }: { dark: boolean }) {
  const reduce = useReducedMotion();
  // Owner-supplied illustrated Lottie assets, if present (see theme-lottie.tsx).
  // Until they land, the inline SVG below is the fallback — the toggle must
  // never render blank.
  const assets = useLottieAssets();
  const lottieUrl = dark ? (assets.moon ? "/lottie/theme-moon.json" : null)
                         : (assets.sun ? "/lottie/theme-sun.json" : null);
  const spring = reduce
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 260, damping: 26 };
  return (
    <span className="theme-glyph" data-mode={dark ? "dark" : "light"}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={dark ? "moon" : "sun"}
          className="theme-glyph-slot"
          initial={{ opacity: 0, scale: reduce ? 1 : 0.55, rotate: reduce ? 0 : dark ? -35 : 35 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: reduce ? 1 : 0.55, rotate: reduce ? 0 : dark ? 35 : -35 }}
          transition={spring}
        >
          {lottieUrl ? <LottieIcon url={lottieUrl} /> : (dark ? <MoonIcon /> : <SunIcon />)}
        </motion.span>
      </AnimatePresence>
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
      title={expanded ? (light ? "Dark mode" : "Light mode") : undefined}
      className="group relative flex h-11 w-full items-center rounded-md text-slate-400 transition-colors duration-200 hover:bg-cyanx/10 hover:text-cyanx press-feedback"
    >
      <span className="grid h-full w-12 shrink-0 place-content-center">
        <ThemeGlyph dark={light} />
      </span>
      {expanded && (
        <span className="truncate text-sm font-medium">
          {light ? "Dark mode" : "Light mode"}
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
      <ThemeGlyph dark={light} />
    </button>
  );
}
