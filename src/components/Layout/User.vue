<template>
  <n-popover
    :show="userMenuShow"
    style="padding: 12px; max-width: 240px"
    trigger="manual"
    @clickoutside="userMenuShow = false"
  >
    <template #trigger>
      <div
        class="user"
        :style="{ pointerEvents: userMenuShow ? 'none' : 'auto' }"
        @click="openMenu"
      >
        <div class="avatar">
          <n-avatar
            v-if="currentLoggedIn"
            :src="currentAvatarUrl"
            fallback-src="/images/avatar.jpg?asset"
            round
          />
          <n-avatar v-else round>
            <SvgIcon name="Person" :depth="3" size="26" />
          </n-avatar>
        </div>
        <n-flex v-if="isDesktop" class="user-data" size="small">
          <n-text class="name">
            {{ currentDisplayName }}
          </n-text>
          <!-- VIP -->
          <img v-if="showVipBadge" class="vip-img" src="/images/vip.png?asset" />
          <SvgIcon :class="['down', { open: userMenuShow }]" name="DropDown" :depth="3" />
        </n-flex>
      </div>
    </template>
    <div class="user-menu" @click="userMenuShow = false">
      <!-- 平台账号 -->
      <div class="platforms">
        <div
          v-for="item in platformList"
          :key="item.platform"
          :class="['platform-item', { active: item.active }]"
          @click="handlePlatform(item)"
        >
          <n-radio
            class="platform-radio"
            :checked="item.active"
            :name="item.platform"
            @click.stop
            @update:checked="() => handlePlatform(item)"
          />
          <span class="platform-badge">{{ item.short }}</span>
          <n-text class="platform-name">{{ item.name }}</n-text>
          <template v-if="item.loggedIn">
            <n-avatar
              round
              :size="20"
              :src="item.avatarUrl"
              fallback-src="/images/avatar.jpg?asset"
            />
            <n-text class="platform-nickname" depth="3">{{ item.nickname }}</n-text>
          </template>
          <n-text v-else class="platform-login" depth="3">登录</n-text>
        </div>
      </div>
      <n-divider />
      <!-- 用户信息 -->
      <n-flex class="user-info" align="center" justify="center" vertical>
        <!-- 第三方平台：头像 + 昵称 + 会员标记 -->
        <template v-if="!isNetease">
          <n-avatar
            v-if="currentProfile?.avatarUrl"
            round
            :size="40"
            :src="currentProfile.avatarUrl"
            fallback-src="/images/avatar.jpg?asset"
          />
          <n-text class="nickname text-hidden">{{ currentProfileName }}</n-text>
          <!-- VIP -->
          <img v-if="currentProfile?.isVip" class="vip-img" src="/images/vip.png?asset" />
        </template>
        <!-- 网易云：昵称 + 等级 + 会员标记 -->
        <template v-else>
          <n-text class="nickname text-hidden">{{
            dataStore.userData.name || "未知用户名"
          }}</n-text>
          <n-flex align="center" size="small">
            <n-tag :bordered="false" size="small" round type="warning">
              Lv.{{ dataStore.userData.level ?? 0 }}
            </n-tag>
            <!-- VIP -->
            <img
              v-if="dataStore.userLoginStatus && dataStore.userData.vipType !== 0"
              class="vip-img"
              src="/images/vip.png?asset"
            />
          </n-flex>
        </template>
      </n-flex>
      <n-divider />
      <!-- 喜欢数量 -->
      <div v-if="showLikeNum" class="like-num">
        <div
          v-for="(item, index) in userLikeData"
          :key="index"
          class="num-item"
          @click="router.push({ name: item.name, query: item.query })"
        >
          <n-number-animation :from="0" :to="item.value" />
          <n-text :depth="3">{{ item.label }}</n-text>
        </div>
      </div>
      <n-flex v-else align="center" vertical>
        <n-text>UID 登录模式</n-text>
        <n-text :depth="3">部分功能暂不可用</n-text>
      </n-flex>
      <n-divider />
      <!-- 退出登录 -->
      <n-button :focusable="false" class="logout" strong secondary round @click="isLogout">
        <template #icon>
          <SvgIcon name="Power" />
        </template>
        退出登录
      </n-button>
    </div>
  </n-popover>
</template>

<script setup lang="ts">
import { useDataStore, usePlatformStore, onPlatformChange, PLATFORM_META } from "@/stores";
import { openUserLogin, openPlatformLogin } from "@/utils/modal";
import { getLoginState } from "@/api/login";
import type { ApiPlatform } from "@/types/shared";
import {
  toLogout,
  isLogin,
  refreshLoginData,
  updateUserData,
  updateSpecialUserData,
} from "@/utils/auth";
import { useMobile } from "@/composables/useMobile";
import { useLikeStats } from "@/composables/useLikeStats";

const router = useRouter();
const dataStore = useDataStore();
const platformStore = usePlatformStore();

