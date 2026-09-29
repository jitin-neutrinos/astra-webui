// PDF preview via pdfjs-dist, rendered page-by-page into canvases.
// Chosen over the old <iframe> because the Capacitor WebViews (iPad/Android
// wraps) have no built-in PDF viewer — pdfjs works everywhere.
//
// Worker strategy (v2): pdf.js loads its worker with `import(workerSrc)`, which fails
// when the browser holds a cache entry for the asset URL from before the server sent
// the correct JS MIME (the entry is `immutable`, so the failure recurs). Vite's
// `?worker&inline` embeds the worker in the bundle as a blob — the browser imports a
// blob: URL that never touches the HTTP cache, so the poisoned entry is irrelevant.
// pdfjsLib.GlobalWorkerOptions.workerPort takes the constructed Worker directly.
import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker&inline";

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

interface Props {
  url: string;
  onLoad: () => Promise<ArrayBuffer>;
  onError: (message: string) => void;
}

export default function PdfView({ url, onLoad, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";

    (async () => {
      try {
        console.log("[pdf-view] effect start");
        const data = await onLoad();
        if (!alive) return console.log("[pdf-view] stale after load");
        console.log("[pdf-view] bytes", data.byteLength);
        const doc = await pdfjsLib.getDocument({ data }).promise;
        if (!alive) return;
        console.log("[pdf-view] parsed, pages:", doc.numPages);
        setNumPages(doc.numPages);

        const targetWidth = Math.min(host.clientWidth || 800, 900);
        for (let i = 1; i <= doc.numPages; i++) {
          if (!alive) return;
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = targetWidth / base.width;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width * 2; // 2x supersample, CSS scales down
          canvas.height = viewport.height * 2;
          canvas.style.width = "100%";
          canvas.style.display = "block";
          canvas.className = "rounded shadow";

          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("canvas unavailable");
          await page.render({ canvas, canvasContext: ctx, viewport, transform: [2, 0, 0, 2, 0, 0] } as Parameters<typeof page.render>[0]).promise;

          const wrap = document.createElement("div");
          wrap.className = "mx-auto mb-3";
          wrap.style.maxWidth = `${targetWidth}px`;
          wrap.appendChild(canvas);

          const label = document.createElement("div");
          label.className = "pb-1 text-center font-mono text-[10px] text-slate-400";
          label.textContent = `${i} / ${doc.numPages}`;
          wrap.appendChild(label);

          host.appendChild(wrap);
        }
        if (alive) setReady(true);
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
    <div className="relative h-full w-full overflow-auto bg-slate-100 p-3">
      <div ref={hostRef} />
      {!ready && numPages === null && (
        <div className="flex h-full items-center justify-center text-xs text-slate-400">Rendering PDF…</div>
      )}
    </div>
  );
}
