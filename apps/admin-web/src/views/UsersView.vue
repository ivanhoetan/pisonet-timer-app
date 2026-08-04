<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { api, ApiError, type AdminUser, type Paginated, type Transaction } from '../lib/api';
import Icon from '../components/Icon.vue';
import Pagination from '../components/Pagination.vue';
import {
  formatClock,
  formatDateTime,
  formatDuration,
  formatPesos,
  localDayRange,
  pesosToMinutes,
  rewardsAvailable,
  STAMPS_PER_REWARD,
  todayDateStr,
} from '../lib/format';

const users = ref<AdminUser[]>([]);
const search = ref('');
const statusFilter = ref<'active' | 'disabled' | 'all'>('active');
const loading = ref(false);
const error = ref('');
const toast = ref('');

type Mode = 'create' | 'edit' | 'topup' | 'adjust' | 'stampAdjust' | 'transfer' | null;
const mode = ref<Mode>(null);
const saving = ref(false);
const formError = ref('');
const editingId = ref<string>('');

const form = ref({
  username: '',
  nickname: '',
  password: '',
  pin: '',
  mobileNumber: '',
  status: 'active' as 'active' | 'disabled',
  initialMinutes: 0,
  topupPesos: 1,
  minutesRemoved: 10,
  adjustReason: '',
  stampsRemoved: 1,
  stampAdjustReason: '',
  paymentMethod: 'manual',
  paymentReference: '',
  transferToUserId: '',
  transferMinutes: 10,
  transferReason: '',
});

const txModalUser = ref<AdminUser | null>(null);
const txDate = ref(todayDateStr());
const txItems = ref<Transaction[]>([]);
const txLoading = ref(false);
const txError = ref('');
const txPage = ref(1);
const txTotal = ref(0);
const txPageSize = 25;

const methodLabels: Record<string, string> = {
  manual: 'Cash / manual',
  gcash: 'GCash',
  maya: 'Maya',
  other: 'Other',
  adjustment: 'Adjustment',
  loyalty: 'Loyalty reward',
  transfer: 'Transfer',
};

function methodLabel(m: string): string {
  return methodLabels[m] || m;
}

function txSummaryAdded(): number {
  return txItems.value.reduce((sum, t) => sum + (t.minutesAdded > 0 ? t.minutesAdded : 0), 0);
}

function txSummaryRemoved(): number {
  return txItems.value.reduce(
    (sum, t) => sum + (t.minutesAdded < 0 ? Math.abs(t.minutesAdded) : 0),
    0
  );
}

function txSummaryRevenue(): number {
  return txItems.value.reduce((sum, t) => sum + (t.amountPaid && t.amountPaid > 0 ? t.amountPaid : 0), 0);
}

function transferTargets(fromId: string): AdminUser[] {
  return users.value.filter((u) => u.id !== fromId && u.status === 'active');
}

let tickTimer: ReturnType<typeof setInterval> | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;

function isLive(u: AdminUser): boolean {
  return u.activeSession != null;
}

function liveTimeStyle(u: AdminUser): Record<string, string> {
  if (!u.activeSession || u.activeSession.remainingSeconds >= 120) return {};
  return { color: 'var(--warning)' };
}

async function load(silent = false) {
  if (!silent) {
    loading.value = true;
    error.value = '';
  }
  try {
    const params = new URLSearchParams();
    if (search.value.trim()) params.set('search', search.value.trim());
    params.set('status', statusFilter.value);
    users.value = await api.get<AdminUser[]>(`/users?${params.toString()}`);
    if (!silent) error.value = '';
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    if (!silent) error.value = err instanceof ApiError ? err.message : 'Failed to load users';
  } finally {
    if (!silent) loading.value = false;
  }
}

// Smoothly tick down live session timers between server refreshes.
function tickLocal() {
  for (const u of users.value) {
    if (u.activeSession && u.activeSession.remainingSeconds > 0) {
      u.activeSession.remainingSeconds -= 1;
    }
  }
}

