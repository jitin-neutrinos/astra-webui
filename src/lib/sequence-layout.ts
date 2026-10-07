export interface SeqActor { id: string; label: string; kind?: string }
export interface SeqMessage { from: string; to: string; label?: string; kind?: string; at?: string }

/**
 * Adaptive sequence layout.
 *
 * Owner report 2026-10-07: an 8-actor sequence rendered 1280px-wide inside a
 * ~700px chat card (svg minWidth forced an x-scroll), long message labels
 * overlapped neighbouring lanes (no wrap), and the fixed 100px actor head
 * boxes clipped every label wider than ~14 characters.
 *
 * Fixes, all in layout (the renderer reads only these numbers):
 *  - colWidth is DERIVED from the widest actor label (approx 6.2px/char at
 *    fontSize 11 semibold + padding), clamped to [110, 220]. Short actor
 *    names now fit their head box; long ones widen the lane instead of
 *    spilling out of it.
 *  - every message label is pre-wrapped into lines that fit its DRAWN
 *    segment (|x2-x1|, at least 120px), max 3 lines with an ellipsis tail.
 *    The renderer stacks lines from m.y upward, so wrapped labels no
 *    longer collide with the arrow or the neighbouring lane.
 *  - a message whose wrapped label needs more vertical room than one row
 *    widens ONLY its own slot (rowMulti), so wrapping costs vertical room,
 *    never horizontal collision.
 */
export function layoutSequence(actors: SeqActor[], messages: SeqMessage[], opts: { colWidth?: number; rowHeight?: number; headerHeight?: number } = {}) {
  const rowHeight = opts.rowHeight || 50;
  const headerHeight = opts.headerHeight || 60;

  // --- adaptive lane width: the widest actor label decides -------------------
  const labelW = (s: string) => Math.ceil((s || "").length * 6.2);
  const widest = actors.reduce((w, a) => Math.max(w, labelW(a.label)), 0);
  const colWidth = opts.colWidth ?? Math.min(220, Math.max(110, widest + 24));

  const laneMap = new Map<string, number>();
  actors.forEach((a, i) => laneMap.set(a.id, i));

  const validMessages = messages.filter(m => laneMap.has(m.from) && laneMap.has(m.to));

  const bounds = {
    w: Math.max(actors.length * colWidth, 100),
    h: headerHeight + validMessages.length * rowHeight + 40
  };

  const actorNodes = actors.map((a, i) => ({
    ...a,
    x: colWidth / 2 + i * colWidth,
    y: headerHeight / 2,
    col: i,
    // head box sized to the widest label, never smaller than 72px, never larger than the lane
    headW: Math.min(colWidth - 8, Math.max(72, widest + 18)),
  }));

  // --- label wrapping against the DRAWN segment -------------------------------
  const approx = (s: string) => s.length * 5.6; // fontSize 11 regular ≈ 5.6px/char avg

  const wrap = (text: string, seg: number): string[] => {
    const t = (text || "").trim();
    if (!t) return [];
    const maxPx = Math.max(120, Math.abs(seg) - 18); // drawable px per text line
    if (approx(t) <= maxPx) return [t];
    const words = t.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      if (lines.length === 3) break;           // cap: 3 lines, then ellipsis
      const cand = cur ? cur + " " + w : w;
      if (approx(cand) <= maxPx || !cur) cur = cand;
      else { lines.push(cur); cur = w; }
    }
    if (lines.length < 3 && cur) lines.push(cur);
    const consumed = lines.join(" ").length;
    if (lines.length === 3 && consumed < t.length) lines[2] = lines[2] + "…";
    return lines;
  };

  const msgEdges = validMessages.map((m) => {
    const fromIndex = laneMap.get(m.from)!;
    const toIndex = laneMap.get(m.to)!;
    const x1 = colWidth / 2 + fromIndex * colWidth;
    const x2 = colWidth / 2 + toIndex * colWidth;
    const lines = wrap(m.label || "", x2 - x1);
    return {
      ...m,
      x1, x2,
      fromIndex, toIndex,
      isSelf: fromIndex === toIndex,
      lines,
      h: 0 as number,   // filled below
      y: 0 as number,   // filled below
    };
  });

  // lazily add missing y once we know per-message heights
  let yCursor = headerHeight;
  for (const e of msgEdges) {
    e.h = Math.max(rowHeight, e.lines.length * 13 + 16);
    e.y = yCursor + e.h / 2;
    yCursor += e.h;
  }
  const totalH = yCursor + 40;
  if (totalH > bounds.h) bounds.h = totalH;

  return { bounds, actors: actorNodes, messages: msgEdges, colWidth, rowHeight, headerHeight };
}
