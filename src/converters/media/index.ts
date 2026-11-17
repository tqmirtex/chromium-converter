import type { Converter, FormatId } from '../../core/types';

/** 音声・動画の変換。AVI は読み込めないため対象外 */
const VIDEO: FormatId[] = ['mp4', 'mov', 'mkv', 'webm'];
const AUDIO: FormatId[] = ['wav', 'flac', 'ogg', 'm4a', 'aac'];

const USAGE: Partial<Record<FormatId, string>> = {
  mp4: 'どの端末でも再生しやすい動画に(できるだけ劣化なしで詰め替え)',
  gif: '短い動画を、どこでも動くアニメーション画像に(画質・長さは控えめ)',
  webp: '短い動画を、GIF より高画質で軽いアニメーション画像に(長さは控えめ)',
};

const VIDEO_TO_AUDIO_USAGE: Partial<Record<FormatId, string>> = {
  mp3: '動画の音声だけを、どこでも再生できる MP3 で取り出す',
  wav: '動画の音声だけを、劣化のない WAV で取り出す(編集向け)',
  m4a: '動画の音声だけを、iPhone で扱いやすい M4A で取り出す',
  ogg: '動画の音声だけを、軽くて高音質な OGG(Opus)で取り出す',
};

const make = (from: FormatId, to: FormatId, usage?: string): Converter => ({
  id: `${from}->${to}`,
  from,
  to,
  engine: 'media',
  usage,
});

export const mediaConverters: Converter[] = [
  // 動画 → 音声
  ...VIDEO.flatMap((from) => (['mp3', 'wav', 'm4a', 'ogg'] as const).map((to) => make(from, to, VIDEO_TO_AUDIO_USAGE[to]))),
  // 音声の相互変換(各形式 ⇔ MP3)
  ...AUDIO.map((from) => make(from, 'mp3')),
  ...AUDIO.map((to) => make('mp3', to)),
  // 動画 → MP4
  ...VIDEO.filter((f) => f !== 'mp4').map((from) => make(from, 'mp4', USAGE.mp4)),
  // 動画 → アニメーション GIF / WebP
  ...VIDEO.flatMap((from) => (['gif', 'webp'] as const).map((to) => make(from, to, USAGE[to]))),
];
