<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { auth, clearSession } from './lib/auth';
import NavIcon from './components/NavIcon.vue';

const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);

// If the token is cleared anywhere (e.g. a 401 from the API), bounce to login.
watch(
  () => auth.token,
  (token) => {
    if (!token && route.name !== 'login') {
      router.push({ name: 'login' });
    }
  }
);

const showShell = computed(() => route.name !== 'login' && Boolean(auth.token));

const links = [
  { name: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { name: 'users', label: 'Users', icon: 'users' },
  { name: 'computers', label: 'Computers', icon: 'computers' },
  { name: 'transactions', label: 'Transactions', icon: 'transactions' },
  { name: 'reports', label: 'Reports', icon: 'reports' },
  { name: 'loyalty', label: 'Loyalty', icon: 'loyalty' },
  { name: 'audit', label: 'Audit log', icon: 'audit' },
  { name: 'admins', label: 'Admins', icon: 'admins' },
];

function logout() {
  clearSession();
  router.push({ name: 'login' });
}

function go(name: string) {
  menuOpen.value = false;
  router.push({ name });
}
</script>

<template>
  <div v-if="showShell" class="app-shell">
    <aside class="sidebar" :class="{ open: menuOpen }">
      <div class="brand">
        <img src="/icon.svg" alt="" />
        <span>Pisonet</span>
      </div>

      <a
        v-for="link in links"
        :key="link.name"
        class="nav-link"
        :class="{ active: route.name === link.name }"
        @click="go(link.name)"
      >
        <NavIcon :name="link.icon" />
        <span>{{ link.label }}</span>
      </a>

      <div class="sidebar-footer">
        <span class="muted">{{ auth.email }}</span>
        <button class="btn-ghost btn-sm" @click="logout">Log out</button>
      </div>
    </aside>

    <div
      v-if="menuOpen"
      class="modal-backdrop"
      style="z-index: 30"
      @click="menuOpen = false"
    ></div>

    <div class="main">
      <header class="topbar">
        <button class="btn-ghost btn-sm" @click="menuOpen = !menuOpen">☰ Menu</button>
        <strong>Pisonet Admin</strong>
      </header>
      <main class="content">
        <router-view />
      </main>
    </div>
  </div>

  <router-view v-else />
</template>
