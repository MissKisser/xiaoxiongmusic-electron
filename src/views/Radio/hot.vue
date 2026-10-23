<template>
  <div class="radio-hot">
    <!-- 酷狗：听书频道广场 -->
    <template v-if="isKugou">
      <!-- 频道 -->
      <div class="radio-type">
        <Transition name="fade" mode="out-in">
          <n-grid
            v-if="audiobookChannels.length > 0"
            :collapsed="gridCollapsed"
            x-gap="20"
            y-gap="20"
            cols="3 400:4 600:5 800:6 1000:7"
          >
            <n-gi v-for="(item, index) in audiobookChannels" :key="index">
              <n-card class="cat" hoverable @click="openChannel(item)">
                <n-text>{{ item.name }}</n-text>
              </n-card>
            </n-gi>
            <n-gi class="suffix" suffix #="{ overflow }">
              <n-card class="cat" hoverable @click="gridCollapsed = !gridCollapsed">
                <SvgIcon :name="overflow ? 'Down' : 'Up'" />
                <n-text>{{ overflow ? "查看全部" : "收起标签" }}</n-text>
              </n-card>
            </n-gi>
          </n-grid>
          <n-grid v-else x-gap="20" y-gap="20" cols="3 400:4 600:5 800:6 1000:7" collapsed>
            <n-gi v-for="item in 20" :key="item">
              <n-card class="cat" hoverable>
                <n-skeleton text round />
              </n-card>
            </n-gi>
          </n-grid>
        </Transition>
      </div>
      <!-- 各频道专辑流 -->
      <div class="rec">
        <template v-for="item in audiobookSections" :key="item.slug">
          <n-h3 class="title" prefix="bar">
            <n-text class="name">{{ item.name }}</n-text>
            <SvgIcon :size="26" name="Right" />
          </n-h3>
          <CoverList :data="item.albums" :loading="audiobookLoading" type="radio" />
        </template>
      </div>
    </template>
    <!-- 网易云：播客电台 -->
    <template v-else>
      <!-- 分类 -->
      <Transition name="fade" mode="out-in">
        <div v-if="radioTypeData?.length > 0" class="radio-type">
          <n-grid :collapsed="gridCollapsed" x-gap="20" y-gap="20" cols="3 400:4 600:5 800:6 1000:7">
            <n-gi v-for="(item, index) in radioTypeData" :key="index">
              <n-card
                class="cat"
                hoverable
                @click="
                  router.push({
                    path: '/radio-type',
                    query: {
                      id: item.id,
                      name: item.name,
                    },
                  })
                "
              >
                <n-text>{{ item.name }}</n-text>
              </n-card>
            </n-gi>
            <n-gi class="suffix" suffix #="{ overflow }">
              <n-card class="cat" hoverable @click="gridCollapsed = !gridCollapsed">
                <SvgIcon :name="overflow ? 'Down' : 'Up'" />
                <n-text>{{ overflow ? "查看全部" : "收起标签" }}</n-text>
              </n-card>
            </n-gi>
          </n-grid>
        </div>
        <div v-else class="radio-type">
          <n-grid x-gap="20" y-gap="20" cols="3 400:4 600:5 800:6 1000:7" collapsed>
            <n-gi v-for="item in 20" :key="item">
              <n-card class="cat" hoverable>
                <n-skeleton text round />
              </n-card>
            </n-gi>
          </n-grid>
        </div>
      </Transition>
      <!-- 推荐 -->
      <div class="rec">
        <!-- 热门推荐 -->
        <n-h3 class="title" prefix="bar">
          <n-text class="name">热门推荐</n-text>
        </n-h3>
        <CoverList :data="radioHotData" :loading="true" type="radio" />
        <!-- 分类推荐 -->
        <template v-for="(item, index) in radioCatRecData" :key="index">
          <n-h3 class="title" prefix="bar">
            <n-text class="name">{{ item.name }}</n-text>
            <SvgIcon :size="26" name="Right" />
          </n-h3>
          <CoverList :data="item.radio || []" :loading="true" type="radio" />
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { CoverType } from "@/types/main";
import { radioCatList, radioToplist, radioTypes } from "@/api/radio";
import { kgAudiobookCategories, kgAudiobookList, type KGAudiobookChannel } from "@/api/platform/kugouAudiobook";
import { onPlatformChange, usePlatformStore } from "@/stores";
import { getCacheData } from "@/utils/cache";
import { formatCoverList } from "@/utils/format";

