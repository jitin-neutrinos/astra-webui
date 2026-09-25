// "All" = only Jitin's own conversations (web, telegram, terminal). Cron jobs,
// subagents, one-shots and other internal sources are excluded — they are
// Hermes's work, not his chat list.
const HUMAN_SOURCES = ['webui', 'telegram', 'cli', 'tui'];

export function sourcesParam(modal: 'all' | 'web' | 'telegram' | 'terminal'): string {
  if (modal === 'all') return HUMAN_SOURCES.join(',');
  if (modal === 'web') return 'webui';
  if (modal === 'telegram') return 'telegram';
  return 'cli,tui';
}

export function sourceLabel(source: string): string {
  if (source === 'webui') return 'Web UI';
  if (source === 'telegram') return 'Telegram';
  if (source === 'cli' || source === 'tui') return 'Terminal';
  if (source === 'cron') return 'Cron';
  return source;
}
