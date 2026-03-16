<template>
  <div class="admin-logs">
    <n-card title="操作日志">
      <template #header-extra>
        <n-button @click="fetchLogs">刷新</n-button>
      </template>

      <n-data-table
        :columns="columns"
        :data="logs"
        :loading="isLoading"
        :pagination="{ pageSize: 20 }"
        :scroll-x="700"
      />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useMessage } from 'naive-ui';
import axios from 'axios';

interface AuditLog {
  id: number;
  admin_username: string;
  action: string;
  details: string;
  created_at: string;
}

const message = useMessage();
const logs = ref<AuditLog[]>([]);
const isLoading = ref(false);

const getAuthHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('admin_token')}`,
});

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
    width: 160,
    render: (row: AuditLog) => new Date(row.created_at).toLocaleString(),
  },
  {
    title: '管理员',
    key: 'admin_username',
    width: 120,
  },
  {
    title: '操作',
    key: 'action',
    width: 120,
    render: (row: AuditLog) => actionLabels[row.action] || row.action,
  },
  {
    title: '详情',
    key: 'details',
    ellipsis: { tooltip: true },
    render: (row: AuditLog) => {
      try {
        const d = JSON.parse(row.details);
        switch (row.action) {
          case 'LOGIN':
            return `IP: ${d.ip || '-'}`;
          case 'GENERATE_CODES':
            return `生成 ${d.count} 个授权码${d.remarks ? `（备注: ${d.remarks}）` : ''}`;
          case 'UPDATE_CODE':
            return `授权码 #${d.id}${d.status ? ` → ${d.status}` : ''}${d.remarks !== undefined ? `（备注: ${d.remarks || '无'}）` : ''}`;
          case 'DELETE_CODE':
            return `删除授权码 #${d.id}`;
          case 'PUBLISH_VERSION':
            return `发布 ${d.version}（${d.platform}）${d.isForce ? ' [强制更新]' : ''}`;
          case 'DELETE_VERSION':
            return `删除版本 #${d.id}`;
          default:
            return JSON.stringify(d);
        }
      } catch {
        return row.details;
      }
    },
  },
];

const fetchLogs = async () => {
  isLoading.value = true;
  try {
    const response = await axios.get('/api/admin/logs', { headers: getAuthHeaders() });
    if (response.data.success) {
      logs.value = response.data.data;
    }
  } catch (error) {
    message.error('获取日志失败');
  } finally {
    isLoading.value = false;
  }
};

onMounted(() => {
  fetchLogs();
});
</script>

<style lang="scss" scoped>
.admin-logs {
  /* Styles if needed */
}
</style>
