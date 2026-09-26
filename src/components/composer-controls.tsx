import { useEffect, useRef, useState } from "react";
import { Paperclip, X, Check, SlidersHorizontal, ChevronRight, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

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
  model?: string;
  provider?: string;
};

type Panel = null | "effort" | "provider" | "model";

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

// Shared with chat-landing's drag-drop handler so dropped files get the exact
// same attachment shaping as the attach-button path.
export function filesToAttachments(files: File[]): Attachment[] {
  return files.map((f) => ({
    id: `${f.name}-${f.size}-${Date.now()}`,
    name: f.name,
    size: f.size,
    status: "uploading" as const,
    progress: 0,
    file: f,
  }));
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
  const [panel, setPanel] = useState<Panel>(null);
  const [menuProvider, setMenuProvider] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const menuRef = useDismiss(open, () => { setOpen(false); setPanel(null); });

  const pickFiles = () => fileRef.current?.click();

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setAttachments((a) => [...a, ...filesToAttachments(files)]);
    e.target.value = "";
  };

  // Hydrate from session.info (pushed on create/resume) with catalog fallback so the
  // menu ALWAYS shows the live selection, even before the user touches anything.
  const yolo = sessionInfo?.yolo || false;
  const effort = sessionInfo?.reasoning_effort || "";
  const provider = sessionInfo?.provider || catalog?.provider || "";
  const model = sessionInfo?.model || catalog?.model || "";
  const activeProvider = menuProvider || provider;

  const providerLabel = (slug: string) =>
    catalog?.providers.find((p) => p.slug === slug)?.label || slug || "—";

  // Open submenu in sync: when the provider panel picks a provider, the model panel follows it.
  useEffect(() => { if (panel === "model" && !menuProvider && provider) setMenuProvider(provider); }, [panel, menuProvider, provider]);

  const closeAll = () => { setOpen(false); setPanel(null); };

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
        onClick={() => { setOpen(!open); setPanel(null); }}>
        <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} />
      </button>

      {open ? (
        <div className="chat-menu" id="composer-options" role="dialog" aria-label="Composer options" style={{ minWidth: 280 }}>
          {panel === null && (
            <>
              <p className="chat-menu-label">Attach</p>
              <button className="chat-menu-item" onClick={() => { pickFiles(); closeAll(); }}>
                Attach files<Paperclip/>
              </button>

              <p className="chat-menu-label">Yolo mode</p>
              <div className="chat-menu-item chat-dropdown-row" role="group" aria-label="Yolo mode">
                <span className="flex flex-col">
                  <span>{yolo ? "On — tool calls run without asking" : "Off — ask first"}</span>
                  <small>{yolo ? "No approval prompts in this chat" : "Tool calls need your approval"}</small>
                </span>
                <button type="button" role="switch" aria-checked={yolo}
                  aria-label={yolo ? "Yolo mode on" : "Yolo mode off"}
                  title={yolo ? "Yolo on — auto-approve" : "Yolo off — ask first"}
                  className={cn("chat-yolo-switch", yolo && "chat-yolo-switch-on")}
                  onClick={() => onToggleYolo()}>
                  <span className="chat-yolo-knob" />
                </button>
              </div>

              <p className="chat-menu-label">Reasoning effort</p>
              <button type="button" className="chat-menu-item chat-dropdown-row" aria-haspopup="menu"
                aria-expanded={false} onClick={() => setPanel("effort")}>
                <span>{effort === "" ? "Provider default" : EFFORTS.find((e) => e.id === effort)?.label || effort}</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted" strokeWidth={1.5} />
              </button>

              <p className="chat-menu-label">Provider</p>
              <button type="button" className="chat-menu-item chat-dropdown-row" aria-haspopup="menu"
                onClick={() => setPanel("provider")}>
                <span>{provider ? providerLabel(provider) : "—"}</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted" strokeWidth={1.5} />
              </button>

              <p className="chat-menu-label">Model</p>
              <button type="button" className="chat-menu-item chat-dropdown-row" aria-haspopup="menu"
                onClick={() => { if (provider) setMenuProvider(provider); setPanel("model"); }}>
                <span>{model || "—"}</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted" strokeWidth={1.5} />
              </button>
            </>
          )}

          {panel === "effort" && (
            <>
              <button type="button" className="chat-menu-back" onClick={() => setPanel(null)}>
                <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} /> Reasoning effort
              </button>
              {/* Gateway semantics: session reasoning overrides clear only on a new chat
                  (config.set has no "clear" value) — so Provider default is state, not a pick. */}
              {effort === "" && (
                <button type="button" className="chat-menu-item" aria-selected={true} disabled={true}>
                  <span>Provider default</span>
                  <Check className="h-3.5 w-3.5 text-cyanx" strokeWidth={2} />
                </button>
              )}
              {EFFORTS.map((e) => (
                <button key={e.id} type="button" className="chat-menu-item" aria-selected={e.id === effort}
                  onClick={() => { onPickEffort(e.id); closeAll(); }}>
                  <span>{e.label}</span>
                  {e.id === effort ? <Check className="h-3.5 w-3.5 text-cyanx" strokeWidth={2} /> : null}
                </button>
              ))}
            </>
          )}

          {panel === "provider" && (
            <>
              <button type="button" className="chat-menu-back" onClick={() => setPanel(null)}>
                <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} /> Provider
              </button>
              {!catalog ? (
                <p className="chat-menu-label">Loading catalog...</p>
              ) : catalog.providers.length === 0 ? (
                <p className="chat-menu-label text-redx">Catalog unavailable</p>
              ) : (
                catalog.providers.map((p) => (
                  <button key={p.slug} type="button" className="chat-menu-item"
                    aria-selected={p.slug === activeProvider}
                    onClick={() => { setMenuProvider(p.slug); setPanel("model"); }}>
                    <span>{p.label}</span>
                    {p.slug === activeProvider ? <Check className="h-3.5 w-3.5 text-cyanx" strokeWidth={2} /> : null}
                  </button>
                ))
              )}
            </>
          )}

          {panel === "model" && (
            <>
              <button type="button" className="chat-menu-back" onClick={() => setPanel("provider")}>
                <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} /> {providerLabel(activeProvider)}
              </button>
              {(catalog?.providers.find((p) => p.slug === activeProvider)?.models || []).map((m) => (
                <button key={m} type="button" className="chat-menu-item"
                  aria-selected={m === model && activeProvider === provider}
                  onClick={() => { onPickModel({ provider: activeProvider, model: m }); closeAll(); }}>
                  <span>{m}</span>
                  {m === model && activeProvider === provider ? <Check className="h-3.5 w-3.5 text-cyanx" strokeWidth={2} /> : null}
                </button>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
