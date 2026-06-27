const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  powerSaveBlocker,
  ipcMain,
} = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

const store = new Store();
let mainWindow = null;
let tray = null;
let powerBlocker = null;
let isQuitting = false;

const isDev = !app.isPackaged;

function getTrayIcon() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }

  // Fallback: simple blue square
  const fallback = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FAAh5AmfQ1I96AAAAAElFTkSuQmCC'
  );
  return fallback.resize({ width: 16, height: 16 });
}

function showMainWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
  if (!isDev) {
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
      label: 'Quit application',
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (!isDev) {
      mainWindow.setFullScreen(true);
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    mainWindow.hide();
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
  if (powerBlocker) {
    powerSaveBlocker.stop(powerBlocker);
  }
});

app.on('activate', () => {
  showMainWindow();
});

module.exports = { store };
