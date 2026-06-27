<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { api, ApiError, type Overview, type LiveSession } from '../lib/api';
import { formatClock, formatPesos, pesosToMinutes } from '../lib/format';

const overview = ref<Overview | null>(null);
const live = ref<LiveSession[]>([]);
const error = ref('');
const toast = ref('');

// Top-up modal state
const topupFor = ref<LiveSession | null>(null);
const topupPesos = ref(20);
const topupSaving = ref(false);
const topupError = ref('');

let tickTimer: ReturnType<typeof setInterval> | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;

async function refresh() {
  try {
    const [ov, ls] = await Promise.all([
      api.get<Overview>('/stats/overview'),
      api.get<LiveSession[]>('/sessions/live'),
    ]);
    overview.value = ov;
    live.value = ls.sort((a, b) => a.remainingSeconds - b.remainingSeconds);
    error.value = '';
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    error.value = err instanceof ApiError ? err.message : 'Failed to load dashboard';
  }
}

function showToast(message: string) {
  toast.value = message;
  setTimeout(() => (toast.value = ''), 2500);
}

async function lockComputer(s: LiveSession) {
  if (!confirm(`Lock ${s.computerCode} and log out ${s.username}? Their remaining time is saved.`)) {
    return;
  }
  try {
    await api.post(`/computers/${s.computerId}/lock`);
    showToast(`${s.computerCode} locked`);
    await refresh();
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : 'Lock failed');
  }
}

function openTopup(s: LiveSession) {
  topupFor.value = s;
  topupPesos.value = 20;
  topupError.value = '';
}

async function submitTopup() {
  if (!topupFor.value) return;
  topupSaving.value = true;
  topupError.value = '';
  try {
    await api.post('/transactions', {
      userId: topupFor.value.userId,
      pesos: Number(topupPesos.value),
      paymentMethod: 'manual',
    });
    showToast(`Added ${pesosToMinutes(Number(topupPesos.value))} min to ${topupFor.value.username}`);
    topupFor.value = null;
    await refresh();
  } catch (err) {
    topupError.value = err instanceof ApiError ? err.message : 'Top-up failed';
  } finally {
    topupSaving.value = false;
  }
}

// Smoothly tick down remaining time between server refreshes.
function tickLocal() {
  for (const s of live.value) {
    if (s.remainingSeconds > 0) s.remainingSeconds -= 1;
  }
}

onMounted(() => {
  refresh();
  tickTimer = setInterval(tickLocal, 1000);
  syncTimer = setInterval(refresh, 10000);
});

onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
  if (syncTimer) clearInterval(syncTimer);
});
</script>

<template>
  <h1 class="page-title">Dashboard</h1>
  <p class="page-sub">Live overview of your shop.</p>

  <p v-if="error" class="error" style="margin-bottom: 16px">{{ error }}</p>

  <div class="stat-grid" v-if="overview">
    <div class="card stat-card">
      <div class="stat-label">Active sessions</div>
      <div class="stat-value">{{ overview.activeSessions }}</div>
    </div>
    <div class="card stat-card">
      <div class="stat-label">Computers in use</div>
      <div class="stat-value">{{ overview.computers.inUse }} / {{ overview.computers.total }}</div>
    </div>
    <div class="card stat-card">
      <div class="stat-label">Online PCs</div>
      <div class="stat-value">{{ overview.computers.online + overview.computers.inUse }}</div>
    </div>
    <div class="card stat-card">
      <div class="stat-label">Total users</div>
      <div class="stat-value">{{ overview.users.total }}</div>
    </div>
    <div class="card stat-card">
      <div class="stat-label">Revenue today</div>
      <div class="stat-value" style="color: var(--success)">
        {{ formatPesos(overview.today.revenue) }}
      </div>
    </div>
    <div class="card stat-card">
      <div class="stat-label">Minutes sold today</div>
      <div class="stat-value">{{ overview.today.minutesSold }}</div>
    </div>
    <div class="card stat-card">
      <div class="stat-label">Top-ups today</div>
      <div class="stat-value">{{ overview.today.topups }}</div>
    </div>
  </div>

  <div class="card">
    <h3 style="margin-top: 0">Active sessions</h3>
    <p v-if="live.length === 0" class="muted">No one is logged in right now.</p>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Computer</th>
            <th>Time left</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in live" :key="s.sessionId">
            <td>{{ s.username }}</td>
            <td>{{ s.computerCode }}</td>
            <td :style="{ color: s.remainingSeconds < 120 ? 'var(--warning)' : 'inherit' }">
              {{ formatClock(s.remainingSeconds) }}
            </td>
            <td>
              <div style="display: flex; gap: 8px; justify-content: flex-end">
                <button class="btn-ghost btn-sm" @click="openTopup(s)">+ Time</button>
                <button class="btn-danger btn-sm" @click="lockComputer(s)">Lock</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div v-if="topupFor" class="modal-backdrop" @click.self="topupFor = null">
    <div class="card modal">
      <h3>Add time — {{ topupFor.username }}</h3>
      <p class="muted" style="margin-top: -8px">
        ₱1 = 5 minutes. Time is added instantly to their active session.
      </p>
      <label class="field">
        <span>Amount paid (₱)</span>
        <input v-model.number="topupPesos" type="number" min="1" />
      </label>
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px">
        <button class="btn-ghost btn-sm" @click="topupPesos = 10">₱10</button>
        <button class="btn-ghost btn-sm" @click="topupPesos = 20">₱20</button>
        <button class="btn-ghost btn-sm" @click="topupPesos = 50">₱50</button>
        <button class="btn-ghost btn-sm" @click="topupPesos = 100">₱100</button>
      </div>
      <p class="muted" style="margin: 0 0 14px">
        = <strong>{{ pesosToMinutes(Number(topupPesos) || 0) }} minutes</strong>
      </p>
      <p v-if="topupError" class="error" style="margin-bottom: 12px">{{ topupError }}</p>
      <div class="modal-actions">
        <button class="btn-ghost" @click="topupFor = null">Cancel</button>
        <button class="btn-primary" :disabled="topupSaving" @click="submitTopup">
          {{ topupSaving ? 'Adding…' : 'Add time' }}
        </button>
      </div>
    </div>
  </div>

  <div v-if="toast" class="toast">{{ toast }}</div>
</template>
