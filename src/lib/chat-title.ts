// Pure title hygiene, shared by the header, the browser tab and the sidebar.
// The gateway derives its instant title from the raw turn text, which can still carry
// per-turn machine scaffolding ("[Surface: this message came from the user's Astra web UI
// chat ..."). That is never a name a person chose: show it as "untitled" instead.

const SCAFFOLD = /^\[(surface|system|runtime note|context compaction)\b/i;

export function cleanTitle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const t = raw.replace(/\s+/g, " ").trim();
  return t && !SCAFFOLD.test(t) ? t : "";
}
