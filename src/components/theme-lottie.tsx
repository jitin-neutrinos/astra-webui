import { useEffect, useState } from "react";
import { Lottie } from "lottie-react";

/**
 * Lottie-backed theme icon.
 *
 * ASSETS ARE NOT IN THE REPO YET — they are Cloudflare-gated on LottieFiles, so
 * the owner downloads them once (free, Lottie Simple License, commercial use
 * allowed) and drops them here:
 *
 *     public/lottie/theme-sun.json      illustrated sun  (light mode)
 *     public/lottie/theme-moon.json     illustrated moon (dark mode)
 *
 * Any two Lottie files work — the names are a convention, not a contract. If a
 * file is missing the glyph falls back to the inline SVG so the toggle never
 * renders blank (see ThemeGlyph).
 *
 * Why self-hosted rather than the LottieFiles CDN: assets-v2 is 403 for
 * hotlinking AND the page sits behind Cloudflare, so a remote <src> would 403
 * at runtime for your users too. Same bytes, served from your own origin.
 */
const SUN_URL = "/lottie/theme-sun.json";
const MOON_URL = "/lottie/theme-moon.json";

/** HEAD-probe an asset once per URL; caches the verdict for the session. */
const probed = new Map<string, boolean>();
async function assetExists(url: string): Promise<boolean> {
  const cached = probed.get(url);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-cache" });
    const ok = res.ok && (res.headers.get("content-type") || "").includes("json");
    probed.set(url, ok);
    return ok;
  } catch {
    probed.set(url, false);
    return false;
  }
}

export function useLottieAssets(): { sun: boolean; moon: boolean; ready: boolean } {
  const [state, setState] = useState({ sun: false, moon: false, ready: false });
  useEffect(() => {
    let alive = true;
    Promise.all([assetExists(SUN_URL), assetExists(MOON_URL)]).then(([sun, moon]) => {
      if (alive) setState({ sun, moon, ready: true });
    });
    return () => { alive = false; };
  }, []);
  return state;
}

export function LottieIcon({ url, className }: { url: string; className?: string }) {
  return (
    <Lottie
      src={url}
      loop
      autoplay
      className={className}
      // keep it a pure decoration: the button owns the accessible label
      aria-hidden="true"
      rendererSettings={{ preserveAspectRatio: "xMidYMid meet" }}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
