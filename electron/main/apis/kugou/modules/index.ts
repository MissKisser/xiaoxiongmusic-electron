/**
 * KG 模块注册表（3.x 精简版）
 *
 * 只注册平台登录与歌单读取所需模块；搜索、歌词、播放地址解析等不移植。
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
};
