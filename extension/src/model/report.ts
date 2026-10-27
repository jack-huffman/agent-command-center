/**
 * Report a problem (T-118): a draft GitHub issue for the Command Center's own repo, in a tab of its own. The
 * person writes what happened and what they expected; the Command Center attaches the versions, this machine's,
 * the project's profile, Setup's results and the last error they saw, scrubbed of client work before it shows
 * (logic/scrub.ts). They see the whole issue as it will be posted, can edit any of it, and post with one click,
 * as gh's signed-in account, the body on stdin. Where that can't reach the repo, the page says so and offers
 * Copy the issue text. Plain data and the messages' checks: no vscode import.
 */

import type { CheckStatus } from '../../../packages/core/src/onboarding/types.ts';
import { RELEASES_REPO, type AboutFacts } from './about.ts';
import { type Look, LOOK, type ModelArea } from './shared.ts';

/** A command as every action is one (D-099): its id, what it takes, and whether it can run now, with why not. */
export interface CommandSpec<S> {
  id: string;
  /** What it takes, in a line. */
  params: string;
  enabled(s: S): { ok: true } | { ok: false; why: string };
}

/** Why Report a problem waits: a report is posting, and its page shows how that went. */
export const REPORT_POSTING = 'A report is posting now: its tab says when it\'s done.';

/** Report a problem: the Command Palette's, Settings' About's, and a failed Setup step's. */
export const REPORT_COMMAND: CommandSpec<{ posting: boolean }> = {
  id: 'acc.report',
  params: 'Nothing, or a Setup step\'s id (such as A4.plugin), as a failed step passes it: the draft then starts with that step and its result.',
  enabled: ({ posting }) => (posting ? { ok: false, why: REPORT_POSTING } : { ok: true }),
};

/** The tab's title, and its heading. */
export const REPORT_TITLE = 'Report a problem';

/** The longest title and body the page may post: GitHub's own limit on a body is 65,536 characters. */
export const REPORT_TITLE_MAX = 256;
export const REPORT_BODY_MAX = 65_000;

/** What gh is asked, as its active account (D-088): an issue on the Command Center's repo, its body read from stdin, never put in a URL. */
export const issueArgs = (title: string): string[] => ['issue', 'create', '--repo', RELEASES_REPO, '--title', title, '--body-file', '-'];

/** A Setup step's result, as the draft attaches it. */
export interface StepResult { id: string; status: CheckStatus }

/** What the Command Center attaches to a report, before the scrub. */
export interface ReportFacts {
  extension: string;
  acc: AboutFacts['acc'];
  plugin: AboutFacts['plugin'];
  /** "macOS 15.1", or the system's name and release elsewhere; null when it couldn't be read. */
  os: string | null;
  vscode: string;
  /** The project's profile, generic or salesforce; null with no project open. */
  profile: string | null;
  setup: StepResult[];
  /** The step a failed Setup step's Report a problem started from, with what its check said. */
  step: { id: string; title: string; status: CheckStatus; detail: string } | null;
  /** The last error the person saw: a run that failed, with its last lines. Null when there's been none. */
  lastError: string | null;
}

const readWords = (r: AboutFacts['acc']): string => (!r ? 'not read yet' : r.ok ? r.value : `couldn't read it: ${r.error}`);

function pluginWords(p: AboutFacts['plugin']): string {
  if (!p) return 'not read yet';
  if (!p.ok) return p.missing ? 'Claude Code isn\'t installed' : `couldn't read it: ${p.error}`;
  if (!p.value) return 'not installed';
  return `${p.value.version ?? 'unknown version'}${p.value.enabled ? '' : ', turned off'}`;
}

/** The steps' results in a line: "A1.git pass, A4.plugin fail". */
const stepsLine = (steps: StepResult[]): string => (steps.length ? steps.map((s) => `${s.id} ${s.status}`).join(', ') : 'not checked yet');

/** What's attached, before the scrub: a line for each fact, then the step it's about and the last error. */
export function attachedText(f: ReportFacts): string {
  const lines = [
    `- The extension: ${f.extension || 'unknown'}`,
    `- The command-line engine: ${readWords(f.acc)}`,
    `- The Claude Code plugin: ${pluginWords(f.plugin)}`,
    `- This machine: ${f.os ?? 'unknown'}`,
    `- VSCode: ${f.vscode || 'unknown'}`,
    `- The project's profile: ${f.profile ?? 'no project open'}`,
    `- Setup: ${stepsLine(f.setup)}`,
  ];
  if (f.step) lines.push(`- The step it's about: ${f.step.id} (${f.step.title}), ${f.step.status}${f.step.detail ? `: ${f.step.detail}` : ''}`);
  lines.push(f.lastError ? `- The last error:\n\n\`\`\`\n${f.lastError.replace(/```/g, "'''")}\n\`\`\`` : '- The last error: none seen');
  return lines.join('\n');
}

/** How a post went, as gh said it. */
export type PostResult =
  | { ok: true; url: string }
  | { ok: false; why: 'no-gh' | 'signed-out' | 'no-access' | 'failed'; said: string };

