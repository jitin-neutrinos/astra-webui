// Full-screen media viewer (yarl) — images natively, custom slides for
// video/audio/pdf/docs. Lazy chunk: mounted only when a viewer is open.
import React, { useCallback, useEffect, useRef, useState } from "react";
import Lightbox, { useLightboxState, type Slide, type GenericSlide } from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Thumbnails from "yet-another-react-lightbox/plugins/thumbnails";
import Counter from "yet-another-react-lightbox/plugins/counter";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/thumbnails.css";
import "yet-another-react-lightbox/plugins/counter.css";
import { Capacitor } from "@capacitor/core";
import { Download, ExternalLink, Copy, TriangleAlert, Loader2, FileText, Sheet, Presentation, FileArchive, File as FileIcon, Film } from "lucide-react";
import {
  type MediaItem, imageSrc, videoSrc, audioSrc, downloadUrl, transcodeUrl, canTranscode,
} from "@/lib/media-paths";
import { mediaKind, kindInfo, badgeLabel } from "@/lib/media-kinds";
import { downloadFile } from "@/lib/download";
import { toast, TOAST_EVENT } from "@/lib/toast";
import { copyText } from "@/lib/copy-text";
import { AudioPlayer } from "./audio-player";
import { DocPreview } from "./doc-preview";
import { usePrefersReducedMotion } from "./chat-timeline";
import { VBtn } from "./viewer-btn";
import PdfView from "./doc-previews/pdf-view";

declare module "yet-another-react-lightbox" {
  interface SlideAstra extends GenericSlide { type: "astra"; item: MediaItem }
  interface SlideTypes { astra: SlideAstra }
}

// ── viewer-visible toast (yarl inerts page siblings → page ToastHost is hidden to AT) ──
function ViewerToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      setMsg(String((e as CustomEvent).detail ?? ""));
      window.setTimeout(() => setMsg(null), 2400);
    };
    window.addEventListener(TOAST_EVENT, on);
    return () => window.removeEventListener(TOAST_EVENT, on);
  }, []);
  if (!msg) return null;
  return <div className="astra-toast" role="status" aria-live="polite">{msg}</div>;
}

// ── toolbar buttons (yarl IconButton; current item via useLightboxState) ──
function DownloadBtn({ items }: { items: MediaItem[] }) {
  const { currentIndex } = useLightboxState();
  const it = items[currentIndex];
  if (!it) return null;
  if (it.path == null && it.url) {
    return <VBtn label="Open image" onClick={() => window.open(it.url!, "_blank", "noopener")}><ExternalLink /></VBtn>;
  }
  return (
    <VBtn label={`Download ${it.name}`} onClick={() => downloadFile(it.path!, it.name)}>
      <Download />
    </VBtn>
  );
}

function OpenBtn({ items }: { items: MediaItem[] }) {
  const { currentIndex } = useLightboxState();
  const it = items[currentIndex];
  if (!it || it.path == null) return null;
  const kind = mediaKind(it.name);
  const open = async () => {
    try {
      if (kind === "video") { window.open(videoSrc(it), "_blank", "noopener"); return; }
      if (kind === "audio") { window.open(audioSrc(it), "_blank", "noopener"); return; }
      if (kind === "image" && kindInfo(it.name).transcodable) { window.open(transcodeUrl(it.path!), "_blank", "noopener"); return; }
      // docs: open the bytes as a blob VIEW (downloads still go through the anchor path, R6)
      const w = window.open("about:blank"); // synchronous → beats popup blockers
      if (!w) return;
      const res = await fetch(downloadUrl(it.path!), { credentials: "same-origin" });
      const buf = await res.arrayBuffer();
      const ext = (it.name.split(".").pop() || "bin").toLowerCase();
      const mimes: Record<string, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", txt: "text/plain", md: "text/plain" };
      const u = URL.createObjectURL(new Blob([buf], { type: mimes[ext] ?? "application/octet-stream" }));
      w.location.href = u;
      window.setTimeout(() => URL.revokeObjectURL(u), 60000);
    } catch {
      toast("Couldn't open file");
    }
  };
  return <VBtn label="Open in new tab" onClick={open}><ExternalLink /></VBtn>;
}

function CopyBtn({ items }: { items: MediaItem[] }) {
  const { currentIndex } = useLightboxState();
  const it = items[currentIndex];
  if (!it || it.path == null) return null;
  return (
    <VBtn
      label="Copy path"
      onClick={() => { void copyText(it.path!).then((ok) => ok && toast("Path copied")); }}
    >
      <Copy />
    </VBtn>
  );
}

