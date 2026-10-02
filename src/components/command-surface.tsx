import { useEffect, useRef, useState } from "react";
import { ChevronRight, Loader2, X } from "lucide-react";
import { execSlashCommand, type ExecResult } from "@/lib/command-exec";

export interface CommandSurfaceItem {
  id: string;
  command: string;
  title: string;
  blurb: string;
  status: "running" | "done" | "error";
  result?: ExecResult;
}

interface Props {
  item: CommandSurfaceItem;
  onDismiss: (id: string) => void;
}

/**
 * Dismissable readout surface for the curated commands (/status, /skills, …).
 *
 * One component for all nine rather than nine bespoke panels: the commands all
 * resolve to the same thing — text from the gateway's slash worker — so the only
 * real differences are the title and the blurb, both of which ride on the item.
 */
export function CommandSurface({ item, onDismiss }: Props) {
  const [open, setOpen] = useState(item.status === "running");
  const [result, setResult] = useState<ExecResult | undefined>(item.result);
  const bodyRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let live = true;
    setOpen(true);
    setResult(undefined);
    execSlashCommand(item.command).then((r) => {
      if (!live) return;
      setResult(r);
    });
    return () => { live = false; };
  }, [item.command]);

  // Keep the caret-visible after a re-render (motion clobbers inline styles).
  useEffect(() => {
    const el = bodyRef.current;
    if (el && open) el.scrollTop = el.scrollHeight;
  }, [result, open]);

  const running = !result;

  return (
    <div className={`cmdsurf${item.status === "error" ? " is-error" : ""}`}>
      <button
        type="button"
        className="cmdsurf-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronRight className={`cmdsurf-caret${open ? " is-open" : ""}`} aria-hidden="true" />
        <span className="cmdsurf-title">{item.title}</span>
        <span className="cmdsurf-blurb">{item.blurb}</span>
        {running ? (
          <Loader2 className="cmdsurf-spin" aria-hidden="true" />
        ) : (
          // Status comes from the RESULT, not the item: the panel owns the exec,
          // so the parent's optimistic "running" would otherwise stick forever.
          <span className={`cmdsurf-chip${result?.kind === "error" ? " is-error" : ""}`}>
            {result?.kind === "error" ? "error" : result?.kind === "dispatch" ? "dispatched" : "done"}
          </span>
        )}
      </button>

      {open && (
        <div className="cmdsurf-body">
          {result?.warning && <div className="cmdsurf-warn">{result.warning}</div>}
          {running ? (
            <div className="cmdsurf-loading">Running /{item.command.replace(/^\//, "")}…</div>
          ) : (
            <pre ref={bodyRef} className="cmdsurf-text">{result?.text}</pre>
          )}
          <div className="cmdsurf-foot">
            <span className="cmdsurf-cmd">/{item.command.replace(/^\//, "")}</span>
            <button
              type="button"
              className="cmdsurf-x"
              onClick={() => onDismiss(item.id)}
              aria-label={`Dismiss ${item.title}`}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}