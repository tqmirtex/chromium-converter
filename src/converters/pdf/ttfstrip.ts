/**
 * TrueType フォントから、使う文字のグリフだけを残した小さなフォントを作る。
 *
 * pdf-lib(@pdf-lib/fontkit)のサブセット機能は、Noto Sans JP などで多くの日本語のグリフが欠ける不具合がある。
 * ここではグリフの番号を振り直さず、使わないグリフの形を空にするだけにして、不具合を避ける。
 * - glyf / loca: 使うグリフ(と、それが参照する部品グリフ)だけを残す
 * - cmap: 使う文字だけの表(形式12)に作り直す
 * - post: グリフ名を持たない版(3.0)にする
 * - 文字の置き換え・位置調整(GSUB / GPOS)や縦書き用の表など、PDF の描画に使わない表は外す
 * 字幅(hmtx)はそのまま残るので、組版の結果は元のフォントと同じになる。
 */

const KEEP = new Set(['head', 'hhea', 'hmtx', 'maxp', 'OS/2', 'name', 'cvt ', 'fpgm', 'prep', 'gasp']);

interface Table {
  tag: string;
  data: Uint8Array;
}

function tag(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const n = Math.floor(data.length / 4);
  for (let i = 0; i < n; i++) sum = (sum + v.getUint32(i * 4)) >>> 0;
  const rest = data.length % 4;
  if (rest) {
    let last = 0;
    for (let i = 0; i < 4; i++) last = (last << 8) | (i < rest ? data[n * 4 + i] : 0);
    sum = (sum + (last >>> 0)) >>> 0;
  }
  return sum;
}

/** 合成グリフが参照する部品グリフの番号 */
function components(glyph: Uint8Array): number[] {
  if (glyph.length < 10) return [];
  const v = new DataView(glyph.buffer, glyph.byteOffset, glyph.byteLength);
  if (v.getInt16(0) >= 0) return [];
  const out: number[] = [];
  let p = 10;
  for (;;) {
    if (p + 4 > glyph.length) break;
    const flags = v.getUint16(p);
    out.push(v.getUint16(p + 2));
    p += 4 + (flags & 0x0001 ? 4 : 2);
    if (flags & 0x0008) p += 2;
    else if (flags & 0x0040) p += 4;
    else if (flags & 0x0080) p += 8;
    if (!(flags & 0x0020)) break;
  }
  return out;
}

function buildCmap(map: Array<[number, number]>): Uint8Array {
  map.sort((a, b) => a[0] - b[0]);
  // 連続する文字・グリフはひとまとめにする
  const groups: Array<[number, number, number]> = [];
  for (const [cp, gid] of map) {
    const g = groups[groups.length - 1];
    if (g && cp === g[1] + 1 && gid === g[2] + (cp - g[0])) g[1] = cp;
    else groups.push([cp, cp, gid]);
  }
  const subLen = 16 + groups.length * 12;
  const out = new Uint8Array(12 + subLen);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0); // version
  v.setUint16(2, 1); // numTables
  v.setUint16(4, 3); // platform: Windows
  v.setUint16(6, 10); // encoding: Unicode full
  v.setUint32(8, 12);
  v.setUint16(12, 12); // format 12
  v.setUint32(16, subLen);
  v.setUint32(20, 0);
  v.setUint32(24, groups.length);
  groups.forEach(([start, end, gid], i) => {
    const o = 28 + i * 12;
    v.setUint32(o, start);
    v.setUint32(o + 4, end);
    v.setUint32(o + 8, gid);
  });
  return out;
}

/**
 * @param font TrueType(glyf 形式)のフォント
 * @param charToGlyph 使う文字(コードポイント)と、そのグリフ番号
 */
