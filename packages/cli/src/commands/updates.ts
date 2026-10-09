// acc's Ticket updates commands: acc drafts them, and only a person posts.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccError, claimUpdate, discardUpdate, draftUpdate, EVENT_WORDS, GH_TIMEOUT_MS, ghToken, githubIssue, isOpenUpdate, listUpdates, markPosted, readAnalysis, readLedger, readUpdate, releaseUpdate, run, stalePosting, type Update, UPDATE_TEXT_MAX, updateText } from '../../../core/src/index.ts';
import { issueRepo } from '../../../core/src/trackers/github.ts';
import { trackerName } from '../../../core/src/trackers/types.ts';
import { tone } from '../format.ts';
import { type CommandArea, now, type Opts, out, personOnly, project, readFileArg } from '../shared.ts';

// ---------------------------------------------------------------- ticket updates (D-066)

/** Posting and discarding a ticket's update is a person's: never a builder's, reviewer's, analyst's or autopilot's. */
export function personOnlyUpdate(o: Opts, what: string): string {
  if (process.env.ACC_ROLE === 'analyst') throw new AccError('refused', `An analyst can't ${what}. A person does that.`);
  return personOnly(o, what);
}

/** An update as a person reads it: its id, state and ticket, what it's about, then its text. */
function updateLines(u: Update): string[] {
  const state = u.state === 'posting' ? (stalePosting(u, now()) ? tone('may have posted', 'orange') : 'posting') : u.state === 'draft' ? tone('draft', 'orange') : u.state;
  const when = u.posted ? `posted by ${u.posted.by.replace(/^human:/, '')} ${u.posted.at}` : u.discarded ? `discarded by ${u.discarded.by.replace(/^human:/, '')} ${u.discarded.at}` : `drafted by ${u.by.replace(/^human:/, '')} ${u.createdAt}`;
  return [
    `${u.id.padEnd(12)} ${state}  ${trackerName(u.tracker)} ${u.key}: ${EVENT_WORDS[u.event]}${u.env ? ` (${u.env})` : ''}  ${tone(when, 'dim')}`,
    ...(u.failed && u.state === 'draft' ? [tone(`    ! The last try didn't post: ${u.failed.reason}`, 'orange')] : []),
    ...(u.posted?.text ?? u.text).split('\n').map((l) => `    ${l}`),
  ];
}

function cmdUpdates(o: Opts): number {
  personOnlyUpdate(o, 'read the ticket updates');
  const { paths } = project(process.cwd());
  const task = (o.task as string | undefined)?.toUpperCase();
  const list = listUpdates(paths).filter((u) => (o.all || isOpenUpdate(u)) && (!task || u.task === task));
  out(o, () => (list.length
    ? [...list.flatMap((u) => [...updateLines(u), '']), tone('Post one from the Command Center, or a GitHub issue\'s with acc update post <id>. acc update discard <id> sets one aside.', 'dim')].join('\n')
    : o.all ? 'No ticket updates yet.' : 'No drafts waiting. acc updates --all shows the posted and discarded too.'), list);
  return 0;
}

/** The text to post: the file a person edited it in, or the draft as acc wrote it. */
function postText(o: Opts, u: Update): string {
  const file = o['text-file'] as string | undefined;
  const text = (file ? readFileArg(file) : u.text).trim();
  if (!text) throw new AccError('usage', 'There\'s nothing to post: the text is empty.');
  if (text.length > UPDATE_TEXT_MAX) throw new AccError('usage', `The text is ${text.length} characters, more than a post takes (${UPDATE_TEXT_MAX}).`);
  return text;
}

const updateOrThrow = (paths: ReturnType<typeof project>['paths'], id: string): Update => {
  const u = readUpdate(paths, id.toUpperCase());
  if (!u) throw new AccError('no-update', `No update ${id}. acc updates lists them.`);
  return u;
};

/**
 * Posts a draft on its GitHub issue, as the repo's account (D-007, D-028), with the text a person
 * edited. Jira and Azure DevOps post from the Command Center, through this repo's sign-in (D-027).
 */
