<template>
  <div class="admin-dashboard" :class="{ 'dark-mode': isDark }">
    <!-- 统计卡片 -->
    <div class="stats-grid">
      <n-card class="stat-card">
        <div class="stat-value">{{ stats.totalCodes }}</div>
        <div class="stat-label">授权码总数</div>
      </n-card>
      <n-card class="stat-card">
        <div class="stat-value">{{ stats.activeCodes }}</div>
        <div class="stat-label">活跃授权码</div>
      </n-card>
      <n-card class="stat-card">
        <div class="stat-value">{{ stats.yesterdayActive }}</div>
        <div class="stat-label">昨日在线</div>
      </n-card>
      <n-card class="stat-card">
        <div class="stat-value">{{ Object.keys(stats.platformDistribution).length }}</div>
        <div class="stat-label">平台数量</div>
      </n-card>
    </div>

    <!-- 最近访问 -->
    <n-card title="最近访问" class="table-card" style="margin-top: 16px;">
      <n-data-table
        :columns="activityColumns"
        :data="stats.recentActivity"
        :bordered="false"
        size="small"
      />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, h, inject, onMounted } from 'vue';
import { NTag } from 'naive-ui';
import axios from 'axios';

interface RecentActivityItem {
  code: string;
  platform: string;
  remarks: string;
  lastActiveAt: string;
}

interface DashboardStats {
  totalCodes: number;
  activeCodes: number;
  yesterdayActive: number;
  platformDistribution: Record<string, number>;
  recentActivity: RecentActivityItem[];
}

const isDark = inject('adminTheme', ref(false));
const stats = ref<DashboardStats>({
  totalCodes: 0,
  activeCodes: 0,
  yesterdayActive: 0,
  platformDistribution: {},
  recentActivity: [],
});

const platformLabels: Record<string, string> = {
  android: 'Android',
  windows: 'Windows',
  macos: 'macOS',
  ios: 'iOS',
  web: 'Web',
};

const activityColumns = [
  {
    title: '授权码',
    key: 'code',
    sorter: (a: RecentActivityItem, b: RecentActivityItem) => a.code.localeCompare(b.code),
    render: (row: RecentActivityItem) => {
      const code = row.code.length > 20 ? `${row.code.slice(0, 16)}...${row.code.slice(-4)}` : row.code;
      return h('code', { class: 'code-text' }, code);
    },
  },
  {
    title: '平台',
    key: 'platform',
    width: 100,
    sorter: (a: RecentActivityItem, b: RecentActivityItem) => a.platform.localeCompare(b.platform),
    render: (row: RecentActivityItem) =>
      h(NTag, { type: 'info', size: 'small', bordered: false }, () => platformLabels[row.platform] || row.platform),
  },
  {
    title: '备注',
    key: 'remarks',
    sorter: (a: RecentActivityItem, b: RecentActivityItem) => (a.remarks || '').localeCompare(b.remarks || ''),
    ellipsis: { tooltip: true },
    render: (row: RecentActivityItem) => row.remarks || '-'
  },
  {
    title: '活跃时间',
    key: 'lastActiveAt',
    width: 160,
    defaultSortOrder: 'descend' as const,
    sorter: (a: RecentActivityItem, b: RecentActivityItem) => new Date(a.lastActiveAt).getTime() - new Date(b.lastActiveAt).getTime(),
    render: (row: RecentActivityItem) => row.lastActiveAt ? new Date(row.lastActiveAt).toLocaleString() : '-',
  },
];

const fetchDashboard = async () => {
  try {
    const token = localStorage.getItem('admin_token');
    const response = await axios.get('/api/admin/dashboard', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.data.success) stats.value = response.data.data;
  } catch (error) {
    console.error('Fetch dashboard failed:', error);
  }
};

onMounted(fetchDashboard);
</script>

<style lang="scss" scoped>
.admin-dashboard {
  width: 100%;

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }

  .stat-card {
    text-align: center;
    padding: 20px 16px !important;
    background: #ffffff !important;
    border: 1px solid #e5e5e5 !important;
    transition: background 0.3s, border-color 0.3s;

    .dark-mode & {
      background: #12121a !important;
      border-color: rgba(255, 255, 255, 0.06) !important;
    }

    .stat-value {
      font-size: 28px;
      font-weight: 600;
      color: #18181b;
      margin-bottom: 4px;
      .dark-mode & { color: #e4e4e7; }
    }

    .stat-label {
      font-size: 13px;
      color: #71717a;
    }
  }

  .table-card {
    background: #ffffff !important;
    border: 1px solid #e5e5e5 !important;
    transition: background 0.3s, border-color 0.3s;

    .dark-mode & {
      background: #12121a !important;
      border-color: rgba(255, 255, 255, 0.06) !important;
    }

    :deep(.code-text) {
      font-size: 12px;
      color: #a1a1aa;
      background: rgba(0, 0, 0, 0.06);
      padding: 2px 6px;
      border-radius: 4px;

      .dark-mode & {
        background: rgba(255, 255, 255, 0.06);
      }
    }
  }
}

@media (max-width: 900px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 500px) {
  .stats-grid { grid-template-columns: 1fr; }
}
</style>