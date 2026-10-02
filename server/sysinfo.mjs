import { request } from "node:http";
import { readFileSync, statSync, readdirSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";

import { hermesCookieOrNull, clearHermesCookie } from "./hermes-proxy.mjs";

const execFileAsync = promisify(execFile);
const HERMES_URL = process.env.ASTRA_HERMES_URL || "http://127.0.0.1:9119";

const TTLCache = new Map();

export async function raceTimeout(ms, label, promiseFn) {
  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({ ok: false, error: new Error(`Timeout: ${label} exceeded ${ms}ms`) }), ms);
  });
  try {
    const result = await Promise.race([
      promiseFn().then(v => ({ ok: true, value: v })).catch(e => ({ ok: false, error: e })),
      timeoutPromise
    ]);
    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function classifyHttpStatus(code, errCode) {
  if (errCode === 'ECONNREFUSED') return 'unreachable';
  if (code >= 200 && code < 300) return 'healthy';
  if (code === 401 || code === 403) return 'auth-gated';
  if (code >= 500 && code < 600) return 'degraded';
  if (!code && errCode) return 'unreachable';
  return 'degraded';
}

export function classifySkill(skill, ageDays) {
  if (skill.enabled === false) return 'inactive';
  if (skill.usage === 0 || skill.usage === undefined) return 'unused';
  if (ageDays > 180) return 'outdated';
  return 'healthy';
}

export function classifyToolset(t) {
  if (!t.enabled) return 'disabled';
  if (t.enabled && !t.available) return 'inactive';
  if (t.enabled && t.available && !t.configured) return 'degraded';
  return 'healthy';
}

export function rankSkills(a, b) {
  const usageA = a.usage || 0;
  const usageB = b.usage || 0;
  if (usageA !== usageB) return usageB - usageA;
  return (a.name || '').localeCompare(b.name || '');
}

export function reconcileSkills(catalogList, diskList) {
  const map = new Map();
  for (const c of catalogList) {
    const key = c.name.toLowerCase();
    map.set(key, { ...c, in_catalog: true, on_disk: false });
  }
  for (const d of diskList) {
    const key = d.name.toLowerCase();
    const existing = map.get(key) || { name: d.name, in_catalog: false };
    map.set(key, { ...existing, ...d, on_disk: true });
  }
  const result = Array.from(map.values());
  const now = Date.now();
  for (const item of result) {
    if (item.mtimeMs) {
      item.age_days = (now - item.mtimeMs) / (1000 * 60 * 60 * 24);
    }
  }
  return result;
}

export function parseFlatYaml(content) {
  const lines = content.split('\n');
  const result = {};
  let currentBlock = '';
  
  for (let line of lines) {
    const commentIdx = line.indexOf('#');
    if (commentIdx !== -1) line = line.substring(0, commentIdx);
    if (!line.trim()) continue;
    
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    
    if (indent === 0 && line.trim().endsWith(':')) {
      currentBlock = line.slice(0, -1).trim() + '.';
      continue;
    }
    
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    
    const key = line.substring(0, colonIdx).trim();
    let val = line.substring(colonIdx + 1).trim();
    
    if (!val) {
      if (indent === 0) currentBlock = key + '.';
      continue;
    }
    
    const fullKey = (indent > 0 ? currentBlock : '') + key;
    
    if (val.startsWith('"') && val.endsWith('"')) {
      result[fullKey] = val.slice(1, -1);
    } else if (val.startsWith("'") && val.endsWith("'")) {
      result[fullKey] = val.slice(1, -1);
    } else if (val === 'true') {
      result[fullKey] = true;
    } else if (val === 'false') {
      result[fullKey] = false;
    } else if (!isNaN(Number(val)) && val !== '') {
      result[fullKey] = Number(val);
    } else {
      result[fullKey] = val;
    }
  }
  return result;
}

export function parseMemoryStore(content, budget, mtime) {
  const entries = content.split("§").map(s => s.trim()).filter(Boolean).length;
  const chars = content.length;
  const bytes = Buffer.byteLength(content, 'utf8');
  const usage_pct = (chars / budget) * 100;
  return {
    entries,
    chars,
    bytes,
    usage_pct,
    over_budget: chars > budget,
    mtime
  };
}

function doRequest(apiPath, cookie) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      const url = new URL(apiPath, HERMES_URL);
      req = request(url, { method: "GET", headers: cookie ? { Cookie: cookie } : {} }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ statusCode: res.statusCode, data: data });
          }
        });
      });
      req.on('error', (err) => reject(err));
      req.end();
    } catch(err) {
      if (req) req.destroy();
      reject(err);
    }
  });
}

