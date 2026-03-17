<template>
  <div class="setting">
    <!-- 移动端遮罩层 -->
    <Transition name="fade">
      <div v-if="showLeftMenu" class="mobile-overlay" @click="showLeftMenu = false" />
    </Transition>
    <!-- 左侧菜单 -->
    <Transition name="slideLeft">
      <div v-show="showLeftMenu" class="set-left">
        <n-flex class="title" :size="0" vertical>
          <n-h1>设置</n-h1>
          <n-text :depth="3">个性化与全局设置</n-text>
        </n-flex>
        <n-scrollbar style="height: calc(100% - 160px)">
          <n-menu
            v-model:value="activeKey"
            :options="menuOptions"
            :indent="10"
            @update:value="onMenuSelect"
          />
        </n-scrollbar>
      </div>
    </Transition>
    <div class="set-right">
      <!-- 标题 -->
      <n-flex class="set-title" size="small" align="end" vertical>
        <n-h1>{{ currentTitle }}</n-h1>
        <n-text :depth="3">{{ currentSubtitle }}</n-text>
      </n-flex>
      <n-scrollbar
        ref="setScrollbar"
        class="set-content"
        :content-style="{ overflow: 'hidden', padding: '40px 0' }"
      >
        <Transition name="fade" mode="out-in">
          <component :is="currentComponent" :scroll-to="props.scrollTo" />
        </Transition>
      </n-scrollbar>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { NScrollbar } from "naive-ui";
import type { MenuOption /* , MenuInst */ } from "naive-ui";
import type { SettingType } from "@/types/main";
import { useMobile } from "@/composables/useMobile";
import { renderIcon } from "@/utils/helper";
import { isElectron } from "@/utils/env";
// import { useStatusStore } from "@/stores";
// import packageJson from "@/../package.json";
import GeneralSetting from "./GeneralSetting.vue";
import PlaySetting from "./PlaySetting.vue";
import LyricsSetting from "./LyricsSetting.vue";
import KeyboardSetting from "./KeyboardSetting.vue";
import LocalSetting from "./LocalSetting.vue";
import ThirdSetting from "./ThirdSetting.vue";
import StreamingSetting from "./StreamingSetting.vue";
import OtherSetting from "./OtherSetting.vue";
// import AboutSetting from "./AboutSetting.vue";

const props = defineProps<{ type: SettingType; scrollTo?: string }>();

const { isSmallScreen } = useMobile();
// const statusStore = useStatusStore();

// 设置内容
const setScrollbar = ref<InstanceType<typeof NScrollbar> | null>(null);

// 移动端菜单显示状态
const showLeftMenu = ref(true);

// 监听屏幕大小变化，非小屏时自动显示侧边栏
watch(isSmallScreen, (small) => {
  if (!small) {
    showLeftMenu.value = true;
  }
});

// 菜单数据
const activeKey = ref<SettingType>(props.type);

// 菜单选择处理
const onMenuSelect = () => {
  setScrollbar.value?.scrollTo({ top: 0, behavior: "smooth" });
  // 移动端选择后自动收起菜单
  if (isSmallScreen.value) {
    showLeftMenu.value = false;
  }
};

// 菜单内容
const menuOptions: MenuOption[] = [
  { key: "general", label: "常规设置", icon: renderIcon("SettingsLine") },
  { key: "play", label: "播放设置", icon: renderIcon("Music") },
  { key: "lyrics", label: "歌词设置", icon: renderIcon("Lyrics") },
  { key: "keyboard", label: "快捷键设置", show: isElectron, icon: renderIcon("Keyboard") },
  { key: "local", label: "本地与缓存", show: isElectron, icon: renderIcon("Storage") },
  { key: "third", label: "连接与集成", icon: renderIcon("Extension") },
  { key: "streaming", label: "流媒体设置", icon: renderIcon("Stream") },
  { key: "other", label: "其他设置", icon: renderIcon("SettingsOther") },
  // { key: "about", label: "关于", icon: renderIcon("Info") },
];

// 当前组件映射
const componentMap: Record<SettingType, any> = {
  general: GeneralSetting,
  play: PlaySetting,
  lyrics: LyricsSetting,
  keyboard: KeyboardSetting,
  local: LocalSetting,
  third: ThirdSetting,
  streaming: StreamingSetting,
  other: OtherSetting,
  // about: AboutSetting,
};

// 当前标题映射
const titleMap: Record<SettingType, { title: string; subtitle: string }> = {
  general: { title: "常规设置", subtitle: "主题、外观与全局设置" },
  play: { title: "播放设置", subtitle: "播放行为与音质设置" },
  lyrics: { title: "歌词设置", subtitle: "个性化歌词显示设置" },
  keyboard: { title: "快捷键设置", subtitle: "自定义键盘快捷键" },
  local: { title: "本地与缓存", subtitle: "本地音乐与缓存管理" },
  third: { title: "连接与集成", subtitle: "第三方服务连接设置" },
  streaming: { title: "流媒体设置", subtitle: "流媒体服务器配置" },
  other: { title: "其他设置", subtitle: "代理、数据与高级选项" },
  // about: { title: "关于", subtitle: "应用信息与版本" },
};

