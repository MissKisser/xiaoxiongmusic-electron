/**
 * 三源通用「歌名 + 歌手 + 时长」三重校验与直链可用性校验
 *
 * 酷我 / 波点 / 歌曲宝三个站外源的搜索结果都只是「候选」，
 * 直接取第一条命中会拿到错版本（Remix、伴奏、翻唱、现场版等），
 * 且酷我的 128k 通道还会返回与请求歌曲无关的固定占位文件。
 * 本模块把三处重复的匹配逻辑收敛为一份，供三个源共用。
 */

/** 请求侧的目标歌曲信息 */
export type MatchTarget = {
  /** 请求歌名 */
  title: string;
  /** 请求歌手 */
  artist: string;
  /** 请求时长（秒）；不传则跳过时长校验 */
  duration?: number;
};

/** 候选歌曲的统一结构（各源检索后统一成此结构再送入校验） */
export type MatchCandidate = {
  /** 候选在源内的唯一标识 */
  id: string;
  /** 候选歌名 */
  title: string;
  /** 候选歌手 */
  artist: string;
  /** 候选自带时长（秒） */
  duration?: number;
};

/** 单个候选的校验明细 */
export type CandidateScore = {
  /** 候选本身 */
  candidate: MatchCandidate;
  /** 歌名相似度 0~1 */
  titleScore: number;
  /** 歌手相似度 0~1 */
  artistScore: number;
  /** 时长接近度 0~1；未参与时长校验时为 null */
  durationScore: number | null;
  /** 综合得分 0~1 */
  score: number;
  /** 是否通过三重校验 */
  passed: boolean;
};

/** 歌名相似度下限：低于该值视为不是同一首歌 */
const TITLE_SCORE_LIMIT = 0.75;

/** 歌手相似度下限：低于该值视为不是同一位歌手 */
const ARTIST_SCORE_LIMIT = 0.5;

/** 综合得分权重 */
const TITLE_WEIGHT = 0.45;
const ARTIST_WEIGHT = 0.35;
const DURATION_WEIGHT = 0.2;

/** 版本变体标记：候选歌名命中且请求歌名未命中时，判定为「同一首歌的其他版本」 */
const VERSION_MARKERS = [
  "dj",
  "remix",
  "live",
  "伴奏",
  "instrumental",
  "纯音乐",
  "钢琴",
  "吉他",
  "二胡",
  "古筝",
  "唢呐",
  "爵士",
  "摇滚",
  "女声",
  "男声",
  "女版",
  "男版",
  "cover",
  "翻唱",
  "消音",
  "现场",
  "演唱会",
  "slowed",
  "sped",
  "变速",
  "慢速",
  "extended",
  "radioedit",
  "remaster",
  "demo",
  "试听",
  "片段",
  "完整版",
  "独家",
  "旧版",
  "影视原声",
  "电视剧",
  "综艺",
  "串烧",
  "合辑",
  "广场舞",
  "铃声",
  "电台",
  "主播",
  "八音盒",
  "重混",
  "chunk",
  "vocal",
  "acoustic",
  "unplugged",
  "reprise",
  "karaoke",
  "ktv",
];

/** 歌手分隔符（多歌手曲目按这些符号拆成若干歌手） */
const ARTIST_SEPARATOR = /[&、,，/＋+·]|feat\.|ft\.|with|\bx\b/gi;

/** 实测占位文件固定为 185,336 B（≈11.57s @128k），与请求歌曲无关 */
const PLACEHOLDER_MAX_BYTES = 190000;

/** 预期体积超过该值时才启用占位文件特征判定，避免误伤极短曲目 */
const PLACEHOLDER_MIN_EXPECTED_BYTES = 300000;

/**
 * 解码 HTML 实体（搜索页与详情页的歌手字段带实体转义）
 * @param text 原始文本
 * @returns 解码后的文本
 */
const decodeEntities = (text: string): string =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

/**
 * 去掉括号内的补充说明，得到主标题
 * @param text 原始标题
 * @returns 去掉括号内容后的标题
 */
const stripBrackets = (text: string): string =>
  text.replace(/[（(【[《][^）)】\]》]*[）)】\]》]/g, " ");

/**
 * 归一化：解码实体、转小写、去除标点与空白，仅保留字母、数字与汉字
 * @param text 原始文本
 * @returns 归一化后的文本
 */
export const normalizeText = (text: string): string =>
  decodeEntities(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * 计算编辑距离
 * @param a 字符串 a
 * @param b 字符串 b
 * @returns 编辑距离
 */
const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = current;
  }
  return prev[b.length];
};

