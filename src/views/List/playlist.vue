<!-- 歌单列表 -->
<template>
  <div class="playlist-list">
    <ListDetail
      :detail-data="isCurrentPlaylist ? detailData : null"
      :list-data="isCurrentPlaylist ? listData : []"
      :loading="showLoading"
      :list-scrolling="listScrolling"
      :search-value="searchValue"
      :config="listConfig"
      :play-button-text="playButtonText"
      :more-options="moreOptions"
      :hide-comment-tab="isLocalPlaylist || detailData?.privacy === 10 || isPlatformSource"
      @update:search-value="handleSearchUpdate"
      @play-all="playAllSongs"
      @tab-change="handleTabChange"
    >
      <template #action-buttons>
        <n-button
          v-if="isUserPlaylist && !isPlatformSource"
          :focusable="false"
          strong
          secondary
          round
          @click="updatePlaylist"
        >
          <template #icon>
            <SvgIcon name="EditNote" />
          </template>
          编辑歌单
        </n-button>
        <n-button
          v-else-if="!isPlatformSource"
          :focusable="false"
          strong
          secondary
          round
          @click="toLikePlaylist(playlistId, !isLikePlaylist)"
        >
          <template #icon>
            <SvgIcon :name="isLikePlaylist ? 'Favorite' : 'FavoriteBorder'" />
          </template>
          {{ isLikePlaylist ? "取消收藏" : "收藏歌单" }}
        </n-button>
        <!-- 第三方平台歌单：自建歌单可编辑，他人歌单可收藏 -->
        <n-button
          v-else-if="isPlatformOwnedPlaylist"
          :focusable="false"
          strong
          secondary
          round
          @click="updatePlaylist"
        >
          <template #icon>
            <SvgIcon name="EditNote" />
          </template>
          编辑歌单
        </n-button>
        <n-button
          v-else-if="!isPlatformLikedPlaylist"
          :focusable="false"
          strong
          secondary
          round
          @click="togglePlatformSubscribe"
        >
          <template #icon>
            <SvgIcon :name="isPlatformSubscribed ? 'Favorite' : 'FavoriteBorder'" />
          </template>
          {{ isPlatformSubscribed ? "取消收藏" : "收藏歌单" }}
        </n-button>
      </template>
    </ListDetail>
    <Transition name="fade" mode="out-in">
      <!-- 歌曲列表 -->
      <template v-if="currentTab === 'songs'">
        <!-- 平台歌单曲目不可读 -->
        <n-empty
          v-if="isUnsupportedPlaylist"
          :description="
            collectedSourceUnreadable
              ? '源歌单当前不可读（已删除或未公开）'
              : '该歌单类型暂不支持读取曲目'
          "
          style="margin-top: 60px"
          size="large"
        >
          <template #icon>
            <SvgIcon name="Music" />
          </template>
        </n-empty>
        <SongList
          v-else-if="!searchValue || searchData?.length"
          :data="isCurrentPlaylist ? displayData : []"
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
      </template>
      <!-- 评论 -->
      <template v-else>
        <ListComment :id="playlistId" :type="2" :height="songListHeight" />
      </template>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import type { DropdownOption, MessageReactive } from "naive-ui";
