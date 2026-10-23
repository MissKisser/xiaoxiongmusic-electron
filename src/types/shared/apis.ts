/**
 * 共享的音源契约类型
 *
 * 本模块只描述主进程与渲染进程共用的数据契约，不依赖任何其他模块，
 * 因此可作为叶子模块被任意模块安全引用。
 */

/** 支持的音源平台 */
export type ApiPlatform = "netease" | "qqmusic" | "kugou";

/**
 * 歌曲解锁服务器
 *
 * 标识获取歌曲播放地址时可用的站外解锁源，决定解锁链的尝试顺序与各源的超时预算。
 */
export enum SongUnlockServer {
  /** 网易云音乐（按歌曲 ID 寻址） */
  NETEASE = "netease",
  /** 波点音乐 */
  BODIAN = "bodian",
  /** 酷我音乐 */
  KUWO = "kuwo",
  /** 歌曲宝 */
  GEQUBAO = "gequbao",
  /** 咪咕音乐 */
  MIGU = "migu",
  /** 长青聚合 */
  CHANGQING = "changqing",
}

/** 通用响应包装 */
export type ApiCallResponse = { ok: true; data?: unknown } | { ok: false; error: string };

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
