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
    title="应用授权"
    style="width: 420px"
    :z-index="2100"
    @after-enter="focusInput"
  >
    <div class="auth-content">
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

// 控制显示
const showModal = computed(() => !authStore.isAuthorized);

// modal 出现后聚焦输入框
const focusInput = () => {
  nextTick(() => {
    inputRef.value?.focus();
  });
};

// 监听 store 的错误消息
watch(
  () => authStore.errorMessage,
  (msg) => {
    if (msg) {
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
