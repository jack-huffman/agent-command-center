/**
 * What the Connect page asks for each tracker (GH-51): where it is, how to sign in, and how its place and
 * board are picked. The page has no tracker of its own: it draws whatever a description says, so
 * connecting another tracker means writing its client and its description here, not another page, as
 * monday.com's was. Nothing here reaches VSCode: a Microsoft sign-in and gh are methods a description
 * names, and the extension carries out.
 */
import type { Tracker } from '../config.ts';
import { azureAreas, azureBoards, azureProjects, azureTeams, azureWhoAmI, tenantOf } from './azure.ts';
import { GithubClient } from './github.ts';
import { JiraClient, jiraBoards, jiraEpics, jiraProjects } from './jira.ts';
import { mondayBoards, mondayGroups, mondayMe, mondayStatusColumns, mondayTokenPage } from './monday.ts';
import { slackApp, slackChannels } from './slack.ts';
import { type Exec, type Person, TrackerError } from './types.ts';

/** One thing to type: an email, or a token, which the page shows as a password field and never keeps. */
export interface FieldSpec {
  key: string;
  label: string;
  type: 'text' | 'email' | 'secret';
  placeholder: string;
  hint?: string;
  /** Filled in from the repo: its git config user.email. */
  prefill?: 'git-email';
  /** Why the value won't do, or null. */
  check?: (v: string) => string | null;
  /** A button beside the field that opens a page, such as where the token is made. Without a URL yet (its host isn't known), no button. */
  help?: { label: string; url: (host: string) => string | null };
}

/** Where the tracker is: a Jira site, a GitHub repo, an Azure DevOps organization, a monday.com account. It's what a sign-in is for (D-027). */
export interface HostSpec {
  key: string;
  label: string;
  placeholder: string;
  hint: string;
  /** The value as the config keeps it, from anything a person pastes, or null. */
  parse: (input: string) => string | null;
  /** What to say when parse refuses it. */
  invalid: string;
  /** Filled in with the project's own GitHub repo. */
  prefill?: 'github-repo';
}

/**
 * A way to sign in. `fields`: typed on the page and checked with verify. `microsoft`: VSCode's Microsoft
 * sign-in, in the tenant that owns the host. `gh`: the project's own GitHub account through gh (D-007).
 */
export interface SignInMethod {
  id: string;
  label: string;
  icon: string;
  via: 'fields' | 'microsoft' | 'gh';
  fields: FieldSpec[];
  hint: string;
  /** The button that signs in and checks it. */
  test: string;
  /** For `microsoft`: the resource to ask for, and the tenant that owns the host. */
  microsoft?: { scope: string; tenant: (host: string, f?: typeof fetch) => Promise<string | null> };
}

/** A sign-in as the description's checks and lists use it. The extension builds it; it's never posted to the page. */
export interface SignIn {
  method: string;
  /** What a `fields` sign-in typed, such as the email and token. */
  fields: Record<string, string>;
  /** An Authorization header from a sign-in the extension carried out, such as Microsoft's. */
  header: string | null;
  /** The project's gh account and its token. */
  gh: { account: string; token: string } | null;
}

export type Values = Record<string, string | string[] | null>;

/** What a check or a list gets: where, who, and what's picked so far. */
export interface Ctx {
  host: string;
  signIn: SignIn;
  values: Values;
  fetch?: typeof fetch;
  exec: Exec;
}

export interface Option {
  value: string;
  label: string;
  detail?: string;
  /** The tracker's own default, which the config names by leaving it out, such as a project's default team. */
  default?: boolean;
  /** The one to choose when nothing is chosen yet, such as the stories board. */
  preferred?: boolean;
}

