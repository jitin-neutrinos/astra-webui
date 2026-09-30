import { sourcesParam, sourceLabel } from "./source-filter.ts";

function eq(a: any, b: any, msg: string) { if (a !== b) throw new Error(msg + ': ' + a + ' !== ' + b); }

eq(sourcesParam('all'), 'webui,telegram,cli,tui,android', 'all = human sources only (no oneshot)');
eq(sourcesParam('web'), 'webui', 'web');
eq(sourcesParam('telegram'), 'telegram', 'telegram');
eq(sourcesParam('android'), 'android', 'android');
eq(sourcesParam('oneshot'), 'oneshot', 'oneshot lane');
eq(sourcesParam('terminal'), 'cli,tui', 'terminal');
eq(sourceLabel('webui'), 'Web', 'label webui');
eq(sourceLabel('telegram'), 'Telegram', 'label telegram');
eq(sourceLabel('cli'), 'Terminal', 'label cli');
eq(sourceLabel('oneshot'), 'oneshot', 'unknown/oneshot falls through raw');
console.log('PASS: source-filter checks');
