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
// Class names live here so rich-html.ts (which emits the markup) and index.css
// (which styles it) cannot drift — the CSS keys are asserted by
// scripts/canvas-raw-code.browser.mts.
const PENDING_CLASS = "ast-cv-pending";
const PENDING_LABEL_CLASS = "ast-cv-pending-label";

const md = new Marked({ gfm: true, breaks: true });

md.use({
  renderer: {
    code(token: { text?: string; lang?: string }): string {
      const lang = (token.lang ?? "").trim().split(/\s+/)[0];
      if (lang !== CANVAS_LANG) return false as unknown as string; // fall through to default
      const body = token.text ?? "";
      // A parsed body reaching here means the splitter already claimed it, so we
      // only need to not paint it twice.
      if (safeParse(body)) return `<div ${MOUNT_ATTR}></div>`;
      // Unparseable ⇒ placeholder, never the body. See pendingLabel() for why the
      // copy says "Generating" rather than "Failed": measured, a TRUNCATED body
      // (the model ran out of tokens mid-JSON) is rescued by NO repair tier —
      // sync and async both return nothing — so this line can legitimately be the
      // final state of a message whose fence never completed. Calling it
      // "Failed" there would be a lie; calling it "Card building…" forever was a
      // dead end with no way for the reader to tell the two apart.
      return (
        `<div class="${PENDING_CLASS}" role="status" aria-live="polite" data-cv-pending>` +
        `<span class="${PENDING_LABEL_CLASS}">${pendingLabel(body)}</span>` +
        `</div>`
      );
    },
  },
});

/**
 * "Generating Data Points…" for a body that is still arriving or incomplete,
 * and an explicit "could not be read" only when we can prove the fence is FINISHED
 * and still unusable. Measured against the real parser:
 *   truncated body      sync=0 async=0  -> genuinely unrecoverable (dead end)
 *   unquoted + prose    sync=0 async=1  -> the rescue WILL fix it
 *   single quotes       sync=0 async=0 after repair rounds -> unrecoverable
 *   empty / non-object  sync=0 async=0  -> nothing to render
 * So: a body that looks cut off (no closing brace/bracket, ends mid-token) is the
 * "still generating" case; anything else is reported as unreadable. Retrying is
 * the caller's job (chat-timeline.tsx L4), so we never claim to have finished.
 */
function pendingLabel(body: string): string {
  // A body still ARRIVING looks cut off: unbalanced brackets, or no closing
  // bracket at all. A FINISHED-but-unusable body is complete but not JSON.
  // (Garbage like "not json at all {{{" must NOT claim to be generating.)
  const t = body.trim();
  const opens = (t.match(/[{[]/g) ?? []).length;
  const closes = (t.match(/[}\]]/g) ?? []).length;
  const looksTruncated = opens !== closes;
  return looksTruncated
    ? "Generating Data Points…"
    : "This card could not be read — the model sent an unreadable payload.";
}

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
