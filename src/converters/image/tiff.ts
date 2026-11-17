import UTIF from 'utif2';
import { ConvertError } from '../../core/types';

export interface DecodedTiff {
  image: ImageData;
  pageCount: number;
}

export function decodeTiff(bytes: Uint8Array): DecodedTiff {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const ifds = UTIF.decode(buffer);
  // NewSubfileType(254)の bit0 は縮小版(サムネイル)。ページとして数えない
  const pages = ifds.filter((ifd) => {
    const t = ifd.t254 as number[] | undefined;
    return !(t && t[0] & 1) && ifd.t256;
  });
  if (pages.length === 0) {
    throw new ConvertError('TIFFの画像を読み取れませんでした。ファイルが壊れている可能性があります');
  }
  const page = pages[0];
  UTIF.decodeImage(buffer, page);
  if (!page.width || !page.height) {
    throw new ConvertError('このTIFFの圧縮形式には対応していません');
  }
  const rgba = UTIF.toRGBA8(page);
  const image = new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), page.width, page.height);
  return { image, pageCount: pages.length };
}
