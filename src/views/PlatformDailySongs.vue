<!-- 平台每日推荐（QQ 音乐 / 酷狗音乐） -->
<template>
  <div class="platform-daily-songs">
    <!-- 头部：封面 / 标题 / 日期 -->
    <div class="header">
      <n-image
        :src="cover"
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
        <n-text class="name">每日推荐</n-text>
        <n-text class="tip" depth="3">{{ tipText }}</n-text>
        <n-flex class="menu">
          <n-button
            :focusable="false"
            :loading="loading"
            type="primary"
            size="large"
            strong
            secondary
            round
            @click="playAll"
          >
            <template #icon>
              <SvgIcon name="Play" />
            </template>
            播放全部
          </n-button>
          <!-- 刷新 -->
          <n-button
            :focusable="false"
            :loading="loading"
            size="large"
            class="more"
            circle
            strong
            secondary
            @click="loadDaily"
          >
            <template #icon>
              <SvgIcon name="Refresh" />
            </template>
          </n-button>
        </n-flex>
      </div>
    </div>
    <!-- 取数失败：保留列表骨架并给出重试入口 -->
    <n-alert v-if="errorText" type="error" class="error" :show-icon="false">
      <n-flex align="center" justify="space-between">
        <n-text>{{ errorText }}</n-text>
        <n-button size="small" secondary @click="loadDaily">重试</n-button>
      </n-flex>
    </n-alert>
    <!-- 网易云：本页是第三方平台专属页，引导到网易云既有的「每日推荐」页 -->
    <n-empty
      v-if="neteaseGuide"
      class="guide"
      description="网易云的每日推荐在「每日推荐」页，本页为 QQ 音乐与酷狗音乐专属"
      size="large"
    >
      <template #icon>
        <SvgIcon name="Calendar-Empty" />
      </template>
      <template #extra>
        <n-button type="primary" secondary size="small" @click="goNeteaseDaily">
          前往「每日推荐」页
        </n-button>
      </template>
    </n-empty>
    <!-- 曲目列表 -->
    <SongList v-else :data="songs" :loading="loading" height="auto" disabledSort />
  </div>
</template>

<script setup lang="ts">
import type { SongType } from "@/types/main";
import { kgDailyRecommend, qqDailyRecommend } from "@/api/platform/daily";
import { usePlayerController } from "@/core/player/PlayerController";
import { onPlatformChange, usePlatformStore } from "@/stores";
import { coverLoaded } from "@/utils/helper";
import SvgIcon from "@/components/Global/SvgIcon.vue";
import SongList from "@/components/List/SongList.vue";

const platformStore = usePlatformStore();
const player = usePlayerController();
const router = useRouter();

// 加载状态
const loading = ref<boolean>(true);
// 当日曲目
const songs = ref<SongType[]>([]);
// 封面
const cover = ref<string>("");
// 定位日期（YYYYMMDD）
const date = ref<string>("");
// 失败提示
const errorText = ref<string>("");
// 网易云引导态：本页是第三方平台专属页，网易云走既有的「每日推荐」页
const neteaseGuide = ref<boolean>(false);

/** 头部日期文案 */
const dateText = computed<string>(() => {
  const value = date.value;
  if (!value || value.length < 8) return "每日更新";
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
});

/** 头部副标题：口味说明 + 日期 + 曲目数 */
const tipText = computed<string>(
  () => `根据你的音乐口味 · ${dateText.value} · ${songs.value.length} 首`,
);

/**
 * 读取当前平台的每日推荐
 *
 * 平台侧没有每日推荐歌单号，取数由平台每日推荐模块给出，
 * 失败时保留列表骨架并给出重试入口。
 *
 * 三个平台显式分支：网易云没有平台每日推荐（走既有的「每日推荐」页），
 * 因此不发起请求；QQ 音乐与酷狗各走自己的每日推荐模块。
 */
const loadDaily = async () => {
  loading.value = true;
  errorText.value = "";
  neteaseGuide.value = false;
  try {
    const platform = platformStore.currentPlatform;
    // 网易云：本页没有对应数据源，只给引导
    if (platform === "netease") {
      songs.value = [];
      cover.value = "";
      date.value = "";
      neteaseGuide.value = true;
      return;
    }
    const result = platform === "qqmusic" ? await qqDailyRecommend() : await kgDailyRecommend();
    if (result.code !== 200 || !result.data) {
      songs.value = [];
      cover.value = "";
      date.value = "";
      errorText.value = result.message || "获取每日推荐失败，请重试";
      return;
    }
    songs.value = result.data.songs;
    cover.value = result.data.cover;
    date.value = result.data.date;
  } catch (error) {
    console.error("获取平台每日推荐失败：", error);
    songs.value = [];
    cover.value = "";
    date.value = "";
    errorText.value = "获取每日推荐失败，请重试";
  } finally {
    loading.value = false;
  }
};

/** 播放全部：当日曲目整体进入播放队列并从第一首开始播放 */
const playAll = async () => {
  if (!songs.value.length) {
    window.$message.error("每日推荐暂无歌曲");
    return;
  }
  await player.updatePlayList(songs.value);
};

/** 前往网易云既有的「每日推荐」页 */
const goNeteaseDaily = () => {
  router.push({ name: "daily-songs" });
};

// 平台切换：按新平台重取每日推荐
const stopPlatformWatch = onPlatformChange(() => {
  loadDaily();
});

onUnmounted(() => {
  stopPlatformWatch();
});

// 首次挂载与首次激活会连续触发，只取数一次
let activatedOnce = false;

onMounted(loadDaily);

onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true;
    return;
  }
  loadDaily();
});
</script>

<style lang="scss" scoped>
.platform-daily-songs {
  .header {
    display: flex;
    align-items: center;
    gap: 24px;
    margin-bottom: 20px;
    .cover {
      width: 180px;
      height: 180px;
      min-width: 180px;
      border-radius: 8px;
      overflow: hidden;
      background: rgba(var(--primary), 0.06);
      :deep(img) {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }
    .cover-loading {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      .loading-img {
        width: 60%;
        height: 60%;
        object-fit: cover;
      }
    }
    .info {
      display: flex;
      flex-direction: column;
      min-width: 0;
      .name {
        font-size: 32px;
        font-weight: bold;
        line-height: normal;
      }
      .tip {
        margin-top: 8px;
        font-size: 14px;
      }
      .menu {
        margin-top: 20px;
        gap: 12px;
      }
    }
  }
  .error {
    margin-bottom: 16px;
  }
  .guide {
    margin-top: 40px;
  }
  .song-list {
    height: auto;
  }
}
</style>
