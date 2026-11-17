import type { ConvertOutput, FormatId } from './types';

/** 変換用 Worker への依頼 */
export type WorkerRequest =
  | {
      kind: 'convert';
      id: number;
      converterId: string;
      name: string;
      blob: Blob;
      format: FormatId;
      bitmap?: ImageBitmap;
    }
  | {
      /** 複数の入力を1つにまとめる(画像 → PDF の結合) */
      kind: 'convert-many';
      id: number;
      converterId: string;
      inputs: Array<{ name: string; blob: Blob; format: FormatId }>;
    }
  | { kind: 'zip'; id: number; files: ConvertOutput[] };

export type ConvertRequest = Extract<WorkerRequest, { kind: 'convert' }>;

/** Worker 全体で起きたエラー(どの依頼のものか分からない)を表す id */
export const FATAL_ID = -1;

export type WorkerResponse =
  | { id: number; type: 'progress'; ratio: number; detail?: string }
  | {
      id: number;
      type: 'done';
      outputs: ConvertOutput[];
      notes: string[];
      failed?: Array<{ index: number; message: string }>;
    }
  | { id: number; type: 'error'; message: string };

/** Service Worker → Offscreen Document:URL の画像を変換する */
export interface OffscreenConvertMessage {
  target: 'offscreen';
  type: 'convert-url';
  srcUrl: string;
  to: FormatId;
}

export type OffscreenConvertReply =
  | { status: 'done'; blobUrl: string; filename: string; notes: string[] }
  | { status: 'skipped'; message: string }
  | { status: 'failed'; message: string };

/** Offscreen Document へ、使い終わった Blob URL の解放を頼む */
export interface OffscreenRevokeMessage {
  target: 'offscreen';
  type: 'revoke';
  blobUrl: string;
}

/** 権限の確認ページ → Service Worker */
export interface PermissionResultMessage {
  target: 'background';
  type: 'permission-result';
  requestId: string;
  granted: boolean;
}
