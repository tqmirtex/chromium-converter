import { ascii } from '../../core/bytes';
import { MAX_ARCHIVE_EXPANDED_BYTES, formatBytes } from '../../core/limits';
import { ConvertError } from '../../core/types';
import { decodeName, safePath, type ArchiveEntry } from './entry';

/**
 * TAR(ustar / PAX / GNU)の読み書き。
 * 書き出しは POSIX の ustar 形式で、日本語や長い名前は PAX 拡張ヘッダー(UTF-8 の path)に入れる。
 */

const BLOCK = 512;
const broken = (): ConvertError => new ConvertError('TAR ファイルを読み取れませんでした。ファイルが壊れている可能性があります');

function readOctal(b: Uint8Array, offset: number, length: number): number {
  // 先頭ビットが立っていれば base-256(大きな値)
  if (b[offset] & 0x80) {
    let n = 0;
    for (let i = 1; i < length; i++) n = n * 256 + b[offset + i];
    return n;
  }
  const s = ascii(b, offset, length).replace(/[\u0000 ]+$/g, '').trim();
  return s ? parseInt(s, 8) : 0;
}

function cString(b: Uint8Array, offset: number, length: number): Uint8Array {
  const sub = b.subarray(offset, offset + length);
  const end = sub.indexOf(0);
  return end >= 0 ? sub.subarray(0, end) : sub;
}

function parsePax(data: Uint8Array): Map<string, string> {
  const text = new TextDecoder('utf-8').decode(data);
  const out = new Map<string, string>();
  let p = 0;
  while (p < text.length) {
    const sp = text.indexOf(' ', p);
    if (sp < 0) break;
    const len = parseInt(text.slice(p, sp), 10);
    if (!len) break;
    // len はバイト数なので、UTF-8 として切り出す
    const recordBytes = new TextEncoder().encode(text.slice(p)).subarray(0, len);
    const record = new TextDecoder().decode(recordBytes);
    const eq = record.indexOf('=');
    if (eq > 0) out.set(record.slice(record.indexOf(' ') + 1, eq), record.slice(eq + 1).replace(/\n$/, ''));
    p += record.length;
  }
  return out;
}

export interface TarReadResult {
  entries: ArchiveEntry[];
  /** 扱えなかった項目(シンボリックリンクなど)の数 */
  skipped: number;
}

export function readTar(b: Uint8Array): TarReadResult {
  const entries: ArchiveEntry[] = [];
  let p = 0;
  let skipped = 0;
  let total = 0;
  let pax: Map<string, string> | null = null;
  let longName: string | null = null;
  while (p + BLOCK <= b.length) {
    const h = b.subarray(p, p + BLOCK);
    if (h.every((x) => x === 0)) break; // 終わり
    const sum = readOctal(h, 148, 8);
    let check = 0;
    for (let i = 0; i < BLOCK; i++) check += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== check) throw broken();
    const type = String.fromCharCode(h[156] || 48);
    let size = readOctal(h, 124, 12);
    if (pax?.has('size')) size = Number(pax.get('size'));
    const dataStart = p + BLOCK;
    if (dataStart + size > b.length) throw broken();
    const data = b.subarray(dataStart, dataStart + size);
    p = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'x') {
      pax = parsePax(data);
      continue;
    }
    if (type === 'g') continue; // 全体の拡張ヘッダーは使わない
    if (type === 'L') {
      longName = decodeName(cString(data, 0, data.length), false);
      continue;
    }
    if (type === 'K') continue;

    const isUstar = ascii(h, 257, 5) === 'ustar';
    let name = decodeName(cString(h, 0, 100), false);
    if (isUstar) {
      const prefix = decodeName(cString(h, 345, 155), false);
      if (prefix) name = `${prefix}/${name}`;
    }
    if (longName) name = longName;
    if (pax?.has('path')) name = pax.get('path')!;
    const mtimeSec = pax?.has('mtime') ? Number(pax.get('mtime')) : readOctal(h, 136, 12);
    pax = null;
    longName = null;

    if (type === '0' || type === '7' || type === '5') {
      const dir = type === '5' || name.endsWith('/');
      const path = safePath(dir && !name.endsWith('/') ? `${name}/` : name);
      total += size;
      if (total > MAX_ARCHIVE_EXPANDED_BYTES) {
        throw new ConvertError(`中身の合計が上限(${formatBytes(MAX_ARCHIVE_EXPANDED_BYTES)})を超えるため変換できません`);
      }
      entries.push({ path, dir, data: dir ? new Uint8Array(0) : data.slice(), mtime: new Date(mtimeSec * 1000) });
    } else {
      // シンボリックリンク・ハードリンク・デバイスなどは ZIP で表せないので含めない
      safePath(name);
      skipped++;
    }
  }
  return { entries, skipped };
}

