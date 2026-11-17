import { unzlibSync, zlibSync } from 'fflate';
import { ascii } from '../../core/bytes';
import { ConvertError } from '../../core/types';
import type { Sfnt, SfntTable } from './sfnt';

/**
 * WOFF(版1)の読み書き。各表を zlib で圧縮して格納するだけなので、表のデータは一切変わらない。
 * 仕様: https://www.w3.org/TR/WOFF/
 */

const align4 = (n: number): number => (n + 3) & ~3;

export function encodeWoff(font: Sfnt): Uint8Array {
  const n = font.tables.length;
  const dir = [...font.tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  // データは元の並び順で置く(展開したときに元と同じ配置に戻せるように)
  const physical = [...font.tables].sort((a, b) => a.offset - b.offset);
  const stored = new Map<SfntTable, Uint8Array>();
  for (const t of physical) {
    const z = zlibSync(t.data, { level: 9 });
    stored.set(t, z.length < t.data.length ? z : t.data);
  }
  const headerSize = 44 + n * 20;
  const total = headerSize + physical.reduce((s, t) => s + align4(stored.get(t)!.length), 0);
  const totalSfntSize = 12 + n * 16 + font.tables.reduce((s, t) => s + align4(t.data.length), 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  out.set([0x77, 0x4f, 0x46, 0x46]); // wOFF
  v.setUint32(4, font.flavor);
  v.setUint32(8, total);
  v.setUint16(12, n);
  v.setUint32(16, totalSfntSize);
  v.setUint16(20, 1); // majorVersion
  const offsets = new Map<SfntTable, number>();
  let pos = headerSize;
  for (const t of physical) {
    const d = stored.get(t)!;
    out.set(d, pos);
    offsets.set(t, pos);
    pos += align4(d.length);
  }
  dir.forEach((t, i) => {
    const r = 44 + i * 20;
    for (let k = 0; k < 4; k++) out[r + k] = t.tag.charCodeAt(k);
    v.setUint32(r + 4, offsets.get(t)!);
    v.setUint32(r + 8, stored.get(t)!.length);
    v.setUint32(r + 12, t.data.length);
    v.setUint32(r + 16, t.checksum);
  });
  return out;
}

export function decodeWoff(b: Uint8Array): Sfnt {
  const broken = new ConvertError('WOFF ファイルを読み取れませんでした。ファイルが壊れている可能性があります');
  if (ascii(b, 0, 4) !== 'wOFF' || b.length < 44) throw broken;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const flavor = v.getUint32(4);
  const n = v.getUint16(12);
  if (44 + n * 20 > b.length) throw broken;
  const tables: SfntTable[] = [];
  for (let i = 0; i < n; i++) {
    const r = 44 + i * 20;
    const offset = v.getUint32(r + 4);
    const compLength = v.getUint32(r + 8);
    const origLength = v.getUint32(r + 12);
    if (offset + compLength > b.length) throw broken;
    const raw = b.subarray(offset, offset + compLength);
    let data: Uint8Array;
    try {
      data = compLength < origLength ? unzlibSync(raw) : raw.slice();
    } catch {
      throw broken;
    }
    if (data.length !== origLength) throw broken;
    tables.push({ tag: ascii(b, r, 4), checksum: v.getUint32(r + 16), data, offset });
  }
  return { flavor, tables };
}
