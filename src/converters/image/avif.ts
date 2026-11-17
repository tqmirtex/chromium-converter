import moduleFactory from '@jsquash/avif/codec/enc/avif_enc.js';
import { defaultOptions } from '@jsquash/avif/meta.js';
import { ConvertError } from '../../core/types';

interface AvifModule {
  encode(data: BufferSource, width: number, height: number, options: typeof defaultOptions): Uint8Array | null;
}

// 拡張機能のページは SharedArrayBuffer を使えないため、単一スレッド版のエンコーダーを直接読み込む
let modulePromise: Promise<AvifModule> | undefined;

export interface AvifOptions {
  quality: number;
  /** 1 = 4:2:0、3 = 4:4:4 */
  subsample: 1 | 3;
}

export async function encodeAvif(image: ImageData, options: AvifOptions): Promise<Blob> {
  modulePromise ??= (moduleFactory as unknown as (o: object) => Promise<AvifModule>)({ noInitialRun: true });
  const mod = await modulePromise;
  const out = mod.encode(new Uint8Array(image.data.buffer), image.width, image.height, {
    ...defaultOptions,
    quality: options.quality,
    subsample: options.subsample,
  });
  if (!out) throw new ConvertError('AVIFへの書き出しに失敗しました');
  return new Blob([out as Uint8Array<ArrayBuffer>], { type: 'image/avif' });
}
