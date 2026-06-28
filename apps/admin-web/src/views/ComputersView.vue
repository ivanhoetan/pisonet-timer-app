<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { api, ApiError, type Computer } from '../lib/api';
import Icon from '../components/Icon.vue';

const computers = ref<Computer[]>([]);
const loading = ref(false);
const error = ref('');
const toast = ref('');

const showRegister = ref(false);
const saving = ref(false);
const formError = ref('');
const regForm = ref({ computerCode: '', name: '' });

// Pairing details shown after registering or re-pairing a computer.
// authSecret is only present right after a fresh registration (manual fallback).
const newCredentials = ref<{
  id: string;
  computerCode: string;
  authSecret?: string;
  pairingCode: string;
  pairingCodeExpires: string;
} | null>(null);

function pairingExpiryLabel(iso: string): string {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  return mins > 0 ? `Expires in ~${mins} min` : 'Expired — generate a new code';
}

let syncTimer: ReturnType<typeof setInterval> | null = null;

const statusClass: Record<Computer['status'], string> = {
  ONLINE: 'online',
  IN_USE: 'inuse',
  OFFLINE: 'offline',
  LOCKED: 'locked',
  MAINTENANCE: 'maintenance',
};

async function load() {
  loading.value = true;
  error.value = '';
  try {
    computers.value = await api.get<Computer[]>('/computers');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    error.value = err instanceof ApiError ? err.message : 'Failed to load computers';
  } finally {
    loading.value = false;
  }
}

function showToast(msg: string) {
  toast.value = msg;
  setTimeout(() => (toast.value = ''), 2500);
}

async function register() {
  saving.value = true;
  formError.value = '';
  try {
    const res = await api.post<{
      id: string;
      computerCode: string;
      authSecret: string;
      pairingCode: string;
      pairingCodeExpires: string;
    }>('/computers/register', {
      computerCode: regForm.value.computerCode.trim().toUpperCase(),
      name: regForm.value.name.trim(),
    });
    newCredentials.value = res;
    showRegister.value = false;
    regForm.value = { computerCode: '', name: '' };
    await load();
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : 'Failed to register';
  } finally {
    saving.value = false;
  }
}

async function repair(c: Computer) {
  try {
    const res = await api.post<{
      id: string;
      computerCode: string;
      pairingCode: string;
      pairingCodeExpires: string;
    }>(`/computers/${c._id}/pairing-code`);
    newCredentials.value = res;
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : 'Failed to generate code');
  }
}

async function lock(c: Computer) {
  if (!confirm(`Lock ${c.computerCode}? Any active session is logged out (time saved).`)) return;
  try {
    await api.post(`/computers/${c._id}/lock`);
    showToast(`${c.computerCode} locked`);
    await load();
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : 'Lock failed');
  }
}

async function shutdown(c: Computer) {
  if (!confirm(`Shut down ${c.computerCode}? The PC will power off.`)) return;
  try {
    await api.post(`/computers/${c._id}/shutdown`);
    showToast(`${c.computerCode} shutting down`);
    await load();
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : 'Shutdown failed');
  }
}

async function toggleMaintenance(c: Computer) {
  const turningOn = c.status !== 'MAINTENANCE';
  const msg = turningOn
    ? `Put ${c.computerCode} in maintenance mode? The PC unlocks for free access (any active session is logged out, time saved).`
    : `End maintenance on ${c.computerCode}? The PC re-locks to the login screen.`;
  if (!confirm(msg)) return;
  try {
    await api.post(`/computers/${c._id}/maintenance`, { enabled: turningOn });
    showToast(turningOn ? `${c.computerCode} in maintenance` : `${c.computerCode} re-locked`);
    await load();
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : 'Maintenance toggle failed');
  }
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(() => showToast('Copied'));
}

onMounted(() => {
  load();
  syncTimer = setInterval(load, 10000);
});

onUnmounted(() => {
  if (syncTimer) clearInterval(syncTimer);
});
</script>

