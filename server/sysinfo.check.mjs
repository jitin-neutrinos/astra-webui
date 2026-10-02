import assert from "node:assert";
import { classifyHttpStatus, raceTimeout, classifySkill, classifyToolset, rankSkills, reconcileSkills, parseFlatYaml, parseMemoryStore } from "./sysinfo.mjs";

async function runChecks() {
  assert.strictEqual(classifyHttpStatus(200), 'healthy');
  assert.strictEqual(classifyHttpStatus(401), 'auth-gated');
  assert.strictEqual(classifyHttpStatus(403), 'auth-gated');
  assert.strictEqual(classifyHttpStatus(502), 'degraded');
  assert.strictEqual(classifyHttpStatus(null, 'ECONNREFUSED'), 'unreachable');

  const t0 = Date.now();
  const res = await raceTimeout(50, "test", () => new Promise(r => setTimeout(r, 10000)));
  const dt = Date.now() - t0;
  assert.strictEqual(res.ok, false);
  assert(dt < 150, `Timeout took ${dt}ms, expected < 150ms`);

  assert.strictEqual(classifySkill({ enabled: false }, 10), 'inactive');
  assert.strictEqual(classifySkill({ enabled: true, usage: 0 }, 10), 'unused');
  assert.strictEqual(classifySkill({ enabled: true, usage: undefined }, 10), 'unused');
  assert.strictEqual(classifySkill({ enabled: true, usage: 10 }, 180), 'healthy');
  assert.strictEqual(classifySkill({ enabled: true, usage: 10 }, 181), 'outdated');

  assert.strictEqual(rankSkills({ usage: 10, name: 'A' }, { usage: 10, name: 'B' }), -1);
  assert(rankSkills({ usage: 20 }, { usage: 10 }) < 0);
  
  const cat = [{ name: 'Test', usage: 5 }];
  const disk = [{ name: 'Test', mtimeMs: Date.now() - 86400000 }, { name: 'OnlyDisk', mtimeMs: Date.now() }];
  const rec = reconcileSkills(cat, disk);
  assert.strictEqual(rec.length, 2);
  const t = rec.find(x => x.name.toLowerCase() === 'test');
  assert.strictEqual(t.in_catalog, true);
  assert.strictEqual(t.on_disk, true);
  const od = rec.find(x => x.name.toLowerCase() === 'onlydisk');
  assert.strictEqual(od.in_catalog, false);
  assert.strictEqual(od.on_disk, true);

  const yaml = `
cache_ttl: "1h"
compression.enabled: true
number: 42
block:
  sub: false
`;
  const parsed = parseFlatYaml(yaml);
  assert.strictEqual(parsed['cache_ttl'], '1h');
  assert.strictEqual(parsed['compression.enabled'], true);
  assert.strictEqual(parsed['number'], 42);
  assert.strictEqual(parsed['block.sub'], false);

  const mem = "entry1\n§\nentry2\n§\nentry3";
  const budget = 10;
  const store = parseMemoryStore(mem, budget, 123);
  assert.strictEqual(store.entries, 3);
  assert.strictEqual(store.usage_pct, (mem.length / budget) * 100);
  assert.strictEqual(store.over_budget, true);
  assert.strictEqual(store.mtime, 123);
  
  const vocab = ['healthy', 'degraded', 'auth-gated', 'unreachable', 'disabled', 'inactive', 'unused', 'outdated'];
  const fixture = [
    classifyHttpStatus(200),
    classifyHttpStatus(401),
    classifyHttpStatus(500),
    classifyHttpStatus(null, 'ECONNREFUSED'),
    classifySkill({ enabled: false }, 0),
    classifySkill({ enabled: true, usage: 0 }, 0),
    classifySkill({ enabled: true, usage: 10 }, 185),
    classifyToolset({ enabled: false }),
  ];
  for (const v of fixture) {
    assert(vocab.includes(v), `Invalid vocab: ${v}`);
  }

  console.log("sysinfo.check: ALL PASS (classifier, timeout, ranking, reconcile, yaml, memory, vocab)");
  process.exit(0);
}

runChecks().catch(err => {
  console.error("FAIL", err);
  process.exit(1);
});
