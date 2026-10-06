// brand-picker.tsx — the Brand section of Appearance.
//
// App name, tagline, logo. The wordmark preview renders in the REAL name at the
// real sidebar scale, with the auto-scale the measurements call for: a long name
// shrinks toward a 0.62 floor and then truncates, because below that floor it is
// unreadable type rather than a small wordmark.

import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";
import {
  brand, loadBrand, setBrandText, setBrandIcon,
  brandIcon, measureWordmark, wordmarkScale, type Brand,
} from "../lib/brand-store";

export function BrandPicker() {
  const [b, setB] = useState<Brand>(() => brand());
  const [name, setName] = useState(b.name);
  const [tagline, setTagline] = useState(b.tagline);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const specRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    void loadBrand().then((next) => {
      setB(next);
      setName(next.name);
      setTagline(next.tagline);
    });
    const on = (e: Event) => {
      const next = (e as CustomEvent<Brand>).detail;
      setB(next);
      setName(next.name);
      setTagline(next.tagline);
    };
    window.addEventListener("astra-brand-change", on);
    return () => window.removeEventListener("astra-brand-change", on);
  }, []);

  // The sidebar wordmark column is 120px at 14px/600 — the widths the
  // wordmarkScale floor was measured against.
  const scale = measureWordmark(
    `var(--font-display), Georgia, serif`,
    name || "Astra",
    14,
  );
  const fitted = wordmarkScale(scale, 120);

  const save = async () => {
    setBusy(true); setMsg(null);
    const ok = await setBrandText(name, tagline);
    setMsg(ok ? "Saved" : "Could not save");
    setBusy(false);
    if (ok) window.setTimeout(() => setMsg(null), 2000);
  };

  const upload = async (file: File) => {
    setBusy(true); setMsg(null);
    try {
      const ok = await setBrandIcon(file);
      setMsg(ok ? "Logo updated" : "Could not update the logo");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
      window.setTimeout(() => setMsg(null), 2500);
    }
  };

  return (
    <div className="tf-section" data-testid="tf-brand">
      <div className="tf-section-head">
        <span className="tf-section-title">Brand</span>
        <span className="tf-sub">name, tagline and logo</span>
      </div>

      <div className="tf-brandrow">
        {/* <img> only — an <img>-referenced SVG cannot execute script. */}
        <img src={brandIcon(32)} alt="" aria-hidden="true" className="tf-brandlogo" />
        <div className="tf-brandfields">
          <label className="tf-bfield">
            <span>App name</span>
            <input className="tf-input" value={name} maxLength={40}
              onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="tf-bfield">
            <span>Tagline</span>
            <input className="tf-input" value={tagline} maxLength={40}
              onChange={(e) => setTagline(e.target.value)} />
          </label>
        </div>
      </div>

      {/* The sidebar wordmark, at its real size, with the auto-scale. A long
          name shrinks to the floor and then the CSS truncates it — the two
          mechanisms together are what keeps the rail intact. */}
      <div className="tf-wordmark" title={name}>
        <span ref={specRef} style={{ transform: `scale(${fitted})`, transformOrigin: "left center" }}>
          {name || "Astra"}
        </span>
        {tagline && <em>{tagline}</em>}
      </div>
      {fitted < 1 && (
        <p className="tf-note">
          At the sidebar's width this name is scaled to {Math.round(fitted * 100)}%
          {fitted <= 0.621 ? " — the minimum, after which it truncates" : ""}.
        </p>
      )}

      <div className="tf-bg-row">
        <button type="button" className="tf-mini tf-mini-primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save brand"}
        </button>
        <button type="button" className="tf-mini" disabled={busy}
          onClick={() => fileRef.current?.click()}>
          Upload a logo
        </button>
        <span className="tf-sub">png · svg · ico · webp</span>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/svg+xml,.ico,image/webp"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />

      {msg && <p className={cn(msg.includes("Could not") ? "tf-warn" : "tf-note")} role="status">{msg}</p>}

      <p className="tf-note">
        The name drives the window title, the installed-app name and the sidebar wordmark.
        An SVG logo is sanitised on upload — scripts, event handlers and external
        references are stripped — and is always rendered as an image, never as markup.
      </p>
    </div>
  );
}
