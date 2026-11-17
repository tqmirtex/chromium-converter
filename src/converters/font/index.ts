import type { Converter, FormatId } from '../../core/types';

/** フォントの変換(TTF / OTF ⇔ WOFF / WOFF2) */
const make = (from: FormatId, to: FormatId): Converter => ({ id: `${from}->${to}`, from, to, engine: 'font' });

export const fontConverters: Converter[] = [
  ...(['ttf', 'otf'] as const).flatMap((from) => (['woff', 'woff2'] as const).map((to) => make(from, to))),
  ...(['woff', 'woff2'] as const).flatMap((from) => (['ttf', 'otf'] as const).map((to) => make(from, to))),
];
