// Assert-based check for stick-to-bottom scroll-intent detection.
//   npx tsx src/lib/scroll-intent.check.ts
//
// Why this exists: `setAtBottom(gap < 80)` cannot distinguish "the reader
// scrolled up" from "the transcript grew under a pinned reader". During a
// streamed answer the second happens constantly, so a single stale reading
// latched atBottom=false and the view froze mid-answer while text kept
// arriving below the fold (measured: gap ran 0 -> 392px and never recovered).
// The rule below only unsticks on evidence of a real upward scroll.

const NEAR_EDGE = 80;

type ScrollState = { atBottom: boolean; lastTop: number };

/** The exact rule implemented in chat-landing.tsx's onScroll. */
export function onScrollIntent(
  s: ScrollState,
  m: { scrollTop: number; scrollHeight: number; clientHeight: number },
): ScrollState {
  const gap = m.scrollHeight - m.scrollTop - m.clientHeight;
  const prevTop = s.lastTop;
  const lastTop = m.scrollTop;
  if (gap < NEAR_EDGE) return { atBottom: true, lastTop };
  if (m.scrollTop < prevTop - 1) return { atBottom: false, lastTop };
  return { atBottom: s.atBottom, lastTop };
}

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.error(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
}

console.log("stick-to-bottom scroll intent");

// 1. The regression this fixes: content grows under a pinned reader.
{
  // Pinned at the edge of a 444px viewport, then the answer streams in.
  let s: ScrollState = { atBottom: true, lastTop: 1000 };
  // Growth WITHOUT the pin having landed yet: scrollHeight jumps, top is stale.
  for (const h of [1500, 1700, 1900, 2100]) {
    s = onScrollIntent(s, { scrollTop: 1000, scrollHeight: h, clientHeight: 444 });
  }
  check("growth under a pinned reader keeps it stuck", s.atBottom === true, s);
}

// 2. A real upward scroll DOES unstick.
{
  let s: ScrollState = { atBottom: true, lastTop: 2000 };
  s = onScrollIntent(s, { scrollTop: 1200, scrollHeight: 2500, clientHeight: 444 });
  check("reader scrolling up unsticks", s.atBottom === false, s);
}

// 3. Scrolling back to the edge re-sticks.
{
  let s: ScrollState = { atBottom: false, lastTop: 1200 };
  s = onScrollIntent(s, { scrollTop: 2056, scrollHeight: 2500, clientHeight: 444 });
  check("returning to the live edge re-sticks", s.atBottom === true, s);
}

// 4. Once unstuck, further growth must NOT silently re-stick the reader.
{
  let s: ScrollState = { atBottom: true, lastTop: 2000 };
  s = onScrollIntent(s, { scrollTop: 1000, scrollHeight: 2500, clientHeight: 444 });
  check("unstuck after scrolling up", s.atBottom === false, s);
  for (const h of [3000, 3500, 4000]) {
    s = onScrollIntent(s, { scrollTop: 1000, scrollHeight: h, clientHeight: 444 });
  }
  check("stays unstuck while reading history", s.atBottom === false, s);
}

// 5. Sub-pixel jitter is not an upward scroll (the -1 tolerance).
{
  let s: ScrollState = { atBottom: true, lastTop: 2000 };
  s = onScrollIntent(s, { scrollTop: 1999.6, scrollHeight: 3000, clientHeight: 444 });
  check("sub-pixel jitter does not unstick", s.atBottom === true, s);
}

// 6. A full jump-to-latest lands inside the near-edge band.
{
  let s: ScrollState = { atBottom: false, lastTop: 0 };
  const scrollHeight = 4593, clientHeight = 444;
  s = onScrollIntent(s, { scrollTop: scrollHeight - clientHeight, scrollHeight, clientHeight });
  check("jump-to-latest re-sticks", s.atBottom === true, s);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures !== 0) throw new Error(`${failures} check failure(s)`);
