// build-check.ts — client update check (2026-10-06).
//
// WHY: the CF zone rule caches index.html at the edge for a YEAR regardless of
// the origin's `no-cache` (measured: origin no-cache, edge max-age=31536000,
// cf-cache-status:HIT with age in hours). A deploy therefore never reaches an
// already-open tab — and worse, a NEW visitor keeps the OLD html until the
// edge entry lapses. The one path class the edge does not cache-and-pin is
// /api (the b3deeb8 fix forces no-store through), so the client polls
// /api/build-id and hard-reloads when the server's build stamp differs from
// the stamp this bundle was built with.
//
// Mechanics:
//   • the stamp is injected by vite `define` at build time (ASTRA_BUILD_ID)
//   • the server derives its stamp from dist/index.html mtime, lazily, so a
//     deploy flips it within 5s without a restart
//   • poll every 90s while the tab is visible; a hidden tab is not "looking
//     at a stale app" — reload when it becomes visible instead
//   • reload only ONCE per departed stamp (sessionStorage guard) so a broken
//     deploy cannot loop-reload the tab forever
//   • failures are silent: an unreachable server must not reload-loop either

const POLL_MS = 90_000;

let running = false;

export function startBuildCheck(): void {
  if (running) return;
  running = true;
  const mine = (typeof __ASTRA_BUILD_ID__ !== "undefined" && __ASTRA_BUILD_ID__) || "";
  if (!mine) return; // non-vite context (tests, SSR probes) — nothing to compare

  const check = async () => {
    try {
      // Same poison as the model catalog: a year-pinned /api/build-id means this
      // tab never notices a deploy, so it never loads the catalog fix either.
      const res = await fetch(`/api/build-id?live=${Date.now()}`, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const theirs = String(data?.build || "");
      if (!theirs || theirs === mine) return;
      // Departed stamp: reload once, guard against a reload loop on a
      // broken/partial deploy.
      const key = "astra_build_reload";
      if (sessionStorage.getItem(key) === theirs) return;
      sessionStorage.setItem(key, theirs);
      location.reload();
    } catch { /* offline / proxy down — retry on the next tick */ }
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") void check();
  };

  document.addEventListener("visibilitychange", onVisible);
  setInterval(() => {
    if (typeof document === "undefined" || document.visibilityState === "visible") void check();
  }, POLL_MS);
  void check();
}

export const _test = { POLL_MS };
