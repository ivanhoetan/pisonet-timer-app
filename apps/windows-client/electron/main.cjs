const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  powerSaveBlocker,
  globalShortcut,
  ipcMain,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const Store = require('electron-store');

const store = new Store();
let mainWindow = null;
let tray = null;
let powerBlocker = null;
let isQuitting = false;
let lockdownActive = true;

const isDev = !app.isPackaged;

// Shortcuts to swallow while the PC is locked (no active paid session).
const LOCK_SHORTCUTS = [
  'Alt+Tab',
  'Alt+Escape',
  'Alt+F4',
  'Super',
  'Super+D',
  'Super+E',
  'Super+R',
  'Super+Tab',
  'Control+Escape',
  'CommandOrControl+Shift+Escape',
];

function getTrayIcon() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }
  const fallback = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FAAh5AmfQ1I96AAAAAElFTkSuQmCC'
  );
  return fallback.resize({ width: 16, height: 16 });
}

function registerLockShortcuts() {
  if (isDev) return;
  for (const accelerator of LOCK_SHORTCUTS) {
    try {
      globalShortcut.register(accelerator, () => {});
    } catch {
      // Some accelerators cannot be registered on all systems; ignore.
    }
  }
}

function unregisterLockShortcuts() {
  for (const accelerator of LOCK_SHORTCUTS) {
    try {
      globalShortcut.unregister(accelerator);
    } catch {
      // ignore
    }
  }
}

function bringToFront() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
}

function applyLock() {
  lockdownActive = true;
  if (!mainWindow) return;

  mainWindow.setMinimizable(false);
  if (!isDev) {
    mainWindow.setKiosk(true);
    mainWindow.setFullScreen(true);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }
  bringToFront();
  registerLockShortcuts();
}

function releaseLock() {
  lockdownActive = false;
  if (!mainWindow) return;

  unregisterLockShortcuts();
  mainWindow.setMinimizable(true);
  if (!isDev) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setKiosk(false);
  }
}

function showMainWindow() {
  if (!mainWindow) return;
  bringToFront();
  if (!isDev && lockdownActive) {
    mainWindow.setFullScreen(true);
  }
}

function requestLogoutFromTray() {
  if (!mainWindow) return;
  showMainWindow();
  mainWindow.webContents.send('tray:logout');
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

function shutdownPc() {
  if (isDev) {
    // Never shut down the developer's machine.
    console.log('[dev] shutdown requested (ignored in dev mode)');
    return;
  }

  if (process.platform === 'win32') {
    exec('shutdown /s /f /t 0');
  } else if (process.platform === 'darwin') {
    exec('osascript -e \'tell app "System Events" to shut down\'');
  } else {
    exec('shutdown -h now');
  }
}

function createTray() {
  tray = new Tray(getTrayIcon());
  tray.setToolTip('Pisonet Timer');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Pisonet Timer',
      click: showMainWindow,
    },
    { type: 'separator' },
    {
      label: 'Logout & save time',
      click: requestLogoutFromTray,
    },
    { type: 'separator' },
    {
      label: 'Quit application (admin)',
      click: quitApp,
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', showMainWindow);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: !isDev,
    kiosk: !isDev,
    frame: isDev,
    autoHideMenuBar: true,
    show: false,
    minimizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    applyLock();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Block escape/refresh/devtools keys while locked.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!lockdownActive || isDev) return;
    const key = (input.key || '').toLowerCase();
    const isReload = key === 'f5' || (input.control && key === 'r');
    const isDevtools =
      key === 'f12' || (input.control && input.shift && (key === 'i' || key === 'j'));
    const isFullscreenToggle = key === 'f11';
    if (isReload || isDevtools || isFullscreenToggle) {
      event.preventDefault();
    }
  });

  // While locked, refuse to lose foreground.
  mainWindow.on('blur', () => {
    if (!lockdownActive || isDev) return;
    setTimeout(() => {
      if (lockdownActive) bringToFront();
    }, 80);
  });

  // While locked, refuse to minimize.
  mainWindow.on('minimize', (e) => {
    if (lockdownActive && !isDev) {
      e.preventDefault();
      showMainWindow();
    }
  });

  // Close: when locked, stay up; when in a session, hide to tray.
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    if (lockdownActive) {
      showMainWindow();
    } else {
      mainWindow.hide();
    }
  });

  powerBlocker = powerSaveBlocker.start('prevent-display-sleep');
}

const gotInstanceLock = app.requestSingleInstanceLock();

if (!gotInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  showMainWindow();
});

app.whenReady().then(() => {
  ipcMain.handle('config:get', () => store.get('pairing'));
  ipcMain.handle('config:set', (_event, config) => {
    store.set('pairing', config);
    return true;
  });
  ipcMain.handle('config:clear', () => {
    store.delete('pairing');
    return true;
  });
  ipcMain.handle('window:show', () => {
    showMainWindow();
    return true;
  });
  ipcMain.handle('lock:engage', () => {
    applyLock();
    return true;
  });
  ipcMain.handle('lock:release', () => {
    releaseLock();
    return true;
  });
  ipcMain.handle('system:shutdown', () => {
    shutdownPc();
    return true;
  });

  if (!isDev) {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
    });
  }

  createWindow();
  createTray();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  isQuitting = true;
  unregisterLockShortcuts();
  if (powerBlocker) {
    powerSaveBlocker.stop(powerBlocker);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  showMainWindow();
});

module.exports = { store };
