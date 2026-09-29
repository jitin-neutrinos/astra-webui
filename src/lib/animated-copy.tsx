import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "./copy-text";
import { cn } from "./utils";

// Animated copy button — shadcn/AI-Elements CodeBlockCopyButton pattern
// (icon swap Copy→Check on click, revert after `timeout` ms). One component
// for every copy affordance: chat action rows (default) and code-block float
// (size="sm" via the `sm` prop). Crossfade + scale via CSS (chat-copy-swap).
export function AnimatedCopyButton({
  text,
  className,
  sm,
  title = "Copy",
  timeout = 2000,
}: {
  text: string | (() => string);
  className?: string;
  sm?: boolean;
  title?: string;
  timeout?: number;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onCopy = () => {
    void copyText(typeof text === "function" ? text() : text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), timeout);
    });
  };

  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : title}
      title={copied ? "Copied" : title}
      disabled={sm ? undefined : typeof text === "function" ? undefined : !text}
      className={cn(sm ? "chat-code-copy" : "chat-actions-copy", copied && "is-check", className)}
      onClick={onCopy}
    >
      <span className="chat-copy-swap" aria-hidden="true">
        <Copy className="chat-copy-ic" strokeWidth={sm ? 1.5 : 2} />
        <Check className="chat-copy-ic" strokeWidth={2.5} />
      </span>
    </button>
  );
}
