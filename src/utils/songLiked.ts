/**
 * 歌曲红心状态的平台维度判定
 *
 * 红心判据按平台分流：
 * - QQ 音乐 / 酷狗：取该平台「我喜欢的音乐」歌单的曲目集合（按平台分桶）；
 * - 网易云：取网易云本地红心缓存，且**仅在当前平台为网易云时**参与判据——
 *   网易云的收藏属于网易云平台，在其它平台的界面上不得参与判据。
 *
 * 本模块是红心判据的唯一真源：歌曲行、播放条、全屏播放器、右键菜单与
 * 原生「喜欢」按钮都从这里取结论，避免某一入口漏带平台维度造成串显。
 */
import type { SongType } from "@/types/main";
import { useDataStore } from "@/stores/data";
import { usePlatformStore } from "@/stores/platform";
import { resolveSongPlatform } from "@/utils/songPlatform";

/**
 * 判断歌曲在当前平台下是否已红心
 *
 * @param song 歌曲
 * @returns 是否已红心
 */
export const isSongLikedInScope = (song?: SongType | null): boolean => {
  if (!song) return false;
  const platform = resolveSongPlatform(song);
  // 第三方平台：按该平台的红心集合判定
  if (platform !== "netease") {
    return usePlatformStore().isLikedSong(platform, Number(song.id));
  }
  // 网易云红心缓存只在网易云平台下参与判据
  if (usePlatformStore().currentPlatform !== "netease") return false;
  return useDataStore().isLikeSong(Number(song.id));
};
