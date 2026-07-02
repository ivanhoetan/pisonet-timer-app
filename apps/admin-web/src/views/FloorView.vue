<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api, ApiError, type Computer, type LiveSession } from '../lib/api';
import Icon from '../components/Icon.vue';
import { formatClock } from '../lib/format';

type DisplayStatus = 'free' | 'inuse' | 'offline' | 'locked' | 'maintenance';

interface FloorPc {
  computer: Computer;
  session: LiveSession | null;
  remainingSeconds: number;
}

const floorPcs = ref<FloorPc[]>([]);
const loading = ref(false);
const error = ref('');
const toast = ref('');

let tickTimer: ReturnType<typeof setInterval> | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;

const STATUS_LABELS: Record<DisplayStatus, string> = {
  free: 'Free',
  inuse: 'In use',
  offline: 'Offline',
  locked: 'Locked',
  maintenance: 'Maintenance',
};

function displayStatus(pc: FloorPc): DisplayStatus {
  if (pc.session) return 'inuse';
  switch (pc.computer.status) {
    case 'IN_USE':
      return 'inuse';
    case 'LOCKED':
      return 'locked';
    case 'MAINTENANCE':
      return 'maintenance';
    case 'OFFLINE':
      return 'offline';
    case 'ONLINE':
    default:
      return 'free';
  }
}

const summary = computed(() => {
  const counts = { free: 0, inuse: 0, offline: 0, locked: 0, maintenance: 0 };
  for (const pc of floorPcs.value) {
    counts[displayStatus(pc)] += 1;
  }
  return counts;
});

function showToast(message: string) {
  toast.value = message;
  setTimeout(() => (toast.value = ''), 2500);
}

async function refresh(silent = false) {
  if (!silent) {
    loading.value = true;
    error.value = '';
  }
  try {
    const [computers, live] = await Promise.all([
      api.get<Computer[]>('/computers'),
      api.get<LiveSession[]>('/sessions/live'),
    ]);

    const sessionByComputer = new Map(live.map((s) => [s.computerId, s]));

    floorPcs.value = computers
      .sort((a, b) =>
        a.computerCode.localeCompare(b.computerCode, undefined, { numeric: true })
      )
      .map((computer) => {
        const session = sessionByComputer.get(computer._id) ?? null;
        return {
          computer,
          session,
          remainingSeconds: session?.remainingSeconds ?? 0,
        };
      });

    if (!silent) error.value = '';
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    if (!silent) error.value = err instanceof ApiError ? err.message : 'Failed to load floor map';
  } finally {
    if (!silent) loading.value = false;
  }
}

function tickLocal() {
  for (const pc of floorPcs.value) {
    if (pc.session && pc.remainingSeconds > 0) {
      pc.remainingSeconds -= 1;
    }
  }
}

async function lockComputer(pc: FloorPc) {
  const label = pc.computer.computerCode;
  const user = pc.session?.username || 'the user';
  if (!confirm(`Lock ${label} and log out ${user}? Their remaining time is saved.`)) {
    return;
  }
  try {
    await api.post(`/computers/${pc.computer._id}/lock`);
    showToast(`${label} locked`);
    await refresh(true);
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : 'Lock failed');
  }
}

function timerClass(pc: FloorPc): Record<string, boolean> {
  const status = displayStatus(pc);
  return {
    'floor-timer--warn': status === 'inuse' && pc.remainingSeconds > 0 && pc.remainingSeconds < 120,
  };
}

onMounted(() => {
  refresh();
  tickTimer = setInterval(tickLocal, 1000);
  syncTimer = setInterval(() => refresh(true), 10000);
});

onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
  if (syncTimer) clearInterval(syncTimer);
});
</script>

