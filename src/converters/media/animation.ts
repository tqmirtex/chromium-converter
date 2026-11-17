import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { ascii } from '../../core/bytes';
import { baseName } from '../../core/filename';
import { ConvertError, type ConvertContext, type ConvertInput, type ConvertResult } from '../../core/types';

/**
 * 動画 → アニメーション GIF / アニメーション WebP。
 * ファイルが大きくなりすぎないよう、幅・フレームレート・長さに上限を設ける(README に記載)。
 * - GIF: 256色に減色するため、写真のような映像は画質が下がる
 * - WebP: 各フレームをブラウザの WebP エンコーダー(非可逆)で圧縮し、アニメーション WebP に組み立てる
 */
const ANIMATION_LIMITS = {
  gif: { maxWidth: 480, fps: 10, maxSeconds: 15 },
  webp: { maxWidth: 640, fps: 15, maxSeconds: 15, quality: 0.8 },
} as const;

// ---------- アニメーション WebP の組み立て ----------

function chunk(tag: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length + (data.length & 1));
  for (let i = 0; i < 4; i++) out[i] = tag.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

const u24 = (v: number): number[] => [v & 255, (v >> 8) & 255, (v >> 16) & 255];

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** 静止画の WebP から、画像データのチャンク(ALPH / VP8 / VP8L)を取り出す */
function frameChunks(webp: Uint8Array): Uint8Array {
  if (ascii(webp, 0, 4) !== 'RIFF' || ascii(webp, 8, 4) !== 'WEBP') throw new ConvertError('WebP の作成に失敗しました');
  const parts: Uint8Array[] = [];
  let p = 12;
  const v = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  while (p + 8 <= webp.length) {
    const tag = ascii(webp, p, 4);
    const size = v.getUint32(p + 4, true);
    const total = 8 + size + (size & 1);
    if (tag === 'ALPH' || tag === 'VP8 ' || tag === 'VP8L') parts.push(webp.subarray(p, p + total));
    p += total;
  }
  return concat(parts);
}

class AnimatedWebpWriter {
  private frames: Uint8Array[] = [];
  constructor(
    private width: number,
    private height: number,
  ) {}

  add(webp: Uint8Array, durationMs: number): void {
    const header = new Uint8Array([
      ...u24(0), // X / 2
      ...u24(0), // Y / 2
      ...u24(this.width - 1),
      ...u24(this.height - 1),
      ...u24(Math.max(1, Math.round(durationMs))),
      0b10, // 合成しない(毎フレーム全面を描く)、破棄しない
    ]);
    this.frames.push(chunk('ANMF', concat([header, frameChunks(webp)])));
  }

  finish(): Uint8Array {
    const vp8x = new Uint8Array([0b10, 0, 0, 0, ...u24(this.width - 1), ...u24(this.height - 1)]); // アニメーションあり
    const anim = new Uint8Array([255, 255, 255, 255, 0, 0]); // 背景色、ループ回数 0 = 無限
    const body = concat([chunk('VP8X', vp8x), chunk('ANIM', anim), ...this.frames]);
    const header = new Uint8Array(12);
    header.set([0x52, 0x49, 0x46, 0x46]);
    new DataView(header.buffer).setUint32(4, body.length + 4, true);
    header.set([0x57, 0x45, 0x42, 0x50], 8);
    return concat([header, body]);
  }
}

// ---------- 変換 ----------

export async function toAnimation(input: ConvertInput, to: 'gif' | 'webp', ctx: ConvertContext): Promise<ConvertResult> {
  const limits = ANIMATION_LIMITS[to];
  const src = new Input({ formats: ALL_FORMATS, source: new BlobSource(input.blob) });
  try {
    const track = await src.getPrimaryVideoTrack();
    if (!track) throw new ConvertError('映像のデータが見つかりませんでした');
    if (!(await track.canDecode())) {
      throw new ConvertError('この映像の形式は、ブラウザで展開できないため変換できません');
    }
    const start = await track.getFirstTimestamp();
    const duration = (await track.computeDuration()) - start;
    const length = Math.min(duration, limits.maxSeconds);
    const notes: string[] = [];
    if (duration > limits.maxSeconds + 0.05) notes.push(`長い動画のため、最初の${limits.maxSeconds}秒だけを変換しました`);

    const dw = await track.getDisplayWidth();
    const dh = await track.getDisplayHeight();
    const width = Math.min(dw, limits.maxWidth);
    const height = Math.max(1, Math.round((dh * width) / dw));
    if (width < dw) notes.push(`幅 ${width}px に縮小しました`);
    notes.push(`${limits.fps}fps で作りました`);

    const count = Math.max(1, Math.round(length * limits.fps));
    const delay = 1000 / limits.fps;
    const timestamps = Array.from({ length: count }, (_, i) => start + i / limits.fps);
    const sink = new CanvasSink(track, { width, height, fit: 'fill', poolSize: 2 });
    const gif = to === 'gif' ? GIFEncoder() : null;
    const webp = to === 'webp' ? new AnimatedWebpWriter(width, height) : null;
    let i = 0;
    for await (const frame of sink.canvasesAtTimestamps(timestamps)) {
      i++;
      ctx.progress(0.05 + (0.9 * i) / count, `${i} / ${count} コマ`);
      if (!frame) continue;
      const canvas = frame.canvas as OffscreenCanvas;
      if (gif) {
        const g = canvas.getContext('2d');
        if (!g) throw new ConvertError('描画の準備に失敗しました');
        const rgba = g.getImageData(0, 0, width, height).data;
        const palette = quantize(rgba, 256);
        gif.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay, repeat: 0 });
      } else if (webp) {
        const blob = await canvas.convertToBlob({ type: 'image/webp', quality: ANIMATION_LIMITS.webp.quality });
        webp.add(new Uint8Array(await blob.arrayBuffer()), delay);
      }
    }
    let bytes: Uint8Array;
    if (gif) {
      gif.finish();
      bytes = gif.bytes();
    } else {
      bytes = webp!.finish();
    }
    return {
      outputs: [
        {
          name: `${baseName(input.name)}.${to}`,
          blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: to === 'gif' ? 'image/gif' : 'image/webp' }),
        },
      ],
      notes,
    };
  } finally {
    src.dispose();
  }
}
