import { baseName } from '../../core/filename';
import { getFormat } from '../../core/formats';
import { ConvertError, type ConvertContext, type ConvertInput, type ConvertResult, type FormatId } from '../../core/types';
import { buildSfnt, isCff, parseSfnt } from './sfnt';
import { decodeWoff, encodeWoff } from './woff';
import { decodeWoff2, encodeWoff2, fixHeadChecksum } from './woff2';

/**
 * フォントの変換。グリフ・メトリクス・ヒンティングなどの表は変えない。
 * - WOFF: 各表を zlib で圧縮して包むだけ(表のデータは元と同じ)
 * - WOFF2: brotli で圧縮して包む(書き出しは glyf / loca を変換しない形式なので、表のデータは元と同じ)。
 *   読み込みは、glyf / loca・hmtx を変換して格納した一般的な WOFF2 も組み立て直す(輪郭・字幅は同じ)
 */

/** 入力を sfnt(TTF / OTF のバイト列)にする */
async function toSfnt(input: ConvertInput, bytes: Uint8Array): Promise<Uint8Array> {
  switch (input.format) {
    case 'ttf':
    case 'otf':
      parseSfnt(bytes); // 壊れていないか確かめる
      return bytes;
    case 'woff':
      return buildSfnt(decodeWoff(bytes));
    case 'woff2': {
      const font = await decodeWoff2(bytes);
      const sfnt = buildSfnt(font);
      if (font.fixChecksum) fixHeadChecksum(sfnt);
      return sfnt;
    }
    default:
      throw new ConvertError(`${input.format} は読み込めません`);
  }
}

export async function convert(input: ConvertInput, to: FormatId, ctx: ConvertContext): Promise<ConvertResult> {
  ctx.progress(0.1);
  const bytes = new Uint8Array(await input.blob.arrayBuffer());
  const sfnt = await toSfnt(input, bytes);
  const font = parseSfnt(sfnt);
  ctx.progress(0.4);
  let out: Uint8Array;
  switch (to) {
    case 'woff':
      out = encodeWoff(font);
      break;
    case 'woff2':
      out = await encodeWoff2(font);
      break;
    case 'ttf':
    case 'otf': {
      // 輪郭の形式(TrueType / CFF)は変換しない。形式に合う方を選んでもらう
      const cff = isCff(font.flavor);
      if (to === 'ttf' && cff) throw new ConvertError('このフォントは CFF 形式(OpenType)です。「OTF」を選んでください');
      if (to === 'otf' && !cff) throw new ConvertError('このフォントは TrueType 形式です。「TTF」を選んでください');
      out = sfnt;
      break;
    }
    default:
      throw new ConvertError(`${to} への変換には対応していません`);
  }
  ctx.progress(0.95);
  return {
    outputs: [{ name: `${baseName(input.name)}.${getFormat(to).ext}`, blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: getFormat(to).mime }) }],
    notes: [],
  };
}
