<template>
  <div class="admin-versions">
    <!-- 发布新版本 -->
    <n-card title="发布新版本" class="publish-card">
      <n-form ref="formRef" :model="publishForm" :rules="rules" label-placement="left" label-width="100">
        <n-grid :cols="2" :x-gap="24" responsive="screen" :item-responsive="true">
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
          <n-input
            v-model:value="publishForm.description"
            type="textarea"
            placeholder="支持 Markdown 格式"
            :rows="4"
          />
        </n-form-item>

        <n-form-item label="强制更新">
          <n-switch v-model:value="publishForm.isForce" />
        </n-form-item>

        <n-form-item>
          <n-button type="primary" :loading="isPublishing" @click="handlePublish">
            发布版本
          </n-button>
        </n-form-item>
      </n-form>
    </n-card>

    <!-- 版本历史 -->
    <n-card title="版本历史" style="margin-top: 16px;">
      <n-data-table
        :columns="columns"
        :data="versions"
        :loading="isLoading"
        :pagination="{ pageSize: 10 }"
        :row-key="(row: AppVersion) => row.id"
        :scroll-x="800"
      />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, h, onMounted } from 'vue';
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

const getAuthHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('admin_token')}`,
});

const columns = [
  {
    title: '版本号',
    key: 'version',
    width: 100,
  },
  {
    title: 'Build',
    key: 'build_number',
    width: 80,
  },
  {
    title: '平台',
    key: 'platform',
    width: 100,
  },
  {
    title: '下载链接',
    key: 'apk_url',
    ellipsis: { tooltip: true },
  },
  {
    title: '强制更新',
    key: 'is_force',
    width: 100,
    render: (row: AppVersion) => h(NTag, {
      type: row.is_force ? 'error' : 'default',
      size: 'small',
    }, () => row.is_force ? '是' : '否'),
  },
  {
    title: '更新说明',
    key: 'description',
    ellipsis: { tooltip: true },
    render: (row: AppVersion) => row.description || '-',
  },
  {
    title: '发布时间',
    key: 'created_at',
    width: 160,
    render: (row: AppVersion) => new Date(row.created_at).toLocaleString(),
  },
  {
    title: '操作',
    key: 'actions',
    width: 80,
    render: (row: AppVersion) => h(NButton, {
      size: 'small',
      type: 'error',
      onClick: () => handleDelete(row.id),
    }, () => '删除'),
  },
];

const fetchVersions = async () => {
  isLoading.value = true;
  try {
    const response = await axios.get('/api/admin/versions', { headers: getAuthHeaders() });
    if (response.data.success) {
      versions.value = response.data.data;
    }
  } catch (error) {
    message.error('获取版本列表失败');
  } finally {
    isLoading.value = false;
  }
};

const handlePublish = async () => {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }

  isPublishing.value = true;
  try {
    const response = await axios.post('/api/admin/versions', publishForm.value, {
      headers: getAuthHeaders(),
    });

    if (response.data.success) {
      message.success(response.data.message);
      publishForm.value = {
        version: '',
        platform: 'android',
        apkUrl: '',
        description: '',
        isForce: false,
      };
      fetchVersions();
    } else {
      message.error(response.data.message);
    }
  } catch (error) {
    message.error('发布失败');
  } finally {
    isPublishing.value = false;
  }
};

const handleDelete = (id: number) => {
  dialog.warning({
    title: '确认删除',
    content: '确定要删除该版本记录吗？',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const response = await axios.delete(`/api/admin/versions/${id}`, {
          headers: getAuthHeaders(),
        });
        if (response.data.success) {
          message.success('删除成功');
          fetchVersions();
        }
      } catch (error) {
        message.error('删除失败');
      }
    },
  });
};

onMounted(() => {
  fetchVersions();
});
</script>

<style lang="scss" scoped>
.admin-versions {
  .publish-card {
    margin-bottom: 16px;
  }
}
</style>
