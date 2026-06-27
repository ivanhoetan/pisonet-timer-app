<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError, type AdminAccount } from '../lib/api';
import Icon from '../components/Icon.vue';
import { formatDateTime } from '../lib/format';
import { auth } from '../lib/auth';

const admins = ref<AdminAccount[]>([]);
const loading = ref(false);
const error = ref('');
const toast = ref('');

const showCreate = ref(false);
const saving = ref(false);
const formError = ref('');
const form = ref({ email: '', password: '', role: 'staff' as 'owner' | 'staff' });

async function load() {
  loading.value = true;
  error.value = '';
  try {
    admins.value = await api.get<AdminAccount[]>('/admins');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    error.value = err instanceof ApiError ? err.message : 'Failed to load admins';
  } finally {
    loading.value = false;
  }
}

function showToast(msg: string) {
  toast.value = msg;
  setTimeout(() => (toast.value = ''), 2500);
}

function openCreate() {
  form.value = { email: '', password: '', role: 'staff' };
  formError.value = '';
  showCreate.value = true;
}

async function submit() {
  if (!form.value.email.trim() || form.value.password.length < 6) {
    formError.value = 'Enter an email and a password of at least 6 characters.';
    return;
  }
  saving.value = true;
  formError.value = '';
  try {
    await api.post('/admins', {
      email: form.value.email.trim(),
      password: form.value.password,
      role: form.value.role,
    });
    showToast('Admin created');
    showCreate.value = false;
    await load();
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : 'Failed to create admin';
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <h1 class="page-title">Admins</h1>
  <p class="page-sub">Manage portal accounts for you and your staff.</p>

  <div class="toolbar">
    <button class="btn-ghost" @click="load"><Icon name="refresh" />Refresh</button>
    <div class="spacer"></div>
    <button class="btn-primary" @click="openCreate"><Icon name="shieldPlus" />New admin</button>
  </div>

  <p v-if="error" class="error" style="margin-bottom: 14px">{{ error }}</p>

  <p v-if="loading && admins.length === 0" class="muted">Loading…</p>
  <p v-else-if="admins.length === 0" class="muted">No admins found.</p>

  <template v-else>
    <div class="card users-table-card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in admins" :key="a._id">
              <td>
                {{ a.email }}
                <span v-if="a.email === auth.email" class="muted">(you)</span>
              </td>
              <td><span class="badge" :class="a.role === 'owner' ? 'active' : 'inuse'">{{ a.role }}</span></td>
              <td>{{ formatDateTime(a.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="user-cards">
      <div v-for="a in admins" :key="a._id" class="card user-card">
        <div class="uc-head">
          <span class="uc-name">{{ a.email }}</span>
          <span class="badge" :class="a.role === 'owner' ? 'active' : 'inuse'">{{ a.role }}</span>
        </div>
        <div class="uc-row">
          <span class="uc-label">Created</span>
          <span class="uc-val">{{ formatDateTime(a.createdAt) }}</span>
        </div>
        <div v-if="a.email === auth.email" class="uc-row">
          <span class="uc-label">This is your account</span>
        </div>
      </div>
    </div>
  </template>

  <div v-if="showCreate" class="modal-backdrop" @click.self="showCreate = false">
    <div class="card modal">
      <h3>New admin</h3>
      <label class="field">
        <span>Email</span>
        <input v-model="form.email" type="email" placeholder="staff@pisonet.local" />
      </label>
      <label class="field">
        <span>Password (min 6 characters)</span>
        <input v-model="form.password" type="password" autocomplete="new-password" />
      </label>
      <label class="field">
        <span>Role</span>
        <select v-model="form.role">
          <option value="staff">Staff</option>
          <option value="owner">Owner</option>
        </select>
      </label>
      <p class="muted" style="margin: -4px 0 14px; font-size: 13px">
        All admins can manage users, computers, and time. Role is a label for your reference.
      </p>
      <p v-if="formError" class="error" style="margin-bottom: 12px">{{ formError }}</p>
      <div class="modal-actions">
        <button class="btn-ghost" @click="showCreate = false"><Icon name="x" />Cancel</button>
        <button class="btn-primary" :disabled="saving" @click="submit">
          <Icon name="shieldPlus" />{{ saving ? 'Saving…' : 'Create admin' }}
        </button>
      </div>
    </div>
  </div>

  <div v-if="toast" class="toast">{{ toast }}</div>
</template>