import type { CoverType, SongType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import { songDetail } from "@/api/song";
import { playlistAllSongs, deletePlaylist, updatePlaylistPrivacy } from "@/api/playlist";
import { dispatchPlaylistDetail } from "@/api/platform/dispatch";
import {
  deletePlaylist as manageDeletePlaylist,
  isPlaylistSubscribed,
  subscribePlaylist,
} from "@/api/platform/manage";
import { formatSongsList } from "@/utils/format";
import { renderIcon, copyData } from "@/utils/helper";
import { isLogin, toLikePlaylist, updateUserLikePlaylist } from "@/utils/auth";
import { useDataStore, useLocalStore, usePlatformStore, onPlatformChange } from "@/stores";
import { openBatchList, openUpdatePlaylist } from "@/utils/modal";
import { uniqBy } from "lodash-es";
import { useLikedSongsSync } from "@/composables/useLikedSongsSync";
import type { LikedSongsChange } from "@/utils/likedEvents";
import { useListDetail } from "@/composables/List/useListDetail";
import { useListSearch } from "@/composables/List/useListSearch";
import { useListScroll } from "@/composables/List/useListScroll";
import { useListActions } from "@/composables/List/useListActions";
import { useListDataCache, type ListCacheData } from "@/composables/List/useListDataCache";

const router = useRouter();
const dataStore = useDataStore();
const localStore = useLocalStore();
const platformStore = usePlatformStore();

const {
  detailData,
  listData,
  loading,
  getSongListHeight,
  setDetailData,
  setListData,
  appendListData,
  setLoading,
} = useListDetail();
const { searchValue, searchData, displayData, clearSearch, performSearch } =
  useListSearch(listData);
const { listScrolling, handleListScroll, resetScroll } = useListScroll();
const { playAllSongs: playAllSongsAction } = useListActions();
const { saveCache, loadCache, checkNeedsUpdate } = useListDataCache();

// 歌单 ID
const oldPlaylistId = ref<number>(0);
const playlistId = computed<number>(() => Number(router.currentRoute.value.query.id as string));

// 路由指定的音源平台（第三方平台歌单带 platform 参数，网易云原路径不带）
const routePlatform = computed<ApiPlatform | null>(() => {
  const platform = router.currentRoute.value.query.platform as string | undefined;
  return platform === "qqmusic" || platform === "kugou" ? platform : null;
});

// 是否为第三方平台歌单
const isPlatformSource = computed<boolean>(() => routePlatform.value !== null);

// 平台歌单标识
const platformPlaylistId = computed<string>(() => String(router.currentRoute.value.query.id ?? ""));

// 平台自建歌单目录号
const platformDirId = computed<number | undefined>(
  () => Number(router.currentRoute.value.query.dirId ?? 0) || undefined,
);

// 播放列表标识（平台歌单不参与网易云歌单写操作）
const listPlayListId = computed<number>(() => (isPlatformSource.value ? 0 : playlistId.value));

// 当前详情是否属于路由上的歌单
// 平台歌单的 id 是平台内主键（字符串），网易云与本地歌单是数字，
// 这里按字符串口径比对，避免类型不同导致头部与曲目列表不渲染。
const isCurrentPlaylist = computed<boolean>(
  () => !!detailData.value && String(detailData.value.id) === String(playlistId.value),
);

// 平台歌单曲目不可读（上游端点对该类歌单返回空曲目）
const isUnsupportedPlaylist = computed<boolean>(
  () =>
    isPlatformSource.value &&
    !loading.value &&
    (detailData.value?.count ?? 0) > 0 &&
    listData.value.length === 0,
);

// 收藏歌单的源歌单不可读（源歌单已删除或未公开，如实说明而非按空歌单呈现）
const collectedSourceUnreadable = computed<boolean>(
  () => detailData.value?.sourceReadable === false,
);

// 当前正在请求的歌单 ID，用于防止竞态条件
const currentRequestId = ref<number>(0);

// 加载提示
const loadingMsg = ref<MessageReactive | null>(null);

// 列表高度
const songListHeight = computed(() => getSongListHeight(listScrolling.value));

// 当前 tab
const currentTab = ref<"songs" | "comments">("songs");

// 是否为本地歌单
const isLocalPlaylist = computed(() => {
  return playlistId.value.toString().length === 16;
});

// 是否为用户歌单
const isUserPlaylist = computed(() => {
  if (isLocalPlaylist.value) return true;
  return detailData.value?.creator?.id === dataStore.userData?.userId;
});

// 是否处于收藏歌单
// 网易云的歌单收藏属于网易云平台，在其它平台下不参与判据
const isLikePlaylist = computed(() => {
  if (platformStore.currentPlatform !== "netease") return false;
  return dataStore.userLikeData.playlists.some((playlist) => playlist.id === detailData.value?.id);
});

// 平台歌单是否为自己创建（可写）
const isPlatformOwnedPlaylist = computed<boolean>(() => {
  if (!isPlatformSource.value || !routePlatform.value) return false;
  const id = platformPlaylistId.value;
  return platformStore.playlists.owned.some(
    (playlist) => String(playlist.platformId ?? playlist.id) === id && playlist.isLiked !== true,
  );
});

// 平台歌单是否为系统「我喜欢的音乐」（只读，不可编辑删除）
const isPlatformLikedPlaylist = computed<boolean>(() => {
  if (!isPlatformSource.value || !routePlatform.value) return false;
  const id = platformPlaylistId.value;
  return platformStore.playlists.owned.some(
    (playlist) => String(playlist.platformId ?? playlist.id) === id && playlist.isLiked === true,
  );
});

// 平台歌单的收藏（订阅）状态
const isPlatformSubscribed = ref<boolean>(false);

// 是否处于歌单页面
const isPlaylistPage = computed<boolean>(() => router.currentRoute.value.name === "playlist");

// 是否为相同歌单
const isSamePlaylist = computed<boolean>(() => oldPlaylistId.value === playlistId.value);

// 列表配置
const listConfig = computed(() => ({
  titleType: "normal" as const,
  showCoverMask: true,
  showPlayCount: !isLocalPlaylist.value,
  showArtist: false,
  showCreator: !isLocalPlaylist.value,
  showCount: false,
  searchAlign: "center" as const,
}));

// 是否显示加载状态
const showLoading = computed(() => listData.value.length === 0 && loading.value);

// 播放按钮文本
const playButtonText = computed(() => {
  if (showLoading.value) {
    if (isSamePlaylist.value) {
      return "更新中...";
    }
    const loaded =
      listData.value.length === (detailData.value?.count || 0) ? 0 : listData.value.length;
    return `加载中... (${loaded}/${detailData.value?.count || 0})`;
  }
  return "播放";
});

// 更多操作
const moreOptions = computed<DropdownOption[]>(() => {
  // 第三方平台歌单：保留刷新、批量操作与删除，其余为网易云专有写操作
  if (isPlatformSource.value) {
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
        label: "删除歌单",
        key: "delete",
        show: isPlatformOwnedPlaylist.value,
        props: {
          onClick: () => {
            toDeletePlaylist();
          },
        },
        icon: renderIcon("Delete"),
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
      show: !isLocalPlaylist.value,
      props: {
        onClick: () => getPlaylistDetail(playlistId.value, { getList: true, refresh: true }),
      },
      icon: renderIcon("Refresh"),
    },
    {
      label: "公开隐私歌单",
      key: "privacy",
      show: !isLocalPlaylist.value && detailData.value?.privacy === 10,
      props: { onClick: openPrivacy },
      icon: renderIcon("ListLockOpen"),
    },
    {
      label: "删除歌单",
      key: "delete",
      show: isUserPlaylist.value,
      props: {
        onClick: () => toDeletePlaylist(),
      },
      icon: renderIcon("Delete"),
    },
    {
      label: "批量操作",
      key: "batch",
      props: {
        onClick: () =>
          openBatchList(
            displayData.value,
            isLocalPlaylist.value,
            isUserPlaylist.value ? playlistId.value : undefined,
          ),
      },
      icon: renderIcon("Batch"),
    },
    {
      label: "复制分享链接",
      key: "copy",
      show: !isLocalPlaylist.value,
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
      show: !isLocalPlaylist.value,
      props: {
        onClick: () => {
          window.open(`https://music.163.com/#/playlist?id=${playlistId.value}`);
        },
      },
      icon: renderIcon("Link"),
    },
  ];
});

