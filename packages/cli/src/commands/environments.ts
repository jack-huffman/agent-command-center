// acc's Environments commands: promote and deploy.

import { AccError, deploy, lastDeploy, planDeploy, planPromotion, promote, run, skipWarning } from '../../../core/src/index.ts';
import { tone } from '../format.ts';
import { type CommandArea, now, type Opts, out, personOnly, project, steps } from '../shared.ts';

function cmdPromote(o: Opts, from: string): number {
  const by = personOnly(o, 'promote');
  const { paths, config } = project(process.cwd());
  const say = (line: string) => { if (!o.json) process.stderr.write(tone(line, 'dim') + '\n'); };
  const show = (p: ReturnType<typeof planPromotion>) => [
    `${p.from.name} (${p.from.branch} at ${p.fromSha.slice(0, 7)}) → ${p.to.name} (${p.to.branch} at ${p.toSha.slice(0, 7)})`,
    ...skipWarning(p).map((l) => tone(`  ! ${l}`, 'orange')),
    `  ${p.files.length} to bring over${p.deleted.length ? tone(`, ${p.deleted.length} to delete`, 'orange') : ''}${p.leftOut.length ? `, ${p.leftOut.length} environment-specific left out` : ''}`,
    ...p.files.slice(0, 20).map((f) => `    ${f}`), ...(p.files.length > 20 ? [`    …and ${p.files.length - 20} more`] : []),
    ...p.deleted.map((f) => tone(`    deletes ${f}`, 'orange')),
  ];
  if (o.plan) {
    const p = planPromotion(paths, config, from, o.to as string | undefined, { run });
    out(o, () => show(p).join('\n'), p);
    return 0;
  }
  const r = promote(paths, config, from, o.to as string | undefined, { run, now, env: process.env, onStep: say, steps: steps() }, { allowDeletions: o['allow-deletions'] === true, validate: o['skip-validate'] !== true, by });
  out(o, () => [
    ...show(r.plan), '', r.pr ? `Opened pull request #${r.pr.number}  ${r.pr.url}` : r.stopped ?? '', r.pr ? tone('It merges only when a person merges it. Deploy after that with acc deploy.', 'dim') : '',
    r.warning ? tone(`! ${r.warning}`, 'orange') : '',
    ...r.updates.map((u) => `  Drafted an update for ${u.key} (${u.id}).`),
    r.updates.length ? tone('Nothing is posted until a person posts it: acc updates.', 'dim') : '',
  ].filter(Boolean).join('\n'), r);
  const code = r.pr || !r.stopped?.startsWith('Validation') ? 0 : 1;
  steps().result(code === 0, r.pr ? `Opened pull request #${r.pr.number} into ${r.plan.to.name}.` : r.stopped ?? 'It finished.');
  return code;
}

function cmdDeploy(o: Opts, envName: string): number {
  const by = personOnly(o, 'deploy');
  const { paths, config } = project(process.cwd());
  const show = (p: ReturnType<typeof planDeploy>) => [
    `${p.env.name} (${p.org}): ${p.env.branch} from ${p.base.slice(0, 7)} to ${p.head.slice(0, 7)}${p.confirm ? tone('  protected: needs --confirm-production', 'orange') : ''}`,
    `  ${p.files.length} to deploy, tests: ${p.testLevel}${p.leftOut.length ? `, ${p.leftOut.length} environment-specific left out` : ''}${p.deleted.length ? tone(`, ${p.deleted.length} deleted (not deployed by acc)`, 'orange') : ''}`,
    ...p.files.slice(0, 20).map((f) => `    ${f}`), ...(p.files.length > 20 ? [`    …and ${p.files.length - 20} more`] : []),
  ];
  if (o.plan) {
    const p = planDeploy(paths, config, envName, { run }, { since: o.since as string | undefined, noTests: o['no-tests'] === true });
    out(o, () => show(p).join('\n'), { ...p, last: lastDeploy(paths, p.env.branch) });
    return 0;
  }
  const r = deploy(paths, config, envName, { run, now, steps: steps(), onWait: () => { if (!o.json) process.stderr.write(tone('Waiting for another heavy check or deploy on this machine to finish…\n', 'dim')); } }, { since: o.since as string | undefined, confirmed: o['confirm-production'] === true, noTests: o['no-tests'] === true, by });
  out(o, () => [
    ...show(r.plan), '', r.deployed ? tone(`✓ ${r.summary}`, 'blue') : r.summary,
    ...r.updates.map((u) => `  Drafted an update for ${u.key} (${u.id}).`),
    r.updates.length ? tone('Nothing is posted until a person posts it: acc updates.', 'dim') : '',
  ].filter(Boolean).join('\n'), r);
  const code = r.deployed || !r.plan.files.length ? 0 : 1;
  steps().result(code === 0, r.summary);
  return code;
}

export const area: CommandArea = {
  help: {
    section: 'Environments',
    order: 50,
    lines: `  acc promote <env> [--to <env>] [--plan] [--allow-deletions] [--skip-validate]
                                        A pull request taking <env>'s merged changes to the next environment
  acc deploy <env> [--plan] [--since <commit>] [--confirm-production] [--no-tests]
                                        Deploy what changed on <env>'s branch since its last deploy to its org`,
  },
  options: {
    to: { type: 'string' },
    plan: { type: 'boolean', default: false },
    'allow-deletions': { type: 'boolean', default: false },
    'skip-validate': { type: 'boolean', default: false },
    since: { type: 'string' },
    'confirm-production': { type: 'boolean', default: false },
    'no-tests': { type: 'boolean', default: false },
  },
  commands: {
    promote: (o, rest) => {
      if (!rest[0]) throw new AccError('usage', 'acc promote <env> [--to <env>]');
      return cmdPromote(o, rest[0]);
    },
    deploy: (o, rest) => {
      if (!rest[0]) throw new AccError('usage', 'acc deploy <env> [--since <commit>] [--confirm-production]');
      return cmdDeploy(o, rest[0]);
    },
  },
};
