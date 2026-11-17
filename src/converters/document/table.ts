import { ConvertError } from '../../core/types';

/** RFC 4180 に沿った区切り文字テキストの読み込み(引用符・セル内の改行に対応) */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
      i++;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\r' || c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += c;
      i++;
    }
  }
  if (quoted) throw new ConvertError('引用符(")が閉じられていない箇所があります。ファイルの書式が壊れている可能性があります');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** セルを文字列にする。オブジェクトや配列は JSON 文字列にする。 */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

/** 区切り文字テキストに書き出す(必要なセルだけ引用符で囲む。改行は CRLF) */
export function toDelimited(rows: unknown[][], delimiter: string): string {
  const needsQuote = new RegExp(`["\\r\\n${delimiter === '\t' ? '\\t' : delimiter}]|^\\s|\\s$`);
  return (
    rows
      .map((r) =>
        r
          .map((v) => {
            const s = cellText(v);
            return needsQuote.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(delimiter),
      )
      .join('\r\n') + '\r\n'
  );
}

/** 1行目を見出しとして、オブジェクトの配列にする。見出しが空・重複のときは名前を補う。 */
export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const used = new Map<string, number>();
  const header = rows[0].map((h, i) => {
    let name = h.trim() || `列${i + 1}`;
    const count = used.get(name) ?? 0;
    used.set(name, count + 1);
    if (count > 0) name = `${name}_${count + 1}`;
    return name;
  });
  const width = Math.max(...rows.map((r) => r.length));
  for (let i = header.length; i < width; i++) header.push(`列${i + 1}`);
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const SHAPE_ERROR =
  'JSONを表にできません。オブジェクトの配列([{"列名": 値, ...}, ...])か、配列の配列にしてください';

/**
 * JSON を表(1行目が見出し)にする。
 * - オブジェクトの配列: キーを登場順に並べて見出しにする
 * - 配列の配列: そのまま行にする
 * - オブジェクト1つ: 1行の表にする
 * ネストしたオブジェクト・配列は JSON 文字列としてセルに入れる。
 */
export function jsonToRows(value: unknown): unknown[][] {
  const list = Array.isArray(value) ? value : value !== null && typeof value === 'object' ? [value] : null;
  if (!list) throw new ConvertError(SHAPE_ERROR);
  if (list.length === 0) return [];
  if (list.every((v) => Array.isArray(v))) {
    return (list as unknown[][]).map((r) => r.map(flatten));
  }
  if (!list.every((v) => v !== null && typeof v === 'object' && !Array.isArray(v))) {
    throw new ConvertError(SHAPE_ERROR);
  }
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const obj of list as Record<string, unknown>[]) {
    for (const k of Object.keys(obj)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return [keys, ...(list as Record<string, unknown>[]).map((obj) => keys.map((k) => flatten(obj[k])))];
}

function flatten(v: unknown): unknown {
  if (v !== null && typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
  return v ?? null;
}

function escapeMdCell(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

/** Markdown の表(GFM)にする。1行目を見出しにする。 */
export function toMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) throw new ConvertError('表にするデータがありません');
  const width = Math.max(1, ...rows.map((r) => r.length));
  const line = (r: string[]): string =>
    `| ${Array.from({ length: width }, (_, i) => escapeMdCell(r[i] ?? '')).join(' | ')} |`;
  const [header, ...body] = rows;
  return [line(header), `| ${Array(width).fill('---').join(' | ')} |`, ...body.map(line)].join('\n') + '\n';
}
