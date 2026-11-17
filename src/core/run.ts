import { ENGINES, isDomEngine } from './engines';
import { toUserMessage } from './errors';
import type { WorkerRequest, WorkerResponse } from './messages';
import { getConverter } from './registry';

/** Worker で1件の依頼を処理する。サイドパネルと Offscreen Document の両方がこの Worker を使う。 */
export async function handleRequest(req: WorkerRequest, post: (res: WorkerResponse) => void): Promise<void> {
  try {
    if (req.kind === 'zip') {
      const { createZip } = await import('./zip');
      const zip = await createZip(req.files);
      post({ id: req.id, type: 'done', outputs: [{ name: 'archive.zip', blob: zip }], notes: [] });
      return;
    }
    const converter = getConverter(req.converterId);
    if (isDomEngine(converter.engine)) throw new Error(`${converter.id} は Worker では実行できません`);
    const engine = await ENGINES[converter.engine]();
    const ctx = { progress: (ratio: number, detail?: string) => post({ id: req.id, type: 'progress', ratio, detail }) };
    let result;
    if (req.kind === 'convert-many') {
      if (!converter.mergeable || !engine.convertMany) throw new Error(`${converter.id} はまとめる変換に対応していません`);
      result = await engine.convertMany(req.inputs, converter.to, ctx);
    } else {
      result = await engine.convert(
        { name: req.name, blob: req.blob, format: req.format, bitmap: req.bitmap },
        converter.to,
        ctx,
      );
    }
    post({ id: req.id, type: 'done', outputs: result.outputs, notes: result.notes, failed: result.failed });
  } catch (error) {
    console.error(error);
    post({ id: req.id, type: 'error', message: toUserMessage(error) });
  }
}
