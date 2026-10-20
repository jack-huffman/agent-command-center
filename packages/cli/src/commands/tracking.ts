// Whether a Salesforce project uses source tracking (T-73): shown, or set by a person in .acc/config.json.

import { AccError, type Config, loadConfig, setSourceTracking, usesSourceTracking } from '../../../core/src/index.ts';
import { type CommandArea, noAgent, type Opts, out, project } from '../shared.ts';

/** Whether the project uses source tracking, in words. */
function trackingLines(config: Config): string {
  if (config.profile !== 'salesforce') return 'Source tracking is a Salesforce setting: this project isn\'t a Salesforce project.';
  return usesSourceTracking(config)
    ? 'source tracking on (project): Setup checks that each Developer sandbox is source tracked, and that the Salesforce CLI knows it.'
    : 'source tracking off (project): this project doesn\'t use source tracking, so Setup skips its source-tracking checks. Retrieves use manifests and deploys use source folders, as always.';
}

function cmdTracking(o: Opts, value: string | undefined): number {
  const { paths } = project(process.cwd());
  const data = (config: Config) => ({ salesforce: config.profile === 'salesforce', sourceTracking: config.profile === 'salesforce' ? usesSourceTracking(config) : null });
  if (value === undefined) {
    const { config } = loadConfig(paths.config);
    out(o, () => trackingLines(config), data(config));
    return 0;
  }
  if (value !== 'on' && value !== 'off') throw new AccError('usage', 'acc tracking [on|off]');
  noAgent(o, 'change whether the project uses source tracking');
  setSourceTracking(paths.config, value === 'on');
  const { config } = loadConfig(paths.config);
  out(o, () => `${trackingLines(config)} Set in .acc/config.json: commit it to share it.`, data(config));
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Setup',
    order: 12,
    lines: `  acc tracking [on|off]                 Whether this Salesforce project uses source tracking. Off, Setup skips
                                        its source-tracking checks (B8). A person's choice`,
  },
  commands: {
    tracking: (o, rest) => {
      if (rest.length > 1) throw new AccError('usage', 'acc tracking [on|off]');
      return cmdTracking(o, rest[0]);
    },
  },
};
