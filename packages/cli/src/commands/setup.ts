// acc's Setup commands: doctor, onboard, init, template and setup.

import { existsSync } from 'node:fs';
import { AccError, buildBaseline, configureRepoAccess, describeTemplate, draftLists, makeContext, parseSource, planInit, prepareImports, type Profile, readTemplate, repoPaths, rulesName, run, runSteps, seedBranches, type StepResult, STEPS, templateAccount, writeConfig, writeImport, writeReadme } from '../../../core/src/index.ts';
import { checkLabel, table, tone } from '../format.ts';
import { type CommandArea, now, type Opts, out, personOnly, project, VERSION } from '../shared.ts';

// ---------------------------------------------------------------- setup

function renderSteps(results: StepResult[], guided: boolean): string {
  const lines: string[] = [];
  let part = '';
  for (const { step, result } of results) {
    if (step.part !== part) {
      part = step.part;
      lines.push('', part === 'machine' ? 'This machine' : 'This project');
    }
    lines.push(`  ${checkLabel(result.status)}  ${step.id.padEnd(18)} ${step.title}`);
    if (result.status !== 'pass' && result.status !== 'skip') lines.push(`      ${result.detail}`);
    else if (!guided) lines.push(tone(`      ${result.detail}`, 'dim'));
    if (result.status === 'fail' || result.status === 'unknown') {
      const fix = result.fix ?? step.fix?.command ?? step.fix?.text;
      if (fix) lines.push(`      fix: ${fix}`);
      if (result.open) lines.push(`      open: ${result.open}`);
      if (step.fix?.docs) lines.push(`      docs: ${step.fix.docs}`);
    }
  }
  const failing = results.filter((r) => r.result.status === 'fail');
  const byHand = results.filter((r) => r.result.status === 'unknown');
  const passed = results.filter((r) => r.result.status === 'pass').length;
  lines.push('', `${passed} passed, ${failing.length} failing, ${byHand.length} to check by hand.`);
  if (guided && failing[0]) {
    const { step, result } = failing[0];
    lines.push('', tone(`Next: ${step.id}, ${step.title}`, 'orange'), `  Why: ${step.why}`, `  Do:  ${result.fix ?? step.fix?.command ?? step.fix?.text ?? `see ${step.fix?.docs ?? 'docs/ONBOARDING.md'}`}`);
  }
  return lines.join('\n').replace(/^\n/, '');
}

function cmdDoctor(o: Opts, guided: boolean): number {
  const ctx = makeContext(process.cwd(), run, process.env, VERSION);
  const part = o.part as 'machine' | 'project' | undefined;
  if (part && part !== 'machine' && part !== 'project') throw new AccError('usage', '--part must be machine or project.');
  const only = (o.step as string[] | undefined) ?? [];
  const unknownIds = only.filter((id) => !STEPS.some((s) => s.id === id));
  if (unknownIds.length) throw new AccError('usage', `No step ${unknownIds.join(', ')}. Run acc doctor to see them all.`);
  const results = runSteps(ctx, part, only);
  out(o, () => renderSteps(results, guided), results.map(({ step, result }) => ({
    id: step.id, part: step.part, group: step.group, title: step.title, why: step.why,
    status: result.status, detail: result.detail, fix: result.fix ?? null, howTo: step.fix ?? null, open: result.open ?? null,
  })));
  return results.some((r) => r.result.status === 'fail') ? 1 : 0;
}

