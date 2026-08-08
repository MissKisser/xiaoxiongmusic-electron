<!-- 外观主题设置（F1，借鉴 SPlayer-Next appearance 分类） -->
<template>
  <div class="setting-type">
    <div class="set-list">
      <n-h3 prefix="bar"> 主题设置 </n-h3>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">主题模式</n-text>
          <n-text class="tip" :depth="3">调整全局主题明暗模式</n-text>
        </div>
        <n-select
          v-model:value="settingStore.themeMode"
          class="set"
          :options="[
            {
              label: '跟随系统',
              value: 'auto',
            },
            {
              label: '浅色模式',
              value: 'light',
            },
            {
              label: '深色模式',
              value: 'dark',
            },
          ]"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">主题配置</n-text>
          <n-text class="tip" :depth="3">更改主题色或自定义图片</n-text>
        </div>
        <n-select
          v-model:value="settingStore.themeColorType"
          class="set"
          :disabled="settingStore.themeFollowCover"
          :options="themeColorOptions"
        />
      </n-card>
      <n-collapse-transition
        :show="settingStore.themeColorType === 'custom' && !settingStore.themeFollowCover"
      >
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">自定义主题色</n-text>
            <n-text class="tip" :depth="3">可在此处自定义全局主题色</n-text>
          </div>
          <n-color-picker
            v-model:value="settingStore.themeCustomColor"
            :show-alpha="false"
            :modes="['hex']"
            class="set"
          />
        </n-card>
      </n-collapse-transition>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">全局着色</n-text>
          <n-text class="tip" :depth="3">是否将主题色应用至所有元素</n-text>
        </div>
        <n-switch
          v-model:value="settingStore.themeGlobalColor"
          class="set"
          :round="false"
          @update:value="themeGlobalColorChange"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">全局动态取色</n-text>
          <n-text class="tip" :depth="3">主题色是否跟随封面，开启后自定义主题色将失效</n-text>
        </div>
        <n-switch
          v-model:value="settingStore.themeFollowCover"
          :disabled="isEmpty(statusStore.songCoverTheme)"
          class="set"
          :round="false"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">字体设置</n-text>
          <n-text class="tip" :depth="3"> 统一配置全局及歌词区域的字体 </n-text>
        </div>
        <n-button type="primary" strong secondary @click="openFontManager"> 配置 </n-button>
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">自定义代码注入</n-text>
          <n-text class="tip" :depth="3"> 注入自定义 CSS 和 JavaScript 代码 </n-text>
        </div>
        <n-button type="primary" strong secondary @click="openCustomCode"> 配置 </n-button>
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
import type { SelectOption } from "naive-ui";
import { useMusicStore, useSettingStore, useStatusStore } from "@/stores";
import { isEmpty } from "lodash-es";
import themeColor from "@/assets/data/themeColor.json";
import { openFontManager, openCustomCode } from "@/utils/modal";
import { getCoverColor } from "@/utils/color";

const settingStore = useSettingStore();
const statusStore = useStatusStore();
const musicStore = useMusicStore();

// 全局主题色配置
const themeColorOptions: SelectOption[] = [
  // { label: "关闭主题色", value: "close" },
  ...Object.keys(themeColor).map((key) => ({
    value: key,
    label: themeColor[key].name,
    style: {
      color: themeColor[key].color,
    },
  })),
];

// 全局着色更改
const themeGlobalColorChange = (val: boolean) => {
  if (val) getCoverColor(musicStore.songCover);
};
</script>
