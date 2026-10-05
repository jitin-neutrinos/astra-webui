// canvas-state.tsx — per-canvas reactive state for interactive canvases.
//
// ONE store per canvas card. Controls (slider/select/toggle/…) write named
// values; reader blocks (kpi/table/chart/progress) resolve `{bind, where, sort,
// pluck, visible·series-visible}` against them through canvas-expr. Writes are
// local-only (no network, A2UI's local-first two-way binding) and survive chat
// re-renders because the store is keyed per canvasId in a module map, not held
// in component state (a re-mount after a chat reconciliation would otherwise
// reset the user's sliders — the exact bug a message-scoped store exists to
// avoid; cf. canvas-fullscreen.tsx's singleton-store reasoning).
//
// UseSyncExternalStore keeps React 19/StrictMode honest: getSnapshot must be
// pure — we hand back an immutable version tag that only changes on write, and
// consumers re-read values inside render from the same store.
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type StateValue = number | string | boolean;
export type Scope = Readonly<Record<string, unknown>>;

class CanvasStore {
  private values: Scope;
  private version = 0;
  private listeners = new Set<() => void>();
  /** consumers that already rendered with this version (stamp = write count) */
  private rendered = new Map<number, Set<string>>();
  private frozen: Scope | null = null;
  private frozenAt = -1;
  /** How many providers currently hold this store. 2026-10-05: the LRU used
   *  to evict by INSERTION ORDER with no liveness check, so on a page with
   *  >24 canvases it could evict the store of a card still on screen — that
   *  card's slider snapped back and every later write went to an orphan. */
  mounted = 0;
  /** The canvas id this store belongs to. `useCanvasReset` read a `__id` field
   *  that was never assigned anywhere, so reset was a silent no-op. */
  readonly id: string;

  constructor(initial: Scope, id = "") {
    this.values = initial;
    this.id = id;
  }

  get(key: string, fallback: StateValue | number | string | boolean): unknown {
    // own-property read only: state keys resolve from the canvas fence's own
    // `state`/control writes, never from a prototype chain.
    return Object.prototype.hasOwnProperty.call(this.values, key) && this.values[key] !== undefined
      ? this.values[key]
      : fallback;
  }

  set(key: string, v: StateValue) {
    if (this.values[key] === v) return; // identical write → no notify
    this.values = { ...this.values, [key]: v };
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Write a control's authored default ONLY if the key is still unset (never
   *  overwrites a user edit or an authored state value). Deliberately NO version
   *  bump / notify: seeding happens during render, before anyone reads. */
  seed(key: string, v: StateValue | StateValue[]) {
    if (Object.prototype.hasOwnProperty.call(this.values, key) && this.values[key] !== undefined) return;
    this.values = { ...this.values, [key]: v };
    this.frozen = null; // the scope changed without a version bump — drop the cache
  }

