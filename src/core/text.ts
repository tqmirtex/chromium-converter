import { ConvertError } from './types';

/**
 * 文字コードの判定と変換。
 * 判定の方針: BOM があればそれに従う。なければ UTF-8 として正しく読めるかを先に試し、読めなければ Shift-JIS とする。
 * 日本語を含む文字列が「UTF-8 としても Shift-JIS としても正しい」ことはまずないため、UTF-8 を優先しても誤判定は起きにくい。
 * ASCII だけのファイルはどちらで読んでも同じなので UTF-8 とみなす。
 */
export type TextEncodingId = 'utf8' | 'utf8bom' | 'sjis' | 'utf16le' | 'utf16be';

function validAs(label: string, bytes: Uint8Array, complete: boolean): boolean {
  try {
    new TextDecoder(label, { fatal: true }).decode(bytes, { stream: !complete });
    return true;
  } catch {
    return false;
  }
}

/** complete=false のときは先頭部分だけを渡したとみなし、末尾で途切れた文字を許す */
export function detectEncoding(bytes: Uint8Array, complete = true): TextEncodingId | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf8bom';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf16be';
  if (validAs('utf-8', bytes, complete)) return 'utf8';
  if (validAs('shift_jis', bytes, complete)) return 'sjis';
  return null;
}

const DECODER_LABEL: Record<TextEncodingId, string> = {
  utf8: 'utf-8',
  utf8bom: 'utf-8',
  sjis: 'shift_jis',
  utf16le: 'utf-16le',
  utf16be: 'utf-16be',
};

export interface DecodedText {
  text: string;
  encoding: TextEncodingId;
}

/** テキストを読む。文字コードが判別できなければ理由付きで失敗する。 */
export function decodeText(bytes: Uint8Array): DecodedText {
  if (bytes.includes(0) && !(bytes[0] === 0xff || bytes[0] === 0xfe)) {
    throw new ConvertError('テキストファイルとして読めませんでした(バイナリファイルの可能性があります)');
  }
  const encoding = detectEncoding(bytes);
  if (!encoding) {
    throw new ConvertError('文字コードを判別できませんでした(UTF-8・Shift-JIS 以外の可能性があります)');
  }
  // TextDecoder は BOM を取り除いて返す
  const text = new TextDecoder(DECODER_LABEL[encoding]).decode(bytes);
  return { text, encoding };
}

// ---------- Shift-JIS の書き出し ----------

let sjisTable: Map<number, number> | undefined;

/**
 * ブラウザの Shift-JIS デコーダー(WHATWG の Shift_JIS = Windows-31J)から、逆引き表を作る。
 * WHATWG の符号化規則に合わせ、NEC 選定 IBM 拡張(ポインタ 8272〜8835)は、ほかに同じ文字がないときだけ使う。
 */
function buildSjisTable(): Map<number, number> {
  const table = new Map<number, number>();
  const decoder = new TextDecoder('shift_jis');
  const deferred: Array<[number, number]> = [];
  const pair = new Uint8Array(2);
  for (let lead = 0x81; lead <= 0xfc; lead++) {
    if (lead > 0x9f && lead < 0xe0) continue;
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      pair[0] = lead;
      pair[1] = trail;
      const s = decoder.decode(pair);
      if (s.length !== 1 && !(s.length === 2 && s.codePointAt(0)! > 0xffff)) continue;
      const cp = s.codePointAt(0)!;
      if (cp === 0xfffd) continue;
      const code = (lead << 8) | trail;
      const pointer = (lead - (lead < 0xa0 ? 0x81 : 0xc1)) * 188 + trail - (trail < 0x7f ? 0x40 : 0x41);
      if (pointer >= 8272 && pointer <= 8835) deferred.push([cp, code]);
      else if (!table.has(cp)) table.set(cp, code);
    }
  }
  for (const [cp, code] of deferred) if (!table.has(cp)) table.set(cp, code);
  // 半角カナ
  for (let b = 0xa1; b <= 0xdf; b++) table.set(0xff61 + (b - 0xa1), b);
  // WHATWG の規定どおり、円記号とオーバーラインは 0x5C / 0x7E に
  table.set(0x00a5, 0x5c);
  table.set(0x203e, 0x7e);
  return table;
}

/**
 * JIS(Mac など)と Windows で割り当てが違う記号を、Windows(CP932)側の文字にそろえる。
 * 例: マイナス記号 U+2212 → 全角ハイフンマイナス U+FF0D、波ダッシュ U+301C → 全角チルダ U+FF5E
 */
const SJIS_NORMALIZE: Record<number, number> = {
  0x2212: 0xff0d,
  0x301c: 0xff5e,
  0x2016: 0x2225,
  0x2014: 0x2015,
  0x00a2: 0xffe0,
  0x00a3: 0xffe1,
  0x00ac: 0xffe2,
};

function encodeSjis(text: string): Uint8Array {
  sjisTable ??= buildSjisTable();
  const out = new Uint8Array(text.length * 2);
  let n = 0;
  const bad: string[] = [];
  let line = 1;
  let firstBadLine = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x0a) line++;
    if (cp < 0x80) {
      out[n++] = cp;
      continue;
    }
    const code = sjisTable.get(SJIS_NORMALIZE[cp] ?? cp);
    if (code === undefined) {
      if (bad.length === 0) firstBadLine = line;
      if (bad.length < 3 && !bad.includes(ch)) bad.push(ch);
      continue;
    }
    if (code > 0xff) out[n++] = code >> 8;
    out[n++] = code & 0xff;
  }
  if (bad.length > 0) {
    throw new ConvertError(
      `Shift-JIS で表せない文字が含まれています(「${bad.join('」「')}」など、${firstBadLine}行目)。UTF-8 で保存してください`,
    );
  }
  return out.slice(0, n);
}

export type OutputEncoding = 'utf8' | 'utf8bom' | 'sjis';

/** テキストを指定の文字コードで書き出す。Shift-JIS で表せない文字があれば失敗にする(置き換えない)。 */
export function encodeText(text: string, encoding: OutputEncoding): Uint8Array {
  switch (encoding) {
    case 'utf8':
      return new TextEncoder().encode(text);
    case 'utf8bom': {
      const body = new TextEncoder().encode(text);
      const out = new Uint8Array(body.length + 3);
      out.set([0xef, 0xbb, 0xbf]);
      out.set(body, 3);
      return out;
    }
    case 'sjis':
      return encodeSjis(text);
  }
}
