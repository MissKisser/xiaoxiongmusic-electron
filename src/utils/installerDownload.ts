/** 文件名非法字符，路径分隔符与常见非法字符统一替换为中划线 */
const ILLEGAL_FILENAME_CHARS = /[/\\:*?"<>|]/g;

/** 无法从地址解析出文件名时使用的默认名 */
const DEFAULT_INSTALLER_FILENAME = "xiaoxiongmusic-setup.exe";

/**
 * 从下载地址解析安装包文件名
 *
 * @param url 下载地址
 * @returns 清洗后的文件名；无法解析时返回默认名
 */
export const resolveInstallerFileName = (url: string): string => {
  const withoutQuery = (url || "").split(/[?#]/)[0];
  const rawName = withoutQuery.substring(withoutQuery.lastIndexOf("/") + 1);
  let decoded = "";
  try {
    decoded = decodeURIComponent(rawName);
  } catch {
    decoded = rawName;
  }
  const cleaned = decoded.replace(ILLEGAL_FILENAME_CHARS, "-").trim();
  return cleaned || DEFAULT_INSTALLER_FILENAME;
};

/**
 * 将字节数格式化为易读文本
 *
 * @param bytes 字节数
 * @returns 带单位的大小文本
 */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** exponent;
  return `${exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
};
