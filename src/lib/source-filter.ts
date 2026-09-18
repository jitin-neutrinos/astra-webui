export function sourcesParam(modal: 'all' | 'web' | 'telegram' | 'terminal'): string {
  if (modal === 'all') return '';
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
