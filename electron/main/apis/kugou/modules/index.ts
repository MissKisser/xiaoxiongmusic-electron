/**
 * KG 模块注册表
 *
 * 平台数据面：登录、歌单读写、搜索、歌词、评论、播放地址、专辑、歌手、歌单详情。
 */

import type { KGModule } from "../core/types";

import user_detail from "./user_detail";
import { loginQrCheck, loginQrKey } from "./login_qr";
import { playlist_detail, user_playlist_list, user_profile } from "./user_playlist";
import {
  playlist_create,
  playlist_delete,
  playlist_rename,
  playlist_subscribe,
  playlist_tracks,
} from "./playlist_write";
import { album } from "./album";
import { artist } from "./artist";
import { comment } from "./comment";
import { lyric } from "./lyric";
import { playlist } from "./playlist";
import { search } from "./search";
import { song_url } from "./song_url";

export const modules: Record<string, KGModule> = {
  login_qr_key: loginQrKey,
  login_qr_check: loginQrCheck,
  user_detail,
  user_playlist_list,
  playlist_detail,
  user_profile,
  playlist_create,
  playlist_rename,
  playlist_delete,
  playlist_tracks,
  playlist_subscribe,
  search,
  song_url,
  lyric,
  comment,
  album,
  artist,
  playlist,
};
