import * as XLSX from 'xlsx';
import { baseName } from '../../core/filename';
import { ConvertError, type ConvertContext, type ConvertInput, type ConvertResult, type FormatId } from '../../core/types';
import { outputNames, textOutput } from './output';
import { parseJson, readInputText } from './read';
import { jsonToRows, parseDelimited, toDelimited } from './table';

/**
 * Excel(.xlsx / .xls)の読み書き。SheetJS 0.20.3(既知の脆弱性 CVE-2023-30533・CVE-2024-22363 の修正版)を使う。
 * - Excel → CSV / TSV / JSON: シートごとに1ファイル。数式は計算結果の値になる。
 * - CSV / TSV / JSON → Excel: 1シート。
 */

const CSV_FORMATS: FormatId[] = ['csv-utf8', 'csv-utf8bom', 'csv-sjis'];

const pad = (n: number): string => String(n).padStart(2, '0');

/** 日付セルは「2026-11-17」または「2026-11-17 10:30:00」の文字列にする */
function dateText(d: Date): string {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) return date;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function hasFormula(ws: XLSX.WorkSheet): boolean {
  for (const key of Object.keys(ws)) {
    if (key[0] === '!') continue;
    if ((ws[key] as XLSX.CellObject).f) return true;
  }
  return false;
}

function readWorkbook(bytes: Uint8Array): XLSX.WorkBook {
  try {
    // 日付の既定書式(Excel の「短い日付」)は、地域によらず 2026-11-17 の形で書き出す
    return XLSX.read(bytes, { type: 'array', cellDates: true, cellFormula: true, dense: false, dateNF: 'yyyy-mm-dd' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 暗号化された Excel は ZIP ではなく複合ドキュメント形式になる
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (!isZip && /password|encrypt/i.test(message)) {
      throw new ConvertError('パスワードで保護されたExcelファイルは読み込めません');
    }
    throw new ConvertError(`Excelファイルを読み込めませんでした。ファイルが壊れている可能性があります(${message})`);
  }
}

async function fromExcel(input: ConvertInput, to: FormatId, ctx: ConvertContext): Promise<ConvertResult> {
  const wb = readWorkbook(new Uint8Array(await input.blob.arrayBuffer()));
  ctx.progress(0.5);
  const sheets = wb.SheetNames.map((name) => ({ name, ws: wb.Sheets[name] }))
    .filter((s) => s.ws && s.ws['!ref'])
    .map((s) => ({
      ...s,
      // セルの表示どおりの文字(書式を反映した値)
      rows: XLSX.utils.sheet_to_json<string[]>(s.ws, { header: 1, raw: false, defval: '', blankrows: true }),
    }))
    .filter((s) => s.rows.some((r) => r.some((v) => v !== '')));
  if (sheets.length === 0) throw new ConvertError('Excelファイルにデータの入ったシートがありません');
  const notes: string[] = [];
  const skipped = wb.SheetNames.length - sheets.length;
  if (sheets.length > 1) notes.push(`${sheets.length}枚のシートを、シートごとのファイルに分けました`);
  if (skipped > 0) notes.push(`空のシート${skipped}枚は出力していません`);
  if (sheets.some((s) => hasFormula(s.ws))) notes.push('数式は計算結果の値で出力しました');

  const names = outputNames(input, to, sheets.map((s) => s.name));
  const outputs = sheets.map(({ ws, rows: displayRows }, i) => {
    let text: string;
    if (to === 'json') {
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true });
      const normalized = rows.map((r) =>
        Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? dateText(v) : v])),
      );
      text = `${JSON.stringify(normalized, null, 2)}\n`;
    } else {
      // セル内の改行・区切り文字を正しく引用符で囲むため、共通の書き出しを使う
      text = toDelimited(displayRows, to === 'tsv' ? '\t' : ',');
    }
    return textOutput(text, to, names[i]);
  });
  return { outputs, notes };
}

/** 数字だけの文字列は数値にする(先頭が 0 の番号や長すぎる桁は文字のまま。電話番号・郵便番号などを壊さないため) */
function inferCell(s: string): string | number {
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(s) && s.replace(/[-.]/g, '').length <= 15) return Number(s);
  return s;
}

function sheetNameFor(name: string): string {
  // シート名に使えない文字を除き、31文字までにする
  return baseName(name).replace(/[[\]:*?/\\]/g, '_').slice(0, 31) || 'Sheet1';
}

async function toExcel(input: ConvertInput, ctx: ConvertContext): Promise<ConvertResult> {
  const text = await readInputText(input);
  let rows: unknown[][];
  if (input.format === 'json') {
    rows = jsonToRows(parseJson(text));
  } else {
    const delimiter = input.format === 'tsv' ? '\t' : ',';
    rows = parseDelimited(text, delimiter).map((r) => r.map(inferCell));
  }
  ctx.progress(0.5);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetNameFor(input.name));
  const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
  return {
    outputs: [
      {
        name: outputNames(input, 'xlsx', [])[0],
        blob: new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      },
    ],
    notes: [],
  };
}

export async function convert(input: ConvertInput, to: FormatId, ctx: ConvertContext): Promise<ConvertResult> {
  ctx.progress(0.05);
  if (input.format === 'xlsx' || input.format === 'xls') {
    if ([...CSV_FORMATS, 'tsv', 'json'].includes(to)) return fromExcel(input, to, ctx);
  }
  if (to === 'xlsx' && [...CSV_FORMATS, 'tsv', 'json'].includes(input.format)) return toExcel(input, ctx);
  throw new ConvertError(`${input.format} から ${to} への変換には対応していません`);
}
