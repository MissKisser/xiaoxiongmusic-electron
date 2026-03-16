<template>
  <div class="admin-codes">
    <!-- 操作栏 -->
    <n-card class="action-bar">
      <n-flex justify="space-between" align="center" :wrap="true" :size="[12, 12]">
        <n-flex :size="12" :wrap="true">
          <n-input-number
            v-model:value="generateCount"
            :min="1"
            :max="1000"
            placeholder="数量"
            style="width: 100px;"
          />
          <n-input
            v-model:value="generateRemarks"
            placeholder="备注 (可选)"
            style="width: 200px;"
          />
          <n-button type="primary" :loading="isGenerating" @click="handleGenerate">
            批量生成
          </n-button>
        </n-flex>
        
        <n-flex :size="12">
          <n-button :disabled="checkedRowKeys.length === 0" @click="handleBatchExport">
            批量导出 ({{ checkedRowKeys.length }})
          </n-button>
          <n-button @click="fetchCodes">刷新</n-button>
        </n-flex>
      </n-flex>
    </n-card>

    <!-- 筛选与列表 -->
    <n-card style="margin-top: 16px;">
      <n-flex justify="space-between" align="center" :wrap="true" :size="[12, 12]" style="margin-bottom: 12px;">
        <n-tabs type="line" animated v-model:value="currentTab" @update:value="handleTabChange" style="flex: 1; min-width: 0;">
          <n-tab-pane name="all" tab="全部" />
          <n-tab-pane name="unused" tab="未使用" />
          <n-tab-pane name="active" tab="已激活" />
          <n-tab-pane name="disabled" tab="已禁用" />
        </n-tabs>
        <n-input
          v-model:value="searchKeyword"
          placeholder="搜索授权码 / 备注 / IP"
          clearable
          style="width: 260px; flex-shrink: 0;"
        >
          <template #prefix>
            <n-icon><SearchOutline /></n-icon>
          </template>
        </n-input>
      </n-flex>

      <n-data-table
        :columns="columns"
        :data="displayCodes"
        :loading="isLoading"
        :pagination="{ pageSize: 20 }"
        :row-key="(row: AuthCode) => row.id"
        :scroll-x="900"
        @update:checked-row-keys="handleCheck"
      />
    </n-card>

    <!-- 编辑弹窗 -->
    <n-modal v-model:show="showEditModal" preset="card" title="编辑授权码" style="width: 400px; max-width: 90vw;">
      <n-form :model="editForm">
        <n-form-item label="备注">
          <n-input v-model:value="editForm.remarks" placeholder="输入备注" />
        </n-form-item>
        <n-form-item label="状态">
          <n-select v-model:value="editForm.status" :options="statusOptions" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-flex justify="end">
          <n-button @click="showEditModal = false">取消</n-button>
          <n-button type="primary" :loading="isSaving" @click="handleSaveEdit">保存</n-button>
        </n-flex>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, h, computed, onMounted } from 'vue';
import { NButton, NTag, NFlex, NIcon, useMessage, useDialog, type DataTableColumns } from 'naive-ui';
import { SearchOutline } from '@vicons/ionicons5';
import axios from 'axios';
import { useClipboard } from '@vueuse/core';

interface BoundDevice {
  deviceId: string;
  platform: string;
  name: string | null;
  lastActiveAt: string | null;
}

interface AuthCode {
  id: number;
  code: string;
  status: 'unused' | 'active' | 'disabled';
  remarks: string | null;
  generated_at: string;
  last_login_at: string | null;
  last_login_ip: string | null;
  bound_devices: BoundDevice[];
}

const message = useMessage();
const dialog = useDialog();
const { copy, isSupported } = useClipboard();

const codes = ref<AuthCode[]>([]);
const isLoading = ref(false);
const isGenerating = ref(false);
const generateCount = ref(1);
const generateRemarks = ref('');
const currentTab = ref('all');
const checkedRowKeys = ref<number[]>([]);
const searchKeyword = ref('');

// 编辑相关
const showEditModal = ref(false);
const isSaving = ref(false);
const editForm = ref({
  id: 0,
  remarks: '',
  status: 'active' as string,
});

