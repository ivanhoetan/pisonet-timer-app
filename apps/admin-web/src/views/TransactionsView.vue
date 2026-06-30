<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError, type Paginated, type Transaction } from '../lib/api';
import Icon from '../components/Icon.vue';
import Pagination from '../components/Pagination.vue';
import { formatDateTime, formatPesos } from '../lib/format';

const transactions = ref<Transaction[]>([]);
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

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const res = await api.get<Paginated<Transaction>>(
      `/transactions?page=${page.value}&pageSize=${pageSize.value}`
    );
    transactions.value = res.items;
    total.value = res.total;
    page.value = res.page;
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

onMounted(load);
</script>

<template>
  <h1 class="page-title">Transactions</h1>
  <p class="page-sub">All time changes (top-ups and corrections), newest first.</p>

  <div class="toolbar">
    <button class="btn-ghost" @click="load"><Icon name="refresh" />Refresh</button>
    <div class="spacer"></div>
    <span class="muted">
      This page: +{{ totalAdded }} / −{{ totalRemoved }} min · {{ formatPesos(totalRevenue) }}
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

  <Pagination
    :page="page"
    :page-size="pageSize"
    :total="total"
    label="transactions"
    @update:page="changePage"
  />
</template>
