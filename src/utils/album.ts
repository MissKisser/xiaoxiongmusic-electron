/**
 * 专辑详情跳转
 *
 * 各处「进入专辑详情」的入口都走这里，保证同一套平台定位口径：
 * 第三方平台（QQ 音乐 / 酷狗）的专辑以「平台 + 平台主键」定位，
 * 网易云沿用平台数字 id、不带 platform 参数。
 */

import type { ApiPlatform } from "@/types/shared";
import type { MetaData } from "@/types/main";
import router from "@/router";

/** 专辑条目无法定位时的提示文案 */
const ALBUM_JUMP_UNAVAILABLE = "该专辑暂不支持跳转";

/**
 * 取专辑条目的来源平台
 *
 * 优先级：专辑条目自带平台 → 内容来源平台（歌曲 / 歌单 / 专辑所属平台）
 * → 网易云。
 *
 * 平台未知且条目带平台主键时返回 null：此时无从判断该主键属于哪个平台
 * （酷狗的 album_id 是数字串，与网易云数字 id 无法区分），
 * 宁可不跳转，也不把第三方主键丢给网易云查询。
 * @param album 专辑条目
 * @param contentPlatform 内容来源平台
 * @returns 来源平台，无法判定时为 null
 */
const resolveAlbumPlatform = (
  album: MetaData,
  contentPlatform?: ApiPlatform,
): ApiPlatform | null => {
  if (album.platform) return album.platform;
  if (contentPlatform) return contentPlatform;
  return album.platformId ? null : "netease";
};

/**
 * 判断专辑条目能否定位到具体专辑
 *
 * 第三方平台靠平台主键定位（QQ 音乐 album mid / 酷狗 album_id），
 * 网易云靠平台数字 id 定位。
 * @param album 专辑条目
 * @param contentPlatform 内容来源平台
 * @returns 能否定位到具体专辑
 */
export const canJumpAlbum = (album: MetaData, contentPlatform?: ApiPlatform): boolean => {
  const platform = resolveAlbumPlatform(album, contentPlatform);
  if (!platform) return false;
  return platform === "netease" ? !!album.id : !!album.platformId;
};

/**
 * 跳转专辑详情
 *
 * QQ 音乐用 mid 定位，酷狗用 album_id 定位；
 * 平台主键缺失且无法定位时不跳转，避免落到错误平台的同名专辑。
 * @param album 专辑条目
 * @param contentPlatform 内容来源平台（歌曲 / 歌单 / 专辑所属平台）
 */
export const jumpToAlbum = (album: MetaData, contentPlatform?: ApiPlatform) => {
  const platform = resolveAlbumPlatform(album, contentPlatform);
  // 平台未知：无从判断专辑主键属于哪个平台，不跳转
  if (!platform) {
    window.$message.warning(ALBUM_JUMP_UNAVAILABLE);
    return;
  }
  // 网易云：按平台数字 id 定位
  if (platform === "netease") {
    if (!album.id) {
      window.$message.warning(ALBUM_JUMP_UNAVAILABLE);
      return;
    }
    router.push({ name: "album", query: { id: album.id } });
    return;
  }
  // 第三方平台：必须带平台主键
  if (!album.platformId) {
    window.$message.warning(ALBUM_JUMP_UNAVAILABLE);
    return;
  }
  router.push({ name: "album", query: { id: album.platformId, platform } });
};
