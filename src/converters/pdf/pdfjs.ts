import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api';
import { baseName } from '../../core/filename';
import { PDF_RENDER_DPI } from '../../core/limits';
import { ConvertError, type ConvertContext, type ConvertInput, type ConvertOutput, type ConvertResult } from '../../core/types';

/**
 * pdf.js を変換用 Worker の中で動かす。
 * - pdf.js の解析部分(pdf.worker)は同じスレッドに読み込む(Worker の中からさらに Worker を作らない)
 * - 描画は OffscreenCanvas に行う(DOM を使わない)
 * - フォントは FontFace を使わずパスで描く(Worker では document.fonts が使えないため)
 * - 日本語 PDF に必要な CMap・標準フォント・画像デコーダー(wasm)は拡張機能に同梱したものを読む(外部に取りに行かない)
 */

/** 拡張機能に同梱した pdf.js の資源の場所(ビルド時に dist/pdfjs/ へコピーする) */
const ASSET_BASE = new URL('/pdfjs/', self.location.href).href;

/** 1ページを画像にするときの上限(メモリ保護)。超えるときは解像度を下げる */
const MAX_PAGE_PIXELS = 40_000_000;
const MAX_PAGE_SIDE = 16_000;
const JPEG_QUALITY = 0.95;

let workerReady: Promise<unknown> | undefined;

/** Worker の中で使うキャンバスの作り方(pdf.js の既定は document を使うため差し替える) */
class OffscreenCanvasFactory {
  constructor(_options?: unknown) {}
  create(width: number, height: number): { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D } {
    const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('キャンバスを作れませんでした');
    return { canvas, context };
  }
  reset(cc: { canvas: OffscreenCanvas }, width: number, height: number): void {
    cc.canvas.width = Math.max(1, width);
    cc.canvas.height = Math.max(1, height);
  }
  destroy(cc: { canvas: OffscreenCanvas | null; context: unknown }): void {
    if (cc.canvas) cc.canvas.width = cc.canvas.height = 0;
    cc.canvas = null;
    cc.context = null;
  }
  getNoAlphaContext(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D | null {
    return canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  }
}

/** SVG フィルター(DOM が必要)は使わない */
class NoFilterFactory {
  constructor(_options?: unknown) {}
  addFilter(): string {
    return 'none';
  }
  addHCMFilter(): string {
    return 'none';
  }
  addAlphaFilter(): string {
    return 'none';
  }
  addLuminosityFilter(): string {
    return 'none';
  }
  addKnockoutFilter(): string {
    return 'none';
  }
  addHighlightHCMFilter(): string {
    return 'none';
  }
  addSelectionHCMFilter(): string {
    return 'none';
  }
  addSelectionFilter(): string {
    return 'none';
  }
  createSelectionStyle(): null {
    return null;
  }
  destroy(): void {}
}

interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** 読み込みを終えて、メモリを解放する */
  close: () => Promise<void>;
}

async function openPdf(input: ConvertInput): Promise<OpenedPdf> {
  workerReady ??= import('pdfjs-dist/build/pdf.worker.mjs');
  await workerReady;
  const data = new Uint8Array(await input.blob.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    cMapUrl: `${ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
    wasmUrl: `${ASSET_BASE}wasm/`,
    iccUrl: `${ASSET_BASE}iccs/`,
    useWorkerFetch: true,
    disableWorkerRendering: true,
    disableFontFace: true,
    useSystemFonts: false,
    isOffscreenCanvasSupported: true,
    enableXfa: false,
    CanvasFactory: OffscreenCanvasFactory,
    FilterFactory: NoFilterFactory,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const doc = await task.promise;
    return { doc, close: () => task.destroy() };
  } catch (error) {
    void task.destroy();
    const name = (error as { name?: string })?.name;
    if (name === 'PasswordException') throw new ConvertError('パスワード付きのPDFは変換できません');
    if (name === 'InvalidPDFException') {
      throw new ConvertError('PDFを読み込めませんでした。ファイルが壊れている可能性があります');
    }
    throw new ConvertError(`PDFを読み込めませんでした(${error instanceof Error ? error.message : String(error)})`);
  }
}

function pageName(input: ConvertInput, page: number, total: number, ext: string): string {
  // 複数ページは「元の名前_001.png」。1ページだけなら拡張子だけを変える
  if (total === 1) return `${baseName(input.name)}.${ext}`;
  const width = Math.max(3, String(total).length);
  return `${baseName(input.name)}_${String(page).padStart(width, '0')}.${ext}`;
}

/** PDF → 画像(1ページ1枚)。ページを順に描いて、そのたびにメモリを解放する */
export async function pdfToImages(input: ConvertInput, to: 'png' | 'jpeg', ctx: ConvertContext): Promise<ConvertResult> {
  const { doc, close } = await openPdf(input);
  const total = doc.numPages;
  const outputs: ConvertOutput[] = [];
  const notes: string[] = [];
  let reduced = false;
  try {
    for (let n = 1; n <= total; n++) {
      ctx.progress((n - 1) / total, `${n} / ${total} ページ`);
      const page = await doc.getPage(n);
      let scale = PDF_RENDER_DPI / 72;
      const base = page.getViewport({ scale: 1 });
      const fit = Math.min(
        Math.sqrt(MAX_PAGE_PIXELS / (base.width * base.height)),
        MAX_PAGE_SIDE / Math.max(base.width, base.height),
      );
      if (fit < scale) {
        scale = fit;
        reduced = true;
      }
      const viewport = page.getViewport({ scale });
      const canvas = new OffscreenCanvas(Math.max(1, Math.floor(viewport.width)), Math.max(1, Math.floor(viewport.height)));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new ConvertError('描画の準備に失敗しました');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvas: null,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
        background: '#ffffff',
      }).promise;
      const blob = await canvas.convertToBlob(
        to === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: JPEG_QUALITY },
      );
      outputs.push({ name: pageName(input, n, total, to === 'png' ? 'png' : 'jpg'), blob });
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  } finally {
    await close();
  }
  if (total > 1) notes.push(`${total}ページを1ページずつ画像にしました`);
  if (reduced) notes.push('とても大きいページは、メモリを使い切らないよう解像度を下げました');
  return { outputs, notes };
}

/** PDF → テキスト。ページの間は空行で区切る */
export async function pdfToText(input: ConvertInput, ctx: ConvertContext): Promise<ConvertResult> {
  const { doc, close } = await openPdf(input);
  const total = doc.numPages;
  const pages: string[] = [];
  let empty = 0;
  try {
    for (let n = 1; n <= total; n++) {
      ctx.progress((n - 1) / total, `${n} / ${total} ページ`);
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const t = item as TextItem;
        text += t.str;
        if (t.hasEOL) text += '\n';
      }
      text = text
        .split('\n')
        .map((l) => l.replace(/\s+$/, ''))
        .join('\n')
        .trim();
      if (!text) empty++;
      pages.push(text);
      page.cleanup();
    }
  } finally {
    await close();
  }
  if (empty === total) {
    throw new ConvertError(
      'PDFに文字のデータがありません。スキャンした画像だけのPDFの可能性があります(画像の中の文字を読み取る機能=OCRには対応していません)',
    );
  }
  const notes: string[] = [];
  if (empty > 0) notes.push(`${empty}ページは文字のデータがありませんでした(画像だけのページなど)`);
  const blob = new Blob([`${pages.filter((p) => p).join('\n\n')}\n`], { type: 'text/plain;charset=utf-8' });
  return { outputs: [{ name: `${baseName(input.name)}.txt`, blob }], notes };
}
