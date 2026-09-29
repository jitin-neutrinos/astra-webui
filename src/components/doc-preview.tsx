// Lazy by design: each engine loads on first use, so PDF-only users never
// download the docx/xlsx/pptx code.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { ext, downloadUrl } from "@/lib/media-paths";
import { previewKind } from "@/lib/doc-preview-kind";
import { getLocalMediaBytes } from "@/lib/media-local-cache";

const PdfViewer = lazy(() => import("./doc-previews/pdf-view"));
const DocxViewer = lazy(() => import("./doc-previews/docx-view"));
const XlsxViewer = lazy(() => import("./doc-previews/xlsx-view"));
const PptxViewer = lazy(() => import("./doc-previews/pptx-view"));

function Loading({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center gap-2 text-xs text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
    );
}

function ErrorBox({ message, name }: { message: string; name: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-slate-400">
      <FileText className="h-6 w-6 text-slate-500" />
      <div>{message}</div>
      <a href={downloadUrl(name)} className="font-mono text-[11px] text-cyanx hover:underline">
        download instead
      </a>
    </div>
  );
}

interface DocPreviewProps {
  url: string;
  name: string;
  /** Server-side absolute path — enables the device-local cache (download once, render locally after) */
  path?: string;
  /** Height class for the inline panel; full-screen viewer passes its own */
  className?: string;
}

export function DocPreview({ url, name, path, className }: DocPreviewProps) {
  const kind = useMemo(() => previewKind(name), [name]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), [url]);

  if (kind === "unsupported") {
    return (
      <ErrorBox
        name={name}
        message={`No inline preview for ${ext(name).toUpperCase() || "this file type"} — download to open it.`}
      />
    );
  }

  const onLoad = async (): Promise<ArrayBuffer> => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    // Device-local first: download once into Cache Storage, later opens render
    // from the on-device copy (same bucket/contract as images & video). Falls
    // back to a direct proxy fetch when the cache is unavailable.
    if (path) {
      const local = await getLocalMediaBytes(path, name);
      if (local) return local;
    }
    const res = await fetch(url, { signal: ac.signal, credentials: "same-origin" });
    if (!res.ok) throw new Error(`fetch failed (${res.status})`);
    return res.arrayBuffer();
  };

  const shared = { onLoad, onError: setError };

  return (
    <div className={className ?? "h-[480px] max-h-[70vh] w-full bg-white"}>
      <Suspense fallback={<Loading label="Loading viewer…" />}>
        {error ? (
          <ErrorBox name={name} message={error} />
        ) : kind === "pdf" ? (
          <PdfViewer url={url} {...shared} />
        ) : kind === "docx" ? (
          <DocxViewer url={url} {...shared} />
        ) : kind === "xlsx" ? (
          <XlsxViewer url={url} {...shared} />
        ) : kind === "pptx" ? (
          <PptxViewer url={url} {...shared} />
        ) : (
          <TextView url={url} {...shared} />
        )}
      </Suspense>
    </div>
  );
}

function TextView({ url, onLoad, onError }: { url: string; onLoad: () => Promise<ArrayBuffer>; onError: (m: string) => void }) {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    onLoad()
      .then((buf) => {
        if (!alive) return;
        const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
        if (/\uFFFD{3,}/.test(text)) throw new Error("binary file — no text preview");
        setContent(text);
      })
      .catch((e) => alive && onError(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  if (content === null) return <Loading label="Reading file…" />;
  return (
    <pre className="h-full w-full overflow-auto bg-[#0d1b2a] p-4 font-mono text-[11px] leading-relaxed text-slate-200 whitespace-pre-wrap">
      {content}
    </pre>
  );
}
