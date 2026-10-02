export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export function formatUSD(n: number): string {
  return "$" + n.toFixed(2);
}

export const HARNESS_META: Record<string, { label: string; provider: string; note: string }> = {
  "claude-code": { label: "Claude Code", provider: "Anthropic", note: "" },
  hermes: { label: "Hermes", provider: "z.ai / OpenRouter / Nous", note: "" },
  opencode: { label: "OpenCode", provider: "z.ai coding plan", note: "" },
  agy: { label: "agy (Antigravity)", provider: "Google Gemini", note: "agy does not persist per-request usage locally. Excluded from totals — never estimated." },
};
