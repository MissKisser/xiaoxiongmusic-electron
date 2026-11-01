import { SongUnlockServer } from "../types/shared";

/**
 * 单个音源尝试结果
 */
export type UnlockAttempt<T> =
  | { ok: true; server: SongUnlockServer; durationMs: number; value: T }
  | { ok: false; server: SongUnlockServer; durationMs: number; reason: string };

/**
 * 并行竞速多音源解锁
 *
 * 在同一个事件循环 tick 内按数组顺序发起所有音源的解锁尝试。
 * 任一音源尝试成功时，立即以该胜者结果完成兑现；其余在途请求继续在后台自然完成。
 * 若全部音源均尝试失败，则返回按原传入顺序聚合的所有失败原因。
 *
 * @param servers 待竞速的音源列表
 * @param attempt 单音源解锁执行函数
 * @returns 胜者或全部失败记录
 */
export const raceUnlockSources = <T>(
  servers: readonly SongUnlockServer[],
  attempt: (server: SongUnlockServer) => Promise<UnlockAttempt<T>>,
): Promise<{
  winner?: { server: SongUnlockServer; durationMs: number; value: T };
  failures: { server: SongUnlockServer; reason: string }[];
}> => {
  if (servers.length === 0) {
    return Promise.resolve({ failures: [] });
  }

  return new Promise((resolve) => {
    let settled = false;
    let remaining = servers.length;
    const failures: { server: SongUnlockServer; reason: string }[] = new Array(servers.length);

    for (let i = 0; i < servers.length; i++) {
      const server = servers[i];
      let promise: Promise<UnlockAttempt<T>>;
      try {
        promise = Promise.resolve(attempt(server));
      } catch {
        promise = Promise.resolve({
          ok: false,
          server,
          durationMs: 0,
          reason: "请求异常",
        });
      }

      promise
        .catch((): UnlockAttempt<T> => ({
          ok: false,
          server,
          durationMs: 0,
          reason: "请求异常",
        }))
        .then((result) => {
          if (settled) {
            return;
          }

          if (result && result.ok) {
            settled = true;
            resolve({
              winner: {
                server: result.server,
                durationMs: result.durationMs,
                value: result.value,
              },
              failures: [],
            });
            return;
          }

          failures[i] = {
            server,
            reason: (result && !result.ok && result.reason) || "请求异常",
          };
          remaining--;

          if (remaining === 0 && !settled) {
            settled = true;
            resolve({ failures });
          }
        });
    }
  });
};
