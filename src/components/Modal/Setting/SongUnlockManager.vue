<template>
  <div class="song-unlock-manager">
    <n-alert title="免责声明" type="info">
      本功能仅作为测试使用，资源来自网络，若侵犯到您的权益，请及时联系我们删除
    </n-alert>
    <div ref="sortableRef" class="sortable-list">
      <n-card
        v-for="item in settingStore.songUnlockServer"
        :key="item.key"
        :content-style="{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '16px',
        }"
        class="sortable-item"
      >
        <SvgIcon :depth="3" name="Menu" />
        <n-text class="name">{{ sourceLabel(item.key) }}</n-text>
        <n-switch v-model:value="item.enabled" :round="false" />
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";
import { SongUnlockServer } from "@/types/shared";
import { useSortable, type UseSortableOptions } from "@vueuse/integrations/useSortable";

const settingStore = useSettingStore();

const sortableRef = ref<HTMLElement | null>(null);

/**
 * 各换源的用户可读名称
 *
 * 只描述来源与可用性，不暴露内部实现细节。
 */
const SOURCE_LABEL: Record<SongUnlockServer, string> = {
  [SongUnlockServer.NETEASE]: "网易云音乐（官方曲库）",
  [SongUnlockServer.BODIAN]: "波点音乐（第三方曲库）",
  [SongUnlockServer.KUWO]: "酷我音乐（第三方曲库）",
  [SongUnlockServer.MIGU]: "咪咕音乐（免费曲库）",
  [SongUnlockServer.CHANGQING]: "长青聚合（社区公益源，稳定性无保障）",
};

/**
 * 取换源的用户可读名称
 * @param key 换源标识
 * @returns 用户可读名称
 */
const sourceLabel = (key: SongUnlockServer): string => SOURCE_LABEL[key] ?? key;

// 拖拽（sortablejs 类型漂移导致选项字面量校验失败，运行时不受影响）
useSortable(sortableRef, settingStore.songUnlockServer, {
  animation: 150,
  handle: ".n-icon",
} as UseSortableOptions);
</script>

<style scoped lang="scss">
.sortable-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  .sortable-item {
    border-radius: 8px;
    .n-icon {
      font-size: 16px;
      cursor: move;
    }
    .name {
      font-size: 16px;
      line-height: normal;
    }
    .n-switch {
      margin-left: auto;
    }
  }
}
</style>
