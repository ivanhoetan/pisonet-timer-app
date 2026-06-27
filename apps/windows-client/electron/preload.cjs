const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pisonet', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),
  clearConfig: () => ipcRenderer.invoke('config:clear'),
  showWindow: () => ipcRenderer.invoke('window:show'),
  engageLock: () => ipcRenderer.invoke('lock:engage'),
  releaseLock: () => ipcRenderer.invoke('lock:release'),
  shutdown: () => ipcRenderer.invoke('system:shutdown'),
  onTrayLogout: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('tray:logout', listener);
    return () => ipcRenderer.removeListener('tray:logout', listener);
  },
});
