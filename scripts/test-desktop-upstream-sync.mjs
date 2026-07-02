import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), "utf8");

const assertIncludes = (source, needle, message) => {
  assert.ok(source.includes(needle), message);
};

const assertMatches = (source, pattern, message) => {
  assert.match(source, pattern, message);
};

const playerController = read("src/core/player/PlayerController.ts");
assertIncludes(
  playerController,
  "const startSeek = seek;",
  "playSong should preserve a stable start seek for lyric loading resets",
);
assertIncludes(
  playerController,
  "currentTime: startSeek",
  "desktop lyric loading payload should include the new song start time",
);
assertIncludes(
  playerController,
  "songId: sid",
  "desktop lyric loading payload should include the new song id",
);
assertIncludes(
  playerController,
  "songOffset: statusStore.getSongOffset(sid)",
  "desktop lyric loading payload should include the new song offset",
);
assertMatches(
  playerController,
  /lrcData:\s*\[\][\s\S]*yrcData:\s*\[\][\s\S]*lyricIndex:\s*-1/,
  "desktop lyric loading payload should clear stale lyric arrays and reset lyric index",
);

const desktopLyric = read("src/views/DesktopLyric/index.vue");
assertIncludes(
  desktopLyric,
  "const hasLyricLines =",
  "desktop lyric view should know whether a payload contains lyric lines",
);
assertIncludes(
  desktopLyric,
  "const shouldIgnoreLoadingUpdate =",
  "desktop lyric view should ignore stale loading-only updates",
);
assertIncludes(
  desktopLyric,
  "if (shouldIgnoreLoadingUpdate(data))",
  "desktop lyric IPC handler should guard stale loading-only updates before assigning data",
);
assertIncludes(
  desktopLyric,
  "if (lyricData.lyricLoading && !lyrics?.length)",
  "desktop lyric view should only show loading placeholder when no lyric lines are present",
);

const initIpc = read("src/utils/initIpc.ts");
const desktopRequestSection = initIpc
  .split('window.electron.ipcRenderer.on("request-desktop-lyric-data"')[1]
  ?.split("// 无更新")[0];
assert.ok(desktopRequestSection, "request-desktop-lyric-data handler should exist");
assertIncludes(
  desktopRequestSection,
  "const songLyric = statusStore.lyricLoading",
  "desktop lyric data request should avoid returning stale lyric data while loading",
);
assertIncludes(
  desktopRequestSection,
  "lrcData: songLyric.lrcData ?? []",
  "desktop lyric data request should use sanitized lrcData",
);
assertIncludes(
  desktopRequestSection,
  "yrcData: songLyric.yrcData ?? []",
  "desktop lyric data request should use sanitized yrcData",
);

for (const prefix of ["electron/server/netease", "server/netease"]) {
  assert.ok(
    existsSync(join(root, prefix, "ncm-api.d.ts")),
    `${prefix}/ncm-api.d.ts should declare private NCM API modules`,
  );
  const config = read(`${prefix}/ncm-config.ts`);
  assertIncludes(
    config,
    "generateConfig",
    `${prefix}/ncm-config.ts should call generateConfig for xeapi config`,
  );
  assertIncludes(
    config,
    "export const NON_API_EXPORTS",
    `${prefix}/ncm-config.ts should export NON_API_EXPORTS`,
  );
  assertIncludes(
    config,
    "export const ensureNcmConfig",
    `${prefix}/ncm-config.ts should export ensureNcmConfig`,
  );

  const index = read(`${prefix}/index.ts`);
  assertMatches(
    index,
    /import\s+\{\s*ensureNcmConfig,\s*NON_API_EXPORTS\s*\}/,
    `${prefix}/index.ts should import NCM config helpers`,
  );
  assertIncludes(
    index,
    "void ensureNcmConfig();",
    `${prefix}/index.ts should preheat NCM config without blocking server startup`,
  );
  assertIncludes(
    index,
    "NON_API_EXPORTS.has(key)",
    `${prefix}/index.ts should skip service exports in dynamic API lookup`,
  );
  assertIncludes(
    index,
    "await ensureNcmConfig();",
    `${prefix}/index.ts should wait for NCM config before invoking an API route`,
  );
}

console.log("desktop upstream sync checks passed");
