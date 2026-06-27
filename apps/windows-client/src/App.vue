<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { PairingConfig } from './env';
import { loadConfig, saveConfig } from './lib/config';
import { pinLogin, pinLogout, endSession, endComputerSession } from './lib/api';
import { socketClient } from './lib/socket';
import { formatTime } from './lib/time';

type Screen = 'loading' | 'pairing' | 'lock' | 'session' | 'expired';

const screen = ref<Screen>('loading');
const config = ref<PairingConfig | null>(null);
const connected = ref(false);
const connecting = ref(false);

const pairForm = ref({
  serverUrl: 'http://localhost:3000',
  computerId: '',
  authSecret: '',
  computerCode: '',
});

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

// Any keyboard/mouse activity on the login screen resets the idle timer so a
// customer actively typing credentials is never shut down mid-login.
function resetIdleCountdown() {
  if (idleTimer) {
    idleSecondsLeft.value = IDLE_SHUTDOWN_SECONDS;
  }
}

// The PC is "unlocked" only during an active paid session. Every other
// screen (pairing, lock, expired, loading) keeps the kiosk lock engaged so
// the customer cannot reach the Windows desktop without time credits.
// While locked (no account), the idle auto-shutdown countdown runs.
watch(
  screen,
  (current) => {
    if (current === 'session') {
      window.pisonet?.releaseLock?.();
      cancelIdleCountdown();
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
  };

  if (!nextConfig.serverUrl || !nextConfig.computerId || !nextConfig.authSecret) {
    loginError.value = 'Fill in server URL, computer ID, and auth secret.';
    return;
  }

  await saveConfig(nextConfig);
  config.value = nextConfig;
  loginError.value = '';
  enterLockScreen();
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
  };
  enterLockScreen();
  connectSocket();

  removeTrayLogout = window.pisonet?.onTrayLogout(() => {
    void handleLogout();
  });

  window.addEventListener('keydown', resetIdleCountdown);
  window.addEventListener('mousedown', resetIdleCountdown);
  window.addEventListener('mousemove', resetIdleCountdown);
  window.addEventListener('touchstart', resetIdleCountdown);
});

onUnmounted(() => {
  removeTrayLogout?.();
  clearTimers();
  cancelIdleCountdown();
  socketClient.disconnect();
  window.removeEventListener('keydown', resetIdleCountdown);
  window.removeEventListener('mousedown', resetIdleCountdown);
  window.removeEventListener('mousemove', resetIdleCountdown);
  window.removeEventListener('touchstart', resetIdleCountdown);
});
</script>

<template>
  <div class="center-screen">
    <div v-if="connecting && screen !== 'pairing'" class="overlay">
      <div class="card">
        <h2>Connecting to server…</h2>
        <p class="muted">Waiting for connection. Timers resume automatically when connected.</p>
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

    <div v-else-if="screen === 'session'" class="card session-card">
      <p class="muted">Logged in as {{ username }}</p>
      <div class="timer-display">{{ displayTime }}</div>
      <p class="muted">Time remaining</p>
      <p class="muted tray-hint">Close button minimizes to system tray. Session keeps running.</p>
      <button class="danger" @click="handleLogout">Logout & save time</button>
    </div>

    <div v-else-if="screen === 'expired'" class="card">
      <h1>Time expired</h1>
      <p class="muted">Your session has ended. Please add more time to continue.</p>
      <button class="primary" @click="handleExpiredBackToLogin">Back to login</button>
      <p class="muted idle-hint">PC shuts down in {{ idleDisplay }} if no one logs in.</p>
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
</style>
