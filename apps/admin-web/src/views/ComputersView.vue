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

// Credentials shown once after registering a computer (needed to pair the client).
const newCredentials = ref<{ id: string; computerCode: string; authSecret: string } | null>(null);

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
    const res = await api.post<{ id: string; computerCode: string; authSecret: string }>(
      '/computers/register',
      { computerCode: regForm.value.computerCode.trim().toUpperCase(), name: regForm.value.name.trim() }
    );
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

  <!-- Credentials modal (shown once) -->
  <div v-if="newCredentials" class="modal-backdrop" @click.self="newCredentials = null">
    <div class="card modal">
      <h3>Pairing details for {{ newCredentials.computerCode }}</h3>
      <p class="muted" style="margin-top: -8px">
        Enter these in the Windows client's pairing screen. The auth secret is shown only once.
      </p>
      <label class="field">
        <span>Computer ID</span>
        <input :value="newCredentials.id" readonly @focus="($event.target as HTMLInputElement).select()" />
      </label>
      <button class="btn-ghost btn-sm" style="margin-bottom: 14px" @click="copy(newCredentials.id)">
        <Icon name="copy" :size="14" />Copy ID
      </button>
      <label class="field">
        <span>Auth secret</span>
        <input :value="newCredentials.authSecret" readonly @focus="($event.target as HTMLInputElement).select()" />
      </label>
      <button
        class="btn-ghost btn-sm"
        style="margin-bottom: 14px"
        @click="copy(newCredentials.authSecret)"
      >
        <Icon name="copy" :size="14" />Copy secret
      </button>
      <div class="modal-actions">
        <button class="btn-primary" @click="newCredentials = null"><Icon name="check" />Done</button>
      </div>
    </div>
  </div>

  <div v-if="toast" class="toast">{{ toast }}</div>
</template>