// ── per-kind renderers ──
function SlideError({ item, onRetry }: { item: MediaItem; onRetry?: () => void }) {
  return (
    <div className="mv-card">
      <TriangleAlert className="h-8 w-8" style={{ color: "var(--color-muted)" }} />
      <div className="text-sm font-medium">Couldn't open {item.name}</div>
      {item.path != null && (
        <div className="flex gap-2">
          <button type="button" className="mv-btn" onClick={() => downloadFile(item.path!, item.name)}>Download</button>
          {onRetry && canTranscode(item.name) && (
            <button type="button" className="mv-btn" onClick={onRetry}>Try converting</button>
          )}
        </div>
      )}
    </div>
  );
}

function SlidePlaceholder({ item }: { item: MediaItem }) {
  const k = mediaKind(item.name);
  const Icon = k === "pdf" || k === "docx" || k === "text" ? FileText : k === "xlsx" ? Sheet : k === "pptx" ? Presentation : k === "archive" ? FileArchive : FileIcon;
  return (
    <div className="mv-card" aria-hidden>
      <Icon className="h-8 w-8" style={{ color: "var(--color-muted)" }} />
      <div className="text-sm truncate" style={{ maxWidth: 280 }}>{item.name}</div>
    </div>
  );
}

function VideoSlide({ item, onFail }: { item: MediaItem; onFail: () => void }) {
  const [src, setSrc] = useState<string>(() => videoSrc(item));
  const [converting, setConverting] = useState(false);
  const failedRef = useRef(false);
  const k = mediaKind(item.name);
  useEffect(() => { setSrc(videoSrc(item)); setConverting(false); failedRef.current = false; }, [item.path]);
  if (k === "audio") {
    return (
      <div className="mv-slide">
        <AudioPlayer src={audioSrc(item)} name={item.name} />
      </div>
    );
  }
  const onError = () => {
    if (failedRef.current) { onFail(); return; }
    if (canTranscode(item.name) && item.path != null && src !== transcodeUrl(item.path)) {
      failedRef.current = true;
      setSrc(transcodeUrl(item.path));
      setConverting(true); // transcode responds only after ffmpeg finishes
      return;
    }
    failedRef.current = true;
    onFail();
  };
  return (
    <div className="mv-slide">
      <div className="relative">
        <video
          className="mv-video"
          src={src}
          controls
          autoPlay
          playsInline
          preload="metadata"
          onError={onError}
          onLoadedData={() => setConverting(false)}
        />
        {converting && (
          <div className="mv-converting" aria-live="polite">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Converting video…
          </div>
        )}
      </div>
    </div>
  );
}

function AstraSlide({ item }: { item: MediaItem }) {
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const k = mediaKind(item.name);

  // doc slides: native wheel + pointer stop so yarl's horizontal-wheel/swipe never hijacks document scroll
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener("wheel", stop, { passive: true });
    return () => el.removeEventListener("wheel", stop);
  }, []);

  const stopPlusMinus = (e: React.KeyboardEvent) => {
    if (e.key === "+" || e.key === "=" || e.key === "-") { e.stopPropagation(); e.preventDefault(); }
  };

  if (failed) {
    return (
      <div className="mv-slide" onKeyDown={stopPlusMinus}>
        <SlideError item={item} onRetry={() => { setFailed(false); setRetryTick((t) => t + 1); }} />
      </div>
    );
  }

  if (k === "video" || k === "audio") {
    return <VideoSlide key={`${item.path}-${retryTick}`} item={item} onFail={() => setFailed(true)} />;
  }

  if (k === "pdf" && item.path != null) {
    return (
      <div className="mv-slide" ref={wrapRef} onPointerDown={(e) => e.stopPropagation()} onKeyDown={stopPlusMinus}>
        <div className="mv-doc">
          <PdfView key={`${item.path}-${retryTick}`} url={downloadUrl(item.path)} name={item.name} onError={() => setFailed(true)} />
        </div>
      </div>
    );
  }

  if ((k === "docx" || k === "xlsx" || k === "pptx" || k === "text") && item.path != null) {
    return (
      <div className="mv-slide" ref={wrapRef} onPointerDown={(e) => e.stopPropagation()} onKeyDown={stopPlusMinus}>
        <DocPreview path={item.path} url={downloadUrl(item.path)} name={item.name} fill />
      </div>
    );
  }

  // archive / other
  return (
    <div className="mv-slide" onKeyDown={stopPlusMinus}>
      <div className="mv-card">
        <FileArchive className="h-8 w-8" style={{ color: "var(--color-muted)" }} />
        <div className="text-sm font-medium truncate" style={{ maxWidth: 280 }}>{item.name}</div>
        <div className="text-xs" style={{ color: "var(--color-muted)" }}>No preview for this file type</div>
        {item.path != null && <button type="button" className="mv-btn" onClick={() => downloadFile(item.path!, item.name)}>Download</button>}
      </div>
    </div>
  );
}

