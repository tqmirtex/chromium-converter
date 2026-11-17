import { ascii } from '../../core/bytes';
import { ConvertError } from '../../core/types';
import type { Sfnt, SfntTable } from './sfnt';

/**
 * WOFF2 の読み書き(仕様: https://www.w3.org/TR/WOFF2/)。
 *
 * 既存の WOFF2 ライブラリ(Emscripten の embind 製)は実行時に new Function を使い、拡張機能の CSP で動かないため自前で実装した。
 * 圧縮・展開には brotli-wasm(wasm-bindgen 製で eval を使わない)を使う。
 * - 書き出し: glyf / loca は「変換なし」(transform version 3)で格納する。表のデータは元とまったく同じに戻る。
 *   そのぶん、Google の woff2 ツール(glyf を変換して格納する)より数%大きくなることがある。
 * - 読み込み: 一般的な WOFF2 が使う glyf / loca の変換形式と、hmtx の変換形式を組み立て直す。
 */

const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ',
  'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS',
  'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc',
  'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

const broken = (detail?: string): ConvertError =>
  new ConvertError(`WOFF2 ファイルを読み取れませんでした。ファイルが壊れている可能性があります${detail ? `(${detail})` : ''}`);

async function brotli(): Promise<{ compress(b: Uint8Array, o?: { quality?: number }): Uint8Array; decompress(b: Uint8Array): Uint8Array }> {
  return (await import('brotli-wasm')).default;
}

const align4 = (n: number): number => (n + 3) & ~3;

// ---------- 読み取り・書き込みの道具 ----------

