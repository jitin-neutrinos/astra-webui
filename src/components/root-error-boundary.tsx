// LAST-RESORT boundary: an error ANYWHERE in the app must never leave a blank white screen. The owner saw
// the page go white on chat-init / first canvas render, fixed only by a manual reload — this boundary turns
// that death into a one-tap recovery surface (reload button) with the error visible.
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[app] crashed", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "rgb(10 14 23)", color: "rgb(248 250 252)", fontFamily: "var(--font-sans, sans-serif)", padding: 24 }}>
        <div style={{ maxWidth: 460, textAlign: "center" }}>
          <h1 style={{ font: "600 18px/1.4 var(--font-sans, sans-serif)", margin: 0 }}>Something broke while loading.</h1>
          <p style={{ font: "400 13px/1.5 var(--font-sans, sans-serif)", color: "rgb(248 250 252 / 0.6)", margin: "10px 0 0" }}>
            {String(error?.message || error).slice(0, 260)}
          </p>
          <button
            type="button"
            onClick={() => location.reload()}
            style={{ marginTop: 18, padding: "10px 18px", borderRadius: 9999, border: "0", background: "var(--color-accent, #22d3ee)", color: "#06121a", font: "600 14px var(--font-sans, sans-serif)", cursor: "pointer" }}
          >Reload</button>
        </div>
      </div>
    );
  }
}

export default RootErrorBoundary;
