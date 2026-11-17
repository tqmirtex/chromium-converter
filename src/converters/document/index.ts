import type { Converter, EngineId, FormatId } from '../../core/types';

const CSV: FormatId[] = ['csv-utf8', 'csv-utf8bom', 'csv-sjis'];

interface Pair {
  from: FormatId;
  to: FormatId[];
  engine: EngineId;
  multiOutput?: boolean;
  usage?: Partial<Record<FormatId, string>>;
}

/** ドキュメント・テキスト・表計算・データの変換 */
const PAIRS: Pair[] = [
  // Markdown(表を CSV に取り出す変換は「CSV ⇔ Markdownテーブル」の逆方向)
  {
    from: 'md',
    to: ['html', 'txt'],
    engine: 'text',
    usage: { html: 'ブラウザで開ける見た目つきの文書(1ファイルで完結)' },
  },
  {
    // 表が複数あれば1表1ファイル
    from: 'md',
    to: CSV,
    engine: 'text',
    multiOutput: true,
    usage: {
      'csv-utf8': '文書の中の表をCSVで取り出す',
      'csv-utf8bom': '文書の中の表を、Excelで開けるCSVで取り出す',
      'csv-sjis': '文書の中の表を、古いExcel向けのCSVで取り出す',
    },
  },
  { from: 'html', to: ['md', 'txt'], engine: 'html' },
  // JSON / YAML / TOML
  { from: 'json', to: ['yaml', 'toml', ...CSV, 'xlsx'], engine: 'text' },
  { from: 'yaml', to: ['json'], engine: 'text' },
  { from: 'toml', to: ['json'], engine: 'text' },
  // CSV(文字コードの相互変換と、JSON / TSV / Markdownテーブル / Excel)
  ...CSV.map((from): Pair => ({ from, to: [...CSV.filter((c) => c !== from), 'json', 'tsv', 'md-table'], engine: 'text' })),
  ...CSV.map((from): Pair => ({ from, to: ['xlsx'], engine: 'sheet' })),
  { from: 'tsv', to: CSV, engine: 'text' },
  { from: 'tsv', to: ['xlsx'], engine: 'sheet' },
  // Excel(シートが複数あれば1シート1ファイル)
  { from: 'xlsx', to: [...CSV, 'tsv', 'json'], engine: 'sheet', multiOutput: true },
  { from: 'xls', to: [...CSV, 'tsv', 'json'], engine: 'sheet', multiOutput: true },
];

// JSON → Excel は表計算エンジンで行う
const ENGINE_OVERRIDE: Record<string, EngineId> = { 'json->xlsx': 'sheet' };

export const documentConverters: Converter[] = PAIRS.flatMap((p) =>
  p.to.map((to): Converter => {
    const id = `${p.from}->${to}`;
    return {
      id,
      from: p.from,
      to,
      engine: ENGINE_OVERRIDE[id] ?? p.engine,
      multiOutput: p.multiOutput,
      usage: p.usage?.[to],
    };
  }),
);
