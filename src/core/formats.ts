import { ascii, ftypBrands, startsWith } from './bytes';
import { detectEncoding, type TextEncodingId } from './text';
import type { FormatDef, FormatId } from './types';

const AVIF_BRANDS = ['avif', 'avis'];
const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];

function isSvg(head: Uint8Array): boolean {
  // 先頭の BOM・XML 宣言・コメント・DOCTYPE を許して、最初の要素が <svg か見る
  let text = new TextDecoder('utf-8', { fatal: false }).decode(head);
  text = text.replace(/^\uFEFF/, '');
  text = text.replace(/^\s*(<\?xml[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[\s\S]*?>\s*)*/i, '');
  return /^<svg[\s>]/i.test(text);
}

/** 登録順が候補の表示順になる */
export const FORMATS: FormatDef[] = [
  {
    id: 'png',
    label: 'PNG',
    ext: 'png',
    extensions: ['png', 'apng'],
    mime: 'image/png',
    category: 'image',
    usage: '画質が落ちない。透過も保てる。図・スクリーンショット向け',
    sniff: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    id: 'jpeg',
    label: 'JPEG',
    ext: 'jpg',
    extensions: ['jpg', 'jpeg', 'jpe', 'jfif'],
    mime: 'image/jpeg',
    category: 'image',
    usage: '写真向け。どこでも開ける。透過は白になる',
    sniff: (h) => startsWith(h, [0xff, 0xd8, 0xff]),
  },
  {
    id: 'webp',
    label: 'WebP',
    ext: 'webp',
    extensions: ['webp'],
    mime: 'image/webp',
    category: 'image',
    usage: 'Web掲載向け。軽くて透過も保てる',
    sniff: (h) => ascii(h, 0, 4) === 'RIFF' && ascii(h, 8, 4) === 'WEBP',
  },
  {
    id: 'avif',
    label: 'AVIF',
    ext: 'avif',
    extensions: ['avif'],
    mime: 'image/avif',
    category: 'image',
    usage: 'Web掲載向け。WebPよりさらに軽い',
    sniff: (h) => ftypBrands(h).some((b) => AVIF_BRANDS.includes(b)),
  },
  {
    id: 'ico',
    label: 'ICO',
    ext: 'ico',
    extensions: ['ico'],
    mime: 'image/x-icon',
    category: 'image',
    usage: 'サイトのファビコン・Windowsのアイコン向け',
    sniff: (h) => startsWith(h, [0x00, 0x00, 0x01, 0x00]) && h.length >= 6 && (h[4] | (h[5] << 8)) > 0,
  },
  {
    id: 'svg',
    label: 'SVG',
    ext: 'svg',
    extensions: ['svg'],
    mime: 'image/svg+xml',
    category: 'image',
    usage: '拡大しても粗くならない図形・ロゴ向け',
    sniff: isSvg,
  },
  {
    id: 'heic',
    label: 'HEIC',
    ext: 'heic',
    extensions: ['heic', 'heif', 'hif'],
    mime: 'image/heic',
    category: 'image',
    usage: 'iPhoneで撮った写真の形式',
    // AVIF も mif1 を含むので、AVIF でないことを先に確かめる
    sniff: (h) => {
      const brands = ftypBrands(h);
      return !brands.some((b) => AVIF_BRANDS.includes(b)) && brands.some((b) => HEIF_BRANDS.includes(b));
    },
  },
  {
    id: 'bmp',
    label: 'BMP',
    ext: 'bmp',
    extensions: ['bmp', 'dib'],
    mime: 'image/bmp',
    category: 'image',
    usage: '古いWindowsアプリ向けの非圧縮画像',
    sniff: (h) => ascii(h, 0, 2) === 'BM' && h.length >= 26,
  },
  {
    id: 'tiff',
    label: 'TIFF',
    ext: 'tif',
    extensions: ['tif', 'tiff'],
    mime: 'image/tiff',
    category: 'image',
    usage: '印刷・スキャン向けの画像',
    sniff: (h) => startsWith(h, [0x49, 0x49, 0x2a, 0x00]) || startsWith(h, [0x4d, 0x4d, 0x00, 0x2a]),
  },
  {
    id: 'gif',
    label: 'GIF',
    ext: 'gif',
    extensions: ['gif'],
    mime: 'image/gif',
    category: 'image',
    usage: '色数の少ない簡単なアニメーション向け',
    sniff: (h) => ascii(h, 0, 6) === 'GIF87a' || ascii(h, 0, 6) === 'GIF89a',
  },

  // ---------- ドキュメント・テキスト ----------
  {
    id: 'md',
    label: 'Markdown',
    ext: 'md',
    extensions: ['md', 'markdown', 'mdown', 'mkd'],
    mime: 'text/markdown',
    category: 'document',
    usage: '見出しや箇条書きを記号で書く文書。メモ・README向け',
  },
  {
    id: 'html',
    label: 'HTML',
    ext: 'html',
    extensions: ['html', 'htm', 'xhtml'],
    mime: 'text/html',
    category: 'document',
    usage: 'ブラウザで開ける文書。見出しや表の見た目つきで共有向け',
    sniff: isHtml,
    // DOCTYPE や <html> で始まらない断片的な HTML も、拡張子で受け付ける
    textMatch: (_h, ext) => ['html', 'htm', 'xhtml'].includes(ext),
  },
  {
    id: 'txt',
    label: 'テキスト',
    ext: 'txt',
    extensions: ['txt'],
    mime: 'text/plain',
    category: 'document',
    usage: '書式を外した文字だけ。どのアプリでも開ける',
  },

  {
    id: 'pdf',
    label: 'PDF',
    ext: 'pdf',
    extensions: ['pdf'],
    mime: 'application/pdf',
    category: 'pdf',
    usage: '印刷・配布向け。どの端末でも同じ見た目で開ける',
    // 先頭 1024 バイト以内に %PDF- がある(仕様上、前にゴミがあってもよい)
    sniff: (h) => ascii(h, 0, Math.min(h.length, 1024)).includes('%PDF-'),
  },

  // ---------- データ ----------
  {
    id: 'json',
    label: 'JSON',
    ext: 'json',
    extensions: ['json'],
    mime: 'application/json',
    category: 'data',
    usage: 'プログラムやWebサービスでデータをやりとりする形式',
  },
  {
    id: 'yaml',
    label: 'YAML',
    ext: 'yaml',
    extensions: ['yaml', 'yml'],
    mime: 'application/yaml',
    category: 'data',
    usage: '人が読み書きしやすい設定ファイル向け',
  },
  {
    id: 'toml',
    label: 'TOML',
    ext: 'toml',
    extensions: ['toml'],
    mime: 'application/toml',
    category: 'data',
    usage: 'シンプルな設定ファイル向け',
  },
  csvFormat('csv-utf8', 'UTF-8', 'utf8', '標準的な表データ。多くのアプリ・プログラム向け'),
  csvFormat('csv-utf8bom', 'UTF-8 BOM付き', 'utf8bom', 'Excelで開いても文字化けしない表データ'),
  csvFormat('csv-sjis', 'Shift-JIS', 'sjis', '古い業務ソフト・古いExcel向けの表データ'),
  {
    id: 'tsv',
    label: 'TSV',
    ext: 'tsv',
    extensions: ['tsv', 'tab'],
    mime: 'text/tab-separated-values',
    category: 'data',
    usage: 'タブ区切りの表データ。表計算ソフトへの貼り付け向け',
  },
  {
    id: 'md-table',
    label: 'Markdownテーブル',
    short: { name: 'Markdown', variant: 'テーブル' },
    ext: 'md',
    extensions: [],
    mime: 'text/markdown',
    category: 'document',
    usage: 'README・メモに貼れる表',
    outputOnly: true,
  },
  {
    id: 'xlsx',
    label: 'Excel(.xlsx)',
    short: { name: 'Excel', variant: '.xlsx' },
    ext: 'xlsx',
    extensions: ['xlsx', 'xlsm'],
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    category: 'data',
    usage: 'Excelで開いて編集・集計する表',
    // xlsx は ZIP 形式なので、ZIP の署名に加えて拡張子か中身の名前で確かめる
    // パスワード付きの xlsx は複合ドキュメント形式なので、その場合は拡張子で確かめる(読み込み時に理由を表示する)
    sniff: (h, ext) =>
      (startsWith(h, [0x50, 0x4b, 0x03, 0x04]) &&
        (['xlsx', 'xlsm'].includes(ext) || ascii(h, 0, h.length).includes('xl/'))) ||
      (startsWith(h, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) && ['xlsx', 'xlsm'].includes(ext)),
  },
  {
    id: 'xls',
    label: 'Excel(.xls)',
    short: { name: 'Excel', variant: '.xls' },
    ext: 'xls',
    extensions: ['xls'],
    mime: 'application/vnd.ms-excel',
    category: 'data',
    usage: '古いExcelの表',
    // 古い Office 形式(複合ドキュメント)の署名。Word の .doc と同じなので拡張子でも確かめる
    sniff: (h, ext) => startsWith(h, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) && ext === 'xls',
  },

  // ---------- 動画 ----------
  {
    id: 'mp4',
    label: 'MP4',
    ext: 'mp4',
    extensions: ['mp4', 'm4v', '3gp'],
    mime: 'video/mp4',
    category: 'media',
    usage: 'どの端末でも再生しやすい動画',
    sniff: (h, ext) => isoKind(h, ext) === 'mp4',
  },
  {
    id: 'mov',
    label: 'MOV',
    ext: 'mov',
    extensions: ['mov', 'qt'],
    mime: 'video/quicktime',
    category: 'media',
    usage: 'iPhone・Mac で撮った動画',
    sniff: (h, ext) => isoKind(h, ext) === 'mov',
  },
  {
    id: 'mkv',
    label: 'MKV',
    ext: 'mkv',
    extensions: ['mkv', 'mka'],
    mime: 'video/x-matroska',
    category: 'media',
    usage: '複数の音声・字幕を持てる動画',
    sniff: (h) => ebmlDocType(h) === 'matroska',
  },
  {
    id: 'webm',
    label: 'WebM',
    ext: 'webm',
    extensions: ['webm'],
    mime: 'video/webm',
    category: 'media',
    usage: 'Web 向けの動画',
    sniff: (h) => ebmlDocType(h) === 'webm',
  },
  {
    id: 'avi',
    label: 'AVI',
    ext: 'avi',
    extensions: ['avi'],
    mime: 'video/x-msvideo',
    category: 'media',
    usage: '古い Windows の動画',
    sniff: (h) => ascii(h, 0, 4) === 'RIFF' && ascii(h, 8, 4) === 'AVI ',
  },

  // ---------- 音声 ----------
  {
    id: 'mp3',
    label: 'MP3',
    ext: 'mp3',
    extensions: ['mp3'],
    mime: 'audio/mpeg',
    category: 'media',
    usage: 'どこでも再生できる音声。音楽・録音の共有向け',
    // ID3 タグ、または MPEG オーディオ レイヤー3 のフレーム同期
    sniff: (h) => ascii(h, 0, 3) === 'ID3' || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0 && (h[1] & 0x06) === 0x02),
  },
  {
    id: 'wav',
    label: 'WAV',
    ext: 'wav',
    extensions: ['wav', 'wave'],
    mime: 'audio/wav',
    category: 'media',
    usage: '劣化のない非圧縮の音声。編集向け(ファイルは大きい)',
    sniff: (h) => (ascii(h, 0, 4) === 'RIFF' || ascii(h, 0, 4) === 'RF64') && ascii(h, 8, 4) === 'WAVE',
  },
  {
    id: 'flac',
    label: 'FLAC',
    ext: 'flac',
    extensions: ['flac'],
    mime: 'audio/flac',
    category: 'media',
    usage: '劣化のない圧縮の音声。音楽の保存向け',
    sniff: (h) => ascii(h, 0, 4) === 'fLaC',
  },
  {
    id: 'ogg',
    label: 'OGG',
    ext: 'ogg',
    extensions: ['ogg', 'oga', 'opus'],
    mime: 'audio/ogg',
    category: 'media',
    usage: '高音質で軽い音声(Opus)。Web・ゲーム向け',
    sniff: (h) => ascii(h, 0, 4) === 'OggS',
  },
  {
    id: 'm4a',
    label: 'M4A',
    ext: 'm4a',
    extensions: ['m4a', 'm4b'],
    mime: 'audio/mp4',
    category: 'media',
    usage: 'iPhone・iTunes で扱いやすい音声(AAC)',
    sniff: (h, ext) => isoKind(h, ext) === 'm4a',
  },
  {
    id: 'aac',
    label: 'AAC',
    ext: 'aac',
    extensions: ['aac'],
    mime: 'audio/aac',
    category: 'media',
    usage: '軽い音声(AAC)。古い機器・ストリーミング向け',
    // ADTS の同期ワード(レイヤーは 00)
    sniff: (h) => h[0] === 0xff && (h[1] & 0xf6) === 0xf0,
  },
];

