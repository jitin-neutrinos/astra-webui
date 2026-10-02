
// a11y-pass.mjs — contrast-audit every palette x mode; auto-correct failing accents.
// WCAG: body text >= 4.5:1, large/UI >= 3:1. Corrects cyanx/violetx/fuchsiax/redx/emerald/amber
// in the failing mode by stepping lightness until contrast passes (preserving hue+sat).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../../src/theme-engine/palettes.json");
const data = JSON.parse(readFileSync(OUT, "utf8"));
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (rgb) => { const [r,g,b] = rgb.map(c => { c/=255; return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4; }); return 0.2126*r+0.7152*g+0.0722*b; };
const contrast = (a,b) => { const [l1,l2]=[lum(a),lum(b)].sort((x,y)=>y-x); return (l1+0.05)/(l2+0.05); };
const hsl = (hex) => { const [r,g,b]=hexRgb(hex).map(c=>c/255); const mx=Math.max(r,g,b),mn=Math.min(r,g,b); const l=(mx+mn)/2; const d=mx-mn; let h=0,s=d===0?0:d/(1-Math.abs(2*l-1)); if(d!==0){ if(mx===r)h=((g-b)/d)%6; else if(mx===g)h=(b-r)/d+2; else h=(r-g)/d+4; h*=60; if(h<0)h+=360;} return {h,s,l}; };
const hexOf = (h,s,l) => { const a=s*Math.min(l,1-l); const f=n=>{const k=(n+h/30)%12; const c=l-a*Math.max(-1,Math.min(k-3,9-k,1)); return Math.round(255*c).toString(16).padStart(2,"0");}; return `#${f(0)}${f(8)}${f(4)}`; };
const clampHex=(v)=>Math.max(0,Math.min(255,Math.round(v)));
function fixContrast(hex, bgHex, target) {
  let {h,s,l}=hsl(hex); const bgL=lum(hexRgb(bgHex));
  let out=hex, guard=0;
  while (contrast(hexRgb(out), hexRgb(bgHex)) < target && guard++ < 64) {
    l += bgL > 0.5 ? -0.02 : 0.02;              // light bg -> darken accent; dark bg -> lighten
    if (l<=0.02||l>=0.98) break;
    out = hexOf(h,s,l);
  }
  return out;
}
let fixed=0, checked=0;
const report=[];
for (const p of data.palettes) {
  for (const mode of ["dark","light"]) {
    const v=p.variants[mode];
    const voidC=hexRgb(v["--color-void"]), text=v["--color-brandtext"];
    checked++;
    const textC=contrast(hexRgb(text),voidC);
    if (textC<4.5) { const before=text; v["--color-brandtext"]=fixContrast(text, v["--color-void"], 4.5); fixed++;
      report.push(`${p.id}/${mode}: brandtext ${textC.toFixed(2)}->${contrast(hexRgb(v["--color-brandtext"]),voidC).toFixed(2)} (${before}->${v["--color-brandtext"]})`); }
    const mutedC=contrast(hexRgb(v["--color-muted"]),voidC);
    if (mutedC<4.5) { const before=v["--color-muted"]; v["--color-muted"]=fixContrast(v["--color-muted"], v["--color-void"], 4.5); fixed++;
      report.push(`${p.id}/${mode}: muted ${mutedC.toFixed(2)}->${contrast(hexRgb(v["--color-muted"]),voidC).toFixed(2)} (${before}->${v["--color-muted"]})`); }
    // light mode: worst-case slate utility (slate-500 = ink@55% over void) must stay >= 4.5
    if (mode==="light") {
      const inkRgb=hexRgb(v["--color-brandtext"]);
      const slate500=inkRgb.map((c,i)=>Math.round(c*0.55+hexRgb(v["--color-void"])[i]*0.45));
      const sc=contrast(slate500,voidC);
      if (sc<4.5) { v["--color-brandtext"]=fixContrast(v["--color-brandtext"], v["--color-void"], 5.2); fixed++;
        report.push(`${p.id}/${mode}: slate-ramp would fail (${sc.toFixed(2)}) -> brandtext deepened to ${v["--color-brandtext"]}`); }
    }
    // accents need 3:1 on void (UI) — deepen/lighten until pass
    for (const t of ["--color-cyanx","--color-violetx","--color-fuchsiax","--color-redx","--color-emerald","--color-amber"]) {
      if (!v[t]) continue;
      const c=contrast(hexRgb(v[t]),voidC);
      if (c<3) { const before=v[t]; v[t]=fixContrast(v[t], v["--color-void"], 3); fixed++;
        report.push(`${p.id}/${mode}: ${t} ${c.toFixed(2)}->${contrast(hexRgb(v[t]),voidC).toFixed(2)} (${before}->${v[t]})`); }
    }
  }
}
writeFileSync(OUT, JSON.stringify(data,null,1)+"\n");
console.log(`checked ${checked} palette-modes; fixed ${fixed} accents`);
console.log(report.join("\n")||"all text/ui contrast pass");
