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

function DocTile({ it }: { it: MediaItem }) {
  const k = mediaKind(it.name);
  if (k === "pdf" && it.path) return <PdfThumb it={it} />;
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
