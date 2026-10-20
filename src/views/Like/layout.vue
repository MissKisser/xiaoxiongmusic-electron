<template>
  <div class="like">
    <div class="title">
      <n-text class="keyword">我的收藏</n-text>
      <n-flex v-if="showStatus" class="status">
        <div
          v-for="(item, index) in likeData"
          :key="index"
          class="item"
          @click="router.push({ name: item.name })"
        >
          <SvgIcon :name="item.icon" :depth="3" />
          <n-number-animation :from="0" :to="item.length" />
        </div>
      </n-flex>
    </div>
    <!-- 标签页 -->
    <n-tabs
      v-if="showStatus"
      v-model:value="likeType"
      :type="isSmall ? 'line' : 'segment'"
      class="tabs"
      justify-content="space-evenly"
      @update:value="(name: string) => router.push({ name })"
    >
      <n-tab v-for="tab in visibleTabs" :key="tab.name" :name="tab.name">
        {{ tab.label }}
      </n-tab>
    </n-tabs>
    <!-- 路由 -->
    <RouterView v-slot="{ Component }">
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
import { useMobile } from "@/composables/useMobile";
import { onPlatformChange, useDataStore, usePlatformStore, useSettingStore } from "@/stores";
import { LIKE_TABS } from "@/api/platform/capability";

const router = useRouter();
const dataStore = useDataStore();
const platformStore = usePlatformStore();
const settingStore = useSettingStore();

const { isSmall } = useMobile();

const likeType = ref<string>((router.currentRoute.value?.name as string) || "like-playlists");

// 是否为第三方平台（QQ 音乐 / 酷狗）
const isPlatformSource = computed<boolean>(() => platformStore.currentPlatform !== "netease");

// 是否展示收藏统计与子页（第三方平台的收藏不受网易云登录方式影响）
const showStatus = computed<boolean>(() => isPlatformSource.value || dataStore.loginType !== "uid");

// 当前平台可见的子页（平台不支持的子页隐藏）
const visibleTabs = computed(() => LIKE_TABS[platformStore.currentPlatform] ?? []);

// 喜欢数据
const likeData = computed(() => {
  // 第三方平台：只有「收藏的歌单」有数据源，其余子页隐藏
  if (isPlatformSource.value) {
    return [
      {
        icon: "MusicList",
        name: "like-playlists",
        length: platformStore.playlists.favorites.length,
      },
    ];
  }
  return [
    {
      icon: "MusicList",
      name: "like-playlists",
      length: dataStore.userLikeData.playlists?.length || 0,
    },
    {
      icon: "Album",
      name: "like-albums",
      length: dataStore.userLikeData.albums?.length || 0,
    },
    {
      icon: "Artist",
      name: "like-artists",
      length: dataStore.userLikeData.artists?.length || 0,
    },
    {
      icon: "Video",
      name: "like-videos",
      length: dataStore.userLikeData.mvs?.length || 0,
    },
    {
      icon: "Record",
      name: "like-radios",
      length: dataStore.userLikeData.djs?.length || 0,
    },
  ];
});

// 监听路由变化
watch(
  () => router.currentRoute.value.name,
  (val) => {
    if (val && (val as string).startsWith("like-")) {
      likeType.value = val as string;
    }
  },
);

// 平台切换：当前所在子页在目标平台不可见时回到首个可见子页
const stopPlatformWatch = onPlatformChange(() => {
  const name = router.currentRoute.value.name?.toString() ?? "";
  if (!name) return;
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
.like {
  display: flex;
  flex-direction: column;
  .title {
    display: flex;
    align-items: flex-end;
    line-height: normal;
    margin-top: 12px;
    margin-bottom: 20px;
    height: 40px;
    .keyword {
      font-size: 30px;
      font-weight: bold;
      margin-right: 12px;
      line-height: normal;
    }
    .status {
      font-size: 15px;
      font-weight: normal;
      line-height: 30px;
      .item {
        display: flex;
        align-items: center;
        opacity: 0.9;
        cursor: pointer;
        .n-icon {
          margin-right: 4px;
        }
      }
    }
  }
  // 512px
  @media (max-width: 512px) {
    .status {
      display: none !important;
    }
  }
}
</style>