function cmdInit(o: Opts): number {
  const paths = repoPaths(process.cwd(), run);
  const profile = o.profile as Profile | undefined;
  if (profile !== undefined && profile !== 'generic' && profile !== 'salesforce') throw new AccError('usage', '--profile must be generic or salesforce.');
  if (existsSync(paths.config) && !o.force && !o['dry-run']) throw new AccError('exists', `${paths.config} already exists. Use --force to replace it.`);
  const plan = planInit(run, {
    root: paths.root,
    profile,
    from: o.from as string | undefined,
    cwd: process.cwd(),
    project: o.project as string | undefined,
    productionOrg: o['production-org'] as string | undefined,
    githubRepo: o['github-repo'] as string | undefined,
    githubAccount: o['github-account'] as string | undefined,
    commitName: o['commit-name'] as string | undefined,
    commitEmail: o['commit-email'] as string | undefined,
    jiraSite: o['jira-site'] as string | undefined,
    jiraProject: o['jira-project'] as string | undefined,
  });
  // The template's rules (GH-108): each read before anything is written, so one that can't be read writes
  // nothing, then copied in as acc rules import would. A copy already here is kept; a dry run reads none.
  const rules = plan.rules.map((source) => ({ source, name: rulesName(source) }));
  const copies = o['dry-run'] ? [] : prepareImports(run, paths.root, plan.rules, { account: plan.readAs, base: process.cwd(), now });
  const kept = copies.filter((c) => c.replaces);
  if (!o['dry-run']) {
    writeConfig(paths.config, plan.config);
    for (const c of copies) if (!c.replaces) writeImport(c);
    if (o['configure-git'] && plan.config.github) configureRepoAccess(run, paths.root, plan.config.github.account, plan.config.commitIdentity);
  }
  const ruleRows = rules.map((r) => {
    const c = copies.find((x) => x.name === r.name);
    return { source: r.source, file: `.acc/rules/${r.name}.md`, written: !!c && !c.replaces, commit: c?.header.commit ?? null };
  });
  out(o, () => {
    const c = plan.config;
    const rows = [['Environment', 'Branch', 'Type', 'Org alias', 'Promotes to'], ...c.environments.map((e) => [
      e.name + (e.default ? ' (default)' : '') + (e.protected ? ' (protected)' : ''), e.branch, e.type, e.org ?? '(not logged in)', e.promotesTo.join(', ') || '–',
    ])];
    const commands = Object.entries(plan.templateCommands);
    return [
      `${o['dry-run'] ? 'Would write' : 'Wrote'} ${paths.config}`,
      '',
      table(rows),
      '',
      `GitHub: ${c.github ? `${c.github.repo} as ${c.github.account}` : '(none)'}   Commits: ${c.commitIdentity ? `${c.commitIdentity.name} <${c.commitIdentity.email}>` : '(not set)'}`,
      ...(c.template ? [
        `From the template ${c.template.name}: ${plan.fromTemplate.join(', ') || 'nothing'}`,
        `Discovered: ${plan.discovered.join(', ')}`,
      ] : []),
      ...(commands.length ? ['', 'Check commands from the template, which run on this machine:', ...commands.map(([gate, cmd]) => `  ${gate}: ${cmd}`)] : []),
      ...(ruleRows.length ? [
        '', `Rules from the template, ${o['dry-run'] ? 'which it would copy' : 'copied'} into .acc/rules/ for you to review and commit:`,
        ...ruleRows.map((r) => `  ${r.file}: ${r.source}${r.written || o['dry-run'] ? '' : ' (already here, so it\'s kept)'}`),
      ] : []),
      ...kept.map((c) => `note: ${c.file} is already here, so it's kept. acc rules import <source> --name ${c.name} --force replaces it.`),
      ...plan.notes.map((n) => `note: ${n}`),
      '',
      'Next: acc doctor',
    ].join('\n');
  }, {
    written: !o['dry-run'], path: paths.config, config: plan.config, notes: plan.notes,
    template: plan.config.template ?? null, fromTemplate: plan.fromTemplate, discovered: plan.discovered, templateCommands: plan.templateCommands, rules: ruleRows,
  });
  return 0;
}

/**
 * What a team template sets, before anything is written (GH-80). A GitHub one is read as acc init --from
 * reads it (templateAccount): --github-account, else the account a GitHub origin pushes as, else gh's
 * active one. Exits 1 listing its problems.
 */
