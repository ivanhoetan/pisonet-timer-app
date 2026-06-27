<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError, type AuditEntry } from '../lib/api';
import { formatDateTime } from '../lib/format';

const logs = ref<AuditEntry[]>([]);
const loading = ref(false);
const error = ref('');

const ACTION_LABELS: Record<string, string> = {
  topup: 'Top-up',
  user_create: 'User created',
  user_update: 'User updated',
  computer_register: 'PC registered',
  computer_lock: 'PC locked',
  computer_shutdown: 'PC shut down',
};

function label(action: string): string {
  return ACTION_LABELS[action] || action;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    logs.value = await api.get<AuditEntry[]>('/audit');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    error.value = err instanceof ApiError ? err.message : 'Failed to load audit log';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <h1 class="page-title">Audit log</h1>
  <p class="page-sub">A record of every admin action (most recent 200).</p>

  <div class="toolbar">
    <button class="btn-ghost" @click="load">Refresh</button>
  </div>

  <p v-if="error" class="error" style="margin-bottom: 14px">{{ error }}</p>

  <div class="card">
    <p v-if="loading" class="muted">Loading…</p>
    <p v-else-if="logs.length === 0" class="muted">No activity logged yet.</p>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Admin</th>
            <th>Action</th>
            <th>Target</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in logs" :key="entry._id">
            <td>{{ formatDateTime(entry.createdAt) }}</td>
            <td>{{ entry.actorEmail }}</td>
            <td>{{ label(entry.action) }}</td>
            <td>{{ entry.targetLabel || '—' }}</td>
            <td>{{ entry.details || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
