export type SongUrlResult = {
  code: number;
  url: string | null;
  /**
   * 失败原因（用户可读）
   *
   * 仅在失败时给出，供上层展示可读文案（如缺少歌手信息时拒绝换源）。
   */
  reason?: string;
  /**
   * 直链体积校验是否已完成
   *
   * 为 false 时表示体积探测失败或缺少可比对的时长，直链未经体积校验。
   */
  lengthVerified?: boolean;
};
