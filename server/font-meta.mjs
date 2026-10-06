
// Zero-dep font metadata reader: woff2 / woff / ttf / otf -> family name + fvar axes.
// Node stdlib only (node:zlib brotli + inflate).
import { readFileSync } from "node:fs";
import zlib from "node:zlib";

const TAGS = ["cmap","head","hhea","hmtx","maxp","name","OS/2","post","cvt ","fpgm","glyf","loca","prep","CFF ","VORG","EBDT","EBLC","gasp","hdmx","kern","LTSH","PCLT","VDMX","vhea","vmtx","BASE","GDEF","GPOS","GSUB","EBSC","JSTF","MATH","CBDT","CBLC","COLR","CPAL","SVG ","sbix","acnt","avar","bdat","bloc","bsln","cvar","fdsc","feat","fmtx","fvar","gvar","hsty","just","lcar","mort","morx","opbd","prop","trak","Zapf","Silf","Glat","Gloc","Feat","Sill"];
const NAME_IDS = { 1: "family", 2: "subfamily", 4: "fullName", 6: "postScriptName", 16: "typoFamily", 17: "typoSubfamily" };

function readU128(buf, pos) {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    const x = buf[pos.i++];
    if (x === undefined) throw new Error("truncated UIntBase128");
    if (i === 0 && x === 0x80) throw new Error("reserved UIntBase128 value");
    v = (v << 7) | (x & 0x7f);
    if (!(x & 0x80)) return v >>> 0;
  }
  throw new Error("UIntBase128 too long");
}
const pad4 = (n) => (n + 3) & ~3;

export function readFontMeta(buf) {
  const sig = buf.toString("latin1", 0, 4);
  let flavor, tables;

  if (sig === "wOF2") {
    flavor = buf.readUInt32BE(4);
    const numTables = buf.readUInt16BE(12);
    const pos = { i: 48 };
    const ents = [];
    for (let i = 0; i < numTables; i++) {
      const flags = buf[pos.i++];
      const idx = flags & 0x3f;
      const tv = (flags & 0xc0) >> 6;
      let tag = idx === 0x3f ? buf.toString("latin1", pos.i, pos.i + 4) : TAGS[idx];
      if (idx === 0x3f) pos.i += 4;
      const origLength = readU128(buf, pos);
      // Spec: glyf AND loca with transformVersion 0 both carry a transformLength.
      const transformLength = (idx === 10 || idx === 11) && tv === 0 ? readU128(buf, pos) : null;
      ents.push({ tag, origLength, tv, transformLength });
    }
    const comp = zlib.brotliDecompressSync(buf.subarray(pos.i));
    tables = [];
    let o = 0;
    for (const e of ents) {
      const consumed = e.transformLength ?? e.origLength;
      tables.push([e.tag, comp.subarray(o, o + e.origLength)]);
      // NO 4-byte padding between WOFF2 tables: transformed tables (glyf/loca)
      // are laid out back to back. Verified — padding yields garbage name IDs.
      o = o + consumed;
    }
  } else if (sig === "wOFF") {
    flavor = buf.readUInt32BE(4);
    const numTables = buf.readUInt16BE(12);
    tables = [];
    for (let i = 0, o = 44; i < numTables; i++, o += 20) {
      const tag = buf.toString("latin1", o, o + 4);
      const off = buf.readUInt32BE(o + 4), compLen = buf.readUInt32BE(o + 8);
      const chunk = buf.subarray(off, off + compLen);
      // WOFF stores each table zlib-compressed EXCEPT when compLen === origLen,
      // in which case the table is stored raw (uncompressed) per the spec.
      const raw = compLen < buf.readUInt32BE(o + 12) ? zlib.inflateSync(chunk) : chunk;
      tables.push([tag, raw]);
    }
  } else if (sig === "OTTO" || buf.readUInt32BE(0) === 0x00010000 || sig === "true") {
    flavor = buf.readUInt32BE(0);
    const numTables = buf.readUInt16BE(4);
    tables = [];
    for (let i = 0, o = 12; i < numTables; i++, o += 16) {
      const tag = buf.toString("latin1", o, o + 4);
      const to = buf.readUInt32BE(o + 8), tl = buf.readUInt32BE(o + 12);
      tables.push([tag, buf.subarray(to, to + tl)]);
    }
  } else {
    throw new Error("unsupported font container: " + JSON.stringify(sig));
  }

  const byTag = new Map(tables);
  const out = { variable: false, axes: [] };
  const name = byTag.get("name");
  if (name && name.length > 6) {
    const count = name.readUInt16BE(2), strOff = name.readUInt16BE(4);
    for (let i = 0; i < count; i++) {
      const r = 6 + i * 12;
      if (r + 12 > name.length) break;
      const pid = name.readUInt16BE(r), lid = name.readUInt16BE(r + 4);
      const nid = name.readUInt16BE(r + 6), ln = name.readUInt16BE(r + 8), o = name.readUInt16BE(r + 10);
      const key = NAME_IDS[nid];
      if (!key || key in out) continue;
      if (lid !== 0x409 && lid !== 0) continue;
      const raw = name.subarray(strOff + o, strOff + o + ln);
      let s;
      if (pid === 3) { const sw = Buffer.from(raw); sw.swap16(); s = sw.toString("utf16le"); }
      else if (pid === 0) s = raw.toString("utf16le");
      else s = raw.toString("latin1");
      out[key] = s;
    }
  }
  const fvar = byTag.get("fvar");
  if (fvar && fvar.length > 12) {
    out.variable = true;
    const axesOff = fvar.readUInt16BE(4), axisCount = fvar.readUInt16BE(8), axisSize = fvar.readUInt16BE(10);
    for (let i = 0; i < axisCount; i++) {
      const o = axesOff + i * axisSize;
      if (o + 16 > fvar.length) break;
      out.axes.push({
        tag: fvar.toString("latin1", o, o + 4),
        min: fvar.readInt32BE(o + 4) / 65536,
        def: fvar.readInt32BE(o + 8) / 65536,
        max: fvar.readInt32BE(o + 12) / 65536,
      });
    }
  }
  out.flavor = flavor === 0x00010000 ? "truetype" : flavor === 0x4f54544f ? "cff" : "0x" + flavor.toString(16);
  out.format = sig;
  return out;
}

if (process.argv[2]) {
  for (const f of process.argv.slice(2)) {
    const buf = readFileSync(f);
    try { console.log(f, JSON.stringify(readFontMeta(buf))); }
    catch (e) { console.log(f, "ERR", e.message); }
  }
}