/**
 * 计算两个字符串的相似度
 * @param a 字符串 a
 * @param b 字符串 b
 * @returns 0~1 的相似度
 */
const textSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : 1 - levenshtein(a, b) / longest;
};

/**
 * 判断候选歌名是否只是同一首歌的「其他版本」
 * @param candidateTitle 候选歌名
 * @param requestTitle 请求歌名
 * @returns 命中版本标记时为 true
 */
const isVersionVariant = (candidateTitle: string, requestTitle: string): boolean => {
  const requestNorm = normalizeText(requestTitle);
  const segments: string[] = [];
  const bracket = /[（(【[《]([^）)】\]》]*)[）)】\]》]/g;
  let matched: RegExpExecArray | null;
  while ((matched = bracket.exec(candidateTitle))) segments.push(matched[1]);
  const tail = candidateTitle.split(/[-|_]/).pop() ?? "";
  if (tail && tail !== candidateTitle.trim()) segments.push(tail);
  return segments.some((segment) => {
    const norm = normalizeText(segment);
    if (!norm) return false;
    return VERSION_MARKERS.some((marker) => {
      const normalized = normalizeText(marker);
      return norm.includes(normalized) && !requestNorm.includes(normalized);
    });
  });
};

/**
 * 计算歌名相似度：主标题比对，命中版本变体则折半
 * @param requestTitle 请求歌名
 * @param candidateTitle 候选歌名
 * @returns 0~1 的相似度
 */
export const titleSimilarity = (requestTitle: string, candidateTitle: string): number => {
  const requestCore = normalizeText(stripBrackets(requestTitle));
  const candidateCore = normalizeText(stripBrackets(candidateTitle));
  if (!requestCore || !candidateCore) return 0;
  const base = textSimilarity(requestCore, candidateCore);
  if (isVersionVariant(candidateTitle, requestTitle)) return base * 0.5;
  return base;
};

/**
 * 计算歌手相似度：请求歌手与候选歌手任一方包含另一方即视为命中
 * @param requestArtist 请求歌手
 * @param candidateArtist 候选歌手
 * @returns 0~1 的相似度
 */
export const artistSimilarity = (requestArtist: string, candidateArtist: string): number => {
  const request = normalizeText(requestArtist);
  if (!request) return 1;
  const tokens = (candidateArtist || "")
    .split(ARTIST_SEPARATOR)
    .map((token) => normalizeText(token))
    .filter(Boolean);
  if (!tokens.length) return 0;
  if (tokens.some((token) => token.includes(request) || request.includes(token))) return 1;
  const requestTokens = requestArtist
    .split(ARTIST_SEPARATOR)
    .map((token) => normalizeText(token))
    .filter(Boolean);
  const candidateSet = new Set(tokens);
  let intersection = 0;
  for (const token of requestTokens) {
    if (candidateSet.has(token)) intersection += 1;
  }
  const union = new Set([...tokens, ...requestTokens]).size;
  return union === 0 ? 0 : intersection / union;
};

/**
 * 计算时长容差：max(8 秒, 6%)
 * @param duration 期望时长（秒）
 * @returns 容差（秒）
 */
export const durationTolerance = (duration: number): number => Math.max(8, duration * 0.06);

/**
 * 计算时长接近度，超出容差记 0 分
 * @param candidateDuration 候选时长（秒）
 * @param requestDuration 请求时长（秒）
 * @returns 0~1 的接近度；无法比对时返回 null
 */
export const durationSimilarity = (
  candidateDuration?: number,
  requestDuration?: number,
): number | null => {
  if (!requestDuration || !Number.isFinite(requestDuration) || requestDuration <= 0) return null;
  if (!candidateDuration || !Number.isFinite(candidateDuration) || candidateDuration <= 0)
    return null;
  const tolerance = durationTolerance(requestDuration);
  const delta = Math.abs(candidateDuration - requestDuration);
  if (delta > tolerance) return 0;
  return 1 - delta / tolerance;
};

/**
 * 对单个候选做三重校验
 * @param candidate 候选歌曲
 * @param target 请求侧目标
 * @returns 校验明细与综合得分
 */