/** One list the place and board are picked from, in order. */
export interface PickerSpec {
  key: string;
  label: string;
  /** The pickers whose choice this list depends on. */
  dependsOn: string[];
  /** The choice that takes the whole project, listed first. Chosen, the config leaves the place out (D-072). `labels` names what's chosen. */
  whole?: (c: { host: string; values: Values; labels?: Record<string, string | null> }) => string;
  /** Several can be ticked, as GitHub labels are. None ticked is the whole. */
  multi?: boolean;
  /** It names which tracker this is, so an existing tracker shows it fixed: another project is another tracker. */
  identifies?: boolean;
  /** Its values are ids, not names: an existing tracker's fixed choice still loads the list, to show its name. */
  idValues?: boolean;
  /** Drawn only when there's a choice to make: a list of one is chosen without being shown. */
  hideSingle?: boolean;
  /** What the tracker does without a choice, when its list couldn't load: then Save needn't wait for it. */
  fallback?: string;
  hint?: string;
  load: (ctx: Ctx) => Promise<Option[]>;
}

/** What Save hands a description to write. */
export interface Chosen {
  host: string;
  values: Values;
  /** Pickers whose choice is the tracker's own default, which the config leaves out. */
  defaults: string[];
  /** The project's own GitHub repo, which a GitHub tracker names by leaving repo out. */
  ownRepo: string | null;
}

/**
 * Which of a tracker's lists narrows it to part of a project, as an epic does in Jira (D-072), and the words
 * the page shows for it. A project started from an epic picks this one (GH-81).
 */
export interface PlaceSpec {
  /** One of the description's pickers. */
  key: string;
  /** What stands in for an epic here, said on the page: "In Azure DevOps an area path stands in for an epic". */
  words: string;
}

export interface TrackerDescription {
  kind: string;
  name: string;
  icon: string;
  host: HostSpec;
  methods: SignInMethod[];
  pickers: PickerSpec[];
  /** The picker that stands in for an epic (GH-81). */
  place: PlaceSpec;
  /** The Connect page's third step, where this tracker's own word is better than the usual "Its tickets and board" (T-43). */
  listsTitle?: string;
  /** Who the sign-in is, or a TrackerError saying why not. */
  verify: (ctx: Ctx) => Promise<Person>;
  /** The tracker as .acc/config.json keeps it. A key set to null is taken out of an existing one. */
  toConfig: (c: Chosen) => Record<string, unknown>;
  /** An existing tracker's host and choices, to open it on the page. */
  fromConfig: (t: Tracker, ownRepo: string | null) => { host: string; values: Values };
}

/**
 * A tracker's host from anything a person pastes: a Jira site or any URL on it, an Azure DevOps
 * organization or any URL in it, a monday.com account or a Slack workspace, or any URL in it. Null when
 * it's none of them.
 */