// 平台歌单定位信息
interface PlatformPlaylistTarget {
  /** 平台歌单标识 */
  id?: string;
  /** 自建歌单目录号 */
  dirId?: number;
}

// 获取歌单基础信息
const getPlaylistDetail = async (
  id: number,
  options: { getList: boolean; refresh: boolean } = { getList: true, refresh: false },
  platform: ApiPlatform | null = routePlatform.value,
  target: PlatformPlaylistTarget = {},
) => {
  if (!id) return;
  // 设置当前请求的歌单 ID，用于防止竞态条件
  currentRequestId.value = id;
  // 设置加载状态
  setLoading(true);
  const { getList, refresh } = options;
  // 清空数据
  clearSearch();
  if (!refresh && detailData.value?.id !== id) resetPlaylistData(getList);
  // 判断是否为本地歌单，本地歌单 ID 为 16 位
  const isLocal = id.toString().length === 16;
  // 本地歌单
  if (isLocal) handleLocalPlaylist(id);
  // 第三方平台歌单
  else if (platform) await handlePlatformPlaylist(platform, getList, target);
  // 在线歌单
  else await handleOnlinePlaylist(id, getList, refresh);
};

// 重置歌单数据
const resetPlaylistData = (getList: boolean) => {
  setDetailData(null);
  if (getList) {
    setListData([]);
    resetScroll();
  }
};

