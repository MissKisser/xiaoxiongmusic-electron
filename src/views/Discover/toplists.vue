<template>
  <div class="discover-toplists">
    <n-divider> 官方榜 </n-divider>
    <Transition name="fade" mode="out-in">
      <div v-if="isPlatformSource" class="official-list">
        <n-grid cols="1 600:2 1000:3" x-gap="20" y-gap="20">
          <n-gi>
            <SongListCard
              :cover="leaderboard.cover"
              :title="leaderboard.title || '排行榜'"
              :height="200"
              :description="leaderboard.subTitle"
              size="normal"
              @click="playLeaderboard"
            >
              <template #info>
                <div
                  v-for="(song, songIndex) in leaderboard.songs.slice(0, 5)"
                  :key="songIndex"
                  class="song-item text-hidden"
                >
                  <n-text class="name">{{ songIndex + 1 }}. {{ song.name }}</n-text>
                  <n-text class="desc" depth="3">{{ firstArtistName(song) }}</n-text>
                </div>
              </template>
            </SongListCard>
          </n-gi>
        </n-grid>
        <SongList :data="leaderboard.songs" :loading="loading" disabledSort />
      </div>
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
import { onPlatformChange, usePlatformStore } from "@/stores";
import { dispatchLeaderboard, type DispatchLeaderboardResult } from "@/api/platform/dispatch";
import { formatCoverList } from "@/utils/format";
import { usePlayerController } from "@/core/player/PlayerController";

const router = useRouter();
const platformStore = usePlatformStore();
const player = usePlayerController();

// 是否为第三方平台（QQ 音乐 / 酷狗）
const isPlatformSource = computed<boolean>(() => platformStore.currentPlatform !== "netease");

// 排行榜数据
const topListData = ref<{
  official: CoverType[];
  selected: CoverType[];
}>({
  official: [],
  selected: [],
});

// 平台榜单数据
const leaderboard = ref<DispatchLeaderboardResult>({
  title: "",
  subTitle: "",
  cover: "",
  total: 0,
  songs: [],
});

// 加载状态
const loading = ref<boolean>(true);

// 获取排行榜数据
const getTopPlaylistData = async () => {
  // 第三方平台：走平台榜单
  if (isPlatformSource.value) {
    loading.value = true;
    try {
      leaderboard.value = await dispatchLeaderboard(platformStore.currentPlatform, { limit: 100 });
    } catch (error) {
      console.error("获取平台榜单失败：", error);
      leaderboard.value = { title: "", subTitle: "", cover: "", total: 0, songs: [] };
    }
    loading.value = false;
    return;
  }
  const result = await topPlaylist();
  // 区分榜单
  const official = formatCoverList(result.list?.filter((v: any) => v.ToplistType !== undefined));
  const selected = formatCoverList(result.list?.filter((v: any) => v.ToplistType === undefined));
  topListData.value = { official, selected };
};

// 播放榜单歌曲
const playLeaderboard = () => {
  if (leaderboard.value.songs.length === 0) return;
  player.updatePlayList(leaderboard.value.songs);
};

/**
 * 取歌曲的首个歌手名
 * @param song 歌曲
 * @returns 歌手名
 */
const firstArtistName = (song: SongType): string => {
  const artists = song.artists;
  if (typeof artists === "string") return artists;
  return artists[0]?.name || "未知歌手";
};

// 平台切换：重新拉取榜单
const stopPlatformWatch = onPlatformChange(() => {
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
