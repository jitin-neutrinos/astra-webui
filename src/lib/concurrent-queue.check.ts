// Assert-based check: TRUE CONCURRENT CHATS — per-tab durable prompt queue.
//   npx tsx src/lib/concurrent-queue.check.ts
//
// Why: the offline/queued prompt list lived in ONE shared localStorage key, so
// tab A's queued prompt could flush into tab B's freshly minted chat after a
// reconnect (queue read at store init is per-ORIGIN). The queue now lives in
// sessionStorage (per-TAB by browser design, survives reloads), with a one-time
// legacy migration from the shared key — adopted only when this tab has no
// queue yet, and the legacy key is deleted so two tabs can never split one list.
//
// Mirrors loadQueue/saveQueue in ws-store.ts. If you change the storage rules
// there, change them HERE too.

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.error(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
}

type Prompt = { id: string; text: string; queuedAt: number };

// One BROWSER: shared localStorage, per-tab sessionStorage maps.
const sharedLocal = new Map<string, string>();
const tabs = new Map<string, Map<string, string>>(); // tabId -> sessionStorage

function sessionOf(tabId: string) {
  let s = tabs.get(tabId);
  if (!s) { s = new Map(); tabs.set(tabId, s); }
  return s;
}

function makeKV(tabId: string): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const s = sessionOf(tabId);
  return {
    getItem: (k) => s.get(k) ?? null,
    setItem: (k, v) => { s.set(k, String(v)); },
    removeItem: (k) => { s.delete(k); },
  };
}
const localKV: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
  getItem: (k) => sharedLocal.get(k) ?? null,
  setItem: (k, v) => { sharedLocal.set(k, String(v)); },
  removeItem: (k) => { sharedLocal.delete(k); },
};

const KEY = "astra-ws-queue-v2";
const LEGACY = "astra-ws-queue-v1";

function loadQueue(tabId: string): Prompt[] {
  const store = makeKV(tabId);
  let raw = store.getItem(KEY);
  if (!raw) {
    const legacy = localKV.getItem(LEGACY);
    if (legacy) { localKV.removeItem(LEGACY); raw = legacy; }
  }
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((q: Prompt) => q && typeof q.text === "string" && typeof q.queuedAt === "number"
          && Date.now() - q.queuedAt < 86_400_000).slice(-20)
      : [];
  } catch { return []; }
}

function saveQueue(tabId: string, queue: Prompt[]) {
  const store = makeKV(tabId);
  if (queue.length) store.setItem(KEY, JSON.stringify(queue.slice(-20)));
  else store.removeItem(KEY);
}

const now = Date.now();
const p = (text: string): Prompt => ({ id: `q-${text}`, text, queuedAt: now });

console.log("per-tab durable prompt queue");

// Two tabs queue into their own storage; neither sees the other's prompts.
saveQueue("A", [p("tabA-prompt")]);
saveQueue("B", [p("tabB-prompt")]);
check("tab A sees only its own queue", loadQueue("A").map(q => q.text).join() === "tabA-prompt");
check("tab B sees only its own queue", loadQueue("B").map(q => q.text).join() === "tabB-prompt");

// Reload keeps the tab's queue (sessionStorage survives reloads).
check("reload keeps tab A's queue", loadQueue("A").length === 1 && loadQueue("A")[0].text === "tabA-prompt");

// Legacy shared queue migrates into exactly ONE tab, then is gone.
sharedLocal.set(LEGACY, JSON.stringify([p("legacy-prompt")]));
check("fresh tab C adopts the legacy queue", loadQueue("C").map(q => q.text).join() === "legacy-prompt");
check("legacy key deleted on adoption", !sharedLocal.has(LEGACY));
check("fresh tab D gets nothing (no double-split)", loadQueue("D").length === 0);

// Staleness cap still applies after migration.
sharedLocal.set(LEGACY, JSON.stringify([{ id: "q-old", text: "stale", queuedAt: now - 90_000_000 }]));
check("stale legacy prompt is dropped on migration", loadQueue("E").length === 0);
sharedLocal.delete(LEGACY);

// Emptying one tab's queue never touches the sibling's.
saveQueue("A", []);
check("clearing tab A leaves tab B intact", loadQueue("B").length === 1 && loadQueue("B")[0].text === "tabB-prompt");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures !== 0) throw new Error(`${failures} check failure(s)`);