function ThumbIcon({ item }: { item: MediaItem }) {
  const k = mediaKind(item.name);
  const Icon = k === "pdf" || k === "docx" || k === "text" ? FileText : k === "xlsx" ? Sheet : k === "pptx" ? Presentation : k === "archive" ? FileArchive : k === "video" || k === "audio" ? Film : FileIcon;
  return <Icon className="h-6 w-6" style={{ color: "var(--color-muted)" }} aria-label={badgeLabel(item.name)} />;
}

export default function MediaViewer({ items, index, onClose }: { items: MediaItem[]; index: number; onClose: () => void }): React.ReactNode {
  const reduced = usePrefersReducedMotion();
  const native = Capacitor.isNativePlatform();
  const multi = items.length > 1;
  const [cur, setCur] = useState(index);

  const slides: Slide[] = items.map((it) =>
    mediaKind(it.name) === "image"
      ? ({ src: imageSrc(it), alt: it.name } as Slide)
      : ({ type: "astra", item: it } as unknown as Slide),
  );

  // Back/history contract (plan §2): one owned pushState entry; close via history.back().
  const requestClose = useCallback(() => {
    if (typeof history !== "undefined" && (history.state as Record<string, unknown> | null)?.astraViewer) history.back();
    else onClose();
  }, [onClose]);

  useEffect(() => {
    const prev = history.state as Record<string, unknown> | null;
    history.pushState({ ...prev, astraViewer: 1 }, "");
    const onPop = () => onClose();
    window.addEventListener("popstate", onPop);
    // APK: native Back asks the page first
    (window as unknown as Record<string, unknown>).__astraBack = () => { requestClose(); return true; };
    return () => {
      window.removeEventListener("popstate", onPop);
      delete (window as unknown as Record<string, unknown>).__astraBack;
      // never history.back() here — popstate already handled the pop (double-pop guard)
    };
  }, [onClose, requestClose]);

  return (
    <Lightbox
      open
      close={requestClose}
      index={index}
      slides={slides}
      className="astra-viewer"
      plugins={multi ? [Zoom, Thumbnails, Counter] : [Zoom]}
      carousel={{ finite: true, preload: 1, padding: 0 }}
      controller={{ closeOnPullDown: true, closeOnBackdropClick: true }}
      animation={{ fade: reduced ? 0 : 200, swipe: reduced ? 0 : 220, navigation: reduced ? 0 : 220 }}
      zoom={{ maxZoomPixelRatio: 4, scrollToZoom: true, doubleClickMaxStops: 2 }}
      thumbnails={{ vignette: false, border: 1, borderRadius: 6, width: 64, height: 48, gap: 6, padding: 0, imageFit: "cover" }}
      counter={{ container: { style: { top: "calc(var(--native-inset-top, 0px) + 4px)", bottom: "unset" } } }}
      labels={{ Close: "Close viewer", Previous: "Previous item", Next: "Next item" }}
      on={{ view: ({ index: i }) => setCur(i) }}
      toolbar={{
        buttons: [
          <DownloadBtn key="dl" items={items} />,
          !native ? <OpenBtn key="open" items={items} /> : null,
          <CopyBtn key="copy" items={items} />,
          "close",
        ].filter(Boolean) as React.ReactNode[],
      }}
      render={{
        slide: ({ slide, offset }) =>
          (slide as GenericSlide & { type?: string }).type === "astra"
            ? offset === 0
              ? <AstraSlide item={(slide as unknown as { item: MediaItem }).item} />
              : <SlidePlaceholder item={(slide as unknown as { item: MediaItem }).item} />
            : undefined,
        thumbnail: ({ slide }) =>
          (slide as GenericSlide & { type?: string }).type === "astra"
            ? <ThumbIcon item={(slide as unknown as { item: MediaItem }).item} />
            : undefined,
        buttonPrev: multi ? undefined : () => null,
        buttonNext: multi ? undefined : () => null,
        iconError: () => (items[cur] ? <SlideError item={items[cur]} /> : null),
        controls: () => <ViewerToast />,
      }}
    />
  );
}
