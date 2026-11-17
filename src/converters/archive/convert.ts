import { gunzipSync, gzipSync } from 'fflate';
import { baseName } from '../../core/filename';
import { MAX_ARCHIVE_EXPANDED_BYTES, formatBytes } from '../../core/limits';
import { ConvertError, type ConvertContext, type ConvertInput, type ConvertResult, type FormatId } from '../../core/types';
import type { ArchiveEntry } from './entry';
import { isTarHeader, readTar, writeTar } from './tar';
import { readZip, writeZip } from './zip';

/**
 * アーカイブの変換(ZIP ⇔ TAR / TAR.GZ)。中身のファイル・フォルダ構成・更新日時・名前は変えない。
 * 名前の変更(拡張子だけを変える)は、外側のアーカイブのファイル名にだけ行う。
 */

/** 「資料.tar.gz」→「資料」のように、アーカイブの拡張子を外す */
function archiveBase(name: string): string {
  const m = /^(.*?)\.(tar\.gz|tgz|tar|zip|gz)$/i.exec(name);
  return m?.[1] || baseName(name);
}

function gunzip(b: Uint8Array): Uint8Array {
  // gzip の末尾にある「展開後の大きさ」で、展開前に上限を確かめる(4GB 未満のときに正確)
  if (b.length >= 18) {
    const isize = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(b.length - 4, true);
    if (isize > MAX_ARCHIVE_EXPANDED_BYTES) {
      throw new ConvertError(`展開すると ${formatBytes(isize)} になり、上限(${formatBytes(MAX_ARCHIVE_EXPANDED_BYTES)})を超えるため変換できません`);
    }
  }
  try {
    return gunzipSync(b);
  } catch {
    throw new ConvertError('gzip を展開できませんでした。ファイルが壊れている可能性があります');
  }
}

export async function convert(input: ConvertInput, to: FormatId, ctx: ConvertContext): Promise<ConvertResult> {
  ctx.progress(0.05);
  const bytes = new Uint8Array(await input.blob.arrayBuffer());
  let entries: ArchiveEntry[];
  const notes: string[] = [];
  switch (input.format) {
    case 'zip':
      entries = readZip(bytes);
      break;
    case 'tar':
    case 'tgz': {
      const tar = input.format === 'tgz' ? gunzip(bytes) : bytes;
      if (input.format === 'tgz' && !isTarHeader(tar)) {
        throw new ConvertError('gzip の中身が TAR ではありません(.tar.gz / .tgz のみ対応)');
      }
      const result = readTar(tar);
      entries = result.entries;
      if (result.skipped > 0) notes.push(`シンボリックリンクなど ZIP で表せない ${result.skipped} 項目は含めていません`);
      break;
    }
    default:
      throw new ConvertError(`${input.format} は読み込めません`);
  }
  ctx.progress(0.5);
  let out: Uint8Array;
  let ext: string;
  switch (to) {
    case 'zip':
      out = writeZip(entries);
      ext = 'zip';
      break;
    case 'tar':
      out = writeTar(entries);
      ext = 'tar';
      break;
    case 'tgz':
      out = gzipSync(writeTar(entries), { level: 6 });
      ext = 'tar.gz';
      break;
    default:
      throw new ConvertError(`${to} への変換には対応していません`);
  }
  const files = entries.filter((e) => !e.dir).length;
  const dirs = entries.length - files;
  notes.unshift(`${files}個のファイル${dirs ? `と${dirs}個のフォルダ` : ''}を変換しました`);
  return {
    outputs: [{ name: `${archiveBase(input.name)}.${ext}`, blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: to === 'zip' ? 'application/zip' : to === 'tar' ? 'application/x-tar' : 'application/gzip' }) }],
    notes,
  };
}
