import { useState, useEffect, useCallback } from "react";

export function useOpsPoll<T>(url: string, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function fetchOnce() {
      try {
        const res = await fetch(url);
        if (!alive) return;
        if (res.ok) {
          const json = await res.json();
          if (alive) setData(json);
        } else {
          if (alive) setError(`HTTP ${res.status}`);
        }
      } catch (e: any) {
        if (alive) setError(e?.message || "fetch error");
      }
    }

    fetchOnce();
    timer = setInterval(() => { if (alive) fetchOnce(); }, intervalMs);

    function onVis() {
      if (document.visibilityState === "visible" && alive) fetchOnce();
    }
    document.addEventListener("visibilitychange", onVis);

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [url, intervalMs, refreshKey]);

  return { data, error, refresh };
}