/** gh's answer to issueArgs: the new issue's link on its last line, or why it wasn't made. */
export function parsePost(r: { code: number; stdout: string; stderr: string }): PostResult {
  const said = (r.stderr || r.stdout).trim().split('\n')[0] ?? '';
  if (r.code === 127) return { ok: false, why: 'no-gh', said };
  const url = r.stdout.trim().split('\n').at(-1)?.trim() ?? '';
  if (r.code === 0 && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/.test(url)) return { ok: true, url };
  const all = `${r.stderr}\n${r.stdout}`;
  if (/auth login|not logged in|authentication required|no oauth token|HTTP 401|bad credentials/i.test(all)) return { ok: false, why: 'signed-out', said };
  if (/could not resolve to a repository|HTTP 40[34]|not found|has disabled issues|permission|access/i.test(all)) return { ok: false, why: 'no-access', said };
  return { ok: false, why: 'failed', said: said || `it stopped with code ${r.code}` };
}

/** Where the draft is: being written, posting, posted, or not posted, and why. */
export type ReportState = { kind: 'draft' } | { kind: 'posting' } | { kind: 'posted'; url: string } | { kind: 'not-posted'; result: Extract<PostResult, { ok: false }> };

/** The draft's tab. */
export interface ReportModel {
  kind: 'report';
  title: string;
  /** Goes up with each Report a problem, so the page starts a new draft then, and keeps what's typed between redraws. */
  draft: number;
  /** Where it posts: the Command Center's own repo, as owner/name. */
  repo: string;
  /** What's attached, scrubbed: the person sees and can edit it. */
  attached: string;
  /** What the scrub replaced, in a line; null when it replaced nothing. */
  scrubbed: string | null;
  /** What happened, started for the person when a failed step opened the draft. */
  happened: string;
  /** How the post is going, with an icon and a label; null while the draft is being written. */
  look: Look | null;
  /** What the state means, or what to do, in a line. */
  meaning: string | null;
  /** The new issue's link, once it's posted. */
  url: string | null;
  /** It's posting now: Post says so, and waits. */
  posting: boolean;
  /** Copy the issue text: offered where the post couldn't go. */
  copy: boolean;
  /** Why Post can't be clicked now, as the page shows it; the page adds its own when What happened is empty. */
  postOff: string | null;
}

/** What each way a post can fail means for the person. */
export const NOT_POSTED: Record<Extract<PostResult, { ok: false }>['why'], { label: string; meaning: string }> = {
  'no-gh': { label: 'GitHub\'s command line isn\'t installed', meaning: 'Setup\'s A1 installs it. Until then, copy the issue text and send it to the Command Center\'s author another way.' },
  'signed-out': { label: 'Not signed in to GitHub', meaning: 'Setup\'s A2 signs you in. Until then, copy the issue text and send it to the Command Center\'s author another way.' },
  'no-access': { label: 'Your GitHub account can\'t reach the Command Center\'s repo', meaning: 'Copy the issue text and send it to the Command Center\'s author another way, such as by email or chat.' },
  failed: { label: 'GitHub didn\'t take the issue', meaning: 'Copy the issue text and send it to the Command Center\'s author another way, or post again.' },
};

export function reportModel(i: { draft: number; attached: string; scrubbed: string | null; happened: string; state: ReportState }): ReportModel {
  const base = { kind: 'report' as const, title: REPORT_TITLE, draft: i.draft, repo: RELEASES_REPO, attached: i.attached, scrubbed: i.scrubbed, happened: i.happened, posting: i.state.kind === 'posting' };
  const s = i.state;
  if (s.kind === 'posting') return { ...base, look: LOOK('Posting the issue', 'sync~spin', 'blue'), meaning: null, url: null, copy: false, postOff: 'It\'s posting now.' };
  if (s.kind === 'posted') return { ...base, look: LOOK('Posted', 'pass', 'blue'), meaning: 'Thank you. The issue is on GitHub, where the Command Center\'s author reads it.', url: s.url, copy: false, postOff: 'It\'s posted.' };
  if (s.kind === 'not-posted') {
    const n = NOT_POSTED[s.result.why];
    return { ...base, look: LOOK(s.result.why === 'failed' && s.result.said ? `${n.label}: ${s.result.said}` : n.label, 'warning', 'orange'), meaning: n.meaning, url: null, copy: true, postOff: null };
  }
  return { ...base, look: null, meaning: null, url: null, copy: false, postOff: null };
}

/** The page's messages: Post, with the title and body as the page shows them, and Copy the issue text. */
export type Message =
  | { type: 'report-post'; title: string; body: string }
  | { type: 'report-copy'; text: string };

export const area: ModelArea = {
  messages: {
    'report-post': (x) => typeof x.title === 'string' && x.title.trim().length > 0 && x.title.length <= REPORT_TITLE_MAX && typeof x.body === 'string' && x.body.trim().length > 0 && x.body.length <= REPORT_BODY_MAX,
    'report-copy': (x) => typeof x.text === 'string' && x.text.length > 0 && x.text.length <= REPORT_BODY_MAX + REPORT_TITLE_MAX + 10,
  },
  commands: [REPORT_COMMAND.id],
};