export function stripTrueType(font: Uint8Array, charToGlyph: Map<number, number>): Uint8Array {
  const fv = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const numTables = fv.getUint16(4);
  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < numTables; i++) {
    const r = 12 + i * 16;
    const offset = fv.getUint32(r + 8);
    const length = fv.getUint32(r + 12);
    tables.set(tag(font, r), font.subarray(offset, offset + length));
  }
  const head = tables.get('head');
  const maxp = tables.get('maxp');
  const loca = tables.get('loca');
  const glyf = tables.get('glyf');
  const post = tables.get('post');
  if (!head || !maxp || !loca || !glyf) throw new Error('TrueType(glyf)形式のフォントではありません');

  const numGlyphs = new DataView(maxp.buffer, maxp.byteOffset).getUint16(4);
  const longLoca = new DataView(head.buffer, head.byteOffset).getInt16(50) === 1;
  const lv = new DataView(loca.buffer, loca.byteOffset, loca.byteLength);
  const offsetOf = (g: number): number => (longLoca ? lv.getUint32(g * 4) : lv.getUint16(g * 2) * 2);
  const glyphData = (g: number): Uint8Array => glyf.subarray(offsetOf(g), offsetOf(g + 1));

  // 使うグリフ(.notdef と、合成グリフの部品を含む)
  const keep = new Set<number>([0, ...charToGlyph.values()]);
  const stack = [...keep];
  while (stack.length) {
    const g = stack.pop()!;
    if (g >= numGlyphs) continue;
    for (const c of components(glyphData(g))) {
      if (!keep.has(c)) {
        keep.add(c);
        stack.push(c);
      }
    }
  }

  // 新しい glyf と loca(長い形式)
  let glyfSize = 0;
  for (const g of keep) if (g < numGlyphs) glyfSize += (glyphData(g).length + 3) & ~3;
  const newGlyf = new Uint8Array(glyfSize);
  const newLoca = new Uint8Array((numGlyphs + 1) * 4);
  const nl = new DataView(newLoca.buffer);
  let pos = 0;
  for (let g = 0; g < numGlyphs; g++) {
    nl.setUint32(g * 4, pos);
    if (keep.has(g)) {
      const d = glyphData(g);
      newGlyf.set(d, pos);
      pos += (d.length + 3) & ~3;
    }
  }
  nl.setUint32(numGlyphs * 4, pos);

  const newHead = head.slice();
  const hv = new DataView(newHead.buffer);
  hv.setInt16(50, 1); // indexToLocFormat = 長い形式
  hv.setUint32(8, 0); // checkSumAdjustment は最後に計算する

  const out: Table[] = [];
  for (const [t, data] of tables) if (KEEP.has(t) && t !== 'head') out.push({ tag: t, data });
  out.push({ tag: 'head', data: newHead });
  out.push({ tag: 'glyf', data: newGlyf });
  out.push({ tag: 'loca', data: newLoca });
  out.push({ tag: 'cmap', data: buildCmap([...charToGlyph.entries()]) });
  if (post && post.length >= 32) {
    const newPost = post.slice(0, 32);
    new DataView(newPost.buffer).setUint32(0, 0x00030000);
    out.push({ tag: 'post', data: newPost });
  }
  out.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  // フォントファイルとして書き出す
  const n = out.length;
  const headerSize = 12 + n * 16;
  let total = headerSize;
  for (const t of out) total += (t.data.length + 3) & ~3;
  const result = new Uint8Array(total);
  const rv = new DataView(result.buffer);
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = 2 ** entrySelector * 16;
  rv.setUint32(0, 0x00010000);
  rv.setUint16(4, n);
  rv.setUint16(6, searchRange);
  rv.setUint16(8, entrySelector);
  rv.setUint16(10, n * 16 - searchRange);
  let offset = headerSize;
  let headOffset = 0;
  out.forEach((t, i) => {
    const r = 12 + i * 16;
    for (let k = 0; k < 4; k++) result[r + k] = t.tag.charCodeAt(k);
    rv.setUint32(r + 4, checksum(t.data));
    rv.setUint32(r + 8, offset);
    rv.setUint32(r + 12, t.data.length);
    result.set(t.data, offset);
    if (t.tag === 'head') headOffset = offset;
    offset += (t.data.length + 3) & ~3;
  });
  rv.setUint32(headOffset + 8, (0xb1b0afba - checksum(result)) >>> 0);
  return result;
}
