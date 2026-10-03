// canvas-reactive.tsx — renderers for the v5 reactive + media blocks.
//
// LAZY chunk (like canvas-chart.tsx): an ordinary chat that never carries a
// slider/select/gallery pays zero bytes for this module. Reader blocks stay in
// canvas-blocks.tsx but resolve their reactive props through canvas-bind.ts
// (pure, node-safe).
//
// Store contract: CanvasStateProvider wraps the card body in canvas-view.tsx;
// these components read/write through the hooks and NEVER touch window globals.
//
// Writes are cheap but not free on a low-spec phone (typing-lag audit): every
// control routes user edits through a shared rAF-batched commit, so a slider
// drag paints at most once per frame.
import { useEffect, useMemo, useRef, useState } from "react";
import { useCanvasValue, useCanvasSet, type StateValue } from "./canvas-state";
import { evaluate, toNum, compact } from "../../lib/canvas-expr";
import type { SliderBlock, SelectBlock, MultiSelectBlock, SegmentedBlock, ToggleBlock, SearchBlock, ImageBlock, GalleryBlock, VideoBlock, CanvasBlock } from "../../lib/canvas-schema";
import { cn } from "../../lib/utils";
import { downloadUrl, videoSrc, needsTranscode, transcodeUrl } from "../../lib/media-paths";

// ── shared helpers ───────────────────────────────────────────────────────────

/** Coerce whatever the state holds into a number for range widgets. */
function stateNum(v: unknown, fb: number): number {
  const n = typeof v === "number" ? v : toNum(String(v ?? ""));
  return Number.isFinite(n) ? n : fb;
}

function fmtSliderValue(v: number, b: SliderBlock): string {
  const unit = b.unit ?? "";
  switch (b.format) {
    case "money": return evaluate(`money(${v})`, {}).ok ? (evaluate(`money(${v})`, {}) as { value: unknown }).value as string : `${Math.round(v)}`;
    case "compact": return compact(v) + unit;
    case "pct": return `${Math.round(v * 100) / 100}${unit || "%"}`;
    default: return (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)) + unit;
  }
}

// ── slider ───────────────────────────────────────────────────────────────────

export function SliderView({ block }: { block: SliderBlock }) {
  const set = useCanvasSet();
  const raw = useCanvasValue<unknown>(block.bind, block.value ?? block.min);
  const [pending, setPending] = useState<number | null>(null);
  const raf = useRef(0);

  const current = pending ?? stateNum(raw, block.value ?? block.min);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const commit = (v: number) => {
    setPending(v);
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => { set(block.bind, v); setPending(null); });
  };

  const out = fmtSliderValue(current, block);
  return (
    <div className="ast-cv-ctl ast-cv-slider" role="group" aria-label={block.label}>
      <div className="ast-cv-slider-head">
        <label className="ast-cv-slider-label" htmlFor={`cv-sl-${block.bind}`}>{block.label}</label>
        <span className="ast-cv-slider-val" aria-live="polite">{out}</span>
      </div>
      <input
        id={`cv-sl-${block.bind}`}
        className="ast-cv-slider-input"
        type="range"
        min={block.min}
        max={block.max}
        step={block.step}
        value={current}
        onChange={(e) => commit(Number(e.target.value))}
      />
    </div>
  );
}

// ── select (native, styled) ──────────────────────────────────────────────────

