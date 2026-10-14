import { DialogApi, LoadingBarApi, MessageApi, ModalApi, NotificationApi } from "naive-ui";
import type { EnvironmentInfo, WebDavPlaylistInput } from "./shared";

declare global {
  interface Window {
    // naiveui
    $message: MessageApi;
    $dialog: DialogApi;
    $notification: NotificationApi;
    $loadingBar: LoadingBarApi;
    $modal: ModalApi;
    // electron
    api: {
      store: {
        get: (key: string) => Promise<any>;
        set: (key: string, value: unknown) => Promise<boolean>;
        has: (key: string) => Promise<boolean>;
        delete: (key: string) => Promise<boolean>;
        reset: (keys?: string[]) => Promise<boolean>;
        export: (data: any) => Promise<boolean>;
        import: () => Promise<any>;
      };
      // Based on SPlayer-Next
      system: {
        getEnvironmentInfo: () => Promise<EnvironmentInfo>;
        /** 获取当前安装类型：setup 安装版 / portable 便携版 */
        getInstallType: () => Promise<"setup" | "portable">;
      };
      // 远程歌单（WebDAV）
      remotePlaylist: {
        save(input: {
          playlistId: string;
          name: string;
          webdav: WebDavPlaylistInput;
        }): Promise<boolean>;
        remove(playlistId: string): Promise<boolean>;
        clear(): Promise<boolean>;
      };
    };
  }
}
