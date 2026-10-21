<template>
  <div class="discover-toplists">
    <n-divider> 官方榜 </n-divider>
    <Transition name="fade" mode="out-in">
      <!-- 分组榜单（QQ 音乐 / 酷狗）：榜单清单 + 榜单详情 -->
      <div v-if="isGroupedSource" class="official-list">
        <n-grid v-if="boardGroups.length" cols="1 600:2 1000:3" x-gap="20" y-gap="20">
          <n-gi v-for="group in boardGroups" :key="group.groupId" span="1">
            <div class="board-group">
              <n-text class="group-name" depth="3">{{ group.groupName }}</n-text>
              <n-grid cols="1 600:2" x-gap="20" y-gap="20">
                <n-gi v-for="board in group.toplists" :key="board.topId">
                  <SongListCard
                    :cover="board.cover"
                    :title="board.title || '排行榜'"
                    :height="160"
                    :description="board.subTitle || board.updateTime"
                    size="normal"
                    :class="{ active: board.topId === activeTopId }"
                    @click="openBoard(board)"
                  >
                    <template #info>
                      <div class="board-meta">
                        <n-text class="desc" depth="3">{{ board.total }} 首</n-text>
                        <n-text v-if="board.period" class="desc" depth="3">
                          {{ board.period }} 期
                        </n-text>
                      </div>
                    </template>
                  </SongListCard>
                </n-gi>
              </n-grid>
            </div>
          </n-gi>
        </n-grid>
        <n-grid v-else cols="1 600:2 1000:3" x-gap="20" y-gap="20">
          <n-gi v-for="item in 4" :key="item">
            <n-card class="loading">
              <n-skeleton class="cover" />
              <div class="desc">
                <n-skeleton text round :repeat="3" />
              </div>
            </n-card>
          </n-gi>
        </n-grid>
        <!-- 榜单详情 -->
        <div v-if="activeBoard" class="board-detail">
          <n-text class="detail-title">{{ activeBoard.title }}</n-text>
          <n-text v-if="activeBoard.subTitle" class="detail-subtitle" depth="3">
            {{ activeBoard.subTitle }}
          </n-text>
          <SongList
            :data="boardSongs"
            :loading="detailLoading"
            :loadMore="boardHasMore"
            @reachBottom="loadMoreBoardSongs"
            disabledSort
          />
        </div>
      </div>
      <!-- 网易云：官方榜 + 精选榜 -->
      <div v-else-if="topListData.official?.length > 0" class="official-list">
        <n-grid cols="1 600:2 1000:3" x-gap="20" y-gap="20">
          <n-gi v-for="(item, index) in topListData.official" :key="index">
            <SongListCard
              :cover="item.coverSize?.m || item.cover"
              :title="item.name"
              :height="160"
              :description="item.updateTip"
              size="normal"
              @click="router.push({ name: 'playlist', query: { id: item.id } })"
            >
              <template #info>
                <div
                  v-for="(song, songIndex) in item.tracks"
                  :key="songIndex"
                  class="song-item text-hidden"
                >
                  <n-text class="name">{{ songIndex + 1 }}. {{ song.first }}</n-text>
                  <n-text class="desc" depth="3">{{ song.second }}</n-text>
                </div>
              </template>
            </SongListCard>
          </n-gi>
        </n-grid>
      </div>
      <div v-else class="official-list">
        <n-grid cols="1 600:2 1000:3" x-gap="20" y-gap="20">
          <n-gi v-for="item in 4" :key="item">
            <n-card class="loading">
              <n-skeleton class="cover" />
              <div class="desc">
                <n-skeleton text round :repeat="3" />
              </div>
            </n-card>
          </n-gi>
        </n-grid>
      </div>
    </Transition>
    <n-divider v-if="!isPlatformSource" style="margin-bottom: 0"> 精选榜 </n-divider>
    <CoverList
      v-if="!isPlatformSource"
      :data="topListData.selected"
      :loading="true"
      type="playlist"
    />
  </div>
</template>

