<template>
  <div class="like-type">
    <!-- 分类 -->
    <n-flex v-if="!isPlatformSource" class="type">
      <n-tag
        v-for="(item, index) in plTypeName"
        :key="index"
        :bordered="plTypeChoose === index"
        :type="plTypeChoose === index ? 'primary' : 'default'"
        round
        @click="changeType(index)"
      >
        {{ item }}
      </n-tag>
    </n-flex>
    <Transition name="fade" mode="out-in">
      <CoverList :key="plTypeChoose" :data="listData" :loading="loading" type="playlist" />
    </Transition>
  </div>
</template>

<script setup lang="ts">
import type { CoverType } from "@/types/main";
import { onPlatformChange, useDataStore, usePlatformStore } from "@/stores";

const dataStore = useDataStore();
const platformStore = usePlatformStore();

// 是否为第三方平台（QQ 音乐 / 酷狗）
const isPlatformSource = computed<boolean>(() => platformStore.currentPlatform !== "netease");

// 加载状态
const loading = ref<boolean>(true);

// 歌单分类
const plTypeChoose = ref(0);
const plTypeName = ["我创建的", "我收藏的"];

// 歌单列表内容
const listData = computed<CoverType[]>(() => {
  // 第三方平台：展示当前平台收藏（订阅）的歌单
  if (isPlatformSource.value) {
    return platformStore.playlists.favorites.map((item) => ({
      id: item.id,
      name: item.name,
      cover: item.cover,
      coverSize: item.coverSize,
      count: item.count,
      playCount: item.playCount,
      description: item.description,
      creator: {
        id: 0,
        name: item.creatorName ?? "",
        avatarUrl: "",
      },
      createTime: item.createTime,
      updateTime: item.updateTime,
      platform: item.platform,
      platformId: item.platformId,
    }));
  }
  return (
    dataStore.userLikeData.playlists
      ?.filter((pl) =>
        plTypeChoose.value === 0
          ? pl.userId === dataStore.userData.userId
          : pl?.userId !== dataStore.userData.userId,
      )
      .slice(plTypeChoose.value === 0 ? 1 : 0) ?? []
  );
});

// 更换歌单类型
const changeType = (index: number) => (plTypeChoose.value = index);

// 平台切换：重新拉取当前平台的收藏歌单
const stopPlatformWatch = onPlatformChange(() => {
  loading.value = true;
  void platformStore.refreshPlaylists().finally(() => {
    loading.value = false;
  });
});

onMounted(() => {
  loading.value = false;
});

onUnmounted(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.type {
  margin-top: 20px;
  .n-tag {
    font-size: 14px;
    padding: 0 16px;
    &.choose {
      background-color: rgba(var(--primary), 0.14);
    }
  }
}
</style>
