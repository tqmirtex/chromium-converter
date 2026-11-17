import libheifFactory from 'libheif-js/libheif-wasm/libheif-bundle.mjs';
import { ConvertError } from '../../core/types';

interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(target: ImageData, cb: (result: ImageData | null) => void): void;
  free(): void;
}
interface LibHeif {
  HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] };
}

let lib: LibHeif | undefined;

export interface DecodedHeic {
  image: ImageData;
  imageCount: number;
}

export async function decodeHeic(bytes: Uint8Array): Promise<DecodedHeic> {
  lib ??= (await libheifFactory()) as LibHeif;
  const images = new lib.HeifDecoder().decode(bytes);
  if (!images || images.length === 0) {
    throw new ConvertError('HEICの画像を読み取れませんでした。ファイルが壊れているか、対応していない内容です');
  }
  try {
    const first = images[0];
    const out = new ImageData(first.get_width(), first.get_height());
    await new Promise<void>((resolve, reject) => {
      first.display(out, (result) =>
        result ? resolve() : reject(new ConvertError('HEICの画像を展開できませんでした')),
      );
    });
    return { image: out, imageCount: images.length };
  } finally {
    for (const img of images) img.free();
  }
}
