// Compare two parity output dirs (computed styles exact; pixels via PIL).
//   node scripts/theme/parity/compare.mjs <baseDir> <candDir> [--allow-new]
// Exit 0 only when EVERY state has zero computed-style diffs and zero pixel diffs.
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { diffSnapshots } from "./capture.mjs";

const [A, B] = [resolve(process.argv[2]), resolve(process.argv[3])];
const files = (await readdir(A)).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
let totalStyle = 0, totalPx = 0, bad = 0;
const rows = [];
for (const f of files) {
  const name = f.replace(/\.json$/, "");
  let b;
  try { b = JSON.parse(await readFile(join(B, f), "utf8")); } catch { rows.push(`MISSING ${name} in candidate`); bad++; continue; }
  const a = JSON.parse(await readFile(join(A, f), "utf8"));
  const diffs = diffSnapshots(a.map, b.map);
  const py = spawnSync("python3", ["-c", `
import sys
from PIL import Image, ImageChops
a=Image.open(sys.argv[1]).convert('RGB'); b=Image.open(sys.argv[2]).convert('RGB')
if a.size!=b.size: print('SIZE',a.size,b.size); sys.exit(0)
d=ImageChops.difference(a,b); bb=d.getbbox()
if not bb: print('0 0 0 None'); sys.exit(0)
data=list(d.getdata()); px=sum(1 for p in data if p!=(0,0,0)); sig=sum(1 for p in data if max(p)>2); mx=max(max(p) for p in data)
print(px, mx, sig, bb)
`, join(A, name + ".png"), join(B, name + ".png")], { encoding: "utf8" });
  const pxOut = (py.stdout || py.stderr).trim();
  const parts = pxOut.split(" ");
  const px = pxOut.startsWith("SIZE") ? -1 : Number(parts[0]);
  const sig = pxOut.startsWith("SIZE") ? -1 : Number(parts[2]);   // pixels differing by >2/255 in any channel
  totalStyle += diffs.length; totalPx += sig > 0 ? sig : 0;
  const flag = diffs.length === 0 && sig === 0;
  if (!flag) bad++;
  rows.push(`${flag ? "SAME " : "DIFF "} ${name.padEnd(28)} styleDiffs=${String(diffs.length).padEnd(5)} pixels(strict,maxΔ,significant,bbox)=${pxOut}`);
  if (diffs.length) {
    const byProp = {};
    for (const d of diffs) (byProp[d.prop] ||= []).push(d);
    for (const [p, ds] of Object.entries(byProp).slice(0, 4)) rows.push(`       ${p}: x${ds.length}  e.g. [${ds[0].sel}]  ${ds[0].a.slice(0, 60)}  →  ${ds[0].b.slice(0, 60)}`);
  }
}
console.log(rows.join("\n"));
console.log(`\nstates=${files.length} badStates=${bad} totalStyleDiffs=${totalStyle} totalDiffPixels=${totalPx}`);
process.exit(bad ? 1 : 0);
