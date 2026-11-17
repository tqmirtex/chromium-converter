import { ConvertError, type ConvertContext, type ConvertInput, type ConvertResult, type FormatId } from '../../core/types';

/** PDF エンジン。使う変換の実装だけを読み込む(pdf.js・pdf-lib・日本語フォントはそれぞれ重いため) */
export async function convert(input: ConvertInput, to: FormatId, ctx: ConvertContext): Promise<ConvertResult> {
  if (to === 'pdf' && ['png', 'jpeg', 'webp'].includes(input.format)) {
    return (await import('./images')).imageToPdf(input, ctx);
  }
  if (to === 'pdf' && input.format === 'md') return (await import('./markdown')).markdownToPdf(input, ctx);
  if (input.format === 'pdf' && (to === 'png' || to === 'jpeg')) return (await import('./pdfjs')).pdfToImages(input, to, ctx);
  if (input.format === 'pdf' && to === 'txt') return (await import('./pdfjs')).pdfToText(input, ctx);
  throw new ConvertError(`${input.format} から ${to} への変換には対応していません`);
}

export async function convertMany(inputs: ConvertInput[], to: FormatId, ctx: ConvertContext): Promise<ConvertResult> {
  if (to !== 'pdf') throw new ConvertError(`${to} へまとめる変換には対応していません`);
  return (await import('./images')).imagesToPdf(inputs, ctx);
}