// 当前组件
const currentComponent = computed(() => componentMap[activeKey.value]);

// 当前标题
const currentTitle = computed(() => titleMap[activeKey.value]?.title || "设置");

// 当前副标题
const currentSubtitle = computed(() => titleMap[activeKey.value]?.subtitle || "");

// const toGithub = () => {
//   window.open(packageJson.github);
// };
</script>

<style lang="scss" scoped>
.setting {
  position: relative;
  display: flex;
  width: 100%;
  height: 75vh;
  min-height: 75vh;
  overflow: hidden;
  .mobile-overlay {
    display: none;
  }
  .set-left {
    display: flex;
    flex-direction: column;
    width: 280px;
    height: 100%;
    padding: 20px;
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    background-color: rgba(var(--surface-container), 0.5) !important;
    .title {
      height: 60px;
      margin: 10px 0 20px 10px;
      .n-h1 {
        font-size: 26px;
        font-weight: bold;
        margin-top: 0;
        line-height: normal;
        margin-bottom: 6px;
      }
    }
    .n-menu {
      width: 100%;
      flex: 1;
    }
    .power {
      height: 50px;
      margin: auto 0 0 10px;
      .name {
        font-weight: bold;
        margin-right: 6px;
      }
      .version {
        pointer-events: none;
      }
      .author {
        display: flex;
        flex-direction: row;
        align-items: center;
        margin-bottom: 4px;
        cursor: pointer;
        .n-icon {
          margin-right: 4px;
        }
      }
    }
  }
  .set-right {
    flex: 1;
    height: 100%;
    display: flex;
    flex-direction: column;
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    background-color: rgba(var(--background), 0.5) !important;
    .set-title {
      padding: 20px 40px 0;
      .n-h1 {
        font-size: 26px;
        font-weight: bold;
        margin-top: 0;
        line-height: normal;
        margin-bottom: 6px;
      }
    }
    .mobile-title {
      display: none !important;
    }
  }
  @media (max-width: 768px) {
    .mobile-overlay {
      display: block;
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 10;
    }
    .set-left {
      position: absolute;
      left: 0;
      top: 0;
      z-index: 11;
      box-shadow: 2px 0 8px rgba(0, 0, 0, 0.15);
    }
    .set-right {
      width: 100%;
      display: flex;
      flex-direction: column;
      .mobile-title {
        display: flex !important;
        padding: 20px 12px 16px;
        gap: 12px;
        .n-h1 {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 0;
          line-height: normal;
          margin: 0;
        }
      }
    }
  }
}
</style>

<style lang="scss">
.main-setting {
  position: relative;
  width: calc(100vw - 40px);
  max-width: 1024px !important;
  overflow: hidden;
  .n-card-header {
    position: absolute;
    top: 0;
    right: 0;
    padding: 20px;
    z-index: 1;
  }
  .n-card__content {
    padding: 0;
    .setting-type {
      transition: opacity 0.2s ease-in-out;
    }
    .set-content {
      padding: 0 40px;
    }
    .set-list {
      padding-top: 30px;
      &:first-child {
        padding-top: 0;
      }
    }
    .n-h {
      display: inline-flex;
      flex-direction: row;
      align-items: center;
      gap: 8px;
    }
    .n-collapse-transition {
      margin-bottom: 12px;
      &:last-child {
        margin-bottom: 0;
      }
    }
    .set-item {
      width: 100%;
      border-radius: 8px;
      margin-bottom: 12px;
      transition: margin 0.3s;
      &:last-child {
        margin-bottom: 0;
      }
      .n-card__content {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        padding: 16px;
      }
      .label {
        display: flex;
        flex-direction: column;
        padding-right: 20px;
        .name {
          font-size: 16px;
        }
      }
      .n-flex {
        flex-flow: nowrap !important;
      }
      .set {
        justify-content: flex-end;
        min-width: 200px;
        width: 200px;
        &.n-switch {
          width: max-content;
        }
      }
    }
    @media (max-width: 768px) {
      .set-content {
        padding: 0 16px;
        .n-scrollbar-content {
          padding: 12px 0 !important;
        }
      }
      .set-item {
        .set {
          @media (max-width: 768px) {
            width: 140px;
            min-width: 140px;
          }
        }
      }
    }
  }
  .n-menu {
    .n-menu-item-content {
      &::before {
        left: 0px;
        right: 0;
        width: 100%;
        border-radius: 6px;
      }
    }
  }
}
</style>
