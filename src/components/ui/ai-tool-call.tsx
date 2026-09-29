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
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
  className?: string;
}

function AiToolCall({
  name,
  state,
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
    () => ({ name, state, isOpen }),
    [name, state, isOpen],
  );

  return (
    <AiToolCallContext.Provider value={contextValue}>
      <CollapsiblePrimitive.Root
        data-slot="ai-tool-call"
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
  const { name, state, isOpen } = useToolCallContext();

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
      <div className="ai-plate shrink-0">
        <Wrench className="size-3.5" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="chat-step-label">{name}</span>
        <span className={cn("shrink-0", stateConfig.className)}>
          {stateConfig.icon}
          {stateConfig.label}
        </span>
      </div>
      {children}
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

interface AiToolCallInputProps {
  input: Record<string, unknown>;
  className?: string;
}

function AiToolCallInput({ input, className }: AiToolCallInputProps) {
  const formattedJson = React.useMemo(
    () => JSON.stringify(input, null, 2),
    [input],
  );

  return (
    <div
      data-slot="ai-tool-call-input"
      className={cn("space-y-1.5", className)}
    >
      <span className="ai-io-label">Input</span>
      <pre className="chat-term-args" tabIndex={0}>
        {formattedJson}
      </pre>
    </div>
  );
}

interface AiToolCallOutputProps {
  children?: React.ReactNode;
  className?: string;
}

function AiToolCallOutput({ children, className }: AiToolCallOutputProps) {
  return (
    <div
      data-slot="ai-tool-call-output"
      className={cn("space-y-1.5", className)}
    >
      <span className="ai-io-label">Output</span>
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
};
