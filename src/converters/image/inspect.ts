import { ascii, ftypBrands, readU32BE } from '../../core/bytes';
import type { FormatId } from '../../core/types';

function skipSubBlocks(b: Uint8Array, p: number): number {
  while (p < b.length) {
    const n = b[p++];
    if (n === 0) break;
    p += n;
  }
  return p;
}

function gifFrameCount(b: Uint8Array): number {
  if (b.length < 13) return 0;
  let p = 13;
  const flags = b[10];
  if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1));
  let frames = 0;
  while (p < b.length) {
    const t = b[p++];
    if (t === 0x2c) {
      frames++;
      if (frames > 1) return frames;
      p += 8;
      const f = b[p++];
      if (f & 0x80) p += 3 * (1 << ((f & 7) + 1));
      p++; // LZW 最小符号長
      p = skipSubBlocks(b, p);
    } else if (t === 0x21) {
      p++; // 拡張ラベル
      p = skipSubBlocks(b, p);
    } else {
      break;
    }
  }
  return frames;
}

function isApng(b: Uint8Array): boolean {
  let p = 8;
  while (p + 8 <= b.length) {
    const len = readU32BE(b, p);
    const type = ascii(b, p + 4, 4);
    if (type === 'acTL') return true;
    if (type === 'IDAT') return false;
    p += 12 + len;
  }
  return false;
}

/** アニメーション画像か(静止画へ変換するときは最初のフレームを使う) */
export function isAnimated(format: FormatId, b: Uint8Array): boolean {
  switch (format) {
    case 'gif':
      return gifFrameCount(b) > 1;
    case 'webp':
      return ascii(b, 12, 4) === 'VP8X' && (b[20] & 0x02) !== 0;
    case 'avif':
      return ftypBrands(b).includes('avis');
    case 'png':
      return isApng(b);
    default:
      return false;
  }
}