function showToast(msg: string) {
  toast.value = msg;
  setTimeout(() => (toast.value = ''), 2500);
}

function openCreate() {
  form.value = {
    username: '',
    nickname: '',
    password: '',
    pin: '',
    mobileNumber: '',
    status: 'active',
    initialMinutes: 0,
    topupPesos: 1,
    minutesRemoved: 10,
    adjustReason: '',
    stampsRemoved: 1,
    stampAdjustReason: '',
    paymentMethod: 'manual',
    paymentReference: '',
    transferToUserId: '',
    transferMinutes: 10,
    transferReason: '',
  };
  formError.value = '';
  mode.value = 'create';
}

function openEdit(u: AdminUser) {
  editingId.value = u.id;
  form.value = {
    username: u.username,
    nickname: u.nickname || '',
    password: '',
    pin: '',
    mobileNumber: u.mobileNumber || '',
    status: u.status,
    initialMinutes: 0,
    topupPesos: 1,
    minutesRemoved: 10,
    adjustReason: '',
    stampsRemoved: 1,
    stampAdjustReason: '',
    paymentMethod: 'manual',
    paymentReference: '',
    transferToUserId: '',
    transferMinutes: 10,
    transferReason: '',
  };
  formError.value = '';
  mode.value = 'edit';
}

function openTopup(u: AdminUser) {
  editingId.value = u.id;
  form.value.username = u.username;
  form.value.topupPesos = 1;
  form.value.paymentMethod = 'manual';
  form.value.paymentReference = '';
  formError.value = '';
  mode.value = 'topup';
}

function openAdjust(u: AdminUser) {
  editingId.value = u.id;
  form.value.username = u.username;
  form.value.minutesRemoved = 10;
  form.value.adjustReason = '';
  formError.value = '';
  mode.value = 'adjust';
}

function openStampAdjust(u: AdminUser) {
  editingId.value = u.id;
  form.value.username = u.username;
  form.value.stampsRemoved = 1;
  form.value.stampAdjustReason = '';
  formError.value = '';
  mode.value = 'stampAdjust';
}

function openTransfer(u: AdminUser) {
  editingId.value = u.id;
  form.value.username = u.username;
  form.value.transferMinutes = 10;
  form.value.transferReason = '';
  const targets = transferTargets(u.id);
  form.value.transferToUserId = targets[0]?.id || '';
  formError.value = '';
  mode.value = 'transfer';
}

function openTransactions(u: AdminUser) {
  txModalUser.value = u;
  txDate.value = todayDateStr();
  txPage.value = 1;
  txError.value = '';
  void loadUserTransactions();
}

async function loadUserTransactions() {
  if (!txModalUser.value) return;
  txLoading.value = true;
  txError.value = '';
  try {
    const { start, end } = localDayRange(txDate.value);
    const params = new URLSearchParams({
      userId: txModalUser.value.id,
      start,
      end,
      page: String(txPage.value),
      pageSize: String(txPageSize),
    });
    const res = await api.get<Paginated<Transaction>>(`/transactions?${params.toString()}`);
    txItems.value = res.items;
    txTotal.value = res.total;
    txPage.value = res.page;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    txError.value = err instanceof ApiError ? err.message : 'Failed to load transactions';
  } finally {
    txLoading.value = false;
  }
}

function changeTxPage(p: number) {
  txPage.value = p;
  void loadUserTransactions();
}

