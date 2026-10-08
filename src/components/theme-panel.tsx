// theme-panel.tsx — the "Appearance" section of the Config page.
//
// Structure (owner revamp 2026-10-04):
//   - Theme SELECTOR as a proper dropdown (not a card grid), showing live swatches
//     for both modes of the highlighted entry so the choice is informed.
//   - Dark/Light toggle, wired to the SAME hook the sidebar button uses.
//   - Colours moved OUT of the section body into a "Customise colours" menu —
//     the default view shows no colour pickers at all.
//   - A THEME BUILDER: give it a primary + secondary accent, it generates a full
//     12-token palette for BOTH modes and contrast-checks every text role.
//   - Chat backdrop picker, persisted and synced across devices.
//
// Colour maths lives in src/lib/color-engine.ts (pure + tested); this file is UI only.

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils";
import {
  allPalettes, currentPaletteId, setPalette, getMode,
  readCustom, clearCustom, setToken, mergeCustom, readChatBg, writeChatBg,
  getShape, setShape, youtubeId, type Palette, type ThemeMode, type ShapeMode,
} from "../lib/theme-store";
import {
  generateVariant, wcagAA, saveUserTheme, deleteUserTheme,
  slugifyThemeName, CONTRACT_TOKENS, type UserTheme,
} from "../lib/color-engine";
import { FontPicker } from "./font-picker";
import { BrandPicker } from "./brand-picker";
import { useTheme } from "./theme-toggle";

const SWATCH_TOKENS = ["--color-void", "--color-midnight", "--color-depth", "--color-surface", "--color-cyanx", "--color-violetx"];
const EDIT_TOKENS = [
  "--color-void", "--color-midnight", "--color-depth", "--color-surface",
  "--color-brandtext", "--color-muted", "--color-cyanx", "--color-violetx",
  "--color-fuchsiax", "--color-redx", "--color-emerald", "--color-amber",
];
/** Human labels — the token names are internal plumbing, the owner reads these. */
const TOKEN_LABEL: Record<string, string> = {
  "--color-void": "Page background",
  "--color-midnight": "Card surface",
  "--color-depth": "Raised surface",
  "--color-surface": "Borders & dividers",
  "--color-brandtext": "Primary text",
  "--color-muted": "Muted text",
  "--color-cyanx": "Accent (primary)",
  "--color-violetx": "Accent (secondary)",
  "--color-fuchsiax": "Highlight",
  "--color-redx": "Error / danger",
  "--color-emerald": "Success",
  "--color-amber": "Warning",
};

