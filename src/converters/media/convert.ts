import {
  ALL_FORMATS,
  AdtsOutputFormat,
  BlobSource,
  BufferTarget,
  Conversion,
  FlacOutputFormat,
  Input,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  QUALITY_VERY_HIGH,
  WavOutputFormat,
  canEncodeVideo,
  type AudioCodec,
  type ConversionAudioOptions,
  type ConversionVideoOptions,
  type DiscardedTrack,
  type InputAudioTrack,
  type InputVideoTrack,
  type OutputFormat,
} from 'mediabunny';
import { baseName } from '../../core/filename';
import { getFormat } from '../../core/formats';
import { ConvertError, type ConvertContext, type ConvertInput, type ConvertResult, type FormatId } from '../../core/types';

/**
 * 音声・動画の変換。ブラウザの WebCodecs と Mediabunny(コンテナの読み書き)で行う。
 * - 形式が同じ音声・映像は、再エンコードせずにそのまま詰め替える(劣化なし)
 * - 非可逆形式への変換は、元のビット率を下回らない設定にする
 * - MP3 / FLAC と、ブラウザが対応していないときの AAC は、同梱のエンコーダー(wasm)で書き出す
 */

const kbps = (n: number): number => n * 1000;

/** 出力形式ごとの音声コーデックと、選べるビット率 */
const AUDIO_TARGETS: Record<string, { codec: AudioCodec; steps?: number[]; losslessBitrate?: number }> = {
  mp3: { codec: 'mp3', steps: [128, 160, 192, 224, 256, 320].map(kbps), losslessBitrate: kbps(320) },
  m4a: { codec: 'aac', steps: [128, 160, 192, 256, 320].map(kbps), losslessBitrate: kbps(256) },
  aac: { codec: 'aac', steps: [128, 160, 192, 256, 320].map(kbps), losslessBitrate: kbps(256) },
  ogg: { codec: 'opus', steps: [128, 160, 192, 256, 320, 384, 510].map(kbps), losslessBitrate: kbps(256) },
  wav: { codec: 'pcm-s16' },
  flac: { codec: 'flac' },
};

const LOSSLESS = (codec: AudioCodec | null): boolean => codec === 'flac' || !!codec?.startsWith('pcm') || codec === 'ulaw' || codec === 'alaw';

const fmtTime = (s: number): string => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

// ---------- 同梱エンコーダーの登録 ----------

let encodersReady: Promise<void> | undefined;

/**
 * MP3・FLAC・AAC は同梱のエンコーダーを使う。
 * AAC はブラウザにもエンコーダーがあるが、環境によって対応するビット率が限られ(Windows では 192kbps まで)、
 * Linux では使えないため、元のビット率を下回らない設定をどの環境でも使えるよう、同梱のものにそろえる。
 */
function registerEncoders(): Promise<void> {
  encodersReady ??= (async () => {
    const [{ registerMp3Encoder }, { registerFlacEncoder }, { registerAacEncoder }] = await Promise.all([
      import('@mediabunny/mp3-encoder'),
      import('@mediabunny/flac-encoder'),
      import('@mediabunny/aac-encoder'),
    ]);
    registerMp3Encoder();
    registerFlacEncoder();
    registerAacEncoder();
  })();
  return encodersReady;
}

// ---------- 共通 ----------

function openInput(input: ConvertInput): Input {
  if (typeof AudioDecoder === 'undefined' || typeof VideoDecoder === 'undefined') {
    throw new ConvertError('このブラウザは音声・動画の変換(WebCodecs)に対応していません。Chrome を最新にしてください');
  }
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(input.blob) });
}

/** ビット率の選択肢から、元のビット率を下回らない最小のものを選ぶ */
function pickBitrate(target: (typeof AUDIO_TARGETS)[string], sourceCodec: AudioCodec | null, sourceBitrate: number | null): number | undefined {
  if (!target.steps) return undefined;
  if (LOSSLESS(sourceCodec) || !sourceBitrate) return target.losslessBitrate;
  return target.steps.find((s) => s >= sourceBitrate * 0.98) ?? target.steps[target.steps.length - 1];
}

