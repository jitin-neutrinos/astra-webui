// Page-level toast host. Muted while the media viewer is open (yarl inerts page
// siblings → ViewerToast inside the lightbox is the one that shows then).
import { useEffect, useState } from "react";
import { TOAST_EVENT } from "@/lib/toast";

export function ToastHost({ muted }: { muted?: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (muted) { setMsg(null); return; }
    let hideT: number | undefined;
    const on = (e: Event) => {
      const detail = String((e as CustomEvent).detail ?? "");
      window.clearTimeout(hideT);
      setLeaving(false);
      setMsg(detail);
      hideT = window.setTimeout(() => {
        setLeaving(true);
        hideT = window.setTimeout(() => setMsg(null), 130);
      }, 2400);
    };
    window.addEventListener(TOAST_EVENT, on);
    return () => {
      window.removeEventListener(TOAST_EVENT, on);
      window.clearTimeout(hideT);
    };
  }, [muted]);

  if (!msg) return null;
  return <div className="astra-toast" data-leaving={leaving || undefined} role="status" aria-live="polite">{msg}</div>;
}
