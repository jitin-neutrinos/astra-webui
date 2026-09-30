// Markdown → sanitized HTML, shared by chat message bubbles and rich tool-card
// fields. Pure-ish lib (needs DOM for DOMPurify, like any browser code) — no
// React, so both importers stay cycle-free. Logic moved verbatim from
// chat-timeline.tsx RichText (2026-09-30): same marked+DOMPurify pipeline that
// is already battle-tested in production.
import { Marked } from "marked";
import DOMPurify from "dompurify";

const md = new Marked({ gfm: true, breaks: true });
let purifyHooked = false;

function ensurePurifyHook() {
  if (purifyHooked) return;
  DOMPurify.addHook("afterSanitizeAttributes", (n) => {
    if (n.tagName === "A") { n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener noreferrer"); }
    if (n.tagName === "IMG") {
      const src = n.getAttribute("src") || "";
      if (src && !src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("/api/hx/")) {
        n.removeAttribute("src"); // Only allow safe paths
      }
      n.setAttribute("loading", "lazy");
    }
  });
  purifyHooked = true;
}

export function renderRichHtml(text: string, streaming = false): string {
  ensurePurifyHook();

  let processed = text;
  let oddFence = false;
  if (streaming) {
    // detect odd fence count -> close it
    const m = processed.match(/```/g);
    if (m && m.length % 2 !== 0) {
      processed += "\n```";
      oddFence = true;
    }
  }

  let sanitized = DOMPurify.sanitize(md.parse(processed, { async: false }) as string, {
    ADD_ATTR: ["target", "loading"], FORBID_TAGS: ["style", "form"], FORBID_ATTR: ["srcset"],
  });

  if (oddFence) {
    // only the trailing unterminated block is actually streaming — a global
    // replace would also tag earlier, already-closed code blocks
    const lastOpen = sanitized.lastIndexOf("<pre><code");
    if (lastOpen !== -1) {
      sanitized = sanitized.slice(0, lastOpen) + '<pre data-streaming="true"><code' + sanitized.slice(lastOpen + "<pre><code".length);
    }
  }
  return sanitized;
}
