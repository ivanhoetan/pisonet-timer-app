<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError, type EodReport } from '../lib/api';
import Icon from '../components/Icon.vue';
import { formatDateTime, formatPesos } from '../lib/format';

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const date = ref(todayStr());
const report = ref<EodReport | null>(null);
const loading = ref(false);
const error = ref('');

const methodLabels: Record<string, string> = {
  manual: 'Cash / manual',
  gcash: 'GCash',
  maya: 'Maya',
  other: 'Other',
  adjustment: 'Adjustment',
  loyalty: 'Loyalty reward',
};

function methodLabel(m: string): string {
  return methodLabels[m] || m;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const start = new Date(`${date.value}T00:00:00`);
    const end = new Date(`${date.value}T23:59:59.999`);
    const qs = `?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(
      end.toISOString()
    )}`;
    report.value = await api.get<EodReport>(`/stats/eod${qs}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    error.value = err instanceof ApiError ? err.message : 'Failed to load report';
  } finally {
    loading.value = false;
  }
}

function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCsv() {
  const r = report.value;
  if (!r) return;

  const lines: string[] = [];
  lines.push(`Pisonet End-of-Day Report,${date.value}`);
  lines.push('');
  lines.push('Summary,Value');
  lines.push(`Revenue,${r.summary.revenue}`);
  lines.push(`Minutes sold,${r.summary.minutesSold}`);
  lines.push(`Minutes removed,${r.summary.minutesRemoved}`);
  lines.push(`Top-ups,${r.summary.topupCount}`);
  lines.push(`Adjustments,${r.summary.adjustmentCount}`);
  lines.push(`New users,${r.summary.newUsers}`);
  lines.push(`Sessions started,${r.summary.sessionsStarted}`);
  lines.push('');
  lines.push('Payment method,Count,Amount,Minutes');
  for (const m of r.byMethod) {
    lines.push(
      [csvEscape(methodLabel(m.method)), m.count, m.amount, m.minutes].join(',')
    );
  }
  lines.push('');
  lines.push('Time,User,Minutes,Amount,Method,Reference');
  for (const t of r.transactions) {
    lines.push(
      [
        csvEscape(new Date(t.createdAt).toLocaleString()),
        csvEscape(t.username),
        t.minutesAdded,
        t.amountPaid,
        csvEscape(methodLabel(t.paymentMethod)),
        csvEscape(t.paymentReference),
      ].join(',')
    );
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pisonet-eod-${date.value}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function printReport() {
  window.print();
}

onMounted(load);
</script>

<template>
  <div class="report-page">
    <h1 class="page-title">End-of-day report</h1>
    <p class="page-sub">Daily sales summary you can export or print.</p>

    <div class="toolbar no-print">
      <input type="date" v-model="date" @change="load" />
      <button class="btn-ghost" @click="load"><Icon name="refresh" />Refresh</button>
      <div class="spacer"></div>
      <button class="btn-ghost" :disabled="!report" @click="exportCsv"><Icon name="download" />Export CSV</button>
      <button class="btn-primary" :disabled="!report" @click="printReport"><Icon name="printer" />Print / Save PDF</button>
    </div>

    <p v-if="error" class="error" style="margin-bottom: 14px">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <template v-if="report && !loading">
      <div class="print-header">
        <h2 style="margin: 0">Pisonet — End-of-day report</h2>
        <p class="muted" style="margin: 4px 0 0">{{ date }}</p>
      </div>

      <div class="stat-grid">
        <div class="card stat-card">
          <div class="stat-label">Revenue</div>
          <div class="stat-value">{{ formatPesos(report.summary.revenue) }}</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">Minutes sold</div>
          <div class="stat-value">{{ report.summary.minutesSold }}</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">Top-ups</div>
          <div class="stat-value">{{ report.summary.topupCount }}</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">Adjustments</div>
          <div class="stat-value">{{ report.summary.adjustmentCount }}</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">Minutes removed</div>
          <div class="stat-value">{{ report.summary.minutesRemoved }}</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">New users</div>
          <div class="stat-value">{{ report.summary.newUsers }}</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">Sessions started</div>
          <div class="stat-value">{{ report.summary.sessionsStarted }}</div>
        </div>
      </div>

      <div class="card" style="margin-bottom: 20px">
        <h3 style="margin-top: 0">Revenue by payment method</h3>
        <p v-if="report.byMethod.length === 0" class="muted">No transactions for this day.</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Method</th>
                <th>Count</th>
                <th>Amount</th>
                <th>Minutes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in report.byMethod" :key="m.method">
                <td>{{ methodLabel(m.method) }}</td>
                <td>{{ m.count }}</td>
                <td>{{ formatPesos(m.amount) }}</td>
                <td>{{ m.minutes }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3 style="margin-top: 0">Transactions ({{ report.transactions.length }})</h3>
        <p v-if="report.transactions.length === 0" class="muted">No transactions for this day.</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Minutes</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(t, i) in report.transactions" :key="i">
                <td>{{ formatDateTime(t.createdAt) }}</td>
                <td>{{ t.username }}</td>
                <td :class="{ 'tx-negative': t.minutesAdded < 0 }">
                  {{ t.minutesAdded > 0 ? `+${t.minutesAdded}` : t.minutesAdded }}
                </td>
                <td>{{ t.amountPaid ? formatPesos(t.amountPaid) : '—' }}</td>
                <td>{{ methodLabel(t.paymentMethod) }}</td>
                <td>{{ t.paymentReference || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.toolbar input[type='date'] {
  max-width: 200px;
}

.print-header {
  display: none;
}

@media print {
  .no-print {
    display: none !important;
  }
  .print-header {
    display: block;
    margin-bottom: 16px;
  }
}
</style>
