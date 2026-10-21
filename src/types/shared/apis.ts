/**
 * 第三方音源平台统一类型
 *
 * 与网易云（ncm-api 体系）完全独立，仅描述 QQ 音乐 / 酷狗等平台。
 */

/** 支持的音源平台 */
export type ApiPlatform = "netease" | "qqmusic" | "kugou";

/** 通用响应包装 */
export type ApiCallResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

/** 平台账号资料 */
export interface PlatformProfile {
  /** 平台内用户 ID */
  userId: string;
  /** 昵称 */
  nickname: string;
  /** 头像地址 */
  avatarUrl: string;
  /** 是否为会员 */
  isVip: boolean;
  /** 会员等级 */
  vipLevel: number;
}

/** 第三方音源平台 IPC 桥 */
export interface PlatformMusicApi {
  /**
   * 调用平台接口
   * @param platform 音源平台
   * @param name 接口名
   * @param params 接口参数
   */
  call: (
    platform: ApiPlatform,
    name: string,
    params?: Record<string, unknown>,
  ) => Promise<ApiCallResponse>;
  /**
   * 清空指定平台的登录态
   * @param platform 音源平台
   */
  clearSession: (platform: ApiPlatform) => Promise<void>;
  /**
   * 列出指定平台可用的模块名
   * @param platform 音源平台
   */
  listModules: (platform: ApiPlatform) => Promise<{ ok: boolean; modules: string[] }>;
}
