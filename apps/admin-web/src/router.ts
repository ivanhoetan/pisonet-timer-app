import { createRouter, createWebHashHistory } from 'vue-router';
import { isAuthenticated } from './lib/auth';
import LoginView from './views/LoginView.vue';
import DashboardView from './views/DashboardView.vue';
import FloorView from './views/FloorView.vue';
import UsersView from './views/UsersView.vue';
import ComputersView from './views/ComputersView.vue';
import TransactionsView from './views/TransactionsView.vue';
import ReportsView from './views/ReportsView.vue';
import LoyaltyReportView from './views/LoyaltyReportView.vue';
import AuditView from './views/AuditView.vue';
import AdminsView from './views/AdminsView.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
    { path: '/', name: 'dashboard', component: DashboardView },
    { path: '/floor', name: 'floor', component: FloorView },
    { path: '/users', name: 'users', component: UsersView },
    { path: '/computers', name: 'computers', component: ComputersView },
    { path: '/transactions', name: 'transactions', component: TransactionsView },
    { path: '/reports', name: 'reports', component: ReportsView },
    { path: '/loyalty', name: 'loyalty', component: LoyaltyReportView },
    { path: '/audit', name: 'audit', component: AuditView },
    { path: '/admins', name: 'admins', component: AdminsView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach((to) => {
  if (!to.meta.public && !isAuthenticated()) {
    return { name: 'login' };
  }
  if (to.name === 'login' && isAuthenticated()) {
    return { name: 'dashboard' };
  }
  return true;
});

export default router;
