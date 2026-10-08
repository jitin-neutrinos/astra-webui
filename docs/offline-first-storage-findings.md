# Offline-first client storage + queued sync — cited findings

Research for a design review of `astra.jitinnair.com` (Vite + React 19 + TS, zustand, tinybase ^10
already a dep, `@capacitor/preferences` ^8, Capacitor 8 Android shell).

**Citation key.** `[opened]` = I fetched and read the page body. `[search]` = I only saw the
search-result snippet. Browser-compat claims are quoted from MDN's own `browser-compat-data`
repo, which is the source MDN renders its tables from.

---

## 0. The finding that reframes the question

Before the survey, three facts from the repo:

1. **The Android app loads the live site, not a bundle.** `capacitor.config.ts` sets
   `server.url = 'https://astra.jitinnair.com'` and `webDir: 'dist'`. The comment is explicit:
   *"Astra is a hosted web app … with no offline-first design, so there is nothing to gain from
   shipping a stale `dist/` snapshot."* So there is exactly **one origin** — `https://astra.jitinnair.com`
   — and the phone's WebView and the desktop browser share one quota bucket, one IndexedDB, one
   `sessionStorage` partitioning scheme. There is no separate native-app storage world.

2. **An outbox already exists and is dead code.** `src/lib/outbox.ts` (49 lines) implements
   push/remove/list/clear over a `sessionStorage` array. `grep -rn "from .*outbox" src` returns
   **zero** call sites. Nothing imports it.

3. **The live queue is elsewhere and is `sessionStorage`-only.** `src/lib/ws-store.ts:42-92`
   persists queued prompts to `sessionStorage` key `astra-ws-queue-v2`, with a one-time migration
   off the old shared `localStorage` key. `src/lib/concurrent-queue.check.ts` exists specifically
   because a shared `localStorage` queue leaked tab A's prompt into tab B's chat. And
   `src/lib/read-sync.ts` already runs a TinyBase `createMergeableStore()` synced over TinyBase's
   BroadcastChannel synchronizer, plus a 30s `/api/read-state` poll.

So the gap is not "we have no storage layer". It is: **the durable queue is in `sessionStorage`,
which does not survive tab close or app kill** — the exact failure the file's own header comment
claims to fix.

---

## (a) IndexedDB vs localStorage for append-only transcripts

**localStorage is the wrong tool. Unambiguously.**

| | localStorage | IndexedDB |
|---|---|---|
| API | synchronous, string-only | async, structured-clone any type |
| Per-origin quota | ~5 MiB; ~10 MiB for localStorage + sessionStorage combined | effectively unbounded (hundreds of MB → GB) |
| Available in workers / service workers | **no** | yes |
| Main-thread blocking | yes, every read and write | no |

**Sources (all `[opened]`):**

- web.dev, *Storage for the web* — states verbatim: *"LocalStorage should be avoided because it is
  synchronous and will block the main thread. It is limited to about 5MB and can contain only
  strings. LocalStorage is not accessible from web workers or service workers."* Recommends
  IndexedDB for "other data", and for storage quotas: *"at least a couple of hundred megabytes"*;
  Chrome lets an origin use up to 60% of total disk; Firefox up to 2 GB per eTLD+1 group; Safari
  ~1 GB and prompts the user above that.
  <https://web.dev/articles/storage-for-the-web>

- MDN, *Storage quotas and eviction criteria* — origins, buckets, per-origin partitioning, and the
  persistent-vs-best-effort split.
  <https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Browser_storage_limits_and_eviction_criteria>

- Nolan Lawson, *IndexedDB, WebSQL, LocalStorage — what blocks the DOM?* `[search]` — the canonical
  benchmark. LocalStorage fully blocks the DOM in Chrome/Firefox/Edge; 100 000 insertions took
  4 725 ms in Chrome and the Safari run *crashed the page* at 10 000. IndexedDB inside a **Web
  Worker** dropped no frames.
  <https://nolanlawson.com/2015/09/29/indexeddb-websql-localstorage-what-blocks-the-dom/>

