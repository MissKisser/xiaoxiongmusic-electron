<!-- 专辑列表 -->
<template>
  <div class="album-list">
    <ListDetail
      :detail-data="isCurrentAlbum ? detailData : null"
      :list-data="isCurrentAlbum ? listData : []"
      :loading="showLoading"
      :list-scrolling="listScrolling"
      :search-value="searchValue"
      :config="listConfig"
      :play-button-text="playButtonText"
      :more-options="moreOptions"
      :hide-comment-tab="isPlatformSource"
      @update:search-value="handleSearchUpdate"
      @play-all="playAllSongs"
      @tab-change="handleTabChange"
    >
      <template #action-buttons>
        <n-button
          v-if="!isPlatformSource"
          :focusable="false"
          strong
          secondary
          round
          @click="toLikeAlbum(Number(albumId), !isLikeAlbum)"
        >
          <template #icon>
            <SvgIcon :name="isLikeAlbum ? 'Favorite' : 'FavoriteBorder'" />
          </template>
          {{ isLikeAlbum ? "取消收藏" : "收藏专辑" }}
        </n-button>
      </template>
    </ListDetail>
    <Transition name="fade" mode="out-in">
      <!-- 歌曲列表 -->
      <template v-if="currentTab === 'songs'">
        <SongList
          v-if="!searchValue || searchData?.length"
          :data="isCurrentAlbum ? displayData : []"
          :loading="loading"
          :height="songListHeight"
          :doubleClickAction="searchData?.length ? 'add' : 'all'"
          hidden-album
          @scroll="handleListScroll"
        />
        <n-empty
          v-else
          :description="`搜不到关于 ${searchValue} 的任何歌曲呀`"
          style="margin-top: 60px"
          size="large"
        >
          <template #icon>
            <SvgIcon name="SearchOff" />
          </template>
        </n-empty>
      </template>
      <!-- 评论 -->
      <template v-else>
        <ListComment :id="Number(albumId)" :type="3" :height="songListHeight" />
      </template>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import type { DropdownOption } from "naive-ui";
import type { ApiPlatform } from "@/types/shared";
import { songDetail } from "@/api/song";
import { albumDetail } from "@/api/album";
import { dispatchAlbumDetail } from "@/api/platform/dispatch";
import { formatCoverList, formatSongsList } from "@/utils/format";
import { renderIcon, copyData } from "@/utils/helper";
import { openBatchList } from "@/utils/modal";
import { onPlatformChange, useDataStore } from "@/stores";
import { toLikeAlbum } from "@/utils/auth";
import { useListDetail } from "@/composables/List/useListDetail";
import { useListSearch } from "@/composables/List/useListSearch";
import { useListScroll } from "@/composables/List/useListScroll";
import { useListActions } from "@/composables/List/useListActions";
import { useListDataCache, type ListCacheData } from "@/composables/List/useListDataCache";
import ListComment from "@/components/List/ListComment.vue";

const router = useRouter();
const dataStore = useDataStore();

const { saveCache, loadCache, checkNeedsUpdate } = useListDataCache();

// 是否激活
const isActivated = ref<boolean>(false);

const {
  detailData,
  listData,
  loading,
  getSongListHeight,
  resetData,
  setDetailData,
  setListData,
  setLoading,
} = useListDetail();
const { searchValue, searchData, displayData, clearSearch, performSearch } =
  useListSearch(listData);
const { listScrolling, handleListScroll, resetScroll } = useListScroll();
const { playAllSongs: playAllSongsAction } = useListActions();

// 专辑 ID（网易云为数字 id，第三方平台为平台主键）
const albumId = computed<string>(() => String(router.currentRoute.value.query.id ?? ""));

// 路由指定的音源平台（第三方平台专辑带 platform 参数，网易云原路径不带）
const routePlatform = computed<ApiPlatform | null>(() => {
  const platform = router.currentRoute.value.query.platform as string | undefined;
  return platform === "qqmusic" || platform === "kugou" ? platform : null;
});

// 是否为第三方平台（QQ 音乐 / 酷狗）
const isPlatformSource = computed<boolean>(() => routePlatform.value !== null);

// 当前详情是否属于路由上的专辑
const isCurrentAlbum = computed<boolean>(
  () => !!detailData.value && String(detailData.value.id) === albumId.value,
);

// 当前正在请求的专辑 ID，用于防止竞态条件
const currentRequestId = ref<string>("");

// 是否处于收藏专辑
const isLikeAlbum = computed(() =>
  dataStore.userLikeData.albums.some((album) => album.id === detailData.value?.id),
);

// 列表高度
const songListHeight = computed(() => getSongListHeight(listScrolling.value));

// 当前 tab
const currentTab = ref<"songs" | "comments">("songs");

// 列表配置
const listConfig = {
  titleType: "ellipsis" as const,
  showCoverMask: false,
  showPlayCount: false,
  showArtist: true,
  showCreator: false,
  showCount: true,
};

// 是否显示加载状态
const showLoading = computed(() => listData.value.length === 0 && loading.value);

