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
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "mkv", "avi"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "flac", "m4a", "opus"].includes(ext)) return "audio";
  if (["pdf", "docx", "xlsx", "pptx", "txt", "md", "csv"].includes(ext)) return "doc";
  return "other";
}

export async function getCatalog() {
  if (catalogCache) return catalogCache;
  let res = await fetch("/api/hx/model/options");
  if (res.status === 503) {
    res = await fetch("/api/hx/model/options");
  }
  if (!res.ok) throw new Error("Failed to load catalog");
  catalogCache = await res.json();
  return catalogCache;
}