function cmdUpdatePost(o: Opts, id: string): number {
  const by = personOnlyUpdate(o, 'post a ticket\'s update');
  const { paths, config } = project(process.cwd());
  const u = updateOrThrow(paths, id);
  if (u.tracker !== 'github') throw new AccError('refused', `${u.id} is for ${trackerName(u.tracker)} ticket ${u.key}. acc posts only on GitHub: post it from the Command Center, which posts as you through this repo's ${trackerName(u.tracker)} sign-in.`);
  const text = postText(o, u);
  const gh = config.github;
  if (!gh) throw new AccError('no-github', 'This project has no "github" section in .acc/config.json, so acc can\'t post as its account.');
  const issue = githubIssue(u, gh.repo);
  if (!issue) throw new AccError('refused', `${u.id}'s ticket ${u.key} isn't a GitHub issue acc can find.`);
  // Signed in first, so a missing sign-in leaves the draft as it was.
  const env = { ...process.env, GH_TOKEN: ghToken(run, gh.account) };
  // Posting is held to the repo, not its narrower labels (D-072): an issue now in another repo isn't posted on.
  // A failed look says nothing, and the post goes ahead as before.
  const repo = config.trackers.find((t) => t.kind === 'github')?.repo ?? gh.repo;
  const seen = run('gh', ['issue', 'view', issue.number, '-R', issue.repo, '--json', 'url'], { cwd: paths.root, env, timeoutMs: GH_TIMEOUT_MS });
  let lives: string | null = null;
  try {
    lives = seen.code === 0 ? issueRepo((JSON.parse(seen.stdout) as { url?: string }).url) : null;
  } catch {
    lives = null;
  }
  if (lives && lives.toLowerCase() !== repo.toLowerCase()) {
    throw new AccError('refused', `${u.key} is in ${lives} now, not this repo's ${repo}, so ${u.id} isn't posted. Discard it if it no longer applies: acc update discard ${u.id}`);
  }
  claimUpdate(paths, u.id, by, now, { again: o.again === true });
  const dir = mkdtempSync(join(tmpdir(), 'acc-update-'));
  try {
    const file = join(dir, 'body.md');
    writeFileSync(file, text + '\n');
    const r = run('gh', ['issue', 'comment', issue.number, '-R', issue.repo, '--body-file', file], { cwd: paths.root, env, timeoutMs: GH_TIMEOUT_MS });
    if (r.code !== 0) {
      const why = (r.stderr || r.stdout).trim().split('\n')[0] || `gh exited with ${r.code}.`;
      // A gh stopped at its timeout may still have posted (D-051): it stays claimed, and says so.
      if (r.timedOut) throw new AccError('unconfirmed', `${u.id} may have posted on ${u.key}: ${why} Look at the issue before you post it again with --again.`);
      releaseUpdate(paths, u.id, why, now);
      throw new AccError('post', `Couldn't post ${u.id} on ${u.key}: ${why}`);
    }
    const url = r.stdout.split('\n').map((l) => l.trim()).find((l) => /^https:\/\/github\.com\//.test(l));
    const posted = markPosted(paths, u.id, { by, text, ...(url ? { url } : {}) }, now);
    out(o, () => tone(`✓ Posted ${u.id} on ${u.key} as ${gh.account}${url ? `: ${url}` : '.'}`, 'blue'), posted);
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The Command Center's steps for a Jira or Azure DevOps post, which it sends as you: claim, then record or release. */
function cmdUpdateStep(o: Opts, step: 'posting' | 'posted' | 'release', id: string): number {
  const by = personOnlyUpdate(o, 'post a ticket\'s update');
  const { paths } = project(process.cwd());
  const u = updateOrThrow(paths, id);
  const r = step === 'posting' ? claimUpdate(paths, u.id, by, now, { again: o.again === true })
    : step === 'posted' ? markPosted(paths, u.id, { by, text: postText(o, u), ...(typeof o.url === 'string' && /^https?:\/\//.test(o.url) ? { url: o.url } : {}) }, now)
      : releaseUpdate(paths, u.id, (o.reason as string | undefined) ?? '', now);
  out(o, () => (step === 'posting' ? `${u.id} is being posted by ${by.replace(/^human:/, '')}.` : step === 'posted' ? tone(`✓ ${u.id} is recorded as posted on ${u.key}.`, 'blue') : `${u.id} is a draft again.`), r);
  return 0;
}

function cmdUpdateDiscard(o: Opts, id: string): number {
  const by = personOnlyUpdate(o, 'discard a ticket\'s update');
  const { paths } = project(process.cwd());
  const u = discardUpdate(paths, updateOrThrow(paths, id).id, by, now);
  out(o, () => `Discarded ${u.id}. It's kept, and never posted.`, u);
  return 0;
}

/** One of the analysis's questions, drafted for the client: a person chose to ask them (D-066). */
function cmdUpdateAsk(o: Opts, id: string, q: string): number {
  const by = personOnlyUpdate(o, 'draft a question for the client');
  const { paths } = project(process.cwd());
  const taskId = id.toUpperCase();
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === taskId);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  const a = readAnalysis(paths, taskId);
  if (!a) throw new AccError('no-analysis', `${taskId} hasn't been analyzed yet: acc analyze ${taskId}.`);
  const question = a.questions.find((x) => x.id === q.toLowerCase() || x.id === `q${q}`);
  if (!question) throw new AccError('usage', `${taskId}'s analysis has no question ${q}. It has: ${a.questions.map((x) => x.id).join(', ') || 'none'}.`);
  const u = draftUpdate(paths, task, { event: 'question', question: question.id, text: updateText('question', { question: question.question }) }, by, now);
  if (!u) throw new AccError('refused', `${taskId} has no ticket to post a question on: it's a task acc alone keeps.`);
  out(o, () => `Drafted ${question.id} for ${u.key} (${u.id}). Read and edit it before you post it.\n${u.text.split('\n').map((l) => `    ${l}`).join('\n')}`, u);
  return 0;
}

function cmdUpdate(o: Opts, sub: string | undefined, args: string[]): number {
  const usage = 'acc update post <id> [--text-file <f>] [--again] | acc update discard <id> | acc update ask <task> <q>';
  if (sub === 'ask') {
    if (!args[0] || !args[1]) throw new AccError('usage', 'acc update ask <task> <q>');
    return cmdUpdateAsk(o, args[0], args[1]);
  }
  if (!args[0]) throw new AccError('usage', usage);
  if (sub === 'post') return cmdUpdatePost(o, args[0]);
  if (sub === 'discard') return cmdUpdateDiscard(o, args[0]);
  if (sub === 'posting' || sub === 'posted' || sub === 'release') return cmdUpdateStep(o, sub, args[0]);
  throw new AccError('usage', usage);
}

export const area: CommandArea = {
  help: {
    section: 'Ticket updates (acc drafts them; only a person posts)',
    order: 40,
    lines: `  acc updates [--all] [--task <id>]     The drafts waiting for a person; --all adds the posted and discarded
  acc update post <id> [--text-file <f>] [--again]
                                        Post a draft on its GitHub issue as the repo's account, with the text
                                        in <f> if you edited it. Jira and Azure DevOps post from the Command Center
  acc update discard <id>               Set a draft aside: it's kept, and never posted
  acc update ask <id> <q>               Draft one of the task's analysis's questions for the client`,
  },
  options: {
    all: { type: 'boolean', default: false },
    task: { type: 'string' },
    reason: { type: 'string' },
    'text-file': { type: 'string' },
    again: { type: 'boolean', default: false },
    url: { type: 'string' },
  },
  subcommands: { update: ['post', 'discard', 'ask', 'posting', 'posted', 'release'] },
  commands: {
    updates: (o) => cmdUpdates(o),
    update: (o, rest) => cmdUpdate(o, rest[0], rest.slice(1)),
  },
};
