// Assert-based check for per-tab chat session isolation.
//   npx tsx src/lib/tab-isolation.check.ts
//
// Why this exists: the stored session id lived in localStorage under one key.
// localStorage is per-ORIGIN, not per-tab, so every tab shared one value.
// Reproduced live: open tab A on chat 1, open tab B, start chat 2 in B — both
// tabs ended up on chat 2, because B overwrote the shared key and A resumed it.
//
// Two independent hijack paths are pinned here:
//   1. STORAGE — the id a tab resumes on load must come from its own URL or its
//      own sessionStorage, never from a sibling tab.
//   2. WIRE — the proxy fans every upstream frame out to every connected tab, so
//      a reply carrying a session_id may belong to a different tab. A tab may
//      only retarget itself on a reply to an id it actually sent.

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.error(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
}

// ---- 1. Storage resolution (mirrors readStoredSid/writeStoredSid) ----

const KEY = "astra-chat-session";

/** One browser tab: its own sessionStorage + its own URL, a SHARED localStorage. */
class Tab {
  session = new Map<string, string>();
  path: string;
  local: Map<string, string>;
  constructor(path: string, local: Map<string, string>) {
    this.path = path;
    this.local = local;
  }

  private sidFromPath(): string | null {
    const m = this.path.match(/^\/c\/([A-Za-z0-9_-]+)$/);
    return m ? m[1] : null;
  }
  readStoredSid(): string | null {
    const fromUrl = this.sidFromPath();
    if (fromUrl) { this.session.set(KEY, fromUrl); return fromUrl; }
    return this.session.get(KEY) ?? null;
  }
  writeStoredSid(sid: string | null) {
    if (sid) this.session.set(KEY, sid); else this.session.delete(KEY);
    this.local.delete(KEY);
  }
  /** A reload keeps sessionStorage; the URL is whatever the tab last asserted. */
  reload(): Tab {
    const t = new Tab(this.path, this.local);
    t.session = new Map(this.session);
    return t;
  }
}

console.log("per-tab session isolation");

// The exact reproduced scenario: A on chat 1, B opens and starts chat 2.
{
  const shared = new Map<string, string>();
  const a = new Tab("/c/chat-one", shared);
  a.readStoredSid();
  a.writeStoredSid("chat-one");

  const b = new Tab("/", shared);
  check("a fresh tab does NOT inherit another tab's chat", b.readStoredSid() === null, b.readStoredSid());

  b.path = "/c/chat-two";
  b.writeStoredSid("chat-two");

  check("tab A still on its own chat", a.readStoredSid() === "chat-one", a.readStoredSid());
  check("tab B on its own chat", b.readStoredSid() === "chat-two", b.readStoredSid());
  check("the two tabs differ", a.readStoredSid() !== b.readStoredSid());
}

// A reload keeps the tab's own chat (the property localStorage was there for).
{
  const shared = new Map<string, string>();
  const t = new Tab("/c/chat-seven", shared);
  t.readStoredSid();
  const after = t.reload();
  check("reload keeps this tab's chat", after.readStoredSid() === "chat-seven", after.readStoredSid());
}

// A legacy origin-wide value must never be adopted.
{
  const shared = new Map<string, string>([[KEY, "stale-shared-chat"]]);
  const t = new Tab("/", shared);
  check("legacy shared localStorage value is ignored", t.readStoredSid() === null, t.readStoredSid());
  t.writeStoredSid("fresh");
  check("legacy key is cleared on first write", !shared.has(KEY), [...shared.keys()]);
}

// Deep link wins over a stale per-tab value (back/forward, pasted URL).
{
  const shared = new Map<string, string>();
  const t = new Tab("/c/old", shared);
  t.readStoredSid();
  t.path = "/c/new";
  check("URL wins over stale sessionStorage", t.readStoredSid() === "new", t.readStoredSid());
}

// ---- 2. Wire ownership (mirrors the ownRpcIds guard) ----

/** Does a broadcast reply retarget THIS tab? Only if it answers our own id. */
function adoptsReply(ownIds: Set<string>, frame: { id?: string; result?: { session_id?: string } }): boolean {
  return Boolean(frame.id && frame.result?.session_id && ownIds.has(frame.id));
}

console.log("broadcast reply ownership");
{
  const mine = new Set<string>(["rpc-mine-1"]);
  check("adopts a reply to our own RPC",
    adoptsReply(mine, { id: "rpc-mine-1", result: { session_id: "chat-one" } }) === true);
  check("ignores a sibling tab's session.create reply",
    adoptsReply(mine, { id: "rpc-other-9", result: { session_id: "chat-two" } }) === false);
  check("ignores an unsolicited session_id with no id",
    adoptsReply(mine, { result: { session_id: "chat-three" } }) === false);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures !== 0) throw new Error(`${failures} check failure(s)`);