- The Chromium IndexedDB design doc `[search]` — *"All database processing will happen on a
  background thread … Database access will result in file IO and we need to ensure that we never
  block the main thread."*
  <https://www.chromium.org/developers/design-documents/indexeddb>

**The `navigator.storage.persist()` trap — and it is a live trap for this app specifically.**
`StorageManager.persist()` is universally supported `[opened: raw browser-compat-data
api/StorageManager.json]` — Chrome 55, Firefox 57, Safari 15.2, `webview_android: mirror`.
That makes it *look* safe on Android. It is not. The Ionic team's own storage guide `[opened]`:

> *"Local Storage can be used for small amounts of temporary data … but must be considered
> transient, meaning your app needs to expect that the data will be lost eventually. This is
> because the OS will reclaim local storage from Web Views if a device is running low on space.
> The same can be said for IndexedDB at least on iOS (on Android, the persisted storage API is
> available to mark IndexedDB as persisted)."*
> <https://capacitorjs.com/docs/guides/storage>

And capacitor#7594 `[opened]` — a feature request to make persistence reliable — was **closed as
not planned**, with the reporter stating *"from my testing it doesn't work on Capacitor Android
specifically"* because `window.Notifications` is absent, the app can't bookmark itself into the
WebView, and so the Chromium "site is important" heuristic never passes. Maintainer response:
*"`navigator.storage.persist()` is a browser feature. If it's not working as intended, please,
report it to Google or Apple."*
<https://github.com/ionic-team/capacitor/issues/7594>

**Conclusion (a):** the local store is IndexedDB. But treat `persist()` as a best-effort request,
not a durability guarantee, and keep the server as the real recovery path. Do not cache
multi-MB transcripts under any circumstance in `localStorage` — a 5 MiB ceiling against
multi-MB transcripts means `QuotaExceededError` on the *whole-key* write, i.e. total loss of the
transcript, not degradation.

---

## (b) The transactional outbox

**The pattern.** microservices.io, *Pattern: Transactional outbox* `[opened]`: write the message
into the same transaction that updates state, then have a separate relay publish it. Guarantees
messages are sent **iff** the transaction commits. Its two named drawbacks are exactly our two
failure modes: *"The Message relay might publish a message more than once. It might, for example,
crash after publishing a message but before recording the fact"* — so *"a message consumer must
be idempotent"*; and it is *"potentially error prone since the developer might forget to publish
the message/event after updating the database."*
<https://microservices.io/patterns/data/transactional-outbox.html>

Client-side there is no distributed transaction, so the whole thing collapses to a single
guarantee: **a user message is never acknowledged to the UI until it is durably local, and is
never removed from local storage until the server has durably accepted it.**

**Idempotency keys.** The `Idempotency-Key` header draft `[opened]` — *"can be used to make
non-idempotent HTTP methods such as POST or PATCH fault-tolerant."* Note it is an **expired**
Internet-Draft (`draft-ietf-httpapi-idempotency-key-header-07`, expired, IESG state *Expired*) —
so there is no ratified standard, just a widespread convention.
<https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/>

**Retry.** Truncated exponential backoff **with jitter**. Google's IAM retry guidance `[opened]`:
*"we strongly recommend using truncated exponential backoff with introduced jitter"*; without
jitter, a fleet of clients that failed together retries in lockstep and re-creates the outage.
<https://cloud.google.com/iam/docs/retry-strategy>

**Surviving tab close / app kill — the three tiers, in order of reliability:**

| Tier | Mechanism | Survives reload | Survives tab close | Survives app kill | Cost |
|---|---|---|---|---|---|
| 1 | `sessionStorage` — **what the repo does today** | yes | **no** | **no** | zero |
| 2 | IndexedDB write, flushed on `visibilitychange`/`pagehide` | yes | yes | yes (mostly) | small |
| 3 | Service Worker `sync` event | yes | yes | yes | see (c) |

Tier 1 is the bug. `sessionStorage` is scoped to the tab's session and is gone when the tab closes;
on Android the WebView is destroyed on a swipe-away or memory-pressure kill. A message the user
watched "send" is lost. The `ws-store.ts` header comment asserts the queue is *DURABLE* and
specifically says this so "an Android app kill … no longer eats a message" — the comment describes
the intent, the storage medium does not deliver it.