export const scoreCandidate = (candidate: MatchCandidate, target: MatchTarget): CandidateScore => {
  const titleScore = titleSimilarity(target.title, candidate.title);
  const artistScore = artistSimilarity(target.artist, candidate.artist);
  const durationScore = durationSimilarity(candidate.duration, target.duration);
  const passed =
    titleScore >= TITLE_SCORE_LIMIT &&
    artistScore >= ARTIST_SCORE_LIMIT &&
    (durationScore === null || durationScore > 0);
  const score =
    TITLE_WEIGHT * titleScore +
    ARTIST_WEIGHT * artistScore +
    DURATION_WEIGHT * (durationScore === null ? 1 : durationScore);
  return { candidate, titleScore, artistScore, durationScore, score, passed };
};

/**
 * 对候选列表排序：通过校验的优先，其次按综合得分降序，同分保持检索顺序
 * @param candidates 候选列表
 * @param target 请求侧目标
 * @returns 排序后的校验明细
 */
export const rankCandidates = (
  candidates: MatchCandidate[],
  target: MatchTarget,
): CandidateScore[] =>
  candidates
    .map((candidate, index) => ({ index, detail: scoreCandidate(candidate, target) }))
    .sort((a, b) => {
      if (a.detail.passed !== b.detail.passed) return a.detail.passed ? -1 : 1;
      if (b.detail.score !== a.detail.score) return b.detail.score - a.detail.score;
      return a.index - b.index;
    })
    .map((item) => item.detail);

/**
 * 取出排序后首个通过三重校验的候选
 * @param candidates 候选列表
 * @param target 请求侧目标
 * @returns 通过校验的候选；无则返回 null
 */
export const pickBestCandidate = (
  candidates: MatchCandidate[],
  target: MatchTarget,
): MatchCandidate | null =>
  rankCandidates(candidates, target).find((detail) => detail.passed)?.candidate ?? null;

/**
 * 解析 keyword：按最后一个「-」拆出歌名与歌手，并去掉首尾空白
 * @param keyword 形如「歌名 - 歌手」的关键词
 * @returns 歌名与歌手
 */
export const parseKeyword = (keyword: string): { title: string; artist: string } => {
  const text = (keyword || "").trim();
  const index = text.lastIndexOf("-");
  if (index > 0) {
    const title = text.slice(0, index).trim();
    const artist = text.slice(index + 1).trim();
    if (title && artist) return { title, artist };
  }
  return { title: text, artist: "" };
};

/**
 * 解析可选的时长参数
 * @param value 秒数的字符串或数字
 * @returns 合法时长；不合法时返回 undefined
 */
export const parseDurationParam = (value?: string | number): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
};

/**
 * 构造请求侧目标信息
 * @param keyword 形如「歌名 - 歌手」的关键词
 * @param duration 期望时长（秒），可选
 * @returns 目标信息
 */
export const buildTarget = (keyword: string, duration?: number): MatchTarget => {
  const { title, artist } = parseKeyword(keyword);
  return {
    title,
    artist,
    duration: parseDurationParam(duration),
  };
};

/**
 * 估算指定码率与时长应有的文件体积
 * @param duration 时长（秒）
 * @param bitrateKbps 码率（kbps）
 * @returns 预期字节数
 */
export const expectedAudioBytes = (duration: number, bitrateKbps: number): number =>
  Math.round((duration * bitrateKbps * 1000) / 8);

/**
 * 判断直链返回的文件体积是否符合预期，用于拦截占位/残缺文件
 * @param length 响应头声明的字节数；未知时为 null
 * @param duration 候选歌曲声明的时长（秒）
 * @param bitrateKbps 直链码率（kbps）
 * @returns 是否可用及判定理由
 */
export const isPlausibleAudioLength = (
  length: number | null,
  duration?: number,
  bitrateKbps = 128,
): { ok: boolean; reason: string } => {
  if (length === null) return { ok: true, reason: "未知长度，跳过体积校验" };
  if (!duration || duration <= 0) return { ok: true, reason: "候选无时长，跳过体积校验" };
  const expected = expectedAudioBytes(duration, bitrateKbps);
  if (length < expected * 0.5) {
    return {
      ok: false,
      reason: `体积 ${length}B 明显小于 ${duration}s@${bitrateKbps}k 的预期 ${expected}B`,
    };
  }
  if (length <= PLACEHOLDER_MAX_BYTES && expected > PLACEHOLDER_MIN_EXPECTED_BYTES) {
    return {
      ok: false,
      reason: `体积 ${length}B 命中占位文件特征（≤${PLACEHOLDER_MAX_BYTES}B）`,
    };
  }
  return { ok: true, reason: "" };
};
