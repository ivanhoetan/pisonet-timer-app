<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { PairingConfig } from './env';
import { loadConfig, saveConfig } from './lib/config';
import {
  passwordLogin,
  endSession,
  endComputerSession,
  warmUpServer,
  registerUser,
  changePassword,
  claimComputer,
} from './lib/api';
import { socketClient } from './lib/socket';
import { formatTime } from './lib/time';
import {
  lowTimeLevel,
  lowTimeMessage,
  LOW_TIME_WARN_1_MIN,
  LOW_TIME_WARN_5_MIN,
  playWarningTone,
  type LowTimeLevel,
} from './lib/timeWarnings';

type Screen = 'loading' | 'pairing' | 'lock' | 'register' | 'session' | 'expired' | 'maintenance';

const screen = ref<Screen>('loading');
const config = ref<PairingConfig | null>(null);
const connected = ref(false);
const connecting = ref(false);

const DEFAULT_SERVER_URL = 'https://pisonet-timer-api.onrender.com';

const pairForm = ref({
  serverUrl: DEFAULT_SERVER_URL,
  pairingCode: '',
  computerId: '',
  authSecret: '',
  computerCode: '',
  maintenanceCode: '',
});
// 'code' = quick pair with a short code; 'manual' = paste ID + auth secret.
const pairMode = ref<'code' | 'manual'>('code');
const pairing = ref(false);

// Maintenance mode: unrestricted PC access for updates/repairs (no paid session).
const maintenancePromptOpen = ref(false);
const maintenanceCodeInput = ref('');
const maintenanceError = ref('');
let removeMaintenancePrompt: (() => void) | undefined;

// Sticky mini-timer: collapses the session window to a small always-on-top widget.
const minimized = ref(false);
let removeSessionMinimize: (() => void) | undefined;

const loginForm = ref({ username: '', password: '' });
const lastCredentials = ref({ username: '' });
const loginError = ref('');
const loggingIn = ref(false);
const loginStatus = ref<'idle' | 'waking' | 'signing-in'>('idle');

// Customer self-registration (from the lock screen).
const registerForm = ref({
  username: '',
  nickname: '',
  password: '',
  mobileNumber: '',
});
const registerError = ref('');
const registerInfo = ref('');
const registerSaving = ref(false);

// Change password (while logged in).
const passwordModalOpen = ref(false);
const passwordForm = ref({ currentPassword: '', newPassword: '', confirmPassword: '' });
const passwordError = ref('');
const passwordInfo = ref('');
const passwordSaving = ref(false);

const sessionId = ref('');
const sessionToken = ref('');
const username = ref('');
const remainingSeconds = ref(0);
const startedAt = ref<Date | null>(null);
// Wall-clock end time so a suspended / throttled process cannot "pause" the
// visible countdown — when the UI wakes, remaining snaps to real elapsed time.
const sessionEndsAtMs = ref<number | null>(null);
const loyaltyStamps = ref(0);

// Loyalty: 5 stamps = 1 free hour. Mirrors the server constant.
const STAMPS_PER_REWARD = 5;
const stampsToNextReward = computed(
  () => (STAMPS_PER_REWARD - (loyaltyStamps.value % STAMPS_PER_REWARD)) % STAMPS_PER_REWARD
);
const freeHoursAvailable = computed(() => Math.floor(loyaltyStamps.value / STAMPS_PER_REWARD));

// When no one is logged in, the PC auto-shuts-down after this many idle seconds.
const IDLE_SHUTDOWN_SECONDS = 60;
const idleSecondsLeft = ref(IDLE_SHUTDOWN_SECONDS);

let countdownTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let idleTimer: ReturnType<typeof setInterval> | null = null;
let removeTrayLogout: (() => void) | undefined;

const displayTime = computed(() => formatTime(remainingSeconds.value));
const idleDisplay = computed(() => formatTime(idleSecondsLeft.value));

