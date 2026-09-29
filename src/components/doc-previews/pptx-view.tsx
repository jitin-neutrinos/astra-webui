// PPTX preview via pptx-preview — HTML/CSS slide rendering with deck nav.
import { useEffect, useRef } from "react";
import { init } from "pptx-preview";

interface Props {
  url: string;
  onLoad: () => Promise<ArrayBuffer>;
  onError: (message: string) => void;
}

export default function PptxView({ url, onLoad, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";

    (async () => {
      try {
        const data = await onLoad();
        if (!alive) return;
        const width = Math.min(host.clientWidth || 800, 960);
        const renderer = init(host, { width, height: (width * 9) / 16, mode: "list" });
        renderer.preview(data);
      } catch (e) {
        if (alive) onError(String((e as Error)?.message ?? e));
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return (
    <div className="h-full w-full overflow-auto bg-slate-200 p-3">
      <div ref={hostRef} className="mx-auto" style={{ maxWidth: 960 }} />
    </div>
  );
}