async function submit() {
  saving.value = true;
  formError.value = '';
  try {
    if (mode.value === 'create') {
      const payload: Record<string, unknown> = {
        username: form.value.username.trim(),
        password: form.value.password,
      };
      if (form.value.nickname.trim()) payload.nickname = form.value.nickname.trim();
      if (form.value.pin.trim()) payload.pin = form.value.pin.trim();
      if (form.value.mobileNumber.trim()) payload.mobileNumber = form.value.mobileNumber.trim();
      if (form.value.initialMinutes > 0) payload.initialMinutes = Number(form.value.initialMinutes);
      await api.post('/users', payload);
      showToast('User created');
    } else if (mode.value === 'edit') {
      const payload: Record<string, unknown> = {};
      if (form.value.username.trim()) payload.username = form.value.username.trim();
      payload.nickname = form.value.nickname.trim();
      if (form.value.password) payload.password = form.value.password;
      if (form.value.pin) payload.pin = form.value.pin;
      payload.mobileNumber = form.value.mobileNumber.trim();
      payload.status = form.value.status;
      await api.patch(`/users/${editingId.value}`, payload);
      showToast('User updated');
    } else if (mode.value === 'topup') {
      await api.post('/transactions', {
        userId: editingId.value,
        pesos: Number(form.value.topupPesos),
        paymentMethod: form.value.paymentMethod || 'manual',
        paymentReference: form.value.paymentReference.trim() || undefined,
      });
      showToast(`Added ${pesosToMinutes(Number(form.value.topupPesos))} min`);
    } else if (mode.value === 'adjust') {
      const minutes = Number(form.value.minutesRemoved);
      if (!minutes || minutes < 1) {
        formError.value = 'Enter at least 1 minute to remove';
        return;
      }
      if (
        !confirm(
          `Remove ${minutes} minute(s) from ${form.value.username}? This cannot be undone automatically.`
        )
      ) {
        return;
      }
      await api.post('/transactions/adjust', {
        userId: editingId.value,
        minutesRemoved: minutes,
        reason: form.value.adjustReason.trim() || undefined,
      });
      showToast(`Removed ${minutes} min`);
    } else if (mode.value === 'stampAdjust') {
      const stamps = Number(form.value.stampsRemoved);
      if (!stamps || stamps < 1) {
        formError.value = 'Enter at least 1 stamp to remove';
        return;
      }
      const user = users.value.find((u) => u.id === editingId.value);
      if (user && stamps > user.loyaltyStamps) {
        formError.value = `User only has ${user.loyaltyStamps} stamp(s)`;
        return;
      }
      if (
        !confirm(
          `Remove ${stamps} stamp(s) from ${form.value.username}? This does not remove play time.`
        )
      ) {
        return;
      }
      await api.post('/loyalty/adjust-stamps', {
        userId: editingId.value,
        stampsRemoved: stamps,
        reason: form.value.stampAdjustReason.trim() || undefined,
      });
      showToast(`Removed ${stamps} stamp(s)`);
    } else if (mode.value === 'transfer') {
      const minutes = Number(form.value.transferMinutes);
      if (!minutes || minutes < 1) {
        formError.value = 'Enter at least 1 minute to transfer';
        return;
      }
      if (!form.value.transferToUserId) {
        formError.value = 'Choose a user to receive the time';
        return;
      }
      const toUser = users.value.find((u) => u.id === form.value.transferToUserId);
      if (
        !confirm(
          `Transfer ${minutes} minute(s) from ${form.value.username} to ${toUser?.username || 'another user'}?`
        )
      ) {
        return;
      }
      await api.post('/transactions/transfer', {
        fromUserId: editingId.value,
        toUserId: form.value.transferToUserId,
        minutes,
        reason: form.value.transferReason.trim() || undefined,
      });
      showToast(`Transferred ${minutes} min to ${toUser?.username || 'user'}`);
    }
    mode.value = null;
    await load();
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : 'Save failed';
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(u: AdminUser) {
  const next = u.status === 'active' ? 'disabled' : 'active';
  if (!confirm(`${next === 'disabled' ? 'Disable' : 'Enable'} ${u.username}?`)) return;
  try {
    await api.patch(`/users/${u.id}`, { status: next });
    showToast(`${u.username} ${next}`);
    await load();
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : 'Update failed');
  }
}

// Temporary password shown once after an admin reset.
const resetResult = ref<{ username: string; tempPassword: string } | null>(null);

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(() => showToast('Copied'));
}