async function sourceBitrate(track: InputAudioTrack): Promise<number | null> {
  try {
    const stats = await track.computePacketStats(400);
    return Number.isFinite(stats.averageBitrate) && stats.averageBitrate > 0 ? stats.averageBitrate : null;
  } catch {
    return null;
  }
}

function discardMessage(d: DiscardedTrack[], kind: 'audio' | 'video'): string | null {
  const t = d.find((x) => x.track.type === kind && x.reason !== 'discarded_by_user' && !x.reason.startsWith('max_track'));
  if (!t) return null;
  const what = kind === 'audio' ? '音声' : '映像';
  switch (t.reason) {
    case 'unknown_source_codec':
    case 'undecodable_source_codec':
      return `この${what}の形式は、ブラウザで展開できないため変換できません(DivX・WMV・ProRes・DTS などは対象外です)`;
    case 'no_encodable_target_codec':
      return `このブラウザでは、${what}をこの形式で書き出せません`;
    default:
      return `${what}を変換できませんでした(${t.reason})`;
  }
}

async function run(conversion: Conversion, ctx: ConvertContext, total: number | null): Promise<void> {
  conversion.onProgress = (p, processed) => {
    ctx.progress(0.05 + p * 0.9, total ? `${fmtTime(processed)} / ${fmtTime(total)}` : `${Math.round(p * 100)}%`);
  };
  await conversion.execute();
}

function outputBlob(output: Output<OutputFormat, BufferTarget>, mime: string): Blob {
  const buf = output.target.buffer;
  if (!buf) throw new ConvertError('出力を作れませんでした');
  return new Blob([buf], { type: mime });
}

// ---------- 音声へ ----------

function audioOutputFormat(to: FormatId): OutputFormat {
  switch (to) {
    case 'mp3':
      return new Mp3OutputFormat();
    case 'wav':
      return new WavOutputFormat();
    case 'flac':
      return new FlacOutputFormat();
    case 'ogg':
      return new OggOutputFormat();
    case 'aac':
      return new AdtsOutputFormat();
    case 'm4a':
      return new Mp4OutputFormat({ fastStart: 'in-memory' });
    default:
      throw new ConvertError(`${to} への変換には対応していません`);
  }
}

async function toAudio(input: ConvertInput, to: FormatId, ctx: ConvertContext): Promise<ConvertResult> {
  await registerEncoders();
  const src = openInput(input);
  try {
    const track = await src.getPrimaryAudioTrack();
    if (!track) {
      const video = await src.getPrimaryVideoTrack();
      throw new ConvertError(video ? 'この動画には音声が入っていません' : '音声のデータが見つかりませんでした。ファイルが壊れている可能性があります');
    }
    const target = AUDIO_TARGETS[to];
    const codec = await track.getCodec();
    const channels = await track.getNumberOfChannels();
    const sampleRate = await track.getSampleRate();
    const notes: string[] = [];
    let options: ConversionAudioOptions = {};
    if (codec === target.codec) {
      notes.push('音声は再エンコードせずに、そのまま取り出しました(劣化なし)');
    } else {
      const bitrate = pickBitrate(target, codec, await sourceBitrate(track));
      options = { codec: target.codec, bitrate };
      // MP3 / AAC / Opus は2チャンネルまで。MP3 と AAC は 48kHz まで(Opus は常に 48kHz)
      if (target.codec !== 'flac' && !target.codec.startsWith('pcm') && channels > 2) {
        options.numberOfChannels = 2;
        notes.push(`${channels}チャンネルの音声を2チャンネル(ステレオ)にまとめました`);
      }
      if (target.codec === 'opus') options.sampleRate = 48000;
      else if ((target.codec === 'mp3' || target.codec === 'aac') && sampleRate > 48000) options.sampleRate = 48000;
      if (bitrate) notes.push(`${Math.round(bitrate / 1000)}kbps で書き出しました`);
      if (LOSSLESS(target.codec) && !LOSSLESS(codec)) notes.push('元が圧縮音声のため、音質は元のままです(良くはなりません)');
    }
    const output = new Output({ format: audioOutputFormat(to), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input: src,
      output,
      video: { discard: true },
      audio: options,
      // 主な音声トラックだけを使う(複数の音声トラックがあっても1つにする)
      tracks: 'primary',
      showWarnings: false,
    });
    if (!conversion.isValid) {
      throw new ConvertError(discardMessage(conversion.discardedTracks, 'audio') ?? '音声を変換できませんでした');
    }
    await run(conversion, ctx, await src.computeDuration().catch(() => null));
    return {
      outputs: [{ name: `${baseName(input.name)}.${getFormat(to).ext}`, blob: outputBlob(output, getFormat(to).mime) }],
      notes,
    };
  } finally {
    src.dispose();
  }
}

