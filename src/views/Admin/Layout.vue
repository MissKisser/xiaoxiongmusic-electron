<template>
  <n-config-provider :theme="isDark ? darkTheme : null">
    <div class="admin-layout" :class="{ 'dark-mode': isDark }">
      <n-layout has-sider class="main-layout">
        <!-- 移动端遮罩 -->
        <div v-if="isMobile && siderVisible" class="sider-overlay" @click="siderVisible = false" />

        <!-- 侧边栏 -->
        <n-layout-sider
          v-show="!isMobile || siderVisible"
          bordered
          :width="220"
          :collapsed-width="64"
          collapse-mode="width"
          :native-scrollbar="false"
          :class="['admin-sider', { 'mobile-sider': isMobile }]"
        >
          <div class="sider-header">
            <n-icon size="24" :color="isDark ? '#3b82f6' : '#2563eb'"><MusicalNotesOutline /></n-icon>
            <h2>小熊管理</h2>
          </div>

          <n-menu
            :value="activeKey"
            :options="menuOptions"
            :collapsed-width="64"
            :collapsed-icon-size="20"
            :icon-size="18"
            @update:value="handleMenuSelect"
          />

          <div class="sider-footer">
            <n-flex vertical :size="12">
              <n-button text class="theme-btn" @click="toggleTheme">
                <template #icon>
                  <n-icon size="18"><component :is="isDark ? SunnyOutline : MoonOutline" /></n-icon>
                </template>
                {{ isDark ? '浅色模式' : '深色模式' }}
              </n-button>
              <n-button text class="logout-btn" @click="handleLogout">
                <template #icon><n-icon size="18"><LogOutOutline /></n-icon></template>
                退出登录
              </n-button>
            </n-flex>
          </div>
        </n-layout-sider>

        <!-- 主内容区 -->
        <n-layout class="content-layout">
          <n-layout-header bordered class="admin-header">
            <div class="header-left">
              <n-button v-if="isMobile" text class="menu-toggle" @click="siderVisible = !siderVisible">
                <template #icon><n-icon size="20"><MenuOutline /></n-icon></template>
              </n-button>
              <span class="page-title">{{ currentTitle }}</span>
            </div>
            <div class="header-right">
              <span class="username">{{ adminUsername }}</span>
            </div>
          </n-layout-header>

          <n-layout-content class="admin-content" :native-scrollbar="false">
            <div class="content-center">
              <router-view v-slot="{ Component }">
                <transition name="fade" mode="out-in">
                  <component :is="Component" :is-dark="isDark" />
                </transition>
              </router-view>
            </div>
          </n-layout-content>
        </n-layout>
      </n-layout>
    </div>
  </n-config-provider>
</template>

<script setup lang="ts">
import { ref, computed, h, onMounted, onUnmounted, provide } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import {
  darkTheme,
  NConfigProvider,
  NLayout,
  NLayoutSider,
  NLayoutHeader,
  NLayoutContent,
  NMenu,
  NButton,
  NIcon,
  NFlex,
} from 'naive-ui';
import {
  GridOutline,
  KeyOutline,
  GitBranchOutline,
  DocumentTextOutline,
  LogOutOutline,
  MenuOutline,
  MusicalNotesOutline,
  MoonOutline,
  SunnyOutline,
} from '@vicons/ionicons5';

const router = useRouter();
const route = useRoute();
const adminUsername = ref(localStorage.getItem('admin_username') || '管理员');
const isMobile = ref(false);
const siderVisible = ref(false);
const isDark = ref(localStorage.getItem('admin_theme') === 'dark');

// 提供主题状态给子组件
provide('adminTheme', isDark);

const toggleTheme = () => {
  isDark.value = !isDark.value;
  localStorage.setItem('admin_theme', isDark.value ? 'dark' : 'light');
};

const checkMobile = () => {
  isMobile.value = window.innerWidth <= 768;
  if (!isMobile.value) siderVisible.value = false;
};

onMounted(() => {
  checkMobile();
  window.addEventListener('resize', checkMobile);
});

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile);
});