<template>
  <h1 class="page-title">Computers</h1>
  <p class="page-sub">Monitor and remotely control each PC.</p>

  <div class="toolbar">
    <button class="btn-ghost" @click="load"><Icon name="refresh" />Refresh</button>
    <div class="spacer"></div>
    <button class="btn-primary" @click="showRegister = true"><Icon name="plus" />Register PC</button>
  </div>

  <p v-if="error" class="error" style="margin-bottom: 14px">{{ error }}</p>

  <p v-if="loading && computers.length === 0" class="muted">Loading…</p>
  <p v-else-if="computers.length === 0" class="muted">No computers registered yet.</p>

  <div class="computer-grid">
    <div v-for="c in computers" :key="c._id" class="card computer-card">
      <div class="cc-head">
        <span class="cc-name">{{ c.computerCode }}</span>
        <span class="badge" :class="statusClass[c.status]">{{ c.status }}</span>
      </div>
      <span class="muted">{{ c.name }}</span>
      <div class="cc-actions">
        <button class="btn-ghost btn-sm" @click="repair(c)">
          <Icon name="link" :size="14" />Pair
        </button>
        <button
          class="btn-danger btn-sm"
          :disabled="c.status === 'OFFLINE'"
          @click="lock(c)"
        >
          <Icon name="lock" :size="14" />Lock
        </button>
        <button
          class="btn-warning btn-sm"
          :disabled="c.status === 'OFFLINE'"
          @click="shutdown(c)"
        >
          <Icon name="power" :size="14" />Shut down
        </button>
        <button
          class="btn-ghost btn-sm"
          :disabled="c.status === 'OFFLINE'"
          @click="toggleMaintenance(c)"
        >
          <Icon name="wrench" :size="14" />{{ c.status === 'MAINTENANCE' ? 'End maintenance' : 'Maintenance' }}
        </button>
      </div>
    </div>
  </div>

  <!-- Register modal -->
  <div v-if="showRegister" class="modal-backdrop" @click.self="showRegister = false">
    <div class="card modal">
      <h3>Register a PC</h3>
      <label class="field">
        <span>Computer code (e.g. PC01)</span>
        <input v-model="regForm.computerCode" placeholder="PC01" />
      </label>
      <label class="field">
        <span>Display name</span>
        <input v-model="regForm.name" placeholder="Corner unit by window" />
      </label>
      <p v-if="formError" class="error" style="margin-bottom: 12px">{{ formError }}</p>
      <div class="modal-actions">
        <button class="btn-ghost" @click="showRegister = false"><Icon name="x" />Cancel</button>
        <button class="btn-primary" :disabled="saving" @click="register">
          <Icon name="check" />{{ saving ? 'Saving…' : 'Register' }}
        </button>
      </div>
    </div>
  </div>

  <!-- Pairing details modal -->
  <div v-if="newCredentials" class="modal-backdrop" @click.self="newCredentials = null">
    <div class="card modal">
      <h3>Pair {{ newCredentials.computerCode }}</h3>
      <p class="muted" style="margin-top: -8px">
        On the PC's pairing screen, choose <strong>Quick pair</strong> and enter this code.
      </p>

      <div class="pair-code">{{ newCredentials.pairingCode }}</div>
      <p class="muted pair-expiry">{{ pairingExpiryLabel(newCredentials.pairingCodeExpires) }}</p>
      <button class="btn-primary" style="width: 100%; margin-bottom: 16px" @click="copy(newCredentials.pairingCode)">
        <Icon name="copy" :size="14" />Copy code
      </button>

      <details class="pair-advanced">
        <summary>Advanced: manual credentials</summary>
        <label class="field" style="margin-top: 12px">
          <span>Computer ID</span>
          <input :value="newCredentials.id" readonly @focus="($event.target as HTMLInputElement).select()" />
        </label>
        <button class="btn-ghost btn-sm" style="margin-bottom: 14px" @click="copy(newCredentials.id)">
          <Icon name="copy" :size="14" />Copy ID
        </button>
        <template v-if="newCredentials.authSecret">
          <label class="field">
            <span>Auth secret (shown only on first registration)</span>
            <input :value="newCredentials.authSecret" readonly @focus="($event.target as HTMLInputElement).select()" />
          </label>
          <button class="btn-ghost btn-sm" @click="copy(newCredentials.authSecret!)">
            <Icon name="copy" :size="14" />Copy secret
          </button>
        </template>
        <p v-else class="muted">
          Use the pairing code above — the auth secret is only revealed at first registration.
        </p>
      </details>

      <div class="modal-actions">
        <button class="btn-primary" @click="newCredentials = null"><Icon name="check" />Done</button>
      </div>
    </div>
  </div>

  <div v-if="toast" class="toast">{{ toast }}</div>
</template>

<style scoped>
.pair-code {
  font-size: 38px;
  font-weight: 700;
  letter-spacing: 6px;
  text-align: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: #0f172a;
  color: #38bdf8;
  border-radius: 12px;
  padding: 18px 10px;
  margin: 8px 0 6px;
  user-select: all;
}

.pair-expiry {
  text-align: center;
  margin: 0 0 12px;
  font-size: 13px;
}

.pair-advanced {
  margin-bottom: 8px;
}

.pair-advanced summary {
  cursor: pointer;
  color: #94a3b8;
  font-size: 13px;
  padding: 6px 0;
}
</style>
