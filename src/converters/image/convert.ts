import { replaceExt } from '../../core/filename';
import { getFormat } from '../../core/formats';
import { MAX_IMAGE_PIXELS } from '../../core/limits';
import { ConvertError, type ConvertContext, type ConvertInput, type ConvertResult, type FormatId } from '../../core/types';
import { isAnimated } from './inspect';

/** 劣化のない(可逆の)入力形式。WebP へはロスレスで書き出す。 */
const LOSSLESS_SOURCES: FormatId[] = ['png', 'svg', 'bmp', 'gif', 'tiff', 'ico'];
/** 非可逆形式の品質(0.95 以上。README「品質の方針」) */
const JPEG_QUALITY = 0.95;
const WEBP_LOSSY_QUALITY = 0.95;
/** AVIF の品質(0〜100)。90 は見た目で元と区別しにくい高品質の設定 */
const AVIF_QUALITY = 90;

interface Decoded {
  source: ImageBitmap | ImageData;
  width: number;
  height: number;
  notes: string[];
}

const DECODE_FAILED =
  '画像を読み込めませんでした。ファイルが壊れているか、この画像の中身に対応していません';

async function decode(input: ConvertInput, bytes: Uint8Array): Promise<Decoded> {
  const notes: string[] = [];
  switch (input.format) {
    case 'svg': {
      if (!input.bitmap) throw new ConvertError('SVGの描画に失敗しました');
      return { source: input.bitmap, width: input.bitmap.width, height: input.bitmap.height, notes };
    }
    case 'heic': {
      const { decodeHeic } = await import('./heic');
      const { image, imageCount } = await decodeHeic(bytes);
      if (imageCount > 1) notes.push(`${imageCount}枚の画像を含むため、最初の1枚を変換しました`);
      return { source: image, width: image.width, height: image.height, notes };
    }
    case 'tiff': {
      const { decodeTiff } = await import('./tiff');
      const { image, pageCount } = decodeTiff(bytes);
      if (pageCount > 1) notes.push(`${pageCount}ページのうち、最初のページを変換しました`);
      return { source: image, width: image.width, height: image.height, notes };
    }
    case 'ico': {
      const { decodeIco } = await import('./ico');
      const ico = await decodeIco(bytes);
      if (ico.entryCount > 1) notes.push(`含まれるサイズのうち最大の ${ico.width}×${ico.height} を変換しました`);
      return { source: ico.source, width: ico.width, height: ico.height, notes };
    }
    default: {
      // PNG / JPEG / WebP / AVIF / BMP / GIF はブラウザ標準のデコーダーで読む(Exif の向きも反映される)
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(input.blob);
      } catch {
        throw new ConvertError(DECODE_FAILED);
      }
      if (isAnimated(input.format, bytes)) notes.push('アニメーションの最初のフレームを変換しました');
      return { source: bitmap, width: bitmap.width, height: bitmap.height, notes };
    }
  }
}

function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const g = canvas.getContext('2d');
  if (!g) throw new ConvertError('描画の準備に失敗しました');
  return g;
}

function hasTransparency(canvas: OffscreenCanvas): boolean {
  const data = context2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return true;
  }
  return false;
}

function toCanvas(d: Decoded): OffscreenCanvas {
  const canvas = new OffscreenCanvas(d.width, d.height);
  const g = context2d(canvas);
  if (d.source instanceof ImageData) {
    g.putImageData(d.source, 0, 0);
  } else {
    g.drawImage(d.source, 0, 0);
    d.source.close();
  }
  return canvas;
}

async function canvasToBlob(canvas: OffscreenCanvas, type: string, quality?: number): Promise<Blob> {
  const blob = await canvas.convertToBlob({ type, quality });
  // 対応していない type を渡すと PNG で返ってくるので確かめる
  if (blob.type !== type) throw new ConvertError(`このブラウザは ${type} の書き出しに対応していません`);
  return blob;
}

async function encode(
  canvas: OffscreenCanvas,
  to: FormatId,
  from: FormatId,
  notes: string[],
): Promise<Blob> {
  switch (to) {
    case 'png':
      return canvasToBlob(canvas, 'image/png');
    case 'jpeg': {
      let target = canvas;
      if (hasTransparency(canvas)) {
        // JPEG は透過を持てないので白で塗りつぶす
        target = new OffscreenCanvas(canvas.width, canvas.height);
        const g = context2d(target);
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, target.width, target.height);
        g.drawImage(canvas, 0, 0);
        notes.push('透過部分を白で塗りつぶしました');
      }
      return canvasToBlob(target, 'image/jpeg', JPEG_QUALITY);
    }
    case 'webp':
      // Chrome は quality 1.0 のときロスレス WebP で書き出す
      return canvasToBlob(canvas, 'image/webp', LOSSLESS_SOURCES.includes(from) ? 1 : WEBP_LOSSY_QUALITY);
    case 'avif': {
      const { encodeAvif } = await import('./avif');
      const image = context2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
      // 図・スクリーンショット(可逆の入力)は色のにじみを避けるため 4:4:4、写真(JPEG)は 4:2:0
      return encodeAvif(image, { quality: AVIF_QUALITY, subsample: LOSSLESS_SOURCES.includes(from) ? 3 : 1 });
    }
    case 'ico': {
      const { encodeIco } = await import('./ico');
      const { blob, resized } = await encodeIco(canvas);
      if (resized) notes.push('ICOの上限に合わせて 256×256 以内に縮小しました');
      return blob;
    }
    default:
      throw new ConvertError(`${to} への変換には対応していません`);
  }
}

export async function convert(input: ConvertInput, to: FormatId, ctx: ConvertContext): Promise<ConvertResult> {
  ctx.progress(0.05);
  const bytes = new Uint8Array(await input.blob.arrayBuffer());
  const decoded = await decode(input, bytes);
  if (decoded.width * decoded.height > MAX_IMAGE_PIXELS) {
    if (!(decoded.source instanceof ImageData)) decoded.source.close();
    throw new ConvertError(
      `画像が大きすぎます(${decoded.width}×${decoded.height})。上限は ${MAX_IMAGE_PIXELS / 1_000_000} メガピクセルです`,
    );
  }
  ctx.progress(0.4);
  const canvas = toCanvas(decoded);
  const notes = [...decoded.notes];
  const blob = await encode(canvas, to, input.format, notes);
  ctx.progress(1);
  return { outputs: [{ name: replaceExt(input.name, getFormat(to).ext), blob }], notes };
}