const { isDesktop } = useMobile();

// 收藏统计条目（与收藏页同一真源）
const likeStats = useLikeStats();

/** 用户喜欢数据条目 */
interface UserLikeItem {
  /** 数量标签 */
  label: string;
  /** 跳转路由名 */
  name: string;
  /** 数量 */
  value: number;
  /** 跳转时附带的查询参数 */
  query?: Record<string, string>;
}

// 用户菜单展示
const userMenuShow = ref<boolean>(false);

// 平台账号列表
const platformList = computed(() => {
  const current = platformStore.currentPlatform;
  return (Object.keys(PLATFORM_META) as ApiPlatform[]).map((platform) => {
    if (platform === "netease") {
      return {
        platform,
        name: PLATFORM_META.netease.name,
        short: PLATFORM_META.netease.short,
        active: current === platform,
        loggedIn: dataStore.userLoginStatus,
        nickname: dataStore.userData.name || "未知用户名",
        avatarUrl: dataStore.userData?.avatarUrl ?? "",
      };
    }
    const profile = platformStore.platformProfiles[platform];
    return {
      platform,
      name: PLATFORM_META[platform].name,
      short: PLATFORM_META[platform].short,
      active: current === platform,
      loggedIn: !!profile,
      // 上游昵称可能是空白串，取不到时退到用户 ID，再退到平台名
      nickname:
        String(profile?.nickname ?? "").trim() ||
        String(profile?.userId ?? "").trim() ||
        PLATFORM_META[platform].name,
      avatarUrl: profile?.avatarUrl ?? "",
    };
  });
});

// 当前平台是否已登录
const currentLoggedIn = computed(() => {
  if (platformStore.currentPlatform === "netease") return dataStore.userLoginStatus;
  return !!platformStore.platformProfiles[platformStore.currentPlatform];
});

/** 当前是否为网易云平台 */
const isNetease = computed(() => platformStore.currentPlatform === "netease");

/** 当前平台的账号资料（网易云走既有登录态，不经平台资料） */
const currentProfile = computed(() =>
  isNetease.value ? null : platformStore.platformProfiles[platformStore.currentPlatform],
);

/** 当前平台的昵称 */
const currentProfileName = computed(() => {
  const nickname = String(currentProfile.value?.nickname ?? "").trim();
  if (nickname) return nickname;
  // 上游昵称可能为空串（QQ 已知），退到用户 ID，再退到平台名
  const userId = String(currentProfile.value?.userId ?? "").trim();
  return userId || PLATFORM_META[platformStore.currentPlatform].name;
});

/**
 * 顶栏会员标记
 *
 * 网易云按既有登录态与会员类型判定，第三方平台按平台账号资料判定，
 * 避免切到其它平台后仍显示网易云的会员标识。
 */
const showVipBadge = computed<boolean>(() => {
  if (isNetease.value) {
    return dataStore.userLoginStatus && dataStore.userData.vipType !== 0;
  }
  return !!currentProfile.value?.isVip;
});

// 当前平台头像
const currentAvatarUrl = computed(() => {
  if (platformStore.currentPlatform === "netease") return dataStore.userData?.avatarUrl;
  return platformStore.platformProfiles[platformStore.currentPlatform]?.avatarUrl;
});

// 当前平台显示名
const currentDisplayName = computed(() => {
  if (platformStore.currentPlatform === "netease") {
    return dataStore.userLoginStatus ? dataStore.userData.name || "未知用户名" : "未登录";
  }
  const profile = platformStore.platformProfiles[platformStore.currentPlatform];
  if (!profile) return "未登录";
  // 上游昵称可能是空白串，取不到时退到用户 ID 或平台名
  return currentProfileName.value;
});

// 开启用户菜单
const openMenu = () => {
  if (dataStore.userLoginStatus || platformStore.loggedInPlatforms.length > 0) {
    userMenuShow.value = !userMenuShow.value;
  } else {
    openUserLogin();
  }
};

// 选择平台：已登录则切换，未登录则拉起对应平台的登录弹窗
const handlePlatform = (item: (typeof platformList.value)[number]) => {
  userMenuShow.value = false;
  if (!item.loggedIn) {
    if (item.platform === "netease") {
      openUserLogin();
    } else {
      openPlatformLogin(item.platform);
    }
    return;
  }
  platformStore.switchPlatform(item.platform);
};

// 用户喜欢数据
const userLikeData = computed<UserLikeItem[]>(() =>
  likeStats.value.map((item) => ({
    label: item.label,
    name: item.name,
    value: item.length,
    query: item.query,
  })),
);

/**
 * 是否展示统计区
 *
 * 网易云的 UID 登录模式拿不到用户数据，故不展示；
 * 第三方平台的统计与网易云登录方式无关，始终展示。
 */
const showLikeNum = computed<boolean>(
  () => platformStore.currentPlatform !== "netease" || dataStore.loginType !== "uid",
);

