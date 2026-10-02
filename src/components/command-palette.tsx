// Unified slash-command popup (owner 2026-10-02: "2 pop ups on slash, remove both,
// put in only a single pop up with accepted commands for web ui and another one that
// sends the slash command directly to the TUI and streams the response as chat").
//
// There used to be TWO independent popups over the same composer:
//   1. CommandPalette        — the live Hermes CLI registry (/api/hx/commands)
//   2. a `slashOpen` menu    — a hardcoded TUI_COMMANDS list in chat-landing
// Both opened on "/" and fought over the same keystrokes. This is now ONE surface
// with two GROUPS, driven entirely by data the host already publishes:
//
//   • Web UI — commands the BROWSER implements locally (/bg queue-after,
//     /steer live-steer). Picking one adopts the command into the composer so you
//     can add arguments before it runs.
//   • TUI — everything else. Picking one fires `slash.exec` straight at the
//     gateway's slash worker (the same RPC the terminal uses), and the reply is
//     rendered in the chat transcript as a normal assistant message.
//
// The group is derived from the registry's OWN flags, never from a local list:
// `gateway_only` = reaches the gateway/TUI, `cli_only` = the TUI's local-only
// commands (still dispatched via slash.exec — the gateway worker is what the TUI
// runs). Web-UI-local names are the ones with client-side submit semantics.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  activeSlashQuery,
  applySlashCommand,
  fetchCommandRegistry,
  filterCommands,
  type CommandEntry,
} from "@/lib/command-registry";

const MAX_ROWS = 60;

export type SlashTarget = "web" | "tui";

export interface SlashPick {
  /** Which of the two groups the row came from. */
  target: SlashTarget;
  entry: CommandEntry;
}

interface Props {
  value: string;
  caret: number;
  onPick: (text: string, caret: number) => void;
  /** Called for a TUI row: run it against the gateway and stream the reply. */
  onRunTui?: (entry: CommandEntry) => void;
  onClose?: () => void;
}

/**
 * Commands whose submit semantics live in the BROWSER (queue-after / live
 * steer). These must be adopted into the composer, not dispatched — /bg and
 * /steer are parsed in send() and would otherwise be swallowed by the slash
 * worker as plain text.
 */
const WEB_LOCAL = new Set(["bg", "steer"]);

export function classifyCommand(cmd: CommandEntry): SlashTarget {
  if (WEB_LOCAL.has(cmd.name.toLowerCase())) return "web";
  return "tui";
}

/**
 * Slash-command popup — ONE list, grouped.
 *
 * Lists the LIVE registry (fetched from the Hermes CLI, never hardcoded here)
 * and opens on "/" at the start of the input; a "/" mid-sentence is left alone
 * so paths and dates still work.
 */
export function CommandPalette({ value, caret, onPick, onRunTui, onClose }: Props) {
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

  // Flat list in DISPLAY order (web group first), so arrow keys walk what the
  // eye sees and the active index maps 1:1 onto a row.
  const results = useMemo(() => {
    if (!token) return [];
    const hits = filterCommands(all ?? [], token.query).slice(0, MAX_ROWS);
    return [...hits].sort((a, b) => {
      const ga = classifyCommand(a) === "web" ? 0 : 1;
      const gb = classifyCommand(b) === "web" ? 0 : 1;
      return ga - gb; // stable within each group
    });
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
    if (classifyCommand(cmd) === "tui" && onRunTui) {
      // Hand the command straight to the gateway's slash worker. No composer
      // text is inserted — the command has already been dispatched.
      close();
      onRunTui(cmd);
      return;
    }
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
  const webCount = results.filter((c) => classifyCommand(c) === "web").length;

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

        {webCount > 0 && !loading && (
          <div className="cmdpal-group" aria-hidden="true">
            Web UI · composer command
          </div>
        )}
        {results.slice(0, webCount).map((cmd, i) => (
          <PaletteRow key={cmd.name} cmd={cmd} i={i} active={active} setActive={setActive} pick={pick} />
        ))}

        {webCount > 0 && webCount < results.length && !loading && (
          <div className="cmdpal-group" aria-hidden="true">
            TUI · runs on the host, reply streams here
          </div>
        )}
        {results.slice(webCount).map((cmd, k) => (
          <PaletteRow key={cmd.name} cmd={cmd} i={webCount + k} active={active} setActive={setActive} pick={pick} />
        ))}
      </div>
    </div>
  );
}

function PaletteRow({ cmd, i, active, setActive, pick }: {
  cmd: CommandEntry;
  i: number;
  active: number;
  setActive: (n: number) => void;
  pick: (c: CommandEntry) => void;
}) {
  return (
    <button
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
  );
}