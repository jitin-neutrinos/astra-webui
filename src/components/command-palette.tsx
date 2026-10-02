import { useEffect, useMemo, useRef, useState } from "react";
import {
  activeSlashQuery,
  applySlashCommand,
  fetchCommandRegistry,
  filterCommands,
  type CommandEntry,
} from "@/lib/command-registry";

const MAX_ROWS = 60;

interface Props {
  value: string;
  caret: number;
  onPick: (text: string, caret: number) => void;
  /** Optional host hook — Escape/selection dismissal is handled internally. */
  onClose?: () => void;
}

/**
 * Slash-command palette.
 *
 * Lists the LIVE registry (fetched from the Hermes CLI, never hardcoded here)
 * and inserts the chosen command into the composer. Opens on "/" at the start
 * of the input; a "/" mid-sentence is left alone so paths and dates still work.
 */
export function CommandPalette({ value, caret, onPick, onClose }: Props) {
  const [all, setAll] = useState<CommandEntry[] | null>(null);
  const [active, setActive] = useState(0);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const token = activeSlashQuery(value, caret);

  useEffect(() => {
    let live = true;
    fetchCommandRegistry().then((list) => {
      if (live) setAll(list);
    });
    return () => { live = false; };
  }, []);

  const results = useMemo(() => {
    if (!token) return [];
    return filterCommands(all ?? [], token.query).slice(0, MAX_ROWS);
  }, [all, token]);

  useEffect(() => { setActive(0); }, [token?.query]);

  // Keep the highlighted row in view during keyboard navigation.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!token || dismissedFor === token.query) return null;

  const close = () => {
    setDismissedFor(token?.query ?? null);
    onClose?.();
  };

  const pick = (cmd: CommandEntry) => {
    const next = applySlashCommand(value, token.start, caret, cmd);
    onPick(next.text, next.caret);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      // Only intercept Enter while there is a real choice; otherwise let the
      // composer submit whatever was typed.
      if (results[active]) { e.preventDefault(); pick(results[active]); }
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const loading = all === null;

  return (
    <div className="cmdpal" role="listbox" aria-label="Slash commands" onKeyDown={onKeyDown}>
      <div className="cmdpal-head">
        <span className="cmdpal-title">Commands</span>
        <span className="cmdpal-count">
          {loading ? "loading…" : `${results.length}${all?.length ? ` of ${all.length}` : ""}`}
        </span>
      </div>

      <div className="cmdpal-list" ref={listRef}>
        {loading && <div className="cmdpal-empty">Loading commands…</div>}
        {!loading && !results.length && (
          <div className="cmdpal-empty">
            No command matches <span className="cmdpal-slash">/{token.query}</span>
          </div>
        )}

        {results.map((cmd, i) => (
          <button
            key={cmd.name}
            type="button"
            role="option"
            aria-selected={i === active}
            data-idx={i}
            className={`cmdpal-row${i === active ? " is-active" : ""}`}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => { e.preventDefault(); pick(cmd); }}
          >
            <span className="cmdpal-name">
              <span className="cmdpal-slash">/</span>{cmd.name}
              {cmd.aliases.length > 0 && (
                <span className="cmdpal-alias">alias {cmd.aliases.join(", ")}</span>
              )}
            </span>
            <span className="cmdpal-desc">{cmd.description}</span>
            <span className="cmdpal-meta">
              {cmd.args_hint && <span className="cmdpal-args">{cmd.args_hint}</span>}
              <span className="cmdpal-cat">{cmd.category}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}