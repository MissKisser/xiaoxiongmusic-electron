/**
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 *
 * Source: splayer-next-upstream @ 4b429a2 (feat: 新增复制歌词)
 *         src/composables/useCopyText.ts
 */

import { copyData } from "@/utils/helper";

/**
 * 复制文本到剪贴板，自动 toast 反馈
 */
export const useCopyText = () => {
  /**
   * 复制文本
   * @param text - 要复制的内容
   * @param successMessage - 复制成功提示（可选，默认「已复制到剪贴板」）
   */
  const copy = async (
    text: string | null | undefined,
    successMessage?: string,
  ): Promise<boolean> => {
    if (!text) {
      window.$message?.error?.("复制失败，内容为空");
      return false;
    }
    try {
      await copyData(text, successMessage);
      return true;
    } catch {
      window.$message?.error?.("复制失败，请重试");
      return false;
    }
  };

  return { copy };
};
