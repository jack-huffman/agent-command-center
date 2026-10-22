// Make a plan reads the whole ticket (T-110): every comment oldest first with its author and date, related tickets
// with their state, attachments' names and the changes field; how the analyst is told to weigh them; a failed read;
// the limit on long comments; and what the plan keeps, so its page can say when the ticket has new comments.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { analysisSection, analyze } from '../src/analyze.ts';
import { clipText } from '../src/criteria.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { mutate, readLedger, type Task, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { claudeBrief } from '../src/plan-talk.ts';
import {
  attachmentNames, commentDay, descriptionOnly, fitComments, NO_TRACKER, NOT_HANDED, PLAN_COMMENTS_MAX, PLAN_TICKET_PROMPT, type PlanComment, parsePlanTicket,
  planRead, planTicket, planTicketPath, readPlanTicket, readWords, ticketLines, ticketWithout, unreadComments, writePlanTicket,
} from '../src/plan-ticket.ts';
import { fromMarkdown } from '../src/trackers/doc.ts';
import type { Ticket } from '../src/trackers/types.ts';
import { fakeRunner, GENERIC_CONFIG, makeRepo } from './support.ts';

const now = () => new Date('2026-10-22T12:00:00Z');

function setup() {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  const config = parseConfig(GENERIC_CONFIG).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [
      { source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Send back the contacts', brief: 'Return the 70 contacts by Friday.' },
      { source: { kind: 'manual' }, title: 'Write the changelog', brief: 'List what changed.' },
    ], 'human', 'human:test', emit, now);
  });
  const tasks = readLedger(paths.ledger).tasks;
  return { dir, config, paths, jira: tasks.find((t) => t.source.kind === 'jira')!, manual: tasks.find((t) => t.source.kind === 'manual')! };
}

const person = (name: string) => ({ id: name, name, avatarUrl: null });
const comment = (author: string, created: string, text: string) => ({ id: `${author}-${created}`, author: person(author), created, body: fromMarkdown(text), url: null });

/** A Jira ticket whose comments come back newest first, as some trackers give them. */
const TICKET: Pick<Ticket, 'key' | 'title' | 'url' | 'markdown' | 'body' | 'comments' | 'related'> = {
  key: 'ACME-7', title: 'Send back the contacts', url: 'https://acme.atlassian.net/browse/ACME-7', markdown: 'Return the 70 contacts by Friday.',
  body: { blocks: [{ t: 'p', c: [{ t: 'text', text: 'Return the 70 contacts by Friday.' }] }, { t: 'media', label: 'contacts.csv', href: null }] },
  comments: [
    comment('Mike', '2026-10-21T09:00:00.000Z', 'Agreed: Wednesday.'),
    comment('Kelsey', '2026-10-20T15:30:00.000Z', 'Kelsey and Mike will send back the 77 contacts by Wednesday.'),
  ],
  related: [{ key: 'ACME-3', title: 'Contacts clean-up', relation: 'parent', url: null, status: { id: '3', name: 'In Progress', category: 'progress' }, typeKind: null, typeColor: null }],
};

const CHANGES = { name: 'Deployment Notes', markdown: '- Contact: the Region field' };

const ANSWER = {
  verdict: 'ready', summary: 'Send back 77 contacts by Wednesday, as Kelsey said on 2026-10-20.',
  requirements: { goal: 'The team sends back 77 contacts.', criteria: ['The team sends back 77 contacts by Wednesday.'], assumptions: [], outOfScope: [] },
  questions: [], decisions: [], findings: [{ area: 'Contacts', detail: 'The count is 77, not 70 (Kelsey, 2026-10-20).', source: 'the ticket' }],
  approach: { plan: ['Send them'], files: [], refactors: [], risks: [], tests: [], size: 'S' }, split: [],
};

const result = (structured: unknown): RunResult => ({ code: 0, stderr: '', stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'sess-plan', total_cost_usd: 0.5, structured_output: structured }) });

/** Makes a plan with a fake agent, and gives back the plan and what the agent was told. */
function plan(paths: ReturnType<typeof repoPaths>, config: Config, id: string, ticket?: (t: Task) => ReturnType<typeof planTicket>) {
  let told: { system: string; input: string } = { system: '', input: '' };
  const fake = fakeRunner({});
  const runner = (cmd: string, args: string[], opts?: RunOptions) => {
    if (cmd !== 'claude') return fake(cmd, args, opts);
    told = { system: args[args.indexOf('--append-system-prompt') + 1]!, input: String(opts?.input) };
    return result(ANSWER);
  };
  const a = analyze(paths, config, id, { run: runner, now, env: {} }, ticket ? { ticket } : {});
  return { a, ...told };
}