  reset(fresh: Scope) {
    this.values = fresh;
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Per-render bookkeeping: blocks register so the store can tell "user
   *  dragged" apart from "React re-rendered" and let the streaming parser lie
   *  about nothing. (Returns the version the subtree rendered at.) */
  renderedAt(id: string): number {
    let set = this.rendered.get(this.version);
    if (!set) { set = new Set(); this.rendered.set(this.version, set); }
    if (this.rendered.size > 16) { const k = this.rendered.keys().next().value; if (k !== undefined) this.rendered.delete(k); }
    set.add(id);
    return this.version;
  }

  /** Current values, frozen so a consumer cannot mutate another card's state. */
  snapshot(): Scope {
    if (!this.frozen || this.frozenAt !== this.version) {
      this.frozen = Object.freeze({ ...this.values });
      this.frozenAt = this.version;
    }
    return this.frozen;
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };
  getVersion = () => this.version;
}

const storeMap = new Map<string, CanvasStore>();
/** Cap on retained stores. Same budget as before; the eviction SKIP rule is
 *  what changed (see the `mounted` field). */
const MAX_STORES = 24;
/** The authored `state` each canvas id was seeded with (for the reset button and
 *  for "did the spec's initial state actually change?"). */
const sAuthored = new Map<string, Scope>();

/** Store for one canvas id — created on first demand, reused across re-renders. */
export function canvasStore(canvasId: string, initial: Scope): CanvasStore {
  let s = storeMap.get(canvasId);
  const sig = stableSig(initial);
  if (!s) {
    s = new CanvasStore(initial, canvasId);
    // Record the authored state on CREATION too: without it the first re-parse
    // compares `undefined` against the same spec's signature and resets the
    // user's edits even though nothing changed.
    sAuthored.set(canvasId, initial);
    storeMap.set(canvasId, s);
    if (storeMap.size > MAX_STORES) {
      // drop the OLDEST store, but never one a mounted card is using: evicting
      // a live store left the card frozen forever (its slider snapped back and
      // further writes went to an orphan). See mounted-count below.
      for (const [id, st] of storeMap) {
        if (st.mounted > 0) continue;
        storeMap.delete(id);
        sAuthored.delete(id);
        break;
      }
    }
    return s;
  }
  // spec state changed underneath us (history re-parse): reset only when the
  // authored initial state actually differs, so user edits normally survive.
  //
  // HIGH (2026-10-05): compare a KEY-ORDER-INDEPENDENT signature. Plain
  // JSON.stringify made key order part of the identity, so a re-parse that
  // emitted the same values in a different order silently reset every slider
  // the user had moved. Model output is not key-stable, and the sanitizer
  // copies `state` through untouched, so nothing normalised the order.
  const authored = stableSig(sAuthored.get(canvasId));
  if (authored !== sig) { s.reset(initial); sAuthored.set(canvasId, initial); }
  return s;
}

/** Canonical signature: same keys AND same values, regardless of key order. */
function stableSig(v: unknown): string {
  if (!v || typeof v !== "object" || Array.isArray(v)) return JSON.stringify(v ?? null) ?? "";
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  const parts: string[] = [];
  for (const k of keys) parts.push(`${JSON.stringify(k)}:${stableSig(o[k])}`);
  return "{" + parts.join(",") + "}";
}

const Ctx = createContext<CanvasStore | null>(null);

/** Fallback store for a control emitted into a card with no `state` seed:
 *  the control still works (writes into a module-fallback ""), the card never
 *  crashes, and nothing persists across re-parse. */
const FALLBACK_STORE = new CanvasStore({});

/** Provide the store once per canvas card (inside CanvasView's body). */
export function CanvasStateProvider({ canvasId, initial, children }: { canvasId: string; initial: Scope; children: ReactNode }) {
  const store = useMemo(() => canvasStore(canvasId, initial), [canvasId, initial]);
  // Mount/unmount accounting: the LRU skips stores with mounted > 0, so a card
  // still on screen can never be evicted. StrictMode double-invokes effects,
  // hence the idempotent count rather than a boolean flag.
  useEffect(() => {
    store.mounted++;
    return () => { store.mounted--; };
  }, [store]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

function useStore(): CanvasStore {
  return useContext(Ctx) ?? FALLBACK_STORE; // fail-soft: no provider ⇒ writes go nowhere durable
}

/** Subscribe: any state write re-renders the calling component. */
export function useCanvasStateVersion(): number {
  const s = useStore();
  return useSyncExternalStore(s.subscribe, s.getVersion, () => 0);
}

/** Read one value with the current version tearing through the subscription. */
export function useCanvasValue<T>(key: string, fallback: T): T {
  const s = useStore();
  useCanvasStateVersion();
  return (s.get(key, fallback as unknown as StateValue)) as T;
}

/** Write one value (the only write surface controls use). */
export function useCanvasSet(): (key: string, v: StateValue) => void {
  const s = useStore();
  return s.set.bind(s);
}

/** Read the full current scope for expression evaluation (stable identity per version). */
export function useCanvasScope(): Scope {
  const s = useStore();
  useCanvasStateVersion();
  return s.snapshot();
}

/** Seed one control default into the store. Callable during render and
 *  idempotent — seeding never notifies, so the scope must be read AFTER it. */
export function useCanvasSeeder(): (key: string, v: StateValue | StateValue[]) => void {
  // No provider (a card still streaming, or a gate body) means the module-level FALLBACK_STORE, which every
  // such card shares. Seeding it would carry one card's slider default into the next card's control, so a
  // provider-less card seeds nothing and its controls just show their own fallback.
  const owned = useContext(Ctx);
  return useMemo(() => (owned ? owned.seed.bind(owned) : () => {}), [owned]);
}

/** Reset button support: restores the authored initial state for one canvas. */
export function useCanvasReset(): () => void {
  const s = useStore();
  // 2026-10-05: this read `(s as {__id?: string}).__id`, and `__id` was NEVER
  // assigned anywhere in the repo — so canvasId was always "" and
  // `sAuthored.get("")` was always undefined, making reset a silent no-op.
  // The store now carries its own id (see CanvasStore.id).
  return useMemo(() => () => {
    const init = sAuthored.get(s.id);
    if (init) s.reset(init);
  }, [s]);
}
