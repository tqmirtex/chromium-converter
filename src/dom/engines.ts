import type { DomEngineId } from '../core/engines';
import type { Engine } from '../core/types';

/** DOM のある側(サイドパネル)で動かすエンジンの読み込み口 */
export const DOM_ENGINES: Record<DomEngineId, () => Promise<Engine>> = {
  html: () => import('../converters/document/html'),
};
