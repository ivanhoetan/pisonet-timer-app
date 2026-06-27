<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../lib/api';
import { setSession, setServerUrl, getServerUrl } from '../lib/auth';

const router = useRouter();

const email = ref('');
const password = ref('');
const serverUrl = ref(getServerUrl());
const showAdvanced = ref(false);
const error = ref('');
const loading = ref(false);

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    setServerUrl(serverUrl.value === window.location.origin ? '' : serverUrl.value);
    const res = await api.post<{ token: string; admin: { email: string } }>('/auth/admin/login', {
      email: email.value.trim(),
      password: password.value,
    });
    setSession(res.token, res.admin.email);
    router.push({ name: 'dashboard' });
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Login failed';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="center-screen">
    <div class="card login-card">
      <div class="brand" style="padding-left: 0">
        <img src="/icon.svg" alt="" />
        <span>Pisonet Admin</span>
      </div>
      <p class="muted" style="margin-top: 0">Sign in to manage users and computers.</p>

      <form @submit.prevent="submit">
        <label class="field">
          <span>Admin email</span>
          <input v-model="email" type="email" autocomplete="username" placeholder="admin@pisonet.local" />
        </label>

        <label class="field">
          <span>Password</span>
          <input v-model="password" type="password" autocomplete="current-password" />
        </label>

        <label class="field" v-if="showAdvanced">
          <span>Server URL</span>
          <input v-model="serverUrl" placeholder="https://your-app.onrender.com" />
        </label>

        <p v-if="error" class="error" style="margin-bottom: 12px">{{ error }}</p>

        <button class="btn-primary" style="width: 100%" :disabled="loading" type="submit">
          {{ loading ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <button
        class="btn-ghost btn-sm"
        style="width: 100%; margin-top: 12px"
        @click="showAdvanced = !showAdvanced"
      >
        {{ showAdvanced ? 'Hide' : 'Advanced: set server URL' }}
      </button>
    </div>
  </div>
</template>
