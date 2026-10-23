<!-- 第三方平台首页 -->
<template>
  <div class="home-platform">
    <!-- 登录态卡片区：与网易云首页同一套骨架（每日推荐 / 我喜欢的音乐 / 刷歌） -->
    <div v-if="isLoggedIn" class="main-rec">
      <div class="main-rec-grid">
        <n-flex :size="20" class="rec-list" justify="space-between" vertical>
          <!-- 每日推荐 -->
          <SongListCard
            :data="dailySongs"
            :cover="dailyCover"
            :title="dailySongsTitle"
            :height="90"
            :description="dailyDescription"
            size="small"
            @click="openDailyRecommend"
          />
          <!-- 我喜欢的音乐 -->
          <SongListCard
            :data="likedSongs"
            :cover="likedCover"
            :height="90"
            title="我喜欢的音乐"
            :description="likedDescription"
            size="small"
            @click="openLikedSongs"
          />
        </n-flex>
        <!-- 刷歌 -->
        <SongFM />
      </div>
      <!-- 取数失败：区块骨架保留，并给出重试入口 -->
      <n-alert v-if="cardError" type="error" class="card-error" :show-icon="false">
        <n-flex align="center" justify="space-between">
          <n-text>{{ cardError }}</n-text>
          <n-button size="small" secondary @click="loadCards">重试</n-button>
        </n-flex>
      </n-alert>
    </div>
    <!-- 公共区块：按「首页栏目配置」的显隐与顺序渲染 -->
    <template v-for="section in sortedSections" :key="section.key">
      <!-- 精选歌单 -->
      <div v-if="section.key === 'square'" class="rec-public">
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
        <CoverList
          :data="squarePlaylists"
          type="playlist"
          :loading="loading"
          :empty-description="squareError ? '精选歌单加载失败，点击重试' : undefined"
        />
        <div v-if="squareError" class="retry">
          <n-button size="small" secondary @click="loadPublicSections">重试</n-button>
        </div>
      </div>
      <!-- 热搜词 -->
      <div v-else class="rec-public">
        <n-flex class="title" align="center" justify="space-between">
          <n-h3 prefix="bar">
            <n-text>热搜词</n-text>
          </n-h3>
        </n-flex>
        <n-flex v-if="hotWords.length" class="hot-words" align="center" :wrap="true">
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
        <n-empty
          v-else
          :description="hotError ? '热搜词加载失败，点击重试' : '暂无热搜词'"
          size="large"
        >
          <template #icon>
            <SvgIcon name="SearchOff" />
          </template>
        </n-empty>
        <div v-if="hotError" class="retry">
          <n-button size="small" secondary @click="loadPublicSections">重试</n-button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { CoverType, SongType } from "@/types/main";
import { NText } from "naive-ui";
import { onPlatformChange, useMusicStore, usePlatformStore, useSettingStore } from "@/stores";
import {
  dispatchHotSearch,
  dispatchLikedSongs,
  dispatchSquarePlaylists,
  type DispatchHotSearchItem,
} from "@/api/platform/dispatch";
import { kgDailyRecommend, qqDailyRecommend } from "@/api/platform/daily";
import { useSongManager } from "@/core/player/SongManager";
import SvgIcon from "@/components/Global/SvgIcon.vue";
import CoverList from "@/components/List/CoverList.vue";
import SongListCard from "@/components/Card/SongListCard.vue";
import SongFM from "@/components/Player/PlayerComponents/SongFM.vue";

const router = useRouter();
const platformStore = usePlatformStore();
const settingStore = useSettingStore();
const musicStore = useMusicStore();
const songManager = useSongManager();

/** 各区块取数失败时的统一提示文案 */
const ERROR_TEXT: Record<string, string> = {
  daily: "获取每日推荐失败，请重试",
  liked: "获取我喜欢的音乐失败，请重试",
  fm: "获取刷歌推荐失败，请重试",
  square: "获取精选歌单失败，请重试",
  hot: "获取热搜词失败，请重试",
};

// 精选歌单
const squarePlaylists = ref<CoverType[]>([]);
// 热搜词
const hotWords = ref<DispatchHotSearchItem[]>([]);
// 每日推荐曲目与封面
const dailySongs = ref<SongType[]>([]);
const dailyCover = ref<string>("");
// 我喜欢的音乐曲目与封面
const likedSongs = ref<SongType[]>([]);
const likedCover = ref<string>("");
const likedCount = ref<number>(0);
// 公共区块加载状态
const loading = ref<boolean>(true);
// 卡片区失败提示
const cardError = ref<string>("");
// 公共区块失败标记
const squareError = ref<boolean>(false);
const hotError = ref<boolean>(false);

