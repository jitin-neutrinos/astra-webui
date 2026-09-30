// "All" = only Jitin's own conversations (web, telegram, terminal). Cron jobs
// and other internal sources stay out of the human chat list; one-shots are a
// separate, explicitly-filterable lane (agent-run transcripts, not chats).
const HUMAN_SOURCES = ['webui', 'telegram', 'cli', 'tui', 'android'];

export type SourceModal = 'all' | 'web' | 'telegram' | 'terminal' | 'android' | 'oneshot';

export function sourcesParam(modal: SourceModal): string {
  if (modal === 'all') return HUMAN_SOURCES.join(',');
  if (modal === 'web') return 'webui';
  if (modal === 'telegram') return 'telegram';
  if (modal === 'android') return 'android';
  if (modal === 'oneshot') return 'oneshot';
  return 'cli,tui';
}

export function sourceLabel(source: string): string {
  if (source === 'webui') return 'Web';
  if (source === 'telegram') return 'Telegram';
  if (source === 'android') return 'Android';
  if (source === 'cli' || source === 'tui') return 'Terminal';
  return source;
}
