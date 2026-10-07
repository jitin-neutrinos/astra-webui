// Bento media grid for chat bubbles (R3). Audio renders rows below; visual+doc
// items fill the bento; >5 collapses into layout-5 with a "+N" overflow tile.
import { useEffect, useMemo, useRef, useState } from "react";
import { TriangleAlert, Play, Maximize2, Download, FileText, Sheet, Presentation, FileArchive, File as FileIcon, Film } from "lucide-react";
import { type MediaItem, imageSrc, videoSrc, audioSrc, transcodeUrl, canTranscode, downloadUrl } from "@/lib/media-paths";
import { mediaKind, badgeLabel, needsTranscode, isVisual } from "@/lib/media-kinds";
import { bentoLayout, AREAS } from "@/lib/bento";
import { downloadFile } from "@/lib/download";
import { AudioPlayer } from "./audio-player";

// image onError transcode fallback, shared with the viewer (imageSrc consults it)
const transcodeFallback = new Set<string>();

function useInView<T extends HTMLElement>(rootMargin = "300px") {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setInView(true);
        io.disconnect();
      }
    }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);
  return [ref, inView] as const;
}

function docIcon(k: string) {
  if (k === "pdf" || k === "docx" || k === "text") return FileText;
  if (k === "xlsx") return Sheet;
  if (k === "pptx") return Presentation;
  if (k === "archive") return FileArchive;
  return FileIcon;
}

function ImageTile({ it }: { it: MediaItem }) {
  const [src, setSrc] = useState<string>(() => (it.path && transcodeFallback.has(it.path) ? transcodeUrl(it.path) : imageSrc(it)));
  const [broken, setBroken] = useState(false);
  if (broken) return <TileError />;
  return (
    <img
      src={src}
      alt={it.name}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (it.path && canTranscode(it.name) && src === imageSrc(it)) {
          transcodeFallback.add(it.path);
          setSrc(transcodeUrl(it.path));
        } else setBroken(true);
      }}
    />
  );
}

function TileError() {
  return (
    <div className="mg-err">
      <TriangleAlert style={{ width: 18, height: 18 }} />
      Preview unavailable
    </div>
  );
}

function VideoTile({ it }: { it: MediaItem }) {
  const [ref, inView] = useInView<HTMLDivElement>("300px");
  const [dur, setDur] = useState<string | null>(null);
  if (needsTranscode(it.name)) {
    // never trigger ffmpeg just for a poster
    return (
      <div ref={ref} className="relative h-full w-full">
        <Film className="h-7 w-7" style={{ color: "var(--color-muted)" }} />
        <span className="mg-play"><Play className="h-4 w-4" /></span>
      </div>
    );
  }
  if (!inView) {
    return (
      <div ref={ref} className="relative h-full w-full">
        <Film className="h-7 w-7" style={{ color: "var(--color-muted)" }} />
        <span className="mg-play"><Play className="h-4 w-4" /></span>
      </div>
    );
  }
  return (
    <div ref={ref} className="relative h-full w-full">
      <video
        src={videoSrc(it) + "#t=0.1"}
        preload="metadata"
        muted
        playsInline
        tabIndex={-1}
        aria-hidden
        style={{ pointerEvents: "none" }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDur(`${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, "0")}`);
        }}
        onError={() => { /* icon-only tile, no retry storm */ }}
      />
      <span className="mg-play"><Play className="h-4 w-4" /></span>
      {dur && <span className="mg-dur">{dur}</span>}
    </div>
  );
}

function PdfThumb({ it }: { it: MediaItem }) {
  const [ref, inView] = useInView<HTMLDivElement>("300px");
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (!inView || thumb || !it.path) return;
    let alive = true;
    void import("./doc-previews/pdf-view").then(({ pdfThumb }) =>
      pdfThumb(downloadUrl(it.path!), 320),
    )
      .then((u) => alive && setThumb(u))
      .catch(() => { /* icon tile stays */ });
    return () => { alive = false; };
  }, [inView, thumb, it.path]);
  if (thumb) return <img src={thumb} alt={it.name} loading="lazy" decoding="async" />;
  const Icon = docIcon("pdf");
  return <div ref={ref} className="h-full w-full"><Icon className="h-7 w-7" style={{ color: "var(--color-muted)" }} /></div>;
}

