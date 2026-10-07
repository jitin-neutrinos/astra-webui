import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "./copy-text";
import { cn } from "./utils";

// THE copy system — one component, three skins (2026-10-08):
//   variant="action" → .chat-actions-copy  chat action rows (copy/edit/regenerate)
//   variant="float"  → .chat-code-copy     code-block float (React `sm`, and the
//                                          DOM-built buttons from rich-pre.ts share
//                                          the same classes)
//   variant="chip"   → .chat-copy-chip     labelled header chip (canvas card header,
//                                          canvas code/terminal heads)
// Contract for EVERY copy affordance on the site: copyText() does the write, the
// icon swaps Copy→Check via .chat-copy-swap + .is-check, reverts after `timeout`
// ms. One timing, one palette, one label scheme — no hand-rolled copied-state
// buttons. `sm` is the legacy alias for variant="float".
export function AnimatedCopyButton({
  text,
  className,
  sm,
  variant,
  label,
  title = "Copy",
  timeout = 2000,
  disabled,
}: {
  text: string | (() => string);
  className?: string;
  sm?: boolean;
  variant?: "action" | "float" | "chip";
  label?: string;
  title?: string;
  timeout?: number;
  disabled?: boolean;
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

  const v = variant ?? (sm ? "float" : "action");
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : title}
      title={copied ? "Copied" : title}
      disabled={disabled || (v === "float" ? undefined : typeof text === "function" ? undefined : !text)}
      className={cn(
        v === "float" ? "chat-code-copy" : v === "chip" ? "chat-copy-chip" : "chat-actions-copy",
        copied && "is-check",
        className,
      )}
      onClick={onCopy}
    >
      <span className="chat-copy-swap" aria-hidden="true">
        <Copy className="chat-copy-ic" strokeWidth={v === "action" ? 2 : 1.5} />
        <Check className="chat-copy-ic" strokeWidth={2.5} />
      </span>
      {label != null && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}
