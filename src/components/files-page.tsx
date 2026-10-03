import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { FilesSkeleton } from "./ui/skeletons";
import { ArrowLeft, RefreshCw, AlertTriangle, Search, Download, Play, ChevronLeft, ChevronRight, LayoutGrid, Rows3 } from "lucide-react";
import { getHermesHome, getHermesFiles } from "@/lib/session-files";
import { mediaKind, kindInfo, badgeLabel } from "@/lib/media-kinds";
import { toItem, type MediaItem } from "@/lib/media-paths";
import { downloadFile } from "@/lib/download";
import { getLastSessionInfo } from "@/lib/hermes-ws";

const MediaViewer = lazy(() => import("./media-viewer"));

function fmtSize(n: number) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type FileEntry = {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
  mtime: number;
  mime_type: string;
};

// ---- one gallery card ------------------------------------------------------
function GalleryCard({ entry, onOpen }: { entry: FileEntry; onOpen: () => void }) {
  const [error, setError] = useState(false);
  const kind = mediaKind(entry.name);
  const visual = kind === "image" || kind === "video";

  return (
    <div className="fg-card" data-kind={kind}>
      <button type="button" className="fg-thumb" onClick={onOpen} aria-label={`Preview ${entry.name}`} title="Preview">
        {kind === "image" && !error && (
          <img src={`/api/hx/files/download?path=${encodeURIComponent(entry.path)}`} alt={entry.name}
            loading="lazy" decoding="async" onError={() => setError(true)} className="fg-img" />
        )}
        {kind === "video" && !error && (
          <>
            <video src={`/api/hx/files/stream?path=${encodeURIComponent(entry.path)}`}
              preload="metadata" muted playsInline onError={() => setError(true)} className="fg-img" />
            <span className="fg-play"><Play className="w-5 h-5" /></span>
          </>
        )}
        {((visual && error) || !visual) && (
          <span className="fg-doc">
            <span className="fg-badge">{badgeLabel(entry.name)}</span>
            {kind === "audio" && <Play className="w-4 h-4 opacity-60" />}
          </span>
        )}
        <span className="fg-actions">
          <button type="button" className="fg-act"
            aria-label={`Download ${entry.name}`} title="Download"
            onClick={(e) => { e.stopPropagation(); downloadFile(entry.path, entry.name); }}>
            <Download className="w-3.5 h-3.5" />
          </button>
        </span>
      </button>
      <div className="fg-meta">
        <p className="fg-name" title={entry.name}>{entry.name}</p>
        <p className="fg-sub">
          {fmtSize(entry.size) && <span>{fmtSize(entry.size)}</span>}
          {fmtSize(entry.size) && <span aria-hidden="true">·</span>}
          <span>{new Date(entry.mtime * 1000).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}</span>
        </p>
      </div>
    </div>
  );
}

// ---- toolbar: search / sort / filter --------------------------------------
const KIND_FILTERS = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "video", label: "Videos" },
  { id: "audio", label: "Audio" },
  { id: "doc", label: "Docs" },
] as const;
type FilterId = (typeof KIND_FILTERS)[number]["id"];

function isDoc(kind: string) {
  return ["pdf", "docx", "xlsx", "pptx", "text", "archive", "other"].includes(kind);
}

function matchesFilter(kind: string, f: FilterId) {
  if (f === "all") return true;
  if (f === "doc") return isDoc(kind);
  return kind === f;
}

const SORTS = [
  { id: "recent", label: "Recent" },
  { id: "name", label: "Name A→Z" },
  { id: "size", label: "Largest" },
] as const;
type SortId = (typeof SORTS)[number]["id"];

// ---- pager ------------------------------------------------------------------
const PER_PAGE = 25;

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="fg-pager" role="navigation" aria-label="Files pages">
      <button className="fg-page-btn" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="fg-page-info">
        Page <strong>{page + 1}</strong> / {pages}
      </span>
      <button className="fg-page-btn" disabled={page === pages - 1} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ---- section ----------------------------------------------------------------
