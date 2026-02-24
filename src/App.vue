<template>
  <Provider>
    <router-view />
    <GlobalAuthModal v-if="isElectron" />
  </Provider>
</template>

<script setup lang="ts">
import GlobalAuthModal from "@/components/Modal/GlobalAuthModal.vue";
import { useAuthStore } from "@/stores/auth";
import { isElectron } from "@/utils/env";
import { onMounted } from "vue";

// 仅 Electron 端需要授权验证
if (isElectron) {
  const authStore = useAuthStore();

  onMounted(() => {
    authStore.checkAuth();
  });
}
</script>
