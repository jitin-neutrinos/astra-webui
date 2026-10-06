export interface SeqActor { id: string; label: string; kind?: string }
export interface SeqMessage { from: string; to: string; label?: string; kind?: string; at?: string }

export function layoutSequence(actors: SeqActor[], messages: SeqMessage[], opts: { colWidth?: number; rowHeight?: number; headerHeight?: number } = {}) {
  const colWidth = opts.colWidth || 160;
  const rowHeight = opts.rowHeight || 50;
  const headerHeight = opts.headerHeight || 60;
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
    col: i
  }));

  const msgEdges = validMessages.map((m, i) => {
    const fromIndex = laneMap.get(m.from)!;
    const toIndex = laneMap.get(m.to)!;
    const y = headerHeight + (i + 0.5) * rowHeight;
    const x1 = colWidth / 2 + fromIndex * colWidth;
    const x2 = colWidth / 2 + toIndex * colWidth;
    return {
      ...m,
      x1, y, x2,
      fromIndex, toIndex,
      isSelf: fromIndex === toIndex
    };
  });

  return { bounds, actors: actorNodes, messages: msgEdges, colWidth, rowHeight, headerHeight };
}
