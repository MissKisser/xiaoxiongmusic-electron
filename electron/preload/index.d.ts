import { ElectronAPI } from "@electron-toolkit/preload";
import type { WebDavPlaylistInput } from "@shared";
import type { StoreType } from "../main/store";
import type { EnvironmentInfo } from "../../src/types/shared";

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      store: {
        get<K extends keyof StoreType>(key: K): Promise<StoreType[K]>;
        set<K extends keyof StoreType>(key: K, value: StoreType[K]): Promise<boolean>;
        has(key: keyof StoreType): Promise<boolean>;
        delete(key: keyof StoreType): Promise<boolean>;
        reset(keys?: (keyof StoreType)[]): Promise<boolean>;
        export(data: any): Promise<{ success: boolean; path?: string; error?: string }>;
        import(): Promise<{ success: boolean; data?: any; error?: string }>;
      };
// Based on SPlayer-Next
      system: {
        /** 获取环境信息（应用版本、Electron/Chrome/Node 版本、磁盘占用、缓存大小等） */
        getEnvironmentInfo: () => Promise<EnvironmentInfo>;
      };
      // 远程歌单（WebDAV）
      remotePlaylist: {
        save(input: {
          playlistId: string;
          name: string;
          webdav: WebDavPlaylistInput;
        }): Promise<boolean>;
        remove(playlistId: string) => Promise<boolean>;
        clear(): Promise<boolean>;
      };
    };
    // logs
    logger: {
      info: (message: string, ...args: unknown[]) => void;
      warn: (message: string, ...args: unknown[]) => void;
      error: (message: string, ...args: unknown[]) => void;
      debug: (message: string, ...args: unknown[]) => void;
    };
  }
}