interface RadioType {
  id: number;
  name: string;
  radio?: CoverType[];
}

/** 酷狗听书频道下的专辑流 */
interface AudiobookSection {
  slug: string;
  name: string;
  albums: CoverType[];
}

const router = useRouter();
const platformStore = usePlatformStore();

// 当前平台是否为酷狗（酷狗下该入口是听书）
const isKugou = computed<boolean>(() => platformStore.currentPlatform === "kugou");

// 栅格折叠
const gridCollapsed = ref<boolean>(true);

// 播客数据
const radioTypeData = ref<RadioType[]>([]);
const radioHotData = ref<CoverType[]>([]);
const radioCatRecData = ref<RadioType[]>([]);

// 酷狗听书数据
const audiobookChannels = ref<KGAudiobookChannel[]>([]);
const audiobookSections = ref<AudiobookSection[]>([]);
const audiobookLoading = ref<boolean>(true);

// 每个频道展示的专辑条数
const AUDIOBOOK_SECTION_LIMIT = 6;

// 获取播客分类
const getRadioType = async () => {
  try {
    const result = await getCacheData(radioCatList, {
      key: "radioTypeData",
      time: 0,
      storage: "localStorage",
    });
    radioTypeData.value = result.categories.map(({ name, id }) => ({ name, id }));
  } catch (error) {
    console.error("Error getting radio cat list:", error);
    window.$message.error("分类获取失败，请重试");
  }
};

// 获取推荐电台
const getRecRadioData = async () => {
  try {
    const [recRes, catRecRes] = await Promise.all([radioToplist("hot"), radioTypes()]);
    radioHotData.value = formatCoverList(recRes.toplist);
    radioCatRecData.value = catRecRes.data?.map((v: any) => ({
      id: v.categoryId,
      name: v.categoryName,
      radio: formatCoverList(v.radios),
    }));
  } catch (error) {
    console.error("Error getting rec radio:", error);
    window.$message.error("获取推荐电台出现错误");
  }
};

// 获取酷狗听书频道与各频道的专辑流
const getAudiobookData = async () => {
  audiobookLoading.value = true;
  try {
    const channels = await kgAudiobookCategories();
    audiobookChannels.value = channels;
    // 先占位，频道数据到达后逐个填入专辑流
    audiobookSections.value = channels.map((channel) => ({
      slug: channel.slug,
      name: channel.name,
      albums: [],
    }));
    const results = await Promise.allSettled(
      channels.map((channel) => kgAudiobookList(channel.slug, 1, AUDIOBOOK_SECTION_LIMIT)),
    );
    audiobookSections.value = channels.map((channel, index) => {
      const result = results[index];
      return {
        slug: channel.slug,
        name: channel.name,
        albums: result.status === "fulfilled" ? result.value.albums : [],
      };
    });
  } catch (error) {
    console.error("Error getting kugou audiobook data:", error);
    window.$message.error("听书内容获取失败，请重试");
  } finally {
    audiobookLoading.value = false;
  }
};

// 打开听书频道
const openChannel = (channel: { slug: string; name: string }) => {
  router.push({
    path: "/radio-type",
    query: {
      id: channel.slug,
      name: channel.name,
    },
  });
};

// 按当前平台加载数据
const loadData = async () => {
  if (isKugou.value) {
    audiobookChannels.value = [];
    audiobookSections.value = [];
    await getAudiobookData();
    return;
  }
  await getRadioType();
  await getRecRadioData();
};

onMounted(() => {
  loadData();
});

// 平台切换：按新平台重取数据，不残留上一平台的内容
const stopPlatformWatch = onPlatformChange(() => {
  // 页面被 KeepAlive 缓存：离开本页后仍会收到平台变更通知，此时不处理
  if (router.currentRoute.value.name !== "radio-hot") return;
  radioTypeData.value = [];
  radioHotData.value = [];
  radioCatRecData.value = [];
  audiobookChannels.value = [];
  audiobookSections.value = [];
  loadData();
});

onUnmounted(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.radio-hot {
  .radio-type {
    margin: 12px 0 30px;
    transition: opacity 0.2s;
    .cat {
      height: 48px;
      border-radius: 8px;
      cursor: pointer;
      :deep(.n-card-content) {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px;
      }
      .n-icon {
        margin-right: 4px;
      }
    }
  }
  .rec {
    .title {
      margin: 0;
      display: flex;
      align-items: center;
      width: max-content;
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
}
</style>
