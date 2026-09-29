// Chat-bubble media: Vidstack player for video bubbles (native-first with
// automatic transcode fallback), MediaCard with friendly error states.
import { lazy, useEffect, useState } from "react";
import { MediaPlayer, MediaProvider } from "@vidstack/react";
import { DefaultVideoLayout, defaultLayoutIcons } from "@vidstack/react/player/layouts/default";
import { FileText, TriangleAlert } from "lucide-react";
import { downloadUrl, ext, streamUrl } from "@/lib/media-paths";
import { getLocalMediaUrl } from "@/lib/media-local-cache";
import { getFileKind } from "@/lib/session-files";
import { previewKind } from "@/lib/doc-preview-kind";
import { viewUrl, type MediaView } from "./media-viewer";
import { AudioPlayer } from "./audio-player";

// Videos native-first; on decode failure/413 re-points the same player at the
// server transcode. playsInline everywhere (iOS wrap).
function vidstackType(name: string): "video/mp4" | "video/webm" | "video/ogg" | "video/3gp" | "video/mpeg" | undefined {
  const e = ext(name);
  if (["mp4", "m4v", "mov"].includes(e)) return "video/mp4";
  if (e === "webm") return "video/webm";
  if (e === "ogg" || e === "ogv") return "video/ogg";
  if (e === "3gp") return "video/3gp";
  if (e === "mpg" || e === "mpeg") return "video/mpeg";
  return undefined; // mkv/avi/ts… — let the browser sniff
}

function BubbleVideoPlayer({ path, name }: { path: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const type = vidstackType(name);
  const remote = streamUrl(path);

  useEffect(() => {
    let active = true;
    let made: string | null = null;
    getLocalMediaUrl(path, name, "stream").then((u) => {
      if (!active) { if (u) URL.revokeObjectURL(u); return; }
      made = u;
      setLocalUrl(u);
    });
    return () => { active = false; if (made) URL.revokeObjectURL(made); };
  }, [path, name]);

  const src = localUrl
    ? type ? { src: localUrl, type } : localUrl // local blob: typed when known, else sniff
    : remote ? (type ? { src: remote, type } : remote) : remote;

  if (failed) {
    return (
      <a href={downloadUrl(path)} target="_blank" rel="noreferrer"
        className="flex max-w-[280px] items-center gap-3 rounded-[var(--radius-inner)] border border-white/10 bg-[var(--surface-raised)] p-3 text-xs text-slate-300 transition hover:bg-[var(--surface-step-2)]">
        <TriangleAlert className="h-4 w-4 shrink-0 text-amber-400" />
        <span className="min-w-0 flex-1">Can't play <span className="font-medium">{name}</span> here — tap to download.</span>
      </a>
    );
  }

  return (
    <MediaPlayer
      className="w-[280px] overflow-hidden rounded-[var(--radius-inner)] border border-white/10"
      src={src}
      playsInline
      load="visible"
      streamType="on-demand"
      viewType="video"
      onError={() => {
        if (localUrl) setLocalUrl(null); // local blob failed → fall back to remote stream
        else setFailed(true); // remote failed → friendly download card
      }}
    >
      <MediaProvider />
      <DefaultVideoLayout icons={defaultLayoutIcons} />
    </MediaPlayer>
  );
}

function PdfCard({ path, name }: { path: string; name: string }) {
  const [expanded, setExpanded] = useState(false);
  const enc = encodeURIComponent(path);
  return (
    <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius-inner)] border border-white/10 bg-[var(--surface-raised)] text-sm">
      <div className="flex items-center justify-between p-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-md bg-white/5 p-2 text-slate-300"><FileText className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-slate-200">{name}</div>
            <div className="font-mono text-xs text-slate-400">PDF Document</div>
          </div>
        </div>
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
          className="shrink-0 rounded-[var(--radius-pill)] bg-[var(--surface-step-2)] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10">
          {expanded ? "Collapse" : "View"}
        </button>
      </div>
      {expanded && (
        <LazyDocPreview url={`/api/hx/files/download?path=${enc}`} name={name} path={path} />
      )}
    </div>
  );
}

// Inline in-bubble preview for any previewable document (pdf/docx/xlsx/pptx/text).
// Lazy: DocPreview itself is lazy per-engine, this wrapper lazy-loads the module
// so chat-only users never download viewer code at all.
const LazyDocPreview = lazy(() => import("./doc-preview").then((m) => ({ default: m.DocPreview })));

