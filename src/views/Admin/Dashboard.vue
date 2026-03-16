<template>
  <div class="admin-dashboard">
    <!-- 统计卡片 -->
    <n-grid :cols="4" :x-gap="16" :y-gap="16" responsive="screen" :item-responsive="true">
      <n-gi span="4 s:2 m:1">
        <n-card class="stat-card">
          <n-statistic label="总授权码" :value="stats.totalCodes">
            <template #suffix>个</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi span="4 s:2 m:1">
        <n-card class="stat-card">
          <n-statistic label="活跃授权码" :value="stats.activeCodes">
            <template #suffix>个</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi span="4 s:2 m:1">
        <n-card class="stat-card">
          <n-statistic label="昨日在线" :value="stats.yesterdayActive">
            <template #suffix>人</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi span="4 s:2 m:1">
        <n-card class="stat-card">
          <n-statistic label="平台数" :value="Object.keys(stats.platformDistribution).length">
            <template #suffix>个</template>
          </n-statistic>
        </n-card>
      </n-gi>
    </n-grid>

    <n-grid :cols="2" :x-gap="16" :y-gap="16" responsive="screen" :item-responsive="true" style="margin-top: 16px;">
      <!-- 最近访问 -->
      <n-gi span="2 m:1">
        <n-card title="最近访问" class="recent-card">
          <n-table :bordered="false" :single-line="false" size="small">
            <thead>
              <tr>
                <th>授权码</th>
                <th>平台</th>
                <th>设备</th>
                <th>活跃时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in stats.recentActivity" :key="index">
                <td>
                  <code class="code-text">{{ formatCode(item.code) }}</code>
                </td>
                <td>
                  <n-tag :type="getPlatformType(item.platform)" size="small" :bordered="false">
                    {{ getPlatformLabel(item.platform) }}
                  </n-tag>
                </td>
                <td>{{ item.deviceName }}</td>
                <td>{{ formatTime(item.lastActiveAt) }}</td>
              </tr>
              <tr v-if="stats.recentActivity.length === 0">
                <td colspan="4" style="text-align: center; color: rgba(255,255,255,0.4);">
                  暂无数据
                </td>
              </tr>
            </tbody>
          </n-table>
        </n-card>
      </n-gi>

      <!-- 平台分布 -->
      <n-gi span="2 m:1">
        <n-card title="平台分布">
          <n-table :bordered="false" :single-line="false" size="small">
            <thead>
              <tr>
                <th>平台</th>
                <th>设备数量</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(count, platform) in stats.platformDistribution" :key="platform">
                <td>{{ platform }}</td>
                <td>{{ count }}</td>
              </tr>
              <tr v-if="Object.keys(stats.platformDistribution).length === 0">
                <td colspan="2" style="text-align: center; color: rgba(255,255,255,0.4);">
                  暂无数据
                </td>
              </tr>
            </tbody>
          </n-table>
        </n-card>
      </n-gi>
    </n-grid>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { NTag } from 'naive-ui';
import axios from 'axios';

interface RecentActivityItem {
  code: string;
  platform: string;
  deviceName: string;
  lastActiveAt: string;
}

interface DashboardStats {
  totalCodes: number;
  activeCodes: number;
  yesterdayActive: number;
  platformDistribution: Record<string, number>;
  recentActivity: RecentActivityItem[];
}

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

const platformTypes: Record<string, 'default' | 'success' | 'info' | 'warning' | 'error'> = {
  android: 'success',
  ios: 'info',
  windows: 'warning',
  macos: 'default',
  web: 'default',
};

const getPlatformLabel = (platform: string) => platformLabels[platform] || platform;
const getPlatformType = (platform: string) => platformTypes[platform] || 'default';

// 授权码截断显示
const formatCode = (code: string) => {
  if (code.length > 20) {
    return `${code.slice(0, 16)}...${code.slice(-4)}`;
  }
  return code;
};

// 时间格式化
const formatTime = (time: string) => {
  if (!time) return '-';
  return new Date(time).toLocaleString();
};

const fetchDashboard = async () => {
  try {
    const token = localStorage.getItem('admin_token');
    const response = await axios.get('/api/admin/dashboard', {
      headers: { Authorization: `Bearer ${token}` },
    });
    
    if (response.data.success) {
      stats.value = response.data.data;
    }
  } catch (error) {
    console.error('Fetch dashboard failed:', error);
  }
};

onMounted(() => {
  fetchDashboard();
});
</script>

<style lang="scss" scoped>
.admin-dashboard {
  .stat-card {
    text-align: center;

    :deep(.n-statistic-value) {
      font-size: 32px;
    }
  }

  .recent-card {
    .code-text {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.7);
      word-break: break-all;
    }
  }
}

@media (max-width: 768px) {
  .admin-dashboard {
    .stat-card {
      :deep(.n-statistic-value) {
        font-size: 24px;
      }
    }
  }
}
</style>
