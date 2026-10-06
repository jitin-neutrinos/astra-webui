// brand-store.ts — the app's editable identity: logo, name, tagline.
//
// One fetch of an UNGATED /api/brand/state, then every consumer reads from a
// module-level snapshot rather than re-fetching. The logo is applied as:
//   - document.title
//   - <link rel=icon> and <link rel=apple-touch-icon>, rewritten with ?v=<rev>
//   - <link rel=manifest>, which MUST be cache-busted or the browser keeps the
//     old manifest forever, and MUST be root-relative in its icon src
//   - a data-brand attribute on <html>, so CSS can react to the name
//
// Logos render through <img src>, never dangerouslySetInnerHTML: an
// <img>-referenced SVG cannot execute script even if the sanitizer were bypassed.

import { useEffect, useState } from "react";

export interface Brand {
  name: string;
  tagline: string;
  /** Same-origin URL, or null when the default logo is in use. */
  icon32: string | null;
  rev: number;
}

const DEFAULT_BRAND: Brand = { name: "Astra", tagline: "Command Center", icon32: null, rev: 0 };
const FALLBACK_ICON = "/astra-logo.png";

let current: Brand = { ...DEFAULT_BRAND };
let loaded = false;

export function brand(): Brand {
  return current;
}

/**
 * The logo URL a consumer should render, with the cache-busting rev.
 *
 * `size` is a HINT, not a transform: the server stores ONE uploaded file and
 * serves it at whatever size the browser asks for. So the value is carried in
 * the URL's `sizes` hint only where it is meaningful, and the returned URL is
 * the same asset — inventing a per-size derivative the server does not produce
 * would 404 the favicon the moment anyone used the 180 variant.
 */
export function brandIcon(size: 32 | 180 = 32): string {
  void size;
  if (!current.icon32) return FALLBACK_ICON;
  return `${current.icon32}?v=${encodeURIComponent(current.rev)}`;
}

/** Upsert a <link> rather than assuming one exists. */
function upsertLink(rel: string, attrs: Record<string, string>) {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    document.head.appendChild(el);
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

/** Push the current brand into the document. */
function apply(b: Brand) {
  if (typeof document === "undefined") return;
  const v = `?v=${encodeURIComponent(b.rev)}`;
  document.title = b.name;
  document.documentElement.setAttribute("data-brand", b.name);
  upsertLink("icon", { type: "image/png", sizes: "32x32", href: `${brandIcon(32)}${v}` });
  upsertLink("apple-touch-icon", { sizes: "180x180", href: `${brandIcon(180)}${v}` });
  // Root-relative, and cache-busted: a relative manifest src resolves against
  // the manifest's own directory, and an un-busted one is never re-fetched.
  upsertLink("manifest", { href: `/api/brand/manifest${v}` });
}

function isBrand(v: unknown): v is Brand {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.name === "string" && o.name.length > 0 && o.name.length <= 40;
}

/** Fetch and apply. Safe to call more than once; only fetches when forced. */
export async function loadBrand(force = false): Promise<Brand> {
  if (loaded && !force) return current;
  try {
    const res = await fetch("/api/brand/state", { cache: "no-store" });
    if (!res.ok) return current;
    const data = await res.json();
    if (!isBrand(data)) return current;
    current = {
      name: data.name,
      tagline: typeof data.tagline === "string" ? data.tagline.slice(0, 40) : "",
      icon32: typeof data.icon32 === "string" ? data.icon32 : null,
      rev: typeof data.rev === "number" ? data.rev : 0,
    };
    loaded = true;
    apply(current);
    window.dispatchEvent(new CustomEvent("astra-brand-change", { detail: current }));
  } catch { /* offline: keep the defaults rather than blanking the app */ }
  return current;
}

/** React binding so every logo/name consumer repaints when the brand changes.
 *
 * Without this the six logo <img> sites read a module-level snapshot at mount
 * and never update: the rename saves, the server persists, and the sidebar still
 * shows the old name until a reload. The event is the whole mechanism. */
export function useBrand(): Brand {
  const [b, setB] = useState<Brand>(() => current);
  useEffect(() => {
    setB(current);
    const on = (e: Event) => setB((e as CustomEvent<Brand>).detail);
    window.addEventListener("astra-brand-change", on);
    return () => window.removeEventListener("astra-brand-change", on);
  }, []);
  return b;
}

/** Set the name and tagline. Returns false when the server refuses. */
export async function setBrandText(name: string, tagline: string): Promise<boolean> {
  try {
    const res = await fetch("/api/brand/text", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, tagline }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!isBrand(data)) return false;
    current = {
      name: data.name,
      tagline: typeof data.tagline === "string" ? data.tagline.slice(0, 40) : "",
      icon32: typeof current.icon32 === "string" ? current.icon32 : null,
      rev: typeof data.rev === "number" ? data.rev : current.rev,
    };
    apply(current);
    window.dispatchEvent(new CustomEvent("astra-brand-change", { detail: current }));
    return true;
  } catch { return false; }
}

/**
 * Upload a logo and apply it immediately.
 *
 * Rendered through <img>, so an SVG cannot execute script here regardless. The
 * server sanitises on write as well, so a direct navigation to the asset URL is
 * safe too — defence in depth, not either/or.
 */
export async function setBrandIcon(file: File): Promise<boolean> {
  try {
    const res = await fetch("/api/brand/icon", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
      body: file,
    });
    if (!res.ok) {
      let msg = `upload failed (${res.status})`;
      try { msg = (await res.json()).error || msg; } catch { /* keep */ }
      throw new Error(msg);
    }
    const data = await res.json();
    if (typeof data.url !== "string") return false;
    current = { ...current, icon32: data.url, rev: typeof data.rev === "number" ? data.rev : current.rev + 1 };
    apply(current);
    window.dispatchEvent(new CustomEvent("astra-brand-change", { detail: current }));
    return true;
  } catch { return false; }
}

/**
 * The wordmark scale for a long name.
 *
 * Measured in a real browser at 14px/600 in a 120px column: "Astra" 38.2px
 * (scale 1.00, fits), "Acme Labs" 78.1px (1.00, fits), "International
 * Holdings Group" 205.9px (clamps at 0.62 and STILL overflows by 7.6px). The
 * clamp is why a floor is mandatory — without one you get unreadable 4px type.
 */
export const WORDMARK_MIN_SCALE = 0.62;

export function wordmarkScale(naturalPx: number, availablePx: number): number {
  if (naturalPx <= 0 || availablePx <= 0) return 1;
  return Math.max(WORDMARK_MIN_SCALE, Math.min(1, availablePx / naturalPx));
}

/** Measure a wordmark once, off-screen, in its own font. */
export function measureWordmark(family: string, text: string, fontPx: number): number {
  if (typeof document === "undefined") return 0;
  const c = document.createElement("canvas").getContext("2d");
  if (!c) return 0;
  c.font = `600 ${fontPx}px ${family}`;
  return c.measureText(text).width;
}