export function parseHost(kind: 'jira' | 'azure' | 'monday' | 'slack', input: string): string | null {
  const s = input.trim().replace(/^https?:\/\//, '');
  if (kind === 'monday' || kind === 'slack') {
    const at = kind === 'monday' ? /^([a-z0-9][a-z0-9-]*)\.monday\.com(?:[/?#]|$)/i : /^([a-z0-9][a-z0-9-]*)\.slack\.com(?:[/?#]|$)/i;
    const m = at.exec(s) ?? /^([a-z0-9][a-z0-9-]*)$/i.exec(s);
    return m ? m[1]!.toLowerCase() : null;
  }
  if (kind === 'azure') {
    const m = /^dev\.azure\.com\/([^/?#]+)/i.exec(s) ?? /^([^./?#]+)\.visualstudio\.com/i.exec(s) ?? /^([A-Za-z0-9][A-Za-z0-9-]*)$/.exec(s);
    return m ? decodeURIComponent(m[1]!) : null;
  }
  const m = /^([a-z0-9-]+\.atlassian\.net)/i.exec(s) ?? /^([a-z0-9-]+)$/i.exec(s);
  return m ? (m[1]!.includes('.') ? m[1]!.toLowerCase() : `${m[1]!.toLowerCase()}.atlassian.net`) : null;
}

/** owner/name, from itself or a github.com URL. */
export function parseRepo(input: string): string | null {
  const s = input.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const m = /^([\w.-]+\/[\w.-]+)(?:\/.*)?$/.exec(s);
  return m ? m[1]! : null;
}

export const JIRA_TOKENS = 'https://id.atlassian.com/manage-profile/security/api-tokens';
/** Azure DevOps' own resource, as a Microsoft sign-in scope. */
export const AZURE_SCOPE = '499b84ac-1321-427f-aa17-267ca6975798/.default';

const one = (v: string | string[] | null | undefined): string | null => (typeof v === 'string' && v ? v : null);
const many = (v: string | string[] | null | undefined): string[] => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []);
const b64 = (s: string): string => Buffer.from(s).toString('base64');
/** The Authorization header an Azure DevOps sign-in gives: Microsoft's, or a personal access token's. */
const azureAuth = (s: SignIn): string => s.header ?? `Basic ${b64(`:${s.fields.token ?? ''}`)}`;
/** The token the person signed in with: monday.com's and Slack's only field, and half of Jira's. */
const tokenOf = (ctx: Ctx): string => ctx.signIn.fields.token ?? '';
const jiraWith = (ctx: Ctx) => ({ email: ctx.signIn.fields.email ?? '', token: tokenOf(ctx) });
const github = (ctx: Ctx): GithubClient => {
  if (!ctx.signIn.gh) throw new Error('GitHub signs in through gh, as the project\'s account.');
  return new GithubClient({ repo: ctx.host, token: ctx.signIn.gh.token, account: ctx.signIn.gh.account, exec: ctx.exec });
};

export const JIRA: TrackerDescription = {
  kind: 'jira', name: 'Jira', icon: 'issues',
  host: {
    key: 'site', label: 'Site', placeholder: 'acme.atlassian.net', hint: 'The Jira site, or any link from it.',
    parse: (v) => parseHost('jira', v), invalid: 'A Jira Cloud site, such as acme.atlassian.net, or a link from it.',
  },
  methods: [{
    id: 'token', label: 'API token', icon: 'key', via: 'fields', test: 'Test connection',
    hint: 'Jira takes your email and an API token. The token stays in VSCode on this machine, never in the repo.',
    fields: [
      { key: 'email', label: 'Email', type: 'email', placeholder: 'you@example.com', prefill: 'git-email', hint: 'The email you sign in to Jira with.', check: (v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? null : 'An email address, the one you sign in to Jira with.') },
      { key: 'token', label: 'API token', type: 'secret', placeholder: 'Paste the token', check: (v) => (v.trim().length >= 16 ? null : 'Paste the whole token.'), help: { label: 'Create an API token', url: () => JIRA_TOKENS } },
    ],
  }],
  pickers: [
    { key: 'project', label: 'Project', dependsOn: [], identifies: true, load: async (ctx) => (await jiraProjects(ctx.host, jiraWith(ctx).email, jiraWith(ctx).token, ctx.fetch)).map((p) => ({ value: p.key, label: p.key, detail: p.name })) },
    {
      key: 'epic', label: 'Epic', dependsOn: ['project'], whole: (c) => `The whole ${one(c.values.project) ?? ''} project`,
      hint: 'Pick an epic to take only its tickets and their sub-tasks.',
      load: async (ctx) => (await jiraEpics(ctx.host, one(ctx.values.project)!, jiraWith(ctx).email, jiraWith(ctx).token, ctx.fetch)).map((e) => ({ value: e.key, label: e.key, detail: e.name })),
    },
    {
      key: 'board', label: 'Board', dependsOn: ['project'], hint: 'Its columns are the Tasks tab\'s. Its own filter still applies, so pick one that shows the place\'s tickets.',
      fallback: 'Without one, the Tasks tab shows the project\'s first board.',
      load: async (ctx) => (await jiraBoards(ctx.host, one(ctx.values.project)!, jiraWith(ctx).email, jiraWith(ctx).token, ctx.fetch)).map((b, i) => ({ value: String(b.id), label: b.name, detail: b.type, preferred: i === 0 })),
    },
  ],
  place: { key: 'epic', words: 'In Jira, it\'s the epic itself: only its child tickets and their sub-tasks are this project\'s.' },
  verify: (ctx) => new JiraClient({ site: ctx.host, project: '', ...jiraWith(ctx), fetch: ctx.fetch }).me(),
  toConfig: (c) => ({ kind: 'jira', site: c.host, project: one(c.values.project), board: one(c.values.board) ? Number(one(c.values.board)) : null, epic: one(c.values.epic) }),
  fromConfig: (t) => ({ host: t.site ?? '', values: { project: t.project, epic: t.epic, board: t.board === null ? null : String(t.board) } }),
};

export const GITHUB: TrackerDescription = {
  kind: 'github', name: 'GitHub Issues', icon: 'github',
  host: {
    key: 'repo', label: 'Repository', placeholder: 'owner/name', hint: 'Whose issues to show: the project\'s own repo, or another.',
    parse: parseRepo, invalid: 'owner/name, or a github.com link to the repo.', prefill: 'github-repo',
  },
  methods: [{
    id: 'gh', label: 'GitHub CLI', icon: 'github', via: 'gh', fields: [], test: 'Test connection',
    hint: 'GitHub signs in through gh, as the project\'s own account. There\'s nothing to type.',
  }],
  pickers: [{
    key: 'labels', label: 'Labels', dependsOn: [], multi: true, whole: (c) => `Every issue in ${c.host}`,
    hint: 'Tick labels to take only issues with one of them. Tick none for every issue.',
    load: async (ctx) => (await github(ctx).labels()).map((l) => ({ value: l.name, label: l.name })),
  }],
  place: { key: 'labels', words: 'In GitHub, labels stand in for an epic: only issues with one of them are this project\'s.' },
  verify: (ctx) => github(ctx).me(),
  toConfig: (c) => ({ kind: 'github', repo: c.ownRepo && c.host.toLowerCase() === c.ownRepo.toLowerCase() ? null : c.host, labels: many(c.values.labels).length ? many(c.values.labels) : null }),
  fromConfig: (t, ownRepo) => ({ host: t.repo ?? ownRepo ?? '', values: { labels: t.labels.length ? t.labels : null } }),
};

export const AZURE: TrackerDescription = {
  kind: 'azure', name: 'Azure DevOps', icon: 'azure-devops',
  host: {
    key: 'organization', label: 'Organization', placeholder: 'acme', hint: 'The organization, as in dev.azure.com/acme, or any link from it.',
    parse: (v) => parseHost('azure', v), invalid: 'An organization name, or a dev.azure.com link.',
  },
  methods: [
    {
      id: 'microsoft', label: 'Sign in with Microsoft', icon: 'account', via: 'microsoft', fields: [], test: 'Sign in with Microsoft',
      hint: 'VSCode asks which Microsoft account at the top of the window: pick the one that belongs to this client. It handles MFA, and there\'s no token to renew.',
      microsoft: { scope: AZURE_SCOPE, tenant: tenantOf },
    },
    {
      id: 'pat', label: 'Personal access token', icon: 'key', via: 'fields', test: 'Test connection',
      hint: 'For an organization whose tenant blocks VSCode\'s sign-in. Give the token Work Items: Read & write.',
      fields: [{
        key: 'token', label: 'Personal access token', type: 'secret', placeholder: 'Paste the token', check: (v) => (v.trim().length >= 20 ? null : 'Paste the whole token.'),
        help: { label: 'Create a token', url: (host) => (host ? `https://dev.azure.com/${encodeURIComponent(host)}/_usersSettings/tokens` : null) },
      }],
    },
  ],
  pickers: [
    { key: 'project', label: 'Project', dependsOn: [], identifies: true, load: async (ctx) => (await azureProjects(ctx.host, azureAuth(ctx.signIn), ctx.fetch)).map((p) => ({ value: p, label: p })) },
    { key: 'team', label: 'Team', dependsOn: ['project'], hint: 'Whose board.', load: async (ctx) => (await azureTeams(ctx.host, one(ctx.values.project)!, azureAuth(ctx.signIn), ctx.fetch)).map((t, i) => ({ value: t, label: t, ...(i === 0 ? { detail: 'default team', default: true } : {}) })) },
    {
      key: 'board', label: 'Board', dependsOn: ['project', 'team'], hint: 'Usually the stories or backlog items one.',
      load: async (ctx) => (await azureBoards(ctx.host, one(ctx.values.project)!, one(ctx.values.team)!, azureAuth(ctx.signIn), ctx.fetch)).map((b) => ({ value: b, label: b, preferred: /stor|backlog item|requirement/i.test(b) })),
    },
    {
      key: 'areaPath', label: 'Area path', dependsOn: ['project', 'team'], whole: (c) => `All of ${one(c.values.team) ?? 'the team'}'s work items`,
      hint: 'Pick an area path to take only the work items under it.',
      load: async (ctx) => (await azureAreas(ctx.host, one(ctx.values.project)!, one(ctx.values.team)!, azureAuth(ctx.signIn), ctx.fetch)).map((a) => ({ value: a, label: a })),
    },
  ],
  place: { key: 'areaPath', words: 'In Azure DevOps, an area path stands in for an epic: only the work items under it are this project\'s.' },
  verify: (ctx) => azureWhoAmI(ctx.host, azureAuth(ctx.signIn), ctx.fetch),
  toConfig: (c) => ({ kind: 'azure', organization: c.host, project: one(c.values.project), team: c.defaults.includes('team') ? null : one(c.values.team), board: one(c.values.board), areaPath: one(c.values.areaPath) }),
  fromConfig: (t) => ({ host: t.organization ?? '', values: { project: t.project, team: t.team, board: typeof t.board === 'string' ? t.board : null, areaPath: t.areaPath } }),
};


export const MONDAY: TrackerDescription = {
  kind: 'monday', name: 'monday.com', icon: 'table',
  host: {
    key: 'account', label: 'Account', placeholder: 'acme', hint: 'The account, as in acme.monday.com, or any link from it.',
    parse: (v) => parseHost('monday', v), invalid: 'An account name, such as acme, or a link from acme.monday.com.',
  },
  methods: [{
    id: 'token', label: 'API token', icon: 'key', via: 'fields', test: 'Test connection',
    hint: 'monday.com takes a personal API token. It sees what you see in monday.com, and stays in VSCode on this machine, never in the repo.',
    fields: [{
      key: 'token', label: 'API token', type: 'secret', placeholder: 'Paste the token', check: (v) => (v.trim().length >= 20 ? null : 'Paste the whole token.'),
      help: { label: 'Create a token', url: (host) => (host ? mondayTokenPage(host) : null) },
    }],
  }],
  pickers: [
    {
      key: 'board', label: 'Board', dependsOn: [], identifies: true, idValues: true,
      load: async (ctx) => (await mondayBoards(tokenOf(ctx), ctx.fetch)).map((b) => ({ value: b.id, label: b.name, detail: b.workspace })),
    },
    {
      key: 'group', label: 'Group', dependsOn: ['board'], whole: (c) => `Every group on ${c.labels?.board ?? 'the board'}`,
      hint: 'Pick a group to take only its items.',
      load: async (ctx) => (await mondayGroups(one(ctx.values.board)!, tokenOf(ctx), ctx.fetch)).map((g) => ({ value: g.id, label: g.title })),
    },
    {
      key: 'statusColumn', label: 'Status column', dependsOn: ['board'], hideSingle: true, hint: 'Its labels are the Tasks tab\'s columns.',
      fallback: 'Without one, the board uses its column called Status, or its first status column.',
      load: async (ctx) => (await mondayStatusColumns(one(ctx.values.board)!, tokenOf(ctx), ctx.fetch)).map((c) => ({ value: c.id, label: c.title, detail: c.labels.join(', '), ...(c.usual ? { default: true } : {}) })),
    },
  ],
  place: { key: 'group', words: 'On monday.com, a group stands in for an epic: only its items are this project\'s.' },
  verify: async (ctx) => {
    const me = await mondayMe(tokenOf(ctx), ctx.fetch);
    // A token is one account's: one from another would show another client's boards.
    if (me.account && me.account !== ctx.host) throw new TrackerError('auth', `This token is for the monday.com account ${me.account}, not ${ctx.host}. Make one in ${ctx.host}.monday.com, or change the account above.`);
    return { id: me.id, name: me.name };
  },
  toConfig: (c) => ({
    kind: 'monday', account: c.host, board: one(c.values.board) ? Number(one(c.values.board)) : null, group: one(c.values.group),
    statusColumn: c.defaults.includes('statusColumn') ? null : one(c.values.statusColumn),
  }),
  fromConfig: (t) => ({ host: t.account ?? '', values: { board: t.board === null ? null : String(t.board), group: t.group, statusColumn: t.statusColumn } }),
};

/** Where a Slack app is made, and its bot token copied from (its OAuth & Permissions page). */
export const SLACK_APPS = 'https://api.slack.com/apps';
/** What a Slack app's bot token starts with. A user token (xoxp-) would post as the person, not the app. */
export const SLACK_BOT_TOKEN = 'xoxb-';


export const SLACK: TrackerDescription = {
  kind: 'slack', name: 'Slack', icon: 'comment-discussion', listsTitle: 'Its channel',
  host: {
    key: 'workspace', label: 'Workspace', placeholder: 'acme', hint: 'The workspace, as in acme.slack.com, or any link from it.',
    parse: (v) => parseHost('slack', v), invalid: 'A workspace name, such as acme, or a link from acme.slack.com.',
  },
  methods: [{
    id: 'token', label: 'Bot token', icon: 'key', via: 'fields', test: 'Test connection',
    hint: 'Slack takes the bot token of a Slack app installed in the workspace. Replies post as the app. The token stays in VSCode on this machine, never in the repo. Invite the app to the channel in Slack, or the channel is not in the list.',
    fields: [{
      key: 'token', label: 'Bot token', type: 'secret', placeholder: `Paste the token: ${SLACK_BOT_TOKEN}…`,
      check: (v) => (!v.trim().startsWith(SLACK_BOT_TOKEN) ? `A bot token starts with ${SLACK_BOT_TOKEN}. Copy it from the app's OAuth & Permissions page.` : v.trim().length >= 20 ? null : 'Paste the whole token.'),
      help: { label: 'Open your Slack apps', url: () => SLACK_APPS },
    }],
  }],
  pickers: [{
    key: 'channel', label: 'Channel', dependsOn: [], identifies: true, idValues: true,
    hint: 'Its threads are the tracker\'s tickets. Only channels the app is in are listed.',
    load: async (ctx) => (await slackChannels(tokenOf(ctx), ctx.fetch)).map((c) => ({ value: c.id, label: `#${c.name}`, detail: c.private ? 'private' : 'public' })),
  }],
  place: { key: 'channel', words: 'In Slack, the channel stands in for an epic: only its threads are this project\'s.' },
  verify: (ctx) => slackApp(ctx.host, tokenOf(ctx), ctx.fetch),
  toConfig: (c) => ({ kind: 'slack', workspace: c.host, channel: one(c.values.channel) }),
  fromConfig: (t) => ({ host: t.workspace ?? '', values: { channel: t.channel } }),
};

/** Every tracker the Connect page offers, in the order it lists them. */
export const DESCRIPTIONS: TrackerDescription[] = [JIRA, GITHUB, AZURE, MONDAY, SLACK];

export const describe = (kind: string, list: TrackerDescription[] = DESCRIPTIONS): TrackerDescription | undefined => list.find((d) => d.kind === kind);

/** Every key a description names, for checking what a page sends. */
export function declaredKeys(list: TrackerDescription[] = DESCRIPTIONS): { fields: Set<string>; pickers: Set<string>; methods: Set<string>; kinds: Set<string> } {
  return {
    fields: new Set(list.flatMap((d) => [d.host.key, ...d.methods.flatMap((m) => m.fields.map((f) => f.key))])),
    pickers: new Set(list.flatMap((d) => d.pickers.map((p) => p.key))),
    methods: new Set(list.flatMap((d) => d.methods.map((m) => m.id))),
    kinds: new Set(list.map((d) => d.kind)),
  };
}
