<template>
  <n-config-provider :theme="darkTheme">
    <div class="admin-layout">
      <n-layout has-sider class="main-layout">
        <!-- 侧边栏 -->
        <n-layout-sider
          bordered
          :width="240"
          :collapsed-width="64"
          collapse-mode="width"
          :native-scrollbar="false"
          class="admin-sider"
        >
          <div class="sider-header">
            <div class="logo-icon">🐻</div>
            <h2 v-if="!collapsed">小熊管理</h2>
          </div>
          
          <n-menu
            :value="activeKey"
            :options="menuOptions"
            :collapsed-width="64"
            :collapsed-icon-size="22"
            :icon-size="20"
            @update:value="handleMenuSelect"
          />
          
          <div class="sider-footer">
            <n-tooltip trigger="hover" placement="right">
              <template #trigger>
                <n-button text class="logout-btn" @click="handleLogout">
                  <template #icon>
                    <n-icon><LogOutOutline /></n-icon>
                  </template>
                  <span v-if="!collapsed">退出登录</span>
                </n-button>
              </template>
              退出登录
            </n-tooltip>
          </div>
        </n-layout-sider>

        <!-- 主内容区 -->
        <n-layout class="content-layout">
          <n-layout-header bordered class="admin-header">
            <div class="header-left">
              <span class="page-title">{{ currentTitle }}</span>
            </div>
            <div class="header-right">
              <div class="user-profile">
                <n-avatar round size="small" src="https://api.dicebear.com/7.x/avataaars/svg?seed=admin" />
                <span class="username">{{ adminUsername }}</span>
              </div>
            </div>
          </n-layout-header>
          
          <n-layout-content class="admin-content" :native-scrollbar="false">
            <div class="content-wrapper">
              <router-view v-slot="{ Component }">
                <transition name="fade-slide" mode="out-in">
                  <component :is="Component" />
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
import { ref, computed, h } from 'vue';
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
  NAvatar,
  NTooltip
} from 'naive-ui';
import { 
  SpeedometerOutline, 
  KeyOutline, 
  GitNetworkOutline, 
  ReaderOutline,
  LogOutOutline
} from '@vicons/ionicons5';

const router = useRouter();
const route = useRoute();
const collapsed = ref(false);

const adminUsername = ref(localStorage.getItem('admin_username') || '管理员');

// 渲染图标辅助函数
function renderIcon(icon: any) {
  return () => h(NIcon, null, { default: () => h(icon) });
}

// 菜单选项
const menuOptions = [
  {
    label: '仪表盘',
    key: 'dashboard',
    icon: renderIcon(SpeedometerOutline)
  },
  {
    label: '授权码管理',
    key: 'codes',
    icon: renderIcon(KeyOutline)
  },
  {
    label: '版本管理',
    key: 'versions',
    icon: renderIcon(GitNetworkOutline)
  },
  {
    label: '操作日志',
    key: 'logs',
    icon: renderIcon(ReaderOutline)
  },
];

// 当前选中的菜单
const activeKey = computed(() => {
  const path = route.path;
  if (path.includes('dashboard')) return 'dashboard';
  if (path.includes('codes')) return 'codes';
  if (path.includes('versions')) return 'versions';
  if (path.includes('logs')) return 'logs';
  return 'dashboard';
});

// 当前页面标题
const currentTitle = computed(() => {
  const option = menuOptions.find(opt => opt.key === activeKey.value);
  return option ? option.label : '管理后台';
});

// 处理菜单选择
const handleMenuSelect = (key: string) => {
  router.push(`/bamger/${key}`);
};

// 退出登录
const handleLogout = () => {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_username');
  router.push('/bamger/login');
};
</script>

<style lang="scss" scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

.admin-layout {
  height: 100vh;
  background-color: #000;
  font-family: 'Inter', sans-serif;
  overflow: hidden;
}

.main-layout {
  height: 100%;
  background-color: transparent !important;
}

.admin-sider {
  background-color: #111 !important;
  border-right: 1px solid rgba(255, 255, 255, 0.05) !important;
  
  .sider-header {
    height: 64px;
    display: flex;
    align-items: center;
    padding: 0 20px;
    
    .logo-icon {
      font-size: 24px;
      margin-right: 12px;
    }

    h2 {
      font-size: 16px;
      font-weight: 700;
      color: #fff;
      margin: 0;
      white-space: nowrap;
    }
  }

  .sider-footer {
    position: absolute;
    bottom: 0;
    width: 100%;
    padding: 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    
    .logout-btn {
      color: rgba(255, 255, 255, 0.6);
      &:hover {
        color: #ff6b6b;
      }
    }
  }
}

.content-layout {
  background-color: transparent !important;
}

.admin-header {
  height: 64px;
  background-color: rgba(17, 17, 17, 0.8) !important;
  backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 32px;

  .header-title {
    font-size: 18px;
    font-weight: 600;
  }
  
  .user-profile {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 30px;
    
    .username {
      font-size: 14px;
      font-weight: 500;
    }
  }
}

.admin-content {
  background-color: #050505 !important;
  position: relative;
  
  .content-wrapper {
    padding: 32px;
    max-width: 1600px;
    margin: 0 auto;
  }
}

/* 页面切换动画 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.3s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}
</style>
