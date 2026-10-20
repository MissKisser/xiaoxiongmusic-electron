/**
 * 平台数据层归一化类型
 *
 * QQ 音乐 / 酷狗的原生返回统一归一成网易云字段形状，
 * 页面层只按网易云口径取字段，不必为每个平台各写一套取字段逻辑。
 *
 * 字段对照（平台原生 → 网易云形状）：
 *
 * | 语义     | 网易云            | QQ 音乐                | 酷狗                |
 * | -------- | ----------------- | ---------------------- | ------------------- |
 * | 歌曲 ID  | `id`（数字）      | `id`（songid，数字）    | `audioId`（数字）   |
 * | 字符串主键 | 无              | `mid`（字符串）         | `hash`（字符串）    |
 * | 歌曲名   | `name`            | `name`                 | `name`              |
 * | 歌手     | `artists[].name`  | `artists[].name`       | `artists[].name`    |
 * | 专辑     | `album.name`      | `album`（名称字符串）  | `album`（名称字符串）|
 * | 专辑封面 | `album.picUrl`    | `cover`（直链拼 album mid） | `cover`（`img` 模板） |
 * | 时长     | `duration`（毫秒） | `duration`（已是毫秒）  | `duration`（已是毫秒）|
 * | 付费标记 | `fee`             | `pay.payalbum` / `pay.payplay` | `pay.payplay` |
 * | 歌单封面 | `coverImgUrl`     | `cover`                | `cover`             |
 * | 歌单曲目数 | `trackCount`    | `songNum`              | `count`             |
 */

import type { ApiPlatform } from "@/types/shared";
import type { CoverSize, SongType } from "@/types/main";

/** 归一化后的歌手（网易云形状） */
export interface PlatformArtist {
  /** 歌手 ID（网易云为数字，第三方平台可能是字符串） */
  id: number | string;
  /** 歌手名 */
  name: string;
  /** 头像地址 */
  picUrl?: string;
  /** 平台内字符串标识（QQ 音乐 mid） */
  mid?: string;
}

/** 归一化后的专辑（网易云形状） */
export interface PlatformAlbum {
  /** 专辑 ID */
  id: number | string;
  /** 专辑名 */
  name: string;
  /** 专辑封面（网易云字段名为 picUrl） */
  picUrl: string;
}

/** 归一化后的歌曲（网易云形状 + 平台扩展字段） */
export interface PlatformSong {
  /** 歌曲数字 ID（与网易云同为数字，便于直接复用 SongType.id） */
  id: number;
  /** 歌曲名 */
  name: string;
  /** 歌手列表 */
  artists: PlatformArtist[];
  /** 专辑 */
  album: PlatformAlbum;
  /** 时长（毫秒） */
  duration: number;
  /** 免费或无版权标记：0 正常 / 1 VIP / 4 购买专辑 / 8 非会员可免费播放低音质 */
  fee: 0 | 1 | 4 | 8;
  /** MV 编号 */
  mv: number | null;
  /** 封面 */
  cover: string;
  /** 封面尺寸 */
  coverSize?: CoverSize;
  /** 发布时间（毫秒） */
  publishTime?: number;
  /** 文件大小（字节） */
  size?: number;
  /** 来源平台 */
  platform: ApiPlatform;
  /** 平台内字符串主键（QQ 音乐 mid / 酷狗 hash） */
  platformId?: string;
}

/** 归一化后的歌单创建者（网易云形状） */
export interface PlatformCreator {
  /** 创建者 ID */
  id: number | string;
  /** 创建者昵称 */
  name: string;
  /** 创建者头像 */
  avatarUrl?: string;
}

/** 归一化后的歌单（网易云 `playlist` 形状） */
export interface PlatformPlaylist {
  /** 歌单 ID */
  id: number | string;
  /** 歌单名 */
  name: string;
  /** 歌单封面（网易云字段名为 coverImgUrl） */
  coverImgUrl: string;
  /** 封面尺寸 */
  coverSize?: CoverSize;
  /** 曲目数 */
  trackCount: number;
  /** 播放量 */
  playCount: number;
  /** 歌单描述 */
  description?: string;
  /** 创建者 */
  creator: PlatformCreator;
  /** 创建时间（毫秒） */
  createTime?: number;
  /** 更新时间（毫秒） */
  updateTime?: number;
  /** 来源平台 */
  platform: ApiPlatform;
  /** 平台内字符串标识（歌单号） */
  platformId?: string;
}