Also worth fixing regardless of storage: **the queue has no idempotency key and the server has no
dedupe.** `grep -n 'idempot\|client_msg_id\|X-Idempotency' server.mjs src/lib/hermes-ws.ts`
returns nothing. So the current retry path is at-least-once with no dedupe — a duplicate is
possible whenever a flush is interrupted after the server accepted but before the client removed
the row. The `QueuedPrompt.id` (`q-${text}` in the check fixture, `ob${Date.now()}-${random}` in
`outbox.ts`) is a local correlation id that is never sent to the server, so it cannot protect
against this.

**Failure modes to design around:**
- Row written, flush starts, tab dies → server has it, local still has it → duplicate on restart.
  Fixed only by a server-side idempotency key, not by client logic.
- Row written, `sessionStorage` write throws (private mode / quota) → `saveQueue` swallows the
  error with `catch { /* private mode */ }` and the message vanishes silently. A durable store
  must surface that as a visible failure, not a no-op.
- Flush succeeds, `dequeue` never runs → row stays → duplicate forever. Same fix.
- Backoff retry storm across N tabs → jitter.
- Poison row (server rejects permanently, e.g. 400) → naive infinite retry. Needs a
  terminal-failure state with a dead-letter cap.

---

## (c) Service Worker Background Sync — support status as of 2026

**It is Chromium-only, and it is explicitly absent from Android WebView, which is this app.**

caniuse.com/background-sync `[opened]`: global usage **76.73%**. Chrome 49+, Edge 79+, Samsung
Internet 5+, UC Browser, QQ, Baidu. **Safari: not supported (3.1 through 27-TP, including
Safari iOS 26.6 and 27). Firefox: not supported.** Also marked **UNOFF** on caniuse.

MDN's own compat data `[opened: raw browser-compat-data api/SyncManager.json]` is more precise and
more damning:

```
safari:            { version_added: false, impl_url: "https://webkit.org/b/182565" }
firefox:           { version_added: false }
webview_android:   { version_added: false, impl_url: "https://crbug.com/40449796" }
opera (worker):    { version_added: false }
```

Three things fall out of that JSON that no summary table shows:

1. **`webview_android: false`.** The Android app's WebView does **not** get Background Sync. It is
   not a degraded path there, it is absent. With `server.url` pointing at the live https origin
   (finding 0.1), the phone is on the *worst* platform in this dataset.
2. **Safari has an open, unresolved WebKit bug** (`webkit.org/b/182565`) rather than a decision.
   Since the project's context says the user has "a few devices", any iOS device is fallback-only.
3. **`opera` has `version_added: false` inside the `worker_support` block** even though top-level
   Opera mirrors Chrome — so even on an Opera-family browser the *service worker* cannot use it.
   Detection must be a real feature test (`"sync" in ServiceWorkerRegistration.prototype`), not a
   UA sniff.

**Periodic Background Sync is worse.** MDN `[search]`: `SyncManager`/`PeriodicSyncManager` are
labelled **Limited availability** / *Limited availability — This feature is not in Baseline
because it is not supported in all major browsers*, and both `SyncManager` and `PeriodicSyncEvent`
are tagged `{{Experimental_Inline}}` in mdn/content source.
<https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API> `[opened]`,
<https://developer.mozilla.org/en-US/docs/Web/API/PeriodicSyncManager> `[search]`,
<https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API> `[search]`

**And there is nothing to build on today anyway:** the repo ships **no service worker**. No
`sw.js`, no `manifest*.json`, no PWA plugin — `vite.config.ts` has `plugins: [react(), tailwindcss()]`.

**Fallback strategy — and the honest recommendation:**

Do **not** build the outbox flush on Background Sync. It would be dead code on iOS, dead on
Android WebView, and untestable in this repo today. Instead:

