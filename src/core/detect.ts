import { FORMATS } from './formats';
import type { FormatId } from './types';

/** 判定に読む先頭バイト数(SVG の前置きや、CSV の文字コード判定のため多めに読む) */
const HEAD_BYTES = 64 * 1024;

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * 形式を判定する。
 * 1. 中身(先頭バイト)で判定できる形式を最優先する。拡張子・MIME タイプと食い違っても中身を採る。
 * 2. 中身だけでは決まらないテキスト形式は、拡張子・MIME タイプ(CSV は文字コードも)で判定する。
 * 判定できなければ null(未対応の形式)。
 */
export async function detectFormat(file: Blob, name: string): Promise<FormatId | null> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const complete = file.size <= HEAD_BYTES;
  const ext = extensionOf(name);
  const inputs = FORMATS.filter((f) => !f.outputOnly);
  for (const f of inputs) {
    if (f.sniff?.(head, ext)) return f.id;
  }
  const mime = file.type;
  for (const f of inputs) {
    if (f.sniff && !f.textMatch) continue;
    if (f.textMatch) {
      if (f.textMatch(head, ext, complete)) return f.id;
      continue;
    }
    if (f.extensions.includes(ext) || (!ext && mime && f.mime === mime)) return f.id;
  }
  return null;
}
