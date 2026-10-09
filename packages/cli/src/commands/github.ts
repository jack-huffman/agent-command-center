// acc's GitHub commands: which account the repo works as, and switching it for this clone.

import { AccError, githubIdentity, loadConfig, repoPaths, run, useGithubAccount } from '../../../core/src/index.ts';
import { tone } from '../format.ts';
import { type CommandArea, type Opts, out } from '../shared.ts';

// ---------------------------------------------------------------- GitHub identity (D-028)

function renderIdentity(id: NonNullable<ReturnType<typeof githubIdentity>>): string {
  const scopes = id.accounts?.find((a) => a.login.toLowerCase() === id.account.toLowerCase())?.scopes ?? [];
  return [
    `${id.repo} works as ${id.account}${id.from === 'clone' ? ` (this clone's choice; the project's is ${id.projectAccount})` : ' (the project\'s account)'}`,
    `  gh:      ${id.signedIn ? `${tone('✓', 'blue')} logged in${scopes.length ? `, ${scopes.join(', ')}` : ''}` : tone(`✗ not logged in as ${id.account}`, 'orange')}`,
    `  push:    ${id.pushesAs ? (id.pushesAs.toLowerCase() === id.account.toLowerCase() ? `${tone('✓', 'blue')} as ${id.pushesAs}` : tone(`✗ as ${id.pushesAs}`, 'orange')) : tone('? not set up by acc', 'orange')}`,
    `  commits: ${id.commit.name || id.commit.email ? `${id.commit.name ?? '?'} <${id.commit.email ?? '?'}>` : tone('no identity set for this repo', 'orange')}`,
    id.accounts && id.accounts.length > 1 ? `  others:  ${id.accounts.filter((a) => a.login !== id.account).map((a) => a.login).join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

function cmdGithub(o: Opts, sub: string | undefined, arg: string | undefined): number {
  const paths = repoPaths(process.cwd(), run);
  const { config } = loadConfig(paths.config);
  if (sub === 'status' || !sub) {
    const id = githubIdentity(config, paths.root, run);
    if (!id) throw new AccError('no-github', 'This project has no "github" section in .acc/config.json.');
    out(o, () => renderIdentity(id), id);
    return id.signedIn && id.pushesAs?.toLowerCase() === id.account.toLowerCase() ? 0 : 1;
  }
  if (sub === 'use') {
    if (!arg && !o.default) throw new AccError('usage', 'acc github use <account>, or --default for the project\'s account');
    const id = useGithubAccount(config, paths.root, run, o.default ? null : arg!);
    out(o, () => renderIdentity(id), id);
    return 0;
  }
  throw new AccError('usage', 'acc github status | acc github use <account> | acc github use --default');
}

export const area: CommandArea = {
  help: {
    section: 'GitHub',
    order: 60,
    lines: `  acc github status                     Which account this repo works as, and whether gh and git push agree
  acc github use <account> | --default  Work as another logged-in account in this clone only; nothing committed changes`,
  },
  options: {
    default: { type: 'boolean', default: false },
  },
  subcommands: { github: ['status', 'use'] },
  commands: {
    github: (o, rest) => cmdGithub(o, rest[0], rest[1]),
  },
};
