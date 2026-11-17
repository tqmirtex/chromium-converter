import { ascii } from '../../core/bytes';
import { ConvertError } from '../../core/types';

/** フォント(sfnt = TrueType / OpenType)の表 */
export interface SfntTable {
  tag: string;
  checksum: number;
  data: Uint8Array;
  /** 元のファイルでの位置(並び順を保つため) */
  offset: number;
}

export interface Sfnt {
  /** 0x00010000 / 'true' = TrueType、'OTTO' = CFF */
  flavor: number;
  tables: SfntTable[];
  /** 表を組み立て直したので、head のチェックサム補正値を計算し直す必要がある */
  fixChecksum?: boolean;
}

const FLAVOR_OTTO = 0x4f54544f;

export function isCff(flavor: number): boolean {
  return flavor === FLAVOR_OTTO;
}

const broken = (): ConvertError => new ConvertError('フォントファイルを読み取れませんでした。ファイルが壊れている可能性があります');

export function parseSfnt(b: Uint8Array): Sfnt {
  if (ascii(b, 0, 4) === 'ttcf') {
    throw new ConvertError('複数のフォントをまとめたファイル(TTC / OTC)には対応していません');
  }
  if (b.length < 12) throw broken();
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const flavor = v.getUint32(0);
  if (![0x00010000, 0x74727565, FLAVOR_OTTO].includes(flavor)) throw broken();
  const n = v.getUint16(4);
  if (n === 0 || 12 + n * 16 > b.length) throw broken();
  const tables: SfntTable[] = [];
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const offset = v.getUint32(r + 8);
    const length = v.getUint32(r + 12);
    if (offset + length > b.length) throw broken();
    tables.push({ tag: ascii(b, r, 4), checksum: v.getUint32(r + 4), data: b.subarray(offset, offset + length), offset });
  }
  return { flavor, tables };
}

const align4 = (n: number): number => (n + 3) & ~3;

/**
 * sfnt を組み立てる。表の目録はタグ順、データは元の並び順(offset 順)に置き、4バイト境界にそろえる。
 * 元が標準的な配置のフォントなら、元のファイルと同じバイト列になる。
 */
export function buildSfnt(font: Sfnt): Uint8Array {
  const n = font.tables.length;
  const dir = [...font.tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const physical = [...font.tables].sort((a, b) => a.offset - b.offset);
  const headerSize = 12 + n * 16;
  const total = headerSize + physical.reduce((s, t) => s + align4(t.data.length), 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = 2 ** entrySelector * 16;
  v.setUint32(0, font.flavor);
  v.setUint16(4, n);
  v.setUint16(6, searchRange);
  v.setUint16(8, entrySelector);
  v.setUint16(10, n * 16 - searchRange);
  const offsets = new Map<SfntTable, number>();
  let pos = headerSize;
  for (const t of physical) {
    out.set(t.data, pos);
    offsets.set(t, pos);
    pos += align4(t.data.length);
  }
  dir.forEach((t, i) => {
    const r = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[r + k] = t.tag.charCodeAt(k);
    v.setUint32(r + 4, t.checksum);
    v.setUint32(r + 8, offsets.get(t)!);
    v.setUint32(r + 12, t.data.length);
  });
  return out;
}
