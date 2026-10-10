<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError, type Paginated, type SessionLogEntry, type Transaction } from '../lib/api';
import Icon from '../components/Icon.vue';
import Pagination from '../components/Pagination.vue';
import { formatDateTime, formatDuration, formatPesos } from '../lib/format';

type ViewFilter = 'time' | 'sessions';
type ActionFilter = '' | 'login' | 'logout';

const view = ref<ViewFilter>('time');
const actionFilter = ref<ActionFilter>('');

const transactions = ref<Transaction[]>([]);
const sessionLogs = ref<SessionLogEntry[]>([]);
const loading = ref(false);
const error = ref('');

const page = ref(1);
const pageSize = ref(25);
const total = ref(0);

function usernameOf(t: Transaction): string {
  if (t.userId && typeof t.userId === 'object') return t.userId.username;
  return '—';
}

const totalAdded = computed(() =>
  transactions.value.reduce((sum, t) => sum + (t.minutesAdded > 0 ? t.minutesAdded : 0), 0)
);

const totalRemoved = computed(() =>
  transactions.value.reduce(
    (sum, t) => sum + (t.minutesAdded < 0 ? Math.abs(t.minutesAdded) : 0),
    0
  )
);

const totalRevenue = computed(() =>
  transactions.value.reduce((sum, t) => sum + (t.amountPaid || 0), 0)
);

const pageSummary = computed(() => {
  if (view.value === 'time') {
    return `This page: +${totalAdded.value} / −${totalRemoved.value} min · ${formatPesos(totalRevenue.value)}`;
  }
  const logins = sessionLogs.value.filter((row) => row.action === 'login').length;
  const logouts = sessionLogs.value.filter((row) => row.action === 'logout').length;
  return `This page: ${logins} login · ${logouts} logout`;
});

function eventLabel(row: SessionLogEntry): string {
  if (row.action === 'login') return 'Login';
  if (row.reason === 'expired') return 'Logout · time ran out';
  if (row.reason === 'staff') return 'Logout · ended by staff';
  return 'Logout';
}

function computerLabel(row: SessionLogEntry): string {
  return row.computerCode || row.computerName || '—';
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    if (view.value === 'sessions') {
      const params = new URLSearchParams({
        page: String(page.value),
        pageSize: String(pageSize.value),
      });
      if (actionFilter.value) params.set('action', actionFilter.value);
      const res = await api.get<Paginated<SessionLogEntry>>(`/sessions/logs?${params.toString()}`);
      sessionLogs.value = res.items;
      total.value = res.total;
      page.value = res.page;
    } else {
      const res = await api.get<Paginated<Transaction>>(
        `/transactions?page=${page.value}&pageSize=${pageSize.value}`
      );
      transactions.value = res.items;
      total.value = res.total;
      page.value = res.page;
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    error.value = err instanceof ApiError ? err.message : 'Failed to load transactions';
  } finally {
    loading.value = false;
  }
}

function changePage(p: number) {
  page.value = p;
  load();
}

function onViewChange(event: Event) {
  const next = (event.target as HTMLSelectElement).value;
  view.value = next === 'sessions' ? 'sessions' : 'time';
  page.value = 1;
  if (view.value !== 'sessions') actionFilter.value = '';
  load();
}

function onActionChange(event: Event) {
  const next = (event.target as HTMLSelectElement).value;
  actionFilter.value = next === 'login' || next === 'logout' ? next : '';
  page.value = 1;
  load();
}

onMounted(load);
</script>

<template>
  <h1 class="page-title">Transactions</h1>
  <p class="page-sub">
    {{
      view === 'sessions'
        ? 'Customer login and logout, with the time left at that moment.'
        : 'All time changes (top-ups and corrections), newest first.'
    }}
  </p>

  <div class="toolbar">
    <select :value="view" aria-label="Transaction view" @change="onViewChange">
      <option value="time">Time changes</option>
      <option value="sessions">Login / Logout</option>
    </select>
    <select
      v-if="view === 'sessions'"
      :value="actionFilter"
      aria-label="Login or logout"
      @change="onActionChange"
    >
      <option value="">All</option>
      <option value="login">Login</option>
      <option value="logout">Logout</option>
    </select>
    <button class="btn-ghost" @click="load"><Icon name="refresh" />Refresh</button>
    <div class="spacer"></div>
    <span class="muted">{{ pageSummary }}</span>
  </div>

  <p v-if="error" class="error" style="margin-bottom: 14px">{{ error }}</p>

  <div v-if="view === 'time'" class="card">
    <p v-if="loading" class="muted">Loading…</p>
    <p v-else-if="transactions.length === 0" class="muted">No transactions yet.</p>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>User</th>
            <th>Minutes</th>
            <th>Amount</th>
            <th>Method</th>
            <th>Reference</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in transactions" :key="t._id">
            <td>{{ formatDateTime(t.createdAt) }}</td>
            <td>{{ usernameOf(t) }}</td>
            <td :class="{ 'tx-negative': t.minutesAdded < 0 }">
              {{ t.minutesAdded > 0 ? `+${t.minutesAdded}` : t.minutesAdded }}
            </td>
            <td>{{ t.amountPaid ? formatPesos(t.amountPaid) : '—' }}</td>
            <td>{{ t.paymentMethod }}</td>
            <td>{{ t.paymentReference || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div v-else class="card">
    <p v-if="loading" class="muted">Loading…</p>
    <p v-else-if="sessionLogs.length === 0" class="muted">No login or logout logs yet.</p>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>User</th>
            <th>Event</th>
            <th>Remaining time</th>
            <th>PC</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in sessionLogs" :key="row._id">
            <td>{{ formatDateTime(row.createdAt) }}</td>
            <td>{{ row.username }}</td>
            <td>
              <span class="badge" :class="row.action === 'login' ? 'active' : 'offline'">
                {{ eventLabel(row) }}
              </span>
            </td>
            <td>{{ formatDuration(row.remainingSeconds) }}</td>
            <td>{{ computerLabel(row) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <Pagination
    :page="page"
    :page-size="pageSize"
    :total="total"
    :label="view === 'sessions' ? 'logs' : 'transactions'"
    @update:page="changePage"
  />
</template>
