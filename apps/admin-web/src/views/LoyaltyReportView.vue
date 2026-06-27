<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError, type LoyaltyReport } from '../lib/api';
import { formatDateTime } from '../lib/format';

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Default to the current month-to-date — the window that matters for monthly bonuses.
const today = new Date();
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

const from = ref(dateStr(monthStart));
const to = ref(dateStr(today));
const report = ref<LoyaltyReport | null>(null);
const loading = ref(false);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const start = new Date(`${from.value}T00:00:00`);
    const end = new Date(`${to.value}T23:59:59.999`);
    if (start >= end) {
      error.value = 'Start date must be before end date.';
      loading.value = false;
      return;
    }
    const qs = `?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(
      end.toISOString()
    )}`;
    report.value = await api.get<LoyaltyReport>(`/stats/loyalty${qs}`);
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
  lines.push(`Pisonet Loyalty Report,${from.value} to ${to.value}`);
  lines.push('');
  lines.push('Summary,Value');
  lines.push(`Stamps earned,${r.summary.stampsEarned}`);
  lines.push(`Stamps redeemed,${r.summary.stampsRedeemed}`);
  lines.push(`Free hours redeemed,${r.summary.rewardsRedeemed}`);
  lines.push(`Points awarded,${r.summary.pointsAwarded}`);
  lines.push('');
  lines.push('Outstanding (current),Value');
  lines.push(`Unredeemed stamps,${r.outstanding.totalStamps}`);
  lines.push(`Redeemable free hours,${r.outstanding.redeemableRewards}`);
  lines.push(`Lifetime points,${r.outstanding.totalPoints}`);
  lines.push(`Users holding stamps,${r.outstanding.usersWithStamps}`);
  lines.push('');
  lines.push('User,Stamps earned,Stamps redeemed,Free hours redeemed');
  for (const u of r.byUser) {
    lines.push(
      [csvEscape(u.username), u.stampsEarned, u.stampsRedeemed, u.rewardsRedeemed].join(',')
    );
  }
  lines.push('');
  lines.push('Time,User,Activity,Stamps,Free hours,Minutes');
  for (const e of r.events) {
    lines.push(
      [
        csvEscape(new Date(e.createdAt).toLocaleString()),
        csvEscape(e.username),
        e.type === 'earn' ? 'Earned' : 'Redeemed',
        e.stamps,
        e.rewards,
        e.minutes,
      ].join(',')
    );
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pisonet-loyalty-${from.value}_to_${to.value}.csv`;
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
    <h1 class="page-title">Loyalty report</h1>
    <p class="page-sub">Stamps earned, rewards redeemed, and points awarded over a date range.</p>

    <div class="toolbar no-print">
      <label class="range-field">
        <span>From</span>
        <input type="date" v-model="from" @change="load" />
      </label>
      <label class="range-field">
        <span>To</span>
        <input type="date" v-model="to" @change="load" />
      </label>
      <button class="btn-ghost" @click="load">Refresh</button>
      <div class="spacer"></div>
      <button class="btn-ghost" :disabled="!report" @click="exportCsv">Export CSV</button>
      <button class="btn-primary" :disabled="!report" @click="printReport">Print / Save PDF</button>
    </div>

    <p v-if="error" class="error" style="margin-bottom: 14px">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <template v-if="report && !loading">
      <div class="print-header">
        <h2 style="margin: 0">Pisonet — Loyalty report</h2>
        <p class="muted" style="margin: 4px 0 0">{{ from }} to {{ to }}</p>
      </div>

      <h3 class="section-title">Activity in range</h3>
      <div class="stat-grid">
        <div class="card stat-card">
          <div class="stat-label">Stamps earned</div>
          <div class="stat-value">{{ report.summary.stampsEarned }}</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">Stamps redeemed</div>
          <div class="stat-value">{{ report.summary.stampsRedeemed }}</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">Free hours redeemed</div>
          <div class="stat-value">{{ report.summary.rewardsRedeemed }}</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">Points awarded</div>
          <div class="stat-value">{{ report.summary.pointsAwarded }}</div>
        </div>
      </div>

      <h3 class="section-title">Outstanding (current)</h3>
      <div class="stat-grid">
        <div class="card stat-card">
          <div class="stat-label">Unredeemed stamps</div>
          <div class="stat-value">{{ report.outstanding.totalStamps }}</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">Redeemable free hours</div>
          <div class="stat-value">{{ report.outstanding.redeemableRewards }}</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">Lifetime points</div>
          <div class="stat-value">{{ report.outstanding.totalPoints }}</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">Users holding stamps</div>
          <div class="stat-value">{{ report.outstanding.usersWithStamps }}</div>
        </div>
      </div>

      <div class="card" style="margin-bottom: 20px">
        <h3 style="margin-top: 0">By user ({{ report.byUser.length }})</h3>
        <p v-if="report.byUser.length === 0" class="muted">No loyalty activity in this range.</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Stamps earned</th>
                <th>Stamps redeemed</th>
                <th>Free hours redeemed</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in report.byUser" :key="u.username">
                <td>{{ u.username }}</td>
                <td>{{ u.stampsEarned }}</td>
                <td>{{ u.stampsRedeemed }}</td>
                <td>{{ u.rewardsRedeemed }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3 style="margin-top: 0">Activity log ({{ report.events.length }})</h3>
        <p v-if="report.events.length === 0" class="muted">No loyalty activity in this range.</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Activity</th>
                <th>Stamps</th>
                <th>Free hours</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(e, i) in report.events" :key="i">
                <td>{{ formatDateTime(e.createdAt) }}</td>
                <td>{{ e.username }}</td>
                <td>
                  <span class="badge" :class="e.type === 'earn' ? 'earn' : 'redeem'">
                    {{ e.type === 'earn' ? 'Earned' : 'Redeemed' }}
                  </span>
                </td>
                <td :class="{ 'tx-negative': e.type === 'redeem' }">
                  {{ e.type === 'earn' ? `+${e.stamps}` : `−${e.stamps}` }}
                </td>
                <td>{{ e.rewards > 0 ? e.rewards : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.range-field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--muted);
}

.range-field input[type='date'] {
  max-width: 180px;
}

.section-title {
  margin: 4px 0 12px;
  font-size: 15px;
  color: var(--muted);
}

.badge.earn {
  background: rgba(34, 197, 94, 0.18);
  color: #86efac;
}

.badge.redeem {
  background: rgba(234, 179, 8, 0.2);
  color: #fde047;
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