async function fetchUpstream(apiPath) {
  try {
    let cookie = await hermesCookieOrNull();
    let res = await doRequest(apiPath, cookie);
    
    if (res.statusCode === 401) {
      clearHermesCookie();
      cookie = await hermesCookieOrNull();
      res = await doRequest(apiPath, cookie);
    }
    return res;
  } catch(err) {
    return { status: 'unreachable', reason: err.message || "connection error", statusCode: null };
  }
}

// Implement a deduplicator
const inFlight = new Map();
async function singleFlight(key, fn) {
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

// Basic http getter for loopback probes
function doHttp(url) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = request(url, { method: "GET" }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
          } catch(e) {
            resolve({ statusCode: res.statusCode, data });
          }
        });
      });
      req.on('error', err => reject(err));
      req.end();
    } catch (e) {
      if (req) req.destroy();
      reject(e);
    }
  });
}

function fetchHttp(url) {
  return doHttp(url).catch(err => ({ status: 'unreachable', reason: err.message || err.code, statusCode: err.code }));
}

async function fetchHttpRace(url, label) {
  const result = await raceTimeout(2500, label, () => fetchHttp(url));
  if (!result.ok) {
    return { status: "unreachable", reason: result.error.message };
  }
  const code = result.value.statusCode;
  const status = classifyHttpStatus(code, typeof code === 'string' ? code : null);
  return { status, ...result.value };
}

function scanSkillsDir(dir) {
  let list = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        try {
          const stats = statSync(join(dir, e.name, "SKILL.md"));
          list.push({ name: e.name, mtimeMs: stats.mtimeMs, category: 'Unknown' });
        } catch(err) {
          // Ignore
        }
      }
    }
  } catch (err) {}
  return list;
}

