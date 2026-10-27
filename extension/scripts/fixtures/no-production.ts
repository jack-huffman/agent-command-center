/** A machine that isn't logged in to the sample project's Production (D-T-125), as the last Setup check found it. */
import { PRODUCTION_NOT_HERE } from '../../../packages/core/src/sf-discovery.ts';
import type { DoctorItem } from '../../src/logic/setup.ts';
import { ROOT } from './shared.ts';
import { sampleSetup } from './setup.ts';

/** Every step passing, B6.org-match with Production's line, checked in the sample project's folder. */
export function sampleSetupWithoutProduction(): { items: DoctorItem[]; confirmed: Set<string>; root: string } {
  const items = sampleSetup().items.map((i): DoctorItem => (i.id === 'B6.org-match'
    ? { ...i, status: 'pass', detail: `production: ${PRODUCTION_NOT_HERE}, qa → acme--qa, dev → acme--dev` }
    : { ...i, status: 'pass', detail: 'Looks right.', fix: null }));
  return { items, confirmed: new Set(), root: ROOT };
}