<script setup lang="ts">
import { topPlaylist } from "@/api/playlist";
import type { CoverType, SongType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import { onPlatformChange, usePlatformStore } from "@/stores";
import { dispatchLeaderboardDetail, dispatchLeaderboardGroups } from "@/api/platform/dispatch";
import type { PlatformLeaderboardBoard, PlatformLeaderboardGroup } from "@/api/platform/types";
import { formatCoverList } from "@/utils/format";

const router = useRouter();
const platformStore = usePlatformStore();

/** 提供分组榜单的平台（QQ 音乐 / 酷狗） */
const GROUPED_BOARD_PLATFORMS: ApiPlatform[] = ["qqmusic", "kugou"];

/** 榜单详情每页曲目数 */
const BOARD_PAGE_SIZE = 100;

// 是否为第三方平台（QQ 音乐 / 酷狗）
const isPlatformSource = computed<boolean>(() => platformStore.currentPlatform !== "netease");

// 是否为提供分组榜单的平台（QQ 音乐 / 酷狗）
const isGroupedSource = computed<boolean>(() =>
  GROUPED_BOARD_PLATFORMS.includes(platformStore.currentPlatform),
);

// 排行榜数据
const topListData = ref<{
  official: CoverType[];
  selected: CoverType[];
}>({
  official: [],
  selected: [],
});

// 榜单清单（按分组）
const boardGroups = ref<PlatformLeaderboardGroup[]>([]);

// 当前打开的榜单
const activeBoard = ref<PlatformLeaderboardBoard | null>(null);
const activeTopId = computed<number>(() => activeBoard.value?.topId ?? 0);

// 当前榜单已加载的曲目
const boardSongs = ref<SongType[]>([]);

// 当前榜单已加载到第几页
const boardPage = ref<number>(1);

// 榜单是否还有下一页
// 平台一次给全量榜单曲目（无翻页概念）时为 undefined，列表不显示「没有更多」页脚
const boardHasMore = ref<boolean | undefined>(undefined);

// 榜单详情加载状态
const detailLoading = ref<boolean>(false);

// 榜单详情请求序号：只有最后一次请求的结果会被采纳，避免连点时标题与曲目错位
let boardRequestId = 0;

/**
 * 打开某个榜单：加载并展示该榜单的曲目
 *
 * 请求带序号守卫：连点不同榜单时，先发后到的旧结果会被丢弃，
 * 列表内容始终与当前打开的榜单一致。
 * @param board 榜单条目
 * @param page 页码（从 1 开始）
 */
const openBoard = async (board: PlatformLeaderboardBoard, page = 1) => {
  const requestId = ++boardRequestId;
  if (page === 1) {
    activeBoard.value = board;
    boardSongs.value = [];
  }
  detailLoading.value = true;
  try {
    const detail = await dispatchLeaderboardDetail(platformStore.currentPlatform, {
      boardId: board.topId,
      page,
      limit: BOARD_PAGE_SIZE,
    });
    // 已有更新的请求，本次结果作废
    if (requestId !== boardRequestId) return;
    boardSongs.value = page === 1 ? detail.songs : [...boardSongs.value, ...detail.songs];
    boardPage.value = page;
    boardHasMore.value = detail.hasMore;
  } catch (error) {
    if (requestId !== boardRequestId) return;
    console.error("获取平台榜单详情失败：", error);
    boardSongs.value = [];
    boardHasMore.value = undefined;
  } finally {
    if (requestId === boardRequestId) detailLoading.value = false;
  }
};

/**
 * 加载当前榜单的下一页曲目
 *
 * 仅支持翻页的平台会给出「还有下一页」标记，触底时追加到当前列表。
 */
const loadMoreBoardSongs = async () => {
  if (!boardHasMore.value || detailLoading.value || !activeBoard.value) return;
  await openBoard(activeBoard.value, boardPage.value + 1);
};

/**
 * 读取第三方平台的榜单清单
 */
const loadBoardGroups = async () => {
  try {
    boardGroups.value = await dispatchLeaderboardGroups(platformStore.currentPlatform);
  } catch (error) {
    console.error("获取平台榜单清单失败：", error);
    boardGroups.value = [];
  }
};

// 获取排行榜数据
const getTopPlaylistData = async () => {
  // QQ 音乐 / 酷狗：榜单清单 + 默认榜单详情
  if (isGroupedSource.value) {
    activeBoard.value = null;
    boardSongs.value = [];
    boardHasMore.value = undefined;
    await loadBoardGroups();
    // 平台已切换时丢弃本次清单
    if (!isGroupedSource.value) return;
    const first = boardGroups.value[0]?.toplists?.[0];
    if (first) await openBoard(first);
    return;
  }
  const result = await topPlaylist();
  // 区分榜单
  const official = formatCoverList(result.list?.filter((v: any) => v.ToplistType !== undefined));
  const selected = formatCoverList(result.list?.filter((v: any) => v.ToplistType === undefined));
  topListData.value = { official, selected };
};

// 平台切换：重新拉取榜单
const stopPlatformWatch = onPlatformChange(() => {
  // 作废进行中的榜单详情请求，避免旧平台的曲目落到新平台的页面上
  boardRequestId++;
  detailLoading.value = false;
  getTopPlaylistData();
});

onMounted(getTopPlaylistData);

onUnmounted(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.discover-toplists {
  .song-item {
    .desc {
      &::before {
        content: "-";
        margin: 0 4px;
      }
    }
  }
  .board-group {
    .group-name {
      display: block;
      font-size: 14px;
      margin-bottom: 12px;
    }
  }
  .board-meta {
    display: flex;
    gap: 12px;
    .desc {
      font-size: 13px;
    }
  }
  .board-detail {
    margin-top: 24px;
    .detail-title {
      display: block;
      font-size: 20px;
      font-weight: bold;
      margin-bottom: 4px;
    }
    .detail-subtitle {
      display: block;
      font-size: 13px;
      margin-bottom: 12px;
    }
  }
  .loading {
    height: 160px;
    border-radius: 12px;
    cursor: pointer;
    :deep(.n-card-content) {
      display: flex;
      height: 100%;
      padding: 16px;
    }
    .cover {
      height: 100%;
      width: auto;
      border-radius: 8px;
      aspect-ratio: 1/1;
      margin-right: 20px;
    }
    .desc {
      display: flex;
      flex-direction: column;
      justify-content: space-evenly;
      width: 100%;
      :deep(.n-skeleton) {
        height: 20px;
      }
    }
  }
}
</style>
