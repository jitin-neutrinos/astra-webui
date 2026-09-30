// AI Tool Call — 21st.dev elements-/tool-call (id 20078) ported to Astra.
// Structure, compound API and Radix Collapsible mechanics are the original
// component's, as prescribed; shadcn design tokens are mapped to Astra's
// themed CSS vars (ai-* classes in index.css) so both themes work.
// DIVERGENCE (deliberate): the original auto-expands when state becomes
// completed/error. Astra owner mandate is the opposite — tool blocks NEVER
// auto-expand; only a user click (persisted) or Ctrl+O opens them. The
// auto-open effect is therefore removed; open/close is fully controlled.

import * as React from "react";

import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Loader2,
  ShieldQuestion,
  Wrench,
  X,
} from "lucide-react";

import { cn } from "../../lib/utils";
import { describeInput, type IOField } from "../../lib/tool-io";

export type ToolCallState =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "awaiting-approval"
  | "denied";

interface AiToolCallContextValue {
  name: string;
  state: ToolCallState;
  isOpen: boolean;
  icon?: React.ReactNode;
}

const AiToolCallContext = React.createContext<AiToolCallContextValue | null>(
  null,
);

function useToolCallContext() {
  const context = React.useContext(AiToolCallContext);
  if (!context) {
    throw new Error("AiToolCall components must be used within <AiToolCall>");
  }
  return context;
}

export interface AiToolCallProps {
  name: string;
  state: ToolCallState;
  /** Header plate glyph; defaults to Wrench. (Thinking rows pass Lightbulb.) */
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
  className?: string;
}

function AiToolCall({
  name,
  state,
  icon,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  children,
  className,
}: AiToolCallProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(open);
      }
      onOpenChange?.(open);
    },
    [isControlled, onOpenChange],
  );

  const contextValue = React.useMemo(
    () => ({ name, state, isOpen, icon }),
    [name, state, isOpen, icon],
  );

  return (
    <AiToolCallContext.Provider value={contextValue}>
      <CollapsiblePrimitive.Root
        data-slot="ai-tool-call"
        data-run={state === "running" ? "1" : undefined}
        open={isOpen}
        onOpenChange={handleOpenChange}
        className={cn("ai-card overflow-hidden", className)}
      >
        {children}
      </CollapsiblePrimitive.Root>
    </AiToolCallContext.Provider>
  );
}

interface AiToolCallHeaderProps {
  children?: React.ReactNode;
  className?: string;
}

function AiToolCallHeader({ children, className }: AiToolCallHeaderProps) {
  const { name, state, isOpen, icon } = useToolCallContext();

  const stateConfig = React.useMemo(() => {
    const configs: Record<
      ToolCallState,
      { icon: React.ReactNode; label: string; className: string }
    > = {
      pending: {
        icon: <Clock className="size-3" />,
        label: "Pending",
        className: "ait-badge idle",
      },
      running: {
        icon: <Loader2 className="size-3 animate-spin" />,
        label: "Running",
        className: "ait-badge run",
      },
      completed: {
        icon: <Check className="size-3" />,
        label: "Done",
        className: "ait-badge ok",
      },
      error: {
        icon: <X className="size-3" />,
        label: "Error",
        className: "ait-badge err",
      },
      "awaiting-approval": {
        icon: <ShieldQuestion className="size-3" />,
        label: "Awaiting Approval",
        className: "ait-badge warn",
      },
      denied: {
        icon: <AlertTriangle className="size-3" />,
        label: "Denied",
        className: "ait-badge warn",
      },
    };
    return configs[state];
  }, [state]);

  return (
    <CollapsiblePrimitive.Trigger
      data-slot="ai-tool-call-header"
      className={cn(
        "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12.5px] font-medium transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyanx/40 rounded-md min-w-0",
        className,
      )}
    >
      <div className="ai-plate shrink-0">{icon ?? <Wrench className="size-3.5" />}</div>
      {/* Left: only the card name; description pills moved right. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 truncate">
        <span className="chat-step-label truncate">{name}</span>
      </div>
      {/* Right meta cluster (owner 2026-09-29): only time + running/done pill;
          the pill has no background, just text + border, and lives next to time. */}
      <div className="flex shrink-0 items-center gap-2 ai-head-right">
        <span className={cn("shrink-0", stateConfig.className)}>
          {stateConfig.icon}
          <span className="sr-only">{stateConfig.label}</span>
        </span>
        {children}
      </div>
      <ChevronDown
        className={cn(
          "size-3.5 shrink-0 text-[var(--color-muted)] transition-transform duration-200",
          isOpen && "rotate-180",
        )}
      />
    </CollapsiblePrimitive.Trigger>
  );
}

