import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type { WebDavPlaylistInput } from "@shared";

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    // Expose store API via preload
    contextBridge.exposeInMainWorld("api", {
      store: {
        get: (key: string) => ipcRenderer.invoke("store-get", key),
        set: (key: string, value: unknown) => ipcRenderer.invoke("store-set", key, value),
        has: (key: string) => ipcRenderer.invoke("store-has", key),
        delete: (key: string) => ipcRenderer.invoke("store-delete", key),
        reset: (keys?: string[]) => ipcRenderer.invoke("store-reset", keys),
        export: (data: any) => ipcRenderer.invoke("store-export", data),
        import: () => ipcRenderer.invoke("store-import"),
      },
      // Renderer logging API
      log: {
        info: (message: string, ...args: unknown[]) =>
          ipcRenderer.send("renderer-log", "info", message, args),
        warn: (message: string, ...args: unknown[]) =>
          ipcRenderer.send("renderer-log", "warn", message, args),
        error: (message: string, ...args: unknown[]) =>
          ipcRenderer.send("renderer-log", "error", message, args),
        debug: (message: string, ...args: unknown[]) =>
          ipcRenderer.send("renderer-log", "debug", message, args),
      },
// Based on SPlayer-Next
      // Environment info API
      system: {
        getEnvironmentInfo: () => ipcRenderer.invoke("get-environment-info"),
        getInstallType: () => ipcRenderer.invoke("get-install-type"),
      },
      // Remote playlist API (WebDAV remote media)
      remotePlaylist: {
        save: (input: {
          playlistId: string;
          name: string;
          webdav: WebDavPlaylistInput;
        }) => ipcRenderer.invoke("remote-playlist:save", input),
        remove: (playlistId: string) => ipcRenderer.invoke("remote-playlist:remove", playlistId),
        clear: () => ipcRenderer.invoke("remote-playlist:clear"),
      },
      // 第三方音源平台（QQ 音乐 / 酷狗）——与网易云 ncm-api 体系完全隔离
      platformMusic: {
        call: (platform: string, name: string, params?: Record<string, unknown>) =>
          ipcRenderer.invoke("platformMusic:call", platform, name, params ?? {}),
        clearSession: (platform: string) => ipcRenderer.invoke("platformMusic:clearSession", platform),
        listModules: (platform: string) => ipcRenderer.invoke("platformMusic:listModules", platform),
      },
    });
  } catch (error) {
    console.error(error);
  }
}
