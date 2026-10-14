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
      <n-tag v-if="installType" :bordered="false" type="info" class="install-type">
        当前为{{ installType === "setup" ? "安装版" : "便携版" }}
      </n-tag>
    </n-flex>
    <n-scrollbar style="max-height: 500px">
      <div
        v-if="data?.description"
        class="markdown-body update-desc"
        v-html="renderedDescription"
      />
      <div v-else class="markdown-body">暂无更新说明</div>
    </n-scrollbar>
    <n-flex class="menu" justify="end">
      <n-button v-if="!data?.isForce" strong secondary @click="emit('close')"> 取消 </n-button>
      <n-button
        strong
        type="primary"
        :secondary="installType !== 'portable'"
        @click="goDownload(portableUrl)"
      >
        下载便携版
      </n-button>
      <n-button
        strong
        type="primary"
        :secondary="installType === 'portable'"
        @click="goDownload(setupUrl)"
      >
        下载安装版
      </n-button>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { marked } from "marked";
import type { UpdateInfoType } from "@/types/main";
import { isElectron } from "@/utils/env";
import packageJson from "@/../package.json";

const props = defineProps<{ data: UpdateInfoType }>();

const emit = defineEmits<{ close: [] }>();

// 当前安装类型，null 表示非 Electron 环境（Web）无法检测
const installType = ref<"setup" | "portable" | null>(null);

onMounted(async () => {
  if (isElectron) {
    try {
      installType.value = await window.api.system.getInstallType();
    } catch {
      installType.value = null;
    }
  }
});

// 渲染 Markdown 更新说明
const renderedDescription = computed(() => {
  if (!props.data?.description) return "";
  return marked.parse(props.data.description, { async: false }) as string;
});

// 依据构建产物命名规则推导两个版本的下发地址：安装版文件名在便携版基础上多 -setup 后缀
const isSetupUrl = (url: string): boolean => /-setup\.exe$/i.test(url);

const portableUrl = computed(() => {
  const url = props.data?.downloadUrl || "";
  if (!/\.exe$/i.test(url)) return url;
  return isSetupUrl(url) ? url.replace(/-setup(\.exe)$/i, "$1") : url;
});

const setupUrl = computed(() => {
  const url = props.data?.downloadUrl || "";
  if (!/\.exe$/i.test(url)) return url;
  return isSetupUrl(url) ? url : url.replace(/\.exe$/i, "-setup.exe");
});

// 前往下载指定版本
const goDownload = (url: string) => {
  if (!url) return;
  if (isElectron) {
    // Electron 环境：通过 IPC 打开系统浏览器
    window.electron.ipcRenderer.send("open-download-url", url);
  } else {
    // Web 环境：直接打开新窗口
    window.open(url, "_blank");
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
    .install-type {
      margin-left: auto;
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
  }
  .markdown-body {
    margin-top: 0 !important;
    font-size: 14px;
    line-height: 1.7;

    :deep(h1),
    :deep(h2),
    :deep(h3),
    :deep(h4) {
      margin-top: 12px;
      margin-bottom: 8px;
      font-weight: 600;
    }

    :deep(ul),
    :deep(ol) {
      padding-left: 20px;
      margin: 8px 0;
    }

    :deep(li) {
      margin: 4px 0;
    }

    :deep(p) {
      margin: 8px 0;
    }

    :deep(a) {
      color: var(--n-color-primary, #ff5a5f);
      text-decoration: none;
      &:hover {
        text-decoration: underline;
      }
    }

    :deep(code) {
      background: rgba(125, 125, 125, 0.1);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
    }
  }
}
</style>
