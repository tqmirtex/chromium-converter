import { baseName } from '../../core/filename';
import { getFormat } from '../../core/formats';
import { encodeText, type OutputEncoding } from '../../core/text';
import type { ConvertInput, ConvertOutput, FormatId } from '../../core/types';

const OUTPUT_ENCODING: Partial<Record<FormatId, OutputEncoding>> = {
  'csv-utf8bom': 'utf8bom',
  'csv-sjis': 'sjis',
};

const MIME_CHARSET: Record<OutputEncoding, string> = { utf8: 'utf-8', utf8bom: 'utf-8', sjis: 'shift_jis' };

/** テキストを出力ファイルにする。CSV の文字コードは出力形式から決める(ほかは UTF-8)。 */
export function textOutput(text: string, to: FormatId, name: string): ConvertOutput {
  const encoding = OUTPUT_ENCODING[to] ?? 'utf8';
  const fmt = getFormat(to);
  const bytes = encodeText(text, encoding);
  return {
    name,
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: `${fmt.mime};charset=${MIME_CHARSET[encoding]}` }),
  };
}

/** 出力ファイル名。1つなら拡張子だけを変え、複数なら「元の名前_ラベル.拡張子」にする。 */
export function outputNames(input: ConvertInput, to: FormatId, labels: string[]): string[] {
  const ext = getFormat(to).ext;
  const base = baseName(input.name);
  if (labels.length <= 1) return [`${base}.${ext}`];
  return labels.map((l) => `${base}_${l}.${ext}`);
}
