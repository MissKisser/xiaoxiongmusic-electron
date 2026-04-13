<template>
  <div class="admin-codes" :class="{ 'dark-mode': isDark }">
    <!-- 操作栏 -->
    <n-card class="action-bar">
      <n-flex justify="space-between" align="center" :wrap="true" :size="[12, 12]">
        <n-flex :size="12" :wrap="true">
          <n-input-number v-model:value="generateCount" :min="1" :max="1000" placeholder="数量" style="width: 90px;" />
          <n-input v-model:value="generateRemarks" placeholder="备注" style="width: 180px;" />
          <n-button type="primary" :loading="isGenerating" @click="handleGenerate">生成</n-button>
        </n-flex>
        <n-flex :size="12">
          <n-button :disabled="checkedRowKeys.length === 0" @click="handleBatchExport">
            导出 {{ checkedRowKeys.length }}
          </n-button>
          <n-button @click="fetchCodes">刷新</n-button>
        </n-flex>
      </n-flex>
    </n-card>

    <!-- 数据表 -->
    <n-card class="table-card" style="margin-top: 16px;">
      <n-flex justify="space-between" align="center" :size="12" style="margin-bottom: 12px;">
        <n-tabs type="line" animated v-model:value="currentTab" @update:value="checkedRowKeys = []">
          <n-tab-pane name="all" tab="全部" />
          <n-tab-pane name="unused" tab="未使用" />
          <n-tab-pane name="active" tab="已激活" />
          <n-tab-pane name="disabled" tab="已禁用" />
        </n-tabs>
        <n-input v-model:value="searchKeyword" placeholder="搜索" clearable style="width: 200px;">
          <template #prefix><n-icon size="16"><SearchOutline /></n-icon></template>
        </n-input>
      </n-flex>

      <n-data-table
        :columns="columns"
        :data="filteredCodes"
        :loading="isLoading"
        :pagination="{ pageSize: 15 }"
        :row-key="(row: AuthCode) => row.id"
        :scroll-x="800"
        @update:checked-row-keys="(keys) => checkedRowKeys = keys as number[]"
      />
    </n-card>

    <!-- 编辑弹窗 -->
    <n-modal v-model:show="showEditModal" preset="card" title="编辑授权码" style="width: 380px;">
      <n-form :model="editForm" label-placement="left" label-width="60">
        <n-form-item label="备注">
          <n-input v-model:value="editForm.remarks" placeholder="输入备注" />
        </n-form-item>
        <n-form-item label="状态">
          <n-select v-model:value="editForm.status" :options="statusOptions" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-flex justify="end" :size="12">
          <n-button @click="showEditModal = false">取消</n-button>
          <n-button type="primary" :loading="isSaving" @click="handleSaveEdit">保存</n-button>
        </n-flex>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, h, computed, inject, onMounted } from 'vue';
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
  bound_devices: BoundDevice[];
  last_login_ip: string | null;
}

const isDark = inject('adminTheme', ref(false));
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
const showEditModal = ref(false);
const isSaving = ref(false);
const editForm = ref({ id: 0, remarks: '', status: 'active' });

const statusOptions = [
  { label: '未使用', value: 'unused' },
  { label: '已激活', value: 'active' },
  { label: '已禁用', value: 'disabled' },
];

const platformLabels: Record<string, string> = {
  android: 'Android',
  windows: 'Windows',
  macos: 'macOS',
  ios: 'iOS',
};

const getAuthHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('admin_token')}` });

const filteredCodes = computed(() => {
  let result = codes.value;
  if (currentTab.value !== 'all') result = result.filter(c => c.status === currentTab.value);
  if (searchKeyword.value.trim()) {
    const kw = searchKeyword.value.trim().toLowerCase();
    result = result.filter(c =>
      c.code.toLowerCase().includes(kw) ||
      c.remarks?.toLowerCase().includes(kw) ||
      c.last_login_ip?.toLowerCase().includes(kw)
    );
  }
  return result;
});

const getLastActiveTime = (row: AuthCode): number => {
  if (!row.bound_devices?.length) return 0;
  const times = row.bound_devices.map(d => d.lastActiveAt).filter(Boolean).map(t => new Date(t!).getTime());
  return times.length ? Math.max(...times) : 0;
};

const columns: DataTableColumns<AuthCode> = [
  { type: 'selection' as const },
  {
    title: '授权码',
    key: 'code',
    width: 230,
    render: (row: AuthCode) =>
      h('code', { class: 'code-text', onClick: () => copyCode(row.code) }, row.code),
  },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render: (row: AuthCode) => {
      const map: Record<string, { type: 'default' | 'success' | 'error'; label: string }> = {
        unused: { type: 'default', label: '未使用' },
        active: { type: 'success', label: '已激活' },
        disabled: { type: 'error', label: '已禁用' },
      };
      return h(NTag, { type: map[row.status].type, size: 'small', bordered: false }, () => map[row.status].label);
    },
  },
  { title: '备注', key: 'remarks', width: 140, ellipsis: { tooltip: true }, render: (r: AuthCode) => r.remarks || '-' },
  {
    title: '绑定设备',
    key: 'bound_devices',
    width: 180,
    render: (row: AuthCode) => {
      if (!row.bound_devices?.length) return '-';
      return h(NFlex, { size: 4 }, () =>
        row.bound_devices.map(d =>
          h(NTag, { size: 'small', type: 'info', bordered: false }, () => platformLabels[d.platform] || d.platform)
        )
      );
    },
  },
  { title: '最近IP', key: 'last_login_ip', width: 110, render: (r: AuthCode) => r.last_login_ip || '-' },
  {
    title: '最近活跃',
    key: 'last_active',
    width: 140,
    render: (row: AuthCode) => {
      const t = getLastActiveTime(row);
      return t ? new Date(t).toLocaleString() : '-';
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 120,
    render: (row: AuthCode) =>
      h(NFlex, { size: 8 }, () => [
        h(NButton, { size: 'small', onClick: () => openEdit(row) }, () => '编辑'),
        h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row.id) }, () => '删除'),
      ]),
  },
];

const copyCode = (code: string) => {
  if (isSupported.value) {
    copy(code);
    message.success('已复制');
  }
};

const handleBatchExport = () => {
  if (!checkedRowKeys.value.length) return;
  const selected = codes.value.filter(c => checkedRowKeys.value.includes(c.id)).map(c => c.code).join('\n');
  if (isSupported.value) {
    copy(selected);
    message.success(`已复制 ${checkedRowKeys.value.length} 个授权码`);
  }
};

const fetchCodes = async () => {
  isLoading.value = true;
  try {
    const res = await axios.get('/api/admin/codes', { headers: getAuthHeaders() });
    if (res.data.success) codes.value = res.data.data;
  } catch { message.error('获取失败'); }
  finally { isLoading.value = false; }
};

const handleGenerate = async () => {
  if (generateCount.value < 1) {
    message.warning('请输入有效数量');
    return;
  }
  isGenerating.value = true;
  try {
    const res = await axios.post('/api/admin/codes/generate', {
      count: generateCount.value,
      remarks: generateRemarks.value || undefined,
    }, { headers: getAuthHeaders() });
    if (res.data.success) {
      message.success(res.data.message);
      generateRemarks.value = '';
      fetchCodes();
    } else { message.error(res.data.message); }
  } catch { message.error('生成失败'); }
  finally { isGenerating.value = false; }
};

const openEdit = (row: AuthCode) => {
  editForm.value = { id: row.id, remarks: row.remarks || '', status: row.status };
  showEditModal.value = true;
};

const handleSaveEdit = async () => {
  isSaving.value = true;
  try {
    const res = await axios.put(`/api/admin/codes/${editForm.value.id}`, {
      remarks: editForm.value.remarks,
      status: editForm.value.status,
    }, { headers: getAuthHeaders() });
    if (res.data.success) {
      message.success('已保存');
      showEditModal.value = false;
      fetchCodes();
    } else { message.error(res.data.message); }
  } catch { message.error('保存失败'); }
  finally { isSaving.value = false; }
};

const handleDelete = (id: number) => {
  dialog.warning({
    title: '确认删除',
    content: '此操作不可恢复',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const res = await axios.delete(`/api/admin/codes/${id}`, { headers: getAuthHeaders() });
        if (res.data.success) { message.success('已删除'); fetchCodes(); }
      } catch { message.error('删除失败'); }
    },
  });
};

onMounted(fetchCodes);
</script>

<style lang="scss" scoped>
.admin-codes {
  width: 100%;

  .action-bar {
    background: #ffffff !important;
    border: 1px solid #e5e5e5 !important;
    transition: background 0.3s, border-color 0.3s;

    .dark-mode & {
      background: #12121a !important;
      border-color: rgba(255, 255, 255, 0.06) !important;
    }

    :deep(.n-input-number) { width: 90px; }
  }

  .table-card {
    background: #ffffff !important;
    border: 1px solid #e5e5e5 !important;
    transition: background 0.3s, border-color 0.3s;

    .dark-mode & {
      background: #12121a !important;
      border-color: rgba(255, 255, 255, 0.06) !important;
    }
  }

  .code-text {
    font-size: 12px;
    color: #71717a;
    cursor: pointer;
    &:hover { color: #2563eb; .dark-mode & { color: #3b82f6; } }
    .dark-mode & { color: #a1a1aa; }
  }
}

@media (max-width: 600px) {
  .action-bar {
    :deep(.n-input-number) { width: 70px; }
    :deep(.n-input:not(.n-input-number)) { width: 100% !important; }
  }
}
</style>