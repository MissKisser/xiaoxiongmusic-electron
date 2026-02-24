<template>
  <n-config-provider :theme="darkTheme">
    <div class="admin-login">
      <!-- 动态背景 -->
      <div class="bg-animation"></div>
      
      <div class="login-container">
        <n-card class="login-card" :bordered="false">
          <div class="login-header">
            <div class="logo-area">
              <div class="logo-icon">🐻</div>
            </div>
            <h1>小熊音乐</h1>
            <p>管理控制台</p>
          </div>

          <n-form ref="formRef" :model="formData" :rules="rules" size="large">
            <n-form-item path="username" :show-label="false">
              <n-input
                v-model:value="formData.username"
                placeholder="管理员账号"
                class="custom-input"
              >
                <template #prefix>
                  <n-icon size="18" color="#808080">
                    <PersonOutline />
                  </n-icon>
                </template>
              </n-input>
            </n-form-item>
            
            <n-form-item path="password" :show-label="false">
              <n-input
                v-model:value="formData.password"
                type="password"
                placeholder="密码"
                show-password-on="click"
                class="custom-input"
                @keyup.enter="handleLogin"
              >
                <template #prefix>
                  <n-icon size="18" color="#808080">
                    <LockClosedOutline />
                  </n-icon>
                </template>
              </n-input>
            </n-form-item>

            <n-alert v-if="errorMessage" type="error" class="error-alert" :show-icon="false">
              {{ errorMessage }}
            </n-alert>

            <n-button
              type="primary"
              size="large"
              block
              :loading="isLoading"
              class="login-btn"
              @click="handleLogin"
            >
              登 录
            </n-button>
          </n-form>
        </n-card>
        
        <div class="login-footer">
          <span>&copy; {{ new Date().getFullYear() }} XiaoXiong Music Admin</span>
        </div>
      </div>
    </div>
  </n-config-provider>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import { darkTheme, NConfigProvider, NCard, NForm, NFormItem, NInput, NButton, NAlert, NIcon } from 'naive-ui';
import { PersonOutline, LockClosedOutline } from '@vicons/ionicons5';

const router = useRouter();
const formRef = ref();

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
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

.admin-login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #000;
  position: relative;
  overflow: hidden;
  font-family: 'Inter', sans-serif;
}

.bg-animation {
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle at center, #2c3e50 0%, #000 70%);
  opacity: 0.4;
  z-index: 1;
}

.login-container {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 420px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.login-card {
  width: 100%;
  background: rgba(30, 30, 30, 0.6) !important;
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 24px !important;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
  padding: 20px 10px;
}

.login-header {
  text-align: center;
  margin-bottom: 40px;

  .logo-area {
    width: 64px;
    height: 64px;
    background: linear-gradient(135deg, #42b983 0%, #35495e 100%);
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 20px;
    box-shadow: 0 10px 20px rgba(66, 185, 131, 0.2);
    
    .logo-icon {
      font-size: 32px;
    }
  }

  h1 {
    font-size: 28px;
    font-weight: 700;
    color: #fff;
    margin: 0 0 8px;
    letter-spacing: -0.5px;
  }

  p {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.4);
    margin: 0;
    font-weight: 500;
  }
}

.custom-input {
  background: rgba(0, 0, 0, 0.2) !important;
  border: 1px solid rgba(255, 255, 255, 0.05) !important;
  border-radius: 12px !important;
  transition: all 0.3s ease;
  
  &:hover, &:focus-within {
    border-color: rgba(66, 185, 131, 0.5) !important;
    background: rgba(0, 0, 0, 0.3) !important;
  }
  
  :deep(.n-input__input-el) {
    height: 48px;
    color: #fff;
  }
}

.login-btn {
  height: 50px;
  font-size: 16px;
  font-weight: 600;
  border-radius: 12px;
  background: linear-gradient(90deg, #42b983, #3eaf7c);
  border: none;
  margin-top: 20px;
  transition: all 0.3s ease;
  
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 20px rgba(66, 185, 131, 0.3);
  }
}

.error-alert {
  background: rgba(231, 76, 60, 0.1);
  border: 1px solid rgba(231, 76, 60, 0.2);
  color: #ff6b6b;
  border-radius: 8px;
  margin-bottom: 20px;
  text-align: center;
}

.login-footer {
  margin-top: 30px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.2);
}
</style>
