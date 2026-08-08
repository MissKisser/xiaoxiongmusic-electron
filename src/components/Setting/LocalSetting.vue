<!-- 本地设置 -->
<template>
  <div class="setting-type">
    <div class="set-list">
      <n-h3 prefix="bar"> 本地歌曲 </n-h3>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">显示本地歌曲封面</n-text>
          <n-text class="tip" :depth="3">当数量过多时请勿开启，会严重影响性能</n-text>
        </div>
        <n-switch class="set" v-model:value="settingStore.showLocalCover" :round="false" />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">本地文件夹显示模式</n-text>
          <n-text class="tip" :depth="3">选择本地音乐页面文件夹的显示方式</n-text>
        </div>
        <n-select
          class="set"
          v-model:value="settingStore.localFolderDisplayMode"
          :options="[
            { label: '标签页模式', value: 'tab' },
            { label: '下拉筛选模式', value: 'dropdown' },
          ]"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">显示本地默认歌曲目录</n-text>
        </div>
        <n-switch class="set" v-model:value="settingStore.showDefaultLocalPath" :round="false" />
      </n-card>
      <n-card class="set-item" id="local-list-choose" content-style="flex-direction: column">
        <n-flex justify="space-between">
          <div class="label">
            <n-text class="name">本地歌曲目录</n-text>
            <n-text class="tip" :depth="3">可在此增删本地歌曲目录，歌曲增删实时同步</n-text>
          </div>
          <n-button strong secondary @click="changeLocalMusicPath()">
            <template #icon>
              <SvgIcon name="Folder" />
            </template>
            添加
          </n-button>
        </n-flex>
        <n-collapse-transition :show="settingStore.localFilesPath.length > 0">
          <n-card
            v-for="(item, index) in settingStore.localFilesPath"
            :key="index"
            class="set-item"
            content-style="padding: 4px 16px"
          >
            <div class="label">
              <n-text class="name">{{ item }}</n-text>
            </div>
            <n-button strong secondary @click="changeLocalMusicPath(index)">
              <template #icon>
                <SvgIcon name="Delete" />
              </template>
            </n-button>
          </n-card>
        </n-collapse-transition>
      </n-card>
      <n-card class="set-item" id="local-list-choose" content-style="flex-direction: column">
        <n-flex justify="space-between">
          <div class="label">
            <n-text class="name">本地歌词覆盖在线歌词</n-text>
            <n-text class="tip" :depth="3">
              可在这些文件夹及其子文件夹内覆盖在线歌曲的歌词 <br />
              将歌词文件命名为 `歌曲ID.后缀名` 或者 `任意前缀.歌曲ID.后缀名` 即可 <br />
              支持 .lrc 和 .ttml 格式 <br />
              （提示：可以在前缀加上歌名等信息，也可以利用子文件夹分类管理）
            </n-text>
          </div>
          <n-button strong secondary @click="changeLocalLyricPath()">
            <template #icon>
              <SvgIcon name="Folder" />
            </template>
            添加
          </n-button>
        </n-flex>
        <n-collapse-transition :show="settingStore.localLyricPath.length > 0">
          <n-card
            v-for="(item, index) in settingStore.localLyricPath"
            :key="index"
            class="set-item"
            content-style="padding: 4px 16px"
          >
            <div class="label">
              <n-text class="name">{{ item }}</n-text>
            </div>
            <n-button strong secondary @click="changeLocalLyricPath(index)">
              <template #icon>
                <SvgIcon name="Delete" />
              </template>
            </n-button>
          </n-card>
        </n-collapse-transition>
      </n-card>
    </div>
    <div class="set-list">
      <n-h3 prefix="bar"> 缓存配置 </n-h3>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">启用缓存</n-text>
          <n-text class="tip" :depth="3">开启缓存会加快资源加载速度，但会占用更多磁盘空间</n-text>
        </div>
        <n-switch class="set" v-model:value="settingStore.cacheEnabled" :round="false" />
      </n-card>
      <n-collapse-transition :show="settingStore.cacheEnabled">
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">缓存歌曲</n-text>
            <n-text class="tip" :depth="3">是否缓存歌曲音频，关闭后可节省缓存空间</n-text>
          </div>
          <n-switch class="set" v-model:value="settingStore.songCacheEnabled" :round="false" />
        </n-card>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">缓存大小上限</n-text>
            <n-text class="tip" :depth="3">达到上限后将清理最旧的缓存，可以是小数，最低 2GB</n-text>
          </div>
          <n-input-group class="set">
            <n-input-number
              :value="cacheLimit"
              :update-value-on-input="false"
              :min="2"
              :max="9999"
              :style="{
                width: cacheLimited ? '55%' : '0%',
                transition: 'width 0.3s',
              }"
              @update:value="
                (value) => {
                  cacheLimit = value ?? 2;
                  changeCacheLimit(cacheLimit);
                }
              "
            />
            <n-select
              v-model:value="cacheLimited"
              :options="[
                { label: '不限制', value: 0 },
                { label: cacheLimited === 0 ? '自定义大小 (GB)' : 'GB', value: 1 },
              ]"
              :style="{
                width: cacheLimited ? '45%' : '100%',
                transition: 'width 0.3s',
              }"
              @update:value="
                (value) => {
                  if (value === 0) {
                    changeCacheLimit(0);
                  } else {
                    if (cacheLimit === 0) cacheLimit = 2;
                    changeCacheLimit(cacheLimit);
                  }
                }
              "
            />
          </n-input-group>
        </n-card>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">缓存目录</n-text>
            <n-text class="tip" :depth="3">
              {{ cachePath || "未配置时将使用默认缓存目录" }}
            </n-text>
          </div>
          <n-flex>
            <n-button strong secondary @click="confirmChangeCachePath">
              <template #icon>
                <SvgIcon name="Folder" />
              </template>
              更改
            </n-button>
          </n-flex>
        </n-card>
      </n-collapse-transition>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">缓存占用与清理</n-text>
          <n-text class="tip" :depth="3">当前缓存占用：{{ cacheSizeDisplay }}</n-text>
        </div>
        <n-button type="error" strong secondary @click="confirmClearCache"> 清空缓存 </n-button>
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
import { changeLocalLyricPath, changeLocalMusicPath, formatFileSize } from "@/utils/helper";
import { useCacheManager } from "@/core/resource/CacheManager";

