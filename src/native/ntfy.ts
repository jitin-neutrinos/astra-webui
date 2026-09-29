import { registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

export interface NativeNtfyPlugin {
  start(): Promise<{ status: string }>;
  stop(): Promise<{ status: string }>;
}

export const NativeNtfy = registerPlugin<NativeNtfyPlugin>('NativeNtfy');

export async function configureNtfy(connString: string) {
  if (connString) {
    await Preferences.set({ key: 'ntfy_conn', value: connString });
    await NativeNtfy.start();
  } else {
    await Preferences.remove({ key: 'ntfy_conn' });
    await NativeNtfy.stop();
  }
}

export async function getNtfyConnString() {
  const { value } = await Preferences.get({ key: 'ntfy_conn' });
  return value;
}
