<!-- 主菜单 -->
<template>
  <n-menu
    ref="menuRef"
    v-model:value="menuActiveKey"
    v-model:expanded-keys="settingStore.menuExpandedKeys"
    :class="{ cover: settingStore.menuShowCover }"
    :indent="0"
    :root-indent="26"
    :collapsed="statusStore.menuCollapsed && isDesktop"
    :collapsed-width="64"
    :collapsed-icon-size="22"
    :options="menuOptions"
    :render-label="renderMenuLabel"
    @update:value="menuUpdate"
  />
</template>

<script setup lang="ts">
import { useMobile } from "@/composables/useMobile";
import { useSongFM } from "@/composables/useSongFM";
import { usePlayerController } from "@/core/player/PlayerController";
import { useSongManager } from "@/core/player/SongManager";
import {
  onAccountChange,
  onPlatformChange,
  useDataStore,
  useLocalStore,
  useMusicStore,
  usePlatformStore,
  useSettingStore,
  useStatusStore,
} from "@/stores";
import type { CoverType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import type { DispatchPlaylist } from "@/api/platform/dispatch";
import { isLogin } from "@/utils/auth";
import { isElectron } from "@/utils/env";
import { renderIcon } from "@/utils/helper";
import { openCreatePlaylist, openCreateRemotePlaylist } from "@/utils/modal";
import { debounce } from "lodash-es";
import {
  type MenuGroupOption,
  type MenuInst,
  type MenuOption,
  NAvatar,
  NBadge,
  NButton,
  NDropdown,
  NEllipsis,
  NText,
  NPopselect,
} from "naive-ui";
import { RouterLink, useRouter } from "vue-router";

const emit = defineEmits<{ (e: "menu-click", key: string): void }>();

const router = useRouter();
const dataStore = useDataStore();
const localStore = useLocalStore();
const musicStore = useMusicStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();
const platformStore = usePlatformStore();
const player = usePlayerController();
const songManager = useSongManager();

const { enterSongFM } = useSongFM();

const { isDesktop } = useMobile();

// 菜单数据
const menuRef = ref<MenuInst | null>(null);
const menuActiveKey = ref<string | number>((router.currentRoute.value.name as string) || "home");
const playlistMode = ref<"online" | "local" | "remote">("online");

// 刷新私人漫游
const handleRefreshFM = async (e: Event) => {
  e.stopPropagation();
  await songManager.refreshPersonalFM();
  // 刷新后如果处于私人漫游模式，则重新播放
  if (statusStore.personalFmMode && musicStore.personalFMSong?.id) {
    player.playSong();
  }
};

// 菜单内容
const menuOptions = computed<MenuOption[] | MenuGroupOption[]>(() => {
  return settingStore.useOnlineService
    ? [
        {
          key: "home",
          link: "home",
          label: "为我推荐",
          icon: renderIcon("Home", {
            style: {
              transform: "translateY(-1px)",
            },
          }),
        },
        {
          key: "discover",
          link: "discover",
          label: "发现音乐",
          show: !settingStore.sidebarHide.hideDiscover,
          icon: renderIcon("Discover", {
            style: {
              transform: "translateY(-1px)",
            },
          }),
        },
        {
          key: "personal-fm",
          label: () =>
            h("div", { class: "user-liked roaming-label" }, [
              h(NText, null, () => (isSongFMPlatform.value ? "刷歌" : "私人漫游")),
              h(NButton, {
                type: "tertiary",
                round: true,
                strong: true,
                secondary: true,
                renderIcon: renderIcon("Refresh"),
                onClick: handleRefreshFM,
              }),
            ]),
          show: showPersonalFMMenu.value,
          icon: renderIcon("Radio", {
            style: {
              transform: "translateY(-1px)",
            },
          }),
        },
        {
          key: "radio-hot",
          link: "radio-hot",
          // 酷狗下同一入口是听书；QQ 音乐既无播客也无听书数据源，入口整体隐藏
          label: isKugouPlatform.value ? "听书" : "播客电台",
          show: !settingStore.sidebarHide.hideRadioHot && !isQqPlatform.value,
          icon: renderIcon("Record", {
            style: {
              transform: "translateY(-1px)",
            },
          }),
        },
        {
          key: "divider",
          type: "divider",
        },
        {
          key: "like-songs",
          label: () =>
            h("div", { class: "user-liked" }, [
              h(NText, null, () => "我喜欢的音乐"),
              !settingStore.sidebarHide.hideHeartbeatMode && !isPlatformSource.value
                ? h(NButton, {
                    type: statusStore.shuffleMode === "heartbeat" ? "primary" : "default",
                    round: true,
                    strong: true,
                    secondary: true,
                    renderIcon: renderIcon("HeartBit"),
                    onClick: (event: Event) => {
                      event.stopPropagation();
                      openHeartMode();
                    },
                  })
                : null,
            ]),
          icon: renderIcon("Favorite"),
        },
        {
          key: "like",
          link: "like",
          label: "我的收藏",
          show: !settingStore.sidebarHide.hideLike,
          icon: renderIcon("Star"),
        },
        {
          key: "cloud",
          link: "cloud",
          label: "我的云盘",
          show: isLogin() === 1 && !settingStore.sidebarHide.hideCloud && !isPlatformSource,
          icon: renderIcon("Cloud"),
        },
        {
          key: "download",
          label: () =>
            h(
              NBadge,
              {
                show: dataStore.downloadingSongs.length > 0,
                value: dataStore.downloadingSongs.length,
                offset: [22, 13],
              },
              () => "下载管理",
            ),
          show: statusStore.isDeveloperMode && isElectron && !settingStore.sidebarHide.hideDownload,
          icon: renderIcon("Download"),
        },
        {
          key: "streaming",
          link: "streaming",
          label: "流媒体",
          show: settingStore.streamingEnabled,
          icon: renderIcon("Stream"),
        },
        {
          key: "local",
          link: "local",
          label: "本地歌曲",
          show: isElectron && !settingStore.sidebarHide.hideLocal,
          icon: renderIcon("FolderMusic"),
        },
        {
          key: "history",
          link: "history",
          label: "最近播放",
          show: !settingStore.sidebarHide.hideHistory,
          icon: renderIcon("History"),
        },
        {
          key: "divider-two",
          type: "divider",
        },
        {
          key: "user-playlists",
          show: !settingStore.sidebarHide.hideUserPlaylists,
          icon: statusStore.menuCollapsed ? renderIcon("PlaylistAdd") : undefined,
          label: () =>
            h("div", { class: "user-list" }, [
              h(NText, { depth: 3 }, () =>
                playlistMode.value === "online"
                  ? "创建的歌单"
                  : playlistMode.value === "remote"
                    ? "远程歌单"
                    : "本地歌单",
              ),
              h(
                NPopselect,
                {
                  options: [
                    { label: "在线歌单", value: "online" },
                    { label: "本地歌单", value: "local" },
                    { label: "远程歌单", value: "remote" },
                  ],
                  value: playlistMode.value,
                  trigger: "click",
                  onUpdateValue: (value: "online" | "local" | "remote") => {
                    playlistMode.value = value;
                  },
                },
                () =>
                  h(NButton, {
                    type: "tertiary",
                    round: true,
                    strong: true,
                    secondary: true,
                    renderIcon: renderIcon("Menu"),
                    onClick: (e: Event) => e.stopPropagation(),
                  }),
              ),
              h(NButton, {
                type: "tertiary",
                round: true,
                strong: true,
                secondary: true,
                renderIcon: renderIcon("Add"),
                onclick: (event: Event) => {
                  event.stopPropagation();
                  if (playlistMode.value === "remote") {
                    openCreateRemotePlaylist();
                  } else {
                    openCreatePlaylist(playlistMode.value === "local");
                  }
                },
              }),
            ]),
          children:
            playlistMode.value === "online"
              ? [...createPlaylist.value]
              : playlistMode.value === "remote"
                ? [...remotePlaylistMenu.value]
                : [...localPlaylistMenu.value],
        },
        // 收藏的歌单
        {
          key: "liked-playlists",
          show: !settingStore.sidebarHide.hideLikedPlaylists,
          icon: statusStore.menuCollapsed ? renderIcon("PlaylistAddCheck") : undefined,
          label: () =>
            h(
              "div",
              { class: "user-list" },
              h(NText, { depth: 3 }, () => ["收藏的歌单"]),
            ),
          children: [...likedPlaylist.value],
        },
      ]
    : [
        {
          key: "local",
          link: "local",
          label: "音乐库",
          show: isElectron,
          icon: renderIcon("FolderMusic"),
        },
        {
          key: "local-albums",
          link: "local-albums",
          label: "专辑",
          show:
            isElectron &&
            (localStore.localSongs?.length > 0 || settingStore.localFilesPath?.length > 0),
          icon: renderIcon("Album"),
        },
        {
          key: "local-artists",
          link: "local-artists",
          label: "艺术家",
          show:
            isElectron &&
            (localStore.localSongs?.length > 0 || settingStore.localFilesPath?.length > 0),
          icon: renderIcon("Person"),
        },
        {
          key: "divider",
          type: "divider",
          show: localPlaylistMenu.value.length > 0,
        },
        // 本地歌单
        {
          key: "local-playlists",
          show: localPlaylistMenu.value.length > 0,
          icon: statusStore.menuCollapsed ? renderIcon("PlaylistAdd") : undefined,
          label: () =>
            h("div", { class: "user-list" }, [
              h(NText, { depth: 3 }, () => "本地歌单"),
              h(NButton, {
                type: "tertiary",
                round: true,
                strong: true,
                secondary: true,
                renderIcon: renderIcon("Add"),
                onclick: (event: Event) => {
                  event.stopPropagation();
                  openCreatePlaylist(true);
                },
              }),
            ]),
          children: [...localPlaylistMenu.value],
        },
      ];
});

// 生成歌单列表
const renderPlaylist = (playlist: CoverType[], showCover: boolean) => {
  if (!isLogin()) return [];
  return playlist.map((playlist) => ({
    key: playlist.id,
    label: () =>
      showCover
        ? h("div", { class: "pl-cover" }, [
            h(NAvatar, {
              src: playlist.coverSize?.s || playlist.cover,
              fallbackSrc: "/images/album.jpg?asset",
              lazy: true,
            }),
            h(NEllipsis, null, () => playlist.name),
          ])
        : h(NEllipsis, null, () => playlist.name),
    icon: showCover ? undefined : renderIcon("PlayList"),
  }));
};

// 当前平台是否为第三方平台（QQ 音乐 / 酷狗）
const isPlatformSource = computed<boolean>(() => platformStore.currentPlatform !== "netease");

// 当前平台是否为 QQ 音乐（QQ 音乐下该入口切换为「刷歌」）
const isQqPlatform = computed<boolean>(() => platformStore.currentPlatform === "qqmusic");

// 当前平台是否为酷狗音乐（酷狗下该入口同样是「刷歌」）
const isKugouPlatform = computed<boolean>(() => platformStore.currentPlatform === "kugou");

// 支持「刷歌」的第三方平台（QQ 音乐 / 酷狗）
const isSongFMPlatform = computed<boolean>(() => isQqPlatform.value || isKugouPlatform.value);

// 当前平台是否已登录
const isPlatformLoggedIn = computed<boolean>(
  () => !!platformStore.platformProfiles[platformStore.currentPlatform],
);

/**
 * 侧边栏「私人漫游 / 刷歌」入口是否可见
 *
 * - QQ 音乐：推荐流是登录态接口，需要登录
 * - 酷狗：推荐流匿名可用，直接展示
 * - 网易云：需要登录，且只在本平台下展示
 */
const showPersonalFMMenu = computed<boolean>(() => {
  if (settingStore.sidebarHide.hidePersonalFM) return false;
  if (isQqPlatform.value) return isPlatformLoggedIn.value;
  if (isKugouPlatform.value) return true;
  return isLogin() !== 0 && !isPlatformSource.value;
});

// 生成平台歌单列表
const renderPlatformPlaylist = (playlist: DispatchPlaylist, showCover: boolean) => ({
  key: `${playlist.platform}:${playlist.platformId ?? playlist.id}`,
  label: () =>
    showCover
      ? h("div", { class: "pl-cover" }, [
          h(NAvatar, {
            src: playlist.coverSize?.s || playlist.cover,
            fallbackSrc: "/images/album.jpg?asset",
            lazy: true,
          }),
          h(NEllipsis, null, () => playlist.name),
        ])
      : h(NEllipsis, null, () => playlist.name),
  icon: showCover ? undefined : renderIcon("PlayList"),
});

// 在平台歌单列表里定位歌单
const findPlatformPlaylist = (
  platform: string,
  platformId: string,
): DispatchPlaylist | undefined => {
  const list = [...platformStore.playlists.owned, ...platformStore.playlists.favorites];
  return list.find(
    (playlist) =>
      playlist.platform === platform && String(playlist.platformId ?? playlist.id) === platformId,
  );
};

// 创建的歌单
const createPlaylist = computed<MenuOption[]>(() => {
  // 第三方平台：展示当前平台的自建歌单
  // 平台把系统「我喜欢的音乐」也算在自建目录里，故一并列出，
  // 使分组条目数与账号信息区的「创建」统计同口径
  if (isPlatformSource.value) {
    if (!isPlatformLoggedIn.value) return [];
    return platformStore.playlists.owned.map((playlist) =>
      renderPlatformPlaylist(playlist, settingStore.menuShowCover),
    );
  }
  const userId = dataStore.userData.userId;
  const list = dataStore.userLikeData.playlists
    .filter((playlist) => playlist?.userId === userId)
    .slice(1);
  return renderPlaylist(list, settingStore.menuShowCover);
});

// 收藏的歌单
const likedPlaylist = computed<MenuOption[]>(() => {
  // 第三方平台：展示当前平台的收藏（订阅）歌单
  if (isPlatformSource.value) {
    if (!isPlatformLoggedIn.value) return [];
    return platformStore.playlists.favorites.map((playlist) =>
      renderPlatformPlaylist(playlist, settingStore.menuShowCover),
    );
  }
  const userId = dataStore.userData.userId;
  const list = dataStore.userLikeData.playlists.filter((playlist) => playlist?.userId !== userId);
  return renderPlaylist(list, settingStore.menuShowCover);
});

// 本地歌单菜单
const localPlaylistMenu = computed<MenuOption[]>(() => {
  const playlists = localStore.localPlaylists;
  if (!playlists || playlists.length === 0) return [];
  return playlists.map((playlist) => ({
    key: `local-${playlist.id}`,
    label: () =>
      settingStore.menuShowCover
        ? h("div", { class: "pl-cover" }, [
            h(NAvatar, {
              src: playlist.cover || "/images/album.jpg?asset",
              fallbackSrc: "/images/album.jpg?asset",
              lazy: true,
            }),
            h(NEllipsis, null, () => playlist.name),
          ])
        : h(NEllipsis, null, () => playlist.name),
    icon: settingStore.menuShowCover ? undefined : renderIcon("PlayList"),
  }));
});

// 删除远程歌单
const handleDeleteRemotePlaylist = async (id: string) => {
  try {
    await localStore.deleteRemotePlaylist(id);
    window.$message.success("删除远程歌单成功");
  } catch (error) {
    console.error("删除远程歌单失败:", error);
    window.$message.error("删除远程歌单失败，请重试");
  }
};

// 远程歌单菜单（WebDAV）
const remotePlaylistMenu = computed<MenuOption[]>(() => {
  const playlists = localStore.remotePlaylists;
  if (!playlists || playlists.length === 0) return [];
  return playlists.map((playlist) => ({
    key: `remote-${playlist.id}`,
    label: () =>
      h(
        NDropdown,
        {
          trigger: "click",
          options: [
            {
              label: "删除远程歌单",
              key: "delete",
              icon: renderIcon("DeleteSweep"),
            },
          ],
          onSelect: () => handleDeleteRemotePlaylist(playlist.id),
        },
        { default: () => h(NEllipsis, null, () => playlist.name) },
      ),
    icon: renderIcon("Storage"),
  }));
});

// 渲染菜单路由
const renderMenuLabel = (option: MenuOption) => {
  // 路由链接
  if ("link" in option) {
    return h(RouterLink, { to: { name: option.link as string } }, () => option.label as string);
  }
  return typeof option.label === "function" ? option.label() : (option.label as string);
};

// 判断是否为平台歌单菜单项
const isPlatformPlaylistKey = (key: string): boolean =>
  key.startsWith("qqmusic:") || key.startsWith("kugou:");

// 打开第三方平台歌单
const openPlatformPlaylist = (key: string) => {
  const [platform, platformId] = key.split(":");
  const target = findPlatformPlaylist(platform, platformId);
  router.push({
    name: "playlist",
    query: {
      platform,
      id: platformId,
      // 自建歌单读详情需要目录号
      ...(target?.dirId && !target.subscribed ? { dirId: String(target.dirId) } : {}),
    },
  });
};

// 菜单项更改
const menuUpdate = async (key: string, item: MenuOption) => {
  emit("menu-click", key);
  // 私人漫游 / 刷歌
  if (key === "personal-fm") {
    // QQ 音乐 / 酷狗：开启推荐流并打开全屏播放器（刷歌没有独立页面）
    if (isSongFMPlatform.value) {
      if (!(await enterSongFM())) {
        window.$message.error("开启刷歌出错，请重试");
        return;
      }
      window.$message.info("已开启刷歌", { icon: renderIcon("Radio") });
      return;
    }
    // 网易云私人漫游：确保推荐流列表属于当前平台，避免复用其它平台的缓存列表
    await songManager.ensurePersonalFMPlatform();
    if (!musicStore.personalFMSong?.id) {
      window.$message.error("开启私人漫游出错，请重试");
      return;
    }
    if (statusStore.personalFmMode) {
      player.play();
    } else {
      // 更改播放模式
      statusStore.personalFmMode = true;
      statusStore.shuffleMode = "off";
      player.playSong();
    }
    statusStore.showFullPlayer = true;
    window.$message.info("已开启私人漫游", { icon: renderIcon("Radio") });
    return;
  }
  if (typeof key === "number") {
    router.push({
      name: "playlist",
      query: { id: item.key },
    });
  } else if (typeof key === "string" && isPlatformPlaylistKey(key)) {
    // 第三方平台歌单：按平台维度跳转
    openPlatformPlaylist(key);
  } else if (typeof key === "string" && key.startsWith("local-")) {
    // 检查是否为本地歌单（16位数字ID）
    const localId = key.replace("local-", "");
    const isLocalPlaylist = /^\d{16}$/.test(localId);
    if (isLocalPlaylist) {
      router.push({
        name: "playlist",
        query: { id: localId },
      });
    }
  } else if (typeof key === "string" && key.startsWith("remote-")) {
    // 远程歌单（WebDAV）：点击由项内 NDropdown 处理（删除），暂不导航
    return;
  } else {
    switch (key) {
      case "like-songs":
        router.push({
          name: "like-songs",
        });
        break;
      // 下载管理
      case "download":
        router.push({
          name:
            dataStore.downloadingSongs.length > 0 ? "download-downloading" : "download-downloaded",
        });
        break;
      default:
        break;
    }
  }
};

// 选中菜单项
const checkMenuItem = () => {
  // 当前路由名称
  let routerName =
    (router.currentRoute.value.matched?.[0]?.name as string) ||
    (router.currentRoute.value?.name as string);
  if (!routerName) return;
  // 处理路由名称
  const prefixMap = [
    { prefix: "discover-", name: "discover" },
    // 本地模式下不合并 local- 前缀的路由
    { prefix: "local-", name: "local", skipInLocalMode: true },
    { prefix: "like-", name: "like", exclude: "like-songs" },
    { prefix: "download-", name: "download" },
    { prefix: "streaming-", name: "streaming" },
  ];
  for (const item of prefixMap) {
    if (item.skipInLocalMode && !settingStore.useOnlineService) continue;
    if (routerName.startsWith(item.prefix) && (!item.exclude || routerName !== item.exclude)) {
      routerName = item.name;
      break;
    }
  }
  // 显示菜单
  menuRef.value?.showOption(routerName);
  // 本地模式下处理
  if (!settingStore.useOnlineService) {
    if (routerName === "local-songs" || routerName === "local-folders") {
      routerName = "local";
    }
  }
  // 高亮菜单
  switch (routerName) {
    case "playlist": {
      // 第三方平台歌单
      const query = router.currentRoute.value.query;
      const platform = query.platform as ApiPlatform | undefined;
      if (platform === "qqmusic" || platform === "kugou") {
        const platformKey = `${platform}:${query.id}`;
        menuActiveKey.value = platformKey;
        menuRef.value?.showOption(platformKey);
        break;
      }
      // 获取歌单 id
      const playlistId = Number(router.currentRoute.value.query.id || 0);
      // 是否处于用户歌单
      const isUserPlaylist = dataStore.userLikeData.playlists.some(
        (playlist) => playlist?.id === playlistId,
      );
      // 是否为本地歌单
      const isLocalPlaylist = playlistId.toString().length === 16;
      if (!playlistId) menuActiveKey.value = "home";
      if (isUserPlaylist) {
        menuActiveKey.value = Number(playlistId);
        menuRef.value?.showOption(playlistId);
      } else if (isLocalPlaylist) {
        menuActiveKey.value = `local-${playlistId}`;
        menuRef.value?.showOption(`local-${playlistId}`);
      } else {
        menuActiveKey.value = "home";
      }
      break;
    }
    default:
      menuActiveKey.value = routerName;
      break;
  }
};

// 开启心动模式
const openHeartMode = debounce(() => player.toggleShuffle("heartbeat"), 1000, {
  leading: true,
  trailing: false,
});

// 本地模式下自动展开本地歌单
onMounted(() => {
  if (!settingStore.useOnlineService && localPlaylistMenu.value.length > 0) {
    if (!settingStore.menuExpandedKeys.includes("local-playlists")) {
      settingStore.menuExpandedKeys.push("local-playlists");
    }
  }
  // 拉取当前平台的歌单列表
  void platformStore.refreshPlaylists();
});

// 平台切换后按新平台刷新歌单列表
const offPlatformChange = onPlatformChange(({ platform }) => {
  void platformStore.refreshPlaylists(platform);
});

// 账号变更后按新账号刷新歌单列表
const offAccountChange = onAccountChange(({ platform }) => {
  if (platform !== platformStore.currentPlatform) return;
  void platformStore.refreshPlaylists(platform);
});

onUnmounted(() => {
  offPlatformChange();
  offAccountChange();
});

// 监听路由
watch(
  () => [router.currentRoute.value, dataStore.userLikeData.playlists],
  () => checkMenuItem(),
);
</script>

<style lang="scss" scoped>
.n-menu {
  padding-bottom: 14px;
  :deep(.n-menu-item) {
    .n-menu-item-content {
      &::before {
        border-left: 4px solid transparent;
        transition:
          border 0.3s var(--n-bezier),
          background-color 0.3s var(--n-bezier);
      }
      &.n-menu-item-content--selected {
        .n-text {
          color: var(--primary-hex);
        }
        &::before {
          border-left-color: var(--n-item-text-color-active);
        }
      }
    }
  }
  &.cover {
    :deep(.n-submenu-children) {
      --n-item-height: 50px;
    }
  }
}
</style>

<style lang="scss">
.user-liked {
  display: flex;
  align-items: center;
  justify-content: space-between;
  .n-button {
    margin-left: 12px;
    --n-height: 30px;
    --n-padding: 0 16px;
    --n-icon-size: 20px;
  }
}
.user-list {
  display: flex;
  align-items: center;
  gap: 8px;
  .n-text {
    font-size: 0.93em;
  }
  .n-button {
    --n-height: 22px;
    --n-padding: 0 12px;
    --n-icon-size: 12px;
  }
}
.pl-cover {
  display: flex;
  align-items: center;
  .n-avatar {
    width: 34px;
    height: 34px;
    min-width: 34px;
    margin-right: 12px;
    border-radius: 8px;
  }
}
.roaming-label {
  .n-button {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s;
  }
  &:hover {
    .n-button {
      opacity: 1;
      pointer-events: auto;
    }
  }
}
</style>
