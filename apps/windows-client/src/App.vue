<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { PairingConfig } from './env';
import { loadConfig, saveConfig } from './lib/config';
import { pinLogin, pinLogout, endSession, endComputerSession, warmUpServer } from './lib/api';
import { socketClient } from './lib/socket';
import { formatTime } from './lib/time';

type Screen = 'loading' | 'pairing' | 'lock' | 'session' | 'expired' | 'maintenance';

const screen = ref<Screen>('loading');
const config = ref<PairingConfig | null>(null);
const connected = ref(false);
const connecting = ref(false);

const pairForm = ref({
  serverUrl: 'http://localhost:3000',
  computerId: '',
  authSecret: '',
  computerCode: '',
  maintenanceCode: '',
});

// Maintenance mode: unrestricted PC access for updates/repairs (no paid session).
const maintenancePromptOpen = ref(false);
const maintenanceCodeInput = ref('');
const maintenanceError = ref('');
let removeMaintenancePrompt: (() => void) | undefined;

// Sticky mini-timer: collapses the session window to a small always-on-top widget.
const minimized = ref(false);
let removeSessionMinimize: (() => void) | undefined;

const loginForm = ref({ username: '', pin: '' });
const lastCredentials = ref({ username: '', pin: '' });
const loginError = ref('');

const sessionId = ref('');
const sessionToken = ref('');
const username = ref('');
const remainingSeconds = ref(0);
const startedAt = ref<Date | null>(null);

// When no one is logged in, the PC auto-shuts-down after this many idle seconds.
const IDLE_SHUTDOWN_SECONDS = 60;
const idleSecondsLeft = ref(IDLE_SHUTDOWN_SECONDS);

let countdownTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let idleTimer: ReturnType<typeof setInterval> | null = null;
let removeTrayLogout: (() => void) | undefined;

const displayTime = computed(() => formatTime(remainingSeconds.value));
const idleDisplay = computed(() => formatTime(idleSecondsLeft.value));

function triggerShutdown() {
  cancelIdleCountdown();
  window.pisonet?.shutdown?.();
}

function cancelIdleCountdown() {
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = null;
}

function startIdleCountdown() {
  cancelIdleCountdown();
  idleSecondsLeft.value = IDLE_SHUTDOWN_SECONDS;
  idleTimer = setInterval(() => {
    idleSecondsLeft.value -= 1;
    if (idleSecondsLeft.value <= 0) {
      triggerShutdown();
    }
  }, 1000);
}

// The PC is "unlocked" only during an active paid session. Every other
// screen (pairing, lock, expired, loading) keeps the kiosk lock engaged so
// the customer cannot reach the Windows desktop without time credits.
// While locked (no account), the idle auto-shutdown countdown runs.
watch(
  screen,
  (current) => {
    // Leaving a session always collapses the sticky mini-timer back to normal.
    if (current !== 'session' && minimized.value) {
      minimized.value = false;
      if (current !== 'maintenance') {
        void window.pisonet?.exitMiniTimer?.();
      }
    }
    if (current === 'maintenance') {
      // Lock release + window restore handled by enterMaintenance(); no shutdown.
      cancelIdleCountdown();
      return;
    }
    if (current === 'session') {
      window.pisonet?.releaseLock?.();
      cancelIdleCountdown();
      // Default to the sticky mini-timer so the customer can use the PC right
      // away; they can expand to the full card to log out.
      minimized.value = true;
      void window.pisonet?.enterMiniTimer?.();
    } else {
      window.pisonet?.engageLock?.();
      if (current === 'lock' || current === 'expired') {
        startIdleCountdown();
      } else {
        cancelIdleCountdown();
      }
    }
  },
  { immediate: true }
);

