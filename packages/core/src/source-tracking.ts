// Whether a Salesforce project uses source tracking (T-73). Most do. A project that doesn't still works:
// retrieves use manifests and deploys use source folders, so only Setup's tracking steps need to know.

import { readFileSync } from 'node:fs';
import type { Config } from './config.ts';
import { editJsonKey } from './config-edit.ts';
import { AccError } from './exec.ts';
import { writeAtomic } from './ledger.ts';

/** Whether the project uses source tracking: yes unless its config says false. */
export const usesSourceTracking = (config: Pick<Config, 'sourceTracking'>): boolean => config.sourceTracking !== false;

/** Why Setup's source-tracking steps skip in a project that doesn't use it, and where a person changes that. */
export const NO_TRACKING_REASON = 'This project doesn\'t use source tracking, so there\'s nothing to check. To change that, turn on Source tracking under Limits and checks in the project\'s settings.';

/**
 * Sets whether a Salesforce project uses source tracking, in its .acc/config.json, and nothing else there.
 * On is the default, so on takes the key out; off writes false. A project that isn't Salesforce is refused.
 */
export function setSourceTracking(configFile: string, on: boolean): void {
  let text: string;
  let raw: Record<string, unknown>;
  try {
    text = readFileSync(configFile, 'utf8');
    raw = JSON.parse(text);
  } catch (e) {
    throw new AccError('bad-config', `Couldn't read ${configFile}: ${(e as Error).message}`);
  }
  if (raw?.profile !== 'salesforce') throw new AccError('refused', 'Source tracking is a Salesforce setting: this project isn\'t a Salesforce project.');
  const edited = editJsonKey(text, ['sourceTracking'], on ? undefined : false);
  if (edited !== text) writeAtomic(configFile, edited);
}
