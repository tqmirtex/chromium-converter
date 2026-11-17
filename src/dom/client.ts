import { FATAL_ID, type ConvertRequest, type WorkerRequest, type WorkerResponse } from '../core/messages';
import type { ConvertOutput, ConvertResult, FormatId } from '../core/types';

export class CancelledError extends Error {
  constructor() {
    super('キャンセルしました');
    this.name = 'CancelledError';
  }
}

interface Pending {
  resolve: (r: ConvertResult) => void;
  reject: (e: Error) => void;
  onProgress: (ratio: number, detail?: string) => void;
}

/**
 * 変換用 Worker の窓口。サイドパネルと Offscreen Document で共有する。
 * キャンセルは Worker ごと止めて作り直す(処理を確実に中断するため)。
 */
export class ConvertClient {
  private worker: Worker | undefined;
  private seq = 0;
  private pending = new Map<number, Pending>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('../worker/convert.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const res = e.data;
      if (res.id === FATAL_ID && res.type === 'error') {
        // どの変換のエラーか分からないので、処理中のものをすべて失敗にし、Worker を作り直す
        this.failAll(new Error(res.message));
        worker.terminate();
        this.worker = undefined;
        return;
      }
      const p = this.pending.get(res.id);
      if (!p) return;
      if (res.type === 'progress') {
        p.onProgress(res.ratio, res.detail);
        return;
      }
      this.pending.delete(res.id);
      if (res.type === 'done') p.resolve({ outputs: res.outputs, notes: res.notes, failed: res.failed });
      else p.reject(new Error(res.message));
    };
    worker.onerror = (e) => {
      e.preventDefault();
      this.failAll(new Error(`変換処理が異常終了しました(${e.message || '原因不明'})`));
      worker.terminate();
      this.worker = undefined;
    };
    this.worker = worker;
    return worker;
  }

  private send(
    req: WorkerRequest,
    transfer: Transferable[],
    onProgress: (ratio: number, detail?: string) => void,
  ): Promise<ConvertResult> {
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject, onProgress });
      worker.postMessage(req, transfer);
    });
  }

  run(req: Omit<ConvertRequest, 'id' | 'kind'>, onProgress: (ratio: number, detail?: string) => void): Promise<ConvertResult> {
    return this.send({ ...req, kind: 'convert', id: ++this.seq }, req.bitmap ? [req.bitmap] : [], onProgress);
  }

  /** 複数の入力を1つのファイルにまとめる(画像 → PDF の結合) */
  runMany(
    converterId: string,
    inputs: Array<{ name: string; blob: Blob; format: FormatId }>,
    onProgress: (ratio: number, detail?: string) => void,
  ): Promise<ConvertResult> {
    return this.send({ kind: 'convert-many', id: ++this.seq, converterId, inputs }, [], onProgress);
  }

  /** 変換結果を1つの ZIP にまとめる(UI を止めないよう Worker で行う) */
  async zip(files: ConvertOutput[]): Promise<Blob> {
    const result = await this.send({ kind: 'zip', id: ++this.seq, files }, [], () => {});
    return result.outputs[0].blob;
  }

  cancel(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.failAll(new CancelledError());
  }

  private failAll(error: Error): void {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }
}
