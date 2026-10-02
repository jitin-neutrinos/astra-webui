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
 * Commands that must NEVER be auto-run from a typed slash token: they carry
 * live-composer semantics (/bg and /steer have their own submit paths) or end
 * the session.
 */
export const NOT_SURFACED = new Set(["bg", "steer", "quit", "exit"]);

/**
 * Commands that get a dedicated dismissable surface instead of being sent to
 * the agent as prose. Keyed by the bare command name (no slash, lowercased).
 *
 * This is a *presentation* table — titles and blurbs for the ones worth naming.
 * It is NOT an allowlist: any command present in the live registry opens a
 * surface too (see surfaceFor), so a new Hermes command works the moment it
 * ships without an astra release.
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

/** Split a typed message into (commandName, args) when it opens with a slash. */
export function splitSlash(input: string): { name: string; arg: string } | null {
  const text = (input ?? "").trim();
  if (!text.startsWith("/")) return null;
  // filter(Boolean) so "/  status" doesn't yield an empty first token — the
  // leading slash is consumed, so any residual leading space is just padding.
  const parts = text.slice(1).trim().split(/\s+/).filter(Boolean);
  const name = (parts[0] ?? "").toLowerCase();
  if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) return null;
  return { name, arg: parts.slice(1).join(" ") };
}

/**
 * Should this typed message open a readout surface instead of going to the agent?
 *
 * `known` is the live registry (may be null when it hasn't loaded). When it is
 * unknown we fall back to the presentation table alone, so the curated nine work
 * even before the registry arrives.
 */
export function surfaceFor(
  input: string,
  known?: Set<string> | null,
): { name: string; arg: string; title: string; blurb: string } | null {
  const split = splitSlash(input);
  if (!split) return null;
  const { name, arg } = split;
  if (NOT_SURFACED.has(name)) return null;
  const meta = SURFACE_COMMANDS[name];
  if (meta) return { name, arg, title: meta.title, blurb: meta.blurb };
  // Unknown-to-the-table: run it only if the registry vouches for it, so an
  // invented "/foo" still reaches the agent as prose instead of erroring out.
  if (known && known.has(name)) {
    return { name, arg, title: `/${name}`, blurb: "Command output" };
  }
  return null;
}