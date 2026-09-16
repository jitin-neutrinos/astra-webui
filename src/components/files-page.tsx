import { useEffect, useState } from "react";
import { ArrowLeft, File, FileImage, FileText, RefreshCw, AlertTriangle } from "lucide-react";
import { getHermesHome, getHermesFiles, getFileKind } from "@/lib/session-files";

function fmtSize(n: number) {
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

function FileRow({ entry }: { entry: FileEntry }) {
  const [error, setError] = useState(false);
  const kind = getFileKind(entry.name);
  
  if (error) {
    return (
      <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-white/5 opacity-50">
        <File className="w-5 h-5 text-slate-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-300 truncate">{entry.name}</p>
          <p className="text-[10px] text-slate-500">Missing or unreadable</p>
        </div>
      </div>
    );
  }

  const renderPreview = () => {
    if (kind === "image") {
      return (
        <a href={`/api/hx/files/download?path=${encodeURIComponent(entry.path)}`} target="_blank" rel="noreferrer" className="block w-12 h-12 rounded bg-black/50 overflow-hidden shrink-0 border border-white/10 relative group">
          <img src={`/api/hx/media?path=${encodeURIComponent(entry.path)}`} alt={entry.name} onError={() => setError(true)} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
            <FileImage className="w-4 h-4 text-white" />
          </div>
        </a>
      );
    }
    if (kind === "video") {
      return (
        <div className="w-32 h-12 rounded bg-black/50 overflow-hidden shrink-0 border border-white/10">
          <video src={`/api/hx/files/stream?path=${encodeURIComponent(entry.path)}`} controls className="w-full h-full object-cover" onError={() => setError(true)} />
        </div>
      );
    }
    if (kind === "audio") {
      return (
        <div className="w-48 h-12 rounded bg-black/50 overflow-hidden shrink-0 border border-white/10 flex items-center px-2">
          <audio src={`/api/hx/files/stream?path=${encodeURIComponent(entry.path)}`} controls className="w-full h-6" onError={() => setError(true)} />
        </div>
      );
    }
    return (
      <div className="w-12 h-12 rounded bg-white/5 shrink-0 border border-white/10 flex items-center justify-center group">
        <FileText className="w-5 h-5 text-slate-400 group-hover:text-cyanx transition" />
      </div>
    );
  };

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-white/5 transition">
      {renderPreview()}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200 truncate" title={entry.name}>{entry.name}</p>
        <p className="text-xs text-slate-500 font-mono flex items-center gap-2">
          <span>{fmtSize(entry.size)}</span>
          <span>&middot;</span>
          <span>{new Date(entry.mtime * 1000).toLocaleString()}</span>
        </p>
      </div>
      {(kind === "doc" || kind === "other") && (
        <a href={`/api/hx/files/download?path=${encodeURIComponent(entry.path)}`} target="_blank" rel="noreferrer" className="p-2 hover:bg-white/10 rounded text-slate-400 hover:text-cyanx transition" title="Download">
          <ArrowLeft className="w-4 h-4 rotate-[225deg]" />
        </a>
      )}
    </div>
  );
}

import { getLastSessionInfo } from "@/lib/hermes-ws";

export function FilesPage({ onBack }: { onBack: () => void }) {
  const sessionInfo = getLastSessionInfo();
  const [uploads, setUploads] = useState<FileEntry[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(true);
  const [uploadsError, setUploadsError] = useState(false);

  const [generated, setGenerated] = useState<FileEntry[]>([]);
  const [genLoading, setGenLoading] = useState(true);
  const [genError, setGenError] = useState(false);

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
      
      // 1. cwd files
      if (sessionInfo?.cwd) {
        try {
          const res = await getHermesFiles(sessionInfo.cwd);
          res.entries.forEach((e: any) => {
            if (!e.is_directory && getFileKind(e.name) !== "other") {
              filesMap.set(e.path, e);
            }
          });
        } catch { /* ignore cwd errors */ }
      }

      // 2. harvested from localStorage
      const registry: string[] = JSON.parse(localStorage.getItem("astra-gen-files") || "[]");
      // Actually we don't have the size/mtime for these unless we stat them. 
      // But we can just create stub FileEntry objects if we don't have them in filesMap, 
      // but without stat they won't render dates. Let's do a best effort stat if possible.
      // But getHermesFiles only lists a directory. We can't stat individual files easily.
      // For now, stub them.
      for (const path of registry) {
        if (!filesMap.has(path) && getFileKind(path) !== "other") {
          filesMap.set(path, {
            name: path.split("/").pop() || path,
            path,
            is_directory: false,
            size: 0,
            mtime: Date.now() / 1000,
            mime_type: "application/octet-stream"
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
        <button type="button" onClick={onBack} className="p-1.5 -ml-1.5 rounded hover:bg-white/5 text-slate-400 transition" aria-label="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-medium text-slate-200">Files</h2>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-10">
        <section>
          <h3 className="text-sm font-mono tracking-widest uppercase text-slate-500 mb-4 flex items-center justify-between">
            <span>Uploads</span>
            <button onClick={fetchUploads} className="p-1 hover:text-cyanx transition"><RefreshCw className="w-3.5 h-3.5" /></button>
          </h3>
          {uploadsLoading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : uploadsError ? (
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 flex flex-col items-center justify-center gap-2">
              <AlertTriangle className="w-5 h-5 text-redx" />
              <p className="text-sm text-slate-300">Failed to load uploads</p>
              <button onClick={fetchUploads} className="text-xs text-cyanx hover:underline">Retry</button>
            </div>
          ) : uploads.length === 0 ? (
            <div className="bg-white/5 border border-white/10 border-dashed rounded-lg p-8 flex items-center justify-center">
              <p className="text-sm text-slate-500">No uploads yet.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {uploads.map(e => <FileRow key={e.path} entry={e} />)}
            </div>
          )}
        </section>

        <section>
          <h3 className="text-sm font-mono tracking-widest uppercase text-slate-500 mb-4 flex items-center justify-between">
            <span>Generated Media & Docs</span>
            <button onClick={fetchGenerated} className="p-1 hover:text-cyanx transition"><RefreshCw className="w-3.5 h-3.5" /></button>
          </h3>
          {genLoading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : genError ? (
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 flex flex-col items-center justify-center gap-2">
              <AlertTriangle className="w-5 h-5 text-redx" />
              <p className="text-sm text-slate-300">Failed to load generated files</p>
              <button onClick={fetchGenerated} className="text-xs text-cyanx hover:underline">Retry</button>
            </div>
          ) : generated.length === 0 ? (
            <div className="bg-white/5 border border-white/10 border-dashed rounded-lg p-8 flex items-center justify-center">
              <p className="text-sm text-slate-500">No generated files yet.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {generated.map(e => <FileRow key={e.path} entry={e} />)}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
