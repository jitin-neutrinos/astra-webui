# Theme toggle icons — owner drop-zone

The theme toggle renders **illustrated Lottie icons** for light (sun) and dark (moon).
Those two files are **not in the repo yet**: LottieFiles is Cloudflare-gated, so the
owner downloads them once and drops them here.

## Where to put them

```
public/lottie/theme-sun.json     ← the sun (shown in LIGHT mode)
public/lottie/theme-moon.json    ← the moon (shown in DARK mode)
```

`public/` is served as-is by the vite build and by `server.mjs`, so no config change
is needed — drop the two files in and reload. Any Lottie JSON works; the filenames
are a convention, not a contract.

## Where to get them

LottieFiles → *Day And Night Toggle* (or any illustrated sun / moon set), then
**Download → Lottie JSON**. Both are free under the
[Lottie Simple License](https://lottiefiles.com/page/license), which allows
commercial use.

Handy starting points:

- <https://lottiefiles.com/free-animations/dark-mode-toggle>
- <https://lottiefiles.com/free-animations/sun-moon>
- <https://lottiefiles.com/free-animation/day-and-night-mode-toggle-switch-YpuWfDBGXu>

## Self-hosted on purpose

`assets-v2.lottiefiles.com` returns **403 for hotlinks** and the pages sit behind
Cloudflare, so pointing `<Lottie src>` at the CDN would 403 for your users too.
Same bytes, served from your own origin.

## Until the files land

`src/components/theme-lottie.tsx` HEAD-probes both URLs once per session. If either
is missing, the toggle falls back to the inline SVG icon — it never renders blank,
and you can drop the JSON in at any time with no code change and no rebuild.
