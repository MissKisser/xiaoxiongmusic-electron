<!-- 下载设置（F1，借鉴 SPlayer-Next download 分类） -->
<template>
  <div class="setting-type">
    <div class="set-list">
      <n-h3 prefix="bar"> 下载配置 </n-h3>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">默认下载目录</n-text>
          <n-text class="tip" :depth="3">
            {{ settingStore.downloadPath || "若不设置则无法进行下载" }}
          </n-text>
        </div>
        <n-flex>
          <Transition name="fade" mode="out-in">
            <n-button
              v-if="settingStore.downloadPath"
              type="primary"
              strong
              secondary
              @click="settingStore.downloadPath = ''"
            >
              清除选择
            </n-button>
          </Transition>
          <n-button strong secondary @click="choosePath">
            <template #icon>
              <SvgIcon name="Folder" />
            </template>
            更改
          </n-button>
        </n-flex>
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">默认下载音质</n-text>
          <n-text class="tip" :depth="3">
            默认使用的音质，实际可用音质取决于账号权限和歌曲资源
          </n-text>
        </div>
        <n-select
          v-model:value="settingStore.downloadSongLevel"
          :options="downloadQualityOptions"
          class="set"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">下载歌曲元信息</n-text>
          <n-text class="tip" :depth="3">为当前下载歌曲附加封面及歌词等元信息</n-text>
        </div>
        <n-switch class="set" v-model:value="settingStore.downloadMeta" :round="false" />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">同时下载封面</n-text>
          <n-text class="tip" :depth="3">下载歌曲时同时下载封面</n-text>
        </div>
        <n-switch
          v-model:value="settingStore.downloadCover"
          :disabled="!settingStore.downloadMeta"
          :round="false"
          class="set"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">同时下载歌词</n-text>
          <n-text class="tip" :depth="3">下载歌曲时同时下载歌词</n-text>
        </div>
        <n-switch
          v-model:value="settingStore.downloadLyric"
          :disabled="!settingStore.downloadMeta"
          :round="false"
          class="set"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">同时下载歌词翻译</n-text>
          <n-text class="tip" :depth="3">下载歌词时同时包含翻译</n-text>
        </div>
        <n-switch
          v-model:value="settingStore.downloadLyricTranslation"
          :disabled="!settingStore.downloadMeta || !settingStore.downloadLyric"
          :round="false"
          class="set"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">同时下载歌词音译</n-text>
          <n-text class="tip" :depth="3">下载歌词时同时包含音译（罗马音）</n-text>
        </div>
        <n-switch
          v-model:value="settingStore.downloadLyricRomaji"
          :disabled="!settingStore.downloadMeta || !settingStore.downloadLyric"
          :round="false"
          class="set"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">音乐命名格式</n-text>
          <n-text class="tip" :depth="3"> 选择下载文件的命名方式，建议包含歌手信息便于区分 </n-text>
        </div>
        <n-select
          v-model:value="settingStore.fileNameFormat"
          :options="fileNameFormatOptions"
          class="set"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">文件智能分类</n-text>
          <n-text class="tip" :depth="3"> 自动按歌手或歌手与专辑创建子文件夹进行分类 </n-text>
        </div>
        <n-select
          v-model:value="settingStore.folderStrategy"
          :options="folderStrategyOptions"
          class="set"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">
            模拟播放下载
            <n-tag type="warning" size="small" round>Beta</n-tag>
          </n-text>
          <n-text class="tip" :depth="3">使用播放接口进行下载，可能解决部分下载失败问题</n-text>
        </div>
        <n-switch
          :value="settingStore.usePlaybackForDownload"
          :round="false"
          class="set"
          @update:value="handlePlaybackDownloadChange"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">
            使用解锁接口下载
            <n-tag type="warning" size="small" round>Beta</n-tag>
          </n-text>
          <n-text class="tip" :depth="3">利用配置的解锁服务获取下载链接（优先于默认方式）</n-text>
        </div>
        <n-switch
          :value="settingStore.useUnlockForDownload"
          :round="false"
          class="set"
          @update:value="handleUnlockDownloadChange"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">
            下载时另存逐字歌词文件
            <n-tag type="warning" size="small" round>Beta</n-tag>
          </n-text>
          <n-text class="tip" :depth="3">在有条件时保存独立的 YRC/TTML 逐字歌词文件（源文件仍内嵌LRC）</n-text>
        </div>
        <n-switch
          v-model:value="settingStore.downloadMakeYrc"
          :disabled="!settingStore.downloadMeta || !settingStore.downloadLyric"
          :round="false"
          class="set"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">下载的歌词文件编码格式</n-text>
          <n-text class="tip" :depth="3">部分车载或老旧播放器可能仅支持 GBK 编码</n-text>
        </div>
        <n-select
          :value="settingStore.downloadLyricEncoding"
          :options="[
            { label: 'UTF-8', value: 'utf-8' },
            { label: 'GBK', value: 'gbk' },
            { label: 'UTF-16', value: 'utf-16' },
            { label: 'ISO-8859-1', value: 'iso-8859-1' },
          ]"
          class="set"
          @update:value="handleLyricEncodingChange"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">保留元信息文件</n-text>
          <n-text class="tip" :depth="3">是否在下载目录中保留元信息文件</n-text>
        </div>
        <n-switch
          v-model:value="settingStore.saveMetaFile"
          :disabled="!settingStore.downloadMeta"
          :round="false"
          class="set"
        />
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 */
import { useSettingStore } from "@/stores";
import { songLevelData, getSongLevelsData, AI_AUDIO_LEVELS } from "@/utils/meta";
import { pick } from "lodash-es";

