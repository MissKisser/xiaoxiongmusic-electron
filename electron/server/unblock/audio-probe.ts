/**
 * 直链真实音频时长探测
 *
 * 目的：区分「整曲直链」与「试听片段 / 错版曲目」。
 *
 * 只看 Content-Length 不够：
 * 1. 同一首歌在不同通道可能是 64k / 128k / 320k，按假定码率换算会把高码率误判为整曲、
 *    低码率误判为片段；
 * 2. 公益聚合站返回的文件未必是请求的那一版（实测同一条 id 可返回时长明显不同的另一版），
 *    字节数完全可能落在「合理区间」内，只有真实时长能把它区分出来。
 *
 * 因此这里做两件事：
 * 1. HEAD 读总字节数；
 * 2. Range 读文件头，解析出真实采样率与总帧数（FLAC 精确、M4A 精确、WAV 精确、MP3 由帧头估算）。
 *
 * 全部为只读探测：不整曲下载，最多读取文件头 128 KB。
 */
import axios from "axios";

/** 文件头读取上限（字节） */
const HEAD_BYTES = 131072;

/** 探测请求超时（毫秒） */
const PROBE_TIMEOUT = 10000;

/** 音频探测结论 */
export type AudioProbe = {
  /** 响应声明的总字节数；未知时为 null */
  bytes: number | null;
  /** 解析出的真实音频时长（秒）；无法解析时为 null */
  durationSec: number | null;
  /** 解析出的码率（kbps）；无法解析时为 null */
  bitrateKbps: number | null;
  /** 识别出的容器格式 */
  format: string;
};

/** MPEG1 Layer3 码率表（kbps） */
const MP3_BR_MPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];

/** MPEG2 / 2.5 Layer3 码率表（kbps） */
const MP3_BR_MPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

/** MPEG 采样率表（按版本分组） */
const MP3_SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

/**
 * 读取直链声明的总字节数
 * @param url 音频直链
 * @param headers 请求头
 * @returns 字节数；无法确定时返回 null
 */
const probeTotalBytes = async (
  url: string,
  headers: Record<string, string>,
): Promise<number | null> => {
  try {
    const response = await axios.head(url, {
      headers,
      timeout: PROBE_TIMEOUT,
      validateStatus: () => true,
    });
    const length = Number(response.headers["content-length"]);
    if (response.status >= 200 && response.status < 300 && Number.isFinite(length) && length > 0) {
      return length;
    }
  } catch {
    // HEAD 不可用时退化为 Range 请求
  }
  try {
    const response = await axios.get(url, {
      headers: { ...headers, Range: `bytes=0-${HEAD_BYTES - 1}` },
      responseType: "arraybuffer",
      timeout: PROBE_TIMEOUT,
      maxContentLength: HEAD_BYTES,
      validateStatus: () => true,
    });
    const range = response.headers["content-range"];
    if (typeof range === "string") {
      const total = Number(range.split("/")[1]);
      if (Number.isFinite(total) && total > 0) return total;
    }
    const length = Number(response.headers["content-length"]);
    if (response.status >= 200 && response.status < 300 && Number.isFinite(length) && length > 0) {
      return length;
    }
  } catch {
    return null;
  }
  return null;
};

/**
 * 读取直链的文件头
 * @param url 音频直链
 * @param headers 请求头
 * @returns 文件头字节；读取失败返回 null
 */
const fetchHead = async (url: string, headers: Record<string, string>): Promise<Buffer | null> => {
  try {
    const response = await axios.get(url, {
      headers: { ...headers, Range: `bytes=0-${HEAD_BYTES - 1}` },
      responseType: "arraybuffer",
      timeout: PROBE_TIMEOUT,
      maxContentLength: HEAD_BYTES,
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) return null;
    const buffer = Buffer.from(response.data);
    return buffer.length ? buffer : null;
  } catch {
    return null;
  }
};

/**
 * 解析 FLAC 头，得到精确时长
 * @param buffer 文件头
 * @returns 时长（秒）与码率（kbps）；非 FLAC 或解析失败返回 null
 */
const parseFlac = (buffer: Buffer): { durationSec: number; bitrateKbps: number } | null => {
  if (buffer.length < 42 || buffer.toString("latin1", 0, 4) !== "fLaC") return null;
  // STREAMINFO 紧跟 4 字节块头：20bit 采样率 + 36bit 总采样数
  const info = buffer.subarray(8, 42);
  const sampleRate = (info[10] << 12) | (info[11] << 4) | (info[12] >> 4);
  const totalSamples =
    (info[13] & 0x0f) * 2 ** 32 + (info[14] << 24) + (info[15] << 16) + (info[16] << 8) + info[17];
  if (!sampleRate || !totalSamples) return null;
  const durationSec = totalSamples / sampleRate;
  return { durationSec, bitrateKbps: 0 };
};

/**
 * 解析 MP4 / M4A 容器，取 mvhd 的时长
 * @param buffer 文件头
 * @returns 时长（秒）与码率（kbps）；非 MP4 或解析失败返回 null
 */
const parseMp4 = (buffer: Buffer): { durationSec: number; bitrateKbps: number } | null => {
  if (buffer.length < 16 || buffer.toString("latin1", 4, 8) !== "ftyp") return null;
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    if (size === 1) {
      if (offset + 16 > buffer.length) break;
      size = Number(buffer.readBigUInt64BE(offset + 8));
    }
    if (!size || size < 8) break;
    if (type === "moov") {
      const moov = buffer.subarray(offset + 8, Math.min(offset + 8 + size, buffer.length));
      const index = moov.indexOf("mvhd");
      if (index >= 0 && index + 24 <= moov.length) {
        const version = moov[index + 4];
        const base = index + 8;
        const timescale =
          version === 1 ? moov.readUInt32BE(base + 16) : moov.readUInt32BE(base + 8);
        const duration =
          version === 1 ? Number(moov.readBigUInt64BE(base + 20)) : moov.readUInt32BE(base + 12);
        if (timescale && duration) return { durationSec: duration / timescale, bitrateKbps: 0 };
      }
    }
    if (type === "mdat") break;
    offset += size;
  }
  return null;
};

