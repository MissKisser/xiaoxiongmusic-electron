/**
 * 远程歌单 IPC
 *
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 */

import { ipcMain } from "electron";
import type { WebDavPlaylistInput } from "@shared";
import {
  addWebDavPlaylistConfig,
  clearRemoteMediaConfig,
  removeWebDavPlaylistConfig,
} from "../services/remoteMedia/config";

/** 保存远程歌单配置的入参 */
export interface SaveRemotePlaylistInput {
  /** 歌单 ID */
  playlistId: string;
  /** 歌单名称 */
  name: string;
  /** WebDAV 配置 */
  webdav: WebDavPlaylistInput;
}

/**
 * 注册远程歌单 IPC
 * - remote-playlist:save 保存 WebDAV 配置（主进程校验并加密存储）
 * - remote-playlist:remove 删除远程歌单配置
 * - remote-playlist:clear 清空全部远程歌单配置
 * @returns void
 */
const initRemotePlaylistIpc = (): void => {
  ipcMain.handle("remote-playlist:save", (_event, input: SaveRemotePlaylistInput) => {
    if (!input?.playlistId || !input?.webdav) {
      throw new Error("远程歌单配置不完整");
    }
    addWebDavPlaylistConfig(input.playlistId, input.webdav);
    return true;
  });
  ipcMain.handle("remote-playlist:remove", (_event, playlistId: string) => {
    removeWebDavPlaylistConfig(playlistId);
    return true;
  });
  ipcMain.handle("remote-playlist:clear", () => {
    clearRemoteMediaConfig();
    return true;
  });
};

export default initRemotePlaylistIpc;