1. **Durable IndexedDB outbox as the primary mechanism** — this is what actually survives.
2. **Flush triggers, in order of reliability, all platform-neutral:**
   - immediately after the local write, if online;
   - on `navigator.onLine` transition and on the existing WS `proxy-online` reconnect event —
     `src/lib/connection-state.ts` already models `online | offline | checking | restored` and
     `chat-landing.tsx:218` already renders *"Back online — queued messages are on their way."*
     The UI affordance exists; only the flush is missing;
   - on `visibilitychange` → `hidden` and `pagehide` (this is what closes the tab-close window);
   - on app resume — `src/native/android-resume.ts` already fires `astra:resume-check`;
   - a low-frequency `setInterval` while the tab is visible, as a safety net.
3. **Register Background Sync as a cheap progressive enhancement** — one `sync.register(tag)` call
   inside a `try`, guarded by feature detection. Costs ~5 lines. Helps Chromium desktop only.
4. On native, if ever needed, the real mechanism is a **native foreground service**, which is what
   this app already runs for ntfy (`NativeNtfy` / the push pipe in `android-resume.ts`). That
   plugin already exists and already re-arms on every resume.

---

## (d) BroadcastChannel for multi-tab sync, and the StorageEvent fallback

**BroadcastChannel — this project is already using it, via TinyBase.** MDN `[opened]`:

> **Baseline Widely available** … *"It's been available across browsers since March 2022."*
> Available in Web Workers. Note the partitioning caveat: *"communication is allowed between
> browsing contexts using the same storage partition. Storage is first partitioned according to
> top-level sites."*

Compat data `[opened: raw browser-compat-data api/BroadcastChannel.json]`: Chrome 54, Firefox 38,
Safari **15.4**, `webview_android: mirror`, `webview_ios: mirror`, Node 18, Bun 1.0, Deno 2.6.
`status.deprecated: false`, `standard_track: true`. Safari 15.4 is the floor — iOS 15.3 and earlier
are out, which matters for "a few devices".

`read-sync.ts:41-43` is the existing correct usage — `createBroadcastChannelSynchronizer(store,
"astra-read-state")` with a `catch` that warns and continues.

**StorageEvent — the fallback, with a precise caveat.** `localStorage`/`sessionStorage` writes from
one tab fire a `storage` event in *other* tabs of the same origin; it does **not** fire in the
writing tab. MDN `[opened]` <https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event>.
This is exactly the mechanism TinyBase's browser persisters use for cross-tab awareness
(`startAutoLoad` reflects a `StorageEvent` back into the Store — confirmed in the TinyBase guide
text `[opened]`: `sessionStorage.setItem('petStore', …)` → `StorageEvent('storage', …)` → store
reloads).

