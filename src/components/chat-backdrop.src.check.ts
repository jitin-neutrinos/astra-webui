// Run: node --experimental-strip-types src/components/chat-backdrop.src.check.ts
// (or: npx tsx src/components/chat-backdrop.src.check.ts)
//
// Guards the backdrop <video>/<img> src mapping. An uploaded video used to be
// stored as the HOST FILESYSTEM PATH, which the browser resolved against the
// origin (https://host/home/notjitin/x.mp4 -> SPA index.html) and failed with
// MEDIA_ERR_SRC_NOT_SUPPORTED (code 4), videoWidth 0, black backdrop.
//
// Keep bgSrc() in sync with this file — it mirrors the function in
// chat-backdrop.tsx (which is not importable here: it pulls React + the theme store).

function bgSrc(src: string): string {
  if (!src) return src;
  if (/^(https?:|blob:|data:|media:)/i.test(src)) return src;
  if (src.startsWith("/api/")) return src;
  if (src.startsWith("/")) return `/api/hx/files/stream?path=${encodeURIComponent(src)}`;
  return src;
}

let fails = 0;
function eq(actual: string, expected: string, label: string) {
  if (actual === expected) { console.log(`  ok   ${label}`); return; }
  fails++;
  console.log(`  FAIL ${label}\n         expected: ${expected}\n         actual:   ${actual}`);
}

// The exact value ThemePanel.upload stores for an uploaded video.
eq(
  bgSrc("/home/notjitin/chat-bgs/probe2.mp4"),
  "/api/hx/files/stream?path=%2Fhome%2Fnotjitin%2Fchat-bgs%2Fprobe2.mp4",
  "host filesystem path -> streaming route",
);

// Already-correct forms must pass through untouched.
eq(bgSrc("/api/hx/files/stream?path=/home/notjitin/chat-bgs/probe2.mp4"),
   "/api/hx/files/stream?path=/home/notjitin/chat-bgs/probe2.mp4",
   "existing stream url unchanged");
eq(bgSrc("https://cdn.example.com/a.mp4"), "https://cdn.example.com/a.mp4", "https unchanged");
eq(bgSrc("blob:http://127.0.0.1:3011/abc"), "blob:http://127.0.0.1:3011/abc", "blob unchanged");
eq(bgSrc("data:video/mp4;base64,AAA"), "data:video/mp4;base64,AAA", "data url unchanged");

// A relative (non-leading-slash) path is left alone: rewriting it would invent a
// route the proxy does not serve, and the SPA fallback returns index.html anyway.
eq(bgSrc("chat-bgs/probe2.mp4"), "chat-bgs/probe2.mp4", "relative path untouched");

// Regression shape of the original bug: the rewritten src must NOT be servable
// by the origin's static handler (i.e. it must carry the query, not be a bare path).
const rewritten = bgSrc("/home/notjitin/chat-bgs/probe2.mp4");
if (rewritten.startsWith("/home/")) { fails++; console.log("  FAIL rewritten src still looks like a static path"); }
else console.log("  ok   rewritten src no longer resolves as a static asset");

console.log(fails === 0 ? "\nPASS" : `\nFAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);