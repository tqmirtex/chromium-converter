import type { Engine, EngineId } from './types';

/** DOM が必要なため、Worker ではなく DOM のある側で動かすエンジン */
export const DOM_ENGINE_IDS = ['html'] as const satisfies readonly EngineId[];
export type DomEngineId = (typeof DOM_ENGINE_IDS)[number];
export type WorkerEngineId = Exclude<EngineId, DomEngineId>;

export function isDomEngine(id: EngineId): id is DomEngineId {
  return (DOM_ENGINE_IDS as readonly EngineId[]).includes(id);
}

/**
 * Worker で動くエンジンの読み込み口。変換を実行する側(Worker)だけが import する。
 * UI 側の bundle に重い実装が入らないよう、レジストリとは分けている。
 */
export const ENGINES: Record<WorkerEngineId, () => Promise<Engine>> = {
  image: () => import('../converters/image/convert'),
  text: () => import('../converters/document/convert'),
  sheet: () => import('../converters/document/sheet'),
  pdf: () => import('../converters/pdf/convert'),
  media: () => import('../converters/media/convert'),
  font: () => import('../converters/font/convert'),
  archive: () => import('../converters/archive/convert'),
};