// ---------- 書き出し ----------

const enc = new TextEncoder();

function writeOctal(h: Uint8Array, offset: number, length: number, value: number): void {
  const s = Math.floor(value).toString(8).padStart(length - 1, '0');
  h.set(enc.encode(s.slice(-(length - 1))), offset);
  h[offset + length - 1] = 0;
}

function header(name: string, size: number, mtime: number, type: string, mode: number): Uint8Array {
  const h = new Uint8Array(BLOCK);
  h.set(enc.encode(name).subarray(0, 100), 0);
  writeOctal(h, 100, 8, mode);
  writeOctal(h, 108, 8, 0);
  writeOctal(h, 116, 8, 0);
  writeOctal(h, 124, 12, size);
  writeOctal(h, 136, 12, mtime);
  h.fill(32, 148, 156);
  h[156] = type.charCodeAt(0);
  h.set(enc.encode('ustar\u0000'), 257);
  h.set(enc.encode('00'), 263);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i];
  h.set(enc.encode(sum.toString(8).padStart(6, '0')), 148);
  h[154] = 0;
  h[155] = 32;
  return h;
}

/** PAX の1行(「長さ キー=値\n」。長さは行全体のバイト数で、長さの桁数自身も含む) */
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  const bodyLen = enc.encode(body).length;
  let digits = 1;
  while (String(bodyLen + digits).length !== digits) digits++;
  return `${bodyLen + digits}${body}`;
}

/** TAR の見出し(先頭 512 バイト)として正しいか */
export function isTarHeader(b: Uint8Array): boolean {
  if (b.length < BLOCK) return false;
  const h = b.subarray(0, BLOCK);
  if (h.every((x) => x === 0)) return true; // 空の TAR
  let check = 0;
  for (let i = 0; i < BLOCK; i++) check += i >= 148 && i < 156 ? 32 : h[i];
  return readOctal(h, 148, 8) === check;
}

/** ustar の名前欄(100 バイト、ASCII)に収まるか */
const fitsUstar = (name: string): boolean => /^[\x20-\x7e]*$/.test(name) && name.length <= 100;

export function writeTar(entries: ArchiveEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const e of entries) {
    const name = e.dir && !e.path.endsWith('/') ? `${e.path}/` : e.path;
    const mtime = Math.max(0, Math.floor(e.mtime.getTime() / 1000));
    const size = e.dir ? 0 : e.data.length;
    if (!fitsUstar(name)) {
      // 日本語・長い名前は PAX 拡張ヘッダーに UTF-8 で入れる(ustar の欄には ASCII の代わりの名前)
      const record = enc.encode(paxRecord('path', name));
      parts.push(header(`PaxHeader/${mtime}`, record.length, mtime, 'x', 0o644), record, new Uint8Array((BLOCK - (record.length % BLOCK)) % BLOCK));
    }
    const fallback = fitsUstar(name) ? name : name.replace(/[^\x20-\x7e]/g, '_').slice(-100);
    parts.push(header(fallback, size, mtime, e.dir ? '5' : '0', e.dir ? 0o755 : 0o644));
    if (!e.dir) {
      parts.push(e.data, new Uint8Array((BLOCK - (size % BLOCK)) % BLOCK));
    }
  }
  // 終わりの印(512 バイトの 0 が2つ)。全体を 10240 バイト単位にそろえる
  let total = parts.reduce((n, x) => n + x.length, 0) + BLOCK * 2;
  total = Math.ceil(total / 10240) * 10240;
  const out = new Uint8Array(total);
  let o = 0;
  for (const x of parts) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}
