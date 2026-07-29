<template>
  <div class="admin-versions" :class="{ 'dark-mode': isDark }">
    <!-- 发布新版本 -->
    <n-card title="发布新版本" class="publish-card">
      <n-form ref="formRef" :model="publishForm" :rules="rules" label-placement="left" label-width="80">
        <n-grid :cols="2" :x-gap="16" responsive="screen" :item-responsive="true">
          <n-gi span="2 m:1">
            <n-form-item label="版本号" path="version">
              <n-input v-model:value="publishForm.version" placeholder="如 3.9" />
            </n-form-item>
          </n-gi>
          <n-gi span="2 m:1">
            <n-form-item label="平台">
              <n-select v-model:value="publishForm.platform" :options="platformOptions" />
            </n-form-item>
          </n-gi>
        </n-grid>

        <n-form-item label="下载链接" path="apkUrl">
          <n-input v-model:value="publishForm.apkUrl" placeholder="安装包下载地址" />
        </n-form-item>

        <n-form-item label="更新说明">
          <n-input v-model:value="publishForm.description" type="textarea" placeholder="Markdown 格式" :rows="3" />
        </n-form-item>

        <n-form-item label="强制更新">
          <n-switch v-model:value="publishForm.isForce" />
        </n-form-item>

        <n-form-item>
          <n-button type="primary" :loading="isPublishing" @click="handlePublish">发布</n-button>
        </n-form-item>
      </n-form>
    </n-card>

    <!-- 版本历史 -->
    <n-card title="版本历史" class="table-card" style="margin-top: 16px;">
      <n-data-table
        :columns="columns"
        :data="versions"
        :loading="isLoading"
        :pagination="{ pageSize: 10 }"
        :row-key="(row: AppVersion) => row.id"
        :scroll-x="700"
      />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, h, inject, onMounted } from 'vue';
import { NButton, NTag, useMessage, useDialog } from 'naive-ui';
import axios from 'axios';

interface AppVersion {
  id: number;
  version: string;
  build_number: number;
  platform: string;
  apk_url: string;
  description: string | null;
  is_force: boolean;
  created_at: string;
}

const isDark = inject('adminTheme', ref(false));
const message = useMessage();
const dialog = useDialog();
const formRef = ref();

const versions = ref<AppVersion[]>([]);
const isLoading = ref(false);
const isPublishing = ref(false);

const publishForm = ref({
  version: '',
  platform: 'android',
  apkUrl: '',
  description: '',
  isForce: false,
});

const platformOptions = [
  { label: 'Android', value: 'android' },
  { label: 'iOS', value: 'ios' },
  { label: 'Windows', value: 'windows' },
  { label: 'macOS', value: 'macos' },
];

const rules = {
  version: { required: true, message: '请输入版本号' },
  apkUrl: { required: true, message: '请输入下载链接' },
};

const getAuthHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('admin_token')}` });

const columns = [
  { title: '版本', key: 'version', width: 80 },
  { title: 'Build', key: 'build_number', width: 70 },
  { title: '平台', key: 'platform', width: 90 },
  { title: '下载链接', key: 'apk_url', ellipsis: { tooltip: true } },
  {
    title: '强制',
    key: 'is_force',
    width: 70,
    render: (row: AppVersion) =>
      h(NTag, { type: row.is_force ? 'error' : 'default', size: 'small', bordered: false }, () => row.is_force ? '是' : '否'),
  },
  { title: '说明', key: 'description', ellipsis: { tooltip: true }, render: (r: AppVersion) => r.description || '-' },
  {
    title: '发布时间',
    key: 'created_at',
    width: 140,
    render: (row: AppVersion) => new Date(row.created_at).toLocaleString(),
  },
  {
    title: '操作',
    key: 'actions',
    width: 70,
    render: (row: AppVersion) =>
      h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row.id) }, () => '删除'),
  },
];

const fetchVersions = async () => {
  isLoading.value = true;
  try {
    const res = await axios.get('/api/admin/versions', { headers: getAuthHeaders() });
    if (res.data.success) versions.value = res.data.data;
  } catch { message.error('获取失败'); }
  finally { isLoading.value = false; }
};

const handlePublish = async () => {
  try { await formRef.value?.validate(); } catch { return; }
  isPublishing.value = true;
  try {
    const res = await axios.post('/api/admin/versions', publishForm.value, { headers: getAuthHeaders() });
    if (res.data.success) {
      message.success(res.data.message);
      publishForm.value = { version: '', platform: 'android', apkUrl: '', description: '', isForce: false };
      fetchVersions();
    } else { message.error(res.data.message); }
  } catch { message.error('发布失败'); }
  finally { isPublishing.value = false; }
};

const handleDelete = (id: number) => {
  dialog.warning({
    title: '确认删除',
    content: '删除该版本记录',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const res = await axios.delete(`/api/admin/versions/${id}`, { headers: getAuthHeaders() });
        if (res.data.success) { message.success('已删除'); fetchVersions(); }
      } catch { message.error('删除失败'); }
    },
  });
};

onMounted(fetchVersions);
</script>

<style lang="scss" scoped>
.admin-versions {
  width: 100%;

  .publish-card,
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