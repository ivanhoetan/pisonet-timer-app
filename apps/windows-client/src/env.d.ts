export interface PairingConfig {
  serverUrl: string;
  computerId: string;
  authSecret: string;
  computerCode?: string;
  maintenanceCode?: string;
}

export interface PisonetBridge {
  getConfig: () => Promise<PairingConfig | undefined>;
  setConfig: (config: PairingConfig) => Promise<boolean>;
  clearConfig: () => Promise<boolean>;
  showWindow: () => Promise<boolean>;
  engageLock: () => Promise<boolean>;
  releaseLock: () => Promise<boolean>;
  shutdown: () => Promise<boolean>;
  enterMaintenance: () => Promise<boolean>;
  exitMaintenance: () => Promise<boolean>;
  enterMiniTimer: () => Promise<boolean>;
  exitMiniTimer: () => Promise<boolean>;
  quitApp: () => Promise<boolean>;
  onTrayLogout: (callback: () => void) => () => void;
  onMaintenancePrompt: (callback: () => void) => () => void;
  onSessionMinimize: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    pisonet?: PisonetBridge;
  }
}

export {};
