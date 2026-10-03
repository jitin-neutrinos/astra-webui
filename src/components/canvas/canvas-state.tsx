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
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type StateValue = number | string | boolean;
export type Scope = Readonly<Record<string, unknown>>;

class CanvasStore {
  private values: Scope;
  private version = 0;
  private listeners = new Set<() => void>();
  /** consumers that already rendered with this version (stamp = write count) */
  private rendered = new Map<number, Set<string>>();

  constructor(initial: Scope) {
    this.values = initial;
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

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };
  getVersion = () => this.version;
}

const storeMap = new Map<string, CanvasStore>();

/** Store for one canvas id — created on first demand, reused across re-renders. */
export function canvasStore(canvasId: string, initial: Scope): CanvasStore {
  let s = storeMap.get(canvasId);
  const sig = JSON.stringify(initial) ?? "";
  if (!s) {
    s = new CanvasStore(initial);
    storeMap.set(canvasId, s);
    if (storeMap.size > 24) {
      // drop the oldest store; the chat prunes history rows the same way
      const first = storeMap.keys().next().value;
      if (first !== undefined) storeMap.delete(first);
    }
    return s;
  }
  // spec state changed underneath us (history re-parse): reset only when the
  // authored initial state actually differs, so user edits normally survive.
  const authored = JSON.stringify(sAuthored.get(canvasId));
  if (authored !== sig) { s.reset(initial); sAuthored.set(canvasId, initial); }
  return s;
}
const sAuthored = new Map<string, Scope>();

const Ctx = createContext<CanvasStore | null>(null);

/** Fallback store for a control emitted into a card with no `state` seed:
 *  the control still works (writes into a module-fallback ""), the card never
 *  crashes, and nothing persists across re-parse. */
const FALLBACK_STORE = new CanvasStore({});

/** Provide the store once per canvas card (inside CanvasView's body). */
export function CanvasStateProvider({ canvasId, initial, children }: { canvasId: string; initial: Scope; children: ReactNode }) {
  const store = useMemo(() => canvasStore(canvasId, initial), [canvasId, initial]);
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
  const v = useCanvasStateVersion();
  return v === 0 ? s["values" as keyof CanvasStore] as unknown as Scope : (s as unknown as { values: Scope }).values;
}

/** Reset button support: restores the authored initial state for one canvas. */
export function useCanvasReset(): () => void {
  const s = useStore();
  const canvasId = (s as unknown as { __id?: string }).__id ?? "";
  return () => {
    const init = sAuthored.get(canvasId);
    if (init) s.reset(init);
  };
}
