/**
 * 换源链的优先级分派
 *
 * 同一批换源服务对三个平台的寻址能力并不相同，最优链位因此按「歌曲来自哪个平台」分派：
 * - 酷狗歌曲：长青的酷狗 hash 直查通道已下线，酷狗歌曲与 QQ 歌曲走同一套
 *   「按歌名 + 歌手检索换 id」的关键词路径，两平台链位因此同构：
 *   波点 → 长青 → 咪咕 → 落雪 → 酷我 → 网易云；
 * - QQ 歌曲：同上，波点 → 长青 → 咪咕 → 落雪 → 酷我 → 网易云；
 * - 网易云歌曲：网易云按自身歌曲 id 直查，排在首位；咪咕 / 波点 / 酷我按关键词检索；长青垫底。
 *
 * 落雪音源只提供 QQ 曲库，排在咪咕之后、酷我之前作第三兜底：
 * 它与咪咕（咪咕库）、长青（聚合站）异源，插在现有源之后不打乱既有相对顺序。
 *
 * 链位固定，不随运行期可用性调整：熔断与单源失败只影响「本次是否命中」，不改变链位顺序。
 *
 * 本模块只放纯函数，不依赖任何 store，可被播放链与下载链共同引用。
 */
import { SongUnlockServer, type ApiPlatform } from "@/types/shared";

/** 各平台的换源优先级（数组顺序即尝试顺序） */
const UNLOCK_PRIORITY: Record<ApiPlatform, readonly SongUnlockServer[]> = {
  netease: [
    SongUnlockServer.NETEASE,
    SongUnlockServer.MIGU,
    SongUnlockServer.BODIAN,
    SongUnlockServer.KUWO,
    SongUnlockServer.CHANGQING,
  ],
  qqmusic: [
    SongUnlockServer.BODIAN,
    SongUnlockServer.CHANGQING,
    SongUnlockServer.MIGU,
    SongUnlockServer.LXMUSIC,
    SongUnlockServer.KUWO,
    SongUnlockServer.NETEASE,
  ],
  kugou: [
    SongUnlockServer.BODIAN,
    SongUnlockServer.CHANGQING,
    SongUnlockServer.MIGU,
    SongUnlockServer.LXMUSIC,
    SongUnlockServer.KUWO,
    SongUnlockServer.NETEASE,
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
