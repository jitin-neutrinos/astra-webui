// AI Chain of Thought — 21st.dev elements-/chain-of-thought (id 20075) ported
// to Astra. Compound structure + Radix Collapsible mechanics preserved as
// prescribed; shadcn tokens mapped to Astra's themed CSS vars (ai-* classes in
// index.css). Divergences (deliberate, owner mandates):
//  - defaultOpen = false (original: true) — everything initializes collapsed;
//  - no SearchResults/Image sub-parts (Astra reasoning is text + tool steps,
//    not search cards).

import * as React from "react";

import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  Loader2,
  Lightbulb,
} from "lucide-react";

import { cn } from "../../lib/utils";

type StepStatus = "pending" | "active" | "complete";

interface AiChainOfThoughtContextValue {
  isOpen: boolean;
}

const AiChainOfThoughtContext =
  React.createContext<AiChainOfThoughtContextValue | null>(null);

function useChainOfThoughtContext() {
  const context = React.useContext(AiChainOfThoughtContext);
  if (!context) {
    throw new Error(
      "AiChainOfThought components must be used within <AiChainOfThought>",
    );
  }
  return context;
}

interface AiChainOfThoughtProps {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
  className?: string;
}

function AiChainOfThought({
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  children,
  className,
}: AiChainOfThoughtProps) {
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

  const contextValue = React.useMemo(() => ({ isOpen }), [isOpen]);

  return (
    <AiChainOfThoughtContext.Provider value={contextValue}>
      <CollapsiblePrimitive.Root
        data-slot="ai-chain-of-thought"
        open={isOpen}
        onOpenChange={handleOpenChange}
        className={cn("ai-card overflow-hidden", className)}
      >
        {children}
      </CollapsiblePrimitive.Root>
    </AiChainOfThoughtContext.Provider>
  );
}

interface AiChainOfThoughtHeaderProps {
  title?: string;
  stepCount?: number;
  completedCount?: number;
  children?: React.ReactNode;
  className?: string;
}

function AiChainOfThoughtHeader({
  title = "Chain of Thought",
  stepCount,
  completedCount,
  children,
  className,
}: AiChainOfThoughtHeaderProps) {
  const { isOpen } = useChainOfThoughtContext();

  return (
    <CollapsiblePrimitive.Trigger
      data-slot="ai-chain-of-thought-header"
      className={cn(
        "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12.5px] font-medium transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyanx/40 rounded-md min-w-0",
        className,
      )}
    >
      <div className="ai-plate think shrink-0">
        <Lightbulb className="size-3.5" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="chat-step-label">{title}</span>
        {stepCount !== undefined && (
          <span className="ait-badge idle shrink-0">
            {completedCount !== undefined
              ? `${completedCount}/${stepCount}`
              : `${stepCount} steps`}
          </span>
        )}
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

interface AiChainOfThoughtContentProps {
  children?: React.ReactNode;
  className?: string;
}

function AiChainOfThoughtContent({
  children,
  className,
}: AiChainOfThoughtContentProps) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="ai-chain-of-thought-content"
      className={cn("ai-collapsible-content", className)}
    >
      <div className="space-y-3 px-2 pb-2 pt-1">{children}</div>
    </CollapsiblePrimitive.Content>
  );
}

interface AiChainOfThoughtStepProps {
  status: StepStatus;
  title: React.ReactNode;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

function AiChainOfThoughtStep({
  status,
  title,
  description,
  children,
  className,
}: AiChainOfThoughtStepProps) {
  const statusConfig = React.useMemo(() => {
    const configs: Record<
      StepStatus,
      { icon: React.ReactNode; className: string; lineClassName: string }
    > = {
      pending: {
        icon: <Circle className="size-3.5" />,
        className: "text-[var(--color-muted)]",
        lineClassName: "aoc-line idle",
      },
      active: {
        icon: <Loader2 className="size-3.5 animate-spin" />,
        className: "ait-step-run",
        lineClassName: "aoc-line run",
      },
      complete: {
        icon: <CheckCircle2 className="size-3.5" />,
        className: "ait-step-done",
        lineClassName: "aoc-line done",
      },
    };
    return configs[status];
  }, [status]);

  return (
    <div
      data-slot="ai-chain-of-thought-step"
      data-status={status}
      className={cn("relative flex gap-2.5", className)}
    >
      <div className="flex flex-col items-center">
        <div className={cn("shrink-0", statusConfig.className)}>
          {statusConfig.icon}
        </div>
        <div
          className={cn(
            "mt-2 w-0.5 flex-1 rounded-full",
            statusConfig.lineClassName,
          )}
        />
      </div>
      <div className="min-w-0 flex-1 pb-4">
        <h4
          className={cn(
            "text-[12.5px] font-medium",
            status === "pending" && "text-[var(--color-muted)]",
          )}
        >
          {title}
        </h4>
        {description && (
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">{description}</p>
        )}
        {children && <div className="mt-2">{children}</div>}
      </div>
    </div>
  );
}

export {
  AiChainOfThought,
  AiChainOfThoughtHeader,
  AiChainOfThoughtContent,
  AiChainOfThoughtStep,
};
export type { AiChainOfThoughtProps, StepStatus };
