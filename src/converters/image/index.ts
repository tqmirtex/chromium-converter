import type { Converter, FormatId, PrepareKind } from '../../core/types';

/** 画像変換の組み合わせ(README「対応する変換」の画像) */
const PAIRS: Array<[FormatId, FormatId[]]> = [
  ['webp', ['png', 'jpeg']],
  ['png', ['jpeg', 'webp', 'avif', 'ico']],
  ['jpeg', ['png', 'webp', 'avif']],
  ['avif', ['png', 'jpeg']],
  ['svg', ['png', 'jpeg', 'webp']],
  ['heic', ['jpeg', 'png']],
  ['ico', ['png']],
  ['bmp', ['png', 'jpeg']],
  ['tiff', ['png', 'jpeg']],
  ['gif', ['png', 'jpeg']],
];

const PREPARE: Partial<Record<FormatId, PrepareKind>> = {
  svg: 'rasterize-svg',
};

export const imageConverters: Converter[] = PAIRS.flatMap(([from, targets]) =>
  targets.map(
    (to): Converter => ({
      id: `${from}->${to}`,
      from,
      to,
      prepare: PREPARE[from],
      engine: 'image',
    }),
  ),
);
