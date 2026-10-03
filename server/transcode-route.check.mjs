// transcode-route.check: guards of the wired /api/media/transcode route (plan §8).
// Run: node server/transcode-route.check.mjs  → exit 0 = pass.
// 1) in-process guard branches via fake req/res; 2) full server wiring via spawned server.mjs.
import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

process.env.ASTRA_TRANSCODE_DIR = await mkdtemp(join(tmpdir(), "astra-tc-check-"));
const { handleTranscode } = await import("./transcode.mjs");

const validToken = (t) => t === "ok";
const HOME = homedir();

function fakeReq(url, cookie) {
  return { headers: { cookie: cookie ? `astra_session=${cookie}` : "" }, url, method: "GET" };
}
function fakeRes() {
  const r = { code: null, body: "", headersSent: false };
  r.writeHead = (code) => { r.code = code; r.headersSent = true; return r; };
  r.end = (b) => { r.body = String(b ?? ""); return r; };
  r.destroy = () => {};
  return r;
}
async function branch(req) {
  const res = fakeRes();
  await handleTranscode(req, res, validToken);
  return res.code;
}

// 1. guard branches
assert.equal(await branch(fakeReq(`/api/media/transcode?path=${encodeURIComponent(HOME + "/a.avi")}`, null)), 401, "no cookie → 401");
assert.equal(await branch(fakeReq(`/api/media/transcode?path=${encodeURIComponent("/etc/passwd.avi")}`, "ok")), 403, "outside roots → 403");
assert.equal(await branch(fakeReq(`/api/media/transcode?path=${encodeURIComponent(`${HOME}/no-such-${Date.now()}.avi`)}`, "ok")), 404, "missing file → 404");
assert.equal(await branch(fakeReq(`/api/media/transcode?path=${encodeURIComponent(`${HOME}/x.pdf`)}`, "ok")), 415, "non-media → 415 (kind before stat)");

// happy path: 1-frame blue BMP → jpeg
let ffmpegOk = true;
try { await new Promise((resolve, reject) => spawn("ffmpeg", ["-version"], { stdio: "ignore" }).on("error", reject).on("exit", (c) => (c === 0 ? resolve() : reject(new Error("exit " + c))))); }
catch { ffmpegOk = false; }
if (ffmpegOk) {
  const src = join(process.env.ASTRA_TRANSCODE_DIR, "t.bmp");
  await new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=16x16", "-frames:v", "1", src], { stdio: "ignore" });
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("ffmpeg exit " + c))));
    p.on("error", reject);
  });
  // stream-sink res: writeHead records headers, then collects piped bytes
  const chunks = [];
  const res = {
    code: null, headersObj: null, get headersSent() { return this.code != null; },
    writeHead(code, hdrs) { this.code = code; this.headersObj = hdrs || {}; return this; },
    write(c) { chunks.push(Buffer.from(c)); return true; },
    end(b) { if (b) chunks.push(Buffer.from(b)); this.ended = true; return this; },
    setHeader() { return this; }, destroy() {},
    on() { return this; }, once() { return this; }, emit() { return false; },
  };
  await new Promise((resolve, reject) => {
    handleTranscode(fakeReq(`/api/media/transcode?path=${encodeURIComponent(src)}`, "ok"), res, validToken)
      .then((r) => {
        if (r && typeof r.on === "function" && r !== res) r.on("finish", resolve).on("close", resolve).on("error", reject);
        else resolve();
      }, reject);
  });
  await new Promise((r) => setTimeout(r, 250)); // pipe flushes async — let bytes land in the sink
  assert.equal(res.code, 200, "transcode happy path → 200");
  assert.equal(res.headersObj?.["content-type"], "image/jpeg", "content-type image/jpeg");
  assert.ok(Buffer.concat(chunks).length > 0, "jpeg bytes streamed");
} else {
  console.log("SKIP: ffmpeg missing — happy-path branch not exercised");
}

// 2. wiring: spawn the real server with an explicit env.
// Base port 3917 + the per-worker-slot offset (see scripts/run-checks.mjs).
// The offset is what stops this colliding with a concurrent instance — the
// regression gate re-runs this check with spawnSync while the pool still has
// one running, and two servers on one port makes the health poll below talk to
// the wrong process and reports a phantom failure.
const PORT = String(3917 + (Number(process.env.ASTRA_CHECK_PORT_OFFSET) || 0));
const SECRET = "check-secret";
const HERE = new URL(".", import.meta.url).pathname.replace(/\/$/, ""); // …/server
const child = spawn(process.execPath, [join(HERE, "server.mjs")], {
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ASTRA_WEBUI_PORT: PORT,
    ASTRA_WEBUI_PASSWORD: "x",
    ASTRA_HERMES_PASSWORD: "x",
    ASTRA_WEBUI_SECRET: SECRET,
    ASTRA_TRANSCODE_DIR: process.env.ASTRA_TRANSCODE_DIR,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let childErr = "";
child.stderr.on("data", (d) => { childErr += d; });
child.stdout.on("data", (d) => { childErr += d; });
try {
  // poll /api/health ≤5s
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (r.status === 200) up = true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(up, `server came up on :3917 (child output: ${childErr.slice(0, 400) || "none"})`);

  const noAuth = await fetch(`http://127.0.0.1:${PORT}/api/media/transcode?path=${encodeURIComponent("/x.avi")}`);
  assert.equal(noAuth.status, 401, `unwired would 404; got ${noAuth.status}`);
  assert.equal((await noAuth.text()).includes("unauthenticated"), true, "401 body names unauthenticated");

  const exp = String(Date.now() + 60000);
  const sig = createHmac("sha256", SECRET).update(exp).digest("base64url");
  const withAuth = await fetch(`http://127.0.0.1:${PORT}/api/media/transcode?path=${encodeURIComponent(HOME + "/x.pdf")}`, {
    headers: { cookie: `astra_session=${exp}.${sig}` },
  });
  assert.equal(withAuth.status, 415, `cookie'd non-media → 415; got ${withAuth.status}`);
} finally {
  child.kill("SIGKILL");
}

console.log("transcode-route.check: all assertions passed");