const sessionTimeWarning = computed((): LowTimeLevel => {
  if (screen.value !== 'session') return 'none';
  return lowTimeLevel(remainingSeconds.value);
});

const sessionTimeWarningMessage = computed(() => lowTimeMessage(sessionTimeWarning.value));

watch(remainingSeconds, (next, prev) => {
  if (screen.value !== 'session' || next <= 0) return;
  if (prev > LOW_TIME_WARN_5_MIN && next <= LOW_TIME_WARN_5_MIN) {
    playWarningTone('5min');
  }
  if (prev > LOW_TIME_WARN_1_MIN && next <= LOW_TIME_WARN_1_MIN) {
    playWarningTone('1min');
  }
});

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
      // Idle auto-shutdown while waiting on login / register / expired screens.
      // Keep the same countdown when switching between lock ↔ register.
      if (current === 'lock' || current === 'expired' || current === 'register') {
        if (!idleTimer) startIdleCountdown();
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

function applyRemainingSeconds(seconds: number, sessionStartedAt?: Date | null) {
  const safe = Math.max(0, Math.floor(seconds));
  remainingSeconds.value = safe;
  // remainingSeconds is already net of elapsed time, so the end instant is
  // "now + remaining" — never startedAt + remaining.
  sessionEndsAtMs.value = Date.now() + safe * 1000;
  if (sessionStartedAt) {
    startedAt.value = sessionStartedAt;
  }
}

function syncRemainingFromWallClock() {
  if (sessionEndsAtMs.value == null) return;
  const left = Math.max(0, Math.ceil((sessionEndsAtMs.value - Date.now()) / 1000));
  remainingSeconds.value = left;
  if (left <= 0) {
    screen.value = 'expired';
    clearTimers();
  }
}

function startCountdown() {
  clearTimers();
  syncRemainingFromWallClock();
  countdownTimer = setInterval(() => {
    syncRemainingFromWallClock();
  }, 1000);
}

function resetSession() {
  sessionId.value = '';
  sessionToken.value = '';
  username.value = '';
  remainingSeconds.value = 0;
  startedAt.value = null;
  sessionEndsAtMs.value = null;
  loyaltyStamps.value = 0;
  loginError.value = '';
}

function enterLockScreen() {
  resetSession();
  loginForm.value = { username: lastCredentials.value.username, password: '' };
  screen.value = 'lock';
}

async function endActiveSession(): Promise<void> {
  if (!config.value) return;

  if (!sessionId.value) return;

  // Prefer ending via the computer's auth secret (works even if the user JWT
  // expired); fall back to the session token. Both bank the remaining time.
  try {
    await endComputerSession(
      config.value.serverUrl,
      config.value.computerId,
      config.value.authSecret,
      sessionId.value
    );
  } catch (err) {
    if (sessionToken.value) {
      await endSession(config.value.serverUrl, sessionToken.value, sessionId.value);
    } else {
      throw err;
    }
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
      applyRemainingSeconds(payload.remainingSeconds, new Date(payload.startedAt));
      if (typeof payload.loyaltyStamps === 'number') {
        loyaltyStamps.value = payload.loyaltyStamps;
      }
      if (!lastCredentials.value.username) {
        lastCredentials.value.username = payload.username;
      }
      screen.value = 'session';
      startCountdown();
    },
    onAddTime: (payload) => {
      applyRemainingSeconds(payload.remainingSeconds);
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
  const serverUrl = pairForm.value.serverUrl.trim();
  if (!serverUrl) {
    loginError.value = 'Enter the server URL.';
    return;
  }

  let computerId = pairForm.value.computerId.trim();
  let authSecret = pairForm.value.authSecret.trim();
  let computerCode = pairForm.value.computerCode.trim() || undefined;

  if (pairMode.value === 'code') {
    const code = pairForm.value.pairingCode.trim();
    if (!code) {
      loginError.value = 'Enter the pairing code from the admin portal.';
      return;
    }
    loginError.value = '';
    pairing.value = true;
    try {
      await warmUpServer(serverUrl);
      const claimed = await claimComputer(serverUrl, code);
      computerId = claimed.computerId;
      authSecret = claimed.authSecret;
      computerCode = claimed.computerCode || computerCode;
    } catch (err) {
      loginError.value =
        err instanceof Error ? err.message : 'Could not pair with that code. Check it and retry.';
      return;
    } finally {
      pairing.value = false;
    }
  } else if (!computerId || !authSecret) {
    loginError.value = 'Fill in computer ID and auth secret (or switch to Quick pair).';
    return;
  }

  const nextConfig: PairingConfig = {
    serverUrl,
    computerId,
    authSecret,
    computerCode,
    maintenanceCode: pairForm.value.maintenanceCode.trim() || undefined,
  };

  await saveConfig(nextConfig);
  config.value = nextConfig;
  loginError.value = '';
  enterLockScreen();
  connecting.value = true;
  await warmUpServer(nextConfig.serverUrl);
  connectSocket();
}

async function handleLogin() {
  if (!config.value || loggingIn.value) return;

  const loginUsername = loginForm.value.username.trim();
  const password = loginForm.value.password;

  loginError.value = '';

  if (!loginUsername) {
    loginError.value = 'Username is required';
    return;
  }
  if (!password) {
    loginError.value = 'Password is required';
    return;
  }

  loggingIn.value = true;
  loginStatus.value = 'waking';

  try {
    await warmUpServer(config.value.serverUrl);
    loginStatus.value = 'signing-in';
    const result = await passwordLogin(
      config.value.serverUrl,
      loginUsername,
      password,
      config.value.computerId
    );

    lastCredentials.value = { username: loginUsername };

    sessionId.value = result.sessionId;
    sessionToken.value = result.token;
    username.value = result.username;
    loyaltyStamps.value = result.loyaltyStamps ?? 0;
    startedAt.value = new Date();
    applyRemainingSeconds(result.remainingSeconds, startedAt.value);
    screen.value = 'session';
    startCountdown();
  } catch (err) {
    loginError.value = err instanceof Error ? err.message : 'Login failed';
  } finally {
    loggingIn.value = false;
    loginStatus.value = 'idle';
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

function openRegister() {
  registerForm.value = { username: '', nickname: '', password: '', mobileNumber: '' };
  registerError.value = '';
  registerInfo.value = '';
  screen.value = 'register';
}

function backToLogin() {
  registerError.value = '';
  screen.value = 'lock';
}

async function handleRegister() {
  if (!config.value) return;

  registerError.value = '';
  registerInfo.value = '';

  const username = registerForm.value.username.trim();
  const nickname = registerForm.value.nickname.trim();
  const password = registerForm.value.password;
  const mobileNumber = registerForm.value.mobileNumber.trim();

  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
    registerError.value = 'Username must be 3–32 letters, numbers, or underscores.';
    return;
  }
  if (password.length < 6) {
    registerError.value = 'Password must be at least 6 characters.';
    return;
  }

  registerSaving.value = true;
  try {
    await registerUser(config.value.serverUrl, {
      username,
      nickname: nickname || undefined,
      password,
      mobileNumber: mobileNumber || undefined,
    });

    loginForm.value = { username, password: '' };
    lastCredentials.value = { username };
    screen.value = 'lock';
    registerInfo.value = '';
    loginError.value = 'Account created! Ask staff to load time, then log in.';
  } catch (err) {
    registerError.value = err instanceof Error ? err.message : 'Registration failed';
  } finally {
    registerSaving.value = false;
  }
}

function openPasswordModal() {
  passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' };
  passwordError.value = '';
  passwordInfo.value = '';
  passwordModalOpen.value = true;
}

async function handleChangePassword() {
  if (!config.value || !sessionToken.value) {
    passwordError.value = 'You must be logged in to change your password.';
    return;
  }

  passwordError.value = '';
  passwordInfo.value = '';

  const { currentPassword, newPassword, confirmPassword } = passwordForm.value;

  if (newPassword.length < 6) {
    passwordError.value = 'New password must be at least 6 characters.';
    return;
  }
  if (newPassword !== confirmPassword) {
    passwordError.value = 'New passwords do not match.';
    return;
  }

  passwordSaving.value = true;
  try {
    await changePassword(config.value.serverUrl, sessionToken.value, currentPassword, newPassword);
    passwordInfo.value = 'Password updated successfully.';
    passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' };
    setTimeout(() => {
      passwordModalOpen.value = false;
    }, 1200);
  } catch (err) {
    passwordError.value = err instanceof Error ? err.message : 'Failed to change password';
  } finally {
    passwordSaving.value = false;
  }
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
    pairingCode: '',
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
      v-if="
        connecting &&
        screen !== 'pairing' &&
        screen !== 'maintenance' &&
        screen !== 'lock' &&
        screen !== 'register' &&
        !minimized
      "
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
      <p class="muted">Register this PC in the admin portal, then enter the pairing code here.</p>

      <div class="pair-tabs">
        <button :class="{ active: pairMode === 'code' }" @click="pairMode = 'code'">Quick pair</button>
        <button :class="{ active: pairMode === 'manual' }" @click="pairMode = 'manual'">Manual</button>
      </div>

      <label class="field">
        <span>Server URL</span>
        <input v-model="pairForm.serverUrl" placeholder="https://your-app.onrender.com" />
      </label>

      <template v-if="pairMode === 'code'">
        <label class="field">
          <span>Pairing code (from admin portal → Computers)</span>
          <input
            v-model="pairForm.pairingCode"
            class="pair-code-input"
            placeholder="7K2-Q9F"
            autocapitalize="characters"
            @keyup.enter="savePairing"
          />
        </label>
      </template>

      <template v-else>
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
      </template>

      <label class="field">
        <span>Maintenance code (unlocks PC for repairs)</span>
        <input v-model="pairForm.maintenanceCode" placeholder="e.g. a staff-only secret" />
      </label>

      <button class="primary" :disabled="pairing" @click="savePairing">
        {{ pairing ? 'Pairing…' : 'Save & connect' }}
      </button>
      <p v-if="loginError" class="error">{{ loginError }}</p>
    </div>

    <div v-else-if="screen === 'lock'" class="card">
      <h1>Pisonet Login</h1>
      <p class="muted">
        {{ config?.computerCode || 'Computer' }}
        <span v-if="connected"> · online</span>
        <span v-else-if="connecting"> · reconnecting…</span>
        <span v-else> · offline</span>
      </p>
      <p v-if="connecting && !connected" class="reconnect-hint">
        Server link is catching up — you can still try to log in.
      </p>

      <label class="field">
        <span>Username</span>
        <input
          v-model="loginForm.username"
          autocapitalize="none"
          :disabled="loggingIn"
          @keyup.enter="handleLogin"
        />
      </label>

      <label class="field">
        <span>Password</span>
        <input
          v-model="loginForm.password"
          type="password"
          :disabled="loggingIn"
          @keyup.enter="handleLogin"
        />
      </label>

      <button class="primary" :disabled="loggingIn" @click="handleLogin">
        <span v-if="loggingIn" class="btn-loading">
          <span class="spinner" aria-hidden="true"></span>
          {{ loginStatus === 'waking' ? 'Waking server…' : 'Logging in…' }}
        </span>
        <span v-else>Start session</span>
      </button>
      <p v-if="loginError" class="error">{{ loginError }}</p>

      <div class="lock-divider"><span>new here?</span></div>
      <button class="secondary" :disabled="loggingIn" @click="openRegister">
        Create an account
      </button>

      <p class="muted idle-hint">PC shuts down in {{ idleDisplay }} if no one logs in.</p>
    </div>

    <div v-else-if="screen === 'register'" class="card">
      <h1>Create account</h1>
      <p class="muted">Register a new player account. Staff will load your time after payment.</p>
      <p v-if="connecting && !connected" class="reconnect-hint">
        Server link is catching up — registration may take a moment.
      </p>

      <label class="field">
        <span>Username (3–32 letters, numbers, _)</span>
        <input v-model="registerForm.username" autocapitalize="none" @keyup.enter="handleRegister" />
      </label>

      <label class="field">
        <span>Nickname (optional)</span>
        <input v-model="registerForm.nickname" @keyup.enter="handleRegister" />
      </label>

      <label class="field">
        <span>Password (min 6 characters, used to log in)</span>
        <input
          v-model="registerForm.password"
          type="password"
          @keyup.enter="handleRegister"
        />
      </label>

      <label class="field">
        <span>Mobile number (optional)</span>
        <input v-model="registerForm.mobileNumber" inputmode="tel" @keyup.enter="handleRegister" />
      </label>

      <button class="primary" :disabled="!connected || registerSaving" @click="handleRegister">
        {{ registerSaving ? 'Creating…' : 'Create account' }}
      </button>
      <p v-if="registerError" class="error">{{ registerError }}</p>
      <button class="secondary" :disabled="registerSaving" @click="backToLogin">
        Back to login
      </button>
      <p class="muted idle-hint">PC shuts down in {{ idleDisplay }} if no one logs in.</p>
    </div>

    <!-- Sticky mini-timer: small always-on-top, draggable widget while the customer uses the PC.
         Fixed to fill the whole tiny window so the frameless content never shows scrollbars. -->
    <div
      v-if="screen === 'session' && minimized"
      class="mini-timer"
      :class="{
        'mini-timer--warn-5': sessionTimeWarning === '5min',
        'mini-timer--warn-1': sessionTimeWarning === '1min',
      }"
      title="Drag to move"
    >
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

      <div
        v-if="sessionTimeWarning !== 'none'"
        class="time-warn-banner"
        :class="sessionTimeWarning === '1min' ? 'time-warn-banner--critical' : ''"
        role="alert"
      >
        {{ sessionTimeWarningMessage }}
      </div>

      <div
        class="timer-display"
        :class="{
          'timer-display--warn-5': sessionTimeWarning === '5min',
          'timer-display--warn-1': sessionTimeWarning === '1min',
        }"
      >
        {{ displayTime }}
      </div>
      <p class="muted">Time remaining</p>

      <div class="loyalty-box">
        <div class="loyalty-head">
          <span class="loyalty-title">Loyalty stamps</span>
          <span class="loyalty-count">{{ loyaltyStamps }}</span>
        </div>
        <div class="loyalty-dots">
          <span
            v-for="i in STAMPS_PER_REWARD"
            :key="i"
            class="loyalty-dot"
            :class="{ filled: i <= loyaltyStamps % STAMPS_PER_REWARD }"
          ></span>
        </div>
        <p class="loyalty-note">
          <template v-if="freeHoursAvailable > 0">
            You have {{ freeHoursAvailable }} free hour<span v-if="freeHoursAvailable > 1">s</span>
            ready — ask staff to redeem.
          </template>
          <template v-else>
            {{ stampsToNextReward }} more stamp<span v-if="stampsToNextReward > 1">s</span> for 1
            free hour.
          </template>
        </p>
      </div>

      <p class="muted tray-hint">
        Minimize to keep using the PC — a small timer stays on top of your screen.
      </p>
      <div class="session-actions">
        <button class="secondary" @click="minimizeSession">Minimize</button>
        <button class="danger" @click="handleLogout">Logout & save time</button>
      </div>
      <button
        v-if="sessionToken"
        class="link-btn"
        @click="openPasswordModal"
      >
        Change password
      </button>
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

    <!-- Change password (while logged in) -->
    <div v-if="passwordModalOpen" class="overlay">
      <div class="card">
        <h2>Change password</h2>
        <p class="muted">Update the password for your account.</p>
        <label class="field">
          <span>Current password</span>
          <input
            v-model="passwordForm.currentPassword"
            type="password"
            @keyup.enter="handleChangePassword"
          />
        </label>
        <label class="field">
          <span>New password (min 6 characters)</span>
          <input
            v-model="passwordForm.newPassword"
            type="password"
            @keyup.enter="handleChangePassword"
          />
        </label>
        <label class="field">
          <span>Confirm new password</span>
          <input
            v-model="passwordForm.confirmPassword"
            type="password"
            @keyup.enter="handleChangePassword"
          />
        </label>
        <p v-if="passwordError" class="error">{{ passwordError }}</p>
        <p v-if="passwordInfo" class="info">{{ passwordInfo }}</p>
        <div class="prompt-actions">
          <button class="secondary" :disabled="passwordSaving" @click="passwordModalOpen = false">
            Cancel
          </button>
          <button class="primary" :disabled="passwordSaving" @click="handleChangePassword">
            {{ passwordSaving ? 'Saving…' : 'Update password' }}
          </button>
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

.time-warn-banner {
  margin: 0 0 14px;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.45);
  color: #fcd34d;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
}

.time-warn-banner--critical {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.55);
  color: #fca5a5;
  animation: warn-pulse 1s ease-in-out infinite;
}

