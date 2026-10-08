import { test } from "node:test";
import assert from "node:assert";
import { useSurfaceStripStore } from "./surface-strip.ts";

test("device dedupe across sockets, per-device focus, external-status merge, snapshot path", () => {
  const store = useSurfaceStripStore.getState();
  
  // 1. Snapshot path
  store.ingestSnapshot({
    devices: [
      { device: "android", focuses: ["session_123"], connections: 2 },
      { device: "web", focuses: [], connections: 1 }
    ],
    external_sources: {
      sources: { telegram: { last_active: 1700000000 } }
    },
    count: 3
  });
  
  let state = useSurfaceStripStore.getState();
  assert.ok(state.liveDevices["android"]);
  assert.equal(state.liveDevices["android"].connections, 2);
  assert.deepEqual(state.liveDevices["android"].focuses, ["session_123"]);
  
  assert.ok(state.liveDevices["web"]);
  assert.equal(state.liveDevices["web"].connections, 1);
  assert.deepEqual(state.liveDevices["web"].focuses, []);
  
  assert.ok(state.externalSources["telegram"]);
  assert.equal(state.externalSources["telegram"].last_active, 1700000000);
  
  // 2. external.status merge
  store.ingestExternalStatus({
    sources: {
      telegram: { last_active: 1700000001 },
      cli: { last_active: 1700000002 }
    }
  });
  
  state = useSurfaceStripStore.getState();
  assert.equal(state.externalSources["telegram"].last_active, 1700000001);
  assert.equal(state.externalSources["cli"].last_active, 1700000002);
  
  // live devices should remain untouched by external.status
  assert.ok(state.liveDevices["android"]);
});