// ---------- 動画 → MP4 ----------

/** そのまま MP4 に入れても、多くの機器で再生できる形式 */
const MP4_SAFE_VIDEO = ['avc', 'hevc'];
const MP4_SAFE_AUDIO = ['aac', 'mp3'];

async function toMp4(input: ConvertInput, ctx: ConvertContext): Promise<ConvertResult> {
  await registerEncoders();
  const src = openInput(input);
  try {
    const notes: string[] = [];
    const videoTrack = await src.getPrimaryVideoTrack();
    if (!videoTrack) throw new ConvertError('映像のデータが見つかりませんでした(音声だけのファイルは音声の形式を選んでください)');
    const video = async (t: InputVideoTrack): Promise<ConversionVideoOptions> => {
      const c = await t.getCodec();
      if (c && MP4_SAFE_VIDEO.includes(c)) {
        notes.push('映像は再エンコードせずに詰め替えました(劣化なし)');
        return {};
      }
      if (!(await canEncodeVideo('avc'))) throw new ConvertError('このブラウザは H.264 の書き出しに対応していません');
      notes.push(`映像(${c ?? '不明'})を H.264 に変換しました(高画質の設定)`);
      return { codec: 'avc', bitrate: QUALITY_VERY_HIGH };
    };
    const audio = async (t: InputAudioTrack): Promise<ConversionAudioOptions> => {
      const c = await t.getCodec();
      if (c && MP4_SAFE_AUDIO.includes(c)) return {};
      const channels = await t.getNumberOfChannels();
      notes.push(`音声(${c ?? '不明'})を AAC に変換しました`);
      return {
        codec: 'aac',
        bitrate: pickBitrate(AUDIO_TARGETS.aac, c, await sourceBitrate(t)),
        numberOfChannels: Math.min(channels, 2),
        sampleRate: Math.min(await t.getSampleRate(), 48000),
      };
    };
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const conversion = await Conversion.init({ input: src, output, video, audio, tracks: 'primary', showWarnings: false });
    const videoProblem = discardMessage(conversion.discardedTracks, 'video');
    if (!conversion.isValid || videoProblem) throw new ConvertError(videoProblem ?? '動画を変換できませんでした');
    const audioProblem = discardMessage(conversion.discardedTracks, 'audio');
    if (audioProblem) notes.push(`${audioProblem}。映像だけを出力しました`);
    await run(conversion, ctx, await src.computeDuration().catch(() => null));
    return {
      outputs: [{ name: `${baseName(input.name)}.mp4`, blob: outputBlob(output, 'video/mp4') }],
      notes: [...new Set(notes)],
    };
  } finally {
    src.dispose();
  }
}

export async function convert(input: ConvertInput, to: FormatId, ctx: ConvertContext): Promise<ConvertResult> {
  ctx.progress(0.02);
  try {
    if (to === 'mp4') return await toMp4(input, ctx);
    if (to === 'gif' || to === 'webp') return await (await import('./animation')).toAnimation(input, to, ctx);
    if (AUDIO_TARGETS[to]) return await toAudio(input, to, ctx);
    throw new ConvertError(`${to} への変換には対応していません`);
  } catch (error) {
    if (error instanceof ConvertError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/unsupported|not supported|unrecognized|could not determine/i.test(message)) {
      throw new ConvertError(`このファイルの形式・中身には対応していません(${message})`);
    }
    throw new ConvertError(`変換できませんでした。ファイルが壊れている可能性があります(${message})`);
  }
}