The caveat that matters: **StorageEvent only exists for Web Storage, so the fallback only works
while you are still writing to Web Storage.** Once the outbox moves to IndexedDB, StorageEvent
gives you nothing. IndexedDB cannot be observed cross-tab by event; TinyBase's own docs are candid
about this `[opened]`: *"it is not possible to reactively detect changes to a browser's IndexedDB.
If you do choose to enable automatic loading for the Persister (with the startAutoLoad method), it
needs to poll the database for changes"* — `autoLoadIntervalSeconds` defaults to 1 `[search:
tinybase.org/api/persister-indexed-db/functions/creation/createindexeddbpersister]`.

**So the layering that actually works:**
1. **BroadcastChannel** for live, low-latency fan-out (already in place).
2. **Server poll** as the durable reconcile path (`read-sync.ts` does this at 30s; the comment
   records that a WS synchronizer was evaluated and skipped in favour of the existing relay).
3. **StorageEvent** only while a Web-Storage key is still the transport — treat as legacy, not a
   design pillar.
4. If cross-tab IDB freshness is ever genuinely needed, TinyBase's poll-based `startAutoLoad`
   (default 1s) is the built-in answer; a dedicated `navigator.locks`-based writer election is the
   better answer for *"only one tab may own the flush loop"* — note `navigator.locks` is
   Chromium/Safari 15.4+, same floor as BroadcastChannel.

**Failure mode to name explicitly:** BroadcastChannel is same-origin + same storage partition
only. It does **not** cross devices, it does **not** reach a different browser profile, and it
does **not** reach a service worker's dedicated worker implicitly. It is a fast path, never the
source of truth.

---

## (e) Android storage: AsyncStorage vs MMKV vs SQLite vs `@capacitor/preferences`

**The decisive structural fact first: this is a Capacitor app, not a React Native app.** The
project stack is Vite + React 19 in a WebView; there is no RN bridge, no JSI, no NitroModules.
Therefore **AsyncStorage, react-native-mmkv, op-sqlite and react-native-sqlite-storage are all
inapplicable as primary stores here** — they are RN packages requiring an RN runtime. They are
listed in TinyBase's persister table because TinyBase ships modules for both worlds.

| Option | Async? | Capacity | Viable here? |
|---|---|---|---|
| `@capacitor/preferences` (have it) | async | small — KV only, no queries | only for flags/prefs |
| IndexedDB (WebView) | async | ~100s MB → GB | **yes — the primary store** |
| `@capacitor-community/sqlite` | async | file-backed, unbounded | only if you need SQL |

**`@capacitor/preferences` — the docs rule it out themselves, twice.**

Capacitor's own API page `[opened]`: *"This API is **not** meant to be used as a local database.
If your app stores a lot of data, has high read/write load, or requires complex querying, we
recommend taking a look at a SQLite-based solution."* And: *"This plugin will use `UserDefaults` on
iOS and `SharedPreferences` on Android."* Also relevant: it *"will fall back to using
`localStorage` when running as a Progressive Web App"* and *"Stored data is cleared if the app is
uninstalled."*
<https://capacitorjs.com/docs/apis/preferences>

`PreferencesPlugin.java` `[opened]` confirms the Android path is a plain `Preferences` instance
with `get`/`set`/`remove`/`keys`/`clear`/`migrate` over string values — no query surface at all.
<https://github.com/ionic-team/capacitor-plugins/blob/main/preferences/android/src/main/java/com/capacitorjs/plugins/preferences/PreferencesPlugin.java>

**And `SharedPreferences` is documented by AOSP as unsuitable for this.** `[opened]`:

> *"SharedPreferences is best suited to storing data about how the user prefers to experience the
> app … SharedPreferences reflects changes committed or applied immediately, **potentially before
> those changes are durably persisted**. Under some circumstances such as app crashes or
> termination **these changes may be lost**, even if an `OnSharedPreferenceChangeListener` reported
> the change was successful."*

It also warns of main-thread ANRs: outstanding edits are flushed when activities stop, and
*"this can lead to blocking the main thread during lifecycle transition events and associated ANR
errors."* And the implementation is a whole-file XML rewrite — `SharedPreferencesImpl.java`
`[search]` shows `XmlUtils.writeMapXml` + `FileUtils.sync` on a `BufferedInputStream`, with a
`MAX_FSYNC_DURATION_MILLIS = 256` warning threshold.
<https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/content/SharedPreferences.java>

That XML-whole-file-rewrite property is the disqualifier for an append-only transcript: cost is
O(total store) per write, not O(new row). Exactly the wrong shape for append-only.

**On the RN options, for the record** (applicability noted per row):

- **AsyncStorage** — RN-only, and its own docs site 301-redirects to nothing usable `[opened:
  got a 301 stub]`. Widely characterised as deprecated in favour of MMKV. Not applicable.
- **react-native-mmkv** `[opened: github.com/mrousavy/react-native-mmkv]` — RN-only. Claims
  *"Fully synchronous calls … ~30x faster than AsyncStorage"*, JSI + C++ NitroModules, AES-256,
  multi-process mode. A KV store, so same XML-free-but-still-flat objection; and a sync API would
  block the WebView main thread anyway. Not applicable.
- **op-sqlite** `[opened: github.com/OP-Engineering/op-sqlite]` — RN-only, direct C++ SQLite, plus
  FTS5 / Rtree / sqlite-vec / JSONB / reactive queries. Impressive, but needs RN.
- **react-native-sqlite-storage** — RN-only.
- **`@capacitor-community/sqlite`** — the Capacitor-native SQLite. This is the one that would apply
  *if* SQL were needed. Capacitor's guide calls SQLite *"the most widely supported option"* for
  *"large amounts of data … high performance"* `[opened]`, and TinyBase ships a matching
  `persister-capacitor-sqlite` (since v9.6.0, via `@capacitor-community/sqlite`) `[opened:
  tinybase.org/api/persister-capacitor-sqlite/]`.

**Which is right for multi-MB transcripts on Android → IndexedDB in the WebView.** Reasoning:
unbounded quota; async so no jank on scroll; available to workers; already how the web tier works
so one code path covers phone and desktop; zero new deps. The risk is WebView storage reclamation,
and the mitigation is not "switch to SQLite" so much as *"don't let the client store be
load-bearing."* The gateway already owns session history — `outbox.ts` says so explicitly: *"The
inbox side (Astra → user) is durable in the GATEWAY's session history; the client never persists
assistant content — resume + /messages re-pull is the authoritative restore path."* That is a very
good posture. Keep it: the local store is a **cache and an outbox**, never the archive.

**One thing to check before relying on the shared origin:** because `server.url` is the live
https origin and the WebView is a *different* storage partition from the desktop browser's, phone
and desktop do **not** share IndexedDB. That is fine for this design (server is truth, poll
reconciles) but it means "a few devices" gives you N independent caches, not one.

---

## (f) Library landscape

**Appropriate: tinybase (already installed).** This is the standout. Confirmed `[opened:
tinybase.org/guides/persistence/an-intro-to-persistence/]` — the persister table lists exactly the
matrix in this report, with the right verdicts baked in:

> *"Basic Persisters … generally load and save a JSON-serialized version of your Store. They are
> good for **smaller data sets**."* — `LocalPersister` (localStorage), `SessionPersister`,
> `OpfsPersister`, `FilePersister`, `IndexedDbPersister`, `RemotePersister`.
> *"Database Persisters … good for **larger data sets**."* — incl. `CapacitorSqlitePersister`,
> `PglitePersister`, `PowerSyncPersister`.

Already shipping in v10 (verified in `node_modules/tinybase/persisters/`, and on
tinybase.org/api/): `persister-indexed-db`, `persister-browser`, `persister-capacitor-sqlite`,
`persister-react-native-mmkv`, `persister-remote`, `persister-file`, `persister-pglite`,
`persister-yjs`, `persister-automerge`, `persister-sqlite-wasm`, …

The v10 change that matters here: **IndexedDbPersister now supports MergeableStore.** From the
TinyBase releases page `[search]`: *"MergeableStore Support For IndexedDB — The IndexedDbPersister
can now persist a MergeableStore, closing a gap that had made IndexedDB the odd one out amongst
the browser Persisters (as requested in issue #203). The SessionPersister, LocalPersister and
OpfsPersister could all already do this."* Until v10, `createIndexedDbPersister` *"only supports
regular Store objects, and cannot be used to persist the metadata of a MergeableStore"* `[search]`.
`read-sync.ts` uses `createMergeableStore()` — so the CRDT read-markers store **can** now be made
durable with zero new dependencies. That is the single highest-value, lowest-risk change available.

Also relevant: `startAutoPersisting()` + `startAutoLoad()` give auto-save/auto-load with
race-condition guards (*"it will not attempt to save data if it is currently loading it and
vice-versa"*). Persister interface has `addStatusListener` — i.e. a real "is the local store
healthy / did the last save fail" signal to drive UI.
<https://tinybase.org/api/persister-indexed-db/interfaces/persister/indexeddbpersister> `[search]`

**Appropriate if you want raw IDB without tinybase's data model: Dexie.** `[opened:
dexie.org/docs/Tutorial/Design]` — async, promise-based, queueing operations so you can use the DB
before `open()` resolves, indexed queries via `db.version(n).stores({...})`. Clean and mature.
But it duplicates a reactive layer tinybase already gives you, and adds a dep.

**Appropriate only if a query cache is genuinely wanted: TanStack Query persistence.**
`[opened: tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient]` —
`persistQueryClientRestore` / `Save` / `Subscribe`, `createSyncStoragePersister` /
`createAsyncStoragePersister`, plus two footguns it documents: *"you probably want to pass a
QueryClient a `gcTime` value to override the default during hydration"* (default 300 000 ms vs
`maxAge` default 24 h, so the cache is discarded early otherwise) and *"Due to a JavaScript
limitation, the maximum allowed `gcTime` is about 24 days."* The project has **no react-query**
today, and its transport is a bespoke WS relay, not a query cache. Adopting it to hold chat
transcripts would mean modelling an append-only log as invalidated queries. Not worth it.

**Not appropriate — and why:**

- **PGlite** — Postgres compiled to WASM. Real Postgres semantics in the browser. Enormously
  heavier than a chat log needs, and it fights the server-is-truth model by creating a second
  relational authority.
- **ElectricSQL** `[opened: electric-sql.com/docs]` — *"Electric Sync is a read-path sync engine
  for Postgres. It syncs data out of Postgres into local clients over HTTP using a primitive
  called a Shape."* Read-path only, and it requires the data to live in Postgres. The gateway is
  the source of truth and is not shaped like that.
- **RxDB** `[opened: rxdb.info]` — genuinely capable (replication, CRDT, conflict resolution,
  schema validation, migrations, encryption) and would work. But it is a full database
  replacement with its own query/replication model, for a single-user app with one server.
  Category error in cost.
- **WatermelonDB** — built for large multi-user datasets with its own sync engine and a
  SQLite-first design. Explicitly aimed at scale this app does not have.
- **Yjs / Automerge** — CRDTs. `read-sync.ts` already made this call deliberately and wrote it
  down: *"Server-side 'ws synchronizer' was evaluated and skipped: our proxy already owns a WS
  relay, and the read-state set is tiny."* Adding a CRDT to resolve conflicts on a
  single-writer, server-authoritative chat log buys nothing. `createMergeableStore()` is the
  right-sized subset of that idea and is already in use.

---

## Recommendation

**Zero new dependencies. Ship tier-2 durability on top of tinybase, which is already installed
and already half-wired.**

1. **Move the queue out of `sessionStorage` into IndexedDB.** `ws-store.ts:42-92` is the live
   queue; `outbox.ts` is a correct-shaped, currently-unreferenced implementation. Reconcile them
   — do not maintain two. Persist through TinyBase's `createIndexedDbPersister` (already present
   in `node_modules`, `persister-indexed-db`) so the reactive layer and the durable layer are one
   object. This is the actual fix for tab-close and app-kill.
2. **Give every outgoing message a real idempotency key that reaches the server**, and dedupe on
   the server. `Idempotency-Key` header (expired draft, but universal convention). Today there is
   no dedupe anywhere, so the at-least-once flush path is unsafe. Non-negotiable before flush
   becomes durable — a durable outbox without server-side idempotency turns every crash into a
   duplicate message.
3. **Make `persist()` an optimization, never an assumption.** Call `navigator.storage.persist()`
   and record `navigator.storage.persisted()` for diagnostics, but never let local-store health be
   load-bearing — the gateway already owns session history and re-pull is the recovery path. That
   posture makes the whole capacitor#7594 non-persistence problem a non-issue.
4. **Wire flush triggers to what already exists.** `connection-state.ts` already emits
   `proxy-online`; `chat-landing.tsx:218` already promises *"Back online — queued messages are on
   their way."* Add `visibilitychange`/`pagehide` and the existing `astra:resume-check` on resume.
5. **Skip Background Sync as a dependency; register it opportunistically.** Feature-test
   (`"sync" in ServiceWorkerRegistration.prototype`), `try`/`catch`, ignore the result. It buys
   Chromium desktop only and is **absent on Android WebView** — this app's primary mobile target.
   Do not build on it.
6. **Make the dead `read-sync` TinyBase store durable** via `createIndexedDbPersister` +
   `MergeableStore` — newly supported in v10. Costs ~10 lines, zero deps, removes a whole class
   of "read markers reset on reload" complaints.
7. **Retire `outbox.ts` or wire it.** Dead code with a correct doc comment is a trap: the next
   reader will assume the outbox is durable. Either it becomes the real implementation or it
   goes.

**Add Dexie only if** you need indexed queries over transcripts that TinyBase's table model can't
express. **Add `@capacitor-community/sqlite` only if** IndexedDB quota or WebView reclamation
becomes a real, observed problem — not preemptively, given the server-is-truth design.

### Failure modes, one line each

| Component | Failure mode |
|---|---|
| IndexedDB local store | WebView/OS reclamation (capacitor#7594); `QuotaExceededError` if quota ever binds |
| `persist()` | Silently denied on Capacitor Android — do not depend on it |
| Durable outbox | Crash after server accepts, before local dequeue → duplicate **unless** server dedupes |
| `sessionStorage` (today) | Tab close / app kill loses queued user messages — the live bug |
| Server dedupe absent | At-least-once retries can double-send user messages |
| BroadcastChannel | Same-origin + same partition only; never cross-device; not in SW implicitly |
| StorageEvent fallback | Fires in other tabs only, and **only for Web Storage** — dies with the IDB move |
| Background Sync | Absent on Android WebView + all Safari + all Firefox + Opera-in-SW |
| SharedPreferences (via `@capacitor/preferences`) | Whole-file XML rewrite; AOSP says changes may be lost on crash |
| Client store as archive | Any local loss becomes permanent data loss — keep the gateway authoritative |

---

## Sources

**Opened in full**

- <https://web.dev/articles/storage-for-the-web>
- <https://microservices.io/patterns/data/transactional-outbox.html>
- <https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/>
- <https://cloud.google.com/iam/docs/retry-strategy>
- <https://caniuse.com/background-sync>
- <https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API>
- <https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API>
- <https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API>
- <https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Browser_storage_limits_and_eviction_criteria>
- <https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event>
- <https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/SyncManager.json>
- <https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/ServiceWorkerRegistration.json>
- <https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/BroadcastChannel.json>
- <https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/StorageManager.json>
- <https://capacitorjs.com/docs/guides/storage>
- <https://capacitorjs.com/docs/apis/preferences>
- <https://capacitorjs.com/docs/apis/network>
- <https://capacitorjs.com/docs/apis/filesystem>
- <https://github.com/ionic-team/capacitor-plugins/blob/main/preferences/android/src/main/java/com/capacitorjs/plugins/preferences/PreferencesPlugin.java>
- <https://github.com/ionic-team/capacitor/issues/7594>
- <https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/content/SharedPreferences.java>
- <https://developer.android.com/reference/android/webkit/WebStorage>
- <https://github.com/OP-Engineering/op-sqlite>
- <https://github.com/mrousavy/react-native-mmkv>
- <https://op-engineering.github.io/op-sqlite/>
- <https://tinybase.org/guides/persistence/> and
  <https://tinybase.org/guides/persistence/an-intro-to-persistence/>
- <https://tinybase.org/api/persister-indexed-db/>,
  <https://tinybase.org/api/persister-capacitor-sqlite/>,
  <https://tinybase.org/api/persister-react-native-mmkv/>
- <https://dexie.org/docs/Tutorial/Design>
- <https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient>
- <https://electric-sql.com/docs>
- <https://rxdb.info/>

**Search snippet only** (claim corroborated elsewhere in this report, but not read at source)

- <https://nolanlawson.com/2015/09/29/indexeddb-websql-localstorage-what-blocks-the-dom/>
- <https://www.chromium.org/developers/design-documents/indexeddb>
- <https://developer.mozilla.org/en-US/docs/Web/API/SyncManager>
- <https://developer.mozilla.org/en-US/docs/Web/API/PeriodicSyncManager>
- <https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API>
- <https://tinybase.org/guides/releases>
- <https://tinybase.org/api/persister-indexed-db/functions/creation/createindexeddbpersister>
- <https://tinybase.org/api/persister-indexed-db/interfaces/persister/indexeddbpersister>
- <https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/app/SharedPreferencesImpl.java>

**Retrieval notes**

- `https://developer.mozilla.org/en-US/docs/Web/API/Background_Sync_API` returns **404**. The page
  was renamed to `Background_Synchronization_API`. Any review note citing the old URL is stale.
- The Exa/Keenable extract backends intermittently return `CRAWL_NOT_FOUND` on MDN, `tinybase.org`
  and `web.dev`; tinybase and the caniuse table were read through the browser instead.
- `https://react-native-async-storage.github.io/async-storage/` 301s to an nginx stub — no docs
  retrievable, and the package is RN-only in any case.
