/**
 * 换源链的优先级分派
 *
 * 同一批换源服务对三个平台的寻址能力并不相同，最优链位因此按「歌曲来自哪个平台」分派，
 * 顺序依据各源对 VIP 曲目的实测取链成功率与耗时：
 * - 酷狗歌曲：长青的酷狗 hash 直查通道已下线，酷狗歌曲与 QQ 歌曲走同一套
 *   「按歌名 + 歌手检索换 id」的关键词路径，两平台链位因此同构：
 *   长青 → 咪咕 → 网易云 → 落雪 → 波点 → 酷我
 *   （长青/咪咕/网易云为主力源前置；落雪上游为公益接口稳定性有限居中；
 *   波点与酷我对 VIP 曲目命中率近零，垫底兜底）；
 * - QQ 歌曲：同上，长青 → 咪咕 → 网易云 → 落雪 → 波点 → 酷我 → 歌曲宝；
 * - 网易云歌曲：星海后端 wy 通道实测可用性最高且为官方字节级原曲，排在首位；
 *   原网易云网关作为兜底，后续由咪咕 / 长青 / 酷我 / 波点依次兜底。
 * - 歌曲宝为社区公益源，各平台均置于链位末位，仅在其余源全部落空时兜底。
 *
 * 链位固定，不随运行期可用性调整：熔断与单源失败只影响「本次是否命中」，不改变链位顺序。
 *
 * 本模块只放纯函数，不依赖任何 store，可被播放链与下载链共同引用；
 * 链位调整必须与 xiaoxiongmusic-capacitor 同步（音源修改双端对齐铁律）。
 */
import { SongUnlockServer, type ApiPlatform } from "../types/shared";

/** 各平台的换源优先级（数组顺序即尝试顺序） */
const UNLOCK_PRIORITY: Record<ApiPlatform, readonly SongUnlockServer[]> = {
  netease: [
    SongUnlockServer.XINGHAI,
    SongUnlockServer.NETEASE,
    SongUnlockServer.MIGU,
    SongUnlockServer.CHANGQING,
    SongUnlockServer.KUWO,
    SongUnlockServer.BODIAN,
    SongUnlockServer.GEQUBAO,
  ],
  qqmusic: [
    SongUnlockServer.CHANGQING,
    SongUnlockServer.MIGU,
    SongUnlockServer.NETEASE,
    SongUnlockServer.LXMUSIC,
    SongUnlockServer.BODIAN,
    SongUnlockServer.KUWO,
    SongUnlockServer.GEQUBAO,
  ],
  kugou: [
    SongUnlockServer.CHANGQING,
    SongUnlockServer.MIGU,
    SongUnlockServer.NETEASE,
    SongUnlockServer.LXMUSIC,
    SongUnlockServer.BODIAN,
    SongUnlockServer.KUWO,
    SongUnlockServer.GEQUBAO,
  ],
};

/** 各平台的中文名（只用于日志与说明文案） */
const PLATFORM_LABEL: Record<ApiPlatform, string> = {
  netease: "网易云",
  qqmusic: "QQ 音乐",
  kugou: "酷狗音乐",
};

/**
 * 取指定平台的换源优先级
 * @param platform 歌曲所属平台
 * @returns 换源优先级（按尝试顺序）
 */
export const getUnlockPriority = (platform: ApiPlatform): SongUnlockServer[] => [
  ...(UNLOCK_PRIORITY[platform] ?? UNLOCK_PRIORITY.netease),
];

/**
 * 取平台的中文名
 * @param platform 歌曲所属平台
 * @returns 平台中文名
 */
export const getPlatformLabel = (platform: ApiPlatform): string =>
  PLATFORM_LABEL[platform] ?? platform;
