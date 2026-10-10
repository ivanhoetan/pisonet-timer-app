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
const { exec, spawn } = require('child_process');
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
// Bumped to cancel in-flight reclaim retries when the lock is released.
let reclaimGeneration = 0;
// Low-level keyboard hook process (blocks Alt+Tab / Win while locked).
let keyboardLockProc = null;
let keyboardLockStopping = false;

const isDev = !app.isPackaged;

// Processes that must never be force-minimized / killed when reclaiming the
// display from exclusive-fullscreen games (Valorant, etc.).
const RECLAIM_PROTECTED_PROCESSES = [
  'explorer',
  'dwm',
  'csrss',
  'winlogon',
  'services',
  'lsass',
  'svchost',
  'fontdrvhost',
  'sihost',
  'taskhostw',
  'RuntimeBroker',
  'SearchHost',
  'ShellExperienceHost',
  'StartMenuExperienceHost',
  'TextInputHost',
  'ApplicationFrameHost',
  'SystemSettings',
  'SecurityHealthSystray',
  'conhost',
  'Idle',
  'System',
  'Registry',
];

// Secret combo that opens the maintenance unlock prompt while the PC is locked.
const MAINTENANCE_SHORTCUT = 'Control+Alt+Shift+M';

// Sticky mini-timer widget dimensions (shown top-right during a session):
// time readout + maximize + logout buttons in one compact bar.
const MINI_WIDTH = 210;
const MINI_HEIGHT = 56;

// Best-effort Electron layer (many of these are ignored by Windows; the
// WH_KEYBOARD_LL hook in keyboard-lock.ps1 is the reliable blocker).
const LOCK_SHORTCUTS = [
  'Alt+Tab',
  'Alt+Shift+Tab',
  'Alt+Escape',
  'Alt+F4',
  'Alt+Space',
  'Super',
  'Super+D',
  'Super+E',
  'Super+R',
  'Super+Tab',
  'Super+L',
  'Control+Escape',
  'Control+Alt+Tab',
];

// Kept registered even during a paid session, when the kiosk lock is released.
const TASKMGR_SHORTCUTS = ['Control+Shift+Escape', 'CommandOrControl+Shift+Escape'];

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

function stopKeyboardLock() {
  if (!keyboardLockProc) return;
  keyboardLockStopping = true;
  const proc = keyboardLockProc;
  keyboardLockProc = null;
  try {
    proc.kill();
  } catch {
    // ignore
  }
  if (proc.pid && process.platform === 'win32') {
    exec(`taskkill /PID ${proc.pid} /T /F`, { windowsHide: true }, () => {
      keyboardLockStopping = false;
    });
  } else {
    keyboardLockStopping = false;
  }
}

/**
 * Spawn a WH_KEYBOARD_LL hook that eats Alt+Tab / Win / Ctrl+Esc while locked.
 * Electron globalShortcut alone cannot block these on Windows.
 */
function startKeyboardLock() {
  if (isDev || process.platform !== 'win32') return;
  if (keyboardLockProc) return;

  const scriptPath = path.join(__dirname, 'keyboard-lock.ps1');
  if (!fs.existsSync(scriptPath)) {
    console.error('[lock] keyboard-lock.ps1 missing — Alt+Tab may still work');
    return;
  }

  keyboardLockStopping = false;
  keyboardLockProc = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
    { windowsHide: true, stdio: 'ignore' }
  );

  keyboardLockProc.on('error', (err) => {
    console.error('[lock] keyboard hook failed to start', err);
    keyboardLockProc = null;
  });

  keyboardLockProc.on('exit', () => {
    keyboardLockProc = null;
    // If the hook dies while still locked, restart it (unless we stopped it).
    if (!keyboardLockStopping && lockdownActive && !isQuitting) {
      setTimeout(() => {
        if (lockdownActive && !isQuitting && !keyboardLockProc) {
          startKeyboardLock();
        }
      }, 400);
    }
  });
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
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  if (lockdownActive || miniActive) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }
  mainWindow.focus();
  mainWindow.moveTop();
}

function collectOurPids() {
  const pids = new Set([process.pid]);
  try {
    for (const metric of app.getAppMetrics()) {
      pids.add(metric.pid);
    }
  } catch {
    // ignore
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      pids.add(mainWindow.webContents.getOSProcessId());
    } catch {
      // ignore
    }
  }
  return [...pids];
}

/**
 * Exclusive-fullscreen games (Valorant, etc.) own the GPU swap chain and ignore
 * Electron always-on-top / focus. When locking, force-minimize other windows
 * and terminate non-system apps so the login screen can take the display.
 */
