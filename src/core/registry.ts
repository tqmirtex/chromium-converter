import { archiveConverters } from '../converters/archive';
import { documentConverters } from '../converters/document';
import { fontConverters } from '../converters/font';
import { imageConverters } from '../converters/image';
import { mediaConverters } from '../converters/media';
import { pdfConverters } from '../converters/pdf';
import { formatOrder, getFormat } from './formats';
import type { Converter, FormatId } from './types';

/**
 * 全コンバーターの登録先。候補表示・変換の実行・右クリックメニューは、すべてここから作る。
 * 形式を増やすときは、コンバーターの配列をここに足すだけでよい。
 */
export const CONVERTERS: Converter[] = [...imageConverters, ...documentConverters, ...pdfConverters, ...mediaConverters, ...fontConverters, ...archiveConverters];

const byId = new Map(CONVERTERS.map((c) => [c.id, c]));

export function getConverter(id: string): Converter {
  const c = byId.get(id);
  if (!c) throw new Error(`未登録のコンバーター: ${id}`);
  return c;
}

export function findConverter(from: FormatId, to: FormatId): Converter | undefined {
  return CONVERTERS.find((c) => c.from === from && c.to === to);
}

export interface Candidate {
  to: FormatId;
  label: string;
  /** 2行で出すときの名前と補足 */
  name: string;
  variant?: string;
  usage: string;
}

/**
 * 添付された形式の組から、変換先の候補を求める。
 * - 全ファイルが変換できる形式だけ(積集合)
 * - すでにその形式のファイルは「変換不要」として、満たしたものとみなす
 * - 全ファイルがすでにその形式なら、変換するものがないので候補にしない
 */
export function candidateTargets(formats: FormatId[]): Candidate[] {
  const unique = [...new Set(formats)];
  if (unique.length === 0) return [];
  const targets = new Set(CONVERTERS.filter((c) => unique.includes(c.from)).map((c) => c.to));
  const result: Candidate[] = [];
  for (const to of targets) {
    const ok = unique.every((f) => f === to || findConverter(f, to));
    const hasWork = unique.some((f) => f !== to);
    if (!ok || !hasWork) continue;
    const fmt = getFormat(to);
    // 変換する組み合わせがすべて同じ用途文(組み合わせ固有のもの)を持つなら、それを使う
    const usages = new Set(unique.filter((f) => f !== to).map((f) => findConverter(f, to)?.usage));
    const shared = usages.size === 1 ? [...usages][0] : undefined;
    result.push({
      to,
      label: fmt.label,
      name: fmt.short?.name ?? fmt.label,
      variant: fmt.short?.variant,
      usage: shared ?? fmt.usage,
    });
  }
  return result.sort((a, b) => formatOrder(a.to) - formatOrder(b.to));
}
