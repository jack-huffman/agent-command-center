/** The sample repo's tidy-up offer (GH-104): nine tasks merged since the last one, so one is due. */
import type { HubLike } from '../../src/model/shared.ts';
import { ROOT } from './shared.ts';

export const sampleTidy: NonNullable<HubLike['tidy']> = () => ({ due: true, count: 9, every: 8, ledger: `${ROOT}/.git/acc/ledger.json` });
