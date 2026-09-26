import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const KEY = "astra-theme";

function apply(theme: "dark" | "light") {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#f5f2ec");
  } else {
    document.documentElement.removeAttribute("data-theme");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#0a0a0f");
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
    setTheme(next);
    apply(next);
    try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
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
      className="group relative flex h-11 w-full items-center rounded-md border-l-2 border-transparent text-slate-400 transition-colors duration-200 hover:border-cyanx/60 hover:bg-cyanx/10 hover:text-cyanx press-feedback"
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
      className="absolute right-4 top-4 z-30 grid h-9 w-9 place-content-center rounded-full border border-white/10 bg-black/30 text-slate-300 transition-colors duration-200 hover:border-cyanx/50 hover:bg-cyanx/10 hover:text-cyanx press-feedback"
    >
      {light
        ? <Sun className="h-4 w-4" strokeWidth={1.5} />
        : <Moon className="h-4 w-4" strokeWidth={1.5} />}
    </button>
  );
}