// `onUpload` is retained for API compatibility but intentionally unused: uploads now
// go straight to POST /api/theme/bg so the result is a real, cross-device URL. See
// upload() below for why the previous indirection produced phone-only backgrounds.
export function ThemePanel({ onUpload: _legacyOnUpload }: { onUpload?: (file: File) => Promise<string> }) {
  const [active, setActive] = useState(currentPaletteId());
  const [mode, setMode] = useState<ThemeMode>(getMode());
  const [customTick, setCustomTick] = useState(0);
  const [bg, setBg] = useState(readChatBg());
  const [bgUrl, setBgUrl] = useState("");
  const [busyUp, setBusyUp] = useState(false);
  const [bgWarn, setBgWarn] = useState<string | null>(null);
  const [shape, setShapeState] = useState<ShapeMode | undefined>(getShape);
  const [themeListTick, setThemeListTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // menus
  const [pickerOpen, setPickerOpen] = useState(false);
  const [coloursOpen, setColoursOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // builder draft
  const [bName, setBName] = useState("");
  const [bPrimary, setBPrimary] = useState("#2bc8f3");
  const [bSecondary, setBSecondary] = useState("#49cc95");

  const [theme, toggleTheme] = useTheme();
  const isLight = theme === "light";

  useEffect(() => {
    const onMode = () => setMode(getMode());
    window.addEventListener("astra-theme-change", onMode);
    // A theme arriving from another device must appear in the picker without a reload.
    const onThemes = () => setThemeListTick((t) => t + 1);
    window.addEventListener("astra-user-themes-change", onThemes);
    // A shape set on ANOTHER device lands via the sync layer; the panel must
    // follow it or the radio group shows a selection the app is not using.
    const onShape = () => setShapeState(getShape());
    window.addEventListener("astra-shape-change", onShape);
    return () => {
      window.removeEventListener("astra-theme-change", onMode);
      window.removeEventListener("astra-user-themes-change", onThemes);
      window.removeEventListener("astra-shape-change", onShape);
    };
  }, []);

  // click-outside for the dropdown
  useEffect(() => {
    if (!pickerOpen) return;
    const h = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [pickerOpen]);

  // allPalettes() is a function (it merges shipped + user themes), so memoise on the tick.
  const all = useMemo(() => allPalettes(), [themeListTick, customTick]);
  const shown: Palette = useMemo(() => mergeCustom(all.find((x) => x.id === active) || all[0]), [all, active, customTick]);
  const activeEntry = all.find((x) => x.id === active) || all[0];

  // builder output — regenerated live as the accents change
  const draft = useMemo(
    () => ({ dark: generateVariant(bPrimary, bSecondary, "dark"), light: generateVariant(bPrimary, bSecondary, "light") }),
    [bPrimary, bSecondary]
  );

  const applyBg = (next: typeof bg) => { writeChatBg(next); setBg(next); };

  const upload = async (f: File) => {
    setBusyUp(true);
    try {
      // Upload to the SERVER so the file is a real URL every device can fetch.
      //
      // WHY THIS MATTERS (owner bug 2026-10-04): a background set on the phone was
      // invisible on the iPad. The stored src was a `blob:` URL —
      // `blob:https://astra.jitinnair.com/<uuid>` — which is a handle into ONE browser
      // tab's memory. It renders on the tab that made it and is unresolvable anywhere
      // else, so every other device and the sync layer received a dead string. The
      // cause was that no `onUpload` was ever handed to this panel, so the local
      // object-URL fallback below was taken and that session-local URL was synced
      // server-side as if it were durable.
      //
      // The fallback still exists for offline use, but a blob is now only allowed
      // when the upload genuinely failed — never silently persisted.
      const res = await fetch("/api/theme/bg", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": f.type || "application/octet-stream", "x-file-name": encodeURIComponent(f.name) },
        body: f,
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data && typeof data.url === "string") {
          applyBg({ kind: f.type.startsWith("video") ? "video" : "image", src: data.url });
          return;
        }
      }
      // Upload failed (offline / auth). Keep it local so the CURRENT device still
      // shows something — and warn, because this will not follow the owner anywhere.
      applyBg({ kind: f.type.startsWith("video") ? "video" : "image", src: URL.createObjectURL(f) });
      setBgWarn("Saved on this device only — the upload didn't reach the server, so it won't appear on your other devices.");
    } catch {
      applyBg({ kind: f.type.startsWith("video") ? "video" : "image", src: URL.createObjectURL(f) });
      setBgWarn("Saved on this device only — you're offline, so this won't appear on your other devices.");
    } finally { setBusyUp(false); }
  };

  const bgPreview = bg ? (bg.kind === "youtube" ? `YouTube · ${youtubeId(bg.src)}` : bg.src.split("/").pop()) : "none";

  const saveBuiltTheme = () => {
    const name = bName.trim() || "Untitled theme";
    const id = slugifyThemeName(name);
    const t: UserTheme = {
      id, name, source: "user", license: "—", createdAt: Date.now(),
      // BOTH modes are mandatory — the generator always produces both, so there
      // is no dark-only or light-only path at all (owner's rule).
      variants: {
        dark: { ...draft.dark.tokens },
        light: { ...draft.light.tokens },
      },
    };
    saveUserTheme(t);
    setThemeListTick((x) => x + 1);
    setPalette(id);
    setActive(id);
    setBName("");
    setBuilderOpen(false);
  };

  return (
    <section data-theme-engine-new className="tf-panel">
      {/* ---------- theme selector (dropdown) ---------- */}
      <div className="tf-section">
        <div className="tf-section-head">
          <span className="tf-section-title">Theme</span>
          <span className="tf-sub">{all.length} available · each with dark + light</span>
        </div>
        <div ref={pickerRef} className="tf-picker">
          <button type="button" className="tf-picker-btn" onClick={() => setPickerOpen((o) => !o)}
            aria-haspopup="listbox" aria-expanded={pickerOpen}>
            <span className="tf-swatches">
              {SWATCH_TOKENS.map((t) => (
                <i key={t} style={{ background: shown.variants[mode][t] || "#000" }} />
              ))}
            </span>
            <span className="tf-picker-name">
              {activeEntry?.name}
              {activeEntry?.source === "user" && <em className="tf-picker-badge">yours</em>}
            </span>
            <span className={`tf-caret${pickerOpen ? " tf-caret-open" : ""}`} aria-hidden="true" />
          </button>

          {pickerOpen && (
            <div className="tf-picker-menu" role="listbox">
              {all.map((p) => {
                const v = mergeCustom(p).variants;
                const isActive = p.id === active;
                return (
                  <button key={p.id} type="button" role="option" aria-selected={isActive}
                    className={cn("tf-picker-item", isActive && "tf-picker-item-on")}
                    onClick={() => { setPalette(p.id); setActive(p.id); setPickerOpen(false); }}>
                    {/* both modes side by side, so the entry is judged on the pair */}
                    <span className="tf-pair">
                      <span className="tf-swatches tf-swatches-sm">
                        {SWATCH_TOKENS.map((t) => <i key={`d${t}`} style={{ background: v.dark[t] || "#000" }} />)}
                      </span>
                      <span className="tf-swatches tf-swatches-sm">
                        {SWATCH_TOKENS.map((t) => <i key={`l${t}`} style={{ background: v.light[t] || "#fff" }} />)}
                      </span>
                    </span>
                    <span className="tf-picker-item-name">
                      {p.name}
                      {p.source === "user" && <em className="tf-picker-badge">yours</em>}
                    </span>
                    {p.source === "user" && (
                      <span className="tf-picker-del" role="button" tabIndex={0}
                        title={`Delete ${p.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!window.confirm(`Delete theme "${p.name}"? It will disappear from all your devices.`)) return;
                          const left = deleteUserTheme(p.id);
                          setThemeListTick((x) => x + 1);
                          if (p.id === active) { const fallback = all.find((x) => x.id !== p.id) || all[0]; setPalette(fallback.id); setActive(fallback.id); }
                          void left;
                        }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
                      >×</span>
                    )}
                  </button>
                );
              })}
              <div className="tf-picker-foot">
                <button type="button" className="tf-mini" onClick={() => { setBuilderOpen((o) => !o); setPickerOpen(false); }}>
                  {builderOpen ? "Close builder" : "+ Build a theme"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------- theme builder ---------- */}
      {builderOpen && (
        <div className="tf-edit" data-testid="tf-builder">
          <div className="tf-edit-head">
            <span className="tf-edit-title">Theme builder</span>
            <span className="tf-sub">define dark + light — both are always generated</span>
          </div>

          <div className="tf-builder-inputs">
            <label className="tf-bfield">
              <span>Name</span>
              <input className="tf-input" value={bName} placeholder="My theme"
                onChange={(e) => setBName(e.target.value)} />
            </label>
            <label className="tf-bfield">
              <span>Primary accent</span>
              <span className="tf-bcolor">
                <input type="color" value={bPrimary} onChange={(e) => setBPrimary(e.target.value)} />
                <code>{bPrimary}</code>
              </span>
            </label>
            <label className="tf-bfield">
              <span>Secondary accent</span>
              <span className="tf-bcolor">
                <input type="color" value={bSecondary} onChange={(e) => setBSecondary(e.target.value)} />
                <code>{bSecondary}</code>
              </span>
            </label>
          </div>

          {/* live preview + contrast verdict for BOTH modes */}
          <div className="tf-builder-out">
            {(["dark", "light"] as const).map((m) => {
              const g = draft[m];
              return (
                <div key={m} className={cn("tf-bpreview", m === "light" && "tf-bpreview-light")}>
                  <div className="tf-bpreview-head">
                    <span className="tf-bpreview-title">{m}</span>
                    <span className={cn("tf-verdict", g.failing.length === 0 ? "tf-verdict-ok" : "tf-verdict-bad")}>
                      {g.failing.length === 0 ? "AA pass" : `${g.failing.length} fail`}
                    </span>
                  </div>
                  <div className="tf-bswatches">
                    {CONTRACT_TOKENS.map((t) => (
                      <span key={t} className="tf-bswatch" title={`${TOKEN_LABEL[t] || t} — ${g.tokens[t]}`}>
                        <i style={{ background: g.tokens[t] }} />
                        <em>{(TOKEN_LABEL[t] || t).split(" ")[0]}</em>
                      </span>
                    ))}
                  </div>
                  {/* the actual contrast measurement, per text role */}
                  <div className="tf-bratios">
                    {(["--color-brandtext", "--color-muted"] as const).map((role) => {
                      const v = wcagAA(g.tokens[role], g.tokens["--color-midnight"]);
                      return (
                        <span key={role} className={cn("tf-ratio", v.pass ? "tf-ratio-ok" : "tf-ratio-bad")}>
                          {(TOKEN_LABEL[role] || role).split(" ")[0]} {v.ratio?.toFixed(2) ?? "—"}:1
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="tf-note">
            Give a primary and a secondary; every other colour is derived and measured.
            A theme always has both a dark and a light variant — that is a requirement, not a default.
            Saving makes it available on all your devices and the app.
          </p>
          <div className="tf-bg-row">
            <button type="button" className="tf-mini tf-mini-primary" onClick={saveBuiltTheme}>
              Save theme
            </button>
            <button type="button" className="tf-mini" onClick={() => setBuilderOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ---------- dark / light ---------- */}
      <div className="tf-section">
        <div className="tf-section-head">
          <span className="tf-section-title">Mode</span>
          <span className="tf-sub">also on the sidebar</span>
        </div>
        <div className="tf-modes" role="radiogroup" aria-label="Colour mode">
          <button type="button" role="radio" aria-checked={!isLight}
            className={cn("tf-mode", !isLight && "tf-mode-on")}
            onClick={() => { if (isLight) toggleTheme(null); }}>Dark</button>
          <button type="button" role="radio" aria-checked={isLight}
            className={cn("tf-mode", isLight && "tf-mode-on")}
            onClick={() => { if (!isLight) toggleTheme(null); }}>Light</button>
        </div>
      </div>

      {/* ---------- shape ---------- */}
      <div className="tf-section">
        <div className="tf-section-head">
          <span className="tf-section-title">Corner style</span>
          <span className="tf-sub">applies to every button, card and input</span>
        </div>
        <div className="tf-modes" role="radiogroup" aria-label="Corner style">
          {(["sharp", "rounded", "circle"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={shape === m}
              className={cn("tf-mode", shape === m && "tf-mode-on")}
              onClick={() => { setShape(m); setShapeState(m); }}>
              <i className={cn("tf-shape-dot", `tf-shape-${m}`)} aria-hidden="true" />
              {m === "circle" ? "Pill" : m[0]!.toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ---------- typography ---------- */}
      <FontPicker />

      {/* ---------- brand ---------- */}
      <BrandPicker />

      {/* ---------- colours, moved into their own menu ---------- */}
      <div className="tf-section">
        <button type="button" className="tf-disclosure" aria-expanded={coloursOpen}
          onClick={() => setColoursOpen((o) => !o)}>
          <span className="tf-section-title">Customise colours</span>
          <span className="tf-sub">{coloursOpen ? "hide" : `${EDIT_TOKENS.length} tokens · ${mode}`}</span>
          <span className={cn("tf-caret", coloursOpen && "tf-caret-open")} aria-hidden="true" />
        </button>

        {coloursOpen && (
          <div className="tf-edit" data-testid="tf-colours">
            <div className="tf-edit-head">
              <span className="tf-edit-title">Tokens — {shown.name} ({mode})</span>
              {readCustom()[active] && (
                <button type="button" className="tf-mini" onClick={() => { clearCustom(active); setCustomTick((t) => t + 1); }}>Reset edits</button>
              )}
            </div>
            <div className="tf-tokens">
              {EDIT_TOKENS.map((t) => {
                const hex = shown.variants[mode][t] || "#000000";
                // live AA badge against the card surface, so an edit can't quietly
                // produce an unreadable role
                const isText = t === "--color-brandtext" || t === "--color-muted";
                const card = shown.variants[mode]["--color-midnight"];
                const v = isText ? wcagAA(hex, card) : null;
                return (
                  <label key={t} className="tf-token">
                    <input type="color" value={hex}
                      onChange={(e) => { setToken(active, mode, t, e.target.value); setCustomTick((x) => x + 1); }} />
                    <span className="tf-token-name">{TOKEN_LABEL[t] || t.replace("--color-", "")}</span>
                    <code className="tf-token-hex">{hex}</code>
                    {v && (
                      <span className={cn("tf-ratio", v.pass ? "tf-ratio-ok" : "tf-ratio-bad")}>
                        {v.ratio?.toFixed(1)}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            <p className="tf-note">
              Edits sync to all your devices and apply live. The number is the measured contrast
              against the card surface — text must stay at 4.5 or above.
            </p>
          </div>
        )}
      </div>

      {/* ---------- chat backdrop ---------- */}
      <div className="tf-bg">
        <div className="tf-edit-head">
          <span className="tf-edit-title">Chat background</span>
          <span className="tf-sub">now: {bgPreview}</span>
        </div>
        <div className="tf-bg-row">
          <input className="tf-input" placeholder="Image / video URL, or YouTube link"
            value={bgUrl} onChange={(e) => setBgUrl(e.target.value)} />
          <button type="button" className="tf-mini" onClick={() => {
            const u = bgUrl.trim(); if (!u) return;
            applyBg(youtubeId(u) ? { kind: "youtube", src: u } : { kind: /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u) ? "video" : "image", src: u });
            setBgUrl("");
          }}>Apply</button>
          <button type="button" className="tf-mini" disabled={busyUp} onClick={() => fileRef.current?.click()}>
            {busyUp ? "Uploading…" : "Upload"}
          </button>
          <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          {bg && <button type="button" className="tf-mini" onClick={() => applyBg(null)}>Off</button>}
        </div>
        {bg && (
          <>
            <label className="tf-dim">dim
              <input type="range" min={0} max={0.9} step={0.05} value={bg.dim ?? 0.45}
                onChange={(e) => applyBg({ ...bg, dim: Number(e.target.value) })} />
            </label>
            <label className="tf-dim">blur
              <input type="range" min={0} max={40} step={1} value={bg.blur ?? 0}
                onChange={(e) => applyBg({ ...bg, blur: Number(e.target.value) })} />
            </label>
          </>
        )}
        <p className="tf-note">
          Your background choice is stored on the server and follows you to every device and the app,
          updating live. YouTube plays muted and loops without the black gap.
        </p>
        {bgWarn && (
          <p className="tf-warn" role="status">{bgWarn}</p>
        )}
        {/* A blob: src is a per-tab handle. Surface it rather than let it look like a
            normal background that mysteriously fails to appear elsewhere. */}
        {bg && /^blob:/i.test(bg.src) && !bgWarn && (
          <p className="tf-warn" role="status">
            This background is stored on this device only (a temporary local file). Re-upload it
            to make it appear on your iPad and other devices.
          </p>
        )}
      </div>
    </section>
  );
}
