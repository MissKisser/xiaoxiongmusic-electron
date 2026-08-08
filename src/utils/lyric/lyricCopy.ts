/**
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 *
 * Source: splayer-next-upstream @ 4b429a2 (feat: 新增复制歌词)
 *         src/components/modals/CopyLyricsDialog.vue (handleCopyRaw / handleCopy 思路)
 */

import type { LyricLine } from "@applemusic-like-lyrics/lyric";

/**
 * 过滤背景人声（BG）与空白行
 * @param lines 歌词行
 */
const filterValidLyric = (lines: LyricLine[]): LyricLine[] => {
  return lines.filter((line) => !line.isBG);
};

/**
 * 拼接单行歌词文本（逐字 + 普通）
 * @param line 单行歌词
 */
const joinLyricLineText = (line: LyricLine): string => {
  if (!line.words || line.words.length === 0) return "";
  return line.words.map((w) => w?.word ?? "").join("");
};

/**
 * 拼接单行歌词音译文本（整行 romanLyric 优先，缺失时退化为逐字 romanWord）
 * @param line 单行歌词
 */
const joinLyricLineRomaji = (line: LyricLine): string => {
  if (line.romanLyric) return line.romanLyric;
  if (!line.words || line.words.length === 0) return "";
  return line.words.map((w) => w?.romanWord ?? "").join("");
};

/**
 * 将歌词行数组转换为「原文」纯文本
 *
 * 规则：
 * - 过滤 BG 行
 * - 每行按 words 拼接为单行
 * - 跳过空行
 * - 行间使用换行符拼接
 *
 * @param lines 歌词行（lrcData 或 yrcData）
 * @returns 原文文本
 */
export const lyricLinesToRawText = (lines: LyricLine[] | undefined | null): string => {
  if (!lines || lines.length === 0) return "";
  return filterValidLyric(lines)
    .map(joinLyricLineText)
    .filter((text) => text.length > 0)
    .join("\n");
};

/**
 * 将歌词行数组转换为「原文 + 翻译 + 音译」文本
 *
 * 规则（对齐 SPlayer-Next CopyLyricsDialog.handleCopy）：
 * - 过滤 BG 行
 * - 每行输出三段：原文 / 翻译（translatedLyric）/ 音译（romanLyric 或逐字 romanWord）
 * - 三段各占一行，空段落自动跳过
 * - 跳过全空行
 * - 行间使用换行符拼接
 *
 * @param lines 歌词行（lrcData 或 yrcData）
 * @returns 原文+翻译+音译文本
 */
export const lyricLinesToTranslatedText = (
  lines: LyricLine[] | undefined | null,
): string => {
  if (!lines || lines.length === 0) return "";
  return filterValidLyric(lines)
    .map((line) => {
      const parts = [joinLyricLineText(line)];
      if (line.translatedLyric) parts.push(line.translatedLyric);
      const romaji = joinLyricLineRomaji(line);
      if (romaji) parts.push(romaji);
      return parts.filter(Boolean).join("\n");
    })
    .filter((text) => text.length > 0)
    .join("\n");
};
