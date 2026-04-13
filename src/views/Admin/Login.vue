<template>
  <n-config-provider :theme="isDark ? darkTheme : null">
    <div class="admin-login" :class="{ 'dark-mode': isDark }">
      <div class="login-container">
        <div class="login-header">
          <div class="logo">
            <n-icon size="32" :color="isDark ? '#3b82f6' : '#2563eb'">
              <MusicalNotesOutline />
            </n-icon>
          </div>
          <h1>小熊音乐</h1>
          <p class="subtitle">管理控制台</p>
        </div>

        <n-form ref="formRef" :model="formData" :rules="rules" size="large">
          <n-form-item path="username" :show-label="false">
            <n-input v-model:value="formData.username" placeholder="管理员账号">
              <template #prefix>
                <n-icon size="18"><PersonOutline /></n-icon>
              </template>
            </n-input>
          </n-form-item>

          <n-form-item path="password" :show-label="false">
            <n-input
              v-model:value="formData.password"
              type="password"
              placeholder="密码"
              show-password-on="click"
              @keyup.enter="handleLogin"
            >
              <template #prefix>
                <n-icon size="18"><LockClosedOutline /></n-icon>
              </template>
            </n-input>
          </n-form-item>

          <n-alert v-if="errorMessage" type="error" :show-icon="false">
            {{ errorMessage }}
          </n-alert>

          <n-button
            type="primary"
            size="large"
            block
            :loading="isLoading"
            @click="handleLogin"
          >
            登录
          </n-button>
        </n-form>

        <div class="login-footer">
          XiaoXiong Music Admin · {{ new Date().getFullYear() }}
        </div>
      </div>
    </div>
  </n-config-provider>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import { darkTheme, NConfigProvider, NForm, NFormItem, NInput, NButton, NAlert, NIcon } from 'naive-ui';
import { PersonOutline, LockClosedOutline, MusicalNotesOutline } from '@vicons/ionicons5';

const router = useRouter();
const formRef = ref();
const isDark = ref(false);

const formData = reactive({
  username: '',
  password: '',
});

const rules = {
  username: { required: true, message: '请输入管理员账号' },
  password: { required: true, message: '请输入密码' },
};

const isLoading = ref(false);
const errorMessage = ref('');

// 获取系统主题设置
onMounted(() => {
  isDark.value = localStorage.getItem('admin_theme') === 'dark';
});

const handleLogin = async () => {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }

  isLoading.value = true;
  errorMessage.value = '';

  try {
    const response = await axios.post('/api/admin/login', formData);

    if (response.data.success) {
      localStorage.setItem('admin_token', response.data.data.token);
      localStorage.setItem('admin_username', response.data.data.username);
      router.push('/bamger/dashboard');
    } else {
      errorMessage.value = response.data.message || '登录失败';
    }
  } catch (error: any) {
    if (error.response?.status === 401) {
      errorMessage.value = '账号或密码错误';
    } else {
      errorMessage.value = error.response?.data?.message || '无法连接到服务器';
    }
  } finally {
    isLoading.value = false;
  }
};
</script>

<style lang="scss" scoped>
.admin-login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f7;
  transition: background 0.3s;

  &.dark-mode {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f0f23 100%);
  }
}

.login-container {
  width: 100%;
  max-width: 380px;
  padding: 40px;
  background: #ffffff;
  border: 1px solid #e5e5e5;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
  transition: background 0.3s, border-color 0.3s, box-shadow 0.3s;

  .dark-mode & {
    background: rgba(30, 30, 46, 0.8);
    border-color: rgba(255, 255, 255, 0.06);
    box-shadow: none;
  }
}

.login-header {
  text-align: center;
  margin-bottom: 32px;

  .logo {
    width: 64px;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 16px;
    background: rgba(37, 99, 235, 0.08);
    border-radius: 16px;
    transition: background 0.3s;

    .dark-mode & {
      background: rgba(59, 130, 246, 0.1);
    }
  }

  h1 {
    font-size: 24px;
    font-weight: 600;
    color: #18181b;
    margin: 0 0 8px;
    .dark-mode & { color: #e4e4e7; }
  }

  .subtitle {
    font-size: 13px;
    color: #71717a;
    margin: 0;
  }
}

.login-footer {
  margin-top: 32px;
  text-align: center;
  font-size: 12px;
  color: #a1a1aa;
}

:deep(.n-input) {
  background: #f5f5f7 !important;
  transition: background 0.3s;

  .dark-mode & {
    background: rgba(39, 39, 42, 0.5) !important;
  }

  .n-input__input-el {
    color: #18181b;
    .dark-mode & { color: #e4e4e7; }
  }
}

:deep(.n-button--primary-type) {
  margin-top: 16px;
  background: #2563eb !important;

  &:hover {
    background: #1d4ed8 !important;
  }

  .dark-mode & {
    background: #3b82f6 !important;
    &:hover { background: #2563eb !important; }
  }
}

:deep(.n-alert--error-type) {
  margin-top: 16px;
  background: rgba(239, 68, 68, 0.08) !important;
  border-color: rgba(239, 68, 68, 0.2) !important;

  .dark-mode & {
    background: rgba(239, 68, 68, 0.1) !important;
  }
}
</style>