const statusOptions = [
  { label: '未使用', value: 'unused' },
  { label: '已激活', value: 'active' },
  { label: '已禁用', value: 'disabled' },
];

const getAuthHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('admin_token')}`,
});

// 计算过滤后的数据（Tab + 搜索）
const filteredCodes = computed(() => {
  let result = codes.value;
  
  // Tab 筛选
  if (currentTab.value !== 'all') {
    result = result.filter(code => code.status === currentTab.value);
  }
  
  // 搜索筛选
  if (searchKeyword.value.trim()) {
    const keyword = searchKeyword.value.trim().toLowerCase();
    result = result.filter(code => {
      const codeMatch = code.code.toLowerCase().includes(keyword);
      const remarksMatch = code.remarks?.toLowerCase().includes(keyword);
      const ipMatch = code.last_login_ip?.toLowerCase().includes(keyword);
      return codeMatch || remarksMatch || ipMatch;
    });
  }
  
  return result;
});

// 展示用数据（搜索 + Tab 过滤后的结果）
const displayCodes = computed(() => filteredCodes.value);

// 获取设备最近活跃时间（用于排序）
const getLastActiveTime = (row: AuthCode): number => {
  if (!row.bound_devices || row.bound_devices.length === 0) return 0;
  const times = row.bound_devices
    .map(d => d.lastActiveAt)
    .filter(Boolean)
    .map(t => new Date(t!).getTime());
  return times.length > 0 ? Math.max(...times) : 0;
};

// 表格列（含排序）
const columns: DataTableColumns<AuthCode> = [
  {
    type: 'selection',
  },
  {
    title: '授权码',
    key: 'code',
    width: 250,
    sorter: (a: AuthCode, b: AuthCode) => a.code.localeCompare(b.code),
    render: (row: AuthCode) => h('code', { style: 'font-size: 12px; cursor: pointer;', onClick: () => copyCode(row.code) }, row.code),
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    sorter: (a: AuthCode, b: AuthCode) => a.status.localeCompare(b.status),
    render: (row: AuthCode) => {
      const typeMap: Record<string, 'default' | 'success' | 'error'> = {
        unused: 'default',
        active: 'success',
        disabled: 'error',
      };
      const labelMap: Record<string, string> = {
        unused: '未使用',
        active: '已激活',
        disabled: '已禁用',
      };
      return h(NTag, { type: typeMap[row.status], size: 'small' }, () => labelMap[row.status]);
    },
  },
  {
    title: '备注',
    key: 'remarks',
    width: 150,
    ellipsis: { tooltip: true },
    sorter: (a: AuthCode, b: AuthCode) => (a.remarks || '').localeCompare(b.remarks || ''),
  },
  {
    title: '绑定设备',
    key: 'bound_devices',
    width: 220,
    sorter: (a: AuthCode, b: AuthCode) => (a.bound_devices?.length || 0) - (b.bound_devices?.length || 0),
    render: (row: AuthCode) => {
      if (!row.bound_devices || row.bound_devices.length === 0) return '-';
      const platformLabels: Record<string, string> = {
        android: 'Android',
        windows: 'Windows',
        macos: 'macOS',
        ios: 'iOS',
      };
      return h(NFlex, { size: 4, wrap: true }, () =>
        row.bound_devices.map(d =>
          h(NTag, { size: 'small', type: 'info', bordered: false }, () => platformLabels[d.platform] || d.platform)
        )
      );
    },
  },
  {
    title: '最近登录IP',
    key: 'last_login_ip',
    width: 120,
    sorter: (a: AuthCode, b: AuthCode) => (a.last_login_ip || '').localeCompare(b.last_login_ip || ''),
    render: (row: AuthCode) => row.last_login_ip || '-',
  },
  {
    title: '最近活跃',
    key: 'last_active',
    width: 160,
    sorter: (a: AuthCode, b: AuthCode) => getLastActiveTime(a) - getLastActiveTime(b),
    render: (row: AuthCode) => {
      const time = getLastActiveTime(row);
      if (time === 0) return '-';
      return new Date(time).toLocaleString();
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 150,
    render: (row: AuthCode) => h(NFlex, { size: 8 }, () => [
      h(NButton, { size: 'small', onClick: () => openEdit(row) }, () => '编辑'),
      h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row.id) }, () => '删除'),
    ]),
  },
];

const handleCheck = (rowKeys: (string | number)[]) => {
  checkedRowKeys.value = rowKeys as number[];
};

// 复制单个授权码
const copyCode = (code: string) => {
  if (isSupported.value) {
    copy(code);
    message.success('已复制到剪贴板');
  } else {
    message.warning('浏览器不支持复制');
  }
};

// 批量导出
const handleBatchExport = () => {
  if (checkedRowKeys.value.length === 0) return;
  
  const selectedCodes = codes.value
    .filter(c => checkedRowKeys.value.includes(c.id))
    .map(c => c.code)
    .join('\n');
    
  if (isSupported.value) {
    copy(selectedCodes);
    message.success(`已复制 ${checkedRowKeys.value.length} 个授权码到剪贴板`);
  } else {
    // 降级处理
     dialog.info({
        title: '批量导出',
        content: () => h('textarea', { 
            value: selectedCodes, 
            style: 'width: 100%; height: 200px; padding: 8px; border: 1px solid #ccc; border-radius: 4px;', 
            readonly: true 
        }),
        positiveText: '关闭'
     });
  }
};

const handleTabChange = () => {
  checkedRowKeys.value = [];
};

// 获取授权码列表
const fetchCodes = async () => {
  isLoading.value = true;
  try {
    const response = await axios.get('/api/admin/codes', { headers: getAuthHeaders() });
    if (response.data.success) {
      codes.value = response.data.data;
    }
  } catch (error) {
    message.error('获取授权码列表失败');
  } finally {
    isLoading.value = false;
  }
};

// 批量生成
const handleGenerate = async () => {
  if (generateCount.value < 1) {
    message.warning('请输入有效数量');
    return;
  }

  isGenerating.value = true;
  try {
    const response = await axios.post('/api/admin/codes/generate', {
      count: generateCount.value,
      remarks: generateRemarks.value || undefined,
    }, { headers: getAuthHeaders() });

    if (response.data.success) {
      message.success(response.data.message);
      generateRemarks.value = '';
      fetchCodes();
    } else {
      message.error(response.data.message);
    }
  } catch (error) {
    message.error('生成失败');
  } finally {
    isGenerating.value = false;
  }
};

// 打开编辑弹窗
const openEdit = (row: AuthCode) => {
  editForm.value = {
    id: row.id,
    remarks: row.remarks || '',
    status: row.status,
  };
  showEditModal.value = true;
};

// 保存编辑
const handleSaveEdit = async () => {
  isSaving.value = true;
  try {
    const response = await axios.put(`/api/admin/codes/${editForm.value.id}`, {
      remarks: editForm.value.remarks,
      status: editForm.value.status,
    }, { headers: getAuthHeaders() });

    if (response.data.success) {
      message.success('更新成功');
      showEditModal.value = false;
      fetchCodes();
    } else {
      message.error(response.data.message);
    }
  } catch (error) {
    message.error('更新失败');
  } finally {
    isSaving.value = false;
  }
};

// 删除授权码
const handleDelete = (id: number) => {
  dialog.warning({
    title: '确认删除',
    content: '确定要删除该授权码吗？此操作不可恢复。',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const response = await axios.delete(`/api/admin/codes/${id}`, { headers: getAuthHeaders() });
        if (response.data.success) {
          message.success('删除成功');
          fetchCodes();
        }
      } catch (error) {
        message.error('删除失败');
      }
    },
  });
};

onMounted(() => {
  fetchCodes();
});
</script>

<style lang="scss" scoped>
.admin-codes {
  .action-bar {
    margin-bottom: 16px;
  }
}

@media (max-width: 768px) {
  .admin-codes {
    :deep(.n-input-number) {
      width: 80px !important;
    }

    :deep(.n-input:not(.n-input-number)) {
      width: 100% !important;
    }
  }
}
</style>