// 播放按钮文本
const playButtonText = computed(() => {
  if (showLoading.value) {
    return "加载中...";
  }
  return "播放";
});

// 更多操作
const moreOptions = computed<DropdownOption[]>(() => {
  // 第三方平台：只保留刷新与批量操作，网易云专属的分享 / 源页面链接不适用
  if (isPlatformSource.value) {
    return [
      {
        label: "刷新缓存",
        key: "refresh",
        props: {
          onClick: () => getAlbumDetail(albumId.value, true),
        },
        icon: renderIcon("Refresh"),
      },
      {
        label: "批量操作",
        key: "batch",
        props: {
          onClick: () => openBatchList(displayData.value, false),
        },
        icon: renderIcon("Batch"),
      },
    ];
  }
  return [
    {
      label: "刷新缓存",
      key: "refresh",
      props: {
        onClick: () => getAlbumDetail(albumId.value, true),
      },
      icon: renderIcon("Refresh"),
    },
    {
      label: "批量操作",
      key: "batch",
      props: {
        onClick: () => {
          openBatchList(
            displayData.value,
            false,
            isLikeAlbum.value ? Number(albumId.value) : undefined,
          );
        },
      },
      icon: renderIcon("Batch"),
    },
    {
      label: "复制分享链接",
      key: "copy",
      props: {
        onClick: () =>
          copyData(`https://music.163.com/#/album?id=${albumId.value}`, "已复制分享链接到剪贴板"),
      },
      icon: renderIcon("Share"),
    },
    {
      label: "打开源页面",
      key: "open",
      props: {
        onClick: () => {
          window.open(`https://music.163.com/#/album?id=${albumId.value}`);
        },
      },
      icon: renderIcon("Link"),
    },
  ];
});

// 获取专辑基础信息
const getAlbumDetail = async (id: string, refresh: boolean = false) => {
  if (!id) return;
  // 设置当前请求的专辑 ID，用于防止竞态条件
  currentRequestId.value = id;
  setLoading(true);
  clearSearch();

  // 第三方平台：走平台数据层
  if (routePlatform.value) {
    try {
      const result = await dispatchAlbumDetail(routePlatform.value, id);
      if (currentRequestId.value !== id) return;
      setDetailData(result.detail);
      setListData(result.tracks);
    } catch (error) {
      console.error("获取平台专辑失败：", error);
      window.$message.error("获取专辑失败，请重试");
    }
    setLoading(false);
    return;
  }

  const albumNum = Number(id);
  // 1. 尝试读取缓存
  if (!refresh) {
    const cached = await loadCache("album", albumNum);
    if (cached) {
      setDetailData(cached.detail);
      setListData(cached.songs);
      setLoading(false);

      // 后台检查更新
      backgroundCheck(albumNum, cached);
      return;
    }
  }

  if (!refresh && detailData.value?.id !== albumNum) {
    resetData(true);
  }
  // 获取专辑详情
  const detail = await albumDetail(albumNum);
  // 检查是否仍然是当前请求的专辑
  if (currentRequestId.value !== id) return;
  setDetailData(formatCoverList(detail.album)[0]);
  // 获取专辑歌曲
  const ids: number[] = detail.songs.map((song: any) => song.id as number);
  const result = await songDetail(ids);
  // 再次检查是否仍然是当前请求的专辑
  if (currentRequestId.value !== id) return;
  const songs = formatSongsList(result.songs);
  setListData(songs);

  // 保存缓存
  saveCache("album", albumNum, detailData.value!, songs);

  setLoading(false);
};

// 后台检查更新
const backgroundCheck = async (id: number, cached: ListCacheData) => {
  try {
    const detail = await albumDetail(id);
    // 检查是否仍然是当前请求的专辑
    if (currentRequestId.value !== String(id)) return;

    const latestDetail = formatCoverList(detail.album)[0];

    if (checkNeedsUpdate(cached, latestDetail)) {
      console.log("Album cache expired, refreshing...");
      getAlbumDetail(String(id), true);
    }
  } catch (e) {
    console.error("Album background check failed", e);
  }
};

// 处理搜索更新
const handleSearchUpdate = (val: string) => {
  searchValue.value = val;
  performSearch(val);
};

// 处理 tab 切换
const handleTabChange = (value: "songs" | "comments") => {
  currentTab.value = value;
};

// 播放全部歌曲
const playAllSongs = useDebounceFn(() => {
  if (!detailData.value || !listData.value?.length) return;
  playAllSongsAction(listData.value);
}, 300);

onBeforeRouteUpdate((to) => {
  clearSearch();
  const id = String(to.query.id ?? "");
  if (id) getAlbumDetail(id);
});

onActivated(() => {
  if (!isActivated.value) {
    isActivated.value = true;
  } else {
    getAlbumDetail(albumId.value, false);
  }
});

onDeactivated(() => {
  resetScroll();
});

onMounted(() => {
  getAlbumDetail(albumId.value);
});

// 平台切换：重新拉取专辑详情
const stopPlatformWatch = onPlatformChange(() => {
  getAlbumDetail(albumId.value, true);
});

onUnmounted(() => {
  stopPlatformWatch();
});
</script>