// ---- Text-fill preview (owner 2026-10-07: "all artifacts have full filled bleed") ----
// Previously: only pdf got a thumbnail; md/txt/json/csv (kind "text"/"xlsx") and
// office formats got an icon tile. Now every doc kind paints REAL content:
//   text kinds  → fetch the file text (cap 8 KB) and paint it in a fading mono block;
//   csv/xlsx    → fetch text, split rows, paint as a mini grid (first rows/cols);
//   docx        → unzip client-side, paint document.xml's text nodes;
//   pptx        → unzip, paint slide 1's text;
//   pdf         → page-1 thumbnail, object-fit:cover so it fills the bleed.
// A waiter (same tile, icon+flash) shows while fetching; on failure the old icon
// tile returns (fail-soft: an icon tile is always better than a broken preview).

function TextBleedPreview({ it, plainCols }: { it: MediaItem; plainCols: boolean }) {
  const [ref, inView] = useInView<HTMLDivElement>("300px");
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!inView || text || failed || !it.path) return;
    let alive = true;
    fetch(downloadUrl(it.path))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => {
        if (!alive) return;
        setText(t.slice(0, 8_192));
      })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [inView, text, failed, it.path]);
  if (failed || text == null) {
    return <div ref={ref} className="h-full w-full" />;
  }
  const rows = plainCols
    ? text.split(/\r?\n/).slice(0, 12).map((row) => row.split(/[,\t;]/).map((c) => c.trim().slice(0, 18)))
    : null;
  if (rows) {
    // mini table fill for csv/xlsx-flavoured text
    return (
      <div ref={ref} className="mg-textbleed mg-textbleed-grid" aria-hidden="true">
        {rows.map((r, ri) => (
          <div key={ri} className="mg-textbleed-row">
            {r.slice(0, 3).map((c, ci) => <span key={ci} className="mg-textbleed-cell">{c}</span>)}
          </div>
        ))}
        <span className="mg-textbleed-fade" />
      </div>
    );
  }
  return (
    <div ref={ref} className="mg-textbleed" aria-hidden="true">
      <pre>{text}</pre>
      <span className="mg-textbleed-fade" />
    </div>
  );
}

function OfficeBleedPreview({ it, want }: { it: MediaItem; want: "docx" | "pptx" | "xlsx" }) {
  const [ref, inView] = useInView<HTMLDivElement>("300px");
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!inView || text || failed || !it.path) return;
    let alive = true;
    (async () => {
      try {
        const buf = await (await fetch(downloadUrl(it.path!))).arrayBuffer();
        const { unzipSync, strFromU8 } = await import("fflate");
        const files = unzipSync(new Uint8Array(buf));
        let out = "";
        if (want === "docx") {
          const xml = strFromU8(files["word/document.xml"] ?? new Uint8Array());
          out = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(" ");
        } else if (want === "pptx") {
          const key = Object.keys(files).filter((k) => /^ppt\/slides\/slide1\.xml$/.test(k))[0];
          const xml = key ? strFromU8(files[key]) : "";
          out = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(" ");
        } else {
          // xlsx: shared strings for a lightweight values preview
          const xml = strFromU8(files["xl/sharedStrings.xml"] ?? new Uint8Array());
          out = [...xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]).join(" · ");
        }
        if (!alive) return;
        out = out.trim();
        setText(out ? out.slice(0, 2_048) : "");
        if (!out) setFailed(true);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [inView, text, failed, it.path, want]);
  if (failed || !text) return <div ref={ref} className="h-full w-full" />;
  return (
    <div ref={ref} className="mg-textbleed" aria-hidden="true">
      <pre>{text}</pre>
      <span className="mg-textbleed-fade" />
    </div>
  );
}

