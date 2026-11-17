import { inflateSync, zipSync, type Zippable } from 'fflate';
import { MAX_ARCHIVE_EXPANDED_BYTES, formatBytes } from '../../core/limits';
import { ConvertError } from '../../core/types';
import { crc32, decodeName, safePath, type ArchiveEntry } from './entry';

/**
 * ZIP の読み書き。
 * 読み込みは、更新日時と日本語の名前を正しく扱うため、中央ディレクトリを自前で読む。
 * - 名前: UTF-8 フラグ(bit 11)・Info-ZIP の Unicode パス(0x7075)があれば UTF-8、なければ UTF-8 / Shift-JIS を判定
 * - 更新日時: 拡張タイムスタンプ(0x5455、UTC の秒)があればそれを、なければ DOS 日時(ローカル時刻、2秒単位)
 * - ZIP64(4GB 超の項目)の大きさ・位置にも対応
 */

const broken = (): ConvertError => new ConvertError('ZIP ファイルを読み取れませんでした。ファイルが壊れている可能性があります');

function dosDate(date: number, time: number): Date {
  return new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
}

export function readZip(b: Uint8Array): ArchiveEntry[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // 末尾の EOCD(中央ディレクトリの終わり)を探す
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw broken();
  let count = v.getUint16(eocd + 10, true);
  let cdOffset = v.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || v.getUint32(loc, true) !== 0x07064b50) throw broken();
    const z64 = Number(v.getBigUint64(loc + 8, true));
    if (v.getUint32(z64, true) !== 0x06064b50) throw broken();
    count = Number(v.getBigUint64(z64 + 32, true));
    cdOffset = Number(v.getBigUint64(z64 + 48, true));
  }

  interface Record {
    name: string;
    method: number;
    flags: number;
    crc: number;
    csize: number;
    usize: number;
    local: number;
    mtime: Date;
  }
  const records: Record[] = [];
  let p = cdOffset;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || v.getUint32(p, true) !== 0x02014b50) throw broken();
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const time = v.getUint16(p + 12, true);
    const date = v.getUint16(p + 14, true);
    const crc = v.getUint32(p + 16, true);
    let csize = v.getUint32(p + 20, true);
    let usize = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    let local = v.getUint32(p + 42, true);
    const nameBytes = b.subarray(p + 46, p + 46 + nameLen);
    let name = decodeName(nameBytes, (flags & 0x800) !== 0);
    let mtime = dosDate(date, time);
    // 追加フィールド
    let e = p + 46 + nameLen;
    const end = e + extraLen;
    while (e + 4 <= end) {
      const id = v.getUint16(e, true);
      const size = v.getUint16(e + 2, true);
      const d = e + 4;
      if (id === 0x0001) {
        // ZIP64: 0xFFFFFFFF になっている値だけが、この順に入っている
        let q = d;
        if (usize === 0xffffffff) (usize = Number(v.getBigUint64(q, true))), (q += 8);
        if (csize === 0xffffffff) (csize = Number(v.getBigUint64(q, true))), (q += 8);
        if (local === 0xffffffff) local = Number(v.getBigUint64(q, true));
      } else if (id === 0x5455 && size >= 5 && b[d] & 1) {
        mtime = new Date(v.getUint32(d + 1, true) * 1000);
      } else if (id === 0x7075 && size >= 5) {
        name = new TextDecoder('utf-8').decode(b.subarray(d + 5, d + size));
      }
      e = d + size;
    }
    records.push({ name, method, flags, crc, csize, usize, local, mtime });
    total += usize;
    p = end + commentLen;
  }
  // 展開する前に、合計サイズで上限を確かめる
  if (total > MAX_ARCHIVE_EXPANDED_BYTES) {
    throw new ConvertError(`展開すると ${formatBytes(total)} になり、上限(${formatBytes(MAX_ARCHIVE_EXPANDED_BYTES)})を超えるため変換できません`);
  }

  return records.map((r) => {
    const path = safePath(r.name);
    const dir = path.endsWith('/');
    if (r.flags & 1) throw new ConvertError('パスワード付き(暗号化された)ZIP は変換できません');
    if (dir) return { path, dir, data: new Uint8Array(0), mtime: r.mtime };
    if (v.getUint32(r.local, true) !== 0x04034b50) throw broken();
    const start = r.local + 30 + v.getUint16(r.local + 26, true) + v.getUint16(r.local + 28, true);
    const raw = b.subarray(start, start + r.csize);
    let data: Uint8Array;
    if (r.method === 0) data = raw.slice();
    else if (r.method === 8) {
      try {
        data = inflateSync(raw, { out: new Uint8Array(r.usize) });
      } catch {
        throw broken();
      }
    } else {
      throw new ConvertError(`この ZIP の圧縮方式(${r.method})には対応していません(Deflate と無圧縮のみ対応)`);
    }
    if (data.length !== r.usize || crc32(data) !== r.crc) {
      throw new ConvertError(`「${r.name}」が壊れています(CRC が一致しません)`);
    }
    return { path, dir, data, mtime: r.mtime };
  });
}

/** すでに圧縮されている形式。ZIP では圧縮せずに格納する */
const STORED = /\.(png|jpe?g|gif|webp|avif|heic|zip|gz|tgz|bz2|xz|7z|rar|mp3|mp4|m4a|mov|webm|mkv|ogg|opus|flac|woff2?|pdf|docx|xlsx|pptx)$/i;

/** ZIP を書く。名前は UTF-8(フラグ付き)、更新日時は DOS 日時に加えて拡張タイムスタンプ(UTC の秒)も入れる */
export function writeZip(entries: ArchiveEntry[]): Uint8Array {
  const files: Zippable = {};
  for (const e of entries) {
    const unix = Math.max(0, Math.floor(e.mtime.getTime() / 1000));
    const ut = new Uint8Array([1, unix & 255, (unix >> 8) & 255, (unix >> 16) & 255, (unix >>> 24) & 255]);
    files[e.dir ? (e.path.endsWith('/') ? e.path : `${e.path}/`) : e.path] = [
      e.data,
      { mtime: e.mtime, level: e.dir || STORED.test(e.path) ? 0 : 6, extra: { 0x5455: ut } },
    ];
  }
  return zipSync(files);
}
