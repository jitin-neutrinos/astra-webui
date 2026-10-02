// chat-backdrop.tsx — chat background layer: image / uploaded video / YouTube.
// Mounted inside ChatLanding's <main> at z-0; header/scroll/composer stay z-10.
// Zero DOM when no backdrop is set (default = pixel-identical).
// YouTube: muted+autoplay+loop iframe (RMF-compliant: single player, user-set),
// cover-fit via fixed 16:9 stage scaled to cover the viewport (no JS loop).
import { useEffect, useState } from "react";
import { readChatBg, youtubeId, type ChatBg } from "../lib/theme-store";

export function ChatBackdrop() {
  const [bg, setBg] = useState<ChatBg | null>(() => readChatBg());
  useEffect(() => {
    const onChange = (e: Event) => setBg((e as CustomEvent<ChatBg | null>).detail);
    window.addEventListener("astra-chat-bg-change", onChange);
    return () => window.removeEventListener("astra-chat-bg-change", onChange);
  }, []);

  const ytId = bg?.kind === "youtube" ? youtubeId(bg.src) : null;
  if (!bg || (bg.kind === "youtube" && !ytId)) return null;

  const dim = Math.min(Math.max(bg.dim ?? 0.45, 0), 0.9);
  return (
    <div aria-hidden="true" className="chat-backdrop" data-kind={bg.kind} data-theme-engine-new>
      {bg.kind === "image" && (
        <img src={bg.src} alt="" className="chat-backdrop-media" draggable={false} />
      )}
      {bg.kind === "video" && (
        <video
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
            src={`https://www.youtube.com/embed/${ytId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${ytId}&playsinline=1&modestbranding=1&rel=0&iv_load_policy=3&disablekb=1`}
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
