<template>
  <div class="admin-dashboard">
    <!-- 统计卡片 -->
    <n-grid :cols="4" :x-gap="16" :y-gap="16">
      <n-gi>
        <n-card class="stat-card">
          <n-statistic label="总授权码" :value="stats.totalCodes">
            <template #suffix>个</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi>
        <n-card class="stat-card">
          <n-statistic label="活跃授权码" :value="stats.activeCodes">
            <template #suffix>个</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi>
        <n-card class="stat-card">
          <n-statistic label="昨日在线" :value="stats.yesterdayActive">
            <template #suffix>人</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi>
        <n-card class="stat-card">
          <n-statistic label="平台数" :value="Object.keys(stats.platformDistribution).length">
            <template #suffix>个</template>
          </n-statistic>
        </n-card>
      </n-gi>
    </n-grid>

    <!-- 平台分布 -->
    <n-card title="平台分布" style="margin-top: 16px;">
      <n-table :bordered="false" :single-line="false">
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import axios from 'axios';

interface DashboardStats {
  totalCodes: number;
  activeCodes: number;
  yesterdayActive: number;
  platformDistribution: Record<string, number>;
}

const stats = ref<DashboardStats>({
  totalCodes: 0,
  activeCodes: 0,
  yesterdayActive: 0,
  platformDistribution: {},
});

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
}
</style>
