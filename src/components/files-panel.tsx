import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Download, RefreshCw, AlertTriangle } from "lucide-react";
import { getHermesHome, getHermesFiles } from "@/lib/session-files";
import { kindInfo, badgeLabel, mediaKind } from "@/lib/media-kinds";
import { toItem, type MediaItem } from "@/lib/media-paths";
import { downloadFile } from "@/lib/download";
import { getLastSessionInfo } from "@/lib/hermes-ws";

const MediaViewer = lazy(() => import("./media-viewer"));

type FileEntry = {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
  mtime: number;
  mime_type: string;
};

/** Collapsible group. BOTH start collapsed (owner mandate) — the sidebar opens
 *  as a compact navigator, not a wall of media. */
function FileGroup({
  title,
  count,
  loading,
  error,
  entries,
  onRetry,
  onOpen,
}: {
  title: string;
  count: number;
  loading: boolean;
  error: boolean;
  entries: FileEntry[];
  onRetry: () => void;
  onOpen: (list: FileEntry[], i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ast-file-group" data-open={open}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="ast-file-group-head"
      >
        <ChevronRight className="ast-file-group-chev h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="ast-file-group-title">{title}</span>
        <span className="ast-file-group-count">{loading ? "…" : count}</span>
      </button>
      {open && (
        <div className="ast-file-group-body">
          {loading && <div className="ast-file-note">Loading…</div>}
          {!loading && error && (
            <div className="ast-file-note">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              <button type="button" onClick={onRetry} className="underline">Retry</button>
            </div>
          )}
          {!loading && !error && entries.length === 0 && (
            <div className="ast-file-note">Nothing here yet.</div>
          )}
          {!loading && !error && entries.map((e, i) => {
            const kind = kindInfo(e.name);
            const viewable = !!kind.card || mediaKind(e.name) === "image";
            return (
              <div key={e.path} className="ast-file-row group">
                <button
                  type="button"
                  className="ast-file-open"
                  disabled={!viewable}
                  onClick={() => viewable && onOpen(entries, i)}
                  title={viewable ? e.path : e.name}
                >
                  <span className="ast-file-name truncate">{e.name}</span>
                  <span className="ast-file-meta shrink-0">{badgeLabel(e.name)}</span>
                </button>
                <button
                  type="button"
                  className="ast-file-dl shrink-0"
                  aria-label={`Download ${e.name}`}
                  title="Download"
                  onClick={() => downloadFile(e.path, e.name)}
                >
                  <Download className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * FilesPanel — the Files browser rendered INSIDE the sidebar, the same way
 * ChatsPanel replaces the global nav (owner ask). Reuses the full page's data
 * layer so both views list the same thing.
 */
export function FilesPanel({ onBack }: { onBack: () => void }) {
  const sessionInfo = getLastSessionInfo();
  const [uploads, setUploads] = useState<FileEntry[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(true);
  const [uploadsError, setUploadsError] = useState(false);

  const [generated, setGenerated] = useState<FileEntry[]>([]);
  const [genLoading, setGenLoading] = useState(true);
  const [genError, setGenError] = useState(false);

  const [viewer, setViewer] = useState<{ items: MediaItem[]; index: number } | null>(null);
  const openViewer = useCallback((list: FileEntry[], i: number) =>
    setViewer({ items: list.map((e) => toItem(e.path, e.name)), index: i }), []);

  const fetchUploads = useCallback(async () => {
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
  }, []);

  const fetchGenerated = useCallback(async () => {
    setGenLoading(true);
    setGenError(false);
    try {
      const filesMap = new Map<string, FileEntry>();
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
  }, [sessionInfo?.cwd]);

  useEffect(() => {
    void fetchUploads();
    void fetchGenerated();
  }, [fetchUploads, fetchGenerated]);

  const refreshAll = useCallback(() => { void fetchUploads(); void fetchGenerated(); }, [fetchUploads, fetchGenerated]);
  const busy = uploadsLoading || genLoading;

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 flex items-center gap-2 border-b border-white/[0.07] ast-panel-head">
        <button onClick={onBack} className="nav-back-btn p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors" aria-label="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-mono text-xs uppercase tracking-widest ast-panel-title">Files</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={refreshAll}
          aria-label="Refresh files"
          title="Refresh"
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          <RefreshCw className={"h-3.5 w-3.5" + (busy ? " animate-spin" : "")} />
        </button>
      </div>

      <div className="sidebar-scroll flex-1 overflow-y-auto p-2 space-y-1">
        <FileGroup
          title="Uploads"
          count={uploads.length}
          loading={uploadsLoading}
          error={uploadsError}
          entries={uploads}
          onRetry={fetchUploads}
          onOpen={openViewer}
        />
        <FileGroup
          title="Generated media & docs"
          count={generated.length}
          loading={genLoading}
          error={genError}
          entries={generated}
          onRetry={fetchGenerated}
          onOpen={openViewer}
        />
      </div>

      {viewer && (
        <Suspense fallback={null}>
          <MediaViewer items={viewer.items} index={viewer.index} onClose={() => setViewer(null)} />
        </Suspense>
      )}
    </div>
  );
}
