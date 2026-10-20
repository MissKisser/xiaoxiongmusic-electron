<template>
  <div class="platform-login">
    <div class="qr-box">
      <div v-if="qrContent" :class="['qr', { success: statusCode === 2 }]">
        <!-- 后端下发的二维码图片（QQ 音乐原生扫码） -->
        <img v-if="isImageQr" :src="qrContent" class="qr-image" alt="qrcode" />
        <!-- 需要前端编码的二维码内容（酷狗） -->
        <n-qr-code
          v-else
          :value="qrContent"
          :size="180"
          :icon-size="30"
          icon-src="/images/logo.png?asset"
          error-correction-level="H"
        />
        <!-- 待确认 -->
        <Transition name="fade" mode="out-in">
          <div v-if="loginName" class="login-data">
            <n-image :src="loginAvatar" class="cover" preview-disabled />
            <n-text>{{ loginName }}</n-text>
          </div>
        </Transition>
      </div>
      <n-skeleton v-else class="qr" />
    </div>
    <n-text class="tip" depth="3">{{ tipText }}</n-text>
    <!-- 扫码方式 -->
    <n-radio-group
      v-if="platform === 'qqmusic'"
      v-model:value="scanType"
      size="small"
      class="scan-type"
    >
      <n-radio value="qq">QQ 扫码</n-radio>
      <n-radio value="wx">微信扫码</n-radio>
    </n-radio-group>
    <n-button :focusable="false" class="close" strong secondary round @click="emit('close')">
      <template #icon>
        <SvgIcon name="WindowClose" />
      </template>
      取消
    </n-button>
  </div>
</template>

<script setup lang="ts">
import type { ApiPlatform } from "@/types/shared";
import { platformCall } from "@/api/platform/music";
import { usePlatformStore } from "@/stores";

const props = defineProps<{
  /** 音源平台 */
  platform: ApiPlatform;
}>();

const emit = defineEmits<{
  close: [];
}>();

const platformStore = usePlatformStore();

/** 扫码方式（QQ 音乐支持 QQ / 微信两种原生扫码协议） */
const scanType = ref<"qq" | "wx">("qq");

/** 二维码内容 */
const qrContent = ref<string>("");

/** 二维码 key（QQ 为 qrsig，酷狗为 qrcode） */
const qrKey = ref<string>("");

/** 扫描状态码 */
const statusCode = ref<number>(1);

/** 待确认的昵称与头像 */
const loginName = ref<string>("");
const loginAvatar = ref<string>("");

/** 状态提示文案 */
const statusTip = {
  0: "二维码已失效，正在刷新",
  1: "请扫码登录",
  2: "扫描成功，请在 App 中确认登录",
  4: "登录成功",
} as const;

/** 当前提示文案 */
const tipText = computed(() => {
  return statusTip[statusCode.value as keyof typeof statusTip] ?? "遇到未知状态，请重试";
});

/** 二维码内容是否为后端下发的图片 */
const isImageQr = computed(() => qrContent.value.startsWith("data:image/"));

/**
 * 获取二维码
 *
 * 二维码内容与 key 均由主进程平台模块下发，渲染端不接触任何凭据。
 */
const getQrData = async () => {
  try {
    pauseCheck();
    statusCode.value = 1;
    loginName.value = "";
    loginAvatar.value = "";
    const res = await platformCall<{ code: number; key: string; content: string }>(
      props.platform,
      "login_qr_key",
      props.platform === "qqmusic" ? { type: scanType.value } : {},
    );
    qrKey.value = res.key;
    qrContent.value = res.content;
    resumeCheck();
  } catch (error) {
    pauseCheck();
    console.error("二维码获取失败：", error);
    window.$message.error("二维码获取失败，请重试");
  }
};

/**
 * 轮询二维码状态
 */
const checkQrStatus = async () => {
  if (!qrKey.value) return;
  try {
    const res = await platformCall<{
      code: number;
      status: number;
      nickname?: string;
      avatarUrl?: string;
    }>(props.platform, "login_qr_check", {
      key: qrKey.value,
      type: scanType.value,
    });
    statusCode.value = res.status ?? 1;
    if (res.nickname) loginName.value = res.nickname;
    if (res.avatarUrl) loginAvatar.value = res.avatarUrl.replace(/^http:/, "https:");
    // 二维码失效：重新取一个
    if (statusCode.value === 0) {
      getQrData();
      return;
    }
    // 登录成功：刷新账号资料并切换到该平台
    if (statusCode.value === 4) {
      pauseCheck();
      await platformStore.refreshProfile(props.platform);
      platformStore.switchPlatform(props.platform);
      window.$message.success("登录成功");
      emit("close");
    }
  } catch (error) {
    console.error("二维码状态检查失败：", error);
  }
};

/** 轮询控制 */
const { pause: pauseCheck, resume: resumeCheck } = useIntervalFn(checkQrStatus, 2000, {
  immediate: false,
});

// 切换扫码方式后重新取码
watch(scanType, () => {
  getQrData();
});

onMounted(getQrData);
onBeforeUnmount(pauseCheck);
</script>

<style lang="scss" scoped>
.platform-login {
  display: flex;
  flex-direction: column;
  align-items: center;
  .qr-box {
    display: flex;
    margin: 8px 0 12px;
    width: 190px;
    height: 190px;
    .qr {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      .qr-image {
        width: 180px;
        height: 180px;
        object-fit: contain;
      }
      .n-qr-code {
        padding: 0;
        height: 180px;
        width: 180px;
        min-height: 180px;
        min-width: 180px;
        transition:
          opacity 0.3s,
          filter 0.3s;
        :deep(canvas) {
          width: 100% !important;
          height: 100% !important;
        }
      }
      .login-data {
        position: absolute;
        display: flex;
        flex-direction: column;
        align-items: center;
        z-index: 1;
        .cover {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          overflow: hidden;
          margin-bottom: 8px;
        }
      }
      &.success {
        .n-qr-code,
        .qr-image {
          opacity: 0.5;
          filter: blur(4px);
        }
      }
    }
  }
  .tip {
    margin-bottom: 12px;
  }
  .scan-type {
    margin-bottom: 12px;
    font-size: 12px;
  }
  .close {
    margin-bottom: 4px;
  }
}
</style>