/**
 * 解析 WAV 头，取 data 块时长
 * @param buffer 文件头
 * @returns 时长（秒）与码率（kbps）；非 WAV 或解析失败返回 null
 */
const parseWav = (buffer: Buffer): { durationSec: number; bitrateKbps: number } | null => {
  if (buffer.length < 44 || buffer.toString("latin1", 0, 4) !== "RIFF") return null;
  const byteRate = buffer.readUInt32LE(28);
  if (!byteRate) return null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("latin1", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "data") {
      return { durationSec: size / byteRate, bitrateKbps: (byteRate * 8) / 1000 };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
};

/**
 * 解析 MP3 帧头并估算真实时长
 *
 * MP3 无总帧数字段，只能按「帧头码率 + 音频字节数」估算：CBR 文件准确，VBR 会有偏差。
 * @param buffer 文件头
 * @param totalBytes 总字节数
 * @returns 时长（秒）与码率（kbps）；非 MP3 或解析失败返回 null
 */
const parseMp3 = (
  buffer: Buffer,
  totalBytes: number,
): { durationSec: number; bitrateKbps: number } | null => {
  let offset = 0;
  if (buffer.length > 10 && buffer.toString("latin1", 0, 3) === "ID3") {
    const size =
      ((buffer[6] & 0x7f) << 21) |
      ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) |
      (buffer[9] & 0x7f);
    offset = 10 + size;
  }
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] === 0xff && (buffer[offset + 1] & 0xe0) === 0xe0) {
      const versionBits = (buffer[offset + 1] >> 3) & 0x03;
      const layerBits = (buffer[offset + 1] >> 1) & 0x03;
      const bitrateIndex = (buffer[offset + 2] >> 4) & 0x0f;
      const sampleRateIndex = (buffer[offset + 2] >> 2) & 0x03;
      if (
        versionBits === 1 ||
        layerBits !== 1 ||
        bitrateIndex === 0 ||
        bitrateIndex === 15 ||
        sampleRateIndex === 3
      ) {
        break;
      }
      const bitrateTable = versionBits === 3 ? MP3_BR_MPEG1 : MP3_BR_MPEG2;
      const bitrateKbps = bitrateTable[bitrateIndex];
      const sampleRate = MP3_SAMPLE_RATES[versionBits]?.[sampleRateIndex];
      if (!bitrateKbps || !sampleRate) break;
      const audioBytes = Math.max(0, totalBytes - offset);
      return { durationSec: (audioBytes * 8) / (bitrateKbps * 1000), bitrateKbps };
    }
    offset += 1;
  }
  return null;
};

/**
 * 探测音频直链的真实时长与体积
 *
 * @param url 音频直链
 * @param headers 取链请求头
 * @returns 探测结论
 */
export const probeAudio = async (
  url: string,
  headers: Record<string, string> = {},
): Promise<AudioProbe> => {
  const bytes = await probeTotalBytes(url, headers);
  const buffer = await fetchHead(url, headers);
  if (!buffer) {
    return { bytes, durationSec: null, bitrateKbps: null, format: "unknown" };
  }
  const flac = parseFlac(buffer);
  if (flac) {
    return {
      bytes,
      durationSec: flac.durationSec,
      bitrateKbps:
        bytes && flac.durationSec ? Math.round((bytes * 8) / flac.durationSec / 1000) : null,
      format: "flac",
    };
  }
  const mp4 = parseMp4(buffer);
  if (mp4) {
    return {
      bytes,
      durationSec: mp4.durationSec,
      bitrateKbps:
        bytes && mp4.durationSec ? Math.round((bytes * 8) / mp4.durationSec / 1000) : null,
      format: "m4a",
    };
  }
  const wav = parseWav(buffer);
  if (wav) {
    return { bytes, durationSec: wav.durationSec, bitrateKbps: wav.bitrateKbps, format: "wav" };
  }
  if (bytes) {
    const mp3 = parseMp3(buffer, bytes);
    if (mp3) {
      return { bytes, durationSec: mp3.durationSec, bitrateKbps: mp3.bitrateKbps, format: "mp3" };
    }
  }
  return { bytes, durationSec: null, bitrateKbps: null, format: "unknown" };
};
