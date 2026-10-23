<template>
  <div
    :key="artistId"
    :class="['artist', { small: listScrolling }]"
    :style="{ '--detail-height': `${detailHeight}px` }"
    ref="artistPageRef"
    @transitionend="handleDetailTransitionEnd"
  >
    <Transition name="fade" mode="out-in">
      <div v-if="artistDetailData" class="detail">
        <div class="cover">
          <n-image
            :src="artistDetailData.coverSize?.m || artistDetailData.cover"
            :previewed-img-props="{ style: { borderRadius: '8px' } }"
            :preview-src="artistDetailData.cover"
            :renderToolbar="renderToolbar"
            show-toolbar-tooltip
            class="cover-img"
            @load="coverLoaded"
          >
            <template #placeholder>
              <div class="cover-loading">
                <img src="/images/artist.jpg?asset" class="loading-img" alt="loading-img" />
              </div>
            </template>
          </n-image>
          <!-- 封面背板 -->
          <n-image
            class="cover-shadow"
            preview-disabled
            :src="artistDetailData.coverSize?.m || artistDetailData.cover"
          />
        </div>
        <div class="data" ref="dataRef">
          <div class="name text-hidden">
            <n-text class="name-text">{{ artistDetailData.name || "未知艺术家" }}</n-text>
            <n-text v-if="artistDetailData?.alia" class="name-alias" depth="3">
              {{ artistDetailData.alia || "未知艺术家" }}
            </n-text>
          </div>
          <n-collapse-transition :show="!listScrolling" class="collapse">
            <!-- 职业 -->
            <n-text v-if="artistDetailData?.identify" :depth="3" class="identify text-hidden">
              {{ artistDetailData.identify }}
            </n-text>
            <!-- 信息 -->
            <n-flex class="meta" :wrap="false">
              <div class="item" @click="router.push({ name: 'artist-songs', query: artistQuery })">
                <SvgIcon name="Music" :depth="3" />
                <n-text>{{ artistDetailData.musicSize || 0 }}</n-text>
              </div>
              <div class="item" @click="router.push({ name: 'artist-albums', query: artistQuery })">
                <SvgIcon name="Album" :depth="3" />
                <n-text>{{ artistDetailData.albumSize || 0 }}</n-text>
              </div>
              <div
                v-if="!isPlatformSource"
                class="item"
                @click="router.push({ name: 'artist-videos', query: artistQuery })"
              >
                <SvgIcon name="Video" :depth="3" />
                <n-text>{{ artistDetailData.mvSize || 0 }}</n-text>
              </div>
            </n-flex>
            <!-- 简介 -->
            <n-text
              v-if="artistDetailData.description"
              class="description text-hidden"
              @click="openDescModal(artistDetailData.description, '歌手简介')"
            >
              {{ artistDetailData.description }}
            </n-text>
          </n-collapse-transition>
          <n-flex class="menu" align="center" :wrap="false">
            <n-flex class="left" align="center" :wrap="false">
              <n-button
                :focusable="false"
                type="primary"
                strong
                secondary
                round
                @click="playAllSongs"
              >
                <template #icon>
                  <SvgIcon name="Play" />
                </template>
                播放
              </n-button>
              <n-button
                v-if="!isPlatformSource"
                :focusable="false"
                strong
                secondary
                round
                @click="toLikeArtist(Number(artistId), !isLikeArtist)"
              >
                <template #icon>
                  <SvgIcon :name="isLikeArtist ? 'Favorite' : 'FavoriteBorder'" />
                </template>
                {{ isLikeArtist ? "取消关注" : "关注歌手" }}
              </n-button>
              <!-- 更多 -->
              <n-dropdown :options="moreOptions" trigger="click" placement="bottom-start">
                <n-button :focusable="false" class="more" circle strong secondary>
                  <template #icon>
                    <SvgIcon name="List" />
                  </template>
                </n-button>
              </n-dropdown>
            </n-flex>
          </n-flex>
        </div>
      </div>
      <div v-else class="detail">
        <n-skeleton class="cover" />
        <div class="data">
          <n-skeleton :repeat="4" text />
        </div>
      </div>
    </Transition>
    <!-- 标签页 -->
    <n-tabs v-model:value="artistType" class="tabs" type="segment" @update:value="tabChange">
      <n-tab name="artist-songs"> 单曲 </n-tab>
      <n-tab name="artist-albums"> 专辑 </n-tab>
      <n-tab v-if="!isPlatformSource" name="artist-videos"> 视频 </n-tab>
    </n-tabs>
    <!-- 路由 -->
    <RouterView v-slot="{ Component }">
      <Transition :name="`router-${settingStore.routeAnimation}`" mode="out-in">
        <KeepAlive v-if="settingStore.useKeepAlive">
          <component
            ref="componentRef"
            :is="Component"
            :id="artistId"
            :platform="routePlatform"
            class="router-view"
            @scroll="listScroll"
          />
        </KeepAlive>
        <component
          v-else
          ref="componentRef"
          :is="Component"
          :id="artistId"
          :platform="routePlatform"
          class="router-view"
          @scroll="listScroll"
        />
      </Transition>
    </RouterView>
  </div>
