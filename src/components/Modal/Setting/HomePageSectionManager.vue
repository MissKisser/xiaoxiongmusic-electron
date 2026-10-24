<template>
  <div class="home-page-section-manager">
    <n-card
      :content-style="{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '16px',
      }"
      class="greeting-item"
    >
      <n-text class="name">显示主页问好</n-text>
      <n-switch v-model:value="settingStore.showHomeGreeting" :round="false" />
    </n-card>
    <div ref="sortableRef" class="sortable-list">
      <n-card
        v-for="item in sections"
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
        <n-text class="name">{{ item.name }}</n-text>
        <n-switch v-model:value="item.visible" :round="false" />
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePlatformStore, useSettingStore } from "@/stores";
import { useSortable, type UseSortableOptions } from "@vueuse/integrations/useSortable";
import SvgIcon from "@/components/Global/SvgIcon.vue";

const settingStore = useSettingStore();
const platformStore = usePlatformStore();

const sortableRef = ref<HTMLElement | null>(null);

/**
 * 当前平台的首页栏目列表
 *
 * 网易云与第三方平台的首页栏目不是同一批（平台侧只有精选歌单），
 * 两批配置分开存放，按当前平台取用。
 */
const sections = computed(() =>
  platformStore.currentPlatform === "netease"
    ? settingStore.homePageSections
    : settingStore.platformHomeSections,
);

/** 排序实例的停止函数（切换平台后需按新列表重建） */
let stopSortable: (() => void) | undefined;

/** 首页栏目条目（两个平台的栏目表结构一致） */
type HomeSectionItem = {
  key: string;
  name: string;
  visible: boolean;
  order: number;
};

// 更新排序值
const updateSortOrder = () => {
  sections.value.forEach((item, index) => {
    item.order = index;
  });
};

/**
 * 按当前平台的栏目列表重建排序实例
 */
const setupSortable = () => {
  stopSortable?.();
  const list = sections.value as HomeSectionItem[];
  stopSortable = useSortable(sortableRef, list, {
    animation: 150,
    handle: ".n-icon",
    onEnd: updateSortOrder,
  } as UseSortableOptions).stop;
};

// 切换平台后按新列表重建排序
watch(
  () => platformStore.currentPlatform,
  () => {
    updateSortOrder();
    setupSortable();
  },
);

onMounted(() => {
  // 初始化排序值
  updateSortOrder();
  setupSortable();
});

onUnmounted(() => {
  stopSortable?.();
});
</script>

<style scoped lang="scss">
.greeting-item {
  border-radius: 8px;
  margin-bottom: 12px;
  .name {
    font-size: 16px;
    line-height: normal;
  }
  .n-switch {
    margin-left: auto;
  }
}
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
