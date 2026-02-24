<template>
  <div class="update-app">
    <n-flex :size="10" class="version" align="center">
      <n-tag :bordered="false" type="primary">
        {{ packageJson?.version || "v0.0.0" }}
      </n-tag>
      <SvgIcon name="Right" />
      <n-tag :bordered="false" type="warning">
        {{ data?.version || "v0.0.0" }}
      </n-tag>
    </n-flex>
    <n-scrollbar style="max-height: 500px">
      <div v-if="data?.description" class="markdown-body update-desc">
        {{ data.description }}
      </div>
      <div v-else class="markdown-body">暂无更新说明</div>
    </n-scrollbar>
    <n-flex class="menu" justify="end">
      <n-button v-if="!data?.isForce" strong secondary @click="emit('close')"> 取消 </n-button>
      <n-button type="primary" strong secondary @click="goDownload"> 前往下载 </n-button>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import type { UpdateInfoType } from "@/types/main";
import { isElectron } from "@/utils/env";
import packageJson from "@/../package.json";

const props = defineProps<{ data: UpdateInfoType }>();

const emit = defineEmits<{ close: [] }>();

// 前往下载
const goDownload = () => {
  const downloadUrl = props.data?.downloadUrl;
  if (downloadUrl) {
    if (isElectron) {
      // Electron 环境：通过 IPC 打开系统浏览器
      window.electron.ipcRenderer.send("open-download-url", downloadUrl);
    } else {
      // Web 环境：直接打开新窗口
      window.open(downloadUrl, "_blank");
    }
  }
  emit("close");
};
</script>

<style lang="scss" scoped>
.update-app {
  .version {
    margin-bottom: 20px;
    .n-tag {
      border-radius: 6px;
    }
    .time {
      margin-left: auto;
      font-size: 13px;
    }
  }
  .menu {
    margin-top: 20px;
  }
  .update-desc {
    margin-top: 0 !important;
    white-space: pre-wrap;
  }
  .markdown-body {
    margin-top: 0 !important;
  }
}
</style>
