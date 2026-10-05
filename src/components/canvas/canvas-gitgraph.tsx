// canvas-gitgraph.tsx — the `gitgraph` block renderer, hand-rolled SVG.
//
// WHY HAND-ROLLED (measured 2026-10-05): both candidate libraries are
// deprecated/archived (@mermaid-js/mermaid, gitgraph.js), and mermaid measured
// 5253 kB raw / 1490 kB gz — 5.3x the entire main chunk — for a feature that is
// ~60 lines of geometry. What a library would buy is a text DSL; this block
// deliberately keeps structured JSON, which is the entire point of the canvas.
//
// LAYOUT RULES (the geometry a git graph actually needs):
//   • one LANE per branch, lane index = branch index; a commit with no `branch`
//     joins the lane of its first parent, so an unlabelled row inherits its
//     history's column instead of landing in lane 0 and drawing a bogus fork.
//   • rows are NEWEST FIRST (the array order) — git log order, so row 0 is HEAD.
//   • a straight rail runs down a lane between two consecutive commits; a BEZIER
//     arcs from the commit's lane to its parent's lane when they differ. That arc
//     is what a fork and a merge look like, so the graph needs no legend to read.
//   • a merge commit is a HOLLOW node; both its parents' lanes converge on it.
//   • the branch whose `head` is the topmost commit gets the HEAD marker.
//
// COLOUR LAW: every colour is a theme role (var(--color-accent) / emerald /
// amber / fuchsiax) or a muted chrome ink, declared in index.css as .ast-cv-git-*
// classes — ZERO hex in this file, so all 9 palettes and both modes apply and a
// palette switch retints live. Lane identity is HUE, which is the one thing a
// git graph cannot do without: the four tier colours are adjacent by design and
// the graph is unreadable without telling lane 1 from lane 2.
//
// Owner law 3 — NO coloured edge rails here: a fork/merge link is chrome, not
// data, so it draws in muted ink and never competes with the lane it connects.
import { useMemo } from "react";
import type { GitGraphBlock } from "../../lib/canvas-schema";

const ROW_H = 22;
const LANE_W = 16;
const PAD_X = 8;
const PAD_Y = 10;
/** How far a fork's arc bulges, as a fraction of the lane gap. */
const BULGE = 0.55;

// Lane hues: the four theme tiers, cycling. `.l0…l3` live in index.css.
const LANE_CLASS = ["l0", "l1", "l2", "l3"];
const laneClass = (i: number) => LANE_CLASS[i % LANE_CLASS.length];

interface Placed {
  id: string;
  lane: number;
  row: number;
  branch?: string;
  message: string;
  author?: string;
  when?: string;
  merge?: boolean;
  tags?: string[];
  parents?: string[];
  /** Lane indices this commit's links come FROM (its children) or go TO. */
  arcs: { toLane: number; row: number; fromLane: number }[];
}

export function GitGraphView({ block }: { block: GitGraphBlock }) {
  const { rows, lanes, height, width, labelX } = useMemo(() => layout(block), [block]);

  if (rows.length === 0) {
    return (
      <div className="ast-cv-table-empty" role="status">
        No commits — this gitgraph arrived with an empty history.
      </div>
    );
  }

  const headRow = headCommitRow(block);
  const laneCount = Math.max(1, lanes.length);
  const railX = (lane: number) => PAD_X + lane * LANE_W;
  const labelW = labelX;

  return (
    <figure className="ast-cv-git">
      {block.title && <figcaption className="ast-cv-chart-title">{block.title}</figcaption>}
      {/* `role="img"` + a real text alternative: the SVG is the drawing, but the
          history it draws is content a screen reader must still get. The <desc>
          carries the same rows the label column shows. */}
      <svg
        className="ast-cv-git-svg"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`Commit history, ${rows.length} commits on ${laneCount} branches`}
      >
        <desc>{rows.map((r) => `${r.id}: ${r.message}`).join("; ")}</desc>
        {lanes.map((lane, i) => (
          <text key={lane} className="ast-cv-git-tag" x={railX(i)} y={PAD_Y - 2} textAnchor="middle">
            {truncLane(lane)}
          </text>
        ))}
        {/* Links FIRST so the node circles paint over the rail joins. */}
        {rows.flatMap((r) =>
          r.arcs.map((a, k) => (
            <path
              key={`${r.id}-arc-${k}`}
              className="ast-cv-git-link"
              d={
                a.fromLane === a.toLane
                  ? `M ${railX(a.fromLane)} ${rowY(a.row)} V ${rowY(r.row)}`
                  : bezier(railX(a.fromLane), rowY(a.row), railX(a.toLane), rowY(r.row))
              }
            />
          )),
        )}
        {/* A same-lane rail is a straight line; a lane's colour rides .l0…l3. */}
        {rows.flatMap((r) =>
          r.arcs
            .filter((a) => a.fromLane === a.toLane)
            .map((a, k) => (
              <path
                key={`${r.id}-rail-${k}`}
                className={`ast-cv-git-lane ${laneClass(a.fromLane)}`}
                d={`M ${railX(a.fromLane)} ${rowY(a.row)} V ${rowY(r.row)}`}
              />
            )),
        )}
        {rows.map((r) => (
          <g key={r.id}>
            <circle
              className={`ast-cv-git-node ${laneClass(r.lane)}${r.merge ? " merge" : ""}`}
              cx={railX(r.lane)}
              cy={rowY(r.row)}
              r={r.merge ? 4 : 3.4}
            />
            <text className="ast-cv-git-msg" x={labelX} y={rowY(r.row) + 3.5}>
              {r.id}
              {r.merge ? " ⑃" : ""}
              {r.tags && r.tags.length > 0 ? ` ${r.tags.join(" ")}` : ""} {r.message}
            </text>
            {(r.author || r.when) && (
              <text className="ast-cv-git-meta" x={labelX + labelW} y={rowY(r.row) + 3.5}>
                {[r.author, r.when].filter(Boolean).join(" · ")}
              </text>
            )}
          </g>
        ))}
        {headRow >= 0 && (
          <text className="ast-cv-git-head-label" x={railX(0) - 8} y={rowY(headRow) + 3.5} textAnchor="end">
            HEAD
          </text>
        )}
      </svg>
    </figure>
  );
}

