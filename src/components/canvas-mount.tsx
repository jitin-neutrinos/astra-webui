// Canvas mount markers (2026-10-05) — see docs/canvas-never-raw-code-proposal.md
//
// L1's real scope is smaller than it first looked, and this file records why so
// nobody re-widens it: `splitCanvasBlocks` (chat-timeline.tsx:121) already claims
// EVERY fence whose body parses, and those never reach marked. The only fences
// that reach marked are the ones the parser REJECTED. So the renderer override
// in rich-html.ts is a safety net for the leak path, not a second render route.
//
// Consequence: there is nothing to mount here. The net emits a placeholder, and
// the real card appears through the existing path once either (a) the async
// repair tier runs — which is gated to finished turns, chat-timeline.tsx:124 — or
// (b) the message is reloaded. Building a second React root to render the
// rejected-but-reparseable case would duplicate CanvasHost, the sanitizer and the
// per-canvas store for a transient frame.
//
// Kept as a module so the placeholder has one named home and the CSS class is
// documented in one place.
export const CV_PENDING_CLASS = "ast-cv-pending";