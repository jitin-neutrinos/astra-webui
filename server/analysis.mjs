// analysis.mjs — What a review actually changed, with evidence.
//
// The reviewer edits real files (skills, SOUL.md, project AGENTS.md). Its own
// "FILE: <path>" lines are a CLAIM; this module produces the PROOF by hashing
// the doc estate before and after the run and diffing it. Both are kept: the
// diff is truth, the claim shows what the agent believed it did.
//
// The estate is walked cheaply (mtime+size, no file reads) and limited to the
// files a reviewer may legitimately touch.
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME || "/home/notjitin";

// Directories whose contents count as "the documentation estate".
function estateRoots() {
  return [
    { kind: "skill", dir: join(HOME, ".hermes", "skills"), match: (n) => n === "SKILL.md" },
    { kind: "agent-doc", dir: join(HOME, ".hermes"), match: (n) => n === "SOUL.md", flat: true },
    { kind: "project-doc", dir: join(HOME, "Work", "projects"), match: (n) => n === "AGENTS.md" },
  ];
}

// Walk one root, bounded. Returns [[path, "mtime:size"], ...].
function walk(dir, match, flat, out, depth = 0) {
  if (depth > 6) return; // a runaway tree must not stall a review
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git" || e.name.startsWith(".")) continue;
      if (!flat) walk(full, match, flat, out, depth + 1);
    } else if (match(e.name)) {
      try {
        const st = statSync(full);
        out.set(full, `${st.mtimeMs}:${st.size}`);
      } catch { /* vanished mid-walk */ }
    }
  }
}

/** Full estate fingerprint: Map<absolutePath, "mtime:size">. */
export function estateSnapshot() {
  const out = new Map();
  for (const { dir, match, flat } of estateRoots()) {
    if (existsSync(dir)) walk(dir, match, flat, out);
  }
  return out;
}

/** Which kind of document a path is, for grouping in the UI. */
export function classifyPath(p) {
  if (p.includes("/.hermes/skills/")) return "skill";
  if (p.endsWith("/SOUL.md")) return "agent-doc";
  if (p.endsWith("/AGENTS.md")) return "project-doc";
  return "other";
}

/** A skill's name from its path (.../skills/<category>/<name>/SKILL.md). */
export function skillName(p) {
  const m = p.match(/\/skills\/(?:[^/]+\/)?([^/]+)\/SKILL\.md$/);
  return m ? m[1] : null;
}

/**
 * Diff two snapshots. A changed mtime OR size counts as an edit; a path only in
 * `after` was created; only in `before` was deleted. Each entry carries its
 * classification and (for skills) the skill name.
 */
export function diffEstate(before, after) {
  const created = [], edited = [], deleted = [];
  for (const [p, sig] of after) {
    const prev = before.get(p);
    if (prev === undefined) created.push(p);
    else if (prev !== sig) edited.push(p);
  }
  for (const p of before.keys()) if (!after.has(p)) deleted.push(p);
  const shape = (p) => ({
    path: p,
    kind: classifyPath(p),
    skill: skillName(p),
    name: p.split("/").slice(-2)[0] || p.split("/").pop(),
  });
  return {
    created: created.map(shape),
    edited: edited.map(shape),
    deleted: deleted.map(shape),
    total: created.length + edited.length + deleted.length,
  };
}

/**
 * The reviewer's own "FILE: <path>" declarations, parsed from its output.
 * "FILE: none" means it claims no changes. These are CLAIMS, not proof.
 */
export function parseFileClaims(log) {
  if (!log) return [];
  const claims = [];
  for (const line of String(log).split("\n")) {
    const m = line.match(/^\s*FILE:\s*(.+?)\s*$/);
    if (!m) continue;
    const v = m[1].trim();
    if (/^none\.?$/i.test(v)) continue;
    claims.push(v);
  }
  return [...new Set(claims)];
}

/** Compare the claim list against the measured diff. */
export function claimVsTruth(claims, diff) {
  const changed = new Set([...diff.created, ...diff.edited].map((c) => c.path));
  const claimed = claims.filter((c) => c.startsWith("/"));
  return {
    claimed: claimed.length,
    matched: claimed.filter((c) => changed.has(c)).length,
    // claimed but the estate shows no change — either a no-op edit or a false claim
    unverified: claimed.filter((c) => !changed.has(c)),
    // changed but never declared — real work the agent did not report
    undeclared: [...changed].filter((c) => !claimed.includes(c)),
  };
}