// 检查登录状态
const checkLoginStatus = async () => {
  // 若为 UID 登录
  if (dataStore.loginType === "uid") {
    await updateSpecialUserData();
    return;
  }
  // 获取登录状态
  const loginState = await getLoginState();
  // 登录正常
  if (loginState.data?.profile && Object.keys(loginState.data?.profile)?.length) {
    dataStore.userLoginStatus = true;
    // 刷新登录
    await refreshLoginData();
    // 获取用户信息
    await updateUserData();
  }
  // 若还有用户数据，则登录过期
  else if (dataStore.userData.userId !== 0) {
    dataStore.userLoginStatus = false;
    dataStore.userData.userId = 0;
    window.$message.warning("登录已过期，请重新登录", { duration: 2000 });
    openUserLogin();
  }
};

// 退出登录（作用于当前平台）
const isLogout = () => {
  // 第三方平台：退出当前平台的登录态
  if (platformStore.currentPlatform !== "netease") {
    const platform = platformStore.currentPlatform;
    window.$dialog.warning({
      title: "退出登录",
      content: `确认退出${PLATFORM_META[platform].name}登录？`,
      positiveText: "确认登出",
      negativeText: "取消",
      onPositiveClick: async () => {
        await platformStore.logout(platform);
        window.$message.success("已退出登录");
      },
    });
    return;
  }
  if (!isLogin()) {
    openUserLogin();
    return;
  }
  window.$dialog.warning({
    title: "退出登录",
    content: "确认退出当前用户登录？",
    positiveText: "确认登出",
    negativeText: "取消",
    onPositiveClick: () => toLogout(),
  });
};

onBeforeMount(() => {
  checkLoginStatus();
  // 刷新第三方平台的账号资料
  platformStore.refreshAllProfiles();
});

/**
 * 刷新指定平台的账号资料
 *
 * 平台 store 的 refreshProfile 在读取失败时会把资料清空，
 * 这里保留旧资料，避免一次网络抖动就把界面显示成「未登录」。
 * @param platform 音源平台
 */
const refreshPlatformProfile = async (platform: ApiPlatform) => {
  const previous = platformStore.platformProfiles[platform];
  const profile = await platformStore.refreshProfile(platform);
  if (!profile && previous) {
    platformStore.platformProfiles[platform] = previous;
  }
};

// 平台切换：刷新目标平台的账号资料
const stopPlatformWatch = onPlatformChange(({ platform }) => {
  if (platform === "netease") return;
  void refreshPlatformProfile(platform);
});

onUnmounted(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.user {
  display: flex;
  align-items: center;
  height: 34px;
  border-radius: 25px;
  background-color: rgba(var(--primary), 0.08);
  transition: background-color 0.3s;
  cursor: pointer;
  -webkit-app-region: no-drag;
  .avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    min-width: 38px;
    border-radius: 50%;
    border: 2px solid rgba(var(--primary), 0.28);
    .n-avatar {
      width: 100%;
      height: 100%;
    }
  }
  .user-data {
    display: flex;
    align-items: center;
    padding-left: 8px;
    max-width: 200px;
    flex-wrap: nowrap;
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100px;
    }
    .down {
      font-size: 26px;
      margin-right: 4px;
      transition: transform 0.3s;
      &.open {
        transform: rotate(180deg);
      }
    }
  }
  &:hover {
    background-color: rgba(var(--primary), 0.28);
  }
  &:active {
    background-color: rgba(var(--primary), 0.12);
  }
}
.vip-img {
  height: 18px;
}
.user-menu {
  display: flex;
  justify-content: center;
  flex-direction: column;
  .platforms {
    display: flex;
    flex-direction: column;
    gap: 2px;
    .platform-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 4px;
      border-radius: 6px;
      cursor: pointer;
      transition: background-color 0.2s;
      &:hover {
        background-color: rgba(var(--primary), 0.08);
      }
      &.active .platform-name {
        font-weight: bold;
      }
      .platform-radio {
        flex-shrink: 0;
      }
      .platform-badge {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        min-width: 20px;
        border-radius: 5px;
        background-color: rgba(var(--primary), 0.12);
        color: var(--primary-hex);
        font-size: 11px;
        line-height: 1;
      }
      .platform-name {
        font-size: 12px;
        white-space: nowrap;
      }
      .platform-nickname {
        font-size: 12px;
        max-width: 76px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .platform-login {
        font-size: 12px;
      }
    }
  }
  .user-info {
    .nickname {
      font-weight: bold;
    }
    .n-tag {
      height: 18px;
      font-size: 12px;
      pointer-events: none;
    }
  }
  .like-num {
    display: flex;
    justify-content: space-around;
    .num-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      font-size: 16px;
      font-weight: bold;
      cursor: pointer;
      .n-text {
        font-size: 12px;
        font-weight: normal;
      }
    }
  }
  .n-divider {
    margin: 12px 0;
  }
}
</style>
