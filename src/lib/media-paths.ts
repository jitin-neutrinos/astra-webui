export const MEDIA_RE = /(?<![\w:])(?<!\/)(?:~|\/)[\w./-]*\.(?:png|jpe?g|gif|webp|mp4|webm|mov|mkv|avi|mp3|wav|ogg|flac|m4a|opus)\b/gi;

export function mediaPaths(text: string) {
  // MEDIA:<path> markers carry a colon before the path — the URL guard would reject them, so strip the marker first
  return [...new Set(text.replace(/\bMEDIA:\s*(?=[~/])/g, "").match(MEDIA_RE) ?? [])];
}

export function stripMediaLines(t: string) {
  return t.replace(/^\s*MEDIA:\s*\S+\s*$/gm, "").trim();
}

export function extractAttachments(content: string) {
  const files: { name: string; path: string }[] = [];
  const lines = content.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const m = line.match(/^Attached file:\s*(.*)$/);
    if (m) {
      const path = m[1].trim();
      const name = path.split('/').pop() || path;
      files.push({ name, path });
    } else {
      kept.push(line);
    }
  }
  return { text: kept.join('\n').trim(), files };
}
