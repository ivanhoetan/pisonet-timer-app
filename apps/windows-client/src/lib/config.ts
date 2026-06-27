import type { PairingConfig } from './env';

const memoryConfig: { value?: PairingConfig } = {};

export async function loadConfig(): Promise<PairingConfig | null> {
  if (window.pisonet) {
    const config = await window.pisonet.getConfig();
    return config ?? null;
  }
  return memoryConfig.value ?? null;
}

export async function saveConfig(config: PairingConfig): Promise<void> {
  if (window.pisonet) {
    await window.pisonet.setConfig(config);
  } else {
    memoryConfig.value = config;
  }
}

export function normalizeServerUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function toWsUrl(serverUrl: string): string {
  const normalized = normalizeServerUrl(serverUrl);
  if (normalized.startsWith('https://')) {
    return normalized.replace('https://', 'wss://');
  }
  if (normalized.startsWith('http://')) {
    return normalized.replace('http://', 'ws://');
  }
  return `ws://${normalized}`;
}
