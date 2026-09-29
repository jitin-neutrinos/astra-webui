// App-wide toast bus. ToastHost (page) and ViewerToast (inside yarl) both listen —
// yarl sets inert+aria-hidden on page siblings while open, so the viewer needs its own node.
export const TOAST_EVENT = "astra:toast";

export function toast(msg: string): void {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: msg }));
}
