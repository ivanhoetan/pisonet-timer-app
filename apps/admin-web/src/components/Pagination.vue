<script setup lang="ts">
import { computed } from 'vue';
import Icon from './Icon.vue';

const props = defineProps<{
  page: number;
  pageSize: number;
  total: number;
  label?: string;
}>();

const emit = defineEmits<{ (e: 'update:page', page: number): void }>();

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
const from = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1));
const to = computed(() => Math.min(props.total, props.page * props.pageSize));

function go(p: number) {
  if (p < 1 || p > totalPages.value || p === props.page) return;
  emit('update:page', p);
}
</script>

<template>
  <div v-if="total > 0" class="pagination">
    <span class="pg-info">
      Showing <strong>{{ from }}–{{ to }}</strong> of {{ total }} {{ label || 'records' }}
    </span>
    <div class="pg-controls">
      <button class="btn-ghost btn-sm" :disabled="page <= 1" @click="go(page - 1)">
        <Icon name="chevronLeft" :size="14" />Prev
      </button>
      <span class="pg-page">Page {{ page }} of {{ totalPages }}</span>
      <button class="btn-ghost btn-sm" :disabled="page >= totalPages" @click="go(page + 1)">
        Next<Icon name="chevronRight" :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 16px;
}

.pg-info {
  color: var(--muted);
  font-size: 13px;
}

.pg-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pg-page {
  color: var(--muted);
  font-size: 13px;
  min-width: 96px;
  text-align: center;
}

@media (max-width: 640px) {
  .pagination {
    justify-content: center;
  }
}
</style>
