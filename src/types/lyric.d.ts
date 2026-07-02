import { type LyricLine } from "@applemusic-like-lyrics/lyric";

export type LyricPriority = "auto" | "qm" | "ttml";

/**
 * 歌词数据类型
 */
export interface SongLyric {
  lrcData: LyricLine[];
  yrcData: LyricLine[];
}
