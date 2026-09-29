// Collision-free upload names (R8c). Old code used `${name}-${size}-${Date.now()}`
// and overwrote `uploads/${file.name}` — both destroy history on re-upload.
export function newId(): string {
  const c: Crypto | undefined = typeof crypto !== "undefined" ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  // hex-only fallback (keeps the shortId slice pure hex both ways)
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`;
}

// Last 8 hex chars of the random part. 8 not 6: 1000 draws over 16^6 collide ~3% of runs.
export function shortId(): string {
  return newId().replace(/-/g, "").slice(-8);
}

export function uniqueUploadName(original: string, id?: string): string {
  const dot = original.lastIndexOf(".");
  const ext = dot === -1 ? "" : original.slice(dot + 1);
  const stem0 = dot === -1 ? original : original.slice(0, dot);
  let stem = stem0.replace(/[^\w.-]+/g, "_").slice(0, 80);
  if (!stem) stem = "file";
  return `${stem}-${id ?? shortId()}${ext ? "." + ext : ""}`;
}

// Display name for a server-side upload path: basename with the -<8hex> suffix removed.
// Only called for paths containing "/uploads/" — a real "report-abcd1234.pdf" elsewhere is untouched.
export function displayName(serverName: string): string {
  const base = serverName.split("/").pop() || serverName;
  return base.replace(/-[0-9a-f]{8}(?=\.[^./]+$|$)/, "");
}
