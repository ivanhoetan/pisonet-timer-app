<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError, type Transaction } from '../lib/api';
import { formatDateTime, formatPesos } from '../lib/format';

const transactions = ref<Transaction[]>([]);
const loading = ref(false);
const error = ref('');

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

async function load() {
  loading.value = true;
  error.value = '';
  try {
    transactions.value = await api.get<Transaction[]>('/transactions');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    error.value = err instanceof ApiError ? err.message : 'Failed to load transactions';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <h1 class="page-title">Transactions</h1>
  <p class="page-sub">Most recent 100 time changes (top-ups and corrections).</p>

  <div class="toolbar">
    <button class="btn-ghost" @click="load">Refresh</button>
    <div class="spacer"></div>
    <span class="muted">
      {{ transactions.length }} records · +{{ totalAdded }} / −{{ totalRemoved }} min ·
      {{ formatPesos(totalRevenue) }}
    </span>
  </div>

  <p v-if="error" class="error" style="margin-bottom: 14px">{{ error }}</p>

  <div class="card">
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
</template>