function rowY(row: number): number {
  return PAD_Y + row * ROW_H + ROW_H / 2;
}

function truncLane(s: string): string {
  return s.length > 8 ? s.slice(0, 8) : s;
}

/** A cubic arc between two lanes, bulging downward (towards the older commit). */
function bezier(x0: number, y0: number, x1: number, y1: number): string {
  const mid = y0 + (y1 - y0) * BULGE;
  return `M ${x0} ${y0} C ${x0} ${mid}, ${x1} ${mid}, ${x1} ${y1}`;
}

/**
 * The row that carries the HEAD marker: the branch whose declared `head` matches
 * the topmost commit of that branch, else row 0 (the newest commit overall — git
 * log order puts HEAD first when the agent lists it that way).
 */
function headCommitRow(block: GitGraphBlock): number {
  if (!block.commits.length) return -1;
  const byBranch = new Map<string, number>();
  block.commits.forEach((c, i) => { if (c.branch && !byBranch.has(c.branch)) byBranch.set(c.branch, i); });
  for (const br of block.branches ?? []) {
    const r = br.head ? block.commits.findIndex((c) => c.id === br.head) : byBranch.get(br.name) ?? -1;
    if (r >= 0) return r;
  }
  return 0;
}

/**
 * Assign lanes and build the geometry. PURE: the same commits always produce the
 * same picture, which is what makes a git graph auditable in a test instead of
 * only in the eye.
 *
 * Lane assignment, in order:
 *   1. declared `branches` claim lanes 0..n-1 (declaration order is lane order);
 *   2. a commit with a `branch` takes that branch's lane, or a NEW lane if the
 *      branch was never declared (a branch the card forgot to list still gets its
 *      own column rather than being merged into main);
 *   3. a commit with no `branch` inherits its FIRST parent's lane — this is the
 *      rule that makes an unlabelled fork read as a continuation.
 */
function layout(block: GitGraphBlock) {
  const commits = block.commits;
  const laneOf = new Map<string, number>();
  const lanes: string[] = [];
  const laneFor = (name: string): number => {
    if (!laneOf.has(name)) { laneOf.set(name, lanes.length); lanes.push(name); }
    return laneOf.get(name)!;
  };
  for (const br of block.branches ?? []) laneFor(br.name);

  const rowLane: number[] = [];
  commits.forEach((c, i) => {
    if (c.branch) { rowLane[i] = laneFor(c.branch); return; }
    const firstParent = (c.parents ?? []).find((p) => commits.findIndex((o) => o.id === p) >= 0);
    const pr = firstParent ? commits.findIndex((o) => o.id === firstParent) : -1;
    rowLane[i] = pr >= 0 ? rowLane[pr] : lanes.length > 0 ? laneOf.get(lanes[0]) ?? 0 : laneFor("main");
  });

  const index = new Map(commits.map((c, i) => [c.id, i]));
  const rows: Placed[] = commits.map((c, i) => ({ ...c, lane: rowLane[i], row: i, arcs: [] }));

  // One arc per parent, skipping a parent on the SAME lane (that is a rail, drawn
  // in the lane's own colour) and skipping an unknown parent id (a dangling ref
  // draws nothing rather than a line to lane 0).
  rows.forEach((r, i) => {
    for (const p of r.parents ?? []) {
      const pi = index.get(p);
      if (pi === undefined || pi === i) continue;
      r.arcs.push({ fromLane: rowLane[pi], toLane: r.lane, row: pi });
    }
  });

  const labelX = PAD_X + Math.max(1, lanes.length) * LANE_W + 14;
  const widest = rows.reduce((w, r) => Math.max(w, r.message.length + r.id.length + 6), 0);
  const metaW = rows.reduce((w, r) => Math.max(w, (r.author && r.when ? `${r.author} · ${r.when}`.length : 0)), 0);
  const labelW = Math.min(340, Math.max(120, widest * 6.1));
  const width = labelX + labelW + 12 + metaW * 5.6 + PAD_X;
  return { rows, lanes, labelX, labelW, width: Math.round(width), height: PAD_Y * 2 + rows.length * ROW_H };
}