FORMATS.push(
  // ---------- フォント ----------
  {
    id: 'ttf',
    label: 'TTF',
    ext: 'ttf',
    extensions: ['ttf'],
    mime: 'font/ttf',
    category: 'font',
    usage: 'パソコンにインストールできるフォント(TrueType)',
    sniff: (h) => startsWith(h, [0x00, 0x01, 0x00, 0x00]) || ascii(h, 0, 4) === 'true',
  },
  {
    id: 'otf',
    label: 'OTF',
    ext: 'otf',
    extensions: ['otf'],
    mime: 'font/otf',
    category: 'font',
    usage: 'パソコンにインストールできるフォント(OpenType / CFF)',
    sniff: (h) => ascii(h, 0, 4) === 'OTTO',
  },
  {
    id: 'woff',
    label: 'WOFF',
    ext: 'woff',
    extensions: ['woff'],
    mime: 'font/woff',
    category: 'font',
    usage: 'Web サイト用のフォント(古いブラウザにも対応)',
    sniff: (h) => ascii(h, 0, 4) === 'wOFF',
  },
  {
    id: 'woff2',
    label: 'WOFF2',
    ext: 'woff2',
    extensions: ['woff2'],
    mime: 'font/woff2',
    category: 'font',
    usage: 'Web サイト用のフォント。いちばん小さい(現在の標準)',
    sniff: (h) => ascii(h, 0, 4) === 'wOF2',
  },

  // ---------- アーカイブ ----------
  {
    id: 'zip',
    label: 'ZIP',
    ext: 'zip',
    extensions: ['zip'],
    mime: 'application/zip',
    category: 'archive',
    usage: 'Windows・Mac で標準で開ける圧縮ファイル',
    // xlsx なども ZIP 形式だが、それらは先に判定される
    sniff: (h) => startsWith(h, [0x50, 0x4b, 0x03, 0x04]) || startsWith(h, [0x50, 0x4b, 0x05, 0x06]),
  },
  {
    id: 'tar',
    label: 'TAR',
    ext: 'tar',
    extensions: ['tar'],
    mime: 'application/x-tar',
    category: 'archive',
    usage: 'Linux・サーバーで使うまとめファイル(圧縮なし)',
    sniff: (h, ext) => ascii(h, 257, 5) === 'ustar' || (ext === 'tar' && tarChecksumOk(h)),
  },
  {
    id: 'tgz',
    label: 'TAR.GZ',
    ext: 'tar.gz',
    extensions: ['tgz', 'gz'],
    mime: 'application/gzip',
    category: 'archive',
    usage: 'Linux・サーバーでよく使う圧縮ファイル',
    // gzip の署名。中身が TAR かどうかは展開時に確かめる
    sniff: (h, ext) => startsWith(h, [0x1f, 0x8b]) && ['tgz', 'gz'].includes(ext),
  },
);