export async function handleSysinfo(req, res, path) {
  const cacheKey = path;
  if (TTLCache.has(cacheKey)) {
    const cached = TTLCache.get(cacheKey);
    if (Date.now() - cached.ts < 25000) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(cached.data));
    }
  }

  const result = await singleFlight(cacheKey, async () => {
    if (path === "/api/sysinfo/context") {
      const [headroom, tracker, tbeacon, laya, ollama] = await Promise.all([
        fetchHttpRace("http://127.0.0.1:8787/health", "headroom"),
        fetchHttpRace("http://127.0.0.1:8788/api/stats", "tracker"),
        fetchHttpRace("http://127.0.0.1:8789/api/status", "tbeacon"),
        fetchHttpRace("http://127.0.0.1:8015/health", "laya"),
        fetchHttpRace("http://127.0.0.1:11434/api/tags", "ollama")
      ]);

      let configLive = {}, ctxCache = { samples: [], count: 0 };
      try {
        const yamlStr = readFileSync(join(homedir(), ".hermes", "config.yaml"), 'utf8');
        const parsed = parseFlatYaml(yamlStr);
        for (const k of Object.keys(parsed)) {
          if (k.startsWith("compression.") || k === "prompt_caching.cache_ttl" || k === "streaming.enabled" || k === "agent.base_url" || k === "memory.provider") {
            configLive[k] = parsed[k];
          }
        }
      } catch (e) {}

      try {
        const yamlStr = readFileSync(join(homedir(), ".hermes", "context_length_cache.yaml"), 'utf8');
        const parsed = parseFlatYaml(yamlStr);
        let count = 0;
        for (const [k, v] of Object.entries(parsed)) {
          if (k.startsWith("context_lengths.")) {
            count++;
            if (ctxCache.samples.length < 5) ctxCache.samples.push({ key: k.replace('context_lengths.', ''), value: v });
          }
        }
        ctxCache.count = count;
      } catch (e) {}

      let router = { status: 'healthy', breaker: [] };
      try {
        const idx = JSON.parse(readFileSync(join(homedir(), ".tool-router", "index.json"), 'utf8'));
        router.stats = idx.stats;
        router.built_at = idx.built_at;
      } catch(e) {}
      try {
        const dmeta = JSON.parse(readFileSync(join(homedir(), ".tool-router", "index.dense.meta.json"), 'utf8'));
        router.dense_meta = dmeta;
      } catch(e) {}
      try {
        const c = JSON.parse(readFileSync(join(homedir(), ".tool-router", "config.json"), 'utf8'));
        router.config = {
          laya_rerank_timeout_s: c.laya_rerank?.timeout_s,
          mcp_hints_count: Object.keys(c.mcp_hints || {}).length
        };
      } catch(e) {}
      
      const breakers = ['laya', 'ollama', 'rewriter'];
      for (const b of breakers) {
        try {
          const st = statSync(join(homedir(), ".tool-router", `breaker-${b}.json`));
          const bs = JSON.parse(readFileSync(join(homedir(), ".tool-router", `breaker-${b}.json`), 'utf8'));
          router.breaker.push({ name: b, state: bs.state || 'open', age_s: (Date.now() - st.mtimeMs) / 1000 });
          if (bs.state !== 'closed') router.status = 'degraded';
        } catch(e) {}
      }

      let leanctx = { status: 'healthy' };
      const leanRes = await raceTimeout(3000, "leanctx", () => execFileAsync(join(homedir(), ".local/bin/leanctx"), ["bench", "list"]));
      if (leanRes.ok) {
        leanctx.version = "unknown"; 
        // Need to parse version?
      } else {
        const pipRes = await raceTimeout(3000, "pip show leanctx", () => execFileAsync("pip", ["show", "leanctx"]));
        if (pipRes.ok && pipRes.value.stdout) {
          const m = pipRes.value.stdout.match(/Version:\s+(.+)/);
          if (m) leanctx.version = m[1];
        } else {
          leanctx.status = 'degraded';
          leanctx.reason = "version probe inconclusive";
        }
      }

      const layaStatus = laya.statusCode === 401 ? 'auth-gated' : laya.status;
      if (layaStatus === 'auth-gated') laya.reason = 'service up, bearer-gated (laya-proxy on 8016 injects it for clients)';

      return {
        headroom, tracker, tbeacon, laya: { ...laya, status: layaStatus }, ollama,
        configLive, ctxCache, router, leanctx
      };
    }

    if (path === "/api/sysinfo/memory") {
      const memApi = await raceTimeout(2500, "memory", () => fetchUpstream("/api/memory"));
      let ov = { status: "unreachable" }, ovgate = { status: "unreachable" };
      const ovRes = await fetchHttpRace("http://127.0.0.1:1933/health", "ov");
      const ovgRes = await fetchHttpRace("http://127.0.0.1:1934/health", "ovgate");
      
      ov = ovRes;
      if (ovgRes.statusCode === 200 && ovgRes.data?.status === 'ok') ovgate = { status: 'healthy', data: ovgRes.data };
      else if (ovgRes.status === 'unreachable') ovgate = { status: 'unreachable', reason: ovgRes.reason };
      else ovgate = { status: 'degraded', reason: ovgRes.statusCode };

      let ollama = { status: "healthy" }; // From instructions ollama row is captioned
      let ovCli = { status: 'healthy' };
      try {
        const cliPath = join(homedir(), "Work/openviking/.venv/bin/ov");
        statSync(cliPath);
        const cliRes = await raceTimeout(3000, "ov cli", () => execFileAsync(cliPath, ["--version"]));
        if (cliRes.ok) ovCli.version = cliRes.value.stdout.trim();
        else ovCli.status = 'unreachable';
      } catch(e) {
        ovCli.status = 'unreachable';
      }

      let stores = [];
      const memDir = join(homedir(), ".hermes", "memories");
      for (const f of ['MEMORY.md', 'USER.md']) {
        try {
          const st = statSync(join(memDir, f));
          const content = readFileSync(join(memDir, f), 'utf8');
          const budget = f === 'MEMORY.md' ? 2200 : 1375;
          let s = parseMemoryStore(content, budget, st.mtimeMs);
          s.name = f;
          s.budget = budget;
          try {
            const lockSt = statSync(join(memDir, `.${f}.lock`));
            if (Date.now() - lockSt.mtimeMs < 60000) s.locked = true;
          } catch(e) {}
          stores.push(s);
        } catch(e) {}
      }

      let compSurv = {};
      try {
        const yamlStr = readFileSync(join(homedir(), ".hermes", "config.yaml"), 'utf8');
        const parsed = parseFlatYaml(yamlStr);
        for (const k of Object.keys(parsed)) {
          if (k.startsWith("compression.") || k === "prompt_caching.cache_ttl") compSurv[k] = parsed[k];
        }
      } catch (e) {}

      return {
        providers: memApi.ok ? memApi.value : { status: memApi.error?.message || 'error' },
        ov, ovgate, ovCli, ollama, stores, compSurv
      };
    }

    if (path === "/api/sysinfo/harness") {
      const [skillsApi, mcpApi, plugApi, toolsApi] = await Promise.all([
        raceTimeout(2500, "skills", () => fetchUpstream("/api/skills")),
        raceTimeout(2500, "mcp", () => fetchUpstream("/api/mcp/servers")),
        raceTimeout(2500, "plugins", () => fetchUpstream("/api/dashboard/plugins")),
        raceTimeout(2500, "toolsets", () => fetchUpstream("/api/tools/toolsets"))
      ]);
      
      const skillsDisk = scanSkillsDir(join(homedir(), ".hermes", "skills"));
      
      let skillsData = skillsApi.ok && skillsApi.value.data ? skillsApi.value.data : [];
      if (!Array.isArray(skillsData)) skillsData = [];
      const skills = reconcileSkills(skillsData, skillsDisk).map(s => ({
        ...s,
        status: classifySkill(s, s.age_days)
      })).sort(rankSkills);

      let pluginsDisk = [];
      try {
        const pdir = join(homedir(), ".hermes", "plugins");
        const entries = readdirSync(pdir, { withFileTypes: true });
        pluginsDisk = entries.filter(e => e.isDirectory()).map(e => e.name);
      } catch(e) {}
      
      let pluginsApiData = (plugApi.ok && plugApi.value.data) ? plugApi.value.data : [];
      if (!Array.isArray(pluginsApiData)) pluginsApiData = [];
      const pluginsAPI = pluginsApiData;

      let hooks = [];
      try {
        const hdir = join(homedir(), ".hermes", "hooks");
        const entries = readdirSync(hdir, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory()) {
            const st = statSync(join(hdir, e.name));
            const head = readFileSync(join(hdir, e.name), 'utf8').substring(0, 2048);
            let purpose = "unknown";
            const cMatch = head.match(/#\s*(.+)/);
            if (cMatch) purpose = cMatch[1];
            hooks.push({ name: e.name, path: join(hdir, e.name), mtime: st.mtimeMs, size_bytes: st.size, purpose });
          }
        }
      } catch(e) {}

      let runtimes = [];
      const bins = ['claude', 'opencode', 'agy', 'codex']; // antigravity -> agy handled
      for (const bin of bins) {
        const r = { name: bin, status: 'unreachable' };
        try {
          const res = await raceTimeout(3000, bin, () => execFileAsync(bin, ["--version"]));
          if (res.ok) {
            r.status = 'healthy';
            r.version = res.value.stdout.trim();
          } else if (res.error && res.error.code === 'ENOENT') {
            r.reason = 'not installed';
          } else {
            const res2 = await raceTimeout(3000, bin, () => execFileAsync(bin, ["-v"]));
            if (res2.ok) {
              r.status = 'healthy';
              r.version = res2.value.stdout.trim();
            } else {
              r.status = 'degraded';
              r.reason = 'present, version probe failed';
            }
          }
        } catch(e) {
          r.status = 'degraded';
          r.reason = 'present, version probe failed';
        }
        runtimes.push(r);
      }

      let userServices = [];
      try {
        const res = await execFileAsync("systemctl", ["--user", "list-units", "--type=service", "--no-legend"]);
        if (res.stdout) {
          const lines = res.stdout.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            const parts = line.trim().split(/\s+/);
            const name = parts[0];
            if (/^(headroom|laya|openviking|ovgate|hermes|astra|taal|graphify|penpot|neutrinos|ollama)/.test(name)) {
              userServices.push({ name, active: parts[3] === 'running' || parts[3] === 'active' });
            }
          }
          userServices.sort((a,b) => (a.active === b.active ? 0 : a.active ? 1 : -1));
        }
      } catch(e) {}
      
      let mcpData = (mcpApi.ok && mcpApi.value.data?.servers) ? mcpApi.value.data.servers : [];
      let toolsetsData = (toolsApi.ok && toolsApi.value.data) ? toolsApi.value.data : [];

      return {
        skills, mcpData, pluginsAPI, pluginsDisk, hooks, runtimes, userServices, toolsetsData
      };
    }

    return null;
  });

  if (result) {
    TTLCache.set(cacheKey, { ts: Date.now(), data: result });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  } else {
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"not found"}');
  }
}
