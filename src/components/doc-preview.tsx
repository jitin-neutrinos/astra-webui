// Lazy by design: each engine loads on first use, so PDF-only users never
// download the docx/xlsx/pptx code.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { downloadUrl } from "@/lib/media-paths";
import { extOf, mediaKind } from "@/lib/media-kinds";
import { downloadFile } from "@/lib/download";

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

function ErrorBox({ message, name, path }: { message: string; name: string; path?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-slate-400">
      <FileText className="h-6 w-6 text-slate-500" />
      <div>{message}</div>
      {path ? (
        <button
          type="button"
          onClick={() => downloadFile(path, name)}
          className="font-mono text-[11px] text-accent hover:underline"
        >
          download instead
        </button>
      ) : (
        <a href={downloadUrl(name)} className="font-mono text-[11px] text-accent hover:underline">
          download instead
        </a>
      )}
    </div>
  );
}

interface DocPreviewProps {
  url: string;
  name: string;
  /** Server-side absolute path — needed for the download button (fixes name-vs-path bug) */
  path?: string;
  /** Height class for the inline panel; full-screen viewer passes its own */
  className?: string;
  /** Full-bleed mode for the media viewer */
  fill?: boolean;
}

export function DocPreview({ url, name, path, className, fill }: DocPreviewProps) {
  const kind = useMemo(() => {
    const k = mediaKind(name);
    // engine mapping: pdf/docx/xlsx/pptx have their own viewers, everything textual → text
    if (k === "pdf" || k === "docx" || k === "xlsx" || k === "pptx") return k;
    return "text" as const;
  }, [name]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), [url]);

  if (mediaKind(name) === "other" || mediaKind(name) === "archive" || mediaKind(name) === "image" || mediaKind(name) === "video" || mediaKind(name) === "audio") {
    return (
      <ErrorBox
        name={name}
        path={path}
        message={`No preview for ${extOf(name).toUpperCase() || "this file type"} — download to open it.`}
      />
    );
  }

  const onLoad = async (): Promise<ArrayBuffer> => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const res = await fetch(url, { signal: ac.signal, credentials: "same-origin" });
    if (!res.ok) throw new Error(`fetch failed (${res.status})`);
    return res.arrayBuffer();
  };

  const shared = { onLoad, onError: setError };

  return (
    <div className={fill ? "mv-doc" : className ?? "h-[480px] max-h-[70vh] w-full mv-doc"}>
      <Suspense fallback={<Loading label="Loading viewer…" />}>
        {error ? (
          <ErrorBox name={name} path={path} message={error} />
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
    <pre className="mv-text">
      {content}
    </pre>
  );
}