function reclaimDisplay() {
  const gen = ++reclaimGeneration;
  bringToFront();

  if (isDev || process.platform !== 'win32') return;

  const keepPids = collectOurPids();
  const keepCsv = keepPids.join(',');
  const protectedCsv = RECLAIM_PROTECTED_PROCESSES.map((n) => `'${n}'`).join(',');

  // C# helper via Add-Type: EnumWindows → SW_FORCEMINIMIZE, then Kill remaining
  // non-protected processes that still hold a visible titled window / focus.
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class KioskReclaim {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);

  public static void Run(int[] keepPids, string[] protectedNames) {
    var keep = new HashSet<int>(keepPids);
    var protectedSet = new HashSet<string>(protectedNames, StringComparer.OrdinalIgnoreCase);
    var toKill = new HashSet<int>();

    EnumWindows((hWnd, l) => {
      if (!IsWindowVisible(hWnd)) return true;
      if (GetWindowTextLength(hWnd) == 0) return true;
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      int id = (int)pid;
      if (keep.Contains(id)) return true;
      ShowWindow(hWnd, 11); // SW_FORCEMINIMIZE
      try {
        var name = Process.GetProcessById(id).ProcessName;
        if (!protectedSet.Contains(name)) toKill.Add(id);
      } catch {}
      return true;
    }, IntPtr.Zero);

    var fg = GetForegroundWindow();
    if (fg != IntPtr.Zero) {
      uint pid;
      GetWindowThreadProcessId(fg, out pid);
      int id = (int)pid;
      if (!keep.Contains(id)) {
        try {
          var name = Process.GetProcessById(id).ProcessName;
          if (!protectedSet.Contains(name)) toKill.Add(id);
        } catch {}
      }
    }

    foreach (var id in toKill) {
      try { Process.GetProcessById(id).Kill(); } catch {}
    }
  }
}
"@
[KioskReclaim]::Run(@(${keepCsv}), @(${protectedCsv}))
`.trim();

  exec(
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ${JSON.stringify(ps)}`,
    { windowsHide: true, timeout: 15000 },
    () => {
      if (gen === reclaimGeneration && lockdownActive) bringToFront();
    }
  );

  // Exclusive fullscreen can take a moment to release the display after kill.
  for (const ms of [150, 400, 800, 1500, 3000]) {
    setTimeout(() => {
      if (gen !== reclaimGeneration || !lockdownActive) return;
      if (!isDev && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setKiosk(true);
        mainWindow.setFullScreen(true);
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      }
      bringToFront();
    }, ms);
  }
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
  reclaimDisplay();
  registerLockShortcuts();
  startKeyboardLock();
  registerMaintenanceShortcut();
}

function releaseLock() {
  lockdownActive = false;
  reclaimGeneration += 1;
  unregisterLockShortcuts();
  stopKeyboardLock();
  unregisterMaintenanceShortcut();
  if (!mainWindow) return;

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

function kioskMarkerPath() {
  return path.join(app.getPath('userData'), 'kiosk-run');
}

function watchdogPidPath() {
  return path.join(app.getPath('userData'), 'watchdog.pid');
}

function watchdogScriptPath() {
  const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'watchdog.ps1');
  if (fs.existsSync(unpacked)) return unpacked;
  return path.join(__dirname, 'watchdog.ps1');
}

function isPidAlive(pid) {
  if (!pid || Number.isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readWatchdogPid() {
  try {
    return parseInt(fs.readFileSync(watchdogPidPath(), 'utf8'), 10);
  } catch {
    return 0;
  }
}

function writeRunMarker() {
  try {
    fs.mkdirSync(path.dirname(kioskMarkerPath()), { recursive: true });
    fs.writeFileSync(kioskMarkerPath(), String(process.pid));
  } catch (err) {
    console.error('[watchdog] failed to write run marker', err);
  }
}

function disableTaskManager() {
  if (isDev || process.platform !== 'win32') return;
  exec(
    'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" /v DisableTaskMgr /t REG_DWORD /d 1 /f',
    { windowsHide: true },
    () => {}
  );
}

function registerTaskMgrBlock() {
  if (isDev) return;
  for (const accelerator of TASKMGR_SHORTCUTS) {
    try {
      globalShortcut.register(accelerator, () => {});
    } catch {
      // ignore
    }
  }
}

// Separate process so killing Pisonet Timer.exe does not kill the relauncher.
function ensureWatchdog() {
  if (isDev || isQuitting || process.platform !== 'win32') return;
  if (!fs.existsSync(watchdogScriptPath())) return;
  if (isPidAlive(readWatchdogPid())) return;

  writeRunMarker();
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-File',
      watchdogScriptPath(),
      '-ExePath',
      process.execPath,
      '-MarkerPath',
      kioskMarkerPath(),
      '-PidPath',
      watchdogPidPath(),
    ],
    { detached: true, stdio: 'ignore', windowsHide: true }
  );
  child.unref();
  if (child.pid) {
    try {
      fs.writeFileSync(watchdogPidPath(), String(child.pid));
    } catch {
      // ignore
    }
  }
}

function stopKioskGuard() {
  isQuitting = true;
  try {
    fs.unlinkSync(kioskMarkerPath());
  } catch {
    // ignore
  }
  const pid = readWatchdogPid();
  if (isPidAlive(pid) && pid !== process.pid) {
    try {
      process.kill(pid);
    } catch {
      // ignore
    }
  }
  try {
    fs.unlinkSync(watchdogPidPath());
  } catch {
    // ignore
  }
}

function quitApp() {
  stopKioskGuard();
  app.quit();
}

function shutdownPc() {
  if (isDev) {
    // Never shut down the developer's machine.
    console.log('[dev] shutdown requested (ignored in dev mode)');
    return;
  }

  stopKioskGuard();

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

  // While locked, refuse to lose foreground and keep the key hook alive.
  mainWindow.on('blur', () => {
    if (!lockdownActive || isDev) return;
    setTimeout(() => {
      if (!lockdownActive) return;
      bringToFront();
      startKeyboardLock();
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
    disableTaskManager();
    registerTaskMgrBlock();
    ensureWatchdog();
    setInterval(ensureWatchdog, 3000);
  }

  createWindow();
  createTray();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  stopKioskGuard();
  unregisterLockShortcuts();
  stopKeyboardLock();
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
