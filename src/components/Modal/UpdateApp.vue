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
      <div
        v-if="data?.description"
        class="markdown-body update-desc"
        v-html="renderedDescription"
      />
      <div v-else class="markdown-body">暂无更新说明</div>
    </n-scrollbar>
    <n-flex class="menu" justify="end">
      <n-button v-if="!data?.isForce" strong secondary @click="handleClose">
        取消
      </n-button>
      <n-button
        v-if="!setupUrl && data?.downloadUrl"
        strong
        type="primary"
        @click="openExternal"
      >
        前往下载
      </n-button>
      <n-button
        v-else-if="setupUrl"
        strong
        type="primary"
        :loading="downloading"
        @click="startDownload"
      >
        下载安装版
      </n-button>
    </n-flex>
    <div v-if="downloading || progress" class="download-progress">
      <n-progress
        type="line"
        :percentage="progressPercent"
        :color="progressColor"
        :indicator-placement="'inside'"
        processing
      />
      <div class="download-meta">
        <span>{{ progressText }}</span>
        <n-button size="tiny" quaternary @click="cancelDownload">取消下载</n-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useThemeVars } from "naive-ui";
import type { InstallerDownloadProgress, UpdateInfoType } from "@/types/main";
import { isElectron } from "@/utils/env";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { pickSetupUrl } from "@/utils/updateAssets";
import { formatBytes } from "@/utils/installerDownload";
import packageJson from "@/../package.json";

const props = defineProps<{ data: UpdateInfoType }>();

const emit = defineEmits<{ close: [] }>();

/** 是否正在下载安装包 */
const downloading = ref(false);

/** 安装包下载进度 */
const progress = ref<InstallerDownloadProgress | null>(null);

/** naive-ui 主题变量 */
const themeVars = useThemeVars();

/**
 * 进度条填充色，跟随应用主题色（naive-ui 默认用 infoColor，与主色不一致）
 */
const progressColor = computed(() => themeVars.value.primaryColor);

/**
 * 渲染后的更新说明 HTML
 */
const renderedDescription = computed(() => {
  if (!props.data?.description) return "";
  return renderMarkdown(props.data.description);
});

/**
 * 安装版下载地址
 */
const setupUrl = computed(() =>
  pickSetupUrl(props.data?.assets, props.data?.downloadUrl)
);

/**
 * 下载进度百分比
 */
const progressPercent = computed(() =>
  Math.round((progress.value?.percent ?? 0) * 100)
);

/**
 * 下载进度文本
 */
const progressText = computed(() => {
  const current = progress.value;
  if (!current) return "正在准备下载…";
  const total = current.totalBytes
    ? ` / ${formatBytes(current.totalBytes)}`
    : "";
  const speed = current.speed > 0 ? ` · ${formatBytes(current.speed)}/s` : "";
  return `${formatBytes(current.transferredBytes)}${total}${speed}`;
});

/**
 * 接收主进程推送的安装包下载进度
 *
 * @param _event IPC 事件对象
 * @param payload 进度载荷
 */
const handleProgress = (
  _event: unknown,
  payload: InstallerDownloadProgress
): void => {
  progress.value = payload;
};

/**
 * 取消进行中的安装包下载
 */
const cancelDownload = (): void => {
  if (isElectron) {
    window.electron.ipcRenderer.send("cancel-installer-download");
  }
  downloading.value = false;
  progress.value = null;
};

/**
 * 关闭弹窗；下载进行中时先中止下载，避免弹窗已关仍在后台拉起安装器
 */
const handleClose = (): void => {
  if (downloading.value) {
    cancelDownload();
  }
  emit("close");
};

/**
 * 用系统浏览器打开外链地址
 */
const openExternal = (): void => {
  const url = props.data?.downloadUrl;
  if (!url) return;
  if (isElectron) {
    window.electron.ipcRenderer.send("open-download-url", url);
  } else {
    window.open(url, "_blank");
  }
  emit("close");
};

/**
 * 内置下载安装包，下载完成后由主进程直接拉起安装器
 */
const startDownload = async (): Promise<void> => {
  const url = setupUrl.value;
  if (!url) return;
  if (!isElectron) {
    window.open(url, "_blank");
    return;
  }
  downloading.value = true;
  progress.value = null;
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "download-installer",
      url
    );
    if (result?.status === "error") {
      downloading.value = false;
      progress.value = null;
      window.$message.error(result.message || "安装包下载失败");
    } else if (result?.status === "cancelled") {
      downloading.value = false;
      progress.value = null;
    }
  } catch {
    downloading.value = false;
    progress.value = null;
    window.$message.error("安装包下载失败，请稍后重试");
  }
};

onMounted(() => {
  if (isElectron) {
    window.electron.ipcRenderer.on(
      "installer-download-progress",
      handleProgress
    );
  }
});

onBeforeUnmount(() => {
  if (isElectron) {
    window.electron.ipcRenderer.removeListener(
      "installer-download-progress",
      handleProgress
    );
    if (downloading.value) {
      window.electron.ipcRenderer.send("cancel-installer-download");
    }
  }
});
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
  .download-progress {
    margin-top: 16px;
    .download-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 6px;
      font-size: 13px;
      color: var(--n-text-color-3, #999);
    }
  }
  .update-desc {
    margin-top: 0 !important;
    white-space: pre-wrap;
    word-break: break-word;
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
