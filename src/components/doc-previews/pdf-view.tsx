// PDF preview via pdfjs-dist — virtualized: placeholder divs for every page
// (page-1 aspect ratio), IntersectionObserver renders only near-viewport pages,
// canvases released when >4 pages away from the most-visible one.
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

// Worker init is DEFERRED to first getDocument, not module scope: the inline-
// worker constructor pulls helpers that live in the index chunk, and module-
// scope construction raced chunk init order under rolldown code-splitting
// ("Cannot access 't' before initialization" → every PDF preview failed).
let workerReady = false;
function ensurePdfWorker() {
  if (workerReady) return;
  pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();
  workerReady = true;
}

interface Props {
  url: string;
  name?: string;
  onLoad?: () => Promise<ArrayBuffer>;
  onError: (message: string) => void;
}

// module-level concurrency cap shared by page renders AND pdfThumb (R9)
const running = new Set<Promise<unknown>>();
const waiting: Array<() => void> = [];
let queued = 0;
function limit<T>(job: () => Promise<T>): Promise<T> {
  // The runner must fire in a MICROTASK, not synchronously inside the Promise
  // executor: `running.add(run)` references `run` itself, and a synchronous
  // exec() reads the binding before `new Promise` returns → TDZ crash.
  // A `claimed` counter is checked optimistically BEFORE the microtask, so a
  // synchronous burst of limit() calls cannot all observe running.size 0.
  const run = new Promise<T>((resolve, reject) => {
    const exec = () => {
      job().then(resolve, reject).finally(() => {
        running.delete(run as unknown as Promise<unknown>);
        waiting.shift()?.();
      });
      running.add(run as unknown as Promise<unknown>);
    };
    if (running.size + queued < 2) { queued++; queueMicrotask(() => { queued--; exec(); }); }
    else waiting.push(exec);
  });
  return run;
}

// LRU cache of page-1 thumbnails (object URLs, revoked on evict)
const thumbCache = new Map<string, string>();
async function cachedThumb(doc: pdfjsLib.PDFDocumentProxy, key: string, width: number): Promise<string> {
  const hit = thumbCache.get(key);
  if (hit) {
    thumbCache.delete(key);
    thumbCache.set(key, hit); // LRU bump
    return hit;
  }
  const url = await limit(async () => {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = width / base.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    await page.render({ canvas, canvasContext: ctx, viewport } as Parameters<typeof page.render>[0]).promise;
    return canvas.toDataURL("image/jpeg", 0.8);
  });
  thumbCache.set(key, url);
  if (thumbCache.size > 40) {
    const oldest = thumbCache.keys().next().value;
    if (oldest !== undefined && oldest !== key) thumbCache.delete(oldest);
  }
  return url;
}

/** Page-1 JPEG thumbnail (data URL) for grid tiles. Loads the doc via range requests. */
export async function pdfThumb(url: string, width: number): Promise<string> {
  ensurePdfWorker();
  const doc = await pdfjsLib.getDocument({ url, withCredentials: true, disableAutoFetch: true, rangeChunkSize: 262144 }).promise;
  try {
    return await cachedThumb(doc, `${url}#${width}`, width);
  } finally {
    void doc.loadingTask.destroy();
  }
}