function GallerySection({ title, entries, loading, error, onRetry, onOpen }: {
  title: string;
  entries: FileEntry[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onOpen: (list: FileEntry[], i: number) => void;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [sort, setSort] = useState<SortId>("recent");
  const [page, setPage] = useState(0);
  const [grid, setGrid] = useState(true);

  useEffect(() => { setPage(0); }, [q, filter, sort]);

  const filtered = useMemo(() => {
    let list = entries;
    if (filter !== "all") list = list.filter((e) => matchesFilter(mediaKind(e.name), filter));
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(needle));
    }
    const sorted = [...list];
    if (sort === "recent") sorted.sort((a, b) => b.mtime - a.mtime);
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "size") sorted.sort((a, b) => b.size - a.size);
    return sorted;
  }, [entries, q, filter, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, pages - 1);
  const slice = filtered.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

  return (
    <section>
      <h3 className="fg-title">
        <span>{title}</span>
        <span className="fg-count">{filtered.length}</span>
        <button onClick={onRetry} className="p-1 hover:text-accent transition" aria-label="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
      </h3>

      <div className="fg-toolbar">
        <label className="fg-search">
          <Search className="w-3.5 h-3.5 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files…" aria-label={`Search ${title}`} />
        </label>
        <div className="fg-filters" role="group" aria-label="Filter by type">
          {KIND_FILTERS.map((f) => (
            <button key={f.id} className={`fg-chip ${filter === f.id ? "fg-chip-on" : ""}`} onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}>
              {f.label}
            </button>
          ))}
        </div>
        <select className="fg-sort" value={sort} onChange={(e) => setSort(e.target.value as SortId)} aria-label="Sort">
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button className={`fg-chip ${grid ? "fg-chip-on" : ""}`} onClick={() => setGrid(!grid)} aria-pressed={grid} aria-label={grid ? "Grid view" : "List view"} title={grid ? "Grid view" : "List view"}>
          {grid ? <LayoutGrid className="w-3.5 h-3.5" /> : <Rows3 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {loading ? (
        <FilesSkeleton n={6} />
      ) : error ? (
        <div className="fg-empty">
          <AlertTriangle className="w-5 h-5 text-redx" />
          <p className="text-sm text-slate-300">Failed to load files</p>
          <button onClick={onRetry} className="text-xs text-accent hover:underline">Retry</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="fg-empty">
          {q || filter !== "all"
            ? <p className="text-sm text-slate-500">No files match.</p>
            : <p className="text-sm text-slate-500">Nothing here yet.</p>}
        </div>
      ) : (
        <>
          <div className={grid ? "fg-grid" : "fg-list"}>
            {slice.map((e, i) => (
              <GalleryCard key={e.path} entry={e} onOpen={() => onOpen(filtered, safePage * PER_PAGE + i)} />
            ))}
          </div>
          <Pager page={safePage} pages={pages} onPage={setPage} />
        </>
      )}
    </section>
  );
}

export function FilesPage({ onBack }: { onBack: () => void }) {
  const sessionInfo = getLastSessionInfo();
  const [uploads, setUploads] = useState<FileEntry[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(true);
  const [uploadsError, setUploadsError] = useState(false);

  const [generated, setGenerated] = useState<FileEntry[]>([]);
  const [genLoading, setGenLoading] = useState(true);
  const [genError, setGenError] = useState(false);

  const [viewer, setViewer] = useState<{ items: MediaItem[]; index: number } | null>(null);
  const openViewer = (list: FileEntry[], i: number) =>
    setViewer({ items: list.map((e) => toItem(e.path, e.name)), index: i });

  const fetchUploads = async () => {
    setUploadsLoading(true);
    setUploadsError(false);
    try {
      const home = await getHermesHome();
      const res = await getHermesFiles(`${home}/uploads`);
      setUploads(res.entries.filter((e: any) => !e.is_directory));
    } catch {
      setUploadsError(true);
    } finally {
      setUploadsLoading(false);
    }
  };

  const fetchGenerated = async () => {
    setGenLoading(true);
    setGenError(false);
    try {
      let filesMap = new Map<string, FileEntry>();
      if (sessionInfo?.cwd) {
        try {
          const res = await getHermesFiles(sessionInfo.cwd);
          res.entries.forEach((e: any) => {
            if (!e.is_directory && kindInfo(e.name).card) filesMap.set(e.path, e);
          });
        } catch { /* ignore cwd errors */ }
      }
      const registry: string[] = JSON.parse(localStorage.getItem("astra-gen-files") || "[]");
      for (const path of registry) {
        if (!filesMap.has(path) && kindInfo(path).card) {
          filesMap.set(path, {
            name: path.split("/").pop() || path,
            path,
            is_directory: false,
            size: 0,
            mtime: Date.now() / 1000,
            mime_type: "application/octet-stream",
          });
        }
      }
      setGenerated(Array.from(filesMap.values()).sort((a, b) => b.mtime - a.mtime));
    } catch {
      setGenError(true);
    } finally {
      setGenLoading(false);
    }
  };

  useEffect(() => {
    fetchUploads();
    fetchGenerated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionInfo?.cwd]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-midnight">
      <header className="flex items-center gap-3 border-b border-white/[0.07] px-6 py-4">
        <button type="button" onClick={onBack} className="nav-back-btn p-1.5 -ml-1.5 rounded hover:bg-white/5 text-slate-400 transition" aria-label="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-medium text-slate-200">Files</h2>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-10">
        <GallerySection title="Uploads" entries={uploads} loading={uploadsLoading} error={uploadsError}
          onRetry={fetchUploads} onOpen={openViewer} />
        <GallerySection title="Generated Media & Docs" entries={generated} loading={genLoading} error={genError}
          onRetry={fetchGenerated} onOpen={openViewer} />
      </div>
      {viewer && (
        <Suspense fallback={null}>
          <MediaViewer items={viewer.items} index={viewer.index} onClose={() => setViewer(null)} />
        </Suspense>
      )}
    </div>
  );
}