<template>
  <h1 class="page-title">Floor map</h1>
  <p class="page-sub">Live view of every PC — green is free, blue is in use.</p>

  <div class="floor-legend">
    <span class="floor-legend-item"><i class="dot dot-free"></i> Free {{ summary.free }}</span>
    <span class="floor-legend-item"><i class="dot dot-inuse"></i> In use {{ summary.inuse }}</span>
    <span class="floor-legend-item"><i class="dot dot-offline"></i> Offline {{ summary.offline }}</span>
    <span class="floor-legend-item"><i class="dot dot-locked"></i> Locked {{ summary.locked }}</span>
    <span v-if="summary.maintenance > 0" class="floor-legend-item">
      <i class="dot dot-maintenance"></i> Maintenance {{ summary.maintenance }}
    </span>
    <button class="btn-ghost btn-sm floor-refresh" @click="refresh()">
      <Icon name="refresh" :size="14" />Refresh
    </button>
  </div>

  <p v-if="error" class="error" style="margin-bottom: 14px">{{ error }}</p>
  <p v-if="loading && floorPcs.length === 0" class="muted">Loading…</p>
  <p v-else-if="floorPcs.length === 0" class="muted">No computers registered yet.</p>

  <div v-else class="floor-grid">
    <div
      v-for="pc in floorPcs"
      :key="pc.computer._id"
      class="floor-tile"
      :class="`floor-tile--${displayStatus(pc)}`"
    >
      <div class="floor-tile-head">
        <span class="floor-code">{{ pc.computer.computerCode }}</span>
        <span class="floor-status">{{ STATUS_LABELS[displayStatus(pc)] }}</span>
      </div>

      <div v-if="pc.session" class="floor-session">
        <div class="floor-user">{{ pc.session.username }}</div>
        <div class="floor-timer" :class="timerClass(pc)">
          {{ formatClock(pc.remainingSeconds) }}
        </div>
      </div>

      <p v-else class="floor-idle muted">
        <template v-if="displayStatus(pc) === 'free'">Ready for next customer</template>
        <template v-else-if="displayStatus(pc) === 'offline'">PC not connected</template>
        <template v-else-if="displayStatus(pc) === 'locked'">Locked by staff</template>
        <template v-else-if="displayStatus(pc) === 'maintenance'">Under maintenance</template>
        <template v-else>Available soon</template>
      </p>

      <button
        v-if="pc.session"
        class="btn-danger btn-sm floor-lock"
        @click="lockComputer(pc)"
      >
        <Icon name="lock" :size="14" />Lock
      </button>
    </div>
  </div>

  <div v-if="toast" class="toast">{{ toast }}</div>
</template>

<style scoped>
.floor-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px 18px;
  margin-bottom: 18px;
}

.floor-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--muted);
}

.floor-refresh {
  margin-left: auto;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-free {
  background: var(--success);
}

.dot-inuse {
  background: var(--primary);
}

.dot-offline {
  background: #64748b;
}

.dot-locked {
  background: var(--danger);
}

.dot-maintenance {
  background: var(--warning);
}

.floor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 14px;
}

.floor-tile {
  border-radius: var(--radius);
  border: 2px solid var(--border);
  background: var(--bg-card);
  padding: 14px 14px 12px;
  min-height: 148px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.floor-tile--free {
  border-color: rgba(34, 197, 94, 0.45);
  background: linear-gradient(180deg, rgba(34, 197, 94, 0.1), var(--bg-card) 55%);
}

.floor-tile--inuse {
  border-color: rgba(56, 189, 248, 0.55);
  background: linear-gradient(180deg, rgba(56, 189, 248, 0.12), var(--bg-card) 55%);
}

.floor-tile--offline {
  border-color: #475569;
  opacity: 0.85;
}

.floor-tile--locked {
  border-color: rgba(239, 68, 68, 0.55);
  background: linear-gradient(180deg, rgba(239, 68, 68, 0.1), var(--bg-card) 55%);
}

.floor-tile--maintenance {
  border-color: rgba(245, 158, 11, 0.55);
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.1), var(--bg-card) 55%);
}

.floor-tile-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.floor-code {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.floor-status {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.floor-session {
  flex: 1;
}

.floor-user {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.floor-timer {
  font-size: 28px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: var(--primary);
}

.floor-timer--warn {
  color: var(--warning);
}

.floor-idle {
  flex: 1;
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
}

.floor-lock {
  width: 100%;
  margin-top: auto;
}
</style>
