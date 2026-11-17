import { detectFormat } from '../core/detect';
import { toUserMessage } from '../core/errors';
import { fileNameFromUrl, sanitizeFileName } from '../core/filename';
import { getFormat } from '../core/formats';
import { MAX_FILE_BYTES, formatBytes } from '../core/limits';
import type { OffscreenConvertMessage, OffscreenConvertReply, OffscreenRevokeMessage } from '../core/messages';
import { findConverter } from '../core/registry';
import { ConvertClient } from '../dom/client';
import { prepare } from '../dom/prepare';

/**
 * 右クリック変換の実行役。Service Worker から依頼を受け、画像を取得して変換し、Blob URL を返す。
 * 変換はサイドパネルと同じ Worker・同じコンバーターで行う。
 */
const client = new ConvertClient();
const IMAGE_LIMIT = MAX_FILE_BYTES.image;

const failed = (message: string): OffscreenConvertReply => ({ status: 'failed', message });

async function fetchImage(url: string): Promise<Blob | OffscreenConvertReply> {
  let res: Response;
  try {
    // ページで表示されている画像と同じように取得する(ログインが必要な画像に対応するため Cookie を送る)
    res = await fetch(url, { credentials: 'include' });
  } catch {
    return failed('画像を取得できませんでした(通信エラー、または取得が許可されていません)');
  }
  if (!res.ok) return failed(`画像を取得できませんでした(HTTP ${res.status})`);
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > IMAGE_LIMIT) return failed(`画像が大きすぎます(上限 ${formatBytes(IMAGE_LIMIT)})`);
  const blob = await res.blob();
  if (blob.size > IMAGE_LIMIT) return failed(`画像が大きすぎます(上限 ${formatBytes(IMAGE_LIMIT)})`);
  return blob;
}

async function convertUrl(msg: OffscreenConvertMessage): Promise<OffscreenConvertReply> {
  try {
    const fetched = await fetchImage(msg.srcUrl);
    if (!(fetched instanceof Blob)) return fetched;
    const name = fileNameFromUrl(msg.srcUrl);
    const format = await detectFormat(fetched, name);
    if (!format || getFormat(format).category !== 'image') {
      return failed('画像の形式を判別できませんでした(未対応の形式です)');
    }
    const toLabel = getFormat(msg.to).label;
    if (format === msg.to) {
      return { status: 'skipped', message: `この画像はすでに${toLabel}形式のため、変換不要です` };
    }
    const converter = findConverter(format, msg.to);
    if (!converter) return failed(`${getFormat(format).label}から${toLabel}への変換には対応していません`);
    const bitmap = converter.prepare ? await prepare(converter.prepare, fetched) : undefined;
    const result = await client.run({ converterId: converter.id, name, blob: fetched, format, bitmap }, () => {});
    const out = result.outputs[0];
    return {
      status: 'done',
      blobUrl: URL.createObjectURL(out.blob),
      filename: sanitizeFileName(out.name),
      notes: result.notes,
    };
  } catch (error) {
    return failed(error instanceof Error ? error.message : toUserMessage(error));
  }
}

chrome.runtime.onMessage.addListener(
  (msg: OffscreenConvertMessage | OffscreenRevokeMessage | { target?: string }, _sender, sendResponse) => {
    if (msg.target !== 'offscreen') return undefined;
    const m = msg as OffscreenConvertMessage | OffscreenRevokeMessage;
    if (m.type === 'revoke') {
      URL.revokeObjectURL(m.blobUrl);
      return undefined;
    }
    void convertUrl(m).then(sendResponse);
    return true; // 非同期で返事をする
  },
);
