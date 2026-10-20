<!-- 第三方平台首页 -->
<template>
  <div class="home-platform">
    <!-- 热歌榜 -->
    <div v-if="leaderboard.songs.length > 0" class="rec-public">
      <n-flex
        class="title"
        align="center"
        justify="space-between"
        @click="router.push({ name: 'discover-toplists' })"
      >
        <n-h3 prefix="bar">
          <n-text>{{ leaderboard.title || "热歌榜" }}</n-text>
          <SvgIcon :size="26" name="Right" />
        </n-h3>
      </n-flex>
      <n-grid cols="1 600:2 1000:3" x-gap="20" y-gap="20">
        <n-gi>
          <SongListCard
            :cover="leaderboard.cover"
            :title="leaderboard.title || '热歌榜'"
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
    </div>
    <!-- 精选歌单 -->
    <div v-if="squarePlaylists.length > 0" class="rec-public">
      <n-flex
        class="title"
        align="center"
        justify="space-between"
        @click="router.push({ name: 'discover-playlists' })"
      >
        <n-h3 prefix="bar">
          <n-text>精选歌单</n-text>
          <SvgIcon :size="26" name="Right" />
        </n-h3>
      </n-flex>
      <CoverList :data="squarePlaylists" type="playlist" :loading="loading" />
    </div>
    <!-- 热搜词 -->
    <div v-if="hotWords.length > 0" class="rec-public">
      <n-flex class="title" align="center" justify="space-between">
        <n-h3 prefix="bar">
          <n-text>热搜词</n-text>
        </n-h3>
      </n-flex>
      <n-flex class="hot-words" align="center" :wrap="true">
        <n-tag
          v-for="(item, index) in hotWords"
          :key="index"
          :bordered="false"
          round
          size="large"
          @click="searchWord(item.searchWord)"
        >
          {{ item.searchWord }}
        </n-tag>
      </n-flex>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CoverType, SongType } from "@/types/main";
import { onPlatformChange, usePlatformStore } from "@/stores";
import {
  dispatchHotSearch,
  dispatchLeaderboard,
  dispatchSquarePlaylists,
  type DispatchHotSearchItem,
  type DispatchLeaderboardResult,
} from "@/api/platform/dispatch";
import { usePlayerController } from "@/core/player/PlayerController";
import SvgIcon from "@/components/Global/SvgIcon.vue";
import CoverList from "@/components/List/CoverList.vue";
import SongListCard from "@/components/Card/SongListCard.vue";

const router = useRouter();
const platformStore = usePlatformStore();
const player = usePlayerController();

// 榜单数据
const leaderboard = ref<DispatchLeaderboardResult>({
  title: "",
  subTitle: "",
  cover: "",
  total: 0,
  songs: [],
});

// 精选歌单
const squarePlaylists = ref<CoverType[]>([]);
const loading = ref<boolean>(true);

// 热搜词
const hotWords = ref<DispatchHotSearchItem[]>([]);

/**
 * 拉取当前平台的首页数据
 *
 * 榜单、热搜词、精选歌单按平台能力分别取数，
 * 平台不支持的区块自然为空，不会渲染。
 */
const loadData = async () => {
  const platform = platformStore.currentPlatform;
  loading.value = true;
  try {
    // 热歌榜
    const board = await dispatchLeaderboard(platform, { limit: 50 });
    leaderboard.value = board;
  } catch (error) {
    console.error("获取平台榜单失败：", error);
    leaderboard.value = { title: "", subTitle: "", cover: "", total: 0, songs: [] };
  }
  try {
    // 精选歌单
    const square = await dispatchSquarePlaylists(platform, { limit: 12 });
    squarePlaylists.value = square.playlists;
  } catch (error) {
    console.error("获取平台精选歌单失败：", error);
    squarePlaylists.value = [];
  }
  try {
    // 热搜词
    hotWords.value = await dispatchHotSearch(platform);
  } catch (error) {
    console.error("获取平台热搜失败：", error);
    hotWords.value = [];
  }
  loading.value = false;
};

// 播放榜单歌曲
const playLeaderboard = () => {
  if (leaderboard.value.songs.length === 0) return;
  player.updatePlayList(leaderboard.value.songs as SongType[]);
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

// 按热搜词搜索
const searchWord = (word: string) => {
  if (!word) return;
  router.push({ name: "search-songs", query: { keyword: word } });
};

// 平台切换：重新拉取首页数据
const stopPlatformWatch = onPlatformChange(() => {
  loadData();
});

onMounted(loadData);

onUnmounted(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.home-platform {
  width: 100%;
  .rec-public {
    margin-bottom: 12px;
  }
  .title {
    margin-top: 28px;
    padding: 0 4px;
    width: max-content;
    .n-h {
      margin: 0;
      display: flex;
      align-items: center;
      cursor: pointer;
      .n-icon {
        opacity: 0;
        transform: translateX(4px);
        transition:
          opacity 0.3s,
          transform 0.3s;
      }
      &:hover {
        .n-icon {
          opacity: 1;
          transform: translateX(0);
        }
      }
    }
  }
  .hot-words {
    padding: 12px 4px;
    gap: 10px;
    .n-tag {
      cursor: pointer;
      font-size: 14px;
      padding: 0 16px;
    }
  }
  .song-item {
    .desc {
      &::before {
        content: "-";
        margin: 0 4px;
      }
    }
  }
}
</style>