// 获取本地歌单
const handleLocalPlaylist = (id: number) => {
  const result = localStore.getLocalPlaylistDetail(id);
  if (!result) {
    window.$message.error("本地歌单不存在");
    setLoading(false);
    return;
  }
  const { playlist, songs } = result;
  // 获取封面：优先使用歌单封面，否则取第一首歌曲的封面
  let cover = playlist.cover;
  if (!cover && songs.length > 0) {
    cover = songs[0].cover;
  }
  // 转换为 CoverType 格式
  setDetailData({
    id: playlist.id,
    name: playlist.name,
    cover: cover || "/images/album.jpg?asset",
    description: playlist.description,
    count: playlist.songs.length,
    createTime: playlist.createTime,
    updateTime: playlist.updateTime,
  });
  setListData(songs);
  setLoading(false);
};

/**
 * 获取第三方平台歌单
 *
 * 逐页取回曲目并即时上屏；歌单头部先落位，曲目总数过多时给出持续加载提示，
 * 取完、请求竞态返回与异常都会收起提示。
 * @param platform 音源平台
 * @param getList 是否取回曲目
 * @param target 目标歌单的定位信息
 * @returns 无返回值
 */
const handlePlatformPlaylist = async (
  platform: ApiPlatform,
  getList: boolean,
  target: PlatformPlaylistTarget = {},
) => {
  const pageSize = 300;
  const tracks: SongType[] = [];
  let detail: CoverType | null = null;
  let count = 0;
  let page = 1;
  // 路由更新时目标歌单标识取自目标路由，避免读到切换前的旧歌单
  const targetId = target.id ?? platformPlaylistId.value;
  const targetDirId = target.dirId ?? platformDirId.value;
  // 曲目总数拿到后只判定一次提示，避免分页途中反复弹出
  let tipChecked = false;
  // 歌单头部只落位一次，避免分页途中反复写入
  let detailSet = false;
  // 本次请求弹出的加载提示，只收起自己弹出的那一条
  let tipMessage: MessageReactive | null = null;
  /**
   * 收起本次请求的加载提示
   *
   * 提示已被别的请求接管时不动它，避免过期请求关掉新请求的提示。
   */
  const closeTip = () => {
    if (loadingMsg.value === tipMessage) loadingMsgShow(false);
  };
  try {
    // 逐页取回曲目，行为与网易云链路一致
    do {
      const result = await dispatchPlaylistDetail(platform, {
        id: targetId,
        dirId: targetDirId,
        withTracks: getList,
        page,
        pageSize,
      });
      // 检查是否仍然是当前请求的歌单
      if (currentRequestId.value !== playlistId.value) {
        closeTip();
        return;
      }
      detail = result.detail;
      count = result.count;
      // 头部信息先落位，分页取回的曲目才能逐页上屏（与网易云链路一致）
      if (detail && !detailSet) {
        detailSet = true;
        setDetailData(detail);
      }
      // 曲目总数过多时给出持续加载提示，与网易云链路保持一致
      if (getList && !tipChecked && count > 0) {
        tipChecked = true;
        loadingMsgShow(true, count);
        tipMessage = loadingMsg.value;
      }
      if (getList && result.tracks.length) {
        tracks.push(...result.tracks);
        appendListData(result.tracks);
      }
      page += 1;
      if (!getList || result.tracks.length === 0 || tracks.length >= count) break;
    } while (page <= 50);
    setLoading(false);
  } catch (error) {
    console.error("获取平台歌单失败：", error);
    setLoading(false);
    window.$message.error("获取歌单失败，请重试");
  } finally {
    // 取完、竞态返回与异常都在此收起提示
    closeTip();
  }
};

