import type { UpdateAssetInfo } from "@/types/main";

/**
 * 判断是否为安装包地址
 *
 * @param url 下载地址
 * @returns 是否匹配安装包命名规则
 */
const isSetupUrl = (url: string): boolean => /-setup\.exe$/i.test(url);

/**
 * 判断是否为便携版地址
 *
 * @param url 下载地址
 * @returns 是否匹配便携版命名规则
 */
const isPortableUrl = (url: string): boolean => /-portable\.exe$/i.test(url);

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
 * 获取便携版下载地址
 *
 * @param assets 变体列表
 * @param fallbackUrl 兜底下载地址
 * @returns 便携版下载地址
 */
export const pickPortableUrl = (
  assets: UpdateAssetInfo[] | undefined | null,
  fallbackUrl: string = ""
): string => {
  if (Array.isArray(assets) && assets.length > 0) {
    return pickAssetUrl(assets, "portable");
  }
  const url = fallbackUrl || "";
  if (isSetupUrl(url)) {
    return url.replace(/-setup(\.exe)$/i, "-portable$1");
  }
  return url;
};

/**
 * 获取安装版下载地址
 *
 * @param assets 变体列表
 * @param fallbackUrl 兜底下载地址
 * @returns 安装版下载地址
 */
export const pickSetupUrl = (
  assets: UpdateAssetInfo[] | undefined | null,
  fallbackUrl: string = ""
): string => {
  if (Array.isArray(assets) && assets.length > 0) {
    return pickAssetUrl(assets, "setup");
  }
  const url = fallbackUrl || "";
  if (isPortableUrl(url)) {
    return url.replace(/-portable(\.exe)$/i, "-setup$1");
  }
  return url;
};
