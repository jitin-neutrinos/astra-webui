// Format classification for the chat document previewer. Kept separate from
// doc-preview.tsx so media-card can import it statically without pulling the
// viewer engines into the main bundle (the component itself stays lazy).
export type PreviewKind = "pdf" | "docx" | "xlsx" | "pptx" | "text" | "unsupported";

const TEXT_EXTS = new Set([
  "txt", "md", "log", "json", "xml", "yaml", "yml", "ts", "tsx", "js", "jsx",
  "mjs", "cjs", "css", "html", "htm", "py", "sh", "rs", "go", "java", "c",
  "h", "cpp", "sql", "toml", "ini", "conf", "env", "gitignore", "tsv",
]);

export function previewKind(name: string): PreviewKind {
  const dot = name.lastIndexOf(".");
  const e = (dot >= 0 ? name.slice(dot + 1) : "").toLowerCase();
  if (e === "pdf") return "pdf";
  if (e === "docx") return "docx";
  if (e === "xlsx" || e === "xls" || e === "csv") return "xlsx";
  if (e === "pptx") return "pptx";
  if (TEXT_EXTS.has(e) || e === "") return "text";
  return "unsupported";
}
