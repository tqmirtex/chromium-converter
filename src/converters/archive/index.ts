import type { Converter, FormatId } from '../../core/types';

/** アーカイブの変換(ZIP ⇔ TAR / TAR.GZ) */
const make = (from: FormatId, to: FormatId): Converter => ({ id: `${from}->${to}`, from, to, engine: 'archive' });

export const archiveConverters: Converter[] = [make('zip', 'tar'), make('zip', 'tgz'), make('tar', 'zip'), make('tgz', 'zip')];