function clearTimers() {
  if (countdownTimer) clearInterval(countdownTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  countdownTimer = null;
  heartbeatTimer = null;
}

function startCountdown() {
  clearTimers();
  countdownTimer = setInterval(() => {
    if (remainingSeconds.value > 0) {
      remainingSeconds.value -= 1;
    } else {
      screen.value = 'expired';
      clearTimers();
    }
  }, 1000);
}

function resetSession() {
  sessionId.value = '';
  sessionToken.value = '';
  username.value = '';
  remainingSeconds.value = 0;
  startedAt.value = null;
  loginError.value = '';
}

function enterLockScreen() {
  resetSession();
  loginForm.value = { username: lastCredentials.value.username, pin: '' };
  screen.value = 'lock';
}

async function endActiveSession(): Promise<void> {
  if (!config.value) return;

  const creds = lastCredentials.value;
  const hasPinCreds = creds.username && creds.pin;

  if (hasPinCreds) {
    await pinLogout(config.value.serverUrl, creds.username, creds.pin, config.value.computerId);
    return;
  }

  if (sessionId.value) {
    await endComputerSession(
      config.value.serverUrl,
      config.value.computerId,
      config.value.authSecret,
      sessionId.value
    );
    return;
  }

  if (sessionId.value && sessionToken.value) {
    await endSession(config.value.serverUrl, sessionToken.value, sessionId.value);
  }
}

function connectSocket() {
  if (!config.value) return;

  connecting.value = true;

  socketClient.connect(config.value.serverUrl, config.value.computerId, config.value.authSecret, {
    onConnect: () => {
      connected.value = true;
      connecting.value = false;
    },
    onDisconnect: () => {
      connected.value = false;
      connecting.value = true;
    },
    onStartSession: (payload) => {
      sessionId.value = payload.sessionId;
      username.value = payload.username;
      remainingSeconds.value = payload.remainingSeconds;
      startedAt.value = new Date(payload.startedAt);
      if (!lastCredentials.value.username) {
        lastCredentials.value.username = payload.username;
      }
      screen.value = 'session';
      startCountdown();
    },
    onAddTime: (payload) => {
      remainingSeconds.value = payload.remainingSeconds;
    },
    onSessionEnded: () => {
      clearTimers();
      resetSession();
      screen.value = 'lock';
    },
    onSessionExpired: () => {
      clearTimers();
      screen.value = 'expired';
    },
    onForceLock: () => {
      clearTimers();
      resetSession();
      screen.value = 'lock';
    },
    onShutdown: () => {
      triggerShutdown();
    },
    onMaintenance: (payload) => {
      if (payload?.enabled) {
        void enterMaintenanceMode();
      } else if (screen.value === 'maintenance') {
        void exitMaintenanceMode();
      }
    },
  });

  heartbeatTimer = setInterval(() => {
    socketClient.sendHeartbeat();
  }, 30000);
}

async function savePairing() {
  const nextConfig: PairingConfig = {
    serverUrl: pairForm.value.serverUrl.trim(),
    computerId: pairForm.value.computerId.trim(),
    authSecret: pairForm.value.authSecret.trim(),
    computerCode: pairForm.value.computerCode.trim() || undefined,
    maintenanceCode: pairForm.value.maintenanceCode.trim() || undefined,
  };

  if (!nextConfig.serverUrl || !nextConfig.computerId || !nextConfig.authSecret) {
    loginError.value = 'Fill in server URL, computer ID, and auth secret.';
    return;
  }

  await saveConfig(nextConfig);
  config.value = nextConfig;
  loginError.value = '';
  enterLockScreen();
  connecting.value = true;
  await warmUpServer(nextConfig.serverUrl);
  connectSocket();
}

async function handleLogin() {
  if (!config.value) return;

  loginError.value = '';

  try {
    const result = await pinLogin(
      config.value.serverUrl,
      loginForm.value.username.trim(),
      loginForm.value.pin.trim(),
      config.value.computerId
    );

    lastCredentials.value = {
      username: loginForm.value.username.trim(),
      pin: loginForm.value.pin.trim(),
    };

    sessionId.value = result.sessionId;
    sessionToken.value = result.token;
    username.value = result.username;
    remainingSeconds.value = result.remainingSeconds;
    startedAt.value = new Date();
    screen.value = 'session';
    startCountdown();
  } catch (err) {
    loginError.value = err instanceof Error ? err.message : 'Login failed';
  }
}

async function handleLogout() {
  if (!config.value) {
    enterLockScreen();
    return;
  }

  try {
    await endActiveSession();
  } catch (err) {
    loginError.value = err instanceof Error ? err.message : 'Logout failed';
    screen.value = 'lock';
    return;
  }

  clearTimers();
  enterLockScreen();
}

async function minimizeSession() {
  if (screen.value !== 'session') return;
  minimized.value = true;
  await window.pisonet?.enterMiniTimer?.();
}

async function restoreFromMini() {
  minimized.value = false;
  await window.pisonet?.exitMiniTimer?.();
}

async function handleExpiredBackToLogin() {
  try {
    await endActiveSession();
  } catch {
    // Session may already be ended server-side
  } finally {
    clearTimers();
    enterLockScreen();
  }
}

function openMaintenancePrompt() {
  if (screen.value === 'maintenance') return;
  maintenanceCodeInput.value = '';
  maintenanceError.value = '';
  maintenancePromptOpen.value = true;
}

async function enterMaintenanceMode() {
  clearTimers();
  resetSession();
  cancelIdleCountdown();
  maintenancePromptOpen.value = false;
  screen.value = 'maintenance';
  await window.pisonet?.enterMaintenance?.();
}

async function submitMaintenanceCode() {
  const expected = config.value?.maintenanceCode?.trim();
  if (!expected) {
    maintenanceError.value =
      'No maintenance code set on this PC. Use the admin portal to unlock remotely.';
    return;
  }
  if (maintenanceCodeInput.value.trim() !== expected) {
    maintenanceError.value = 'Incorrect maintenance code.';
    return;
  }
  await enterMaintenanceMode();
}

async function exitMaintenanceMode() {
  await window.pisonet?.exitMaintenance?.();
  enterLockScreen();
}

// Only reachable from maintenance mode (which already required the code), so the
// app can never be quit from the locked/session screens that customers see.
async function quitApplication() {
  await window.pisonet?.quitApp?.();
}

onMounted(async () => {
  const saved = await loadConfig();
  if (!saved) {
    screen.value = 'pairing';
    return;
  }

  config.value = saved;
  pairForm.value = {
    serverUrl: saved.serverUrl,
    computerId: saved.computerId,
    authSecret: saved.authSecret,
    computerCode: saved.computerCode || '',
    maintenanceCode: saved.maintenanceCode || '',
  };
  enterLockScreen();
  connecting.value = true;
  await warmUpServer(saved.serverUrl);
  connectSocket();

  removeTrayLogout = window.pisonet?.onTrayLogout(() => {
    void handleLogout();
  });

  removeMaintenancePrompt = window.pisonet?.onMaintenancePrompt(() => {
    openMaintenancePrompt();
  });

  // Alt+F4 / window-close during a session collapses to the sticky mini-timer.
  removeSessionMinimize = window.pisonet?.onSessionMinimize(() => {
    if (screen.value === 'session') minimized.value = true;
  });
});

onUnmounted(() => {
  removeTrayLogout?.();
  removeMaintenancePrompt?.();
  removeSessionMinimize?.();
  clearTimers();
  cancelIdleCountdown();
  socketClient.disconnect();
});
</script>

<template>
  <div class="center-screen">
    <div
      v-if="connecting && screen !== 'pairing' && screen !== 'maintenance' && !minimized"
      class="overlay"
    >
      <div class="card">
        <h2>Connecting to server…</h2>
        <p class="muted">
          Waking cloud server if needed (may take up to a minute after hours). Timers resume when
          connected.
        </p>
      </div>
    </div>

    <div v-if="screen === 'pairing'" class="card">
      <h1>Pair this PC</h1>
      <p class="muted">Enter the server URL and credentials from the admin setup.</p>

      <label class="field">
        <span>Server URL</span>
        <input v-model="pairForm.serverUrl" placeholder="https://your-app.onrender.com" />
      </label>

      <label class="field">
        <span>Computer ID</span>
        <input v-model="pairForm.computerId" placeholder="MongoDB computer _id" />
      </label>

      <label class="field">
        <span>Auth secret</span>
        <input v-model="pairForm.authSecret" placeholder="Pairing token" />
      </label>

      <label class="field">
        <span>Computer code (optional label)</span>
        <input v-model="pairForm.computerCode" placeholder="PC01" />
      </label>

      <label class="field">
        <span>Maintenance code (unlocks PC for repairs)</span>
        <input v-model="pairForm.maintenanceCode" placeholder="e.g. a staff-only secret" />
      </label>

      <button class="primary" @click="savePairing">Save & connect</button>
      <p v-if="loginError" class="error">{{ loginError }}</p>
    </div>

    <div v-else-if="screen === 'lock'" class="card">
      <h1>Pisonet Login</h1>
      <p class="muted">
        {{ config?.computerCode || 'Computer' }}
        <span v-if="connected"> · online</span>
        <span v-else> · offline</span>
      </p>

      <label class="field">
        <span>Username</span>
        <input v-model="loginForm.username" @keyup.enter="handleLogin" />
      </label>

      <label class="field">
        <span>PIN</span>
        <input v-model="loginForm.pin" type="password" maxlength="6" @keyup.enter="handleLogin" />
      </label>

      <button class="primary" :disabled="!connected" @click="handleLogin">Start session</button>
      <p v-if="loginError" class="error">{{ loginError }}</p>
      <p class="muted idle-hint">PC shuts down in {{ idleDisplay }} if no one logs in.</p>
    </div>

    <!-- Sticky mini-timer: small always-on-top, draggable widget while the customer uses the PC.
         Fixed to fill the whole tiny window so the frameless content never shows scrollbars. -->
    <div v-if="screen === 'session' && minimized" class="mini-timer" title="Drag to move">
      <span class="mini-time">{{ displayTime }}</span>
      <div class="mini-buttons">
        <button class="mini-btn" title="Maximize" @click="restoreFromMini">⤢</button>
        <button class="mini-btn mini-logout" title="Logout &amp; save time" @click="handleLogout">
          ⏻
        </button>
      </div>
    </div>

    <div v-else-if="screen === 'session'" class="card session-card">
      <p class="muted">Logged in as {{ username }}</p>
      <div class="timer-display">{{ displayTime }}</div>
      <p class="muted">Time remaining</p>
      <p class="muted tray-hint">
        Minimize to keep using the PC — a small timer stays on top of your screen.
      </p>
      <div class="session-actions">
        <button class="secondary" @click="minimizeSession">Minimize</button>
        <button class="danger" @click="handleLogout">Logout & save time</button>
      </div>
    </div>

    <div v-else-if="screen === 'expired'" class="card">
      <h1>Time expired</h1>
      <p class="muted">Your session has ended. Please add more time to continue.</p>
      <button class="primary" @click="handleExpiredBackToLogin">Back to login</button>
      <p class="muted idle-hint">PC shuts down in {{ idleDisplay }} if no one logs in.</p>
    </div>

    <div v-else-if="screen === 'maintenance'" class="card session-card">
      <h1>Maintenance mode</h1>
      <p class="muted">
        {{ config?.computerCode || 'This PC' }} is unlocked for servicing. The keyboard and desktop
        are fully accessible. Auto-shutdown is paused.
      </p>
      <p class="muted tray-hint">Lock the PC again when you're done.</p>
      <div class="session-actions">
        <button class="secondary" @click="quitApplication">Quit application</button>
        <button class="primary" @click="exitMaintenanceMode">Exit maintenance &amp; lock</button>
      </div>
    </div>

    <!-- Maintenance unlock prompt (triggered by secret combo or tray) -->
    <div v-if="maintenancePromptOpen" class="overlay">
      <div class="card">
        <h2>Maintenance access</h2>
        <p class="muted">Enter the maintenance code to unlock this PC for repairs.</p>
        <label class="field">
          <span>Maintenance code</span>
          <input
            v-model="maintenanceCodeInput"
            type="password"
            autofocus
            @keyup.enter="submitMaintenanceCode"
          />
        </label>
        <p v-if="maintenanceError" class="error">{{ maintenanceError }}</p>
        <div class="prompt-actions">
          <button class="secondary" @click="maintenancePromptOpen = false">Cancel</button>
          <button class="primary" @click="submitMaintenanceCode">Unlock</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.field span {
  color: #94a3b8;
  font-size: 14px;
}

.session-card {
  text-align: center;
  width: min(520px, 90vw);
}

h1 {
  margin: 0 0 8px;
}

.tray-hint {
  font-size: 13px;
  margin: 8px 0 16px;
}

.idle-hint {
  font-size: 13px;
  margin-top: 16px;
  color: #f59e0b;
}

.prompt-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 16px;
}

.session-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.session-actions button {
  flex: 1;
  max-width: 220px;
}

/* Sticky mini-timer fills the entire tiny always-on-top window. Fixed + inset:0
   so it never relies on the centered layout (which caused scrollbars). The bar
   itself is a drag region so the customer can move it anywhere on screen. */
.mini-timer {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px 0 14px;
  overflow: hidden;
  background: #111827;
  border: 1px solid #334155;
  border-radius: 12px;
  user-select: none;
  cursor: move;
  -webkit-app-region: drag;
}

.mini-time {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 1px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.mini-buttons {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

/* Buttons must opt out of the drag region so their clicks register. */
.mini-btn {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  font-size: 18px;
  line-height: 1;
  color: #e2e8f0;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 8px;
  cursor: pointer;
}

.mini-btn:hover {
  background: #334155;
}

.mini-logout {
  color: #fca5a5;
  border-color: #7f1d1d;
}

.mini-logout:hover {
  background: #dc2626;
  color: #fff;
}
</style>