test('the prompt holds every comment oldest first with its author and date, the related tickets with their state, the attachments and the changes field', () => {
  const { paths, config, jira } = setup();
  const { a, system, input } = plan(paths, config, jira.id, () => planTicket(TICKET, CHANGES));
  assert.match(input, /## The ticket\n\nReturn the 70 contacts by Friday\./);
  assert.match(input, /## The ticket's comments, oldest first\n\n### Kelsey, 2026-10-20\n\nKelsey and Mike will send back the 77 contacts by Wednesday\.\n\n### Mike, 2026-10-21\n\nAgreed: Wednesday\./, 'oldest first, though the tracker gave them newest first');
  assert.match(input, /## Related tickets\n\n- parent: ACME-3 Contacts clean-up \(In Progress\)/);
  assert.match(input, /## Attachments\n\nTheir names only\. Their contents were not read\.\n\n- contacts\.csv/);
  assert.match(input, /## The ticket's Deployment Notes\n\nThe field the team keeps for what this ticket changes\.\n\n- Contact: the Region field/);
  // As a consultant reads a ticket: a later comment wins, the comment relied on is named, and disagreement is asked about.
  assert.ok(system.includes(PLAN_TICKET_PROMPT));
  assert.match(system, /A later decision in a comment overrides the description/);
  assert.match(system, /name the comment by its author and date/);
  assert.match(system, /Where two comments disagree, or a comment changes what the description asks, do not choose\. Ask a question/);
  // The plan keeps what it read, and the ticket beside it.
  assert.deepEqual(a.ticket, { full: true, why: null, comments: 2, omitted: 0, newest: { author: 'Mike', created: '2026-10-21T09:00:00.000Z' }, related: 1, attachments: 1, changes: 'Deployment Notes' });
  assert.equal(readPlanTicket(paths, jira.id)?.comments.length, 2);
  // The builder is told what it read.
  assert.ok(analysisSection(a).includes('This plan read the ticket, its 2 comments, 1 related ticket and its Deployment Notes. The newest comment it read is Mike\'s, 2026-10-21.'));
});

test('Talk it through in Claude Code reads the same comments the plan read (D-195)', () => {
  const { paths, config, jira } = setup();
  plan(paths, config, jira.id, () => planTicket(TICKET));
  const brief = claudeBrief(paths, jira.id);
  assert.match(brief, /### Kelsey, 2026-10-20\n\nKelsey and Mike will send back the 77 contacts by Wednesday\./);
  assert.match(brief, /## The plan, v1/);
});

test('edge: a failed read makes the plan from the description, and the plan says the comments weren\'t read and why', () => {
  const { paths, config, jira } = setup();
  const why = 'Jira said the sign-in has expired.';
  const { a, input } = plan(paths, config, jira.id, (t) => parsePlanTicket(JSON.stringify({ key: 'ACME-7', unread: why }), t));
  assert.match(input, /## The ticket\n\nReturn the 70 contacts by Friday\./, 'the description acc keeps');
  assert.match(input, new RegExp(`_The comments were not read: ${why.replace(/\./g, '\\.')} Make the plan from the description, and say so in the summary\\._`));
  assert.match(input, /_The related tickets were not read\._/);
  assert.equal(a.ticket?.full, false);
  assert.equal(a.ticket?.why, why);
  assert.equal(readWords(a.ticket), `This plan read the description only: ${why}`);
  // An empty reason still gives one.
  assert.equal(parsePlanTicket(JSON.stringify({ key: 'ACME-7', unread: ' ' }), jira).why, NOT_HANDED);
});

test('edge: a task with no tracker keeps its description only, and the plan says so; a tracker task without the file says it wasn\'t handed over', () => {
  const { paths, config, jira, manual } = setup();
  const { a, input } = plan(paths, config, manual.id);
  assert.match(input, /List what changed\./);
  assert.ok(input.includes(NO_TRACKER));
  assert.equal(readWords(a.ticket), `This plan read the description only: ${NO_TRACKER}`);
  assert.equal(ticketWithout(jira).why, NOT_HANDED);
  assert.equal(descriptionOnly(jira, 'x').markdown, 'Return the 70 contacts by Friday.');
});

test('edge: long comments fit: each is kept whole, the newest win, and the plan says how many it left out', () => {
  const c = (n: number, len: number): PlanComment => ({ author: `A${n}`, created: `2026-10-${String(10 + n).padStart(2, '0')}`, markdown: 'x'.repeat(len) });
  const fit = fitComments([c(3, 40), c(1, 40), c(2, 40)], 100);
  assert.deepEqual(fit.comments.map((x) => x.author), ['A2', 'A3'], 'the newest two, oldest first');
  assert.equal(fit.omitted, 1);
  assert.ok(fit.comments.every((x) => x.markdown.length === 40), 'each whole');
  // One comment longer than the limit alone is the newest: cut, and the rest left out.
  const big = fitComments([c(1, 10), c(2, 500)], 100);
  assert.deepEqual(big.comments.map((x) => x.author), ['A2']);
  assert.match(big.comments[0]!.markdown, /\(cut at 100 characters\)$/);
  assert.equal(big.omitted, 1);
  assert.deepEqual(fitComments([], 100), { comments: [], omitted: 0 }, 'edge: no comments');
  // A whole ticket over the limit, read from a file.
  const many = Array.from({ length: 30 }, (_, i) => ({ author: `P${i}`, created: `2026-10-01T00:${String(i).padStart(2, '0')}:00Z`, markdown: 'y'.repeat(4_000) }));
  const t = parsePlanTicket(JSON.stringify({ key: 'ACME-7', title: 't', markdown: 'd', comments: many, related: [] }), { id: 'ACME-7', title: 't', brief: '', source: { kind: 'jira', key: 'ACME-7', url: null } });
  assert.equal(t.comments.length, PLAN_COMMENTS_MAX / 4_000);
  assert.equal(t.omitted, 30 - PLAN_COMMENTS_MAX / 4_000);
  assert.equal(t.comments.at(-1)!.author, 'P29', 'the newest is kept');
  const lines = ticketLines(t).join('\n');
  assert.match(lines, /_The 15 oldest comments were left out to fit\. Say so where it matters\._/);
  assert.match(readWords(planRead(t))!, /It left out the 15 oldest comments to fit\./);
  assert.match(clipText('abcdef', 3), /^abc\n\n\(cut at 3 characters\)$/);
});

test('the ticket file is checked: not JSON, another ticket, or missing parts says what is wrong', () => {
  const task = { id: 'ACME-7', title: 't', brief: 'b', source: { kind: 'jira' as const, key: 'ACME-7', url: null } };
  assert.throws(() => parsePlanTicket('nope', task), /isn't JSON/);
  assert.throws(() => parsePlanTicket('null', task), /needs a key/);
  assert.throws(() => parsePlanTicket(JSON.stringify({ key: 'ACME-8', unread: 'x' }), task), /is for ACME-8, not ACME-7/);
  assert.throws(() => parsePlanTicket(JSON.stringify({ key: 'ACME-7', title: 't' }), task), /or why it wasn't read/);
  const t = parsePlanTicket(JSON.stringify({ key: 'acme-7', title: 't', markdown: 'm', url: 3, comments: [{ markdown: 'hi' }, { x: 1 }], related: [{ key: 'K' }, {}], attachments: ['a.pdf', 4], changes: { name: 'Notes', markdown: ' ' } }), task);
  assert.deepEqual(t.comments, [{ author: 'Someone', created: '', markdown: 'hi' }]);
  assert.deepEqual(t.related, [{ key: 'K', title: '', relation: 'related', state: null }]);
  assert.deepEqual(t.attachments, ['a.pdf']);
  assert.equal(t.changes, null, 'edge: an empty changes field is none');
  assert.equal(t.url, null);
});

test('what the plan kept says how many comments are new since: newer than the newest it read, all where it read none, none for an older plan', () => {
  const read = planRead(planTicket(TICKET));
  assert.equal(unreadComments(read, TICKET.comments), 0, 'nothing new');
  assert.equal(unreadComments(read, [...TICKET.comments, { created: '2026-10-22T08:00:00.000Z' }, { created: '2026-10-22T09:00:00.000Z' }]), 2);
  assert.equal(unreadComments(read, [{ created: '2026-10-21T09:00:00.000Z' }]), 0, 'edge: a comment deleted since is not new');
  assert.equal(unreadComments(undefined, TICKET.comments), 0, 'edge: a plan from before plans kept what they read');
  assert.equal(unreadComments(planRead(descriptionOnly({ id: 'ACME-7', title: 't', brief: '', source: { kind: 'jira', key: 'ACME-7', url: null } }, 'offline')), TICKET.comments), 2, 'edge: a failed read read none of them');
  assert.equal(unreadComments({ ...read, newest: null, comments: 0 }, [{ created: 'soon' }]), 1, 'edge: it read a ticket with no comments');
  assert.equal(commentDay('2026-10-20T15:30:00.000Z'), '2026-10-20');
  assert.equal(commentDay('yesterday'), 'yesterday', 'edge: a date the tracker gave in words');
  assert.equal(readWords(undefined), null);
  assert.equal(readWords({ ...read, comments: 0, newest: null, related: 0, changes: null }), 'This plan read the ticket, no comments (it had none).');
});

test('attachment names come from the description and its comments, in lists and quotes, each once', () => {
  const doc = { blocks: [{ t: 'quote' as const, c: [{ t: 'media' as const, label: 'a.png', href: null }] }, { t: 'list' as const, ordered: false, items: [{ c: [{ t: 'media' as const, label: 'b.pdf', href: null }] }] }] };
  assert.deepEqual(attachmentNames([doc, { blocks: [{ t: 'media', label: 'a.png', href: null }] }]), ['a.png', 'b.pdf']);
  assert.deepEqual(attachmentNames([]), [], 'edge: none');
});

test('edge: the kept ticket is read back, and a missing or broken one is none', () => {
  const { paths } = setup();
  assert.equal(readPlanTicket(paths, 'ACME-9'), null);
  const t = planTicket(TICKET);
  writePlanTicket(paths, 'ACME-9', t);
  assert.ok(existsSync(planTicketPath(paths, 'ACME-9')));
  assert.deepEqual(readPlanTicket(paths, 'ACME-9'), t);
});
