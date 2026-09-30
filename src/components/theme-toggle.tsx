import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";

const KEY = "astra-theme";

/* Theme wipe — circular View Transitions reveal expanding from the clicked
 * toggle (ported from comindash community-insights-dashboard ThemeToggle,
 * itself adapted from Magic UI's animated-theme-toggler, MIT). Radius is a
 * percentage of the snapshot box's hypot/√2 so fractional display scales
 * stay covered. Reduced motion or no View Transitions (Firefox): plain flip,
 * with a short CSS cross-fade (`theme-fading` in index.css) where allowed. */
const WIPE_MS = 550;
const radiusPct = (x: number, y: number, w: number, h: number) => {
  const r = Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
  return (r / (Math.hypot(w, h) / Math.SQRT2)) * 100;
};

function runThemeTransition(apply: () => void) {
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
  // Origin = center of the control that triggered the toggle; fallback to
  // screen center if focus was stolen (rect empty).
  const el = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const rect = el?.getBoundingClientRect();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const x = rect && rect.width > 0 ? rect.left + rect.width / 2 : w / 2;
  const y = rect && rect.height > 0 ? rect.top + rect.height / 2 : h / 2;
  const pct = radiusPct(x, y, w, h);
  const vt = document.startViewTransition(apply);
  vt.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0% at ${x}px ${y}px)`, `circle(${pct}% at ${x}px ${y}px)`] },
        {
          duration: WIPE_MS,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          fill: "forwards",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => {});
}

function apply(theme: "dark" | "light") {
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
export function useTheme(): ["dark" | "light", () => void] {
  const [theme, setTheme] = useState<"dark" | "light">(readTheme);
  useEffect(() => {
    const onChange = (e: Event) => {
      const t = (e as CustomEvent<"dark" | "light">).detail;
      if (t === "dark" || t === "light") setTheme(t);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && (e.newValue === "light" || e.newValue === "dark")) {
        setTheme(e.newValue);
        apply(e.newValue);
      }
    };
    window.addEventListener("astra-theme-change", onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("astra-theme-change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    // flushSync: the DOM flip must land synchronously inside the view
    // transition's update callback or the snapshot misses the new theme.
    runThemeTransition(() => {
      flushSync(() => setTheme(next));
      apply(next);
      try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
    });
  };
  return [theme, toggle];
}

/** Sidebar row variant (existing behavior preserved). */
export function ThemeToggle({ expanded }: { expanded: boolean }) {
  const [theme, toggle] = useTheme();
  const light = theme === "light";
  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={light}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      title={expanded ? (light ? "Dark mode" : "Light mode") : undefined}
      className="group relative flex h-11 w-full items-center rounded-md text-slate-400 transition-colors duration-200 hover:bg-cyanx/10 hover:text-cyanx press-feedback"
    >
      <span className="grid h-full w-12 shrink-0 place-content-center">
        {light
          ? <Moon className="h-4 w-4" strokeWidth={1.5} />
          : <Sun className="h-4 w-4" strokeWidth={1.5} />}
      </span>
      {expanded && (
        <span className="truncate text-sm font-medium">
          {light ? "Dark mode" : "Light mode"}
        </span>
      )}
    </button>
  );
}

/** Compact icon-only variant for the login card: shows the CURRENT theme's
    icon (sun in light, moon in dark); each click rotates to the other theme. */
export function ThemeIconButton() {
  const [theme, toggle] = useTheme();
  const light = theme === "light";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      title={light ? "Switch to dark mode" : "Switch to light mode"}
      className="absolute right-4 top-4 z-[60] grid h-9 w-9 place-content-center rounded-full border border-white/10 bg-black/30 text-slate-300 transition-colors duration-200 hover:border-cyanx/50 hover:bg-cyanx/10 hover:text-cyanx press-feedback"
    >
      {light
        ? <Sun className="h-4 w-4" strokeWidth={1.5} />
        : <Moon className="h-4 w-4" strokeWidth={1.5} />}
    </button>
  );
}