function DocCard({ path, name }: { path: string; name: string }) {
  const [expanded, setExpanded] = useState(false);
  const enc = encodeURIComponent(path);
  const previewable = previewKind(name) !== "unsupported";
  const label = previewKind(name).toUpperCase();
  return (
    <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius-inner)] border border-white/10 bg-[var(--surface-raised)] text-sm">
      <div className="flex items-center justify-between p-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-md bg-white/5 p-2 text-slate-300"><FileText className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-slate-200">{name}</div>
            <div className="font-mono text-xs text-slate-400">{label} Document</div>
          </div>
        </div>
        {previewable && (
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
            className="shrink-0 rounded-[var(--radius-pill)] bg-[var(--surface-step-2)] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10">
            {expanded ? "Collapse" : "View"}
          </button>
        )}
      </div>
      {expanded && previewable && (
        <LazyDocPreview url={`/api/hx/files/download?path=${enc}`} name={name} path={path} />
      )}
      {!expanded && <DownloadRow path={path} name={name} />}
    </div>
  );
}

function LocalImage({ path, name, onBroken }: { path: string; name: string; onBroken: () => void }) {
  const [src, setSrc] = useState(viewUrl(path, name));
  useEffect(() => {
    let active = true;
    let made: string | null = null;
    getLocalMediaUrl(path, name, "view").then((u) => {
      if (!active) { if (u) URL.revokeObjectURL(u); return; }
      made = u;
      if (u) setSrc(u);
    });
    return () => { active = false; if (made) URL.revokeObjectURL(made); };
  }, [path, name]);
  return <img src={src} alt={name} loading="lazy" onError={onBroken}
    className="max-h-44 max-w-[240px] object-cover" />;
}

function DownloadRow({ path, name }: { path: string; name: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1">
      <span className="truncate text-[10px] text-slate-500">{name}</span>
      <a href={downloadUrl(path)} target="_blank" rel="noreferrer"
        className="shrink-0 font-mono text-[10px] text-cyanx hover:underline">download</a>
    </div>
  );
}

export function MediaCard({ path, name, onOpenMedia }: { path: string; name: string; onOpenMedia?: (v: MediaView) => void }) {
  const kind = getFileKind(name);
  const [imgBroken, setImgBroken] = useState(false);

  if (kind === "pdf") return <PdfCard path={path} name={name} />;
  if (kind === "doc") return <DocCard path={path} name={name} />;
  if (kind === "audio") return <AudioPlayer src={streamUrl(path)} name={name} />;

  if (kind === "video") {
    return (
      <div data-media-card className="overflow-hidden rounded-[var(--radius-inner)] border border-white/10 bg-[var(--surface-raised)] text-xs text-slate-300">
        <button type="button" title="Open full video" className="block cursor-pointer"
          onClick={(e) => { e.preventDefault(); onOpenMedia?.({ url: streamUrl(path), name }); }}>
          <BubbleVideoPlayer path={path} name={name} />
        </button>
        <DownloadRow path={path} name={name} />
      </div>
    );
  }

  if (kind === "image") {
    if (imgBroken) {
      return (
        <div data-media-card className="overflow-hidden rounded-[var(--radius-inner)] border border-white/10 bg-[var(--surface-raised)] text-xs text-slate-300">
          <a href={downloadUrl(path)} target="_blank" rel="noreferrer" className="flex items-center gap-3 p-3">
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-400" />
            <span className="min-w-0 flex-1 truncate">Preview unavailable — tap to download {name}</span>
          </a>
        </div>
      );
    }
    return (
      <div data-media-card className="overflow-hidden rounded-[var(--radius-inner)] border border-white/10 bg-[var(--surface-raised)] text-xs text-slate-300">
        <button type="button" onClick={(e) => { e.preventDefault(); onOpenMedia?.({ url: downloadUrl(path), name }); }}
          title="Open full image" className="block cursor-zoom-in">
          <LocalImage path={path} name={name} onBroken={() => setImgBroken(true)} />
        </button>
        <DownloadRow path={path} name={name} />
      </div>
    );
  }

  // doc / other
  return (
    <a href={downloadUrl(path)} target="_blank" rel="noreferrer"
      className="flex items-center gap-3 rounded-[var(--radius-inner)] border border-white/10 bg-[var(--surface-raised)] p-3 text-xs text-slate-300 transition hover:bg-[var(--surface-step-2)]" title="Download">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-black/20 text-slate-400">
        <FileText className="h-3 w-3" />
      </div>
      <span className="truncate">{name}</span>
    </a>
  );
}
