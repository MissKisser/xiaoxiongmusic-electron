<template>
  <div class="player-menu">
    <Transition name="fade" mode="out-in">
      <div v-show="statusStore.playerMetaShow" class="menu-content">
        <n-flex class="left">
          <!-- 复制歌词原文 -->
          <div
            v-if="
              settingStore.fullscreenPlayerElements.copyLyric &&
              musicStore.isHasLrc &&
              musicStore.playSong.type !== 'radio'
            "
            class="menu-icon"
            title="复制歌词原文"
            @click.stop="handleCopyLyric"
          >
            <SvgIcon name="Copy" />
          </div>
          <!-- 复制歌词含翻译 -->
          <div
            v-if="
              settingStore.fullscreenPlayerElements.copyLyric &&
              musicStore.isHasLrc &&
              musicStore.playSong.type !== 'radio'
            "
            class="menu-icon"
            title="复制歌词含翻译"
            @click.stop="handleCopyTranslatedLyric"
          >
            <SvgIcon name="Lyrics" />
          </div>
          <!-- 导出歌词图片 -->
          <div
            v-if="
              settingStore.fullscreenPlayerElements.copyLyric &&
              musicStore.isHasLrc &&
              musicStore.playSong.type !== 'radio'
            "
            class="menu-icon"
            title="导出歌词图片"
            @click.stop="handleExportLyricPoster"
          >
            <SvgIcon name="Download" />
          </div>
          <div
            v-if="musicStore.isHasLrc && musicStore.playSong.type !== 'radio'"
            :class="['menu-icon', { open: statusStore.pureLyricMode }]"
            @click="statusStore.pureLyricMode = !statusStore.pureLyricMode"
          >
            <SvgIcon name="TextPlay" />
          </div>
        </n-flex>
        <div class="drag-dom" />
        <n-flex class="right" justify="end">
          <div class="menu-icon" @click="toggleFullscreen">
            <SvgIcon :name="isFullscreen ? 'FullscreenExit' : 'Fullscreen'" />
          </div>
          <div v-if="!isFullscreen" class="menu-icon" @click="statusStore.showFullPlayer = false">
            <SvgIcon name="Down" />
          </div>
        </n-flex>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
// Based on SPlayer-Next — 导出歌词图片 + 复制歌词按钮
import { useStatusStore, useMusicStore, useSettingStore } from "@/stores";
import { createLyricPoster, type LyricPosterLine } from "@/utils/lyric/poster";
import { useCopyText } from "@/composables/useCopyText";
import { lyricLinesToRawText, lyricLinesToTranslatedText } from "@/utils/lyric/lyricCopy";
import type { LyricLine } from "@applemusic-like-lyrics/lyric";

const musicStore = useMusicStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();

const { copy } = useCopyText();
/** 当前使用的歌词数据（优先逐字） */
const activeLyricData = computed(() => {
  const isYrc = musicStore.songLyric.yrcData?.length && settingStore.showYrc;
  return isYrc ? musicStore.songLyric.yrcData : musicStore.songLyric.lrcData;
});

/** 歌词行转海报行 // Based on SPlayer-Next — CopyLyricsDialog displayLyrics */
const toPosterLines = (data: LyricLine[]): LyricPosterLine[] =>
  data
    .filter((line) => !line.isBG)
    .map((line) => ({
      text: line.words.map((word) => word.word).join(""),
      translation: line.translatedLyric || undefined,
      romaji: line.romanLyric || undefined,
      duet: line.isDuet,
    }));

/** 导出中，防重复点击 */
const exporting = ref(false);

/** 导出歌词图片 // Based on SPlayer-Next — CopyLyricsDialog handleExport */
const handleExportLyricPoster = async (): Promise<void> => {
  const track = musicStore.playSong;
  if (exporting.value || !musicStore.isHasLrc || track.type === "radio") return;
  exporting.value = true;
  try {
    const coverColor = statusStore.songCoverTheme?.main;
    const fallbackColor = coverColor
      ? `#${[coverColor.r, coverColor.g, coverColor.b]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("")}`
      : undefined;
    const blob = await createLyricPoster({
      track,
      lines: toPosterLines(activeLyricData.value),
      fallbackColor,
    });
    const artist = Array.isArray(track.artists)
      ? track.artists.map((item) => item.name).join(", ")
      : track.artists || "";
    const fileName = `${track.name} - ${artist} - 歌词海报.png`.replace(/[\\/:*?"<>|]/g, " ");
    const res = await window.electron.ipcRenderer.invoke(
      "save-lyric-poster",
      Array.from(new Uint8Array(await blob.arrayBuffer())),
      fileName,
    );
    if (res?.success && res.path) window.$message?.success?.("歌词图片已保存");
    else if (!res?.success && res.message !== "cancelled")
      window.$message?.error?.("导出歌词图片失败");
  } catch {
    window.$message?.error?.("导出歌词图片失败");
  } finally {
    exporting.value = false;
  }
};

/** 复制歌词原文（不包含翻译 / 音译） */
const handleCopyLyric = async () => {
  // Based on SPlayer-Next — handleCopyRaw
  const content = lyricLinesToRawText(activeLyricData.value);
  if (!content) {
    window.$message?.warning?.("暂无可复制的歌词");
    return;
  }
  await copy(content, "歌词已复制到剪贴板");
};

/** 复制歌词含翻译 / 音译 */
const handleCopyTranslatedLyric = async () => {
  // Based on SPlayer-Next — handleCopy
  const content = lyricLinesToTranslatedText(activeLyricData.value);
  if (!content) {
    window.$message?.warning?.("暂无可复制的歌词");
    return;
  }
  await copy(content, "歌词（含翻译）已复制到剪贴板");
};
};

// Fullscreen
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();
</script>

<style lang="scss" scoped>
.player-menu {
  position: absolute;
  top: 0;
  width: 100%;
  min-height: 80px;
  overflow: hidden;
  z-index: 100;
  cursor: pointer;
  .menu-content {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    height: 100%;
  }
  .drag-dom {
    height: 80px;
    margin: 0 100px;
    flex: 1;
    -webkit-app-region: drag;
  }
  .left,
  .right {
    padding: 0 20px;
    transition: opacity 0.3s;
    .menu-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 8px;
      transition:
        opacity 0.3s,
        background-color 0.3s,
        transform 0.3s;
      cursor: pointer;
      .n-icon {
        font-size: 28px;
        color: rgb(var(--main-cover-color));
      }
      &:hover {
        transform: scale(1.05);
        background-color: rgba(var(--main-cover-color), 0.14);
        opacity: 1;
      }
      &:active {
        transform: scale(1);
      }
    }
  }
  .left {
    .menu-icon {
      opacity: 0.6;
      &.open {
        opacity: 1;
        &:hover {
          opacity: 1;
        }
      }
      &:hover {
        opacity: 0.6;
      }
    }
  }
}
</style>