async function resetPassword(u: AdminUser) {
  if (
    !confirm(
      `Reset password for ${u.username}? A temporary password will be generated and their old one will stop working.`
    )
  ) {
    return;
  }
  try {
    const res = await api.post<{ username: string; tempPassword: string }>(
      `/users/${u.id}/reset-password`
    );
    resetResult.value = res;
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : 'Reset failed');
  }
}

async function redeemReward(u: AdminUser) {
  const available = rewardsAvailable(u.loyaltyStamps);
  if (available <= 0) return;
  // Redeem one free hour at a time, even if the customer has stacked several.
  const remainingAfter = available - 1;
  const msg =
    `Redeem ${STAMPS_PER_REWARD} stamps for 1 free hour for ${u.username}?` +
    (remainingAfter > 0 ? ` (${remainingAfter} more free hour(s) will remain.)` : '');
  if (!confirm(msg)) return;
  try {
    await api.post('/loyalty/redeem', { userId: u.id, rewards: 1 });
    showToast(`Redeemed 1 free hour for ${u.username}`);
    await load();
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : 'Redeem failed');
  }
}

onMounted(() => {
  load();
  tickTimer = setInterval(tickLocal, 1000);
  syncTimer = setInterval(() => load(true), 10000);
});

onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
  if (syncTimer) clearInterval(syncTimer);
});
</script>

