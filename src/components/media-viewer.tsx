// Full-screen media viewer (yet-another-react-lightbox) with Zoom / Fullscreen /
// Download plugins, video slides for media the chat bubble can't show comfortably.
import { useCallback } from "react";
import LightboxYarl, { type Slide } from "yet-another-react-lightbox";
import Video from "yet-another-react-lightbox/plugins/video";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Download from "yet-another-react-lightbox/plugins/download";
import Fullscreen from "yet-another-react-lightbox/plugins/fullscreen";
import "yet-another-react-lightbox/styles.css";
import { downloadUrl, streamUrl, transcodeUrl, needsTranscode } from "@/lib/media-paths";
import { extOf } from "@/lib/media-kinds";

function ext(name: string): string {
  return extOf(name);
}

function mediaMime(name: string): string {
  const map: Record<string, string> = {
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4", opus: "audio/ogg",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  };
  return map[extOf(name)] || "application/octet-stream";
}

const IMAGE_VIEWER_EXTRA = new Set(["heic", "heif", "tiff", "tif"]); // served via transcode as jpg
const VIDEO_EXTS = new Set(["mp4", "m4v", "webm", "mov", "mkv", "avi", "wmv", "flv", "mpg", "mpeg", "3gp", "ts", "mts", "m2ts"]);

export type MediaView = { url: string; name: string; alt?: string };

export function isViewableImage(name: string) {
  return ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "heic", "heif", "tiff", "tif"].includes(ext(name));
}

// Best browser-viewable URL for a stored path (transcodes images browsers can't decode).
export function viewUrl(path: string, name: string) {
  return needsTranscode(name) || IMAGE_VIEWER_EXTRA.has(ext(name)) ? transcodeUrl(path) : downloadUrl(path);
}

export function slideFor(path: string, name: string): Slide {
  const dl = { url: downloadUrl(path), filename: name };
  if (isViewableImage(name)) {
    return { src: viewUrl(path, name), alt: name, download: dl };
  }
  // video (incl. containers the browser can't decode — BubbleVideoPlayer handles
  // the native-first fallback, the lightbox gets the same rule)
  const nativeOk = !needsTranscode(name);
  const src = nativeOk ? streamUrl(path) : transcodeUrl(path);
  return {
    type: "video",
    sources: [{ src, type: nativeOk ? mediaMime(name) : "video/mp4" }],
    autoPlay: true,
    controls: true,
    playsInline: true,
    download: dl,
  };
}

function slideFromUrl(url: string, name: string): Slide {
  try {
    const u = new URL(url, window.location.origin);
    const path = u.searchParams.get("path");
    if (path && u.pathname.startsWith("/api/")) return slideFor(path, name || path.split("/").pop() || "media");
  } catch { /* relative oddity — fall through */ }
  return { src: url, alt: name, download: { url, filename: name } };
}

export function MediaViewer({ view, onClose }: { view: MediaView | null; onClose: () => void }) {
  const close = useCallback(onClose, [onClose]);
  if (!view) return null;
  const isVideo = VIDEO_EXTS.has(ext(view.name));
  const slide = isVideo ? slideFromVideoUrl(view) : slideFromUrl(view.url, view.name);
  return (
    <LightboxYarl
      open
      close={close}
      slides={[slide]}
      index={0}
      plugins={[Zoom, Download, Fullscreen, ...(isVideo ? [Video] : [])]}
      video={{ autoPlay: true, controls: true, playsInline: true }}
      zoom={{ maxZoomPixelRatio: 5, scrollToZoom: true }}
      styles={{ container: { backgroundColor: "rgba(4 8 16 / 0.94)" } }}
      animation={{ fade: 220, swipe: 260 }}
    />
  );
}

// Video views arrive as {url, name} too — but url may be the /stream URL while a
// transcode is what's actually playable. Rebuild from the stored path when we have one.
function slideFromVideoUrl(view: MediaView): Slide {
  try {
    const u = new URL(view.url, window.location.origin);
    const path = u.searchParams.get("path");
    if (path) return slideFor(path, view.name);
  } catch { /* not ours */ }
  return {
    type: "video",
    sources: [{ src: view.url, type: "video/mp4" }],
    autoPlay: true,
    controls: true,
    playsInline: true,
    download: { url: view.url, filename: view.name },
  };
}
