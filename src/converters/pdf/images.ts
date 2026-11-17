import { PDFDocument, degrees, type PDFImage } from 'pdf-lib';
import { baseName } from '../../core/filename';
import { MAX_IMAGE_PIXELS } from '../../core/limits';
import { ConvertError, type ConvertContext, type ConvertInput, type ConvertResult } from '../../core/types';
import { DEFAULT_DPI, jpegInfo, pngDpi } from './imageinfo';

/**
 * 画像 → PDF。画像は可能な限り元のデータのまま埋め込む。
 * - JPEG: 再圧縮せず、そのまま埋め込む(Exif の向きは PDF 上で回転して反映する)
 * - PNG: 画素は劣化させずに(可逆圧縮で)埋め込む。透過は保つ
 * - WebP: PDF が WebP を扱えないため、一度展開して可逆圧縮で埋め込む(さらに劣化はしない)
 * ページの大きさは、画像のピクセル数と解像度(dpi)から決め、画像がページいっぱいに収まる。
 */

const pdfMeta = (doc: PDFDocument, title: string): void => {
  doc.setTitle(title);
  doc.setCreator('ファイル変換');
  doc.setProducer('ファイル変換');
};

async function bitmapToPng(blob: Blob): Promise<Uint8Array> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new ConvertError('画像を読み込めませんでした。ファイルが壊れている可能性があります');
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

interface Embedded {
  image: PDFImage;
  dpi: number;
  /** 1(そのまま)/ 3(180°)/ 6(時計回りに90°)/ 8(反時計回りに90°) */
  orientation: 1 | 3 | 6 | 8;
}

async function embed(doc: PDFDocument, input: ConvertInput): Promise<Embedded> {
  const bytes = new Uint8Array(await input.blob.arrayBuffer());
  try {
    if (input.format === 'jpeg') {
      const info = jpegInfo(bytes);
      const dpi = info.dpi ?? DEFAULT_DPI;
      if ([1, 3, 6, 8].includes(info.orientation)) {
        return { image: await doc.embedJpg(bytes), dpi, orientation: info.orientation as Embedded['orientation'] };
      }
      // 鏡像反転を含む向き(まれ)は PDF の回転だけでは表せないので、向きを反映した画像を可逆圧縮で埋め込む
      return { image: await doc.embedPng(await bitmapToPng(input.blob)), dpi, orientation: 1 };
    }
    if (input.format === 'png') {
      return { image: await doc.embedPng(bytes), dpi: pngDpi(bytes) ?? DEFAULT_DPI, orientation: 1 };
    }
    return { image: await doc.embedPng(await bitmapToPng(input.blob)), dpi: DEFAULT_DPI, orientation: 1 };
  } catch (error) {
    if (error instanceof ConvertError) throw error;
    throw new ConvertError('画像を読み込めませんでした。ファイルが壊れている可能性があります');
  }
}

async function addImagePage(doc: PDFDocument, input: ConvertInput): Promise<void> {
  const { image, dpi, orientation } = await embed(doc, input);
  if (image.width * image.height > MAX_IMAGE_PIXELS) {
    throw new ConvertError(`画像が大きすぎます(${image.width}×${image.height})`);
  }
  const s = 72 / dpi;
  const w = image.width * s;
  const h = image.height * s;
  const sideways = orientation === 6 || orientation === 8;
  const page = doc.addPage(sideways ? [h, w] : [w, h]);
  // pdf-lib の rotate は、配置点(画像の左下)を中心に反時計回りに回す
  switch (orientation) {
    case 1:
      page.drawImage(image, { x: 0, y: 0, width: w, height: h });
      break;
    case 3:
      page.drawImage(image, { x: w, y: h, width: w, height: h, rotate: degrees(180) });
      break;
    case 6:
      page.drawImage(image, { x: 0, y: w, width: w, height: h, rotate: degrees(-90) });
      break;
    case 8:
      page.drawImage(image, { x: h, y: 0, width: w, height: h, rotate: degrees(90) });
      break;
  }
}

async function save(doc: PDFDocument): Promise<Blob> {
  const bytes = await doc.save();
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}

/** 画像1枚 → 1ページの PDF */
export async function imageToPdf(input: ConvertInput, ctx: ConvertContext): Promise<ConvertResult> {
  const doc = await PDFDocument.create();
  pdfMeta(doc, baseName(input.name));
  ctx.progress(0.2);
  await addImagePage(doc, input);
  ctx.progress(0.8);
  return { outputs: [{ name: `${baseName(input.name)}.pdf`, blob: await save(doc) }], notes: [] };
}

/** 複数の画像 → 1つの PDF(並びは入力の順)。読み込めない画像は飛ばして、残りでまとめる。 */
export async function imagesToPdf(inputs: ConvertInput[], ctx: ConvertContext): Promise<ConvertResult> {
  if (inputs.length === 0) throw new ConvertError('まとめる画像がありません');
  const doc = await PDFDocument.create();
  pdfMeta(doc, baseName(inputs[0].name));
  const failed: Array<{ index: number; message: string }> = [];
  for (let i = 0; i < inputs.length; i++) {
    ctx.progress(i / inputs.length, `${i + 1} / ${inputs.length} 枚目`);
    try {
      await addImagePage(doc, inputs[i]);
    } catch (error) {
      failed.push({ index: i, message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (failed.length === inputs.length) {
    throw new ConvertError('どの画像も読み込めなかったため、PDFを作れませんでした');
  }
  const notes = [`${inputs.length - failed.length}枚の画像を1つのPDFにまとめました`];
  if (failed.length > 0) notes.push(`読み込めなかった${failed.length}枚は含めていません`);
  // 結合した PDF の名前は、最初のファイルの名前に .pdf を付ける
  return {
    outputs: [{ name: `${baseName(inputs[0].name)}.pdf`, blob: await save(doc) }],
    notes,
    failed,
  };
}