/** 归一化后的歌单详情（网易云 `playlist` + `tracks` 形状） */
export interface PlatformPlaylistDetail extends PlatformPlaylist {
  /** 曲目列表 */
  tracks: PlatformSong[];
  /** 是否还有更多曲目 */
  hasMore: boolean;
}

/** 归一化后的播放地址（网易云 `song/url/v1` 形状 + 判据字段） */
export interface PlatformSongUrl {
  /** 歌曲 ID */
  id: number | string;
  /** 是否有可播地址 */
  available: boolean;
  /** 播放地址 */
  url: string;
  /** 音质档位 */
  level?: string;
  /** 音质中文名 */
  label?: string;
  /** 文件格式 */
  format?: string;
  /** 是否降级取到的地址 */
  isFallback: boolean;
  /** 是否为官方下发的试听片段 */
  isTrial: boolean;
  /** 歌曲付费标记 */
  payPlay?: number;
  /** 失败原因（need_pay / no_authorization / filename_rejected / vkey_error） */
  reason?: string;
  /** 提示文案 */
  message?: string;
}

/** 归一化后的歌词（网易云 `/lyric/new` 形状） */
export interface PlatformLyric {
  /** 普通歌词 */
  lrc: { lyric: string };
  /** 翻译歌词 */
  tlyric: { lyric: string };
  /** 罗马音歌词 */
  romalrc: { lyric: string };
  /** 逐字歌词 */
  yrc: { lyric: string };
}

/** 归一化后的评论条目（网易云 `comment` 形状） */
export interface PlatformComment {
  /** 评论 ID */
  id: number | string;
  /** 评论内容 */
  content: string;
  /** 评论时间（毫秒） */
  time: number;
  /** 点赞数 */
  likedCount: number;
  /** 是否已点赞 */
  liked: boolean;
  /** 评论者 */
  user: {
    /** 用户 ID */
    id: number | string;
    /** 昵称 */
    name: string;
    /** 头像 */
    avatarUrl?: string;
  };
  /** 被回复的评论 */
  beReplied?: {
    /** 回复内容 */
    content: string;
    /** 回复者 */
    user: {
      /** 用户 ID */
      id: number | string;
      /** 昵称 */
      name: string;
      /** 头像 */
      avatarUrl?: string;
    };
  };
}

/** 归一化后的评论分页（网易云 `comment/new` 形状） */
export interface PlatformCommentPage {
  /** 评论列表 */
  comments: PlatformComment[];
  /** 评论总数 */
  total: number;
  /** 是否还有更多 */
  more: boolean;
  /** 游标（下一页传入） */
  cursor?: string;
}

/**
 * 按网易云口径生成封面各尺寸地址
 *
 * 网易云的封面地址以 `.jpg` 结尾时用 `?param=宽x高` 裁剪，
 * 第三方平台 CDN 同样支持该参数；其余地址原样返回。
 * @param url 封面地址
 * @returns 封面尺寸映射
 */
export const buildCoverSize = (url: string): CoverSize => {
  const withParam = (size: number): string =>
    url.endsWith(".jpg") ? `${url}?param=${size}y${size}` : url;
  return {
    s: withParam(100),
    m: withParam(300),
    l: withParam(1024),
    xl: withParam(1920),
  };
};

/**
 * 把归一化歌曲转换为应用内歌曲模型
 *
 * 字段口径与 `src/utils/format.ts` 的 `formatSongsList` 对齐，
 * 额外带上来源平台与平台字符串主键。
 * @param song 归一化歌曲
 * @returns 应用内歌曲模型
 */
export const toSongType = (song: PlatformSong): SongType => ({
  id: song.id,
  name: song.name,
  artists: song.artists.map((artist) => ({
    id: Number(artist.id) || 0,
    name: artist.name,
    cover: artist.picUrl,
  })),
  album: {
    id: Number(song.album.id) || 0,
    name: song.album.name,
    cover: song.album.picUrl,
  },
  cover: song.cover,
  coverSize: song.coverSize,
  duration: song.duration,
  free: song.fee,
  mv: song.mv,
  createTime: song.publishTime,
  size: song.size,
  type: "song",
  platform: song.platform,
  platformId: song.platformId,
});
