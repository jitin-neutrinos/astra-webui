// row-inline.ts — sidebar row sub-line rendering (2026-10-06).
//
// The chats panel's `ast-row-sub` shows the session's last reply, which is
// MARKDOWN coming from the proxy enrichment (server/last-reply.mjs). Rendering
// it raw painted ** and ` markers literally ("not rich text formatted").
// Full markdown rendering is wrong here too: the row is one truncated line —
// block constructs (headings, lists, tables) cannot fit. So: inline-only.
//
// Rules:
//   • escape FIRST (the source is model output, never trust it);
//   • fences → ellipsis (a code block never fits a row; canvas cards have
//     their own label, see isCanvasPreview);
//   • inline emphasis (bold / italic / code) kept, links reduced to text
//     (a 10.5px row is too small to be a tap target);
//   • truncation shape handled: the proxy cuts at 220 chars, which can leave
//     an OPENER without its closer — a pair-less marker is dropped so the
//     row never ends in a stray `**` or backtick.

export function isCanvasPreview(t: string | null | undefined): boolean {
  return /```astra-?canvas|astra-canvas/.test(t || "");
}

/** The auto-greet kickoff is a UI convention, not a message — a chat whose
 *  only row is the greet has no responses yet. Same shape notify.ts filters
 *  for unread counts. */
export function isGreetPreview(t: string | null | undefined): boolean {
  return /^New chat just started\./.test((t || "").trim());
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dropDangling(s: string, marker: string): string {
  // Remove the LAST occurrence when the count is odd (an opener that lost its
  // closer to the 220-char cut).
  const count = s.split(marker).length - 1;
  if (count % 2 === 1) {
    const i = s.lastIndexOf(marker);
    if (i !== -1) s = s.slice(0, i) + s.slice(i + marker.length);
  }
  return s;
}

/** Inline-only markdown → trusted HTML string for a sidebar preview line. */
export function inlineMarkdownHtml(t: string | null | undefined): string {
  let s = esc((t || "").replace(/\s+/g, " ").trim());
  if (!s) return "";
  s = s.replace(/```[\s\S]*?```/g, "…");
  s = dropDangling(s, "`");
  s = dropDangling(s, "**");
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, "$1");
  return s;
}