/** 古い形式(ustar の印がない)TAR の見出しのチェックサムを確かめる */
function tarChecksumOk(h: Uint8Array): boolean {
  if (h.length < 512) return false;
  const stored = parseInt(ascii(h, 148, 8).replace(/[^0-7]/g, ''), 8);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  return stored === sum;
}

/** ISO BMFF(MP4 系)の種類を、ftyp のブランドと拡張子で分ける。AVIF / HEIC は画像として先に判定される */
function isoKind(h: Uint8Array, ext: string): 'mp4' | 'mov' | 'm4a' | null {
  const brands = ftypBrands(h);
  if (brands.length === 0) {
    // 古い QuickTime は ftyp を持たないことがある
    const atom = ascii(h, 4, 4);
    return ['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(atom) && ['mov', 'qt'].includes(ext) ? 'mov' : null;
  }
  if (brands.some((b) => AVIF_BRANDS.includes(b) || HEIF_BRANDS.includes(b)) && !brands.some((b) => /^(isom|mp4|M4V|avc1|qt)/.test(b))) {
    return null;
  }
  if (brands[0] === 'qt  ') return 'mov';
  if (['M4A ', 'M4B ', 'M4P '].includes(brands[0]) || ['m4a', 'm4b'].includes(ext)) return 'm4a';
  return 'mp4';
}

/** Matroska / WebM の DocType */
function ebmlDocType(h: Uint8Array): 'webm' | 'matroska' | null {
  if (!startsWith(h, [0x1a, 0x45, 0xdf, 0xa3])) return null;
  const head = ascii(h, 0, Math.min(h.length, 64));
  if (head.includes('webm')) return 'webm';
  if (head.includes('matroska')) return 'matroska';
  return null;
}

function isHtml(head: Uint8Array): boolean {
  let text = new TextDecoder('utf-8', { fatal: false }).decode(head.subarray(0, 1024));
  text = text.replace(/^\uFEFF/, '').replace(/^\s*(<!--[\s\S]*?-->\s*)*/, '');
  return /^<!doctype\s+html[\s>]/i.test(text) || /^<html[\s>]/i.test(text);
}

function csvFormat(id: FormatId, variant: string, encoding: TextEncodingId, usage: string): FormatDef {
  return {
    id,
    label: `CSV(${variant})`,
    short: { name: 'CSV', variant },
    ext: 'csv',
    extensions: ['csv'],
    mime: 'text/csv',
    category: 'data',
    usage,
    // 拡張子が同じ .csv なので、文字コードで3つに分ける
    textMatch: (head, ext, complete) => ext === 'csv' && detectEncoding(head, complete) === encoding,
  };
}

const byId = new Map(FORMATS.map((f) => [f.id, f]));

export function getFormat(id: FormatId): FormatDef {
  const f = byId.get(id);
  if (!f) throw new Error(`未登録の形式: ${id}`);
  return f;
}

export function formatOrder(id: FormatId): number {
  return FORMATS.findIndex((f) => f.id === id);
}
