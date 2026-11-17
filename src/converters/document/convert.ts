import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { parseAllDocuments, stringify as stringifyYaml } from 'yaml';
import { baseName } from '../../core/filename';
import { ConvertError, type ConvertContext, type ConvertInput, type ConvertResult, type FormatId } from '../../core/types';
import { markdownTables, markdownToHtml, markdownToText } from './markdown';
import { outputNames, textOutput } from './output';
import { parseJson, readInputText } from './read';
import { jsonToRows, parseDelimited, rowsToObjects, toDelimited, toMarkdownTable } from './table';

const CSV_FORMATS: FormatId[] = ['csv-utf8', 'csv-utf8bom', 'csv-sjis'];
const isCsv = (f: FormatId): boolean => CSV_FORMATS.includes(f);

function parseYaml(text: string): unknown {
  const docs = parseAllDocuments(text);
  const list = Array.isArray(docs) ? docs : [docs];
  for (const doc of list) {
    const err = doc.errors[0];
    if (err) {
      const line = err.linePos?.[0]?.line;
      throw new ConvertError(`YAMLの書式が正しくありません(${line ? `${line}行目: ` : ''}${err.message.split('\n')[0]})`);
    }
  }
  // 複数の文書(--- 区切り)は配列にまとめる
  const values = list.map((d) => d.toJS({ maxAliasCount: 1000 }));
  return values.length === 1 ? values[0] : values;
}

function parseTomlText(text: string): unknown {
  try {
    return parseToml(text);
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    throw new ConvertError(`TOMLの書式が正しくありません(${message})`);
  }
}

/** null の場所を「a.b[2]」の形で返す(TOML は null を表せないため) */
function findNull(v: unknown, path: string): string | null {
  if (v === null) return path || '(全体)';
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const p = findNull(v[i], `${path}[${i}]`);
      if (p) return p;
    }
  } else if (typeof v === 'object') {
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      const p = findNull(child, path ? `${path}.${k}` : k);
      if (p) return p;
    }
  }
  return null;
}

function toToml(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConvertError('TOMLにできるのは、いちばん外側がオブジェクト({ ... })のJSONだけです');
  }
  const nullAt = findNull(value, '');
  if (nullAt) {
    throw new ConvertError(`TOMLは null を表せません(「${nullAt}」が null です)。値を入れるか、項目を消してください`);
  }
  try {
    return stringifyToml(value as Record<string, unknown>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConvertError(
      /null|undefined/i.test(message)
        ? 'TOMLは null を表せません。null の項目を消すか、値を入れてください'
        : `TOMLに変換できませんでした(${message})`,
    );
  }
}

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;

export async function convert(input: ConvertInput, to: FormatId, ctx: ConvertContext): Promise<ConvertResult> {
  ctx.progress(0.05);
  const text = await readInputText(input);
  ctx.progress(0.3);
  const from = input.format;
  const single = (content: string): ConvertResult => ({
    outputs: [textOutput(content, to, outputNames(input, to, [])[0])],
    notes: [],
  });

  // ---- Markdown ----
  if (from === 'md') {
    if (to === 'html') return single(markdownToHtml(text, baseName(input.name)));
    if (to === 'txt') return single(markdownToText(text));
    if (isCsv(to)) {
      const tables = markdownTables(text);
      if (tables.length === 0) throw new ConvertError('Markdownの中に表が見つかりませんでした');
      const names = outputNames(input, to, tables.map((_, i) => `表${i + 1}`));
      return {
        outputs: tables.map((t, i) => textOutput(toDelimited(t, ','), to, names[i])),
        notes: tables.length > 1 ? [`${tables.length}個の表を、表ごとのファイルに分けました`] : [],
      };
    }
  }

  // ---- JSON / YAML / TOML ----
  if (from === 'json') {
    const value = parseJson(text);
    if (to === 'yaml') return single(stringifyYaml(value));
    if (to === 'toml') return single(toToml(value));
    if (isCsv(to)) return single(toDelimited(jsonToRows(value), ','));
  }
  if (from === 'yaml' && to === 'json') return single(json(parseYaml(text)));
  if (from === 'toml' && to === 'json') return single(json(parseTomlText(text)));

  // ---- CSV / TSV ----
  if (isCsv(from)) {
    // 文字コードだけの変換は、中身を一切変えずに書き直す
    if (isCsv(to)) return single(text);
    const rows = parseDelimited(text, ',');
    if (to === 'json') return single(json(rowsToObjects(rows)));
    if (to === 'tsv') return single(toDelimited(rows, '\t'));
    if (to === 'md-table') return single(toMarkdownTable(rows));
  }
  if (from === 'tsv' && isCsv(to)) return single(toDelimited(parseDelimited(text, '\t'), ','));

  throw new ConvertError(`${from} から ${to} への変換には対応していません`);
}
