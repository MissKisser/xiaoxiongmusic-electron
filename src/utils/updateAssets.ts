import type { UpdateAssetInfo } from "@/types/main";

/**
 * 从变体列表中获取指定变体的下载地址
 *
 * @param assets 变体列表
 * @param variant 变体名称
 * @returns 对应的下载地址，未找到则返回空字符串
 */
export const pickAssetUrl = (
  assets: UpdateAssetInfo[] | undefined | null,
  variant: string
): string => {
  if (!assets || !Array.isArray(assets)) return "";
  const match = assets.find((item) => item?.variant === variant);
  return match?.url || "";
};

/**
 * 获取安装版下载地址
 *
 * @param assets 变体列表
 * @param fallbackUrl 兜底下载地址
 * @returns 安装版下载地址；变体缺失时返回空字符串
 */
export const pickSetupUrl = (
  assets: UpdateAssetInfo[] | undefined | null,
  fallbackUrl: string = ""
): string => {
  if (Array.isArray(assets) && assets.length > 0) {
    return pickAssetUrl(assets, "setup");
  }
  return fallbackUrl || "";
};