export function SelectView({ block }: { block: SelectBlock }) {
  const raw = useCanvasValue<unknown>(block.bind, block.value ?? block.options[0]?.value ?? "");
  const set = useCanvasSet();
  const value = typeof raw === "string" ? raw : String(block.value ?? block.options[0]?.value ?? "");
  return (
    <div className="ast-cv-ctl ast-cv-select" role="group" aria-label={block.label}>
      <label className="ast-cv-slider-label" htmlFor={`cv-se-${block.bind}`}>{block.label}</label>
      <select
        id={`cv-se-${block.bind}`}
        className="ast-cv-select-input"
        value={value}
        onChange={(e) => set(block.bind, e.target.value)}
      >
        {block.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ── multiselect chips ────────────────────────────────────────────────────────

export function MultiSelectView({ block }: { block: MultiSelectBlock }) {
  const raw = useCanvasValue<unknown>(block.bind, block.value ?? []);
  const set = useCanvasSet();
  const selected = useMemo(() => {
    const arr = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
    return new Set(arr);
  }, [raw]);
  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v); else next.add(v);
    set(block.bind, [...next] as unknown as StateValue);
  };
  return (
    <div className="ast-cv-ctl ast-cv-multi" role="group" aria-label={block.label}>
      <span className="ast-cv-slider-label">{block.label}</span>
      <div className="ast-cv-multi-chips">
        {block.options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="checkbox"
            aria-checked={selected.has(o.value)}
            className={cn("ast-cv-chip", selected.has(o.value) && "on")}
            onClick={() => toggle(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── segmented ────────────────────────────────────────────────────────────────

export function SegmentedView({ block }: { block: SegmentedBlock }) {
  const raw = useCanvasValue<unknown>(block.bind, block.value ?? block.options[0]?.value ?? "");
  const set = useCanvasSet();
  const value = typeof raw === "string" ? raw : String(block.value ?? block.options[0]?.value ?? "");
  return (
    <div className="ast-cv-ctl ast-cv-segmented" role="radiogroup" aria-label={block.label}>
      {block.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className={cn("ast-cv-seg", o.value === value && "on")}
          onClick={() => set(block.bind, o.value)}
          onKeyDown={(e) => {
            const i = block.options.findIndex((x) => x.value === value);
            if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); const n = block.options[(i + 1) % block.options.length]; if (n) set(block.bind, n.value); }
            if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); const n = block.options[(i - 1 + block.options.length) % block.options.length]; if (n) set(block.bind, n.value); }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── toggle ───────────────────────────────────────────────────────────────────

export function ToggleView({ block }: { block: ToggleBlock }) {
  const raw = useCanvasValue<unknown>(block.bind, block.value ?? false);
  const set = useCanvasSet();
  const on = raw === true || raw === "true";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="ast-cv-ctl ast-cv-toggle"
      onClick={() => set(block.bind, !on)}
    >
      <span className={cn("ast-cv-toggle-pill", on && "on")} aria-hidden="true">
        <span className="ast-cv-toggle-knob" />
      </span>
      <span className="ast-cv-toggle-label">{block.label}</span>
    </button>
  );
}

// ── search ───────────────────────────────────────────────────────────────────

export function SearchView({ block }: { block: SearchBlock }) {
  const raw = useCanvasValue<unknown>(block.bind, "");
  const set = useCanvasSet();
  const [val, setVal] = useState(typeof raw === "string" ? raw : "");
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const commit = (v: string) => {
    setVal(v);
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => set(block.bind, v));
  };
  return (
    <div className="ast-cv-ctl ast-cv-search" role="search">
      <input
        className="ast-cv-search-input"
        type="search"
        enterKeyHint="search"
        placeholder={block.placeholder ?? block.label ?? "Filter…"}
        aria-label={block.label ?? "Filter"}
        value={val}
        onChange={(e) => commit(e.target.value)}
      />
    </div>
  );
}

// ── media ────────────────────────────────────────────────────────────────────

function srcUrl(src: string, image: boolean): string {
  if (/^https?:\/\//i.test(src) || src.startsWith("/api/")) return src;
  const p = src.replace(/^~(?=\/)/, "");
  if (image && needsTranscode(p)) return transcodeUrl(p);
  if (image) return downloadUrl(p);
  return videoSrc({ path: p, name: p.split("/").pop() || p });
}

export function ImageView({ block }: { block: ImageBlock }) {
  const [err, setErr] = useState(false);
  const url = srcUrl(block.src, true);
  return (
    <figure className="ast-cv-image">
      {err ? (
        <div className="ast-cv-image-nil" role="img" aria-label={block.alt || "image unavailable"}>image unavailable</div>
      ) : (
        <img src={url} alt={block.alt ?? ""} loading="lazy" decoding="async" className="ast-cv-image-img" onError={() => setErr(true)} />
      )}
      {block.caption && <figcaption className="ast-cv-image-cap">{block.caption}</figcaption>}
    </figure>
  );
}

export function GalleryView({ block }: { block: GalleryBlock }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <figure className={cn("ast-cv-gallery", block.layout === "3col" && "col3")}>
      {block.items.map((it, i) => (
        <button key={i} type="button" className="ast-cv-gtile" aria-label={it.alt || `image ${i + 1}`} onClick={() => setOpen(i)}>
          <img src={srcUrl(it.src, true)} alt={it.alt ?? ""} loading="lazy" decoding="async" />
        </button>
      ))}
      {open != null && (
        <dialog className="ast-cv-gviewer" open onClick={() => setOpen(null)}>
          <img src={srcUrl(block.items[open]!.src, true)} alt={block.items[open]!.alt ?? ""} />
          {block.items[open]!.caption && <p>{block.items[open]!.caption}</p>}
        </dialog>
      )}
    </figure>
  );
}

export function VideoView({ block }: { block: VideoBlock }) {
  const [err, setErr] = useState(false);
  return (
    <figure className="ast-cv-video">
      {err ? (
        <div className="ast-cv-image-nil" role="img" aria-label="video unavailable">video unavailable</div>
      ) : (
        <video
          className="ast-cv-video-el"
          src={srcUrl(block.src, false)}
          poster={block.poster ? srcUrl(block.poster, true) : undefined}
          controls
          playsInline
          preload="metadata"
          onError={() => setErr(true)}
        >
          {block.captions && <track kind="subtitles" src={srcUrl(block.captions, false)} default />}
        </video>
      )}
      {block.caption && <figcaption className="ast-cv-image-cap">{block.caption}</figcaption>}
    </figure>
  );
}

// ── hub ──────────────────────────────────────────────────────────────────────

/** One default export: dispatch to the right renderer by block type. */
function ReactiveHub({ block }: { block: CanvasBlock }) {
  switch (block.type) {
    case "slider": return <SliderView block={block} />;
    case "select": return <SelectView block={block} />;
    case "multiselect": return <MultiSelectView block={block} />;
    case "segmented": return <SegmentedView block={block} />;
    case "toggle": return <ToggleView block={block} />;
    case "search": return <SearchView block={block} />;
    case "image": return <ImageView block={block} />;
    case "gallery": return <GalleryView block={block} />;
    case "video": return <VideoView block={block} />;
    default: return null;
  }
}

export { ReactiveHub };
export default ReactiveHub;
