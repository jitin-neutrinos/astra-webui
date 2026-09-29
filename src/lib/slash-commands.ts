// Slash-command grammar for the composer. Two client-side commands get special
// submit semantics against the gateway's busy path; everything else (including
// the TUI command list) is submitted as plain prompt text, same as the terminal.
//
//   /bg <text>    → prompt.submit {queued: true}   — gateway holds it as a
//                   "run after" envelope; NEVER redirects the live turn.
//   /steer <text> → busy mode bridge (config.set busy=steer → submit →
//                   restore) — injects a course correction after the current
//                   atomic action, without killing the turn.
//
// Plain text while a turn is streaming also queues (Claude-Code-style), so
// nothing typed mid-reply is ever lost or silently interrupts work.

export type ParsedCommand =
  | { kind: "plain"; text: string }
  | { kind: "bg"; text: string }
  | { kind: "steer"; text: string };

// A bare "/bg" or "/steer" with no payload is NOT a command — treated as plain
// text so the agent can answer what the user obviously meant to ask about.
const COMMAND_RE = /^\/(bg|steer)\s+([\s\S]+)$/;

export function parseCommand(input: string): ParsedCommand {
  const text = input.trim();
  const m = COMMAND_RE.exec(text);
  if (!m) return { kind: "plain", text };
  const body = m[2].trim();
  if (!body) return { kind: "plain", text };
  return m[1] === "bg" ? { kind: "bg", text: body } : { kind: "steer", text: body };
}

// True while the composer should keep accepting input mid-turn (it always
// should: sends become queued/steered, never dropped).
export function composerAcceptsInput(_isStreaming: boolean): boolean {
  return true;
}
