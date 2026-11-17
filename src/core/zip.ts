import { zipSync, type Zippable } from 'fflate';
import { uniqueNames } from './filename';
import type { ConvertOutput } from './types';

/** すでに圧縮されている形式。ZIP では圧縮せず格納だけする(時間の無駄を省く) */
const STORED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'ico', 'zip', 'gz', 'pdf', 'mp3', 'mp4', 'm4a', 'webm', 'ogg', 'woff', 'woff2']);

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * 変換結果を1つの ZIP にまとめる。
 * 日本語などのファイル名は UTF-8 で書き、fflate が UTF-8 フラグ(汎用フラグの bit 11)を立てる。
 * 同じ名前が重なったときは「名前 (1).拡張子」のように番号を付ける。
 */
export async function createZip(files: ConvertOutput[]): Promise<Blob> {
  const names = uniqueNames(files.map((f) => f.name));
  const entries: Zippable = {};
  const mtime = new Date();
  for (let i = 0; i < files.length; i++) {
    const data = new Uint8Array(await files[i].blob.arrayBuffer());
    const level = STORED_EXTENSIONS.has(extensionOf(names[i])) ? 0 : 6;
    entries[names[i]] = [data, { level, mtime }];
  }
  const zipped = zipSync(entries);
  return new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}
