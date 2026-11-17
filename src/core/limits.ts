import type { FormatCategory } from './types';

const MB = 1024 * 1024;

/** 1ファイルあたりのサイズ上限。超えたら変換前に警告して対象から外す。 */
export const MAX_FILE_BYTES: Record<FormatCategory, number> = {
  image: 100 * MB,
  // テキストは展開後に文字列・表データとして何倍にも膨らむため、画像より小さくする
  document: 50 * MB,
  data: 50 * MB,
  // PDF はページを1枚ずつ処理して解放するので、元ファイルが大きくても扱える
  pdf: 200 * MB,
  // 音声・動画は変換結果をメモリ上に組み立てるため、元ファイルと同じくらいのメモリをさらに使う
  media: 500 * MB,
  font: 50 * MB,
  archive: 500 * MB,
};

/** PDF → 画像の解像度(dpi)。A4 が約 1654×2339px になり、小さな文字も読める */
export const PDF_RENDER_DPI = 200;

/** アーカイブを展開したときの合計サイズの上限(展開前に中身の一覧で確かめる) */
export const MAX_ARCHIVE_EXPANDED_BYTES = 1024 * MB;

/** 画像のピクセル数の上限(展開後のメモリ: 1億ピクセル × 4バイト ≒ 400MB) */
export const MAX_IMAGE_PIXELS = 100_000_000;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / 1024 / MB).toFixed(2)} GB`;
}