export default function PdfView({ url, onLoad, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ pages: number; cur: number; zoom: number }>({ pages: 0, cur: 1, zoom: 1 });

  useEffect(() => {
    let alive = true;
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wraps = new Map<number, HTMLDivElement>();
    const canvases = new Map<number, HTMLCanvasElement>();
    const rendered = new Set<number>();
    let doc: pdfjsLib.PDFDocumentProxy | null = null;
    let mostVisible = 1;
    let fitW = host.clientWidth || 800;
    let baseAspect = 8.5 / 11;

    const releaseFar = (pageNo: number) => {
      for (const [n, wrap] of wraps) {
        if (Math.abs(n - pageNo) > 4 && canvases.has(n)) {
          const c = canvases.get(n)!;
          c.width = 0; c.height = 0;
          canvases.delete(n);
          rendered.delete(n);
          const ph = wrap.querySelector(".mv-pdf-ph");
          if (ph) (ph as HTMLElement).style.display = "";
        }
      }
    };

    const renderPage = async (pageNo: number) => {
      if (!doc || rendered.has(pageNo) || !alive) return;
      rendered.add(pageNo);
      try {
        const wrap = wraps.get(pageNo);
        if (!wrap) return;
        await limit(async () => {
          if (!alive || !doc) return;
          const page = await doc.getPage(pageNo);
          const base = page.getViewport({ scale: 1 });
          const targetW = fitW * state0.zoom;
          const scale = targetW / base.width;
          const viewport = page.getViewport({ scale });
          let canvas = canvases.get(pageNo);
          if (!canvas) {
            canvas = document.createElement("canvas");
            canvas.style.width = "100%";
            canvas.style.display = "block";
            canvases.set(pageNo, canvas);
            const ph = wrap.querySelector(".mv-pdf-ph");
            if (ph) (ph as HTMLElement).style.display = "none";
            wrap.appendChild(canvas);
          }
          canvas.width = Math.ceil(viewport.width * dpr);
          canvas.height = Math.ceil(viewport.height * dpr);
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("canvas unavailable");
          await page.render({ canvas, canvasContext: ctx, viewport, transform: [dpr, 0, 0, dpr, 0, 0] } as Parameters<typeof page.render>[0]).promise;
        });
      } catch (e) {
        if (alive) onError(String((e as Error)?.message ?? e));
      }
    };

    // zoom captured at effect start (zoom changes re-run the effect via dep)
    const state0 = { zoom: state.zoom };

    const io = new IntersectionObserver((entries) => {
      if (!alive) return;
      let best = mostVisible;
      let bestRatio = 0;
      for (const en of entries) {
        const n = Number((en.target as HTMLElement).dataset.page);
        if (en.intersectionRatio > bestRatio) {
          bestRatio = en.intersectionRatio;
          best = n;
        }
        if (en.isIntersecting) void renderPage(n);
      }
      if (bestRatio > 0) {
        mostVisible = best;
        releaseFar(best);
        setState((s) => (s.cur === best ? s : { ...s, cur: best }));
      }
    }, { root: host, rootMargin: "150% 0px" });

    (async () => {
      try {
        ensurePdfWorker();
        doc = onLoad
          ? await pdfjsLib.getDocument({ data: await onLoad() }).promise
          : await pdfjsLib.getDocument({ url, withCredentials: true, disableAutoFetch: true, rangeChunkSize: 262144 }).promise;
        if (!alive) return;
        const p1 = await doc.getPage(1);
        const v1 = p1.getViewport({ scale: 1 });
        baseAspect = v1.width / v1.height;
        fitW = Math.min(host.clientWidth || 800, 940) - 24;
        if (alive) setState((s) => ({ ...s, pages: doc!.numPages }));

        for (let i = 1; i <= doc.numPages; i++) {
          if (!alive) return;
          const wrap = document.createElement("div");
          wrap.className = "mv-pdf-page";
          wrap.dataset.page = String(i);
          wrap.style.aspectRatio = String(baseAspect);
          wrap.style.width = `${fitW * state0.zoom}px`;
          const ph = document.createElement("div");
          ph.className = "mv-pdf-ph";
          ph.style.width = "100%";
          ph.style.height = "100%";
          wrap.appendChild(ph);
          host.appendChild(wrap);
          wraps.set(i, wrap);
          io.observe(wrap);
        }
        void renderPage(1);
      } catch (e) {
        if (alive) onError(String((e as Error)?.message ?? e));
      }
    })();

    return () => {
      alive = false;
      io.disconnect();
      for (const c of canvases.values()) { c.width = 0; c.height = 0; }
      void doc?.loadingTask.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, state.zoom]);

  const setZoom = (z: number) => setState((s) => ({ ...s, zoom: Math.min(3, Math.max(0.5, Math.round(z * 100) / 100)) }));

  return (
    <div className="relative h-full w-full">
      <div className="mv-pdf-bar">
        <button type="button" aria-label="Zoom out" onClick={() => setZoom(state.zoom - 0.25)}>-</button>
        <span aria-live="off">{state.pages ? `${state.cur} / ${state.pages}` : "…"}</span>
        <button type="button" onClick={() => setZoom(1)}>Fit</button>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom(state.zoom + 0.25)}>+</button>
      </div>
      <div ref={hostRef} className="h-full w-full overflow-auto mv-doc-gutter p-3" />
    </div>
  );
}
