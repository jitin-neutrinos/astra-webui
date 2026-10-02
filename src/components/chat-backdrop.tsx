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

  // uploaded video: never stall — replay on end, resume when the tab returns
  useEffect(() => {
    if (bg?.kind !== "video") return;
    const v = videoRef.current;
    if (!v) return;
    const replay = () => { v.currentTime = 0; void v.play().catch(() => {}); };
    const onVis = () => { if (!document.hidden && v.paused && !v.ended) void v.play().catch(() => {}); };
    v.addEventListener("ended", replay);
    document.addEventListener("visibilitychange", onVis);
    return () => { v.removeEventListener("ended", replay); document.removeEventListener("visibilitychange", onVis); };
  }, [bg?.kind, bg?.src]);

  // youtube: cut the loop gap via the IFrame API + resume after tab-hide
  useEffect(() => {
    if (bg?.kind !== "youtube" || !ytId) return;
    let player: any = null;
    let disposed = false;
    let lastState = -1;
    loadYtApi().then((YT) => {
      if (disposed || !ytRef.current || !YT?.Player) return;
      player = new YT.Player(YT_FRAME_ID, {
        events: {
          onReady: (e: any) => { e.target.mute(); e.target.playVideo(); },
          onStateChange: (e: any) => {
            if (e.data === YT.PlayerState.ENDED && lastState === YT.PlayerState.PLAYING) {
              e.target.seekTo(0, true); e.target.playVideo();     // tight loop, no reload
            }
            lastState = e.data;
          },
        },
      });
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
        <img src={bg.src} alt="" className="chat-backdrop-media" draggable={false} />
      )}
      {bg.kind === "video" && (
        <video
          ref={videoRef}
          className="chat-backdrop-media"
          src={bg.src}
          autoPlay
          muted
          loop
          playsInline
          disablePictureInPicture
          controls={false}
        />
      )}
      {bg.kind === "youtube" && ytId && (
        <div className="chat-backdrop-yt">
          <iframe
            ref={ytRef}
            id={YT_FRAME_ID}
            src={`https://www.youtube.com/embed/${ytId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${ytId}&playsinline=1&modestbranding=1&rel=0&iv_load_policy=3&disablekb=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
            title="Chat background video"
            allow="autoplay; encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
            tabIndex={-1}
          />
        </div>
      )}
      <div className="chat-backdrop-dim" style={{ backgroundColor: `rgba(0,0,0,${dim})` }} />
    </div>
  );
}