.timer-display--warn-5 {
  color: #fbbf24;
}

.timer-display--warn-1 {
  color: #f87171;
  animation: warn-pulse 1s ease-in-out infinite;
}

@keyframes warn-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.65;
  }
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

.reconnect-hint {
  font-size: 13px;
  margin: -4px 0 12px;
  color: #f59e0b;
}

.prompt-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 16px;
}

.card > .primary,
.card > .secondary {
  width: 100%;
  margin-top: 10px;
}

.pair-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
  background: #0f172a;
  border-radius: 10px;
  padding: 4px;
}

.pair-tabs button {
  flex: 1;
  background: transparent;
  color: #94a3b8;
  padding: 9px;
  border-radius: 7px;
  font-size: 14px;
  margin: 0;
}

.pair-tabs button.active {
  background: #1e293b;
  color: #e2e8f0;
}

.pair-code-input {
  text-transform: uppercase;
  letter-spacing: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 20px;
  text-align: center;
}

.lock-divider {
  display: flex;
  align-items: center;
  text-align: center;
  gap: 10px;
  margin: 18px 0 14px;
  color: #64748b;
  font-size: 13px;
}

.lock-divider::before,
.lock-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #334155;
}

.link-btn {
  background: transparent;
  color: #94a3b8;
  padding: 8px;
  margin-top: 14px;
  font-size: 14px;
  text-decoration: underline;
}

