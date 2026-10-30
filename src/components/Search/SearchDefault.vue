<template>
  <Transition name="fadeDown" mode="out-in" @before-enter="getSearchHotData">
    <n-card v-if="isShow" class="search-default" content-style="padding: 0">
      <n-scrollbar class="scrollbar">
        <!-- 搜索历史 -->
        <div v-if="isShowSearchHistory" class="history">
          <div class="title">
            <SvgIcon name="History" />
            <n-text class="name">搜索历史 </n-text>
            <SvgIcon class="delete" name="Delete" @click.stop="deleteSearchHistory" />
          </div>
          <n-flex class="history-list">
            <n-tag
              v-for="(item, index) in dataStore.searchHistory"
              :key="index"
              :bordered="false"
              round
              @click="emit('toSearch', item)"
            >
              {{ item.length > 10 ? item.slice(0, 10) + "..." : item }}
            </n-tag>
          </n-flex>
        </div>
        <!-- 热搜榜 -->
        <div v-if="isShowHotSearch" class="hot-list">
          <div class="title">
            <SvgIcon name="Fire" />
            <n-text class="name">热搜榜 </n-text>
          </div>
          <div
            v-for="(item, index) in searchHotData"
            :key="index"
            class="hot-item"
            @click="emit('toSearch', item?.searchWord)"
          >
            <n-text class="num" depth="3">{{ index + 1 }}</n-text>
            <div class="data">
              <div class="name">
                <n-text class="text">{{ item?.searchWord }}</n-text>
                <n-tag
                  v-if="item.iconUrl"
                  :type="item.iconType == 1 ? 'error' : 'warning'"
                  :bordered="false"
                  size="small"
                  round
                >
                  {{ item.iconType === 1 ? "HOT" : "UP" }}
                </n-tag>
              </div>
              <n-text class="content" depth="3">{{ item.content }}</n-text>
            </div>
            <div v-if="item.score !== undefined" class="hot">
              <SvgIcon name="Fire" />
              <n-text class="hot-num">{{ item.score }} </n-text>
            </div>
          </div>
        </div>
      </n-scrollbar>
    </n-card>
  </Transition>
</template>

<script setup lang="ts">
import { dispatchHotSearch } from "@/api/platform/dispatch";
import { getCacheData } from "@/utils/cache";
import {
  onPlatformChange,
  useSettingStore,
  useStatusStore,
  useDataStore,
  usePlatformStore,
} from "@/stores";

interface SearchHotItem {
  searchWord: string;
  score?: number;
  content: string;
  iconUrl?: string;
  iconType?: number;
}

const emit = defineEmits<{
  toSearch: [keyword: string];
}>();

const dataStore = useDataStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();
const platformStore = usePlatformStore();

const searchHotData = ref<SearchHotItem[]>([]);
// 热搜请求序号：平台切换时作废在途响应，避免上一个平台的热搜串味
const hotRequestId = ref<number>(0);

// 是否展示
const isShow = computed(() => {
  return (
    !statusStore.searchInputValue &&
    statusStore.searchFocus &&
    (isShowHotSearch.value || isShowSearchHistory.value)
  );
});

// 是否展示搜索历史
const isShowSearchHistory = computed(() => {
  return settingStore.showSearchHistory && dataStore.searchHistory.length > 0;
});

// 是否展示热搜榜
const isShowHotSearch = computed(() => {
  return (
    settingStore.useOnlineService && settingStore.showHotSearch && searchHotData.value.length > 0
  );
});

// 获取热搜数据
const getSearchHotData = async () => {
  if (!settingStore.useOnlineService || !settingStore.showHotSearch) return;
  const platform = platformStore.currentPlatform;
  // 请求序号：后发起的请求作废先发起的响应，避免旧结果覆盖新结果
  const currentId = ++hotRequestId.value;
  // 网易云沿用既有缓存键，其余平台按平台隔离缓存
  const cacheKey = platform === "netease" ? "searchHotData" : `searchHotData-${platform}`;
  try {
    const result = await getCacheData(() => dispatchHotSearch(platform), {
      key: cacheKey,
      time: 10,
      // 空结果不写缓存，避免上游失败时把空态固化
      skipEmpty: true,
    });
    // 序号不一致说明期间已切换平台，丢弃本次响应
    if (currentId !== hotRequestId.value) return;
    // 平台已切换，丢弃本次响应，避免上一个平台的热搜串味
    if (platform !== platformStore.currentPlatform) return;
    searchHotData.value = result ?? [];
  } catch (error) {
    console.error("获取热搜数据失败：", error);
    // 取数失败时清空，不保留上一个平台的数据
    if (currentId !== hotRequestId.value) return;
    searchHotData.value = [];
  }
};

// 删除搜索历史
const deleteSearchHistory = () => {
  window.$dialog.warning({
    title: "删除搜索历史",
    content: "确认删除全部的搜索历史？这将无法恢复！",
    positiveText: "确认",
    negativeText: "取消",
    onPositiveClick: () => {
      dataStore.searchHistory = [];
    },
  });
};

onMounted(() => {
  getSearchHotData();
});

// 平台切换后按新平台重新取热搜
const stopPlatformWatch = onPlatformChange(() => {
  // 作废在途响应，避免旧平台的热搜覆盖新平台
  hotRequestId.value += 1;
  // 清空旧平台的热搜，避免切换瞬间串味
  searchHotData.value = [];
  getSearchHotData();
});

onUnmounted(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.search-default {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: 50px;
  width: 300px;
  border-radius: 8px;
  z-index: 1502;
  &.fadeDown-enter-to {
    transition-delay: 0.25s;
  }
  :deep(.scrollbar) {
    max-height: calc(100vh - 160px);
    .n-scrollbar-content {
      padding: 10px;
    }
  }
  @media (max-width: 768px) {
    width: 100%;
  }
  .title {
    display: flex;
    flex-direction: row;
    align-items: center;
    margin-bottom: 12px;
    .n-icon {
      font-size: 18px;
      margin-right: 4px;
    }
  }
  .history {
    margin-bottom: 20px;
    .delete {
      margin-left: auto;
      opacity: 0.6;
      transition: opacity 0.3s;
      cursor: pointer;
      &:hover {
        opacity: 1;
      }
    }
  }
  .hot-list {
    .hot-item {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      border-radius: 8px;
      padding: 6px;
      transition: background-color 0.3s;
      cursor: pointer;
      .num {
        width: 30px;
        height: 30px;
        min-width: 30px;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        margin-right: 8px;
      }
      .data {
        flex: 1;
        width: 100%;
        padding-right: 8px;
        .name {
          font-size: 16px;
          display: flex;
          flex-direction: row;
          align-items: center;
          .text {
            margin-right: 8px;
          }
        }
      }
      .n-tag {
        pointer-events: none;
      }
      .hot {
        display: flex;
        flex-direction: row;
        align-items: center;
        font-size: 12px;
        opacity: 0.6;
        .n-icon {
          font-size: 14px;
        }
      }
      &:last-child {
        margin-bottom: 0;
      }
      &:hover {
        background-color: rgba(var(--primary), 0.12);
      }
    }
  }
}
</style>
