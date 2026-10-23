<template>
  <div class="radio-type">
    <div class="type-title">
      <n-button class="back" secondary strong round @click="router.push('/radio-hot')">
        <template #icon>
          <SvgIcon name="NavigateBefore" />
        </template>
        返回全部
      </n-button>
      <n-h1 class="title">{{ radioName }}</n-h1>
    </div>
    <!-- 酷狗：听书频道下的专辑列表 -->
    <CoverList
      v-if="isKugou"
      :data="audiobookAlbums"
      :loading="audiobookLoading"
      type="radio"
      :load-more="audiobookHasMore"
      @load-more="loadMoreAudiobook"
    />
    <!-- 网易云：播客分类 -->
    <n-tabs v-else class="tabs" type="segment" animated>
      <!-- 类别热门 -->
      <n-tab-pane name="type-hot" tab="热门">
        <CoverList :data="radioHotData" :loading="true" type="radio" />
      </n-tab-pane>
      <n-tab-pane name="type-rec" tab="推荐">
        <CoverList :data="radioRecData" :loading="true" type="radio" />
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { radioCatHot, radioCatRecommend } from "@/api/radio";
import type { CoverType } from "@/types/main";
import { kgAudiobookList } from "@/api/platform/kugouAudiobook";
import { onPlatformChange, usePlatformStore } from "@/stores";
import { formatCoverList } from "@/utils/format";

const router = useRouter();
const platformStore = usePlatformStore();

// 当前平台是否为酷狗（酷狗下该入口是听书）
const isKugou = computed<boolean>(() => platformStore.currentPlatform === "kugou");

// 播客数据
const radioId = ref<number>(Number(router.currentRoute.value.query.id as string));
const radioName = ref<string>(router.currentRoute.value.query.name as string);
const radioHotData = ref<CoverType[]>([]);
const radioRecData = ref<CoverType[]>([]);

// 酷狗听书：频道标识与专辑列表
const audiobookSlug = ref<string>(String(router.currentRoute.value.query.id ?? ""));
const audiobookAlbums = ref<CoverType[]>([]);
const audiobookPage = ref<number>(1);
const audiobookHasMore = ref<boolean>(false);
const audiobookLoading = ref<boolean>(false);

// 每个频道每页取回的专辑条数
const AUDIOBOOK_PAGE_SIZE = 20;

// 获取播客分类数据
const getRadioTypeData = async () => {
  try {
    radioHotData.value = [];
    radioRecData.value = [];
    // 获取推荐
    const [recHot, recRec] = await Promise.all([
      radioCatHot(radioId.value),
      radioCatRecommend(radioId.value),
    ]);
    // 热门数据
    radioHotData.value = formatCoverList(recHot.djRadios);
    // 推荐数据
    radioRecData.value = formatCoverList(recRec.djRadios);
  } catch (error) {
    console.error("Error getting rec radio:", error);
    window.$message.error("获取电台分类出现错误");
  }
};

// 获取酷狗听书频道下的专辑列表
// @param append 是否追加到已有列表（加载下一页）
const getAudiobookTypeData = async (append = false) => {
  if (!audiobookSlug.value) return;
  audiobookLoading.value = true;
  try {
    const page = append ? audiobookPage.value + 1 : 1;
    const result = await kgAudiobookList(audiobookSlug.value, page, AUDIOBOOK_PAGE_SIZE);
    audiobookPage.value = page;
    audiobookHasMore.value = result.hasMore;
    audiobookAlbums.value = append ? [...audiobookAlbums.value, ...result.albums] : result.albums;
  } catch (error) {
    console.error("Error getting kugou audiobook list:", error);
    window.$message.error("获取听书专辑出现错误");
  } finally {
    audiobookLoading.value = false;
  }
};

// 加载更多听书专辑
const loadMoreAudiobook = () => {
  if (audiobookLoading.value || !audiobookHasMore.value) return;
  getAudiobookTypeData(true);
};

// 按当前平台加载数据
const loadData = () => {
  if (isKugou.value) {
    audiobookAlbums.value = [];
    audiobookPage.value = 1;
    audiobookHasMore.value = false;
    getAudiobookTypeData();
    return;
  }
  getRadioTypeData();
};

onBeforeRouteUpdate((to) => {
  if (to.name !== "radio-type") return;
  if (isKugou.value) {
    audiobookSlug.value = String(to.query.id ?? "");
    radioName.value = to.query.name as string;
    loadData();
    return;
  }
  radioId.value = Number(to.query.type as string);
  radioName.value = to.query.name as string;
  getRadioTypeData();
});

onActivated(() => {
  const id = Number(router.currentRoute.value.query.id as string);
  const name = router.currentRoute.value.query.name as string;
  if (isKugou.value) {
    const slug = String(router.currentRoute.value.query.id ?? "");
    if (slug !== audiobookSlug.value || name !== radioName.value) {
      audiobookSlug.value = slug;
      radioName.value = name;
      loadData();
    }
    return;
  }
  if (id !== radioId.value || name !== radioName.value) {
    radioId.value = id;
    radioName.value = name;
    getRadioTypeData();
  }
});

onMounted(loadData);

// 平台切换：按新平台重取数据，不残留上一平台的内容
const stopPlatformWatch = onPlatformChange(() => {
  // 页面被 KeepAlive 缓存：离开本页后仍会收到平台变更通知，此时不处理
  if (router.currentRoute.value.name !== "radio-type") return;
  radioHotData.value = [];
  radioRecData.value = [];
  audiobookAlbums.value = [];
  audiobookPage.value = 1;
  audiobookHasMore.value = false;
  loadData();
});

onUnmounted(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.radio-type {
  .type-title {
    margin-top: 12px;
    .title {
      margin: 16px 0 20px 0;
      font-size: 36px;
      font-weight: bold;
    }
  }
  .tabs {
    :deep(.n-tab-pane) {
      padding-top: 20px;
    }
  }
}
</style>
