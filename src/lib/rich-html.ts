// Markdown → sanitized HTML, shared by chat message bubbles and rich tool-card
// fields. Pure-ish lib (needs DOM for DOMPurify, like any browser code) — no
// React, so both importers stay cycle-free. Logic moved verbatim from
// chat-timeline.tsx RichText (2026-09-30): same marked+DOMPurify pipeline that
// is already battle-tested in production.
import { Marked } from "marked";
import DOMPurify from "dompurify";
import { parseCanvasSpec } from "./canvas-schema";

// L1 (2026-10-05) — an `astra-canvas` fence is NEVER rendered as a code block.
//
// The bug this removes: when the model emits slightly malformed JSON, the sync
// parser cannot read the fence, so the fail-soft rule leaves it in the markdown
// and `marked` faithfully paints it as `<pre><code class="language-astra-canvas">`.
// The second-chance repair (splitCanvasBlocksAsync) is gated off while a turn is
// streaming (chat-timeline.tsx:124), and a turn whose `text-final` never arrives
// stays streaming forever — so the raw JSON stayed on screen until a reload.
// Measured shapes that hit it: unquoted keys wrapped in prose, single quotes,
// and a truncated body (that last one is repaired by NEITHER tier).
//
// SCOPE, recorded deliberately: splitCanvasBlocks (chat-timeline.tsx:121)
// already claims every fence whose body PARSES, and those never reach marked.
// Only parser-rejected fences get here. So this override is the SAFETY NET for
// the leak path, not a second render route — see src/components/canvas-mount.tsx.
// Nothing needs mounting; the net only has to stop the paint.
//
// Fix: intercept the fence at the markdown layer. If the body parses, render the
// card inline is NOT possible from here (no React), so we emit a mount marker
// that the existing splitter path has already handled; if it does not parse, emit
// a neutral placeholder. Either way the code renderer never sees the payload, so
// raw JSON is unreachable regardless of parser, streaming or segment state.
const CANVAS_LANG = "astra-canvas";
const MOUNT_ATTR = "data-cv-mount";

const md = new Marked({ gfm: true, breaks: true });

md.use({
  renderer: {
    code(token: { text?: string; lang?: string }): string {
      const lang = (token.lang ?? "").trim().split(/\s+/)[0];
      if (lang !== CANVAS_LANG) return false as unknown as string; // fall through to default
      const body = token.text ?? "";
      // A parsed body reaching here means the splitter already claimed it, so we
      // only need to not paint it twice. Unparseable ⇒ placeholder, never the body.
      if (safeParse(body)) return `<div ${MOUNT_ATTR}></div>`;
      return `<div class="ast-cv-pending" role="status" aria-live="polite" data-cv-pending>Card building…</div>`;
    },
  },
});

/** Never throws: the placeholder path depends on it. */
function safeParse(body: string): unknown | null {
  try {
    return parseCanvasSpec(body);
  } catch {
    return null;
  }
}

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