class Reader {
  private v: DataView;
  pos = 0;
  constructor(readonly b: Uint8Array) {
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  private need(n: number): void {
    if (this.pos + n > this.b.length) throw broken('データが途中で終わっています');
  }
  u8(): number {
    this.need(1);
    return this.b[this.pos++];
  }
  u16(): number {
    this.need(2);
    const x = this.v.getUint16(this.pos);
    this.pos += 2;
    return x;
  }
  i16(): number {
    this.need(2);
    const x = this.v.getInt16(this.pos);
    this.pos += 2;
    return x;
  }
  u32(): number {
    this.need(4);
    const x = this.v.getUint32(this.pos);
    this.pos += 4;
    return x;
  }
  bytes(n: number): Uint8Array {
    this.need(n);
    const x = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return x;
  }
  /** UIntBase128(可変長の整数) */
  base128(): number {
    let n = 0;
    for (let i = 0; i < 5; i++) {
      const c = this.u8();
      if (i === 0 && c === 0x80) throw broken('不正な数値');
      if (n & 0xfe000000) throw broken('不正な数値');
      n = (n << 7) | (c & 0x7f);
      if (!(c & 0x80)) return n >>> 0;
    }
    throw broken('不正な数値');
  }
  /** 255UInt16 */
  u255(): number {
    const c = this.u8();
    if (c === 253) return this.u16();
    if (c === 255) return this.u8() + 253;
    if (c === 254) return this.u8() + 506;
    return c;
  }
}

function base128Bytes(n: number): number[] {
  const out = [n & 0x7f];
  n >>>= 7;
  while (n > 0) {
    out.unshift((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  return out;
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  const n = data.length;
  for (let i = 0; i < n; i += 4) {
    sum = (sum + (((data[i] << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0)) >>> 0)) >>> 0;
  }
  return sum;
}

/** 表のチェックサム。head は、全体の補正値(8〜11バイト目)を 0 とみなして計算する */
function tableChecksum(tag: string, data: Uint8Array): number {
  if (tag !== 'head' || data.length < 12) return checksum(data);
  const copy = data.slice();
  copy.fill(0, 8, 12);
  return checksum(copy);
}

class Writer {
  buf = new Uint8Array(1024);
  len = 0;
  private grow(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  u8(x: number): void {
    this.grow(1);
    this.buf[this.len++] = x & 255;
  }
  u16(x: number): void {
    this.grow(2);
    this.buf[this.len++] = (x >> 8) & 255;
    this.buf[this.len++] = x & 255;
  }
  bytes(b: Uint8Array): void {
    this.grow(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  pad4(): void {
    while (this.len & 3) this.u8(0);
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

// ---------- 書き出し ----------

export async function encodeWoff2(font: Sfnt): Promise<Uint8Array> {
  // 目録はタグ順。ただし loca は glyf のすぐ後に置く(仕様の求め)
  const tables = [...font.tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const loca = tables.findIndex((t) => t.tag === 'loca');
  if (loca >= 0) {
    const [l] = tables.splice(loca, 1);
    tables.splice(tables.findIndex((t) => t.tag === 'glyf') + 1, 0, l);
  }
  const dir: number[] = [];
  for (const t of tables) {
    const idx = KNOWN_TAGS.indexOf(t.tag);
    // glyf / loca の transform version 3 は「変換なし」。それ以外の表は version 0 が「変換なし」
    const version = t.tag === 'glyf' || t.tag === 'loca' ? 3 : 0;
    if (idx >= 0) dir.push((version << 6) | idx);
    else dir.push((version << 6) | 63, ...[...t.tag].map((c) => c.charCodeAt(0)));
    dir.push(...base128Bytes(t.data.length));
  }
  const raw = new Uint8Array(tables.reduce((s, t) => s + t.data.length, 0));
  let p = 0;
  for (const t of tables) {
    raw.set(t.data, p);
    p += t.data.length;
  }
  const compressed = (await brotli()).compress(raw, { quality: 11 });
  const headerSize = 48;
  const total = align4(headerSize + dir.length + compressed.length);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  out.set([0x77, 0x4f, 0x46, 0x32]); // wOF2
  v.setUint32(4, font.flavor);
  v.setUint32(8, total);
  v.setUint16(12, tables.length);
  v.setUint32(16, 12 + 16 * tables.length + tables.reduce((s, t) => s + align4(t.data.length), 0));
  v.setUint32(20, compressed.length);
  v.setUint16(24, 1); // majorVersion
  out.set(dir, headerSize);
  out.set(compressed, headerSize + dir.length);
  return out;
}

// ---------- 読み込み:glyf の組み立て直し ----------

/** 点の座標の差分(triplet)を読む */
function triplet(flag: number, r: Reader): [number, number] {
  const sign = (f: number, v: number): number => (f & 1 ? v : -v);
  if (flag < 10) return [0, sign(flag, ((flag & 14) << 7) + r.u8())];
  if (flag < 20) return [sign(flag, (((flag - 10) & 14) << 7) + r.u8()), 0];
  if (flag < 84) {
    const b0 = flag - 20;
    const b1 = r.u8();
    return [sign(flag, 1 + (b0 & 0x30) + (b1 >> 4)), sign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f))];
  }
  if (flag < 120) {
    const b0 = flag - 84;
    const x = r.u8();
    const y = r.u8();
    return [sign(flag, 1 + (Math.floor(b0 / 12) << 8) + x), sign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + y)];
  }
  if (flag < 124) {
    const a = r.u8();
    const b = r.u8();
    const c = r.u8();
    return [sign(flag, (a << 4) + (b >> 4)), sign(flag >> 1, ((b & 0x0f) << 8) + c)];
  }
  const a = r.u16();
  const b = r.u16();
  return [sign(flag, a), sign(flag >> 1, b)];
}

/** 単純グリフを TrueType の glyf 形式で書く */
function writeSimpleGlyph(
  w: Writer,
  endPts: number[],
  xs: number[],
  ys: number[],
  onCurve: boolean[],
  bbox: [number, number, number, number],
  instructions: Uint8Array,
  overlap: boolean,
): void {
  w.u16(endPts.length);
  for (const b of bbox) w.u16(b & 0xffff);
  for (const e of endPts) w.u16(e);
  w.u16(instructions.length);
  w.bytes(instructions);
  const flags: number[] = [];
  const xb: number[] = [];
  const yb: number[] = [];
  let px = 0;
  let py = 0;
  for (let i = 0; i < xs.length; i++) {
    let f = onCurve[i] ? 0x01 : 0;
    if (i === 0 && overlap) f |= 0x40;
    const dx = xs[i] - px;
    const dy = ys[i] - py;
    px = xs[i];
    py = ys[i];
    if (dx === 0) f |= 0x10;
    else if (dx > -256 && dx < 256) {
      f |= 0x02 | (dx > 0 ? 0x10 : 0);
      xb.push(Math.abs(dx));
    } else xb.push((dx >> 8) & 255, dx & 255);
    if (dy === 0) f |= 0x20;
    else if (dy > -256 && dy < 256) {
      f |= 0x04 | (dy > 0 ? 0x20 : 0);
      yb.push(Math.abs(dy));
    } else yb.push((dy >> 8) & 255, dy & 255);
    flags.push(f);
  }
  for (const f of flags) w.u8(f);
  for (const x of xb) w.u8(x);
  for (const y of yb) w.u8(y);
}

interface Rebuilt {
  glyf: Uint8Array;
  loca: Uint8Array;
  xMins: number[];
}

function rebuildGlyf(data: Uint8Array): Rebuilt {
  const h = new Reader(data);
  h.u16(); // reserved
  const optionFlags = h.u16();
  const numGlyphs = h.u16();
  const indexFormat = h.u16();
  const sizes = Array.from({ length: 7 }, () => h.u32());
  let pos = h.pos;
  const stream = (n: number): Reader => {
    if (pos + n > data.length) throw broken('glyf のデータが足りません');
    const r = new Reader(data.subarray(pos, pos + n));
    pos += n;
    return r;
  };
  const nContour = stream(sizes[0]);
  const nPoints = stream(sizes[1]);
  const flagS = stream(sizes[2]);
  const glyphS = stream(sizes[3]);
  const compS = stream(sizes[4]);
  const bboxAll = stream(sizes[5]);
  const instrS = stream(sizes[6]);
  const overlapBitmap = optionFlags & 1 ? stream((numGlyphs + 7) >> 3).b : null;
  const bitmapLen = ((numGlyphs + 31) >> 5) * 4;
  const bboxBitmap = bboxAll.bytes(bitmapLen);
  const hasBbox = (g: number): boolean => (bboxBitmap[g >> 3] & (0x80 >> (g & 7))) !== 0;

  const w = new Writer();
  const offsets: number[] = [];
  const xMins: number[] = [];
  for (let g = 0; g < numGlyphs; g++) {
    offsets.push(w.len);
    const n = nContour.i16();
    if (n === 0) {
      if (hasBbox(g)) throw broken('空のグリフに外接矩形があります');
      xMins.push(0);
      continue;
    }
    if (n > 0) {
      const endPts: number[] = [];
      let total = 0;
      for (let c = 0; c < n; c++) {
        total += nPoints.u255();
        endPts.push(total - 1);
      }
      const xs: number[] = [];
      const ys: number[] = [];
      const on: boolean[] = [];
      let x = 0;
      let y = 0;
      for (let i = 0; i < total; i++) {
        const f = flagS.u8();
        const [dx, dy] = triplet(f & 0x7f, glyphS);
        x += dx;
        y += dy;
        xs.push(x);
        ys.push(y);
        on.push(!(f & 0x80));
      }
      const instrLen = glyphS.u255();
      let bbox: [number, number, number, number];
      if (hasBbox(g)) bbox = [bboxAll.i16(), bboxAll.i16(), bboxAll.i16(), bboxAll.i16()];
      else bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const overlap = !!overlapBitmap && (overlapBitmap[g >> 3] & (0x80 >> (g & 7))) !== 0;
      writeSimpleGlyph(w, endPts, xs, ys, on, bbox, instrS.bytes(instrLen), overlap);
      xMins.push(bbox[0]);
    } else {
      // 合成グリフ
      if (!hasBbox(g)) throw broken('合成グリフに外接矩形がありません');
      const bbox = [bboxAll.i16(), bboxAll.i16(), bboxAll.i16(), bboxAll.i16()];
      const start = compS.pos;
      let haveInstructions = false;
      for (;;) {
        const flags = compS.u16();
        compS.u16(); // glyphIndex
        compS.bytes(flags & 0x0001 ? 4 : 2);
        if (flags & 0x0008) compS.bytes(2);
        else if (flags & 0x0040) compS.bytes(4);
        else if (flags & 0x0080) compS.bytes(8);
        if (flags & 0x0100) haveInstructions = true;
        if (!(flags & 0x0020)) break;
      }
      const comp = compS.b.subarray(start, compS.pos);
      w.u16(0xffff);
      for (const b of bbox) w.u16(b & 0xffff);
      w.bytes(comp);
      if (haveInstructions) {
        const len = glyphS.u255();
        w.u16(len);
        w.bytes(instrS.bytes(len));
      }
      xMins.push(bbox[0]);
    }
    w.pad4();
  }
  offsets.push(w.len);
  const loca = new Uint8Array(indexFormat ? (numGlyphs + 1) * 4 : (numGlyphs + 1) * 2);
  const lv = new DataView(loca.buffer);
  offsets.forEach((o, i) => (indexFormat ? lv.setUint32(i * 4, o) : lv.setUint16(i * 2, o / 2)));
  if (!indexFormat && w.len / 2 > 0xffff) throw broken('loca の形式に収まりません');
  return { glyf: w.result(), loca, xMins };
}

function rebuildHmtx(data: Uint8Array, numHMetrics: number, numGlyphs: number, xMins: number[]): Uint8Array {
  const r = new Reader(data);
  const flags = r.u8();
  const advances = Array.from({ length: numHMetrics }, () => r.u16());
  const lsbs = flags & 1 ? xMins.slice(0, numHMetrics) : Array.from({ length: numHMetrics }, () => r.i16());
  const extra = flags & 2 ? xMins.slice(numHMetrics, numGlyphs) : Array.from({ length: numGlyphs - numHMetrics }, () => r.i16());
  const w = new Writer();
  for (let i = 0; i < numHMetrics; i++) {
    w.u16(advances[i]);
    w.u16(lsbs[i] & 0xffff);
  }
  for (const l of extra) w.u16(l & 0xffff);
  return w.result();
}

// ---------- 読み込み ----------

export async function decodeWoff2(b: Uint8Array): Promise<Sfnt> {
  const r = new Reader(b);
  if (ascii(b, 0, 4) !== 'wOF2') throw broken();
  r.u32();
  const flavor = r.u32();
  if (flavor === 0x74746366) throw new ConvertError('複数のフォントをまとめたファイル(TTC)の WOFF2 には対応していません');
  r.u32(); // length
  const numTables = r.u16();
  r.u16(); // reserved
  r.u32(); // totalSfntSize
  const compressedSize = r.u32();
  r.bytes(24); // version, metadata, private
  const entries: Array<{ tag: string; version: number; origLength: number; length: number }> = [];
  for (let i = 0; i < numTables; i++) {
    const flags = r.u8();
    const idx = flags & 63;
    const version = flags >> 6;
    const tag = idx === 63 ? ascii(r.bytes(4), 0, 4) : KNOWN_TAGS[idx];
    if (!tag) throw broken('不明な表');
    const origLength = r.base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    const length = transformed ? r.base128() : origLength;
    entries.push({ tag, version, origLength, length });
  }
  let data: Uint8Array;
  try {
    data = (await brotli()).decompress(r.bytes(compressedSize));
  } catch (error) {
    if (error instanceof ConvertError) throw error;
    throw broken('圧縮データを展開できません');
  }
  const raw = new Map<string, { data: Uint8Array; version: number }>();
  let p = 0;
  for (const e of entries) {
    if (p + e.length > data.length) throw broken('表のデータが足りません');
    raw.set(e.tag, { data: data.subarray(p, p + e.length), version: e.version });
    p += e.length;
  }

  const tables = new Map<string, Uint8Array>();
  for (const [tag, t] of raw) tables.set(tag, t.data);
  let xMins: number[] = [];
  const glyf = raw.get('glyf');
  let changed = false;
  if (glyf && glyf.version === 0) {
    const rebuilt = rebuildGlyf(glyf.data);
    tables.set('glyf', rebuilt.glyf);
    tables.set('loca', rebuilt.loca);
    xMins = rebuilt.xMins;
    changed = true;
  }
  const hmtx = raw.get('hmtx');
  if (hmtx && hmtx.version === 1) {
    const hhea = tables.get('hhea');
    const maxp = tables.get('maxp');
    if (!hhea || !maxp || xMins.length === 0) throw broken('hmtx を組み立てられません');
    const numH = new DataView(hhea.buffer, hhea.byteOffset).getUint16(34);
    const numGlyphs = new DataView(maxp.buffer, maxp.byteOffset).getUint16(4);
    tables.set('hmtx', rebuildHmtx(hmtx.data, numH, numGlyphs, xMins));
    changed = true;
  }
  // 組み立て直した場合は、head のチェックサム補正値を作り直す必要があるので、いったん 0 にする
  if (changed && tables.has('head')) {
    const head = tables.get('head')!.slice();
    new DataView(head.buffer).setUint32(8, 0);
    tables.set('head', head);
  }
  const sorted = [...tables.keys()].sort();
  const out: SfntTable[] = sorted.map((tag, i) => ({ tag, data: tables.get(tag)!, checksum: tableChecksum(tag, tables.get(tag)!), offset: i }));
  return { flavor, tables: out, fixChecksum: changed };
}

/** sfnt 全体から head のチェックサム補正値を計算して書き込む */
export function fixHeadChecksum(sfnt: Uint8Array): void {
  const v = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const n = v.getUint16(4);
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    if (ascii(sfnt, r, 4) === 'head') {
      const off = v.getUint32(r + 8);
      v.setUint32(off + 8, 0);
      v.setUint32(off + 8, (0xb1b0afba - checksum(sfnt)) >>> 0);
      return;
    }
  }
}
