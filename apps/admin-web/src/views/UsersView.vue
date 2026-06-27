<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError, type AdminUser } from '../lib/api';
import {
  formatDuration,
  pesosToMinutes,
  rewardsAvailable,
  STAMPS_PER_REWARD,
} from '../lib/format';

const users = ref<AdminUser[]>([]);
const search = ref('');
const loading = ref(false);
const error = ref('');
const toast = ref('');

type Mode = 'create' | 'edit' | 'topup' | 'adjust' | null;
const mode = ref<Mode>(null);
const saving = ref(false);
const formError = ref('');
const editingId = ref<string>('');

const form = ref({
  username: '',
  password: '',
  pin: '',
  mobileNumber: '',
  status: 'active' as 'active' | 'disabled',
  initialMinutes: 0,
  topupPesos: 1,
  minutesRemoved: 10,
  adjustReason: '',
  paymentMethod: 'manual',
  paymentReference: '',
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const q = search.value.trim() ? `?search=${encodeURIComponent(search.value.trim())}` : '';
    users.value = await api.get<AdminUser[]>(`/users${q}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    error.value = err instanceof ApiError ? err.message : 'Failed to load users';
  } finally {
    loading.value = false;
  }
}

function showToast(msg: string) {
  toast.value = msg;
  setTimeout(() => (toast.value = ''), 2500);
}

function openCreate() {
  form.value = {
    username: '',
    password: '',
    pin: '',
    mobileNumber: '',
    status: 'active',
    initialMinutes: 0,
    topupPesos: 1,
    minutesRemoved: 10,
    adjustReason: '',
    paymentMethod: 'manual',
    paymentReference: '',
  };
  formError.value = '';
  mode.value = 'create';
}

function openEdit(u: AdminUser) {
  editingId.value = u.id;
  form.value = {
    username: u.username,
    password: '',
    pin: '',
    mobileNumber: u.mobileNumber || '',
    status: u.status,
    initialMinutes: 0,
    topupPesos: 1,
    minutesRemoved: 10,
    adjustReason: '',
    paymentMethod: 'manual',
    paymentReference: '',
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

async function submit() {
  saving.value = true;
  formError.value = '';
  try {
    if (mode.value === 'create') {
      const payload: Record<string, unknown> = {
        username: form.value.username.trim(),
        password: form.value.password,
        pin: form.value.pin,
      };
      if (form.value.mobileNumber.trim()) payload.mobileNumber = form.value.mobileNumber.trim();
      if (form.value.initialMinutes > 0) payload.initialMinutes = Number(form.value.initialMinutes);
      await api.post('/users', payload);
      showToast('User created');
    } else if (mode.value === 'edit') {
      const payload: Record<string, unknown> = {};
      if (form.value.username.trim()) payload.username = form.value.username.trim();
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

async function redeemReward(u: AdminUser) {
  const available = rewardsAvailable(u.loyaltyStamps);
  if (available <= 0) return;
  const msg =
    available === 1
      ? `Redeem ${STAMPS_PER_REWARD} stamps for 1 free hour for ${u.username}?`
      : `Redeem all ${available} free hours (${available * STAMPS_PER_REWARD} stamps) for ${u.username}?`;
  if (!confirm(msg)) return;
  try {
    await api.post('/loyalty/redeem', { userId: u.id });
    showToast(`Redeemed ${available} free hour(s) for ${u.username}`);
    await load();
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : 'Redeem failed');
  }
}

onMounted(load);
</script>

<template>
  <h1 class="page-title">Users</h1>
  <p class="page-sub">Create accounts, edit credentials, and top up time.</p>

  <div class="toolbar">
    <input v-model="search" placeholder="Search username…" @keyup.enter="load" />
    <button class="btn-ghost" @click="load">Search</button>
    <div class="spacer"></div>
    <button class="btn-primary" @click="openCreate">+ New user</button>
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
              <td>{{ u.username }}</td>
              <td>{{ formatDuration(u.balanceSeconds) }}</td>
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
                  <button class="btn-primary btn-sm" @click="openTopup(u)">+ Time</button>
                  <button class="btn-warning btn-sm" @click="openAdjust(u)">− Time</button>
                  <button
                    v-if="rewardsAvailable(u.loyaltyStamps) > 0"
                    class="btn-success btn-sm"
                    @click="redeemReward(u)"
                  >
                    Redeem
                  </button>
                  <button class="btn-ghost btn-sm" @click="openEdit(u)">Edit</button>
                  <button class="btn-ghost btn-sm" @click="toggleStatus(u)">
                    {{ u.status === 'active' ? 'Disable' : 'Enable' }}
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
          <span class="uc-name">{{ u.username }}</span>
          <div class="uc-badges">
            <span v-if="u.activeSession" class="badge inuse">online</span>
            <span class="badge" :class="u.status">{{ u.status }}</span>
          </div>
        </div>
        <div class="uc-balance">
          <span class="uc-balance-value">{{ formatDuration(u.balanceSeconds) }}</span>
          <span class="uc-balance-label">remaining</span>
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
          <button class="btn-primary btn-sm" @click="openTopup(u)">+ Time</button>
          <button class="btn-warning btn-sm" @click="openAdjust(u)">− Time</button>
          <button
            v-if="rewardsAvailable(u.loyaltyStamps) > 0"
            class="btn-success btn-sm"
            @click="redeemReward(u)"
          >
            Redeem
          </button>
          <button class="btn-ghost btn-sm" @click="openEdit(u)">Edit</button>
          <button class="btn-ghost btn-sm" @click="toggleStatus(u)">
            {{ u.status === 'active' ? 'Disable' : 'Enable' }}
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
      <h3 v-else>Add time — {{ form.username }}</h3>

      <template v-if="mode === 'create' || mode === 'edit'">
        <label class="field">
          <span>Username</span>
          <input v-model="form.username" placeholder="juandelacruz" />
        </label>
        <label class="field">
          <span>{{ mode === 'edit' ? 'New password (leave blank to keep)' : 'Password' }}</span>
          <input v-model="form.password" type="password" />
        </label>
        <label class="field">
          <span>{{ mode === 'edit' ? 'New PIN (leave blank to keep)' : 'PIN (4–6 digits)' }}</span>
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

      <p v-if="formError" class="error" style="margin-bottom: 12px">{{ formError }}</p>

      <div class="modal-actions">
        <button class="btn-ghost" @click="mode = null">Cancel</button>
        <button class="btn-primary" :disabled="saving" @click="submit">
          {{
            saving
              ? 'Saving…'
              : mode === 'adjust'
                ? 'Remove time'
                : 'Save'
          }}
        </button>
      </div>
    </div>
  </div>

  <div v-if="toast" class="toast">{{ toast }}</div>
</template>
