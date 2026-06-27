export interface PairingConfig {
  serverUrl: string;
  computerId: string;
  authSecret: string;
  computerCode?: string;
}

export interface PisonetBridge {
  getConfig: () => Promise<PairingConfig | undefined>;
  setConfig: (config: PairingConfig) => Promise<boolean>;
  clearConfig: () => Promise<boolean>;
  showWindow: () => Promise<boolean>;
  engageLock: () => Promise<boolean>;
  releaseLock: () => Promise<boolean>;
  shutdown: () => Promise<boolean>;
  onTrayLogout: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    pisonet?: PisonetBridge;
  }
}

export {};
