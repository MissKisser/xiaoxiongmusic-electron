/**
 * QM 用户基础资料模块
 *
 * 通过 music.UserInfo.userInfoServer / GetLoginUserInfo 获取用户信息
 */

import { getQQMusicCookies, getQQMusicUin, qmRequest } from "../core/request";
import { isQQMusicAuthExpired } from "../core/auth";
import { normalizeQQMusicVip, type QQMusicVipData } from "../core/vip";
import { coreLog } from "../../../logger";
import type { QMModule } from "../core/types";

interface ProfileCreator {
  nick?: string;
  headpic?: string;
}

/**
 * 获取用户信息
 *
 * 鉴权失效必须上抛：只有它代表凭据已死；
 * 网络异常不代表登录态变化，仍按「无资料」处理，避免误登出。
 */
const fetchCgiProfile = async (): Promise<ProfileCreator | null> => {
  try {
    const data = await qmRequest<{
      info?: {
        nick?: string;
        nickname?: string;
        name?: string;
        logo?: string;
      };
    }>("music.UserInfo.userInfoServer", "GetLoginUserInfo", {});
    const info = data?.info;
    if (info && (info.nick || info.nickname || info.name || info.logo)) {
      return {
        nick: info.nick || info.nickname || info.name,
        headpic: info.logo,
      };
    }
  } catch (err) {
    if (isQQMusicAuthExpired(err)) throw err;
    coreLog.warn("[qm-user-detail] GetLoginUserInfo 接口请求失败:", err);
  }
  return null;
};

/** 获取当前账号的会员播放权限 */
const fetchVipStatus = async (): Promise<QQMusicVipData | null> => {
  try {
    return await qmRequest<QQMusicVipData>("VipLogin.VipLoginInter", "vip_login_base", {});
  } catch (err) {
    coreLog.warn("[qm-user-detail] vip_login_base 接口请求失败:", err);
    return null;
  }
};

const userDetail: QMModule = async () => {
  const uin = getQQMusicUin();
  const cookies = getQQMusicCookies();

  const hasKey = !!(
    cookies.qm_keyst ||
    cookies.qqmusic_key ||
    cookies.pskey ||
    cookies.p_skey ||
    cookies.skey
  );

  if (!uin || uin === "0" || !hasKey) {
    return {
      code: 301,
      loggedIn: false,
      message: "未登录 QM 账号",
    };
  }

  let creator: ProfileCreator | null = null;
  let vipData: QQMusicVipData | null = null;
  try {
    [creator, vipData] = await Promise.all([fetchCgiProfile(), fetchVipStatus()]);
  } catch (err) {
    // 鉴权失效：凭据已死且续期失败，明确回报未登录，由界面提示重新登录
    if (isQQMusicAuthExpired(err)) {
      coreLog.warn("[qm-user-detail] 凭据已失效:", err);
      return {
        code: 401,
        loggedIn: false,
        message: "QQ 音乐登录已过期，请重新登录",
      };
    }
    throw err;
  }

  const avatarUrl = creator?.headpic?.replace(/^http:\/\//, "https://");
  const vip = normalizeQQMusicVip(vipData);
  return {
    code: 200,
    loggedIn: true,
    profile: {
      userId: uin,
      nickname: creator?.nick || "",
      avatarUrl: avatarUrl || "",
      isVip: vip.isVip,
      vipLevel: vip.vipLevel,
    },
  };
};

export default userDetail;
