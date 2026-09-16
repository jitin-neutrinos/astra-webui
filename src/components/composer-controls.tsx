import { useEffect, useRef, useState } from "react";
import { Paperclip, X, ChevronDown, Brain, Boxes, Check, ShieldOff } from "lucide-react";

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
  onPickModel: (provider: string, model: string) => void;
  onPickEffort: (effort: string) => void;
  onToggleYolo: () => void;
  onRemoveAttachment: (id: string) => void;
}) {
  const [openMenu, setOpenMenu] = useState<"model" | "effort" | null>(null);
  const [menuProvider, setMenuProvider] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const menuRef = useDismiss(openMenu !== null, () => setOpenMenu(null));

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

  // Set initial menu provider when opening model menu
  useEffect(() => {
    if (openMenu === "model" && !menuProvider) {
      setMenuProvider(provider);
    }
  }, [openMenu, provider, menuProvider]);

  return (
    <div className="relative flex min-w-0 flex-wrap items-center gap-1.5" ref={menuRef}>
      <input ref={fileRef} type="file" multiple className="hidden" onChange={onFiles}
        aria-hidden="true" tabIndex={-1} />
      <button type="button" className="chat-chip" onClick={pickFiles}
        disabled={disabled} aria-label="Attach files"
        title="Attach files">
        <Paperclip className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>

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

      {/* YOLO chip */}
      <button type="button" className={yolo ? "chat-chip-yolo" : "chat-chip"} disabled={disabled}
        aria-pressed={yolo}
        onClick={onToggleYolo}
        title="Yolo mode: auto-approves all tool calls for this chat">
        <ShieldOff className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>

      {/* provider + model popover */}
      <button type="button" className="chat-chip" disabled={disabled}
        aria-expanded={openMenu === "model"} aria-haspopup="dialog"
        onClick={() => { setOpenMenu(openMenu === "model" ? null : "model"); setMenuProvider(provider || catalog?.current_provider || catalog?.providers[0]?.slug || null); }}
        title="Provider & model">
        <Boxes className="h-3.5 w-3.5" strokeWidth={1.5} />
        <span className="text-brandtext">{model || "Model"}</span>
        <ChevronDown className="chat-chip-caret h-3 w-3" strokeWidth={1.5} />
      </button>

      {/* reasoning effort dropdown */}
      <button type="button" className="chat-chip" disabled={disabled}
        aria-expanded={openMenu === "effort"} aria-haspopup="dialog"
        onClick={() => setOpenMenu(openMenu === "effort" ? null : "effort")}
        title="Reasoning effort">
        <Brain className="h-3.5 w-3.5" strokeWidth={1.5} />
        <span className="capitalize">{effort || "Default"}</span>
        <ChevronDown className="chat-chip-caret h-3 w-3" strokeWidth={1.5} />
      </button>

      {openMenu === "model" ? (
        <div className="chat-menu" role="dialog" aria-label="Provider and model">
          {!catalog ? (
            <p className="chat-menu-label">Loading catalog...</p>
          ) : catalog.providers.length === 0 ? (
            <p className="chat-menu-label text-redx">Catalog unavailable</p>
          ) : (
            <>
              <p className="chat-menu-label">Provider</p>
              {catalog.providers.map((p) => (
                <button key={p.slug} type="button" className="chat-menu-item"
                  aria-selected={p.slug === (menuProvider || provider)}
                  onClick={() => {
                    setMenuProvider(p.slug);
                    onPickModel(p.slug, p.models[0]);
                  }}>
                  {p.label}
                  {p.slug === (menuProvider || provider) ? <Check className="h-3.5 w-3.5 text-cyanx" strokeWidth={2} /> : null}
                </button>
              ))}
              <p className="chat-menu-label">Model — {catalog.providers.find(p => p.slug === (menuProvider || provider))?.label || ""}</p>
              {catalog.providers.find(p => p.slug === (menuProvider || provider))?.models.map((m) => (
                <button key={m} type="button" className="chat-menu-item"
                  aria-selected={m === model}
                  onClick={() => { onPickModel(menuProvider || provider, m); setOpenMenu(null); }}>
                  {m}
                  {m === model ? <Check className="h-3.5 w-3.5 text-cyanx" strokeWidth={2} /> : null}
                </button>
              ))}
            </>
          )}
        </div>
      ) : null}

      {openMenu === "effort" ? (
        <div className="chat-menu" role="dialog" aria-label="Reasoning effort" style={{ minWidth: 200 }}>
          <p className="chat-menu-label">Reasoning effort</p>
          {effort === "" && (
            <button type="button" className="chat-menu-item" aria-selected={true} disabled={true}>
              <span className="flex flex-col">
                Provider default
              </span>
              <Check className="h-3.5 w-3.5 text-cyanx" strokeWidth={2} />
            </button>
          )}
          {EFFORTS.map((e) => (
            <button key={e.id} type="button" className="chat-menu-item"
              aria-selected={e.id === effort}
              onClick={() => { onPickEffort(e.id); setOpenMenu(null); }}>
              <span className="flex flex-col">
                {e.label}
              </span>
              {e.id === effort ? <Check className="h-3.5 w-3.5 text-cyanx" strokeWidth={2} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
