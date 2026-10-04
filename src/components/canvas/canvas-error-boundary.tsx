// One thrown error in one canvas card must never blank the whole page (owner 2026-10-04: white-screen-of-death
// at chat-init / first canvas render). This boundary contains the blast radius to the card: users see a calm,
// dismissible placeholder with the error, and the chat keeps working. Reload-fixes things by re-running the
// same code — so the boundary also offers a Retry, which re-mounts the children.
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode; id: string; }
interface State { error: Error | null; }

export class CanvasErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // console-only for now: a telemetry hook can attach later. Never throw from here.
    console.error("[canvas] card crashed", this.props.id, error, info.componentStack);
    // a lazy-chunk failure after a deploy is a STALE TAB, not a card bug: reload once
    if (isStaleChunkError(error)) reloadOnce();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="ast-canvas ast-canvas-crashed" role="alert" style={{ border: "1px solid rgb(var(--c-89) / 0.14)", borderRadius: 14, padding: "12px 14px", background: "rgb(var(--c-6) / 0.4)" }}>
        <p style={{ margin: 0, font: "600 13px/1.4 var(--font-sans)", color: "rgb(var(--c-89))" }}>This card failed to render.</p>
        <p style={{ margin: "6px 0 0", font: "400 12px/1.45 var(--font-sans)", color: "rgb(var(--c-89) / 0.66)", fontFamily: "var(--font-mono)" }}>
          {String(error?.message || error).slice(0, 220)}
        </p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          style={{ marginTop: 10, padding: "6px 12px", borderRadius: 9999, border: "1px solid rgb(var(--c-89) / 0.2)", background: "transparent", color: "rgb(var(--c-89))", font: "600 12px var(--font-sans)", cursor: "pointer" }}
        >Try again</button>
      </div>
    );
  }
}

export default CanvasErrorBoundary;


// Stale-deploy guard: a tab loaded BEFORE a deploy asks this deploy for old hashed chunks, the dynamic
// import gets index.html (or a 404) — historically the "text/html is not a valid JavaScript MIME type"
// white-screen. Auto-reload once per tab after a deploy so the referenced hashes match the served assets.
function isStaleChunkError(e: unknown): boolean {
  const s = String((e as Error)?.message || e);
  return /dynamically imported module|Loading chunk \d+ failed|error loading.*chunk|MIME incompatible for unknown reason/i.test(s)
    || ("function" === typeof (e as any)?.name && /ChunkLoadError/.test((e as any).name));
}
function reloadOnce(): boolean {
  const key = "astra:chunk-reload";
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch { /* private mode: skip the guard, never loop */ return false; }
  setTimeout(() => location.reload(), 350);
  return true;
}