const settingStore = useSettingStore();

// 默认下载音质选项
const downloadQualityOptions = computed(() => {
  const levels = pick(songLevelData, ["l", "m", "h", "sq", "hr", "je", "sk", "db", "jm"]);
  let allData = getSongLevelsData(levels);

  if (settingStore.disableAiAudio) {
    allData = allData.filter((item) => {
      if (item.level === "dolby") return true;
      return !AI_AUDIO_LEVELS.includes(item.level);
    });
  }

  return allData.map((item) => ({
    label: item.name,
    value: item.value,
  }));
});

const fileNameFormatOptions = [
  {
    label: "歌曲名",
    value: "title",
  },
  {
    label: "歌手 - 歌曲名",
    value: "artist-title",
  },
  {
    label: "歌曲名 - 歌手",
    value: "title-artist",
  },
];

const folderStrategyOptions = [
  {
    label: "不分文件夹",
    value: "none",
  },
  {
    label: "按歌手分文件夹",
    value: "artist",
  },
  {
    label: "按 歌手 \\ 专辑 分文件夹",
    value: "artist-album",
  },
];

// 选择下载路径
const choosePath = async () => {
  const path = await window.electron.ipcRenderer.invoke("choose-path");
  if (path) settingStore.downloadPath = path;
};

// 模拟播放下载开关
const handlePlaybackDownloadChange = (value: boolean) => {
  if (value) {
    window.$dialog.warning({
      title: "开启提示",
      content:
        "模拟播放下载可能导致部分音质歌词嵌入异常且未经完整测试可能有不稳定情况，确认要打开吗？",
      positiveText: "确认打开",
      negativeText: "取消",
      onPositiveClick: () => {
        settingStore.usePlaybackForDownload = true;
      },
    });
  } else {
    settingStore.usePlaybackForDownload = false;
  }
};

// 解锁接口下载开关
const handleUnlockDownloadChange = (value: boolean) => {
  if (value) {
    window.$dialog.warning({
      title: "开启提示",
      content: "开启此功能可能导致音质下降和与原曲不一致等情况，确认要打开吗？",
      positiveText: "确认打开",
      negativeText: "取消",
      onPositiveClick: () => {
        settingStore.useUnlockForDownload = true;
      },
    });
  } else {
    settingStore.useUnlockForDownload = false;
  }
};

// 歌词编码更改
const handleLyricEncodingChange = (value: "utf-8" | "gbk" | "utf-16" | "iso-8859-1") => {
  if (value === settingStore.downloadLyricEncoding) return;
  window.$dialog.warning({
    title: "更改编码提示",
    content: "请确保你的编码为相应编码再开启，改变编码可能导致文件播放乱码。确认要更改吗？",
    positiveText: "确认更改",
    negativeText: "取消",
    onPositiveClick: () => {
      settingStore.downloadLyricEncoding = value;
    },
  });
};
</script>
