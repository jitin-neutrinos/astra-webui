export interface Msg {
  role: "user" | "assistant";
  content: string;
}

export function normalizeMessages(rows: any[]): Msg[] {
  const msgs: Msg[] = [];
  for (const row of rows) {
    if (row.role !== "user" && row.role !== "assistant") continue;
    const content = typeof row.text === "string" ? row.text 
                  : typeof row.content === "string" ? row.content 
                  : typeof row.display_content === "string" ? row.display_content 
                  : "";
    if (row.role === "assistant" && !content) continue;
    msgs.push({ role: row.role, content });
  }
  return msgs;
}
