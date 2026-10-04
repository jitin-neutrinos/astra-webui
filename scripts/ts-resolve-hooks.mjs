// Resolve hook: Node type-strips .ts but does NOT resolve extensionless
// relative specifiers (it follows NodeNext rules where "./x" must exist
// on disk). Vite/esbuild accept both, so app source is written
// extensionless — which leaves every bare-`node` check that transitively
// imports a non-check module unable to load it.
//
// This hook retries a failed relative resolve against .ts/.tsx/index.ts
// so checks run unmodified against unmodified source. Dev-only: never
// bundled, and app behavior is unaffected.
const CANDIDATE_EXTS = [".ts", ".tsx", "/index.ts", ".mjs", ".js"];

export async function resolve(spec, ctx, next) {
  try {
    return await next(spec, ctx);
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
    if (!spec.startsWith(".")) throw err;

    // Resolve against the parent URL directly. Do NOT round-trip through
    // url.origin: when the parent is itself a .ts file URL its origin is
    // "null", and `new URL(path, "null")` throws ERR_INVALID_URL.
    //
    // Split the query off FIRST: a cache-busting import
    // ("./notify?legacy-shape") must become "./notify.ts?legacy-shape",
    // never "./notify?legacy-shape.ts".
    const mark = spec.search(/[?#]/);
    const pathname = mark === -1 ? spec : spec.slice(0, mark);
    const suffix = mark === -1 ? "" : spec.slice(mark);

    const candidates = [];
    for (const ext of CANDIDATE_EXTS) {
      try {
        candidates.push(new URL(pathname + ext, ctx.parentURL).href + suffix);
      } catch {
        /* parent URL unusable; fall through to the original error */
      }
    }
    for (const candidate of candidates) {
      try {
        return await next(candidate, ctx);
      } catch {
        /* try next candidate */
      }
    }
    throw err;
  }
}
