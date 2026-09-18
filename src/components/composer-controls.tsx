import { useEffect, useRef, useState } from "react";
import { Paperclip, X, Check, SlidersHorizontal } from "lucide-react";

export type Attachment = { 
  id: string; 
  name: string; 
  size: number; 
  path?: string; 
  status: "uploading" | "done" | "error";
  progress?: number;
  file: File;
  serverPath?: string;
  retried?: boolean;
};

const EFFORTS = [
  { id: "none", label: "None" },
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" },
  { id: "max", label: "Maximum" },
  { id: "ultra", label: "Ultra" },
] as const;

export type CatalogPayload = {
  providers: { slug: string; label: string; models: string[] }[];
  current_provider: string;
};

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ComposerControls({ attachments, setAttachments, disabled, sessionInfo, catalog, onPickModel, onPickEffort, onToggleYolo, onRemoveAttachment }: {
  attachments: Attachment[];
  setAttachments: (fn: (a: Attachment[]) => Attachment[]) => void;
  disabled?: boolean;
  sessionInfo: any;
  catalog: CatalogPayload | null;
  onPickModel: (params: { provider: string; model: string }) => void;
  onPickEffort: (effort: string) => void;
  onToggleYolo: () => void;
  onRemoveAttachment: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuProvider, setMenuProvider] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const menuRef = useDismiss(open, () => setOpen(false));

  const pickFiles = () => fileRef.current?.click();

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setAttachments((a) => [...a, ...files.map((f) => ({
      id: `${f.name}-${f.size}-${Date.now()}`,
      name: f.name,
      size: f.size,
      status: "uploading" as const,
      progress: 0,
      file: f
    }))]);
    e.target.value = "";
  };

  const yolo = sessionInfo?.yolo || false;
  const model = sessionInfo?.model || "";
  const provider = sessionInfo?.provider || "";
  const effort = sessionInfo?.reasoning_effort || "";

  // Set initial menu provider when opening menu
  useEffect(() => {
    if (open && !menuProvider) {
      setMenuProvider(provider);
    }
  }, [open, provider, menuProvider]);

  return (
    <div className="relative flex min-w-0 flex-wrap items-center gap-1.5" ref={menuRef}>
      <input ref={fileRef} type="file" multiple className="hidden" onChange={onFiles}
        aria-hidden="true" tabIndex={-1} />


      {attachments.map((a) => (
        <span key={a.id} className="chat-filechip">
          <Paperclip className="h-3 w-3 shrink-0 text-cyanx" strokeWidth={1.5} />
          <span>{a.name}</span>
          <small className="shrink-0 font-mono text-[9px] text-muted">
            {a.status === "uploading" ? `${a.progress}%` : a.status === "error" ? "Error" : fmtSize(a.size)}
          </small>
          <button type="button" aria-label={`Remove ${a.name}`}
            onClick={() => onRemoveAttachment(a.id)}>
            <X className="h-3 w-3" strokeWidth={1.5} />
          </button>
        </span>
      ))}

      <button type="button" className="chat-chip" disabled={disabled}
        aria-haspopup="dialog" aria-expanded={open} aria-controls="composer-options"
        aria-label="Composer options" title="Options"
        onClick={() => setOpen(!open)}>
        <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} />
      </button>

      {open ? (
        <div className="chat-menu" id="composer-options" role="dialog" aria-label="Composer options" style={{ minWidth: 260 }}>
          <p className="chat-menu-label">Attach</p>
          <button className="chat-menu-item" onClick={() => { pickFiles(); setOpen(false); }}>
            Attach files<Paperclip/>
          </button>
          
          <p className="chat-menu-label">Automation</p>
          <button className="chat-menu-item" role="switch" aria-checked={yolo} onClick={onToggleYolo}>
            <span className="flex flex-col">Yolo mode<small>Auto-approve tool calls in this chat</small></span>
            {yolo && <Check className="h-3.5 w-3.5 text-redx"/>}
          </button>

          <p className="chat-menu-label">Reasoning effort</p>
          {effort === "" && (
            <button type="button" className="chat-menu-item" aria-selected={true} disabled={true}>
              <span className="flex flex-col">Provider default</span>
              <Check className="h-3.5 w-3.5 text-cyanx" strokeWidth={2} />
            </button>
          )}
          {EFFORTS.map((e) => (
            <button key={e.id} type="button" className="chat-menu-item"
              aria-selected={e.id === effort}
              onClick={() => { onPickEffort(e.id); }}>
              <span className="flex flex-col">{e.label}</span>
              {e.id === effort ? <Check className="h-3.5 w-3.5 text-cyanx" strokeWidth={2} /> : null}
            </button>
          ))}

          <p className="chat-menu-label">Provider</p>
          {!catalog ? (
            <p className="chat-menu-label">Loading catalog...</p>
          ) : catalog.providers.length === 0 ? (
            <p className="chat-menu-label text-redx">Catalog unavailable</p>
          ) : (
            <>
              {catalog.providers.map((p) => (
                <button key={p.slug} type="button" className="chat-menu-item"
                  aria-selected={p.slug === (menuProvider || provider)}
                  onClick={() => {
                    setMenuProvider(p.slug);
                    onPickModel({ provider: p.slug, model: p.models[0] });
                  }}>
                  {p.label}
                  {p.slug === (menuProvider || provider) ? <Check className="h-3.5 w-3.5 text-cyanx" strokeWidth={2} /> : null}
                </button>
              ))}
              <p className="chat-menu-label">Model — {catalog.providers.find(p => p.slug === (menuProvider || provider))?.label || ""}</p>
              {catalog.providers.find(p => p.slug === (menuProvider || provider))?.models.map((m) => (
                <button key={m} type="button" className="chat-menu-item"
                  aria-selected={m === model}
                  onClick={() => { onPickModel({ provider: menuProvider || provider, model: m }); setOpen(false); }}>
                  {m}
                  {m === model ? <Check className="h-3.5 w-3.5 text-cyanx" strokeWidth={2} /> : null}
                </button>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