const settingStore = useSettingStore();
const cacheManager = useCacheManager();

const cachePath = ref<string>("");
const cacheSizeDisplay = ref<string>("--");
const cacheLimit = ref<number>(10); // 本地状态
const cacheLimited = ref<number>(1); // 是否限制缓存 (1 为限制)

// 选择缓存路径并写回主进程 Store
const changeCachePath = async () => {
  const path = await window.electron.ipcRenderer.invoke("choose-path");
  if (path) {
    cachePath.value = path;
    await window.api.store.set("cachePath", path);
  }
};

// 确认更改缓存目录
const confirmChangeCachePath = () => {
  window.$dialog.warning({
    title: "更改缓存目录",
    content: "更改缓存目录不会自动移动已有缓存文件，建议在清空缓存后再更改目录。确定要继续吗？",
    positiveText: "确定更改",
    negativeText: "取消",
    onPositiveClick: () => {
      return changeCachePath();
    },
  });
};

// 更改缓存大小限制
const changeCacheLimit = async (value: number) => {
  await window.api.store.set("cacheLimit", value);
};

// 统计全部缓存目录占用大小
const loadCacheSize = async () => {
  const res = await cacheManager.getSize();
  if (res.success && res.data !== undefined) {
    cacheSizeDisplay.value = formatFileSize(res.data);
  } else {
    cacheSizeDisplay.value = "--";
  }
};

// 清空所有缓存目录
const clearCache = async () => {
  const res = await cacheManager.clearAll();
  await loadCacheSize();
  if (!res.success) {
    window.$message.error("缓存清理失败: " + (res.message || "未知错误"));
  } else {
    window.$message.success("缓存已清空");
  }
};

// 确认清空缓存
const confirmClearCache = () => {
  window.$dialog.warning({
    title: "清空缓存",
    content: "将删除所有缓存的音乐、歌词和本地数据，此操作不可恢复，确定要继续吗？",
    positiveText: "清空缓存",
    negativeText: "取消",
    onPositiveClick: () => {
      return clearCache();
    },
  });
};

onMounted(async () => {
  try {
    const path = await window.api.store.get("cachePath");
    cachePath.value = path || "";
    const limit = await window.api.store.get("cacheLimit");
    if (typeof limit === "number") {
      cacheLimit.value = limit;
      if (limit === 0) cacheLimited.value = 0;
    }
  } catch (error) {
    console.error("读取缓存路径失败:", error);
  }
  await loadCacheSize();
});
</script>

<style lang="scss" scoped>
#local-list-choose {
  .n-flex {
    width: 100%;
  }
  .n-collapse-transition {
    margin-top: 12px;
  }
}
</style>
