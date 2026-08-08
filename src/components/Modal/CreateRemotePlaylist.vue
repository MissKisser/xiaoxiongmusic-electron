<template>
  <div class="create-remote-playlist">
    <n-form ref="formRef" :model="formData" :rules="formRules">
      <n-form-item label="歌单名称" path="name">
        <n-input
          v-model:value="formData.name"
          placeholder="请输入歌单名称"
          @keyup.enter="toCreateRemotePlaylist"
        />
      </n-form-item>
      <n-form-item label="WebDAV 服务地址" path="url">
        <n-input
          v-model:value="formData.url"
          type="text"
          placeholder="https://dav.example.com"
          @keyup.enter="toCreateRemotePlaylist"
        />
      </n-form-item>
      <n-form-item label="用户名" path="username">
        <n-input
          v-model:value="formData.username"
          placeholder="WebDAV 用户名（可留空）"
          @keyup.enter="toCreateRemotePlaylist"
        />
      </n-form-item>
      <n-form-item label="密码" path="password">
        <n-input
          v-model:value="formData.password"
          type="password"
          show-password-on="click"
          placeholder="WebDAV 密码（可留空）"
          @keyup.enter="toCreateRemotePlaylist"
        />
      </n-form-item>
      <n-form-item label="挂载目录" path="rootPath">
        <n-input
          v-model:value="formData.rootPath"
          placeholder="/ 或 /music"
          @keyup.enter="toCreateRemotePlaylist"
        />
      </n-form-item>
      <n-form-item label="扫描深度" path="scanDepth">
        <n-input-number v-model:value="formData.scanDepth" :min="0" :max="10" style="width: 100%" />
      </n-form-item>
    </n-form>
    <n-button class="create" type="primary" :loading="submitting" @click="toCreateRemotePlaylist">
      新建
    </n-button>
  </div>
</template>

<script setup lang="ts">
import type { FormInst, FormItemRule, FormRules } from "naive-ui";
import { useLocalStore } from "@/stores";

const emit = defineEmits<{ close: [] }>();

// 表单类型
interface RemoteFormType {
  name: string;
  url: string;
  username: string;
  password: string;
  rootPath: string;
  scanDepth: number;
}

const localStore = useLocalStore();

const formRef = ref<FormInst | null>(null);
const submitting = ref(false);
const formData = ref<RemoteFormType>({
  name: "",
  url: "",
  username: "",
  password: "",
  rootPath: "/",
  scanDepth: 2,
});

// WebDAV 服务地址校验
const urlRule: FormItemRule = {
  required: true,
  trigger: ["blur"],
  validator: (_: FormItemRule, value: string) => {
    if (!value) return new Error("请输入 WebDAV 服务地址");
    if (!/^https?:\/\/.+/i.test(value.trim())) {
      return new Error("请输入正确的 http(s) 地址");
    }
    return true;
  },
};

const formRules: FormRules = {
  name: {
    required: true,
    message: "请输入歌单名称",
    trigger: ["blur"],
  },
  url: urlRule,
};

// 新建远程歌单
const toCreateRemotePlaylist = async (e?: MouseEvent | KeyboardEvent) => {
  if (e) e.preventDefault();
  if (submitting.value) return;
  submitting.value = true;
  try {
    await formRef.value?.validate();
    await localStore.createRemotePlaylist(formData.value.name.trim(), {
      url: formData.value.url.trim(),
      username: formData.value.username.trim(),
      password: formData.value.password,
      rootPath: formData.value.rootPath.trim(),
      scanDepth: formData.value.scanDepth,
    });
    emit("close");
    window.$message.success("新建远程歌单成功");
  } catch (error) {
    // 表单校验失败时 Naive UI 抛出校验错误数组，不做提示
    // 主进程校验失败时抛出 Error，直接提示原因
    if (error instanceof Error && error.message) {
      window.$message.error(error.message);
    }
  } finally {
    submitting.value = false;
  }
};
</script>

<style lang="scss" scoped>
.create-remote-playlist {
  .n-form {
    margin-top: 12px;
  }
  .create {
    width: 100%;
  }
}
</style>
