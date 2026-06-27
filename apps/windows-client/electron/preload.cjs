const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pisonet', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),
  clearConfig: () => ipcRenderer.invoke('config:clear'),
  showWindow: () => ipcRenderer.invoke('window:show'),
  engageLock: () => ipcRenderer.invoke('lock:engage'),
  releaseLock: () => ipcRenderer.invoke('lock:release'),
  shutdown: () => ipcRenderer.invoke('system:shutdown'),
  enterMaintenance: () => ipcRenderer.invoke('maintenance:enter'),
  exitMaintenance: () => ipcRenderer.invoke('maintenance:exit'),
  enterMiniTimer: () => ipcRenderer.invoke('mini:enter'),
  exitMiniTimer: () => ipcRenderer.invoke('mini:exit'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  onTrayLogout: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('tray:logout', listener);
    return () => ipcRenderer.removeListener('tray:logout', listener);
  },
  onMaintenancePrompt: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('maintenance:prompt', listener);
    return () => ipcRenderer.removeListener('maintenance:prompt', listener);
  },
  onSessionMinimize: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('session:minimize', listener);
    return () => ipcRenderer.removeListener('session:minimize', listener);
  },
});