/** 已取数的卡片区标识（平台 + 登录态），避免同一次切台重复取数 */
let cardsKey = "";

/** 卡片区已载入的平台，换平台时先清掉上一平台的数据 */
let cardsPlatform = "";

/** 当前平台是否已登录（与网易云一致：未登录时不展示卡片区） */
const isLoggedIn = computed<boolean>(
  () => !!platformStore.platformProfiles[platformStore.currentPlatform],
);

/** 每日推荐标题（日历 + 当日日期 + 统一名称） */
const dailySongsTitle = computed(() => {
  const day = new Date().getDate();
  return h("div", { class: "date" }, [
    h("div", { class: "date-icon" }, [
      h(SvgIcon, { name: "Calendar-Empty", size: 30, depth: 2 }),
      h(NText, null, () => day),
    ]),
    h(NText, { class: "name text-hidden" }, () => ["每日推荐"]),
  ]);
});

/** 每日推荐卡副标题：首曲与曲目数 */
const dailyDescription = computed<string>(() => {
  const first = dailySongs.value[0];
  if (!first) return "根据你的音乐口味 · 每日更新";
  return `${first.name} · ${dailySongs.value.length} 首`;
});

/** 我喜欢的音乐卡副标题：曲目数 */
const likedDescription = computed<string>(() => {
  if (!likedCount.value) return "发现你独特的音乐品味";
  return `发现你独特的音乐品味 · ${likedCount.value} 首`;
});

/**
 * 首页栏目列表（按「首页栏目配置」的显隐与顺序）
 *
 * 网易云与第三方平台各用各的栏目表：网易云读 `homePageSections`，
 * 第三方平台读 `platformHomePageSections`。
 */
const sortedSections = computed(() =>
  settingStore.platformHomePageSections
    .filter((section) => section.visible)
    .sort((a, b) => a.order - b.order),
);

/**
 * 读取当前平台的每日推荐
 *
 * 平台侧没有每日推荐歌单号，界面统一显示网易云的名称「每日推荐」，
 * 平台原名（「今日推荐歌曲」/「每日歌曲推荐」）只留在数据层。
 * @returns 失败提示文案，成功时为空串
 */
const loadDaily = async (): Promise<string> => {
  try {
    const platform = platformStore.currentPlatform;
    const result = platform === "qqmusic" ? await qqDailyRecommend() : await kgDailyRecommend();
    if (result.code !== 200 || !result.data) {
      dailySongs.value = [];
      dailyCover.value = "";
      return ERROR_TEXT.daily;
    }
    dailySongs.value = result.data.songs;
    dailyCover.value = result.data.cover;
    return "";
  } catch (error) {
    console.error("获取每日推荐失败：", error);
    dailySongs.value = [];
    dailyCover.value = "";
    return ERROR_TEXT.daily;
  }
};

/**
 * 读取当前平台的「我喜欢的音乐」
 *
 * 走与「我喜欢的音乐」页同一条取数路径，保证卡片与页面指向同一张歌单。
 * @returns 失败提示文案，成功时为空串
 */
const loadLiked = async (): Promise<string> => {
  try {
    const platform = platformStore.currentPlatform;
    const result = await dispatchLikedSongs(platform, { page: 1, pageSize: 3 });
    likedSongs.value = result.tracks;
    likedCover.value = result.detail?.cover ?? "";
    likedCount.value = result.count;
    return "";
  } catch (error) {
    console.error("获取我喜欢的音乐失败：", error);
    likedSongs.value = [];
    likedCover.value = "";
    likedCount.value = 0;
    return ERROR_TEXT.liked;
  }
};

/**
 * 读取刷歌推荐流
 *
 * 推荐流列表由全局音乐 store 持有，首页卡片与全屏刷歌界面共用同一份数据；
 * 列表为空或不属于当前平台时由管理器重新取数。
 * @returns 失败提示文案，成功时为空串
 */
const loadSongFM = async (): Promise<string> => {
  try {
    await songManager.initPersonalFM();
    if (!musicStore.personalFMSong?.id) return ERROR_TEXT.fm;
    return "";
  } catch (error) {
    console.error("获取刷歌推荐失败：", error);
    return ERROR_TEXT.fm;
  }
};

