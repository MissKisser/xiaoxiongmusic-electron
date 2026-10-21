<!-- 刷歌（QQ 音乐推荐流，对应网易云的「私人 FM」） -->
<template>
  <div class="song-fm">
    <!-- 当前曲目 -->
    <n-card class="current">
      <n-flex align="center" justify="space-between" class="header">
        <n-text class="title">刷歌</n-text>
        <n-text class="source" depth="3">
          {{ sourceText }}
        </n-text>
      </n-flex>
      <div class="body">
        <n-image
          :key="currentSong?.id"
          :src="currentSong?.coverSize?.m || currentSong?.cover"
          class="cover"
          preview-disabled
          lazy
          @load="coverLoaded"
        >
          <template #placeholder>
            <div class="cover-loading">
              <img src="/images/song.jpg?asset" class="loading-img" alt="loading-img" />
            </div>
          </template>
        </n-image>
        <div class="info">
          <n-text class="name text-hidden">
            {{ currentSong?.name || "暂无曲目" }}
          </n-text>
          <div v-if="currentArtists.length" class="artists text-hidden">
            <SvgIcon name="Artist" :depth="3" />
            <n-text v-for="artist in currentArtists" :key="artist.id" class="ar">
              {{ artist.name }}
            </n-text>
          </div>
          <div v-if="currentAlbum?.name" class="album text-hidden">
            <SvgIcon name="Album" :depth="3" />
            <n-text class="album-text">{{ currentAlbum.name }}</n-text>
          </div>
          <n-flex :wrap="false" class="menu" align="center">
            <n-button
              :loading="statusStore.personalFmMode && statusStore.playLoading"
              :focusable="false"
              class="play"
              strong
              secondary
              circle
              @click.stop="fmPlayOrPause"
            >
              <template #icon>
                <Transition name="fade" mode="out-in">
                  <SvgIcon :key="playIcon" :name="playIcon" :size="32" />
                </Transition>
              </template>
            </n-button>
            <n-button :focusable="false" class="next" secondary circle @click.stop="fmPlayNext">
              <template #icon>
                <SvgIcon name="SkipNext" :size="26" />
              </template>
            </n-button>
            <n-button :focusable="false" class="refresh" secondary circle @click.stop="fmRefresh">
              <template #icon>
                <SvgIcon name="Refresh" :size="24" />
              </template>
            </n-button>
          </n-flex>
        </div>
      </div>
    </n-card>
    <!-- 推荐流 -->
    <div class="list">
      <n-flex align="center" justify="space-between" class="list-header">
        <n-text class="list-title">推荐流</n-text>
        <n-text class="list-count" depth="3">{{ fmSongs.length }} 首</n-text>
      </n-flex>
      <SongList :data="fmSongs" :loading="loading" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePlayerController } from "@/core/player/PlayerController";
import { useSongManager } from "@/core/player/SongManager";
import { useMusicStore, useStatusStore } from "@/stores";
import type { MetaData } from "@/types/main";
import { coverLoaded } from "@/utils/helper";
import { debounce } from "lodash-es";

const musicStore = useMusicStore();
const statusStore = useStatusStore();

const player = usePlayerController();
const songManager = useSongManager();

// 加载状态
const loading = ref<boolean>(false);

// 推荐流曲目
const fmSongs = computed(() => musicStore.personalFM.list);

// 当前曲目
const currentSong = computed(() => musicStore.personalFMSong);

// 当前曲目的歌手列表
const currentArtists = computed<MetaData[]>(() => {
  const artists = currentSong.value?.artists;
  return Array.isArray(artists) ? artists : [];
});

// 当前曲目的专辑
const currentAlbum = computed<MetaData | null>(() => {
  const album = currentSong.value?.album;
  if (!album) return null;
  return typeof album === "string" ? { id: 0, name: album } : album;
});

// 推荐来源说明
const sourceText = "QQ 音乐推荐流";

// 播放图标
const playIcon = computed(() =>
  statusStore.personalFmMode ? (statusStore.playStatus ? "Pause" : "Play") : "Play",
);

/**
 * 播放 / 暂停
 */
const fmPlayOrPause = async () => {
  if (statusStore.personalFmMode) {
    player.playOrPause();
    return;
  }
  await startSongFM();
};

/**
 * 开启刷歌：确保有推荐流后开始播放
 */
const startSongFM = async () => {
  loading.value = true;
  try {
    if (musicStore.personalFM.list.length === 0) {
      await songManager.initPersonalFM();
    }
    if (!musicStore.personalFMSong?.id) {
      window.$message.error("开启刷歌出错，请重试");
      return;
    }
    statusStore.personalFmMode = true;
    statusStore.shuffleMode = "off";
    await player.playSong();
  } finally {
    loading.value = false;
  }
};

/**
 * 下一首
 */
const fmPlayNext = debounce(async () => {
  statusStore.personalFmMode = true;
  statusStore.shuffleMode = "off";
  await player.nextOrPrev("next");
}, 300);

/**
 * 换一批推荐流
 */
const fmRefresh = debounce(async () => {
  loading.value = true;
  try {
    await songManager.refreshPersonalFM();
    if (statusStore.personalFmMode) {
      await player.playSong();
    }
  } finally {
    loading.value = false;
  }
}, 300);

onMounted(async () => {
  if (musicStore.personalFM.list.length === 0) {
    loading.value = true;
    try {
      await songManager.initPersonalFM();
    } finally {
      loading.value = false;
    }
  }
});
</script>

<style lang="scss" scoped>
.song-fm {
  display: flex;
  flex-direction: column;
  gap: 20px;
  .current {
    :deep(.n-card-content) {
      display: flex;
      flex-direction: column;
      padding: 20px;
    }
    .header {
      margin-bottom: 16px;
      .title {
        font-size: 20px;
        font-weight: bold;
      }
      .source {
        font-size: 13px;
      }
    }
    .body {
      display: flex;
      align-items: center;
      .cover {
        width: 160px;
        height: 160px;
        min-width: 160px;
        border-radius: 8px;
        margin-right: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        background: var(--n-color-embedded, rgba(0, 0, 0, 0.04));
      }
      .cover-loading {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .loading-img {
        width: 60%;
        height: 60%;
        object-fit: cover;
      }
      .info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        .name {
          font-size: 22px;
          font-weight: bold;
        }
        .artists,
        .album {
          margin-top: 2px;
          font-size: 14px;
          display: flex;
          align-items: center;
          :deep(.n-icon) {
            font-size: 18px;
            margin-right: 4px;
            transform: translateY(3px);
          }
          .ar {
            display: inline-flex;
            opacity: 0.6;
            &::after {
              content: "/";
              margin: 0 4px;
            }
            &:last-child::after {
              display: none;
            }
          }
          .album-text {
            opacity: 0.6;
          }
        }
        .menu {
          margin-top: auto;
          gap: 12px;
          .play,
          .next,
          .refresh {
            width: 46px;
            height: 46px;
          }
        }
      }
    }
  }
  .list {
    .list-header {
      margin-bottom: 12px;
      .list-title {
        font-size: 16px;
        font-weight: bold;
      }
      .list-count {
        font-size: 13px;
      }
    }
  }
}
</style>
