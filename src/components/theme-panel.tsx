// theme-panel.tsx — Config page "Appearance" section.
// Astra UI is the only theme. This panel shows: the theme (Astra UI), a Dark/Light mode
// toggle wired to the SAME state as the sidebar button, a live token editor for the active
// mode, and the chat backdrop picker (image URL / upload / video / YouTube).
// Compact, flat, brand-locked (uses the page's existing card/chip vocabulary).
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils";
import {
  palettes, currentPaletteId, setPalette, getMode,
  readCustom, clearCustom, setToken, mergeCustom, readChatBg, writeChatBg,
  youtubeId, type Palette, type ThemeMode,
} from "../lib/theme-store";
import { useTheme } from "./theme-toggle";

const SWATCH_TOKENS = ["--color-void", "--color-midnight", "--color-depth", "--color-cyanx", "--color-violetx", "--color-fuchsiax", "--color-redx", "--color-emerald"];
const EDIT_TOKENS = ["--color-void", "--color-midnight", "--color-depth", "--color-surface", "--color-brandtext", "--color-muted", "--color-cyanx", "--color-violetx", "--color-fuchsiax", "--color-redx", "--color-emerald", "--color-amber"];

export function ThemePanel({ onUpload }: { onUpload?: (file: File) => Promise<string> }) {
  const [active, setActive] = useState(currentPaletteId());
  const [mode, setMode] = useState<ThemeMode>(getMode());
  const [customTick, setCustomTick] = useState(0); // re-render on edits
  const [bg, setBg] = useState(readChatBg());
  const [bgUrl, setBgUrl] = useState("");
  const [busyUp, setBusyUp] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // SAME hook the sidebar toggle uses: one source of truth, so flipping either control moves
  // both. The hook owns the wipe animation and the data-theme flip + broadcast.
  const [theme, toggleTheme] = useTheme();
  const isLight = theme === "light";

  useEffect(() => {
    const onMode = () => setMode(getMode());
    window.addEventListener("astra-theme-change", onMode);
    return () => window.removeEventListener("astra-theme-change", onMode);
  }, []);

  // palette list is a single entry now, but keep the lookup shape so re-adding a theme later
  // is a data change, not a rewrite.
  const shown: Palette = useMemo(() => {
    const p = palettes.find((x) => x.id === active) || palettes[0];
    return mergeCustom(p);
  }, [active, customTick]);

  const applyBg = (next: typeof bg) => { writeChatBg(next); setBg(next); };

  const upload = async (f: File) => {
    setBusyUp(true);
    try {
      if (onUpload) { const path = await onUpload(f); applyBg({ kind: f.type.startsWith("video") ? "video" : "image", src: path }); }
      else {
        // no server route handed in: object URL (session-local fallback)
        applyBg({ kind: f.type.startsWith("video") ? "video" : "image", src: URL.createObjectURL(f) });
      }
    } finally { setBusyUp(false); }
  };

  const bgPreview = bg ? (bg.kind === "youtube" ? `YouTube · ${youtubeId(bg.src)}` : bg.src.split("/").pop()) : "none";

  return (
    <section data-theme-engine-new className="tf-panel">
      {/* theme — Astra UI is the only one */}
      <div className="tf-section">
        <div className="tf-section-head">
          <span className="tf-section-title">Theme</span>
        </div>
        <div className="tf-grid">
          {palettes.map((p) => {
            const v = mergeCustom(p).variants[mode];
            const isActive = p.id === active;
            return (
              <button key={p.id} type="button"
                className={isActive ? "tf-card tf-card-active" : "tf-card"}
                onClick={() => { setPalette(p.id); setActive(p.id); }}
                title={`${p.name} — the Astra brand theme`}>
                <span className="tf-swatches">
                  {SWATCH_TOKENS.map((t) => <i key={t} style={{ background: v[t] || "#000" }} />)}
                </span>
                <span className="tf-name">{p.name}</span>
                <span className="tf-variant">{isActive ? "active" : "tap to apply"}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* dark / light — the same state the sidebar button drives */}
      <div className="tf-section">
        <div className="tf-section-head">
          <span className="tf-section-title">Appearance</span>
          <span className="tf-sub">also on the sidebar</span>
        </div>
        <div className="tf-modes" role="radiogroup" aria-label="Colour mode">
          <button type="button" role="radio" aria-checked={!isLight}
            className={cn("tf-mode", !isLight && "tf-mode-on")}
            onClick={() => { if (isLight) toggleTheme(null); }}>
            Dark
          </button>
          <button type="button" role="radio" aria-checked={isLight}
            className={cn("tf-mode", isLight && "tf-mode-on")}
            onClick={() => { if (!isLight) toggleTheme(null); }}>
            Light
          </button>
        </div>
      </div>

      {/* token editor for the active mode */}
      <div className="tf-edit">
        <div className="tf-edit-head">
          <span className="tf-edit-title">Tokens — {shown.name} ({mode})</span>
          {readCustom()[active] && (
            <button type="button" className="tf-mini" onClick={() => { clearCustom(active); setCustomTick((t) => t + 1); }}>Reset edits</button>
          )}
        </div>
        <div className="tf-tokens">
          {EDIT_TOKENS.map((t) => (
            <label key={t} className="tf-token">
              <input type="color" value={shown.variants[mode][t] || "#000000"}
                onChange={(e) => { setToken(active, mode, t, e.target.value); setCustomTick((x) => x + 1); }} />
              <span className="tf-token-name">{t.replace("--color-", "")}</span>
              <code className="tf-token-hex">{shown.variants[mode][t]}</code>
            </label>
          ))}
        </div>
        <p className="tf-note">Edits persist on this device and apply live. Glows follow the accent; dark mode glows, light mode stays flat.</p>
      </div>

      {/* chat backdrop */}
      <div className="tf-bg">
        <div className="tf-edit-head"><span className="tf-edit-title">Chat background</span><span className="tf-sub">now: {bgPreview}</span></div>
        <div className="tf-bg-row">
          <input className="tf-input" placeholder="Image / video URL, or YouTube link"
            value={bgUrl} onChange={(e) => setBgUrl(e.target.value)} />
          <button type="button" className="tf-mini" onClick={() => {
            const u = bgUrl.trim(); if (!u) return;
            applyBg(youtubeId(u) ? { kind: "youtube", src: u } : { kind: /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u) ? "video" : "image", src: u });
          }}>Apply</button>
          <button type="button" className="tf-mini" disabled={busyUp} onClick={() => fileRef.current?.click()}>{busyUp ? "Uploading…" : "Upload"}</button>
          <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          {bg && <button type="button" className="tf-mini" onClick={() => applyBg(null)}>Off</button>}
        </div>
        {bg && (
          <label className="tf-dim">dim
            <input type="range" min={0} max={0.9} step={0.05} value={bg.dim ?? 0.45}
              onChange={(e) => applyBg({ ...bg, dim: Number(e.target.value) })} />
          </label>
        )}
        <p className="tf-note">YouTube backgrounds autoplay muted (per YouTube's embed terms) and fill the chat window at any screen size or orientation.</p>
      </div>
    </section>
  );
}
