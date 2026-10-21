<!-- 歌单列表 -->
<template>
  <div class="liked-list">
    <ListDetail
      :detail-data="detailData"
      :list-data="listData"
      :loading="showLoading"
      :list-scrolling="listScrolling"
      :search-value="searchValue"
      :config="listConfig"
      :play-button-text="playButtonText"
      :more-options="moreOptions"
      title-text="我喜欢的音乐"
      hide-comment-tab
      @update:search-value="handleSearchUpdate"
      @play-all="playAllSongs"
    />
    <Transition name="fade" mode="out-in">
      <SongList
        v-if="!searchValue || searchData?.length"
        :data="displayData"
        :loading="loading"
        :height="songListHeight"
        :playListId="listPlayListId"
        :doubleClickAction="searchData?.length ? 'add' : 'all'"
        @scroll="handleListScroll"
        @removeSong="removeSong"
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
    </Transition>
  </div>
</template>

<script setup lang="ts">
import type { DropdownOption, MessageReactive } from "naive-ui";
import type { CoverType, SongType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import { songDetail } from "@/api/song";
import { playlistAllSongs } from "@/api/playlist";
import { dispatchLikedSongs, dispatchPlaylistDetail } from "@/api/platform/dispatch";
import { formatSongsList } from "@/utils/format";
import { renderIcon, copyData } from "@/utils/helper";
import { isObject, uniqBy } from "lodash-es";
import { useDataStore, usePlatformStore, onPlatformChange } from "@/stores";
import { openBatchList, openUpdatePlaylist } from "@/utils/modal";
import { isLogin, updateUserLikePlaylist } from "@/utils/auth";
import { useListDetail } from "@/composables/List/useListDetail";
import { useListSearch } from "@/composables/List/useListSearch";
import { useListScroll } from "@/composables/List/useListScroll";
import { useListActions } from "@/composables/List/useListActions";

const router = useRouter();
const dataStore = useDataStore();
const platformStore = usePlatformStore();

// 是否激活
const isActivated = ref<boolean>(false);

const { detailData, listData, loading, getSongListHeight, setDetailData, setListData, setLoading } =
  useListDetail();
const { searchValue, searchData, displayData, clearSearch, performSearch } =
  useListSearch(listData);
const { listScrolling, handleListScroll, resetScroll } = useListScroll();
const { playAllSongs: playAllSongsAction } = useListActions();

// 歌单 ID
const playlistId = computed<number>(() => Number(dataStore.userLikeData.playlists?.[0]?.id) || 0);

// 是否为第三方平台（QQ 音乐 / 酷狗）
const isPlatformSource = computed<boolean>(() => platformStore.currentPlatform !== "netease");

// 播放列表标识（平台歌单不参与网易云歌单写操作）
const listPlayListId = computed<number>(() => (isPlatformSource.value ? 0 : playlistId.value));

// 当前正在请求的歌单 ID，用于防止竞态条件
const currentRequestId = ref<number>(0);

// 第三方平台列表的请求序号，用于防止竞态条件
const platformRequestId = ref<number>(0);

// 加载提示
const loadingMsg = ref<MessageReactive | null>(null);

// 列表高度
const songListHeight = computed(() => getSongListHeight(listScrolling.value));

// 是否处于我喜欢页面
const isLikedPage = computed(() => router.currentRoute.value.name === "like-songs");

// 列表配置
const listConfig = {
  titleType: "normal" as const,
  showCoverMask: true,
  showPlayCount: true,
  showArtist: false,
  showCreator: true,
  showCount: false,
  searchAlign: "center" as const,
};

// 是否显示加载状态
const showLoading = computed(() => listData.value.length === 0 && loading.value);

// 播放按钮文本
const playButtonText = computed(() => {
  if (showLoading.value) {
    const loaded =
      listData.value.length === (detailData.value?.count || 0) ? 0 : listData.value.length;
    return `正在更新... (${loaded}/${detailData.value?.count || 0})`;
  }
  return "播放";
});

// 更多操作
const moreOptions = computed<DropdownOption[]>(() => {
  // 第三方平台：仅保留刷新与批量操作，其余为网易云专有写操作
  if (isPlatformSource.value) {
    return [
      {
        label: "刷新缓存",
        key: "refresh",
        props: {
          onClick: () => getPlatformLikedSongs(true),
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
        onClick: () => getPlaylistDetail(playlistId.value, { getList: true, refresh: true }),
      },
      icon: renderIcon("Refresh"),
    },
    {
      label: "编辑歌单",
      key: "edit",
      props: {
        onClick: () => {
          if (!detailData.value || !playlistId.value) return;
          openUpdatePlaylist(playlistId.value, detailData.value, () =>
            getPlaylistDetail(playlistId.value, { getList: false, refresh: false }),
          );
        },
      },
      icon: renderIcon("EditNote"),
    },
    {
      label: "批量操作",
      key: "batch",
      props: {
        onClick: () => openBatchList(displayData.value, false, playlistId.value),
      },
      icon: renderIcon("Batch"),
    },
    {
      label: "复制分享链接",
      key: "copy",
      props: {
        onClick: () =>
          copyData(
            `https://music.163.com/#/playlist?id=${playlistId.value}`,
            "已复制分享链接到剪贴板",
          ),
      },
      icon: renderIcon("Share"),
    },
    {
      label: "打开源页面",
      key: "open",
      props: {
        onClick: () => {
          window.open(`https://music.163.com/#/playlist?id=${playlistId.value}`);
        },
      },
      icon: renderIcon("Link"),
    },
  ];
});

// 获取歌单基础信息
const getPlaylistDetail = async (
  id: number,
  options: {
    getList: boolean;
    refresh: boolean;
  } = {
    getList: true,
    refresh: false,
  },
) => {
  if (!id) return;
  // 设置当前请求的歌单 ID，用于防止竞态条件
  currentRequestId.value = id;
  // 设置加载状态
  setLoading(true);
  const { getList, refresh } = options;
  // 清空数据
  clearSearch();
  if (!refresh) resetPlaylistData(getList);
  // 获取歌单内容
  getPlaylistData(id, getList, refresh);
};

// 重置歌单数据
const resetPlaylistData = (getList: boolean) => {
  setDetailData(null);
  if (getList) {
    setListData([]);
    resetScroll();
  }
};

// 获取歌单
const getPlaylistData = async (id: number, getList: boolean, refresh: boolean) => {
  // 加载缓存
  loadLikedCache();
  // 获取歌单详情
  const { detail: cover, privileges } = await dispatchPlaylistDetail("netease", {
    id,
    withTracks: false,
  });
  // 检查是否仍然是当前请求的歌单
  if (currentRequestId.value !== id) return;
  setDetailData(cover);
  // 不需要获取列表或无歌曲
  if (!getList || detailData.value?.count === 0) {
    setLoading(false);
    return;
  }
  // 如果已登录且歌曲数量少于 800，直接加载所有歌曲
  if (isLogin() === 1 && (detailData.value?.count as number) < 800) {
    const ids: number[] = privileges ?? [];
    const result = await songDetail(ids);
    // 检查是否仍然是当前请求的歌单
    if (currentRequestId.value !== id) return;
    // 直接批量详情返回时也进行一次按 id 去重
    setListData(uniqBy(formatSongsList(result.songs), "id"));
  } else {
    await getPlaylistAllSongs(id, detailData.value?.count || 0, refresh);
  }
  // 检查是否仍然是当前请求的歌单
  if (currentRequestId.value !== id) return;
  // 更新我喜欢
  if (detailData.value) {
    dataStore.setLikeSongsList(detailData.value, listData.value);
  }
  setLoading(false);
};

/**
 * 获取第三方平台的「我喜欢的音乐」
 *
 * 请求按序号守卫：只有最后一次请求的结果可以写入列表与红心集合，
 * 请求期间平台被切换时，本次结果整体丢弃，避免两个平台的曲目混排。
 * 列表采用覆盖语义：每次写入都是本次请求已取回曲目的去重结果。
 * @param refresh 是否为刷新（刷新时保留旧列表直至新数据到达）
 */
const getPlatformLikedSongs = async (refresh = false) => {
  const platform = platformStore.currentPlatform;
  const requestId = ++platformRequestId.value;
  const pageSize = 300;
  const tracks: SongType[] = [];
  let detail: CoverType | null = null;
  let count = 0;
  let page = 1;
  setLoading(true);
  clearSearch();
  if (!refresh) resetPlaylistData(true);
  // 请求是否已失效（序号落后或平台已切换）
  const isStale = () =>
    platformRequestId.value !== requestId || platformStore.currentPlatform !== platform;
  try {
    // 逐页取回曲目，行为与网易云链路一致
    do {
      const result = await dispatchLikedSongs(platform, { page, pageSize });
      // 请求已失效时丢弃本次结果：不写列表，也不写红心集合
      if (isStale()) return;
      detail = result.detail;
      count = result.count;
      if (result.tracks.length) {
        tracks.push(...result.tracks);
        // 覆盖写入：列表始终是本次请求已取回曲目的去重结果
        setListData(uniqBy(tracks, "id"));
      }
      page += 1;
      if (result.tracks.length === 0 || tracks.length >= count) break;
    } while (page <= 50);
    setDetailData(detail);
    setListData(uniqBy(tracks, "id"));
    // 按平台的红心判据同步全局喜欢集合
    syncLikedState(platform, tracks);
    setLoading(false);
  } catch (error) {
    // 请求已失效时不提示失败，由接管本次请求的新请求给出结果
    if (isStale()) return;
    console.error("获取平台喜欢歌曲失败：", error);
    setLoading(false);
    window.$message.error("获取我喜欢的音乐失败，请重试");
  }
};

/**
 * 同步第三方平台的红心状态到全局喜欢集合
 *
 * 歌曲卡片与播放器的红心按平台判定：网易云沿用既有本地缓存，
 * 第三方平台按「我喜欢的音乐」歌单的曲目集合判定，
 * 该集合由平台 store 持有，切回网易云无需还原（网易云集合未被覆盖）。
 *
 * 写入的是**请求发起时捕获的平台**，不是实时平台；
 * 且只有当前平台仍是该平台时才写，避免把某个平台的曲目写进另一个平台的红心桶。
 * @param platform 请求发起时捕获的平台
 * @param tracks 平台「我喜欢的音乐」的曲目
 */
const syncLikedState = (platform: ApiPlatform, tracks: SongType[]) => {
  if (platformStore.currentPlatform !== platform) return;
  platformStore.setLikedSongs(platform, tracks);
};

// 加载缓存
const loadLikedCache = () => {
  if (isObject(dataStore.likeSongsList.detail)) {
    setDetailData(dataStore.likeSongsList.detail);
  }
  if (dataStore.likeSongsList.data.length) {
    // 去重缓存中的歌曲，避免重复展示与后续重复拼接
    setListData(uniqBy(dataStore.likeSongsList.data, "id"));
  }
};

/**
 * 检查缓存是否需要更新
 * 通过比较 userLikeData.songs 的 ID 列表与缓存的歌曲 ID 来判断
 */
const checkNeedsUpdate = (): boolean => {
  const likedIds = dataStore.userLikeData.songs;
  const cachedIds = dataStore.likeSongsList.data.map((s) => s.id);
  // 如果长度不同，肯定需要更新
  if (likedIds.length !== cachedIds.length) {
    console.log(
      `🔄 Liked cache needs update: count changed (${cachedIds.length} -> ${likedIds.length})`,
    );
    return true;
  }
  // 比较 ID 集合是否完全相同（顺序可能不同）
  const likedSet = new Set(likedIds);
  const allMatch = cachedIds.every((id) => likedSet.has(id));
  if (!allMatch) {
    console.log("🔄 Liked cache needs update: song IDs changed");
    return true;
  }
  console.log("✅ Liked cache is up to date");
  return false;
};

// 获取歌单全部歌曲
const getPlaylistAllSongs = async (
  id: number,
  count: number,
  // 是否为刷新列表
  refresh: boolean = false,
) => {
  setLoading(true);
  // 加载提示
  loadingMsgShow(!refresh);
  // 循环获取
  let offset: number = 0;
  const limit: number = 500;
  const listDataArray: SongType[] = [];
  do {
    // 检查是否仍然是当前请求的歌单
    if (currentRequestId.value !== id) {
      loadingMsgShow(false);
      return;
    }
    const result = await playlistAllSongs(id, limit, offset);
    // 再次检查是否仍然是当前请求的歌单（请求完成后）
    if (currentRequestId.value !== id) {
      loadingMsgShow(false);
      return;
    }
    const songData = formatSongsList(result.songs);
    listDataArray.push(...songData);
    // 非刷新模式下，增量拼接时进行去重，避免与缓存或上一页数据重复
    if (!refresh) {
      const currentList = listData.value;
      setListData(uniqBy([...currentList, ...songData], "id"));
    }
    // 更新数据
    offset += limit;
  } while (offset < count && isLikedPage.value && currentRequestId.value === id);
  // 最终检查是否仍然是当前请求的歌单
  if (currentRequestId.value !== id) {
    loadingMsgShow(false);
    return;
  }
  // 刷新模式下，统一以最终聚合数据为准，并进行去重
  if (refresh) setListData(uniqBy(listDataArray, "id"));
  // 关闭加载
  loadingMsgShow(false);
};

// 处理搜索更新
const handleSearchUpdate = (val: string) => {
  searchValue.value = val;
  performSearch(val);
};

// 播放全部歌曲
const playAllSongs = useDebounceFn(() => {
  if (!detailData.value || !listData.value?.length) return;
  // 平台歌单不参与网易云歌单写操作，不传歌单 id
  playAllSongsAction(listData.value, isPlatformSource.value ? undefined : playlistId.value);
}, 300);

// 加载提示
const loadingMsgShow = (show: boolean = true) => {
  if (show) {
    loadingMsg.value?.destroy();
    loadingMsg.value = window.$message.loading("该歌单歌曲数量过多，请稍等", {
      duration: 0,
      closable: true,
    });
  } else {
    setLoading(false);
    loadingMsg.value?.destroy();
    loadingMsg.value = null;
  }
};

// 删除指定索引歌曲
const removeSong = (ids: number[]) => {
  if (!listData.value) return;
  setListData(listData.value.filter((song) => !ids.includes(song.id)));
};

onActivated(async () => {
  if (!isActivated.value) {
    isActivated.value = true;
  } else if (isPlatformSource.value) {
    // 第三方平台：重新拉取当前平台的喜欢歌曲
    await getPlatformLikedSongs(true);
  } else {
    // 检查是否需要更新缓存
    const needsUpdate = checkNeedsUpdate();
    if (needsUpdate) {
      getPlaylistDetail(playlistId.value, { getList: true, refresh: true });
    }
  }
});

// 平台切换后按新平台刷新喜欢歌曲
const offPlatformChange = onPlatformChange(() => {
  if (isPlatformSource.value) {
    void getPlatformLikedSongs(true);
    return;
  }
  // 切回网易云：按网易云既有链路刷新我喜欢的音乐
  void getPlaylistDetail(playlistId.value, { getList: true, refresh: true });
});

onDeactivated(() => loadingMsgShow(false));
onUnmounted(() => {
  offPlatformChange();
  loadingMsgShow(false);
});

onMounted(async () => {
  // 第三方平台：按当前平台取「我喜欢的音乐」
  if (isPlatformSource.value) {
    await getPlatformLikedSongs();
    return;
  }

  // 首先确保用户歌单数据已加载
  if (!dataStore.userLikeData.playlists?.length) {
    try {
      await updateUserLikePlaylist();
    } catch (error) {
      console.error("Failed to update user playlist data:", error);
      setLoading(false);
      return;
    }
  }

  // 获取我喜欢的音乐歌单ID
  const likedPlaylistId = dataStore.userLikeData.playlists?.[0]?.id;
  if (likedPlaylistId) {
    getPlaylistDetail(Number(likedPlaylistId));
  } else {
    // 如果没有找到我喜欢的音乐歌单，尝试从缓存获取
    const data: any = await dataStore.getUserLikePlaylist();
    const id = data?.detail?.id;
    if (id) {
      getPlaylistDetail(id);
    } else {
      setLoading(false);
      window.$message.error("无法获取我喜欢的音乐歌单");
    }
  }
});
</script>