function renderIcon(icon: any) {
  return () => h(NIcon, null, { default: () => h(icon) });
}

const menuOptions = [
  { label: '仪表盘', key: 'dashboard', icon: renderIcon(GridOutline) },
  { label: '授权码', key: 'codes', icon: renderIcon(KeyOutline) },
  { label: '版本管理', key: 'versions', icon: renderIcon(GitBranchOutline) },
  { label: '操作日志', key: 'logs', icon: renderIcon(DocumentTextOutline) },
];

const activeKey = computed(() => {
  const path = route.path;
  if (path.includes('dashboard')) return 'dashboard';
  if (path.includes('codes')) return 'codes';
  if (path.includes('versions')) return 'versions';
  if (path.includes('logs')) return 'logs';
  return 'dashboard';
});

const currentTitle = computed(() => {
  const option = menuOptions.find(opt => opt.key === activeKey.value);
  return option ? option.label : '管理后台';
});

const handleMenuSelect = (key: string) => {
  router.push(`/bamger/${key}`);
  if (isMobile.value) siderVisible.value = false;
};

const handleLogout = () => {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_username');
  router.push('/bamger/login');
};
</script>

<style lang="scss" scoped>
.admin-layout {
  height: 100vh;
  background: #f5f5f7;
  transition: background 0.3s;

  &.dark-mode {
    background: #0a0a0f;
  }
}

.main-layout {
  height: 100%;
  background: transparent !important;
}

.sider-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 99;
}

.admin-sider {
  background: #ffffff !important;
  border-right: 1px solid #e5e5e5 !important;
  transition: background 0.3s, border-color 0.3s;

  .dark-mode & {
    background: #12121a !important;
    border-right-color: rgba(255, 255, 255, 0.06) !important;
  }

  .sider-header {
    height: 60px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 18px;

    h2 {
      font-size: 15px;
      font-weight: 600;
      color: #18181b;
      margin: 0;
      .dark-mode & { color: #e4e4e7; }
    }
  }

  .sider-footer {
    position: absolute;
    bottom: 0;
    width: 100%;
    padding: 16px 18px;
    border-top: 1px solid #e5e5e5;
    .dark-mode & { border-top-color: rgba(255, 255, 255, 0.06); }

    .theme-btn {
      color: #71717a;
      &:hover { color: #2563eb; .dark-mode & { color: #3b82f6; } }
    }

    .logout-btn {
      color: #71717a;
      &:hover { color: #ef4444; }
    }
  }

  &.mobile-sider {
    position: fixed !important;
    top: 0;
    left: 0;
    height: 100vh;
    z-index: 100;
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.15);
    .dark-mode & { box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4); }
  }
}

.content-layout {
  background: transparent !important;
}

.admin-header {
  height: 60px;
  background: rgba(255, 255, 255, 0.95) !important;
  backdrop-filter: blur(12px);
  border-bottom: 1px solid #e5e5e5 !important;
  transition: background 0.3s, border-color 0.3s;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;

  .dark-mode & {
    background: rgba(18, 18, 26, 0.9) !important;
    border-bottom-color: rgba(255, 255, 255, 0.06) !important;
  }

  .header-left { display: flex; align-items: center; gap: 10px; }
  .menu-toggle { color: #71717a; &:hover { color: #18181b; .dark-mode & { color: #e4e4e7; } } }
  .page-title { font-size: 14px; font-weight: 500; color: #71717a; }
  .username { font-size: 14px; color: #a1a1aa; }
}

.admin-content {
  background: #f5f5f7 !important;
  padding: 24px;
  transition: background 0.3s;

  .dark-mode & {
    background: #0a0a0f !important;
  }

  // Naive UI scrollbar 居中
  :deep(.n-scrollbar),
  :deep(.n-scrollbar-container),
  :deep(.n-scrollbar-content) {
    display: flex;
    justify-content: center;
  }

  .content-center {
    width: 100%;
    max-width: 1200px;
  }
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@media (max-width: 768px) {
  .admin-header { padding: 0 16px; }
  .admin-content { padding: 16px; }
}
</style>