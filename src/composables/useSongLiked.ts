/**
 * 歌曲红心状态判定与切换
 *
 * 红心判据按平台分流：
 * - 网易云：沿用既有本地缓存（`dataStore.userLikeData.songs`），
 *   且仅在当前平台为网易云时参与判据；
 * - QQ 音乐 / 酷狗：按「我喜欢的音乐」歌单的曲目集合判定。
 *   该集合由平台 store 在平台可用时全局装载，因此搜索结果、排行榜、
 *   刷歌页、歌单详情等任意页面都能判定红心状态。
 *
 * 判据真源在 `@/utils/songLiked`，所有红心入口共用同一结论，
 * 避免某一入口漏带平台维度造成跨平台串显。
 */
import type { SongType } from "@/types/main";
import { usePlatformStore } from "@/stores";
import { isSongLiked, likeSong } from "@/api/platform/manage";
import { toLikeSong } from "@/utils/auth";
import { isSongLikedInScope } from "@/utils/songLiked";
import { resolveSongPlatform } from "@/utils/songPlatform";

/**
 * 提供歌曲红心状态判定与切换
 */
export const useSongLiked = () => {
  const platformStore = usePlatformStore();

  /**
   * 判断歌曲是否已喜欢
   * @param song 歌曲
   * @returns 是否已喜欢
   */
  const isSongLikedNow = (song: SongType): boolean => isSongLikedInScope(song);

  /**
   * 切换歌曲的喜欢状态
   *
   * 第三方平台走平台「我喜欢的音乐」写操作（写入后读回确认）；
   * 网易云走既有喜欢链路。
   * @param song 歌曲
   */
  const toggleSongLiked = async (song: SongType): Promise<void> => {
    const platform = resolveSongPlatform(song);
    if (platform !== "netease") {
      const liked = !isSongLiked(platform, song);
      const result = await likeSong(platform, song, liked);
      if (!result.ok) {
        window.$message.error(result.message || "操作失败，请重试");
        return;
      }
      window.$message.success(liked ? "已添加到我喜欢的音乐" : "已取消喜欢");
      return;
    }
    await toLikeSong(song, !isSongLikedInScope(song));
  };

  return { isSongLikedNow, toggleSongLiked, platformStore };
};