</template>

<script setup lang="ts">
import type { DropdownOption } from "naive-ui";
import type { ArtistType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import { coverLoaded, renderIcon, copyData } from "@/utils/helper";
import { renderToolbar } from "@/utils/meta";
import { openDescModal, openBatchList } from "@/utils/modal";
import { artistDetail } from "@/api/artist";
import { dispatchArtistDetail } from "@/api/platform/dispatch";
import { formatArtistsList } from "@/utils/format";
import {
  onPlatformChange,
  useDataStore,
  usePlatformStore,
  useSettingStore,
  useStatusStore,
} from "@/stores";
import { toLikeArtist } from "@/utils/auth";
import { useSwipe } from "@vueuse/core";
import ArtistSongs from "./songs.vue";

const route = useRoute();
const router = useRouter();
const dataStore = useDataStore();
const settingStore = useSettingStore();
const statusStore = useStatusStore();
const platformStore = usePlatformStore();

// 路由元素
const componentRef = ref<InstanceType<typeof ArtistSongs> | null>(null);

// 页面元素引用
const artistPageRef = ref<HTMLElement | null>(null);

// 头部文本列元素引用
const dataRef = ref<HTMLElement | null>(null);

/**
 * 头部高度
 *
 * 头部内容（歌手名、职业、简介、按钮）随歌手信息变化，
 * 固定高度会让弹性布局把文字压缩、裁掉笔画，
 * 这里按内容实测高度回填，标签页与列表随之为准。
 */
const detailHeight = ref<number>(180);

/**
 * 按头部文本列的内容高度同步头部高度
 *
 * 量高时临时取消交叉轴拉伸并让折叠区取自然高度，
 * 量到的是内容真实占位高度而不是折叠动画的中间值；
 * 头部上下各留 20px 内边距，并保证不小于封面所需的最小高度。
 */
const syncDetailHeight = () => {
  const el = dataRef.value;
  // 列表滚动时头部处于收起态，高度由收起态样式决定，此处不参与测量
  if (!el || listScrolling.value) return;
  const collapse = el.querySelector<HTMLElement>(".collapse");
  const alignSelf = el.style.alignSelf;
  const collapseHeight = collapse?.style.height ?? "";
  const collapseTransition = collapse?.style.transition ?? "";
  el.style.alignSelf = "flex-start";
  if (collapse) {
    collapse.style.transition = "none";
    collapse.style.height = "auto";
  }
  const natural = el.offsetHeight;
  if (collapse) {
    collapse.style.height = collapseHeight;
    collapse.style.transition = collapseTransition;
  }
  el.style.alignSelf = alignSelf;
  const next = Math.max(180, Math.ceil(natural) + 40);
  if (next !== detailHeight.value) detailHeight.value = next;
};

/**
 * 折叠动画结束后重测头部高度
 *
 * 折叠展开过程中容器高度是动画中间值，此时量高会偏小，
 * 动画结束后再量一次才能拿到内容真实高度。
 * @param e 过渡事件
 */
const handleDetailTransitionEnd = (e: TransitionEvent) => {
  if (e.propertyName !== "height") return;
  syncDetailHeight();
};

// 头部文本列重新挂载后按内容同步高度
// （头部内容随进出动画整体替换，元素换新时才量得到新内容的真实高度）
watch(dataRef, (el) => {
  if (!el) return;
  nextTick(() => syncDetailHeight());
});

// 歌手 ID（网易云为数字 id，第三方平台为平台主键）
const artistId = computed<string>(() => String(route.query.id ?? ""));

// 路由指定的音源平台（第三方平台歌手带 platform 参数，网易云原路径不带）
const routePlatform = computed<ApiPlatform | null>(() => {
  const platform = route.query.platform as string | undefined;
  return platform === "qqmusic" || platform === "kugou" ? platform : null;
});

// 是否为第三方平台（QQ 音乐 / 酷狗）
const isPlatformSource = computed<boolean>(() => routePlatform.value !== null);

// 歌手子页的路由参数
const artistQuery = computed(() => ({
  id: artistId.value,
  ...(routePlatform.value ? { platform: routePlatform.value } : {}),
}));

// 标签页顺序
const tabOrder = ["artist-songs", "artist-albums", "artist-videos"];

// 滑动切换标签页
const { direction, lengthX } = useSwipe(artistPageRef, {
  threshold: 10,
  onSwipeEnd: () => {
    const currentIndex = tabOrder.indexOf(artistType.value);
    // 左滑切换到下一个标签
    if (direction.value === "left" && lengthX.value > 50) {
      if (currentIndex < tabOrder.length - 1) {
        tabChange(tabOrder[currentIndex + 1]);
      }
    }
    // 右滑切换到上一个标签，如果已经在第一个标签则展开菜单
    else if (direction.value === "right" && lengthX.value < -50) {
      if (currentIndex > 0) {
        tabChange(tabOrder[currentIndex - 1]);
      } else {
        // 在第一个标签时，右滑展开菜单
        statusStore.showAside = true;
      }
    }
  },
});

// 歌手分类
const artistType = ref<string>((route.name as string) || "artist-songs");

// 歌手数据
const artistDetailData = ref<ArtistType | null>(null);

// 列表是否滚动
const listScrolling = ref<boolean>(false);

// 更多操作
const moreOptions = computed<DropdownOption[]>(() => {
  // 第三方平台：只保留批量操作，网易云专属的分享 / 源页面链接不适用
  if (isPlatformSource.value) {
    return [
      {
        label: "批量操作",
        key: "batch",
        show: artistType.value === "artist-songs",
        props: {
          onClick: () => {
            if (componentRef.value?.songData) {
              openBatchList(componentRef.value.songData, false);
            } else {
              window.$message.warning("暂无歌曲可操作");
            }
          },
        },
        icon: renderIcon("Batch"),
      },
    ];
  }
  return [
    {
      label: "批量操作",
      key: "batch",
      show: artistType.value === "artist-songs",
      props: {
        onClick: () => {
          if (componentRef.value?.songData) {
            openBatchList(
              componentRef.value.songData,
              false,
              isLikeArtist.value ? Number(artistId.value) : undefined,
            );
          } else {
            window.$message.warning("暂无歌曲可操作");
          }
        },
      },
      icon: renderIcon("Batch"),
    },
    {
      label: "复制分享链接",
      key: "copy",
      props: {
        onClick: () =>
          copyData(`https://music.163.com/#/artist?id=${artistId.value}`, "已复制分享链接到剪贴板"),
      },
      icon: renderIcon("Share"),
    },
    {
      label: "打开源页面",
      key: "open",
      props: {
        onClick: () => {
          window.open(`https://music.163.com/#/artist?id=${artistId.value}`);
        },
      },
      icon: renderIcon("Link"),
    },
  ];
});

// 是否处于收藏歌手
// 网易云的歌手收藏属于网易云平台，在其它平台下不参与判据
const isLikeArtist = computed(() => {
  if (platformStore.currentPlatform !== "netease") return false;
  return dataStore.userLikeData.artists.some((ar) => ar.id === Number(artistId.value));
});

// 获取歌手详情
const getArtistDetail = async (id: string) => {
  try {
    if (!id) return;
    listScrolling.value = false;
    artistDetailData.value = null;
    detailHeight.value = 180;
    // 第三方平台：走平台数据层
    if (routePlatform.value) {
      const result = await dispatchArtistDetail(routePlatform.value, { id, limit: 1 });
      artistDetailData.value = result.detail;
    } else {
      const result = await artistDetail(Number(id));
      artistDetailData.value = formatArtistsList(result.data.artist)[0];
      // 附加身份
      artistDetailData.value.identify = result.data.identify?.imageDesc;
    }
    // 头部高度随内容自适应，等 DOM 更新后再量高
    await nextTick();
    syncDetailHeight();
  } catch (error) {
    console.error("Erorr getting artist detail:", error);
    window.$message.error("获取歌手详情失败");
  }
};

// Tabs 改变
const tabChange = (value: string) => {
  router.push({
    name: value,
    query: artistQuery.value,
  });
};

// 播放全部歌曲
const playAllSongs = async () => {
  await router.push({ name: "artist-songs", query: artistQuery.value });
  if (componentRef.value) componentRef.value.playAllSongs();
};

// 列表滚动
const listScroll = (e: Event) => {
  // 滚动高度
  const scrollTop = (e.target as HTMLElement).scrollTop;
  listScrolling.value = scrollTop > 10;
};

// 监听路由更新
onBeforeRouteUpdate((to) => {
  listScrolling.value = false;
  // 检查是否仍在 artist 路由下
  const isArtistRoute = to.matched.some((m) => m.name === "artist");
  if (!isArtistRoute) return;
  artistType.value = to.name as string;
});

// 监听 ID 变化
watch(
  () => artistId.value,
  (val) => {
    if (val) getArtistDetail(val);
  },
  { immediate: true },
);

/**
 * 平台切换后按新平台处理歌手页
 *
 * 歌手号是平台内主键：路由钉住平台的歌手在切到别的平台后，
 * 那个歌手号在新平台下指向完全不同的歌手，留在原处显示的就不是当前平台的数据；
 * 未钉平台的歌手页随当前平台走，按新平台重取即可。
 */
const stopPlatformWatch = onPlatformChange(({ platform }) => {
  if (routePlatform.value && routePlatform.value !== platform) {
    // 钉在别的平台的歌手：回到当前平台的首页
    router.push({ name: "home" });
    return;
  }
  if (artistId.value) getArtistDetail(artistId.value);
});

// 窗口尺寸变化：重新测量头部高度
const handleResize = () => {
  syncDetailHeight();
};

onMounted(() => {
  window.addEventListener("resize", handleResize);
});

onUnmounted(() => {
  stopPlatformWatch();
  window.removeEventListener("resize", handleResize);
});
</script>

<style lang="scss" scoped>
.artist {
  /* 歌手详情高度变量 */
  --detail-height: 180px;

  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;

  /* 头部详情 - 绝对定位 */
  .detail {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: var(--detail-height);
    display: flex;
    padding: 20px 0 20px 0;
    z-index: 2; /* 保证在列表之上 */
    // background-color: var(--n-color); /* 移除背景色 */
    transition:
      height 0.3s,
      opacity 0.3s;
    will-change: height;

    /* 头部内部样式保持不变 */
    .cover {
      position: relative;
      display: flex;
      width: auto;
      height: 100%;
      aspect-ratio: 1 / 1;
      margin-right: 20px;
      border-radius: 50%;
      transition: all 0.3s;
      :deep(img) {
        width: 100%;
        height: 100%;
        opacity: 0;
        transition: opacity 0.35s ease-in-out;
      }
      .cover-img {
        border-radius: 50%;
        overflow: hidden;
        z-index: 1;
      }
      .cover-shadow {
        position: absolute;
        top: 8px;
        height: 100%;
        width: 100%;
        border-radius: 50%;
        filter: blur(12px) opacity(0.6);
        transform: scale(0.92, 0.96);
        z-index: 0;
        background-size: cover;
        aspect-ratio: 1/1;
        :deep(img) {
          opacity: 1;
        }
      }
      &:active {
        transform: scale(0.98);
      }
    }
    .data {
      position: relative;
      display: flex;
      flex-direction: column;
      flex: 1;
      padding-right: 60px;
      :deep(.n-skeleton) {
        height: 30px;
        margin-top: 12px;
        border-radius: 8px;
        &:first-child {
          width: 60%;
          margin-top: 0;
          height: 40px;
        }
      }
      .description {
        margin-bottom: 8px;
        padding-left: 4px;
        cursor: pointer;
      }
      .name {
        font-size: 30px;
        font-weight: bold;
        // 行盒与容器等高，字形完整不被裁；最小高度兜底，防止被弹性布局压扁
        min-height: 38px;
        line-height: 38px;
        flex-shrink: 0;
        margin-bottom: 8px;
        transition: all 0.3s var(--n-bezier);
        .name-alias {
          &::before {
            content: "（";
            margin-right: 6px;
          }
          &::after {
            content: "）";
            margin-left: 6px;
          }
        }
      }
      .identify {
        font-size: 16px;
        margin-bottom: 8px;
        padding-left: 4px;
      }
      .collapse {
        margin-top: 2px;
        margin-bottom: 4px;
        // 职业 / 计数 / 简介不参与收缩，避免文字被裁
        flex-shrink: 0;
      }
      .meta {
        margin-bottom: 4px;
        .item {
          display: flex;
          align-items: center;
          cursor: pointer;
          .n-icon {
            font-size: 20px;
            margin-right: 4px;
          }
        }
      }
      .menu {
        margin-top: auto;
        width: 100%;
        flex-shrink: 0;
        :deep(.n-button) {
          height: 40px;
          flex-shrink: 0;
          transition: all 0.3s var(--n-bezier);
        }
        .left {
          flex: 0 0 auto;
        }
        .more {
          width: 40px;
        }
        @media (max-width: 768px) {
          width: 100%;
          .left {
            gap: 8px;
            :deep(.n-button) {
              width: 44px;
              height: 38px;
              padding: 0;
              justify-content: center;
              .n-button__content {
                display: none;
              }
              .n-button__icon {
                margin: 0;
                transition: margin 0.3s var(--n-bezier);
              }
            }
            .more {
              width: 44px;
            }
          }
        }
      }
    }
  }

  /* 标签页 - 绝对定位 */
  .tabs {
    position: absolute;
    width: 100%;
    top: calc(var(--detail-height) + 2px); /* 默认位置 */
    margin-top: 0; /* 清除可能的影响 */
    height: 40px;
    z-index: 2; /* 与头部同层级，高于列表 */
    transition:
      top 0.3s,
      margin-top 0.3s;
  }

  /* 路由视图/列表容器 - 绝对定位 */
  .router-view {
    /* 通用样式，适用于 songs, albums, videos */
    position: absolute;
    width: 100%;
    top: calc(var(--detail-height) + 42px); /* 默认位置：头部 + 标签高度 */
    bottom: 0;
    padding-top: 0;
    overflow-y: auto; /* 关键：允许内容滚动 */
    z-index: 1; /* 底层 */
    transition: top 0.3s; /* 仅过渡 top */

    /* 兼容旧选择器，虽然现在直接作用于 router-view */
    &.artist-songs,
    &.artist-albums,
    &.artist-videos {
      position: absolute; /* 确保优先级 */
      top: calc(var(--detail-height) + 42px);
    }
  }

  /* 滚动状态 (.small) 的样式覆盖 */
  &.small {
    /* 1. 头部缩小 */
    .detail {
      height: 120px;
      /* ...保留内部变化... */
      .cover {
        margin-right: 12px;
        .cover-mask,
        .play-count {
          opacity: 0;
        }
      }
      .data {
        padding-right: 0;
        .name {
          font-size: 22px;
          min-height: 32px;
          line-height: 32px;
        }
        .menu {
          width: 100% !important;
          padding-right: 20px;
          .left {
            display: flex;
            align-items: center;
            gap: 6px;
            :deep(.n-button) {
              width: auto;
              height: 32px;
              padding: 0 12px;
              flex-shrink: 0;
              --n-font-size: 13px;
              --n-icon-size: 16px;
              .n-button__content {
                display: block;
              }
              .n-button__icon {
                margin-right: 4px;
              }
            }
            .more {
              width: 32px;
              padding: 0;
            }
          }
        }
      }
    }

    /* 2. 标签页上移 */
    .tabs {
      top: 120px !important; /* 强制覆盖 */
    }

    /* 3. 列表容器上移 */
    .router-view {
      top: 160px !important; /* 直接作用于 router-view */

      &.artist-songs,
      &.artist-albums,
      &.artist-videos {
        top: 160px !important;
      }
    }
  }
}
</style>
