import { ConvertError, type PrepareKind } from '../core/types';

/** 寸法が書かれていない・小さすぎる SVG を描くときの長辺(ベクターなので拡大しても劣化しない) */
const SVG_MIN_LONG_SIDE = 1024;
const SVG_MAX_LONG_SIDE = 8192;
const SVG_DEFAULT_SIZE = { width: 300, height: 150 };

const UNIT_TO_PX: Record<string, number> = { '': 1, px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };

function parseLength(value: string | null): number | null {
  if (!value) return null;
  const m = /^\s*([0-9]*\.?[0-9]+(?:e[+-]?\d+)?)\s*(px|pt|pc|in|cm|mm)?\s*$/i.exec(value);
  if (!m) return null;
  const n = parseFloat(m[1]) * UNIT_TO_PX[(m[2] ?? '').toLowerCase()];
  return n > 0 && Number.isFinite(n) ? n : null;
}

function intrinsicSize(svg: Element): { width: number; height: number } {
  const w = parseLength(svg.getAttribute('width'));
  const h = parseLength(svg.getAttribute('height'));
  const vb = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const hasViewBox = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
  if (w && h) return { width: w, height: h };
  if (hasViewBox) {
    const ratio = vb[3] / vb[2];
    if (w) return { width: w, height: w * ratio };
    if (h) return { width: h / ratio, height: h };
    return { width: vb[2], height: vb[3] };
  }
  return SVG_DEFAULT_SIZE;
}

/**
 * SVG を画像として描く。Worker には SVG を描く手段がないため、DOM のある側(サイドパネル)で行う。
 * <img> 経由で描くので、SVG 内のスクリプトは実行されず、外部リソースも読み込まれない。
 */
async function rasterizeSvg(blob: Blob): Promise<ImageBitmap> {
  const text = await blob.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (doc.querySelector('parsererror') || svg.localName !== 'svg') {
    throw new ConvertError('SVGを読み取れませんでした。ファイルの書式が壊れている可能性があります');
  }
  const size = intrinsicSize(svg);
  const long = Math.max(size.width, size.height);
  const scale = Math.min(Math.max(1, SVG_MIN_LONG_SIDE / long), SVG_MAX_LONG_SIDE / long);
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  // 描画サイズを確定させるため、寸法と viewBox を書き込んでから描く
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
  try {
    const img = new Image(width, height);
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new ConvertError('SVGを描画できませんでした。ファイルの中身が壊れている可能性があります');
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    if (!g) throw new ConvertError('描画の準備に失敗しました');
    g.drawImage(img, 0, 0, width, height);
    return await createImageBitmap(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** DOM が必要な前処理を実行する(サイドパネル・Offscreen Document で共有) */
export async function prepare(kind: PrepareKind, blob: Blob): Promise<ImageBitmap> {
  switch (kind) {
    case 'rasterize-svg':
      return rasterizeSvg(blob);
  }
}
