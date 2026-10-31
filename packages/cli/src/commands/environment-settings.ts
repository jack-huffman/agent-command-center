// The pipeline's settings (T-157): the environments in path order, which is the development environment, where
// each goes next, and whether reviewed work merges into the development environment on its own. Shown to
// anyone; changed by a person alone, in .acc/config.json, for them to commit.

import { AccError, autoMergeFor, autoMergeOn, type Config, developmentEnvironment, inPromotionOrder, loadConfig, notMergingWhy, setDevelopmentEnvironment, setNextSteps } from '../../../core/src/index.ts';
import { tone } from '../format.ts';
import { type CommandArea, type Opts, out, personOnly, project } from '../shared.ts';

/** What the pipeline is now: each environment in path order, the development one, and whether it merges on its own. */
function pipelineData(config: Config) {
  const dev = developmentEnvironment(config);
  return {
    development: dev?.name ?? null,
    autoMerge: autoMergeOn(config),
    merges: !!dev && autoMergeFor({ ...config, autonomy: 'review' }, dev.branch),
    why: notMergingWhy(config),
    environments: inPromotionOrder(config.environments).map((e) => ({ name: e.name, branch: e.branch, type: e.type, org: e.org, protected: e.protected, development: e.branch === dev?.branch, next: e.promotesTo })),
  };
}

function pipelineLines(config: Config): string {
  const d = pipelineData(config);
  const rows = d.environments.map((e) => `  ${e.name.padEnd(14)} ${e.type.padEnd(13)} ${(e.org ?? '(no org)').padEnd(18)} ${e.protected ? 'protected ' : e.development ? 'development' : '          '} → ${e.next.join(', ') || '–'}`);
  const merges = config.profile !== 'salesforce'
    ? `This isn't a Salesforce project: acc agents auto-merge says whether its pull requests merge on their own${autoMergeOn(config) ? ' (on)' : ' (off)'}.`
    : d.why ? tone(`Nothing merges on its own: ${d.why}`, 'orange')
      : `Reviewed work merges into ${d.development} on its own, once its builder's deploy to the development org passed, while autopilot is on. Never further.`;
  return [`Environments, in path order${d.development ? `; ${d.development} is the development environment` : ''}:`, ...rows, merges].join('\n');
}

function cmdShow(o: Opts): number {
  const { config } = project(process.cwd());
  out(o, () => pipelineLines(config), pipelineData(config));
  return 0;
}

/** Only a person changes the pipeline: a builder, reviewer or analyst is refused by its role, as for auto-merge. */
function person(o: Opts, what: string): void {
  const role = process.env.ACC_ROLE;
  if (role === 'builder' || role === 'reviewer' || role === 'analyst') throw new AccError('refused', `${role === 'analyst' ? 'An' : 'A'} ${role} can't ${what}. A person does that.`);
  personOnly(o, what);
}

function cmdDevelopment(o: Opts, name: string): number {
  person(o, 'change the development environment');
  const { paths } = project(process.cwd());
  const r = setDevelopmentEnvironment(paths.config, name);
  const { config } = loadConfig(paths.config);
  out(o, () => (r.changed ? `${developmentEnvironment(config)?.name} is the development environment now. Set in .acc/config.json: commit it to share it.\n${pipelineLines(config)}` : `${name} is the development environment already.`), { ...pipelineData(config), changed: r.changed });
  return 0;
}

function cmdNext(o: Opts, name: string, next: string[]): number {
  person(o, 'change where an environment goes next');
  const { paths } = project(process.cwd());
  const r = setNextSteps(paths.config, name, next);
  const { config } = loadConfig(paths.config);
  const env = config.environments.find((e) => e.name.toLowerCase() === name.toLowerCase() || e.branch === name.toLowerCase());
  out(o, () => (r.changed ? `${env?.name} goes to ${env?.promotesTo.join(', ') || 'nowhere further'} now. Set in .acc/config.json: commit it to share it.\n${pipelineLines(config)}` : `${env?.name} already goes to ${env?.promotesTo.join(', ') || 'nowhere further'}.`), { ...pipelineData(config), changed: r.changed });
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Environments',
    order: 52,
    lines: `  acc environments                      The environments in path order: org, type, protected, the development
                                        environment, where each goes next, and whether work merges on its own
  acc environments development <env>    Make <env> the development environment: the default, where work starts
                                        and, in a Salesforce project, where reviewed work merges on its own.
                                        Never Production or a protected environment. A person's change
  acc environments next <env> [<to>...] Where <env>'s work goes next, usual step first; none means nowhere
                                        further. A person's change`,
  },
  subcommands: { environments: ['development', 'next'] },
  commands: {
    environments: (o, rest) => {
      if (!rest.length) return cmdShow(o);
      if (rest[0] === 'development' && rest.length === 2) return cmdDevelopment(o, rest[1]!);
      if (rest[0] === 'next' && rest.length >= 2) return cmdNext(o, rest[1]!, rest.slice(2));
      throw new AccError('usage', 'acc environments [development <env> | next <env> [<to>...]]');
    },
  },
};
