// Whether a Salesforce project uses source tracking (T-73). Most do. A project that doesn't still works:
// retrieves use manifests and deploys use source folders, so only Setup's tracking steps need to know.

import { type Config, loadConfig } from './config.ts';
import { writeJsonKey } from './config-edit.ts';
import { AccError } from './exec.ts';

/** Whether the project uses source tracking: yes unless its config says false. */
export const usesSourceTracking = (config: Pick<Config, 'sourceTracking'>): boolean => config.sourceTracking !== false;

/** Why Setup's source-tracking steps skip in a project that doesn't use it, and where a person changes that. */
export const NO_TRACKING_REASON = 'This project doesn\'t use source tracking, so there\'s nothing to check. To change that, turn on Source tracking under Limits and checks in the project\'s settings.';

/**
 * Sets whether a Salesforce project uses source tracking, in its .acc/config.json, and nothing else there.
 * On is the default, so on takes the key out; off writes false. A project that isn't Salesforce is refused.
 */
export function setSourceTracking(configFile: string, on: boolean): void {
  const { config } = loadConfig(configFile);
  if (config.profile !== 'salesforce') throw new AccError('refused', 'Source tracking is a Salesforce setting: this project isn\'t a Salesforce project.');
  writeJsonKey(configFile, ['sourceTracking'], on ? undefined : false);
}