/**
 * 读取卡片区数据
 *
 * 三张卡各自取数，任一失败只影响对应卡片；
 * 失败信息汇总成一条提示，区块骨架保留并给出重试入口。
 */
const loadCards = async () => {
  const results = await Promise.all([loadDaily(), loadLiked(), loadSongFM()]);
  const errors = results.filter(Boolean);
  cardError.value = errors.join("；");
  if (errors.length) {
    window.$message.error(errors[0]);
  }
};

/** 清空卡片区数据 */
const clearCards = () => {
  dailySongs.value = [];
  dailyCover.value = "";
  likedSongs.value = [];
  likedCover.value = "";
  likedCount.value = 0;
};

/**
 * 按当前平台与登录态取卡片区数据
 *
 * 同一平台同一登录态只取一次：切台与登录态变化会同时触发两条链路，
 * 用标识合并，避免重复请求（刷歌取数较重）。
 */
const ensureCards = async () => {
  const platform = platformStore.currentPlatform;
  const key = `${platform}:${isLoggedIn.value ? "in" : "out"}`;
  if (!isLoggedIn.value) {
    cardsKey = key;
    cardsPlatform = platform;
    clearCards();
    return;
  }
  if (key === cardsKey) return;
  // 换平台时先清掉上一平台的卡片数据，
  // 避免新平台的数据到达前，界面上还显示着别的平台的曲目
  if (cardsPlatform !== platform) clearCards();
  cardsKey = key;
  cardsPlatform = platform;
  await loadCards();
};

/**
 * 读取公共区块数据（精选歌单 / 热搜词）
 *
 * 区块标题常驻：无数据时显示空态，取数失败时给出提示与重试入口。
 */
const loadPublicSections = async () => {
  const platform = platformStore.currentPlatform;
  loading.value = true;
  squareError.value = false;
  hotError.value = false;
  try {
    // 精选歌单
    try {
      const square = await dispatchSquarePlaylists(platform, { limit: 12 });
      squarePlaylists.value = square.playlists;
    } catch (error) {
      console.error("获取平台精选歌单失败：", error);
      squarePlaylists.value = [];
      squareError.value = true;
      window.$message.error(ERROR_TEXT.square);
    }
    try {
      // 热搜词
      hotWords.value = await dispatchHotSearch(platform);
    } catch (error) {
      console.error("获取平台热搜失败：", error);
      hotWords.value = [];
      hotError.value = true;
      window.$message.error(ERROR_TEXT.hot);
    }
  } finally {
    loading.value = false;
  }
};

/**
 * 读取当前平台的首页数据
 */
const loadData = async () => {
  cardsKey = "";
  cardError.value = "";
  await loadPublicSections();
  await ensureCards();
};

/**
 * 进入平台每日推荐页
 *
 * 平台侧没有每日推荐歌单号，但每日推荐本身是一组当日曲目，
 * 按网易云每日推荐卡的形态进入列表页浏览。
 */
const openDailyRecommend = () => {
  router.push({ name: "platform-daily-songs" });
};

/** 进入「我喜欢的音乐」页 */
const openLikedSongs = () => {
  router.push({ name: "like-songs" });
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

// 登录态变化：登录后加载卡片区，登出后清空
watch(isLoggedIn, () => {
  ensureCards();
});

// 首次挂载与首次激活会连续触发，只取数一次
let activatedOnce = false;

onMounted(loadData);

onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true;
    return;
  }
  loadData();
});

onUnmounted(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.home-platform {
  width: 100%;
  .main-rec {
    .main-rec-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
    }
    .date {
      display: flex;
      align-items: center;
      margin-bottom: 4px;
      .date-icon {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: 4px;
        .n-text {
          position: absolute;
          font-size: 12px;
          color: var(--primary-hex);
          line-height: normal;
          margin-top: 4px;
          transform: scale(0.8);
        }
      }
      .name {
        font-size: 18px;
        font-weight: bold;
      }
    }
    .card-error {
      margin-top: 12px;
    }
    @media (max-width: 768px) {
      .main-rec-grid {
        grid-template-columns: repeat(1, 1fr);
      }
      .rec-list {
        display: grid !important;
        grid-template-columns: repeat(2, 1fr);
      }
    }
  }
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
  .retry {
    display: flex;
    justify-content: center;
    padding: 0 4px 12px;
  }
}
</style>
