
export const EFFORTS = [
  { id: "none", label: "None" }, { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" }, { id: "medium", label: "Medium" },
  { id: "high", label: "High" }, { id: "xhigh", label: "Extra High" },
  { id: "max", label: "Maximum" }, { id: "ultra", label: "Ultra" },
] as const;

export const TUI_COMMANDS = [
  "/bg","/steer","/model","/reasoning","/new","/sessions","/compact","/usage",
  "/skills","/tools","/memory","/approvals","/help","/stop","/status",
];

export type Catalog = { providers: { slug: string; label: string; models: string[] }[]; current_provider: string; model?: string; provider?: string };
export type ModelGroup = { provider: string; label: string; models: string[] };

export function canSelectEffort(effort: string) { return effort !== ""; }
export function effortLabel(effort: string) { return effort === "" ? "Provider default" : EFFORTS.find((e) => e.id === effort)?.label ?? effort; }

export function modelGroups(catalog: Catalog | null, sessionProvider?: string, sessionModel?: string): ModelGroup[] {
  const groups: ModelGroup[] = (catalog?.providers ?? []).map((p) => ({ provider: p.slug, label: p.label, models: [...p.models] }));
  if (sessionProvider && sessionModel) {
    const own = groups.find((g) => g.provider === sessionProvider);
    if (own) { if (!own.models.includes(sessionModel)) own.models.unshift(sessionModel); }
    else groups.unshift({ provider: sessionProvider, label: sessionProvider, models: [sessionModel] });
  }
  return groups;
}

export function filterSlashCommands(query: string): string[] {
  if (!query.startsWith("/")) return [];
  return TUI_COMMANDS.filter((c) => c.startsWith(query.toLowerCase()));
}