<template>
  <h1 class="page-title">Users</h1>
  <p class="page-sub">Create accounts, edit credentials, and top up time.</p>

  <div class="toolbar">
    <input v-model="search" placeholder="Search username…" @keyup.enter="load" />
    <button class="btn-ghost" @click="load"><Icon name="search" />Search</button>
    <select v-model="statusFilter" class="status-filter" @change="load()">
      <option value="active">Active only</option>
      <option value="disabled">Disabled only</option>
      <option value="all">All statuses</option>
    </select>
    <div class="spacer"></div>
    <button class="btn-primary" @click="openCreate"><Icon name="userPlus" />New user</button>
  </div>

  <p v-if="error" class="error" style="margin-bottom: 14px">{{ error }}</p>

  <p v-if="loading && users.length === 0" class="muted">Loading…</p>
  <p v-else-if="users.length === 0" class="muted">No users found.</p>

  <template v-else>
    <!-- Desktop: dense table -->
    <div class="card users-table-card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Balance</th>
              <th>Stamps</th>
              <th>Points</th>
              <th>Mobile</th>
              <th>Status</th>
              <th>Session</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td>
                <div class="user-name-cell">
                  <span class="user-name-primary">{{ u.username }}</span>
                  <span v-if="u.nickname" class="user-name-nick">{{ u.nickname }}</span>
                </div>
              </td>
              <td :style="liveTimeStyle(u)">
                <span v-if="isLive(u)" class="balance-live">
                  <span class="balance-live-dot" aria-hidden="true"></span>
                  {{ formatClock(u.activeSession!.remainingSeconds) }}
                </span>
                <span v-else>{{ formatDuration(u.balanceSeconds) }}</span>
              </td>
              <td>
                <span class="stamp-count">{{ u.loyaltyStamps }}</span>
                <span v-if="rewardsAvailable(u.loyaltyStamps) > 0" class="badge reward">
                  {{ rewardsAvailable(u.loyaltyStamps) }} free hr
                </span>
              </td>
              <td><span class="stamp-count">{{ u.points }}</span></td>
              <td>{{ u.mobileNumber || '—' }}</td>
              <td><span class="badge" :class="u.status">{{ u.status }}</span></td>
              <td>
                <span v-if="u.activeSession" class="badge inuse">online</span>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <div style="display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap">
                  <button class="btn-primary btn-sm" @click="openTopup(u)"><Icon name="plus" :size="14" />Time</button>
                  <button class="btn-warning btn-sm" @click="openAdjust(u)"><Icon name="minus" :size="14" />Time</button>
                  <button
                    v-if="u.loyaltyStamps > 0"
                    class="btn-warning btn-sm"
                    @click="openStampAdjust(u)"
                  >
                    <Icon name="minus" :size="14" />Stamp
                  </button>
                  <button
                    v-if="rewardsAvailable(u.loyaltyStamps) > 0"
                    class="btn-success btn-sm"
                    @click="redeemReward(u)"
                  >
                    <Icon name="gift" :size="14" />Redeem
                  </button>
                  <button class="btn-ghost btn-sm" @click="openTransactions(u)">
                    <Icon name="transactions" :size="14" />Txns
                  </button>
                  <button class="btn-ghost btn-sm" @click="openTransfer(u)">
                    <Icon name="arrowLeftRight" :size="14" />Transfer
                  </button>
                  <button class="btn-ghost btn-sm" @click="openEdit(u)"><Icon name="edit" :size="14" />Edit</button>
                  <button class="btn-ghost btn-sm" @click="resetPassword(u)"><Icon name="key" :size="14" />Reset PW</button>
                  <button class="btn-ghost btn-sm" @click="toggleStatus(u)">
                    <Icon :name="u.status === 'active' ? 'lock' : 'check'" :size="14" />{{ u.status === 'active' ? 'Disable' : 'Enable' }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Mobile: stacked cards -->
    <div class="user-cards">
      <div v-for="u in users" :key="u.id" class="card user-card">
        <div class="uc-head">
          <div class="user-name-cell">
            <span class="uc-name">{{ u.username }}</span>
            <span v-if="u.nickname" class="user-name-nick">{{ u.nickname }}</span>
          </div>
          <div class="uc-badges">
            <span v-if="u.activeSession" class="badge inuse">online</span>
            <span class="badge" :class="u.status">{{ u.status }}</span>
          </div>
        </div>
        <div class="uc-balance">
          <span class="uc-balance-value" :style="liveTimeStyle(u)">
            <span v-if="isLive(u)" class="balance-live">
              <span class="balance-live-dot" aria-hidden="true"></span>
              {{ formatClock(u.activeSession!.remainingSeconds) }}
            </span>
            <template v-else>{{ formatDuration(u.balanceSeconds) }}</template>
          </span>
          <span class="uc-balance-label">{{ isLive(u) ? 'live' : 'wallet' }}</span>
        </div>
        <div class="uc-row">
          <span class="uc-label">Mobile</span>
          <span class="uc-val">{{ u.mobileNumber || '—' }}</span>
        </div>
        <div class="uc-row">
          <span class="uc-label">Stamps</span>
          <span class="uc-val">
            {{ u.loyaltyStamps }}
            <span v-if="rewardsAvailable(u.loyaltyStamps) > 0" class="badge reward">
              {{ rewardsAvailable(u.loyaltyStamps) }} free hr
            </span>
          </span>
        </div>
        <div class="uc-row">
          <span class="uc-label">Points</span>
          <span class="uc-val">{{ u.points }}</span>
        </div>
        <div class="uc-actions">
          <button class="btn-primary btn-sm" @click="openTopup(u)"><Icon name="plus" :size="14" />Time</button>
          <button class="btn-warning btn-sm" @click="openAdjust(u)"><Icon name="minus" :size="14" />Time</button>
          <button
            v-if="u.loyaltyStamps > 0"
            class="btn-warning btn-sm"
            @click="openStampAdjust(u)"
          >
            <Icon name="minus" :size="14" />Stamp
          </button>
          <button
            v-if="rewardsAvailable(u.loyaltyStamps) > 0"
            class="btn-success btn-sm"
            @click="redeemReward(u)"
          >
            <Icon name="gift" :size="14" />Redeem
          </button>
          <button class="btn-ghost btn-sm" @click="openTransactions(u)">
            <Icon name="transactions" :size="14" />Txns
          </button>
          <button class="btn-ghost btn-sm" @click="openTransfer(u)">
            <Icon name="arrowLeftRight" :size="14" />Transfer
          </button>
          <button class="btn-ghost btn-sm" @click="openEdit(u)"><Icon name="edit" :size="14" />Edit</button>
          <button class="btn-ghost btn-sm" @click="resetPassword(u)"><Icon name="key" :size="14" />Reset PW</button>
          <button class="btn-ghost btn-sm" @click="toggleStatus(u)">
            <Icon :name="u.status === 'active' ? 'lock' : 'check'" :size="14" />{{ u.status === 'active' ? 'Disable' : 'Enable' }}
          </button>
        </div>
      </div>
    </div>
  </template>

  <!-- Create / Edit / Top-up modal -->
  <div v-if="mode" class="modal-backdrop" @click.self="mode = null">
    <div class="card modal">
      <h3 v-if="mode === 'create'">New user</h3>
      <h3 v-else-if="mode === 'edit'">Edit {{ form.username }}</h3>
      <h3 v-else-if="mode === 'adjust'">Remove time — {{ form.username }}</h3>
      <h3 v-else-if="mode === 'stampAdjust'">Remove stamps — {{ form.username }}</h3>
      <h3 v-else-if="mode === 'transfer'">Transfer time — {{ form.username }}</h3>
      <h3 v-else>Add time — {{ form.username }}</h3>

      <template v-if="mode === 'create' || mode === 'edit'">
        <label class="field">
          <span>Username</span>
          <input v-model="form.username" placeholder="juandelacruz" />
        </label>
        <label class="field">
          <span>Nickname (optional)</span>
          <input v-model="form.nickname" placeholder="Juan" />
        </label>
        <label class="field">
          <span>{{ mode === 'edit' ? 'New password (leave blank to keep)' : 'Password' }}</span>
          <input v-model="form.password" type="password" />
        </label>
        <label class="field">
          <span>{{ mode === 'edit' ? 'New PIN (leave blank to keep)' : 'PIN (4–6 digits, optional)' }}</span>
          <input v-model="form.pin" inputmode="numeric" maxlength="6" />
        </label>
        <label class="field">
          <span>Mobile number (optional)</span>
          <input v-model="form.mobileNumber" />
        </label>
        <label v-if="mode === 'create'" class="field">
          <span>Starting time (minutes, optional)</span>
          <input v-model.number="form.initialMinutes" type="number" min="0" />
        </label>
        <label v-if="mode === 'edit'" class="field">
          <span>Status</span>
          <select v-model="form.status">
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
      </template>

      <template v-else-if="mode === 'topup'">
        <p class="muted" style="margin-top: -8px">₱1 = 5 minutes.</p>
        <label class="field">
          <span>Amount paid (₱)</span>
          <input v-model.number="form.topupPesos" type="number" min="1" />
        </label>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px">
          <button class="btn-ghost btn-sm" @click="form.topupPesos = 1">₱1</button>
          <button class="btn-ghost btn-sm" @click="form.topupPesos = 5">₱5</button>
          <button class="btn-ghost btn-sm" @click="form.topupPesos = 10">₱10</button>
          <button class="btn-ghost btn-sm" @click="form.topupPesos = 12">₱12 · 1 stamp</button>
          <button class="btn-ghost btn-sm" @click="form.topupPesos = 20">₱20</button>
          <button class="btn-ghost btn-sm" @click="form.topupPesos = 50">₱50</button>
        </div>
        <p class="muted" style="margin: 0 0 14px">
          = <strong>{{ pesosToMinutes(Number(form.topupPesos) || 0) }} minutes</strong>
        </p>
        <label class="field">
          <span>Payment method</span>
          <select v-model="form.paymentMethod">
            <option value="manual">Cash / manual</option>
            <option value="gcash">GCash</option>
            <option value="maya">Maya</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label class="field">
          <span>Reference (optional)</span>
          <input v-model="form.paymentReference" placeholder="Receipt / ref no." />
        </label>
      </template>

      <template v-else-if="mode === 'adjust'">
        <p class="muted" style="margin-top: -8px">
          Correct a mistaken top-up. Balance cannot go below zero. If the user is online, their live
          timer is reduced too.
        </p>
        <label class="field">
          <span>Minutes to remove</span>
          <input v-model.number="form.minutesRemoved" type="number" min="1" />
        </label>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px">
          <button class="btn-ghost btn-sm" @click="form.minutesRemoved = 5">5 min</button>
          <button class="btn-ghost btn-sm" @click="form.minutesRemoved = 10">10 min</button>
          <button class="btn-ghost btn-sm" @click="form.minutesRemoved = 30">30 min</button>
          <button class="btn-ghost btn-sm" @click="form.minutesRemoved = 60">60 min</button>
        </div>
        <label class="field">
          <span>Reason (optional)</span>
          <input v-model="form.adjustReason" placeholder="e.g. wrong amount entered" />
        </label>
      </template>

      <template v-else-if="mode === 'stampAdjust'">
        <p class="muted" style="margin-top: -8px">
          Correct a mistaken stamp earn. This only lowers the stamp count — it does not remove play
          time. Use <strong>Redeem</strong> to convert stamps into free hours.
        </p>
        <label class="field">
          <span>Stamps to remove</span>
          <input v-model.number="form.stampsRemoved" type="number" min="1" />
        </label>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px">
          <button class="btn-ghost btn-sm" @click="form.stampsRemoved = 1">1</button>
          <button class="btn-ghost btn-sm" @click="form.stampsRemoved = 2">2</button>
          <button class="btn-ghost btn-sm" @click="form.stampsRemoved = 3">3</button>
          <button class="btn-ghost btn-sm" @click="form.stampsRemoved = 5">5</button>
        </div>
        <label class="field">
          <span>Reason (optional)</span>
          <input v-model="form.stampAdjustReason" placeholder="e.g. wrong top-up amount" />
        </label>
      </template>

      <template v-else-if="mode === 'transfer'">
        <p class="muted" style="margin-top: -8px">
          Move time from this user's wallet (or live session) to another account. Recorded as
          transfer transactions for both users.
        </p>
        <label class="field">
          <span>Transfer to</span>
          <select v-model="form.transferToUserId">
            <option v-if="transferTargets(editingId).length === 0" value="" disabled>
              No other active users
            </option>
            <option v-for="t in transferTargets(editingId)" :key="t.id" :value="t.id">
              {{ t.username }}{{ t.nickname ? ` (${t.nickname})` : '' }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>Minutes to transfer</span>
          <input v-model.number="form.transferMinutes" type="number" min="1" />
        </label>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px">
          <button class="btn-ghost btn-sm" @click="form.transferMinutes = 5">5 min</button>
          <button class="btn-ghost btn-sm" @click="form.transferMinutes = 10">10 min</button>
          <button class="btn-ghost btn-sm" @click="form.transferMinutes = 30">30 min</button>
          <button class="btn-ghost btn-sm" @click="form.transferMinutes = 60">60 min</button>
        </div>
        <label class="field">
          <span>Reason (optional)</span>
          <input v-model="form.transferReason" placeholder="e.g. sibling sharing time" />
        </label>
      </template>

      <p v-if="formError" class="error" style="margin-bottom: 12px">{{ formError }}</p>

      <div class="modal-actions">
        <button class="btn-ghost" @click="mode = null"><Icon name="x" />Cancel</button>
        <button class="btn-primary" :disabled="saving" @click="submit">
          <Icon :name="mode === 'adjust' || mode === 'stampAdjust' ? 'minus' : 'check'" />
          {{
            saving
              ? 'Saving…'
              : mode === 'adjust'
                ? 'Remove time'
                : mode === 'stampAdjust'
                  ? 'Remove stamps'
                  : mode === 'transfer'
                    ? 'Transfer time'
                    : 'Save'
          }}
        </button>
      </div>
    </div>
  </div>

  <!-- User transactions modal -->
  <div v-if="txModalUser" class="modal-backdrop" @click.self="txModalUser = null">
    <div class="card modal modal-wide">
      <h3>Transactions — {{ txModalUser.username }}</h3>
      <div class="tx-toolbar">
        <label class="field tx-date-field">
          <span>Day</span>
          <input v-model="txDate" type="date" @change="txPage = 1; loadUserTransactions()" />
        </label>
        <button class="btn-ghost btn-sm" @click="loadUserTransactions">
          <Icon name="refresh" :size="14" />Refresh
        </button>
      </div>
      <p v-if="txItems.length > 0" class="muted tx-summary">
        +{{ txSummaryAdded() }} / −{{ txSummaryRemoved() }} min · {{ formatPesos(txSummaryRevenue()) }}
        <span v-if="txTotal > txItems.length"> · showing {{ txItems.length }} of {{ txTotal }}</span>
      </p>
      <p v-if="txError" class="error" style="margin-bottom: 12px">{{ txError }}</p>
      <p v-if="txLoading" class="muted">Loading…</p>
      <p v-else-if="txItems.length === 0" class="muted">No transactions for this day.</p>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Minutes</th>
              <th>Amount</th>
              <th>Method</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in txItems" :key="t._id">
              <td>{{ formatDateTime(t.createdAt) }}</td>
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
      <Pagination
        v-if="txTotal > txPageSize"
        :page="txPage"
        :page-size="txPageSize"
        :total="txTotal"
        label="transactions"
        @update:page="changeTxPage"
      />
      <div class="modal-actions">
        <button class="btn-primary" @click="txModalUser = null"><Icon name="check" />Done</button>
      </div>
    </div>
  </div>

  <!-- Temporary password modal (shown once) -->
  <div v-if="resetResult" class="modal-backdrop" @click.self="resetResult = null">
    <div class="card modal">
      <h3>Temporary password for {{ resetResult.username }}</h3>
      <p class="muted" style="margin-top: -8px">
        Give this to the customer. They log in on the PC with it, then use
        <strong>Change password</strong> in the app to set their own.
      </p>

      <div class="reset-code">{{ resetResult.tempPassword }}</div>
      <button
        class="btn-primary"
        style="width: 100%; margin-bottom: 8px"
        @click="copy(resetResult.tempPassword)"
      >
        <Icon name="copy" :size="14" />Copy password
      </button>
      <p class="muted" style="font-size: 13px">
        Their old password no longer works. This code is shown only once.
      </p>

      <div class="modal-actions">
        <button class="btn-primary" @click="resetResult = null"><Icon name="check" />Done</button>
      </div>
    </div>
  </div>

  <div v-if="toast" class="toast">{{ toast }}</div>
</template>

<style scoped>
.status-filter {
  width: auto;
  min-width: 150px;
}

.user-name-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.user-name-primary {
  font-weight: 600;
}

.user-name-nick {
  color: var(--muted);
  font-size: 12px;
}

.reset-code {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 5px;
  text-align: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: #0f172a;
  color: #38bdf8;
  border-radius: 12px;
  padding: 18px 10px;
  margin: 8px 0 12px;
  user-select: all;
  word-break: break-all;
}

.balance-live {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}

.balance-live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  flex-shrink: 0;
  animation: live-pulse 1.5s ease-in-out infinite;
}

@keyframes live-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.modal-wide {
  width: min(640px, 100%);
}

.tx-toolbar {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.tx-date-field {
  margin: 0;
  flex: 1;
  min-width: 160px;
}

.tx-summary {
  margin: 0 0 12px;
  font-size: 13px;
}

.tx-negative {
  color: var(--warning);
}
</style>
