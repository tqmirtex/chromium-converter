import { ConvertError } from '../../core/types';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47];
const ICO_MAX = 256;

interface IcoEntry {
  width: number;
  height: number;
  bpp: number;
  data: Uint8Array;
}

export interface DecodedIco {
  source: ImageBitmap | ImageData;
  width: number;
  height: number;
  entryCount: number;
}

function broken(): ConvertError {
  return new ConvertError('ICOファイルの中身を読み取れませんでした。ファイルが壊れている可能性があります');
}

function readEntries(b: Uint8Array): IcoEntry[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 6) throw broken();
  const count = v.getUint16(4, true);
  if (count === 0 || 6 + count * 16 > b.length) throw broken();
  const entries: IcoEntry[] = [];
  for (let i = 0; i < count; i++) {
    const p = 6 + i * 16;
    const size = v.getUint32(p + 8, true);
    const offset = v.getUint32(p + 12, true);
    if (size === 0 || offset + size > b.length) continue;
    entries.push({
      width: b[p] || 256,
      height: b[p + 1] || 256,
      bpp: v.getUint16(p + 6, true),
      data: b.subarray(offset, offset + size),
    });
  }
  if (entries.length === 0) throw broken();
  return entries;
}

/** BMP 形式(DIB)のアイコン画像を RGBA に展開する */
function decodeDib(d: Uint8Array): ImageData {
  if (d.length < 40) throw broken();
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const headerSize = v.getUint32(0, true);
  const width = v.getInt32(4, true);
  const rawHeight = v.getInt32(8, true);
  const bpp = v.getUint16(14, true);
  const compression = v.getUint32(16, true);
  const colorsUsed = v.getUint32(32, true);
  // アイコンの高さは XOR 画像と AND マスクの合計
  const height = Math.abs(rawHeight) / 2;
  const bottomUp = rawHeight > 0;
  if (width <= 0 || height <= 0 || width > ICO_MAX * 4 || height > ICO_MAX * 4) throw broken();
  if (![1, 4, 8, 24, 32].includes(bpp) || (compression !== 0 && compression !== 3)) {
    throw new ConvertError(`このICOの色形式(${bpp}ビット)には対応していません`);
  }
  const paletteCount = bpp <= 8 ? colorsUsed || 1 << bpp : 0;
  const paletteOffset = headerSize;
  const pixelOffset = headerSize + paletteCount * 4;
  const xorStride = Math.floor((width * bpp + 31) / 32) * 4;
  const andStride = Math.floor((width + 31) / 32) * 4;
  const andOffset = pixelOffset + xorStride * height;
  if (andOffset > d.length) throw broken();
  const hasMask = andOffset + andStride * height <= d.length;

  const out = new ImageData(width, height);
  const px = out.data;
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const srcRow = bottomUp ? height - 1 - y : y;
    const rowStart = pixelOffset + srcRow * xorStride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r: number, g: number, b: number, a = 255;
      if (bpp === 32) {
        const p = rowStart + x * 4;
        b = d[p];
        g = d[p + 1];
        r = d[p + 2];
        a = d[p + 3];
        if (a !== 0) anyAlpha = true;
      } else if (bpp === 24) {
        const p = rowStart + x * 3;
        b = d[p];
        g = d[p + 1];
        r = d[p + 2];
      } else {
        const bitPos = x * bpp;
        const byte = d[rowStart + (bitPos >> 3)];
        const shift = 8 - bpp - (bitPos & 7);
        const idx = (byte >> shift) & ((1 << bpp) - 1);
        const p = paletteOffset + idx * 4;
        b = d[p] ?? 0;
        g = d[p + 1] ?? 0;
        r = d[p + 2] ?? 0;
      }
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = a;
    }
  }
  // 32ビットでアルファが全く使われていないもの、または 32ビット未満は AND マスクで透過を決める
  if (hasMask && (bpp < 32 || !anyAlpha)) {
    for (let y = 0; y < height; y++) {
      const srcRow = bottomUp ? height - 1 - y : y;
      const rowStart = andOffset + srcRow * andStride;
      for (let x = 0; x < width; x++) {
        const masked = (d[rowStart + (x >> 3)] >> (7 - (x & 7))) & 1;
        px[(y * width + x) * 4 + 3] = masked ? 0 : 255;
      }
    }
  }
  return out;
}

export async function decodeIco(b: Uint8Array): Promise<DecodedIco> {
  const entries = readEntries(b);
  // 最も大きく、色数の多いものを選ぶ
  const best = entries.reduce((a, c) =>
    c.width * c.height > a.width * a.height || (c.width * c.height === a.width * a.height && c.bpp > a.bpp) ? c : a,
  );
  const isPng = PNG_SIG.every((s, i) => best.data[i] === s);
  if (isPng) {
    const bitmap = await createImageBitmap(new Blob([best.data as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
    return { source: bitmap, width: bitmap.width, height: bitmap.height, entryCount: entries.length };
  }
  const img = decodeDib(best.data);
  return { source: img, width: img.width, height: img.height, entryCount: entries.length };
}

function resize(src: CanvasImageSource, w: number, h: number): OffscreenCanvas {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d');
  if (!g) throw new ConvertError('描画の準備に失敗しました');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  return c;
}

/**
 * PNG を埋め込んだ ICO を作る(Windows Vista 以降・主要ブラウザが対応)。
 * 正方形なら 16〜256px の標準サイズを元の大きさ以下で複数入れる。ICO の上限は 256px。
 */
export async function encodeIco(src: OffscreenCanvas): Promise<{ blob: Blob; resized: boolean }> {
  const { width, height } = src;
  const resized = width > ICO_MAX || height > ICO_MAX;
  const scale = Math.min(1, ICO_MAX / Math.max(width, height));
  const top = { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
  const sizes: Array<{ w: number; h: number }> = [];
  if (width === height) {
    for (const s of [16, 24, 32, 48, 64, 128]) if (s < top.w) sizes.push({ w: s, h: s });
  }
  sizes.push(top);

  const images: Uint8Array[] = [];
  for (const s of sizes) {
    const canvas = s.w === width && s.h === height ? src : resize(src, s.w, s.h);
    const png = await canvas.convertToBlob({ type: 'image/png' });
    images.push(new Uint8Array(await png.arrayBuffer()));
  }

  const headerSize = 6 + 16 * images.length;
  const total = headerSize + images.reduce((n, i) => n + i.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0, true);
  v.setUint16(2, 1, true);
  v.setUint16(4, images.length, true);
  let offset = headerSize;
  images.forEach((img, i) => {
    const p = 6 + i * 16;
    out[p] = sizes[i].w >= 256 ? 0 : sizes[i].w;
    out[p + 1] = sizes[i].h >= 256 ? 0 : sizes[i].h;
    out[p + 2] = 0;
    out[p + 3] = 0;
    v.setUint16(p + 4, 1, true);
    v.setUint16(p + 6, 32, true);
    v.setUint32(p + 8, img.length, true);
    v.setUint32(p + 12, offset, true);
    out.set(img, offset);
    offset += img.length;
  });
  return { blob: new Blob([out], { type: 'image/x-icon' }), resized };
}
