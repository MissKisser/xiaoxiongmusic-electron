<template>
  <div class="discover">
    <!-- 标题 -->
    <div class="title">
      <n-text class="keyword">发现音乐</n-text>
    </div>
    <!-- 标签页 -->
    <n-tabs
      v-model:value="discoverType"
      class="tabs"
      type="segment"
      @update:value="(name: string) => router.push({ name })"
    >
      <n-tab v-for="tab in visibleTabs" :key="tab.name" :name="tab.name">
        {{ tab.label }}
      </n-tab>
    </n-tabs>
    <!-- 刷歌（QQ 音乐 / 酷狗音乐推荐流）：占据发现页内容区，仍保留站点导航上下文 -->
    <SongFM v-if="isSongFM" class="router-view song-fm" />
    <!-- 路由 -->
    <RouterView v-else v-slot="{ Component }">
      <Transition :name="`router-${settingStore.routeAnimation}`" mode="out-in">
        <KeepAlive v-if="settingStore.useKeepAlive">
          <component :is="Component" class="router-view" />
        </KeepAlive>
        <component v-else :is="Component" class="router-view" />
      </Transition>
    </RouterView>
  </div>
</template>

<script setup lang="ts">
import { onPlatformChange, usePlatformStore, useSettingStore } from "@/stores";
import { DISCOVER_TABS } from "@/api/platform/capability";
import SongFM from "@/views/PrivateFM/index.vue";

const router = useRouter();
const settingStore = useSettingStore();
const platformStore = usePlatformStore();

// 是否处于刷歌视图（菜单「刷歌」入口带 fm=song 参数进入）
// 刷歌是 QQ 音乐与酷狗音乐的推荐流能力，网易云沿用原有「私人漫游」流程，不渲染本页
const isSongFM = computed<boolean>(
  () =>
    router.currentRoute.value.query.fm === "song" &&
    (platformStore.currentPlatform === "qqmusic" || platformStore.currentPlatform === "kugou"),
);

/**
 * 刷歌视图的标签页选中项
 *
 * 刷歌是发现页的整页形态，不属于任何子页：标签页不高亮某个子页，
 * 这样从刷歌页点任意标签页都会真正跳转（高亮子页时点击不换值，点了没反应）。
 */
const SONG_FM_TYPE = "song-fm";

/** 当前应高亮的标签页 */
const resolveDiscoverType = (): string => {
  if (isSongFM.value) return SONG_FM_TYPE;
  const name = router.currentRoute.value?.name;
  return (typeof name === "string" && name) || "discover-playlists";
};

// 发现路由
const discoverType = ref<string>(resolveDiscoverType());

// 路由变化时同步标签高亮：平台切换、前进后退都会走到这里
watch(
  () => [router.currentRoute.value.name, router.currentRoute.value.query.fm],
  () => {
    discoverType.value = resolveDiscoverType();
  },
);

// 当前平台可见的子页（平台不支持的子页隐藏）
const visibleTabs = computed(() => DISCOVER_TABS[platformStore.currentPlatform] ?? []);

// 平台切换：当前所在子页在目标平台不可见时回到首个可见子页
const stopPlatformWatch = onPlatformChange(({ platform }) => {
  const name = router.currentRoute.value.name?.toString() ?? "";
  if (!name) return;
  // 刷歌视图整页替换发现页内容，不属于任何子页
  if (router.currentRoute.value.query.fm === "song") {
    // 刷歌是 QQ 音乐与酷狗音乐的能力，切回网易云后回到发现页
    if (platform === "netease") router.push({ name: "discover-playlists" });
    // 仍在第三方平台：留在刷歌页，推荐流由该页自行按新平台重取
    return;
  }
  if (visibleTabs.value.some((tab) => tab.name === name)) return;
  const fallback = visibleTabs.value[0];
  if (!fallback) return;
  router.push({ name: fallback.name });
});

onUnmounted(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.discover {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  .title {
    display: flex;
    align-items: flex-end;
    line-height: normal;
    margin-top: 12px;
    margin-bottom: 20px;
    height: 40px;
    flex-shrink: 0;
    .keyword {
      font-size: 30px;
      font-weight: bold;
      margin-right: 12px;
      line-height: normal;
    }
  }
  .tabs {
    flex-shrink: 0;
  }
  :deep(.router-view) {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
}
</style>
