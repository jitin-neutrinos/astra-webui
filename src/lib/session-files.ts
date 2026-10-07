let homePath: string | null = null;
let catalogCache: any = null;

export async function getHermesHome(): Promise<string> {
  if (homePath) return homePath;
  const res = await fetch("/api/hx/files");
  if (!res.ok) throw new Error("Failed to get home path");
  const data = await res.json();
  if (!data.path) throw new Error("No home path in response");
  homePath = data.path as string;
  return homePath;
}

export async function getHermesFiles(path?: string) {
  const url = path ? `/api/hx/files?path=${encodeURIComponent(path)}` : "/api/hx/files";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to list files");
  return res.json();
}

export function getFileKind(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || "";
  if (["pdf"].includes(ext)) return "pdf";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "mkv", "avi"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "flac", "m4a", "opus"].includes(ext)) return "audio";
  if (["docx", "xlsx", "pptx", "txt", "md", "csv", "heic", "heif"].includes(ext)) return "doc";
  return "other";
}

// A year-pinned copy of this URL (old edge rule, or the phone's WebView disk
// cache) still answers after a new key is added. `cache: "no-store"` plus a
// unique query misses that copy. The in-memory `catalogCache` is only for the
// same page session; the popup passes `fresh` so a just-added key shows up.
export function catalogRequest(now = Date.now()): { url: string; init: RequestInit } {
  return {
    url: `/api/hx/model/options?live=${now}`,
    init: { cache: "no-store", credentials: "same-origin" },
  };
}

export async function getCatalog(fresh = false) {
  if (catalogCache && !fresh) return catalogCache;
  const load = () => {
    const { url, init } = catalogRequest();
    return fetch(url, init);
  };
  let res = await load();
  if (res.status === 503) res = await load();
  if (!res.ok) {
    if (catalogCache) return catalogCache;
    throw new Error("Failed to load catalog");
  }
  const raw: any = await res.json();
  // host payload: providers carry `name` (not `label`) and `models` may be null — normalize once
  catalogCache = {
    ...raw,
    providers: (raw.providers || []).map((p: any) => ({ ...p, label: p.label ?? p.name ?? p.slug, models: p.models ?? [] })),
  };
  return catalogCache;
}
