import { ascii, readU32BE } from '../../core/bytes';

/** 解像度が書かれていない画像の既定値(画面表示の標準 96dpi) */
export const DEFAULT_DPI = 96;

function validDpi(dpi: number): number | undefined {
  return Number.isFinite(dpi) && dpi >= 10 && dpi <= 2400 ? dpi : undefined;
}

export interface JpegInfo {
  dpi?: number;
  /** Exif の向き(1〜8)。1 は回転なし */
  orientation: number;
}

/** Exif(TIFF 形式)から向きと解像度を読む */
function readExif(b: Uint8Array, start: number, end: number): { orientation?: number; dpi?: number } {
  const little = ascii(b, start, 2) === 'II';
  const v = new DataView(b.buffer, b.byteOffset + start, end - start);
  const u16 = (o: number): number => v.getUint16(o, little);
  const u32 = (o: number): number => v.getUint32(o, little);
  const out: { orientation?: number; dpi?: number } = {};
  try {
    const ifd = u32(4);
    const count = u16(ifd);
    let xres: number | undefined;
    let unit = 2;
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      const tag = u16(e);
      if (tag === 0x0112) out.orientation = u16(e + 8);
      else if (tag === 0x0128) unit = u16(e + 8);
      else if (tag === 0x011a) {
        const off = u32(e + 8);
        const den = u32(off + 4);
        if (den) xres = u32(off) / den;
      }
    }
    if (xres) out.dpi = validDpi(unit === 3 ? xres * 2.54 : xres);
  } catch {
    // 壊れた Exif は無視する(向き・解像度は既定値になる)
  }
  return out;
}

export function jpegInfo(b: Uint8Array): JpegInfo {
  let p = 2;
  let jfifDpi: number | undefined;
  let exif: { orientation?: number; dpi?: number } = {};
  while (p + 4 <= b.length && b[p] === 0xff) {
    const marker = b[p + 1];
    if (marker === 0xd9 || marker === 0xda) break; // EOI / SOS(以降は画像データ)
    const len = (b[p + 2] << 8) | b[p + 3];
    const seg = p + 4;
    if (marker === 0xe0 && ascii(b, seg, 5) === 'JFIF\0') {
      const units = b[seg + 7];
      const x = (b[seg + 8] << 8) | b[seg + 9];
      if (units === 1) jfifDpi = validDpi(x);
      else if (units === 2) jfifDpi = validDpi(x * 2.54);
    } else if (marker === 0xe1 && ascii(b, seg, 6) === 'Exif\0\0') {
      exif = readExif(b, seg + 6, Math.min(b.length, p + 2 + len));
    }
    p += 2 + len;
  }
  return { dpi: jfifDpi ?? exif.dpi, orientation: exif.orientation && exif.orientation <= 8 ? exif.orientation : 1 };
}

/** PNG の pHYs チャンク(1メートルあたりのピクセル数)から dpi を読む */
export function pngDpi(b: Uint8Array): number | undefined {
  let p = 8;
  while (p + 8 <= b.length) {
    const len = readU32BE(b, p);
    const type = ascii(b, p + 4, 4);
    if (type === 'pHYs' && len >= 9) {
      const ppm = readU32BE(b, p + 8);
      return b[p + 16] === 1 ? validDpi(ppm * 0.0254) : undefined;
    }
    if (type === 'IDAT') return undefined;
    p += 12 + len;
  }
  return undefined;
}
