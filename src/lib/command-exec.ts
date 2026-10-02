// Executes a slash command against the gateway's real slash worker.
//
// This is the path the TUI uses (`slash.exec`), so output is the SAME text the
// terminal would print — not an approximation and not a re-implementation. The
// gateway may instead hand back a dispatch directive (a skill, alias, or a
// prefill), which we surface verbatim rather than pretending it ran.
import { rpc } from "./ws-engine";
import { wsGet } from "./ws-store";

export interface ExecResult {
  /** Text to render in the surface. */
  text: string;
  /** Non-fatal gateway complaint, rendered above the text. */
  warning?: string;
  /** How the gateway resolved the command. */
  kind: "output" | "dispatch" | "error";
  /** Set when the gateway wants a message sent instead (skill/send/prefill). */
  directive?: { type?: string; target?: string; message?: string; display?: string };
}

function currentSid(): string {
  return wsGet().liveSessionId || "";
}

/** Run "/skills", "/status", … against the live session. */
export async function execSlashCommand(command: string): Promise<ExecResult> {
  const session_id = currentSid();
  if (!session_id) {
    return { text: "No live session yet — send a message first.", kind: "error" };
  }
  try {
    const r = (await rpc("slash.exec", { session_id, command })) ?? {};
    const warning = r.warning ?? undefined;
    // A dispatch directive means the gateway rerouted rather than executed.
    if (r.type && !r.output) {
      const body = r.display || r.message || r.target || "";
      return {
        text: body || `/${command.replace(/^\//, "")} resolved to "${r.type}".`,
        warning,
        kind: "dispatch",
        directive: { type: r.type, target: r.target, message: r.message, display: r.display },
      };
    }
    return {
      text: r.output?.trim() || "(no output)",
      warning,
      kind: "output",
    };
  } catch (err: any) {
    return { text: err?.message || err?.data?.message || String(err), kind: "error" };
  }
}

/**
 * Commands that get a dedicated dismissable surface instead of being sent to
 * the agent as prose. Keyed by the bare command name (no slash, lowercased).
 *
 * Deliberately NOT here: bg and steer (already have their own live UI), and
 * approvals / stop / new / reasoning / model — those mutate session or turn
 * state and belong on the options popover or as agent text, not a readout panel.
 */
export const SURFACE_COMMANDS: Record<string, { title: string; blurb: string }> = {
  compact: { title: "Context", blurb: "Compression report" },
  sessions: { title: "Sessions", blurb: "Recent sessions" },
  usage: { title: "Usage", blurb: "Token + cost usage" },
  skills: { title: "Skills", blurb: "Installed skills" },
  tools: { title: "Tools", blurb: "Available toolsets" },
  plugins: { title: "Plugins", blurb: "Installed plugins" },
  memory: { title: "Memory", blurb: "Memory state" },
  help: { title: "Help", blurb: "Command reference" },
  status: { title: "Status", blurb: "Session status" },
};

/** Does this typed command get a surface? Accepts "/skills", "/skills list", … */
export function surfaceFor(input: string): { name: string; arg: string; title: string; blurb: string } | null {
  const text = (input ?? "").trim();
  if (!text.startsWith("/")) return null;
  // filter(Boolean) so "/  status" doesn't yield an empty first token — the
  // leading slash is consumed, so any residual leading space is just padding.
  const parts = text.slice(1).trim().split(/\s+/).filter(Boolean);
  const name = (parts[0] ?? "").toLowerCase();
  const meta = SURFACE_COMMANDS[name];
  if (!meta) return null;
  return { name, arg: parts.slice(1).join(" "), title: meta.title, blurb: meta.blurb };
}