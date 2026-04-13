<template>
  <div class="admin-logs" :class="{ 'dark-mode': isDark }">
    <n-card title="操作日志" class="table-card">
      <template #header-extra>
        <n-button @click="fetchLogs">刷新</n-button>
      </template>

      <n-data-table
        :columns="columns"
        :data="logs"
        :loading="isLoading"
        :pagination="{ pageSize: 15 }"
        :scroll-x="600"
      />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, inject, onMounted } from 'vue';
import { useMessage } from 'naive-ui';
import axios from 'axios';

interface AuditLog {
  id: number;
  admin_username: string;
  action: string;
  details: string;
  created_at: string;
}

const isDark = inject('adminTheme', ref(false));
const message = useMessage();
const logs = ref<AuditLog[]>([]);
const isLoading = ref(false);

const getAuthHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('admin_token')}` });

const actionLabels: Record<string, string> = {
  LOGIN: '登录',
  GENERATE_CODES: '生成授权码',
  UPDATE_CODE: '更新授权码',
  DELETE_CODE: '删除授权码',
  PUBLISH_VERSION: '发布版本',
  DELETE_VERSION: '删除版本',
};

const columns = [
  {
    title: '时间',
    key: 'created_at',
    width: 140,
    render: (row: AuditLog) => new Date(row.created_at).toLocaleString(),
  },
  { title: '管理员', key: 'admin_username', width: 100 },
  { title: '操作', key: 'action', width: 100, render: (row: AuditLog) => actionLabels[row.action] || row.action },
  {
    title: '详情',
    key: 'details',
    ellipsis: { tooltip: true },
    render: (row: AuditLog) => {
      try {
        const d = JSON.parse(row.details);
        switch (row.action) {
          case 'LOGIN': return `IP: ${d.ip || '-'}`;
          case 'GENERATE_CODES': return `生成 ${d.count} 个${d.remarks ? ` (${d.remarks})` : ''}`;
          case 'UPDATE_CODE': return `#${d.id}${d.status ? ` → ${d.status}` : ''}`;
          case 'DELETE_CODE': return `#${d.id}`;
          case 'PUBLISH_VERSION': return `${d.version} (${d.platform})${d.isForce ? ' [强制]' : ''}`;
          case 'DELETE_VERSION': return `#${d.id}`;
          default: return JSON.stringify(d);
        }
      } catch { return row.details; }
    },
  },
];

const fetchLogs = async () => {
  isLoading.value = true;
  try {
    const res = await axios.get('/api/admin/logs', { headers: getAuthHeaders() });
    if (res.data.success) logs.value = res.data.data;
  } catch { message.error('获取失败'); }
  finally { isLoading.value = false; }
};

onMounted(fetchLogs);
</script>

<style lang="scss" scoped>
.admin-logs {
  width: 100%;

  .table-card {
    background: #ffffff !important;
    border: 1px solid #e5e5e5 !important;
    transition: background 0.3s, border-color 0.3s;

    .dark-mode & {
      background: #12121a !important;
      border-color: rgba(255, 255, 255, 0.06) !important;
    }
  }
}
</style>