const SEP_RE = /^\s*\|?[\s:|-]+\|?\s*$/;
const PAIRS = ["**", "__", "~~", "`"];

/** Hold back the streaming tail so half-typed markers never flash as raw text.
 *  Only ever trims markers it proves are unmatched; caller passes full text when done. */
export function safeTail(s: string): string {
  // odd fence count: close it instead of trimming (code shows while streaming)
  if ((s.match(/```/g)?.length ?? 0) & 1) return s + (s.endsWith("\n") ? "" : "\n") + "```";

  const lines = s.split("\n");
  let start = lines.length;                                  // trailing contiguous |-rows
  while (start > 0 && lines[start - 1].trimStart().startsWith("|")) start--;
  const grp = lines.slice(start);
  if (grp.length && (grp.length < 2 || !SEP_RE.test(grp[1]))) lines.length = start; // header w/o separator
  else if (grp.length && !grp[grp.length - 1].trimEnd().endsWith("|")) lines.pop(); // partial row
  const out = lines.join("\n");

  const nl = out.lastIndexOf("\n");                           // inline pairs: last line only
  const head = out.slice(0, nl + 1);
  let tail = out.slice(nl + 1);
  for (const p of PAIRS) if ((tail.split(p).length - 1) & 1) tail = tail.slice(0, tail.lastIndexOf(p));
  tail = tail.replace(/\[[^\]]*\]\([^)]*$/, "").replace(/^#{1,6}\s*$/, "");
  return head + tail;
}
