import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { fetchCommandRegistry, filterCommands, type CommandEntry } from "@/lib/command-registry";
import { SURFACE_COMMANDS, execSlashCommand } from "@/lib/command-exec";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenSurface: (command: string, title: string, blurb: string) => void;
}

/** Commands that must NOT be fired from here — they need the live composer. */
const NOT_DIRECT = new Set(["bg", "steer", "quit", "exit"]);

/**
 * "All commands" — everything the live registry offers, minus the nine that get
 * their own surface and the few that must be typed into the composer (bg/steer
 * carry live semantics; quit/exit end the session).
 *
 * Picking one runs it against the gateway's slash worker, i.e. the same call the
 * TUI makes, so the output is the terminal's output.
 */
export function AllCommandsModal({ open, onClose, onOpenSurface }: Props) {
  const [all, setAll] = useState<CommandEntry[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [out, setOut] = useState<{ cmd: string; text: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchCommandRegistry().then(setAll);
  }, [open]);

  useEffect(() => {
    if (!open) { setQ(""); setOut(null); setBusy(null); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const rows = useMemo(() => {
    const list = (all ?? []).filter((c) => !NOT_DIRECT.has(c.name));
    return filterCommands(list, q);
  }, [all, q]);

  if (!open) return null;

  const run = async (cmd: CommandEntry) => {
    const meta = SURFACE_COMMANDS[cmd.name];
    // The nine curated ones belong in their own dismissable surface, not here.
    if (meta) { onOpenSurface(cmd.name, meta.title, meta.blurb); onClose(); return; }
    setBusy(cmd.name);
    setOut(null);
    const r = await execSlashCommand(`/${cmd.name}`);
    setOut({ cmd: cmd.name, text: r.text, error: r.kind === "error" });
    setBusy(null);
  };

  return (
    <div className="cmdsheet" role="dialog" aria-modal="true" aria-label="All commands">
      <div className="cmdsheet-panel">
        <div className="cmdsheet-head">
          <span className="cmdsheet-title">All commands</span>
          <span className="cmdsheet-sub">sent directly to the TUI</span>
          <button type="button" className="cmdsheet-x" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="cmdsheet-search">
          <Search aria-hidden="true" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter commands…"
            aria-label="Filter commands"
            autoFocus
          />
        </div>

        {out && (
          <div className={`cmdsheet-out${out.error ? " is-error" : ""}`}>
            <div className="cmdsheet-out-head">/{out.cmd}</div>
            <pre>{out.text}</pre>
          </div>
        )}

        <div className="cmdsheet-list">
          {all === null && <div className="cmdsheet-empty">Loading commands…</div>}
          {all !== null && !rows.length && <div className="cmdsheet-empty">No command matches “{q}”.</div>}
          {rows.map((c) => (
            <button
              key={c.name}
              type="button"
              className={`cmdsheet-row${busy === c.name ? " is-busy" : ""}`}
              disabled={busy === c.name}
              onClick={() => run(c)}
            >
              <span className="cmdsheet-name"><span className="cmdsheet-slash">/</span>{c.name}</span>
              <span className="cmdsheet-desc">{c.description}</span>
              {SURFACE_COMMANDS[c.name] && <span className="cmdsheet-badge">panel</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}