/**
 * 重新读取平台「我喜欢的音乐」歌单的曲目
 *
 * 覆盖语义：每次都以本次读到的曲目为准，不与旧列表叠加。
 * 后台静默刷新：不弹加载提示，避免打扰用户。
 * @param platform 音源平台
 * @returns 无返回值
 */
const reloadPlatformLikedTracks = async (platform: ApiPlatform) => {
  const pageSize = 300;
  const tracks: SongType[] = [];
  let detail: CoverType | null = null;
  let count = 0;
  let page = 1;
  do {
    const result = await dispatchPlaylistDetail(platform, {
      id: platformPlaylistId.value,
      dirId: platformDirId.value,
      withTracks: true,
      page,
      pageSize,
    });
    detail = result.detail;
    count = result.count;
    tracks.push(...result.tracks);
    page += 1;
    if (result.tracks.length === 0 || tracks.length >= count) break;
  } while (page <= 50);
  setListData(uniqBy(tracks, "id"));
  setDetailData(detail);
};

/**
 * 把一次红心变更应用到本地列表（乐观更新）
 *
 * 只作用于平台「我喜欢的音乐」歌单：红心写操作成功后立即生效，
 * 喜欢则把曲目补进列表，取消则从列表移除，歌单计数同步增减。
 * 曲目按歌曲的逻辑 id 匹配，同一首歌的不同文件版本共享同一个逻辑 id。
 * @param change 红心变更
 */
const applyLikedChange = (change: LikedSongsChange) => {
  const id = Number(change.song.id);
  if (!Number.isFinite(id)) return;
  const current = listData.value;
  const exists = current.some((track) => Number(track.id) === id);
  if (change.liked) {
    if (exists) return;
    setListData([change.song, ...current]);
  } else {
    if (!exists) return;
    setListData(current.filter((track) => Number(track.id) !== id));
  }
  const detail = detailData.value;
  if (detail) {
    setDetailData({
      ...detail,
      count: Math.max(0, (detail.count ?? 0) + (change.liked ? 1 : -1)),
    });
  }
};

/**
 * 红心变更后实时更新平台「我喜欢的音乐」歌单
 *
 * 只在当前展示的正是平台「我喜欢的音乐」时生效，
 * 其余歌单不受红心变更影响。
 */
const stopLikedSync = useLikedSongsSync({
  platform: () => routePlatform.value ?? "netease",
  shouldHandle: () => isPlatformLikedPlaylist.value,
  applyChange: applyLikedChange,
  currentTracks: () => listData.value,
  reload: async () => {
    if (!routePlatform.value || !isPlatformLikedPlaylist.value) return;
    await reloadPlatformLikedTracks(routePlatform.value);
  },
});

// 获取在线歌单
const handleOnlinePlaylist = async (id: number, getList: boolean, refresh: boolean) => {
  // 1. 尝试读取缓存
  if (!refresh && getList) {
    const cached = await loadCache("playlist", id);
    if (cached) {
      setDetailData(cached.detail);
      setListData(cached.songs);
      setLoading(false);

      // 后台检查更新
      backgroundCheck(id, cached);
      return;
    }
  }

  // 获取歌单详情
  const { detail: cover, privileges } = await dispatchPlaylistDetail("netease", {
    id,
    withTracks: false,
  });
  // 检查是否仍然是当前请求的歌单
  if (currentRequestId.value !== id) return;
  setDetailData(cover);
  const count = detailData.value?.count || 0;
  // 不需要获取列表或无歌曲
  if (!getList || count === 0) {
    setLoading(false);
    return;
  }
  // 如果已登录且歌曲数量少于 800，直接加载所有歌曲
  if (isLogin() === 1 && count === privileges?.length && count < 800) {
    const ids = privileges as number[];
    const result = await songDetail(ids);
    // 检查是否仍然是当前请求的歌单
    if (currentRequestId.value !== id) return;
    const songs = formatSongsList(result.songs);
    setListData(songs);
    // 保存缓存
    saveCache("playlist", id, detailData.value!, songs);
  } else {
    await getPlaylistAllSongs(id, count, refresh);
  }
  // 检查是否仍然是当前请求的歌单
  if (currentRequestId.value !== id) return;
  setLoading(false);
};

