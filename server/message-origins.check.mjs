import { unlinkSync } from "node:fs";
import { strict as assert } from "node:assert";
import {
  openOriginsDb,
  closeOriginsDb,
  noteSubmit,
  bindRowId,
  rebindStoredSid,
  originFor,
  enrichOrigins,
  externalOriginForSession,
  _test
} from "./message-origins.mjs";

// NOTE: ESM hoists the import above this line regardless of statement order —
// isolation works because message-origins.mjs reads ASTRA_ORIGINS_DB lazily at
// open time (dbPath()), not because of ordering here.
process.env.ASTRA_ORIGINS_DB = "./.test-origins.db";

try { unlinkSync("./.test-origins.db"); } catch {}
try { unlinkSync("./.test-origins.db-wal"); } catch {}
try { unlinkSync("./.test-origins.db-shm"); } catch {}

// Test noteSubmit -> bindRowId correlation
noteSubmit("rpc1", { device: "web", liveSid: "live1" });
const bound1 = bindRowId("rpc1", 101, { resolveStoredSid: (sid) => sid === "live1" ? "stored1" : null });
assert.deepEqual(bound1, { storedSid: "stored1", rowId: 101, device: "web" });

// Unknown rpc returns null, stamps nothing
const bound2 = bindRowId("rpc-unknown", 102);
assert.equal(bound2, null);

// Missing userRowId returns null
noteSubmit("rpc2", { device: "web", liveSid: "live2" });
const bound3 = bindRowId("rpc2", null, { resolveStoredSid: () => "stored2" });
assert.equal(bound3, null);

// Late live->stored rebind
noteSubmit("rpc3", { device: "android", liveSid: "live-tmp" });
const rebindCount = rebindStoredSid("live-tmp", "stored3");
assert.equal(rebindCount, 1);
const bound4 = bindRowId("rpc3", 103, { resolveStoredSid: (s) => s });
assert.deepEqual(bound4, { storedSid: "stored3", rowId: 103, device: "android" });

// originFor exact match
const origin1 = originFor("stored1", 101);
assert.equal(origin1.device, "web");
const originMiss = originFor("stored1", 999);
assert.equal(originMiss, null);

// enrichOrigins joins exact (sid, row_id) and computes inherited stamps
const historyPayload = {
  id: "stored3",
  source: "telegram",
  messages: [
    { id: 103, role: "user", text: "hi" }, // has row_id, match android
    { id: 104, role: "user", text: "bot" }, // no row_id match, fallback to telegram
    { id: 105, role: "assistant", text: "yo" }
  ]
};

const enriched = enrichOrigins(historyPayload);
assert.equal(enriched.messages[0].origin, "android"); // exact match overrides
assert.equal(enriched.messages[1].origin, "telegram"); // computed, never persisted
assert.equal(enriched.messages[2].origin, undefined); // assistant gets no origin

const d = openOriginsDb();
assert.equal(d.prepare("SELECT count(*) as c FROM origins WHERE device='telegram'").get().c, 0); // inherited never persisted

closeOriginsDb();
try { unlinkSync("./.test-origins.db"); } catch {}
try { unlinkSync("./.test-origins.db-wal"); } catch {}
try { unlinkSync("./.test-origins.db-shm"); } catch {}

console.log("message-origins.check.mjs passed");
