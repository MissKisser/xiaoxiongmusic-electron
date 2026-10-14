<template>
  <n-modal
    v-model:show="showModal"
    :mask-closable="false"
    :close-on-esc="false"
    :closable="false"
    :show-icon="false"
    :trap-focus="true"
    :auto-focus="true"
    preset="card"
    class="global-auth-modal"
    :title="modalTitle"
    style="width: 420px"
    :z-index="2100"
    @after-enter="focusInput"
  >
    <!-- 网络错误视图：服务器不可达时，弹此重试对话框，而非授权码输入框 -->
    <div v-if="authStore.networkError" class="auth-content">
      <div class="auth-icon auth-icon-warn">
        <SvgIcon name="Refresh" :size="48" />
      </div>

      <p class="auth-desc">无法连接到授权服务器，请检查网络后重试</p>

      <n-alert v-if="authStore.errorMessage" type="warning" :show-icon="true" class="error-alert">
        {{ authStore.errorMessage }}
      </n-alert>

      <n-button
        type="primary"
        size="large"
        block
        :loading="authStore.isChecking"
        class="auth-btn"
        @click="handleRetryCheck"
      >
        {{ authStore.isChecking ? "正在重试..." : "重新检查" }}
      </n-button>
    </div>

    <!-- 授权码输入视图：确认为"需要授权但未授权"时显示 -->
    <div v-else class="auth-content">
      <!-- 授权图标 -->
      <div class="auth-icon">
        <SvgIcon name="Lock" :size="48" />
      </div>

      <p class="auth-desc">请输入授权码以继续使用本应用</p>

      <n-input
        ref="inputRef"
        v-model:value="inputCode"
        placeholder="请输入授权码"
        size="large"
        :disabled="authStore.isChecking"
        class="auth-input"
        @keyup.enter="handleVerify"
      />

      <n-alert v-if="errorMessage" type="error" :show-icon="true" class="error-alert">
        {{ errorMessage }}
      </n-alert>

      <n-button
        type="primary"
        size="large"
        block
        :loading="authStore.isChecking"
        :disabled="!inputCode.trim()"
        class="auth-btn"
        @click="handleVerify"
      >
        {{ authStore.isChecking ? "验证中..." : "验证授权" }}
      </n-button>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { useAuthStore } from "@/stores/auth";
import type { InputInst } from "naive-ui";

const authStore = useAuthStore();

const inputCode = ref("");
const errorMessage = ref<string | null>(null);
const inputRef = ref<InputInst | null>(null);

// 三态控制：
//   - 开关关闭（authRequired=false）→ 永不弹窗
//   - 网络错误（networkError=true）→ 弹"重试"视图
//   - 确实未授权 → 弹授权码输入视图
// 已授权（isAuthorized=true）任意情况下都不弹窗
const showModal = computed(() => {
  if (authStore.isAuthorized) return false;
  if (!authStore.authRequired) return false;
  return true; // 网络错误 或 未授权 都弹窗，但视图不同
});

// 弹窗标题随状态切换
const modalTitle = computed(() => (authStore.networkError ? "网络异常" : "应用授权"));

// modal 出现后聚焦输入框（网络错误视图没有输入框，跳过）
const focusInput = () => {
  if (authStore.networkError) return;
  nextTick(() => {
    inputRef.value?.focus();
  });
};

// 切到网络错误视图时清空旧的授权码错误，避免视觉残留
watch(
  () => authStore.networkError,
  (isNetworkError) => {
    if (isNetworkError) errorMessage.value = null;
  },
);

// 监听 store 的错误消息，仅在授权码视图下透传到本地错误提示
// 网络错误视图直接读 authStore.errorMessage，无需本地副本
watch(
  () => authStore.errorMessage,
  (msg) => {
    if (msg && !authStore.networkError) {
      errorMessage.value = msg;
    }
  },
);

// 验证授权码
const handleVerify = async () => {
  if (!inputCode.value.trim()) return;

  errorMessage.value = null;
  const result = await authStore.verifyCode(inputCode.value);

  if (!result.success) {
    errorMessage.value = result.message;
  }
};

// 网络错误时的"重新检查"
const handleRetryCheck = async () => {
  errorMessage.value = null;
  await authStore.checkAuth();
};
</script>

<style lang="scss" scoped>
.auth-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;

  .auth-icon {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: var(--n-color-primary-suppl, rgba(255, 90, 95, 0.12));
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
  }

  // 网络错误视图的图标色调偏暖（提醒而非警告）
  .auth-icon-warn {
    background: rgba(255, 160, 67, 0.14);

    :deep(.n-icon) {
      color: #f0a043;
    }
  }

  .auth-desc {
    font-size: 14px;
    color: var(--n-text-color-2);
    margin-bottom: 20px;
    text-align: center;
    line-height: 1.6;
  }

  .auth-input {
    margin-bottom: 16px;
    width: 100%;
  }

  .error-alert {
    width: 100%;
    margin-bottom: 16px;
  }

  .auth-btn {
    margin-top: 8px;
    width: 100%;
  }
}
</style>

<style lang="scss">
/* 修复 Electron 生产构建中授权弹窗输入框无法聚焦的问题 */
/* n-modal 通过 teleport 渲染到 body，必须用非 scoped 样式 */
.global-auth-modal {
  -webkit-app-region: no-drag;
}
</style>