// 后台检查更新
const backgroundCheck = async (id: number, cached: ListCacheData) => {
  try {
    const { detail: latestDetail } = await dispatchPlaylistDetail("netease", {
      id,
      withTracks: false,
    });
    if (currentRequestId.value !== id) return;

    if (checkNeedsUpdate(cached, latestDetail)) {
      console.log("Cache expired, refreshing...");
      handleOnlinePlaylist(id, true, true);
    }
  } catch (e) {
    console.error("Background check failed", e);
  }
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
  loadingMsgShow(!refresh, count);
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
    if (!refresh) {
      appendListData(songData);
    }
    // 更新数据
    offset += limit;
  } while (offset < count && isPlaylistPage.value && currentRequestId.value === id);
  // 最终检查是否仍然是当前请求的歌单
  if (currentRequestId.value !== id) {
    loadingMsgShow(false);
    return;
  }
  if (refresh) setListData(listDataArray);
  // 保存缓存
  if (detailData.value && listDataArray.length > 0) {
    saveCache("playlist", id, detailData.value, listDataArray);
  }

  // 关闭加载
  loadingMsgShow(false);
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
  // 平台歌单不参与网易云歌单写操作，不传歌单 id
  playAllSongsAction(listData.value, isPlatformSource.value ? undefined : playlistId.value);
}, 300);

// 加载提示
const loadingMsgShow = (show: boolean = true, count?: number) => {
  if (show) {
    if (count && count <= 800) return;
    loadingMsg.value?.destroy();
    loadingMsg.value = window.$message.loading("该歌单歌曲数量过多，请稍等", {
      duration: 0,
      closable: true,
    });
  } else {
    loadingMsg.value?.destroy();
    loadingMsg.value = null;
  }
};

// 删除歌单
const toDeletePlaylist = async () => {
  if (!detailData.value || !playlistId.value) return;
  window.$dialog.warning({
    title: "删除歌单",
    content: "确认删除这个歌单？该操作无法撤销！",
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      // 本地歌单
      if (isLocalPlaylist.value) {
        const success = await localStore.deleteLocalPlaylist(playlistId.value);
        if (success) {
          window.$message.success("本地歌单删除成功");
          router.back();
        } else {
          window.$message.error("删除失败");
        }
        return;
      }
      // 第三方平台歌单
      if (isPlatformSource.value && routePlatform.value) {
        const result = await manageDeletePlaylist(routePlatform.value, platformPlaylistId.value);
        if (!result.ok) {
          window.$message.error(result.message || "歌单删除失败，请重试");
          return;
        }
        window.$message.success("歌单删除成功");
        router.back();
        return;
      }
      // 在线歌单
      const result = await deletePlaylist(playlistId.value);
      if (result.code === 200) {
        window.$message.success("歌单删除成功");
        // 更新用户歌单
        if (dataStore.userData.createdPlaylistCount) {
          dataStore.userData.createdPlaylistCount -= 1;
          await updateUserLikePlaylist();
        }
      }
    },
  });
};

// 收藏 / 取消收藏平台歌单
const togglePlatformSubscribe = async () => {
  if (!isPlatformSource.value || !routePlatform.value) return;
  const subscribed = !isPlatformSubscribed.value;
  const result = await subscribePlaylist(routePlatform.value, platformPlaylistId.value, subscribed);
  if (!result.ok) {
    window.$message.error(result.message || "收藏歌单失败，请重试");
    return;
  }
  isPlatformSubscribed.value = subscribed;
  window.$message.success(subscribed ? "收藏歌单成功" : "取消收藏歌单成功");
};

// 读取平台歌单的收藏状态
const loadPlatformSubscribeState = async (
  platform: ApiPlatform | null = routePlatform.value,
  id: string = platformPlaylistId.value,
) => {
  if (!platform) return;
  isPlatformSubscribed.value = await isPlaylistSubscribed(platform, id);
};