function cmdTemplate(o: Opts, sub: string | undefined, source: string | undefined): number {
  if (sub !== 'show' || !source) throw new AccError('usage', 'acc template show <path | GitHub file URL | git-url#path> [--json]');
  // Only gh needs an account: a path or a git URL never reads the credential.
  let account: string | null = null;
  if (parseSource(source).kind === 'github') {
    let root: string | null = null;
    try {
      root = repoPaths(process.cwd(), run).root;
    } catch {
      root = null;
    }
    account = templateAccount(run, root, o['github-account'] as string | undefined);
  }
  const r = readTemplate(run, source, { account, base: process.cwd() });
  const t = r.template;
  if (!t) {
    out(o, () => [tone(`✗ ${source} isn't a team template acc can use:`, 'orange'), ...r.errors.map((e) => `  - ${e}`)].join('\n'), { source, ok: false, errors: r.errors });
    return 1;
  }
  const commands = Object.entries(t.gates?.commands ?? {});
  const sets = describeTemplate(t);
  out(o, () => [
    t.name,
    ...(t.description ? [t.description] : []),
    '',
    ...(sets.length ? sets : ['It sets nothing: acc init would use what it discovers.']),
    ...(commands.length ? ['', 'Check commands, which run on each machine that uses it:', ...commands.map(([gate, cmd]) => `  ${gate}: ${cmd}`)] : []),
    '',
    `Start a project from it: acc init --from '${source.replace(/'/g, `'\\''`)}'${t.profile === 'salesforce' ? ' --production-org <alias>' : ''}`,
  ].join('\n'), { source, ok: true, errors: [], name: t.name, description: t.description, profile: t.profile, digest: r.digest, sets, commands: t.gates?.commands ?? {}, rules: t.rules ?? [], template: t });
  return 0;
}

/** The walkthrough's guided steps (D-035). */
function cmdSetup(o: Opts, what: string | undefined): number {
  const { paths, config } = project(process.cwd());
  const say = (line: string) => { if (!o.json) process.stderr.write(tone(line, 'dim') + '\n'); };
  const deps = { run, now, onStep: say };
  if (what === 'baseline') {
    const r = buildBaseline(paths, config, deps);
    out(o, () => `Wrote ${r.file}: ${r.members} components of ${r.types} types, from ${r.from.join(', ')}.\nCommit it on every environment's branch, so each is retrieved with the same list.`, r);
    return 0;
  }
  if (what === 'branches') {
    personOnly(o, 'make environment branches');
    const r = seedBranches(paths, config, deps, { push: o.push === true });
    out(o, () => (r.length ? r.map((b) => `  ${b.status === 'made' ? '✓' : '✗'} ${b.branch.padEnd(16)} ${b.note}${b.differs !== null ? `; ${b.differs} files differ from production` : ''}`).join('\n') : 'Every environment already has its branch.'), r);
    return r.some((b) => b.status === 'failed') ? 1 : 0;
  }
  if (what === 'lists') {
    const r = draftLists(paths, config, deps);
    const show = (label: string, d: typeof r.knownDrift) => `${d.written ? 'Wrote' : 'Kept'} ${d.file}${d.written ? ` with ${d.entries.length} ${label}` : d.entries.length ? `; consider adding ${d.entries.length}: ${d.entries.slice(0, 5).join(', ')}${d.entries.length > 5 ? ', …' : ''}` : ''}.`;
    out(o, () => [
      show('environment-specific paths', r.environmentSpecific), show('known-drift paths', r.knownDrift),
      ...r.unexplained.map((u) => `  ${u.branch}: ${u.files.length} other difference${u.files.length === 1 ? '' : 's'} from production that neither list explains: real drift, or work in progress. ${u.files.slice(0, 5).join(', ')}${u.files.length > 5 ? ', …' : ''}`),
      'Read both lists before committing them: each line keeps a file out of promotions (environment-specific) or out of drift checks (known drift).',
    ].join('\n'), r);
    return 0;
  }
  if (what === 'readme') {
    const r = writeReadme(paths, config);
    out(o, () => `${r.created ? 'Wrote' : r.replaced ? 'Updated the environments section of' : 'Added an environments section to'} ${r.file}. Keep it the same on every non-production branch.`, r);
    return 0;
  }
  throw new AccError('usage', 'acc setup baseline | branches [--push] | lists | readme');
}

export const area: CommandArea = {
  help: {
    section: 'Setup',
    order: 10,
    lines: `  acc doctor [--part machine|project] [--step <id>]...
                                        Check the onboarding steps and print the fixes
  acc onboard                           The same checks as a guided list, with the next step to do
  acc setup baseline                    B5: one manifest of every component on every environment branch
  acc setup branches [--push]           B6: make each missing environment branch, seeded from its org
  acc setup lists                       B9: draft the environment-specific and known-drift lists
  acc setup readme                      B10: write the README's environments table
  acc init --profile salesforce --production-org <alias> [--project <name>] [--github-repo <o/r>]
           [--github-account <a>] [--commit-name <n> --commit-email <e>] [--configure-git]
           [--jira-site <site> --jira-project <key>] [--dry-run] [--force]
  acc init --profile generic [...]
  acc init --from <template> [--production-org <alias>] [...]
                                        Start from a team template: a path, a GitHub file URL, or <git-url>#<path>.
                                        It wins where it speaks, and discovery fills the rest; flags win over both
  acc template show <template>          What a team template sets, and its check commands, before using it`,
  },
  options: {
    part: { type: 'string' },
    step: { type: 'string', multiple: true },
    profile: { type: 'string' },
    project: { type: 'string' },
    'production-org': { type: 'string' },
    'github-repo': { type: 'string' },
    'github-account': { type: 'string' },
    'commit-name': { type: 'string' },
    'commit-email': { type: 'string' },
    'configure-git': { type: 'boolean', default: false },
    'jira-site': { type: 'string' },
    'jira-project': { type: 'string' },
    from: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    push: { type: 'boolean', default: false },
  },
  commands: {
    doctor: (o) => cmdDoctor(o, false),
    onboard: (o) => cmdDoctor(o, true),
    init: (o) => cmdInit(o),
    template: (o, rest) => cmdTemplate(o, rest[0], rest[1]),
    setup: (o, rest) => cmdSetup(o, rest[0]),
  },
};
