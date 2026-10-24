import type { KGModule } from "../core/types";
import { getSessionCookies, saveSessionCookies } from "../../../database/PlatformSessionDB";
import { kgGatewayRequest } from "../core/request";
import { rsaEncryptKugou } from "../core/crypto";
import { isKugouAuthExpired } from "../core/auth";
import { clearCache } from "../core/cache";

interface UserDetailData {
  userid?: number | string;
  nickname?: string;
  username?: string;
  user_name?: string;
  pic?: string;
  userpic?: string;
  user_pic?: string;
  avatar?: string;
  vip_type?: number;
}

/**
 * 清空登录态
 *
 * 保留设备标识（guid / dfid），只丢弃账号凭据：
 * 设备标识与账号无关，保留后重新登录不必重新初始化设备。
 * @param session 当前会话字段
 */
const clearLoginSession = (session: Record<string, string>): void => {
  const device = {
    ...(session.guid ? { guid: session.guid } : {}),
    ...(session.dfid ? { dfid: session.dfid } : {}),
  };
  saveSessionCookies("kugou", device);
  // 登出后旧账号的缓存条目作废，避免重新登录后读到上一个账号的数据
  clearCache();
};

const userDetail: KGModule = async () => {
  const session = getSessionCookies("kugou");
  if (!session.token || !session.userid) return { code: 200, loggedIn: false };
  const clienttime = Math.floor(Date.now() / 1000);
  let response: { data?: UserDetailData };
  try {
    response = await kgGatewayRequest<{ data?: UserDetailData }>("/v3/get_my_info", {
      method: "POST",
      data: {
        visit_time: clienttime,
        usertype: 1,
        p: rsaEncryptKugou({ token: session.token, clienttime }).toUpperCase(),
        userid: Number(session.userid),
      },
      params: { plat: 1 },
      headers: { "x-router": "usercenter.kugou.com" },
    });
  } catch (err) {
    // 登录态失效：清掉登录凭据并明确回报未登录，界面据此提示重新登录
    if (isKugouAuthExpired(err)) {
      clearLoginSession(session);
      return { code: 401, loggedIn: false, message: "酷狗音乐登录已过期，请重新登录" };
    }
    throw err;
  }
  const data = response.data ?? {};
  const nickname = data.nickname ?? data.username ?? data.user_name ?? session.nickname;
  const avatar = data.pic ?? data.userpic ?? data.user_pic ?? data.avatar ?? session.avatar;
  // vip_type 只反映标准版会员；概念版（含签到领取的会员）查 union_vip
  let isVip = Number(data.vip_type ?? 0) > 0;
  if (!isVip) {
    const unionResp = await kgGatewayRequest<{
      data?: { busi_vip?: Array<{ is_vip?: number }> };
    }>("/v1/get_union_vip", {
      baseURL: "https://kugouvip.kugou.com",
      params: { busi_type: "concept" },
    }).catch(() => null);
    isVip = unionResp?.data?.busi_vip?.[0]?.is_vip === 1;
  }
  const nextSession: Record<string, string> = {
    ...session,
    ...(nickname ? { nickname: String(nickname) } : {}),
    ...(avatar ? { avatar: String(avatar).replace(/^http:\/\//, "https://") } : {}),
    ...(data.vip_type !== undefined ? { vip_type: String(data.vip_type) } : {}),
  };
  saveSessionCookies("kugou", nextSession);
  return {
    code: 200,
    loggedIn: true,
    profile: {
      userId: session.userid,
      nickname: nextSession.nickname || `KG ${session.userid}`,
      avatarUrl: nextSession.avatar || "",
      isVip,
      vipLevel: Number(nextSession.vip_type || 0),
    },
  };
};

export default userDetail;
