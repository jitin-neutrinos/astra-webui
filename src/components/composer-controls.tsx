import { useEffect, useRef, useState } from "react";
import { Paperclip, X, ChevronDown, Brain, Boxes, Check } from "lucide-react";

// ponytail: placeholder UX only — real catalog + uploads wire to Hermes at integration.
export type Attachment = { id: string; name: string; size: number };

const EFFORTS = [
  { id: "off", label: "Off", hint: "fastest, no reasoning" },
  { id: "low", label: "Low", hint: "quick think" },
  { id: "medium", label: "Medium", hint: "balanced" },
  { id: "high", label: "High", hint: "deep reasoning" },
  { id: "ultra", label: "Ultra", hint: "maximum depth" },
] as const;

// placeholder catalog until Hermes wires the real one
const CATALOG: Record<string, string[]> = {
  Nous: ["Hermes 5", "Hermes 5 Flash"],
  Zai: ["GLM 5.3", "GLM 5.3 Flash", "GLM 5.2"],
  Anthropic: ["Claude Sonnet 5", "Claude Opus 4.8", "Claude Haiku 4.5"],
  OpenAI: ["GPT 5.4", "GPT 5.4 Mini"],
  Gemini: ["Gemini 3.1 Pro", "Gemini 3.5 Flash"],
  OpenRouter: ["Auto (best available)"],
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

export function ComposerControls({ attachments, setAttachments, disabled }: {
  attachments: Attachment[];
  setAttachments: (fn: (a: Attachment[]) => Attachment[]) => void;
  disabled?: boolean;
}) {
  const [provider, setProvider] = useState("Zai");
  const [model, setModel] = useState("GLM 5.3 Flash");
  const [effort, setEffort] = useState<(typeof EFFORTS)[number]["id"]>("medium");
  const [openMenu, setOpenMenu] = useState<"model" | "effort" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const menuRef = useDismiss(openMenu !== null, () => setOpenMenu(null));

  const pickFiles = () => fileRef.current?.click();

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setAttachments((a) => [...a, ...files.map((f) => ({
      id: `${f.name}-${f.size}-${Date.now()}`,
      name: f.name,
      size: f.size,
    }))]);
    e.target.value = ""; // allow re-picking the same file
  };

  return (
    <div className="relative flex min-w-0 flex-wrap items-center gap-1.5" ref={menuRef}>
      {/* attach: local chips only until Hermes upload lands */}
      <input ref={fileRef} type="file" multiple className="hidden" onChange={onFiles}
        aria-hidden="true" tabIndex={-1} />
      <button type="button" className="chat-chip" onClick={pickFiles}
        disabled={disabled} aria-label="Attach files"
        title="Attach files (upload wires up at Hermes integration)">
        <Paperclip className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>

      {attachments.map((a) => (
        <span key={a.id} className="chat-filechip">
          <Paperclip className="h-3 w-3 shrink-0 text-cyanx" strokeWidth={1.5} />
          <span>{a.name}</span>
          <small className="shrink-0 font-mono text-[9px] text-muted">{fmtSize(a.size)}</small>
          <button type="button" aria-label={`Remove ${a.name}`}
            onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}>
            <X className="h-3 w-3" strokeWidth={1.5} />
          </button>
        </span>
      ))}

      {/* provider + model popover */}
      <button type="button" className="chat-chip" disabled={disabled}
        aria-expanded={openMenu === "model"} aria-haspopup="dialog"
        onClick={() => setOpenMenu(openMenu === "model" ? null : "model")}
        title="Provider & model">
        <Boxes className="h-3.5 w-3.5" strokeWidth={1.5} />
        <span className="text-brandtext">{model}</span>
        <ChevronDown className="chat-chip-caret h-3 w-3" strokeWidth={1.5} />
      </button>

      {/* reasoning effort dropdown */}
      <button type="button" className="chat-chip" disabled={disabled}
        aria-expanded={openMenu === "effort"} aria-haspopup="dialog"
        onClick={() => setOpenMenu(openMenu === "effort" ? null : "effort")}
        title="Reasoning effort">
        <Brain className="h-3.5 w-3.5" strokeWidth={1.5} />
        <span className="capitalize">{effort}</span>
        <ChevronDown className="chat-chip-caret h-3 w-3" strokeWidth={1.5} />
      </button>

      {openMenu === "model" ? (
        <div className="chat-menu" role="dialog" aria-label="Provider and model">
          <p className="chat-menu-label">Provider</p>
          {Object.keys(CATALOG).map((p) => (
            <button key={p} type="button" className="chat-menu-item"
              aria-selected={p === provider}
              onClick={() => {
                setProvider(p);
                setModel(CATALOG[p][0]);
              }}>
              {p}
              {p === provider ? <Check className="h-3.5 w-3.5 text-cyanx" strokeWidth={2} /> : null}
            </button>
          ))}
          <p className="chat-menu-label">Model — {provider}</p>
          {CATALOG[provider].map((m) => (
            <button key={m} type="button" className="chat-menu-item"
              aria-selected={m === model}
              onClick={() => { setModel(m); setOpenMenu(null); }}>
              {m}
              {m === model ? <Check className="h-3.5 w-3.5 text-cyanx" strokeWidth={2} /> : null}
            </button>
          ))}
        </div>
      ) : null}

      {openMenu === "effort" ? (
        <div className="chat-menu" role="dialog" aria-label="Reasoning effort" style={{ minWidth: 200 }}>
          <p className="chat-menu-label">Reasoning effort</p>
          {EFFORTS.map((e) => (
            <button key={e.id} type="button" className="chat-menu-item"
              aria-selected={e.id === effort}
              onClick={() => { setEffort(e.id); setOpenMenu(null); }}>
              <span className="flex flex-col">
                {e.label}
                <small>{e.hint}</small>
              </span>
              {e.id === effort ? <Check className="h-3.5 w-3.5 text-cyanx" strokeWidth={2} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
