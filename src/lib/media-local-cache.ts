// Media local cache: chat media is downloaded to the DEVICE once (Cache Storage),
// then played/rendered from the local copy — not re-streamed from the server each time.
// Cache API is native (no deps). Prune keeps the bucket under a byte cap, oldest out.
// ponytail: byte-cap pruning counts only responses carrying X-Astra-Media-Size; legacy
// entries are pruned by insertion order from the keys() index.

const BUCKET = "astra-media-v1";
const MAX_BYTES = 256 * 1024 * 1024; // 256 MB cap, oldest-entry eviction

function cacheUrl(path: string, name: string, kind: "stream" | "view") {
  // Cache keys must be unique per source variant (transcode vs native stream).
  return new Request(`/api/media/local?variant=${kind}&name=${encodeURIComponent(name)}&path=${encodeURIComponent(path)}`).url;
}

export function localMediaKey(path: string, name: string, kind: "stream" | "view" = "stream") {
  return cacheUrl(path, name, kind);
}

async function prune(cache: Cache) {
  try {
    const keys = await cache.keys();
    let total = 0;
    const sized: { req: RequestInfo; size: number }[] = [];
    const unsized: RequestInfo[] = [];
    for (const req of keys) {
      const res = await cache.match(req);
      const size = Number(res?.headers.get("X-Astra-Media-Size") ?? 0);
      if (size > 0) { total += size; sized.push({ req, size }); }
      else unsized.push(req);
    }
    for (const req of unsized) { await cache.delete(req); total = Infinity; } // legacy entries: drop all
    if (Number.isFinite(total) && total <= MAX_BYTES) return;
    // oldest first = insertion order
    if (Number.isFinite(total)) {
      for (const { req, size } of sized) {
        if (total <= MAX_BYTES) break;
        await cache.delete(req);
        total -= size;
      }
    }
  } catch { /* prune is best-effort */ }
}

// Preferred entry: a local object URL backed by the cached (or freshly downloaded) file.
export async function getLocalMediaUrl(path: string, name: string, kind: "stream" | "view" = "stream"):
  Promise<string | null> {
  try {
    const cache = await caches.open(BUCKET);
    const reqUrl = cacheUrl(path, name, kind);
    let res = await cache.match(reqUrl);
    if (!res) {
      // download once — fetch through the normal proxy URL so auth cookie + Range-less
      // full GET is used; store with size header for pruning
      const source = await fetch(kind === "view" ? viewSrc(path, name) : streamSrc(path), { credentials: "include" });
      if (!source.ok) return null;
      const buf = await source.arrayBuffer();
      if (buf.byteLength === 0) return null;
      const headers = new Headers({ "Content-Type": source.headers.get("Content-Type") ?? "application/octet-stream", "X-Astra-Media-Size": String(buf.byteLength) });
      res = new Response(buf, { headers });
      await cache.put(reqUrl, res);
      void prune(cache);
      res = await cache.match(reqUrl);
    }
    const blob = await res?.blob();
    if (!blob) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null; // caller falls back to server streaming
  }
}

function streamSrc(path: string) {
  return `/api/hx/files/stream?path=${encodeURIComponent(path)}`;
}
function viewSrc(path: string, name: string): string {
  // images: decode issues handled upstream (transcode route); try download itself
  void name;
  return `/api/hx/files/download?path=${encodeURIComponent(path)}`;
}

// Bytes-level variant for document viewers (pdf/docx/xlsx/pptx/text): same
// download-once-then-local contract as getLocalMediaUrl, but returns the raw
// bytes instead of an object URL. `kind: "view"` matches the media cards'
// cache variant so a file already fetched for viewing is reused as-is.
export async function getLocalMediaBytes(path: string, name: string): Promise<ArrayBuffer | null> {
  try {
    const cache = await caches.open(BUCKET);
    const reqUrl = cacheUrl(path, name, "view");
    let res = await cache.match(reqUrl);
    if (!res) {
      const source = await fetch(viewSrc(path, name), { credentials: "include" });
      if (!source.ok) return null;
      const buf = await source.arrayBuffer();
      if (buf.byteLength === 0) return null;
      const headers = new Headers({
        "Content-Type": source.headers.get("Content-Type") ?? "application/octet-stream",
        "X-Astra-Media-Size": String(buf.byteLength),
      });
      await cache.put(reqUrl, new Response(buf, { headers }));
      void prune(cache);
      res = await cache.match(reqUrl);
    }
    return (await res?.arrayBuffer()) ?? null;
  } catch {
    return null; // caller falls back to a direct proxy fetch
  }
}