interface AiToolCallContentProps {
  children?: React.ReactNode;
  className?: string;
}

function AiToolCallContent({ children, className }: AiToolCallContentProps) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="ai-tool-call-content"
      className={cn("ai-collapsible-content", className)}
    >
      <div className="space-y-3 px-2 pb-2 pt-1">{children}</div>
    </CollapsiblePrimitive.Content>
  );
}

// Human-readable input/output rows (owner 2026-09-29): expanding a card shows
// labeled key-value fields ("Query", "Command", "Find → Replace with") instead
// of raw machine JSON. Long values get their own capped scroll region.
// `label` is omitted when the caller nests AiToolCallFields inside: that block
// carries its own label, and printing it twice is what produced the stacked
// "Output Output Output" the owner saw on edit-file and code-execute cards.
function AiToolCallFields({ label, fields, err }: { label?: string; fields: IOField[]; err?: boolean }) {
  if (!fields.length) return null;
  // A lone field whose key restates the section label ("Output" → "Output")
  // would print the word twice in a row. Render just the value in that case:
  // the heading above already says what it is.
  const collapseSingle = fields.length === 1 && !!label && fields[0].key === label;
  return (
    <div data-slot="ai-tool-call-fields" className="space-y-1.5">
      {label && <span className={cn("ai-io-label", err && "err")}>{label}</span>}
      {collapseSingle ? (
        <pre className={cn("ai-io-val mono tall", "chat-term-out")} tabIndex={0}>{fields[0].value}</pre>
      ) : (
        <dl className="ai-io-fields">
          {fields.map((f, i) => (
            <div key={i} className="ai-io-row">
              <dt className="ai-io-key" title={f.key}>{f.key}</dt>
              <dd className={cn("ai-io-val", f.mono && "mono", f.long && "tall")}
                title={f.mono ? f.value : undefined}>
                {f.long ? f.value : (f.value.length > 240 ? f.value.slice(0, 240) + "…" : f.value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

interface AiToolCallInputProps {
  input: Record<string, unknown>;
  className?: string;
}

function AiToolCallInput({ input, className }: AiToolCallInputProps) {
  // Accept either the new fields shape or a legacy object (rendered as fields).
  const fields = React.useMemo(() => {
    const maybe = input as unknown as { __fields?: IOField[] };
    if (maybe && typeof maybe === "object" && Array.isArray(maybe.__fields)) return maybe.__fields;
    return describeInput(undefined, safeJson(input), undefined);
  }, [input]);

  return (
    <div
      data-slot="ai-tool-call-input"
      className={cn("space-y-1.5", className)}
    >
      <AiToolCallFields label="Input" fields={fields} />
    </div>
  );
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v) ?? ""; } catch { return ""; }
}

// `label` defaults to null: when the caller nests AiToolCallFields inside, that
// block already prints "Output", and a second one here is the duplicate the
// owner reported on edit-file / code-execute cards.
function AiToolCallOutput({ children, className, label = null }: {
  children?: React.ReactNode;
  className?: string;
  label?: string | null;
}) {
  return (
    <div
      data-slot="ai-tool-call-output"
      className={cn("space-y-1.5", className)}
    >
      {label && <span className="ai-io-label">{label}</span>}
      <div className="chat-term-block">
        {children}
      </div>
    </div>
  );
}

interface AiToolCallErrorProps {
  error: string;
  className?: string;
}

function AiToolCallError({ error, className }: AiToolCallErrorProps) {
  return (
    <div
      data-slot="ai-tool-call-error"
      className={cn("space-y-1.5", className)}
    >
      <span className="ai-io-label err">Error</span>
      <div className="chat-term-block err">{error}</div>
    </div>
  );
}

export {
  AiToolCall,
  AiToolCallHeader,
  AiToolCallContent,
  AiToolCallInput,
  AiToolCallOutput,
  AiToolCallError,
  AiToolCallFields,
};
