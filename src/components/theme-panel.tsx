// theme-panel.tsx — Config page "Themes" section: palette picker + token editor
// + chat backdrop picker (image URL / upload / video / YouTube). Compact, flat,
// brand-locked (no new shapes; uses the page's existing card/chip vocabulary).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  palettes, currentPaletteId, setPalette, resetToAstra, getMode,
  readCustom, clearCustom, setToken, mergeCustom, readChatBg, writeChatBg,
  youtubeId, type Palette, type ThemeMode,
} from "../lib/theme-store";

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

  useEffect(() => {
    const onMode = () => setMode(getMode());
    window.addEventListener("astra-theme-change", onMode);
    return () => window.removeEventListener("astra-theme-change", onMode);
  }, []);

  const shown: Palette = useMemo(() => {
    const p = palettes.find((x) => x.id === active) || palettes[0];
    return mergeCustom(p);
  }, [active, customTick]); // customTick intentionally re-derives after edits; mode flips with the toggle (customTick bumps on mode change too)

  const pick = (id: string) => { setPalette(id); setActive(id); };

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
      <header className="tf-head">
        <h3 className="tf-title">Themes</h3>
        <span className="tf-sub">{palettes.length} palettes · colours & backgrounds only</span>
      </header>

      {/* palette picker */}
      <div className="tf-grid">
        {palettes.map((p) => {
          const v = mergeCustom(p).variants[mode];
          const isActive = p.id === active;
          return (
            <button key={p.id} type="button"
              className={isActive ? "tf-card tf-card-active" : "tf-card"}
              onClick={() => pick(p.id)}
              title={`${p.name} — ${p.source}`}>
              <span className="tf-swatches">
                {SWATCH_TOKENS.map((t) => <i key={t} style={{ background: v[t] || "#000" }} />)}
              </span>
              <span className="tf-name">{p.name}</span>
            </button>
          );
        })}
      </div>

      {/* token editor for the active palette */}
      <div className="tf-edit">
        <div className="tf-edit-head">
          <span className="tf-edit-title">Tokens — {shown.name} ({mode})</span>
          {active !== "astra-ui" && readCustom()[active] && (
            <button type="button" className="tf-mini" onClick={() => { clearCustom(active); setCustomTick((t) => t + 1); }}>Reset edits</button>
          )}
          {active !== "astra-ui" && <button type="button" className="tf-mini" onClick={() => { resetToAstra(); setActive("astra-ui"); }}>Use Astra UI</button>}
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
        <p className="tf-note">Edits persist on this device and apply live. Glows follow the accent; dark modes glow, light modes stay flat.</p>
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
