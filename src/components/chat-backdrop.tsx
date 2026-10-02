// chat-backdrop.tsx — chat background layer: image / uploaded video / YouTube.
// Mounted inside ChatLanding's <main> at z-0; header/scroll/composer stay z-10.
// Zero DOM when no backdrop is set (default = pixel-identical).
// YouTube: muted+autoplay+loop iframe (RMF-compliant: single player, user-set),
// cover-fit via fixed 16:9 stage scaled to cover the viewport (no JS loop).
import { useEffect, useRef, useState } from "react";
import { readChatBg, youtubeId, type ChatBg } from "../lib/theme-store";

// Gapless-ish loop + auto-resume for both media kinds. YouTube's loop param
// reloads the player (~1s black gap); driving the IFrame API on ENDED
// (seekTo(0,false)+playVideo) cuts that to a fraction. Uploads loop natively.
const YT_FRAME_ID = "chat-backdrop-yt-frame";
declare global { interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void } }

/**
 * A backdrop `src` may be (a) a URL, (b) a blob/object URL, or (c) the HOST
 * FILESYSTEM PATH that the upload route returns. A <video>/<img> cannot load (c):
 * the browser resolves `/home/notjitin/x.mp4` against the origin to
 * `https://host/home/notjitin/x.mp4`, which hits the SPA fallback and returns
 * index.html — so the element fails with MEDIA_ERR_SRC_NOT_SUPPORTED (code 4),
 * videoWidth 0, and a black backdrop. ThemePanel.upload stores exactly that raw
 * path (`applyBg({kind:'video', src: path})`), so every uploaded video died here.
 * Rewrite an absolute host path into the streaming route that serves it.
 */
function bgSrc(src: string): string {
  if (!src) return src;
  if (/^(https?:|blob:|data:|media:)/i.test(src)) return src;
  if (src.startsWith("/api/")) return src;
  // absolute filesystem path -> the gateway's streaming route (Range-capable,
  // which <video> needs for seeking)
  if (src.startsWith("/")) return `/api/hx/files/stream?path=${encodeURIComponent(src)}`;
  return src;
}

let ytApiPromise: Promise<any> | null = null;
function loadYtApi(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!ytApiPromise) {
    ytApiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    });
  }
  return ytApiPromise;
}

export function ChatBackdrop() {
  const [bg, setBg] = useState<ChatBg | null>(() => readChatBg());
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onChange = (e: Event) => setBg((e as CustomEvent<ChatBg | null>).detail);
    window.addEventListener("astra-chat-bg-change", onChange);
    return () => window.removeEventListener("astra-chat-bg-change", onChange);
  }, []);

  const ytId = bg?.kind === "youtube" ? youtubeId(bg.src) : null;

  // uploaded video: never stall — replay on end, resume when the tab returns,
  // and RESUME POSITION across reloads (global tracker keyed by source).
  useEffect(() => {
    if (bg?.kind !== "video") return;
    const v = videoRef.current;
    if (!v) return;
    const key = `astra-bg-video-pos:${bg.src}`;
    const saved = Number(localStorage.getItem(key) || "0");
    if (saved > 1) { try { v.currentTime = saved; } catch { /* not seekable yet */ } }
    let lastSave = 0;
    const save = () => { try { localStorage.setItem(key, String(v.currentTime)); } catch { /* noop */ } };
    const throttled = () => { if (Date.now() - lastSave > 3000) { lastSave = Date.now(); save(); } };
    const replay = () => { v.currentTime = 0; try { localStorage.setItem(key, "0"); } catch {} void v.play().catch(() => {}); };
    const onVis = () => { if (!document.hidden && v.paused && !v.ended) void v.play().catch(() => {}); };
    v.addEventListener("timeupdate", throttled);
    v.addEventListener("pause", save);
    v.addEventListener("ended", replay);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      save();
      v.removeEventListener("timeupdate", throttled);
      v.removeEventListener("pause", save);
      v.removeEventListener("ended", replay);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [bg?.kind, bg?.src]);

  // youtube: cut the loop gap via the IFrame API + resume after tab-hide
  useEffect(() => {
    if (bg?.kind !== "youtube" || !ytId) return;
    let player: any = null;
    let disposed = false;
    let lastState = -1;
    loadYtApi().then((YT) => {
      if (disposed || !ytRef.current || !YT?.Player) return;
      const ytKey = `astra-bg-video-pos:yt:${ytId}`;
      const startAt = Number(localStorage.getItem(ytKey) || "0");
      player = new YT.Player(YT_FRAME_ID, {
        videoId: ytId,
        playerVars: {
          autoplay: 1, mute: 1, controls: 0, loop: 1, playlist: ytId,
          playsinline: 1, rel: 0, iv_load_policy: 3, disablekb: 1, fs: 0,
          start: Math.floor(startAt),
          origin: window.location.origin,
        },
        events: {
          onReady: (e: any) => { e.target.mute(); if (startAt > 1) e.target.seekTo(startAt, true); e.target.playVideo(); },
          onStateChange: (e: any) => {
            if (e.data === YT.PlayerState.ENDED && lastState === YT.PlayerState.PLAYING) {
              e.target.seekTo(0, true); e.target.playVideo();     // tight loop, no reload
              try { localStorage.setItem(ytKey, "0"); } catch {}
            }
            lastState = e.data;
          },
        },
      });
      // persist position every 5s so a reload resumes where it left off
      const ytSave = window.setInterval(() => {
        try { const t = player?.getCurrentTime?.(); if (typeof t === "number" && t > 0) localStorage.setItem(ytKey, String(Math.floor(t))); } catch { /* not ready */ }
      }, 5000);
      window.addEventListener("beforeunload", () => clearInterval(ytSave));
    });
    const onVis = () => {
      if (!document.hidden && player?.getPlayerState?.() === window.YT.PlayerState.PAUSED) player.playVideo();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { disposed = true; document.removeEventListener("visibilitychange", onVis); try { player?.destroy?.(); } catch { /* gone */ } };
  }, [bg?.kind, ytId]);

  if (!bg || (bg.kind === "youtube" && !ytId)) return null;

  const dim = Math.min(Math.max(bg.dim ?? 0.45, 0), 0.9);
  return (
    <div aria-hidden="true" className="chat-backdrop" data-kind={bg.kind} data-theme-engine-new>
      {bg.kind === "image" && (
        <img src={bgSrc(bg.src)} alt="" className="chat-backdrop-media" draggable={false} />
      )}
      {bg.kind === "video" && (
        <video
          ref={videoRef}
          className="chat-backdrop-media"
          src={bgSrc(bg.src)}
          autoPlay
          muted
          loop
          playsInline
          disablePictureInPicture
          disableRemotePlayback
          controls={false}
          tabIndex={-1}
        />
      )}
      {bg.kind === "youtube" && ytId && (
        <div className="chat-backdrop-yt">
          {/* API-created player (no src iframe): zero unstarted chrome, instant muted autoplay,
              seekTo(0) looping. host params let YT style its own embed legally. */}
          <div ref={ytRef} id={YT_FRAME_ID} />
        </div>
      )}
      <div className="chat-backdrop-dim" style={{ backgroundColor: `rgba(0,0,0,${dim})` }} />
    </div>
  );
}
