<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError, type AuditEntry, type Paginated } from '../lib/api';
import Icon from '../components/Icon.vue';
import Pagination from '../components/Pagination.vue';
import { formatDateTime } from '../lib/format';

const logs = ref<AuditEntry[]>([]);
const loading = ref(false);
const error = ref('');

const page = ref(1);
const pageSize = ref(25);
const total = ref(0);

const ACTION_LABELS: Record<string, string> = {
  topup: 'Top-up',
  time_adjust: 'Time removed',
  loyalty_redeem: 'Loyalty redeemed',
  stamp_adjust: 'Stamps removed',
  login_failed: 'Login failed',
  user_create: 'User created',
  user_update: 'User updated',
  user_password_reset: 'Password reset',
  admin_create: 'Admin created',
  computer_register: 'PC registered',
  computer_pairing_code: 'PC pairing code generated',
  computer_lock: 'PC locked',
  computer_shutdown: 'PC shut down',
  computer_maintenance_on: 'Maintenance on',
  computer_maintenance_off: 'Maintenance off',
};

function label(action: string): string {
  return ACTION_LABELS[action] || action;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const res = await api.get<Paginated<AuditEntry>>(
      `/audit?page=${page.value}&pageSize=${pageSize.value}`
    );
    logs.value = res.items;
    total.value = res.total;
    page.value = res.page;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    error.value = err instanceof ApiError ? err.message : 'Failed to load audit log';
  } finally {
    loading.value = false;
  }
}

function changePage(p: number) {
  page.value = p;
  load();
}

onMounted(load);
</script>

<template>
  <h1 class="page-title">Audit log</h1>
  <p class="page-sub">A record of every admin action, newest first.</p>

  <div class="toolbar">
    <button class="btn-ghost" @click="load"><Icon name="refresh" />Refresh</button>
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

  <Pagination
    :page="page"
    :page-size="pageSize"
    :total="total"
    label="entries"
    @update:page="changePage"
  />
</template>
