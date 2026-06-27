const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  powerSaveBlocker,
  globalShortcut,
  screen,
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
let maintenanceActive = false;
let miniActive = false;
let preMiniBounds = null;

const isDev = !app.isPackaged;

// Secret combo that opens the maintenance unlock prompt while the PC is locked.
const MAINTENANCE_SHORTCUT = 'Control+Alt+Shift+M';

// Sticky mini-timer widget dimensions (shown top-right during a session):
// time readout + maximize + logout buttons in one compact bar.
const MINI_WIDTH = 210;
const MINI_HEIGHT = 56;

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

function promptMaintenance() {
  if (!mainWindow || maintenanceActive) return;
  bringToFront();
  mainWindow.webContents.send('maintenance:prompt');
}

function registerMaintenanceShortcut() {
  if (isDev) return;
  try {
    globalShortcut.register(MAINTENANCE_SHORTCUT, promptMaintenance);
  } catch {
    // ignore
  }
}

function unregisterMaintenanceShortcut() {
  try {
    globalShortcut.unregister(MAINTENANCE_SHORTCUT);
  } catch {
    // ignore
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
  maintenanceActive = false;
  if (!mainWindow) return;

  mainWindow.setMinimizable(false);
  if (!isDev) {
    mainWindow.setKiosk(true);
    mainWindow.setFullScreen(true);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }
  bringToFront();
  registerLockShortcuts();
  registerMaintenanceShortcut();
}

function releaseLock() {
  lockdownActive = false;
  if (!mainWindow) return;

  unregisterLockShortcuts();
  unregisterMaintenanceShortcut();
  mainWindow.setMinimizable(true);
  if (!isDev) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setKiosk(false);
  }
}

// Sticky mini-timer: shrink the window to a small always-on-top widget in the
// top-right corner so the customer can use the PC while still seeing their time.
function enterMiniTimer() {
  if (!mainWindow || !mainWindow.isVisible()) {
    if (mainWindow) mainWindow.show();
  }
  if (!mainWindow) return;

  miniActive = true;
  preMiniBounds = mainWindow.getBounds();

  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  if (!isDev) mainWindow.setKiosk(false);
  mainWindow.setResizable(false);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  const area = screen.getPrimaryDisplay().workArea;
  mainWindow.setBounds({
    x: area.x + area.width - MINI_WIDTH - 16,
    y: area.y + 16,
    width: MINI_WIDTH,
    height: MINI_HEIGHT,
  });
}

function exitMiniTimer() {
  miniActive = false;
  if (!mainWindow) return;

  mainWindow.setResizable(true);
  mainWindow.setAlwaysOnTop(false);
  if (isDev) {
    if (preMiniBounds) mainWindow.setBounds(preMiniBounds);
  } else {
    mainWindow.setFullScreen(true);
  }
  bringToFront();
}

// Maintenance mode: full, unrestricted access to the PC for updates/repairs.
// Unlocks the keyboard and screen without starting a paid session.
function enterMaintenance() {
  maintenanceActive = true;
  miniActive = false;
  releaseLock();
  if (!mainWindow) return;

  // Restore a usable, movable window (could be coming from the mini timer).
  mainWindow.setResizable(true);
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  const area = screen.getPrimaryDisplay().workArea;
  const w = Math.min(900, area.width - 80);
  const h = Math.min(600, area.height - 80);
  mainWindow.setBounds({
    x: area.x + Math.round((area.width - w) / 2),
    y: area.y + Math.round((area.height - h) / 2),
    width: w,
    height: h,
  });
  bringToFront();
}

function exitMaintenance() {
  applyLock();
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

  // Close (incl. Alt+F4):
  //  - locked: stay up (no escape to desktop).
  //  - active session: collapse to the sticky mini-timer instead of vanishing,
  //    so the customer always sees their remaining time.
  //  - maintenance: hide to tray (admin is servicing).
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    if (lockdownActive) {
      showMainWindow();
    } else if (maintenanceActive) {
      mainWindow.hide();
    } else {
      enterMiniTimer();
      mainWindow.webContents.send('session:minimize');
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
  ipcMain.handle('maintenance:enter', () => {
    enterMaintenance();
    return true;
  });
  ipcMain.handle('maintenance:exit', () => {
    exitMaintenance();
    return true;
  });
  ipcMain.handle('mini:enter', () => {
    enterMiniTimer();
    return true;
  });
  ipcMain.handle('mini:exit', () => {
    exitMiniTimer();
    return true;
  });
  ipcMain.handle('app:quit', () => {
    quitApp();
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