function DocTile({ it }: { it: MediaItem }) {
  const k = mediaKind(it.name);
  const ext = (it.name.split(".").pop() || "").toLowerCase();
  if (k === "pdf" && it.path) return <PdfThumb it={it} />;
  if ((k === "text" || ext === "md" || ext === "json" || ext === "txt" || ext === "log") && it.path)
    return <TextBleedPreview it={it} plainCols={false} />;
  if ((ext === "csv" || k === "xlsx" && (ext === "csv" || ext === "xls" || ext === "ods")) && it.path)
    return <TextBleedPreview it={it} plainCols={true} />;
  if (k === "docx" && it.path) return <OfficeBleedPreview it={it} want="docx" />;
  if (k === "pptx" && it.path) return <OfficeBleedPreview it={it} want="pptx" />;
  if (k === "xlsx" && it.path) return <OfficeBleedPreview it={it} want="xlsx" />;
  // archive / other / anything un-fetchable: keep the icon treatment
  const Icon = docIcon(k);
  return (
    <>
      <span className="mg-badge" data-k={k}>{badgeLabel(it.name)}</span>
      <Icon className="h-7 w-7" style={{ color: "var(--color-muted)" }} />
      <span className="mg-name">{it.name}{it.size != null && it.size > 0 ? ` · ${fmtSize(it.size)}` : ""}</span>
    </>
  );
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function MediaGrid({ items, onOpen, className }: {
  items: MediaItem[];
  onOpen?: (items: MediaItem[], index: number) => void;
  className?: string;
}) {
  const nonAudio = useMemo(() => items.filter((it) => mediaKind(it.name) !== "audio"), [items]);
  const audio = useMemo(() => items.filter((it) => mediaKind(it.name) === "audio"), [items]);
  const layout = bentoLayout(nonAudio.length);
  // viewer order = grid order then audio
  const viewerItems = useMemo(() => [...nonAudio, ...audio], [nonAudio, audio]);
  const docOnly = nonAudio.length > 0 && nonAudio.every((it) => !isVisual(mediaKind(it.name)));

  if (items.length === 0) return null;

  const open = (i: number) => onOpen?.(viewerItems, i);

  return (
    <div className={className}>
      {layout.cls !== "mg-0" && (
        <div className={`mg ${layout.cls}${docOnly ? " is-doc" : ""}`}>
          {nonAudio.slice(0, 5).map((it, i) => {
            const k = mediaKind(it.name);
            const isOverflowTile = layout.overflow > 0 && i === 4;
            return (
              <div key={`${it.path}-${i}`} className="mg-cell" style={{ gridArea: AREAS[i] }}>
                <button
                  type="button"
                  className="mg-tile"
                  aria-label={`Open ${it.name}`}
                  onClick={() => open(i)}
                >
                  {k === "image" ? <ImageTile it={it} />
                    : k === "video" ? <VideoTile it={it} />
                    : <DocTile it={it} />}
                  {isOverflowTile && <span className="mg-more">+{layout.overflow}</span>}
                </button>
                <div className="mg-actions">
                  {it.path != null && (
                    <button type="button" className="mg-act" aria-label={`Download ${it.name}`} title="Download"
                      onClick={() => downloadFile(it.path!, it.name)}>
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button type="button" className="mg-act" aria-label={`Expand ${it.name}`} title="Expand"
                    onClick={() => open(i)}>
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {audio.length > 0 && (
        <div className="mg-audio">
          {audio.map((it, i) => <AudioPlayer key={`${it.path}-a${i}`} src={audioSrc(it)} name={it.name} />)}
        </div>
      )}
      {(viewerItems.length >= 2) && (
        <button type="button" className="mg-viewall" onClick={() => open(0)}>
          View all ({viewerItems.length})
        </button>
      )}
    </div>
  );
}
