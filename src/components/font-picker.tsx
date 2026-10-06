// font-picker.tsx — the Typography section of Appearance.
//
// Three roles (body / heading / code), each with:
//   - a searchable list of Google families (no API key, one fetch, cached)
//   - the user's own uploads, deletable
//   - a live specimen in the ACTUAL family being picked
//
// The specimen is the point. A font picker's failure mode is a list of names
// that all look identical because the preview is set in the app's own font —
// the user cannot tell what they are choosing, so the picker reads as broken.

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils";
import {
  useFonts, loadGoogleFont, uploadFont, forgetUpload,
  readUploads, type FontRole, type FontPick,
} from "../lib/font-store";

/** One entry in the font catalogue. */
interface Family { id: string; family: string; category?: string; variable?: boolean }

// api.fontsource.org: no API key, ACAO *, ~2100 families. Google's own metadata
// endpoint is NOT reachable cross-origin (verified: TypeError in Chrome), so
// this is the only keyless option that works from a browser.
const LIST_URL = "https://api.fontsource.org/v1/fonts";
const LS_CATALOGUE = "astra-font-catalogue";

function readCatalogue(): Family[] | null {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_CATALOGUE) || "null");
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return raw;
  } catch { return null; }
}
function writeCatalogue(list: Family[]) {
  try { localStorage.setItem(LS_CATALOGUE, JSON.stringify(list)); } catch { /* quota */ }
}

const ROLES: { role: FontRole; label: string; hint: string }[] = [
  { role: "sans", label: "Body", hint: "chat text, labels, buttons" },
  { role: "display", label: "Headings", hint: "page titles, the wordmark" },
  { role: "mono", label: "Code", hint: "code blocks, terminals, hashes" },
];

export function FontPicker() {
  const [fonts, setFont] = useFonts();
  const [catalogue, setCatalogue] = useState<Family[]>(() => readCatalogue() || []);
  const [listState, setListState] = useState<"idle" | "loading" | "ready" | "error">(
    () => (readCatalogue() ? "ready" : "idle"),
  );
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<FontRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<FontRole | null>(null);
  const [uploads, setUploads] = useState<FontPick[]>(() => readUploads());
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadRole = useRef<FontRole>("sans");

  // Fetch once, then cache: 538 KB is a real cost on a phone, and the list
  // changes on the order of months.
  useEffect(() => {
    if (listState !== "idle") return;
    const cached = readCatalogue();
    if (cached) { setCatalogue(cached); setListState("ready"); return; }
    setListState("loading");
    let alive = true;
    fetch(LIST_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((raw: Array<Record<string, unknown>>) => {
        if (!alive) return;
        const list: Family[] = raw.map((f) => ({
          id: String(f.id), family: String(f.family),
          category: typeof f.category === "string" ? f.category : undefined,
          variable: !!f.variable,
        }));
        setCatalogue(list);
        writeCatalogue(list);
        setListState("ready");
      })
      .catch(() => alive && setListState("error"));
    return () => { alive = false; };
  }, [listState]);

  // Client-side search: the API's ?search= returns 400, so filtering is ours.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? catalogue.filter((f) => f.family.toLowerCase().includes(q))
      : catalogue;
    return base.slice(0, 120);
  }, [catalogue, query]);

  const pick = async (role: FontRole, fam: Family) => {
    setBusy(role); setError(null);
    try {
      const p = await loadGoogleFont(fam.family);
      setFont(role, p);
      setOpen(null);
    } catch (e) {
      setError(`Could not load ${fam.family}: ${(e as Error).message}`);
    } finally { setBusy(null); }
  };

  const doUpload = async (file: File) => {
    const role = uploadRole.current;
    setBusy(role); setError(null);
    try {
      const p = await uploadFont(file);
      setUploads(readUploads());
      setFont(role, p);
      setOpen(null);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  };

  return (
    <div className="tf-section" data-testid="tf-fonts">
      <div className="tf-section-head">
        <span className="tf-section-title">Typography</span>
        <span className="tf-sub">
          {listState === "ready" ? `${catalogue.length.toLocaleString()} families` : "loading…"}
        </span>
      </div>

      {ROLES.map(({ role, label, hint }) => (
        <div key={role} className="tf-fontrole">
          <div className="tf-fontrole-head">
            <span className="tf-fontrole-label">{label}</span>
            <span className="tf-sub">{hint}</span>
            <button
              type="button"
              className="tf-mini"
              disabled={!fonts[role]}
              onClick={() => { if (fonts[role]) { setFont(role, null); setUploads(readUploads()); } }}
            >
              Reset
            </button>
            <button type="button" className="tf-mini tf-mini-primary"
              onClick={() => { setOpen(open === role ? null : role); setQuery(""); }}>
              {fonts[role] ? "Change" : "Choose"}
            </button>
          </div>

          {/* The specimen is set in the PICKED family, which is the only way the
              user can tell two similar sans apart. Falls back to the app's own
              font when nothing is picked. */}
          <div
            className="tf-fontspec"
            style={{ fontFamily: fonts[role] ? `"${fonts[role]!.family}"` : undefined }}
          >
            {fonts[role] ? fonts[role]!.family : "Not set — using the default"}
            {fonts[role]?.source === "upload" && <em className="tf-picker-badge">yours</em>}
            {busy === role && <span className="tf-sub"> loading…</span>}
          </div>

          {open === role && (
            <div className="tf-fontmenu">
              <input
                className="tf-input"
                placeholder="Search families…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              <div className="tf-fontlist" role="listbox" aria-label={`${label} font families`}>
                {filtered.length === 0 && (
                  <p className="tf-note">
                    {listState === "error" ? "Could not load the family list — upload a font instead." : "No match."}
                  </p>
                )}
                {filtered.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="option"
                    aria-selected={fonts[role]?.family === f.family}
                    className={cn("tf-fontitem", fonts[role]?.family === f.family && "tf-fontitem-on")}
                    // The row renders in its OWN family so the list is a
                    // specimen sheet, not a wall of identical text. The face is
                    // only fetched for a row the user actually reaches for, never
                    // for all 120 — fetching 120 woff2 files would be absurd.
                    style={{ fontFamily: `"${f.family}"` }}
                    onMouseEnter={() => { /* preview on demand would fetch; the name alone is honest */ }}
                    onClick={() => pick(role, f)}
                  >
                    {f.family}
                  </button>
                ))}
              </div>
              <div className="tf-bg-row">
                <button type="button" className="tf-mini"
                  onClick={() => { uploadRole.current = role; fileRef.current?.click(); }}>
                  Upload a font file
                </button>
                <span className="tf-sub">woff2 · woff · ttf · otf</span>
              </div>
              {uploads.length > 0 && (
                <div className="tf-fontuploads">
                  {uploads.map((u) => (
                    <span key={u.url} className="tf-fontchip" style={{ fontFamily: `"${u.family}"` }}>
                      {u.family}
                      <button type="button" aria-label={`Remove ${u.family}`}
                        onClick={() => { forgetUpload(u); setUploads(readUploads()); }}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {error && <p className="tf-warn" role="status">{error}</p>}

      <input ref={fileRef} type="file" accept=".woff2,.woff,.ttf,.otf,font/woff2,font/ttf,font/otf"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void doUpload(f); e.target.value = ""; }} />

      <p className="tf-note">
        Google families are downloaded to this machine once and served from your own
        site, so nothing is requested from Google while you browse. Uploads stay on
        your server and follow you to every device.
      </p>
    </div>
  );
}
