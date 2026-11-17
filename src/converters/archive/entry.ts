import { ConvertError } from '../../core/types';

/** アーカイブの中の1項目 */
export interface ArchiveEntry {
  /** 「/」区切りの相対パス。フォルダは末尾が「/」 */
  path: string;
  dir: boolean;
  data: Uint8Array;
  /** 更新日時 */
  mtime: Date;
}

/**
 * パスを確かめて正規化する。
 * 「../」を含むパスや絶対パス(展開先の外にファイルを書き出せてしまうもの=パストラバーサル)は拒否する。
 */
export function safePath(raw: string): string {
  let p = raw.replace(/\\/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  const unsafe =
    p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').some((seg) => seg === '..') || p.includes('\u0000');
  if (unsafe) {
    throw new ConvertError(`安全でないパス(「${raw}」)が含まれているため、変換を中止しました(展開先の外にファイルを書き出すおそれがあります)`);
  }
  return p;
}

/** 名前のバイト列を文字にする。UTF-8 として正しくなければ Shift-JIS(日本語版 Windows の ZIP など)とみなす */
export function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder('utf-8').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

let table: Uint32Array | undefined;

export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