.link-btn:hover {
  color: #e2e8f0;
}

.info {
  color: #4ade80;
  margin-top: 12px;
}

.btn-loading {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loyalty-box {
  margin: 18px auto 4px;
  max-width: 360px;
  padding: 14px 16px;
  background: rgba(234, 179, 8, 0.08);
  border: 1px solid rgba(234, 179, 8, 0.3);
  border-radius: 12px;
}

.loyalty-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.loyalty-title {
  font-size: 14px;
  color: #fde047;
  font-weight: 600;
}

.loyalty-count {
  font-size: 20px;
  font-weight: 700;
  color: #fde047;
  font-variant-numeric: tabular-nums;
}

.loyalty-dots {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin: 12px 0;
}

.loyalty-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(234, 179, 8, 0.5);
  background: transparent;
}

.loyalty-dot.filled {
  background: #eab308;
  border-color: #eab308;
}

.loyalty-note {
  margin: 0;
  font-size: 13px;
  color: #cbd5e1;
  text-align: center;
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

.mini-timer--warn-5 {
  border-color: #b45309;
  box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.35);
}

.mini-timer--warn-5 .mini-time {
  color: #fbbf24;
}

.mini-timer--warn-1 {
  border-color: #b91c1c;
  box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.45);
  animation: warn-pulse 1s ease-in-out infinite;
}

.mini-timer--warn-1 .mini-time {
  color: #f87171;
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
