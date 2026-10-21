export type SongUrlResult = {
  code: number;
  url: string | null;
  /**
   * 直链体积校验是否已完成
   *
   * 为 false 时表示体积探测失败或缺少可比对的时长，直链未经体积校验。
   */
  lengthVerified?: boolean;
};