// 删除指定索引歌曲
const removeSong = async (ids: number[]) => {
  if (!listData.value) return;
  // 如果是本地歌单，同步删除存储中的数据
  if (isLocalPlaylist.value) {
    const songIds = ids.map((id) => id.toString());
    const success = await localStore.removeSongsFromLocalPlaylist(playlistId.value, songIds);
    if (!success) {
      window.$message.error("删除失败");
      return;
    }
  }
  setListData(listData.value.filter((song) => !ids.includes(song.id)));
};

// 编辑歌单
const updatePlaylist = () => {
  if (!detailData.value || !playlistId.value) return;
  if (isPlatformSource.value && routePlatform.value) {
    openUpdatePlaylist(
      platformPlaylistId.value,
      detailData.value,
      () => getPlaylistDetail(playlistId.value, { getList: false, refresh: false }),
      routePlatform.value,
    );
    return;
  }
  openUpdatePlaylist(playlistId.value, detailData.value, () =>
    getPlaylistDetail(playlistId.value, { getList: false, refresh: false }),
  );
};

// 公开隐私歌单
const openPrivacy = async () => {
  if (detailData.value?.privacy !== 10) return;
  window.$dialog.warning({
    title: "公开隐私歌单",
    content: "确认公开这个歌单？该操作无法撤销！",
    positiveText: "公开",
    negativeText: "取消",
    onPositiveClick: async () => {
      const result = await updatePlaylistPrivacy(playlistId.value);
      if (result.code !== 200) return;
      if (detailData.value) detailData.value.privacy = 0;
      window.$message.success("歌单公开成功");
    },
  });
};

onBeforeRouteUpdate((to) => {
  const id = Number(to.query.id as string);
  if (id) {
    oldPlaylistId.value = id;
    // 路由上带平台维度时按该平台取数（平台切换即换源）
    const platform = to.query.platform as ApiPlatform | undefined;
    const source = platform === "qqmusic" || platform === "kugou" ? platform : null;
    // 目标路由尚未生效，平台歌单定位信息取自目标路由，避免读到切换前的旧歌单
    getPlaylistDetail(id, { getList: true, refresh: false }, source, {
      id: to.query.id ? String(to.query.id) : undefined,
      dirId: Number(to.query.dirId ?? 0) || undefined,
    });
    void loadPlatformSubscribeState(source, to.query.id ? String(to.query.id) : undefined);
  }
});

onActivated(() => {
  // 是否为首次进入
  if (oldPlaylistId.value === 0) {
    oldPlaylistId.value = playlistId.value;
  } else {
    oldPlaylistId.value = playlistId.value;
    // 刷新歌单
    getPlaylistDetail(playlistId.value, { getList: true, refresh: false });
  }
  void loadPlatformSubscribeState();
});

onDeactivated(() => loadingMsgShow(false));

/**
 * 平台切换后离开旧平台的歌单
 *
 * 歌单号是平台内主键：同一个歌单号在新平台下指向完全不同的歌单，
 * 停留在旧平台的歌单详情页上，界面上显示的就不是当前平台的数据。
 * 本地歌单与平台无关，不受此约束。
 */
const offPlatformChange = onPlatformChange(({ platform }) => {
  // 页面被 KeepAlive 缓存：离开本页后仍会收到平台变更通知。
  // 此时按当前路由的平台参数判断，会把用户从别的页面弹走，故只在本页在前台时处理。
  if (router.currentRoute.value.name !== "playlist") return;
  if (isLocalPlaylist.value) return;
  // 路由未带平台参数时按网易云歌单处理
  const shown = routePlatform.value ?? "netease";
  if (shown === platform) return;
  // 回到当前平台的首页，避免旧平台的歌单继续留在界面上
  router.push({ name: "home" });
});

onUnmounted(() => {
  stopLikedSync();
  offPlatformChange();
  loadingMsgShow(false);
});
onMounted(() => {
  getPlaylistDetail(playlistId.value);
  void loadPlatformSubscribeState();
});
</script>
