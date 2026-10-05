import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendOutput, claudeSessionUri, isSessionId, needsTerminal, promptOf } from '../src/logic.ts';
import {
  agentModel, alwaysLabel, answerOf, choicesFor, decisionOf, describePermission, historyItems, homeModel, isFromWebview, needsYouCount, questionCards, runCard, type RunInput,
} from '../src/model.ts';
import { describeTool, emptyTranscript, foldTranscript, splitLines, transcriptDir } from '../src/transcript.ts';
import { sampleBoards, sampleHub, sampleIdentity, sampleRuns, sampleSetup } from '../scripts/fixtures.ts';

const rec = (r: Record<string, unknown>) => JSON.stringify({ uuid: `u${Math.random()}`, timestamp: '2026-10-02T10:00:00.000Z', cwd: '/w/repo', ...r });
const user = (content: unknown, extra: Record<string, unknown> = {}) => rec({ type: 'user', message: { role: 'user', content }, ...extra });
const assistant = (content: unknown[]) => rec({ type: 'assistant', message: { role: 'assistant', content } });

// ---------------------------------------------------------------- transcripts

test('a transcript reads as a timeline: the instructions folded, what it said, and each tool with its result', () => {
  const t = foldTranscript(emptyTranscript(), [
    user(`# T-1: do the thing\n\n${'detail '.repeat(200)}`),
    assistant([{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Looking at the code first.' }, { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'git status', description: 'See what changed' } }]),
    user([{ type: 'tool_result', tool_use_id: 'tu1', content: 'nothing to commit' }]),
    assistant([{ type: 'tool_use', id: 'tu2', name: 'Read', input: { file_path: '/w/repo/src/a.ts' } }]),
    user([{ type: 'tool_result', tool_use_id: 'tu2', content: 'export const a = 1;' }]),
    assistant([{ type: 'tool_use', id: 'tu3', name: 'Bash', input: { command: 'npm test' } }]),
    user([{ type: 'tool_result', tool_use_id: 'tu3', content: [{ type: 'text', text: '1 failing' }], is_error: true }]),
    assistant([{ type: 'tool_use', id: 'tu4', name: 'Edit', input: { file_path: '/w/repo/src/a.ts' } }]),
    rec({ type: 'system', subtype: 'away_summary', content: 'Fixed one test; one still fails.' }),
  ]);
  assert.deepEqual(t.entries.map((e) => e.k), ['prompt', 'say', 'tool', 'tool', 'tool', 'tool', 'recap']);
  const [prompt, , bash, read, failing, edit] = t.entries;
  assert.ok(prompt?.k === 'prompt' && prompt.instructions, 'a long first prompt is the task\'s instructions');
  assert.ok(bash?.k === 'tool' && bash.title === 'See what changed' && bash.code === 'git status' && bash.status === 'done' && bash.result === 'nothing to commit');
  assert.ok(read?.k === 'tool' && read.title === 'Read src/a.ts' && read.result === null, 'a file it read isn\'t repeated on the page');
  assert.ok(failing?.k === 'tool' && failing.status === 'error' && failing.result === '1 failing');
  assert.ok(edit?.k === 'tool' && edit.status === 'running', 'no result yet');
  assert.equal(t.open.size, 1);
});

test('a transcript is read loosely: junk lines, unknown records, helper agents\' turns and text Claude Code added are skipped', () => {
  const t = foldTranscript(emptyTranscript(), [
    'not json', '', rec({ type: 'attachment', attachment: { type: 'date' } }), rec({ type: 'something-new' }),
    user('<system-reminder>be good</system-reminder>'), user('Caveat: the messages below…'), user('meta', { isMeta: true }),
    assistant([{ type: 'text', text: 'from a helper' }]).replace('"type":"assistant"', '"type":"assistant","isSidechain":true'),
    user('Please also update the README.'),
  ]);
  assert.deepEqual(t.entries.map((e) => (e.k === 'prompt' ? e.text : e.k)), ['Please also update the README.']);
  assert.equal(t.read, 7, 'every JSON line is counted as read');
});

test('a result is clipped to what a page should hold, and says how much more there was', () => {
  const long = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  const t = foldTranscript(emptyTranscript(), [
    assistant([{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'cat big' } }]),
    user([{ type: 'tool_result', tool_use_id: 'a', content: long }]),
  ]);
  const e = t.entries[0]!;
  assert.ok(e.k === 'tool' && e.result!.split('\n').length === 40 && e.more === 60);
});

test('a growing file is read in whole lines, keeping the line still being written', () => {
  assert.deepEqual(splitLines('', 'a\nb\nc'), { lines: ['a', 'b'], rest: 'c' });
  assert.deepEqual(splitLines('c', 'd\n'), { lines: ['cd'], rest: '' });
  assert.equal(transcriptDir('/h/.claude/projects', '/Users/me/My Repo/.claude/worktrees/T-1'), '/h/.claude/projects/-Users-me-My-Repo--claude-worktrees-T-1');
});

test('each tool reads as a sentence: commands, files, searches, helpers, plans and MCP tools', () => {
  assert.equal(describeTool('Grep', { pattern: 'TODO', path: '/w/src' }, '/w').title, 'Searched for TODO in src');
  assert.equal(describeTool('Task', { description: 'review the diff' }, null).title, 'Asked a helper agent: review the diff');
  assert.equal(describeTool('TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }] }, null).code, '☑ a\n▸ b');
  assert.equal(describeTool('mcp__claude_ai_Atlassian__getJiraIssue', { key: 'A-1' }, null).title, 'Used claude ai Atlassian: getJiraIssue');
  assert.equal(describeTool('Bash', { command: 'ls' }, null).title, 'Ran a command', 'no description: a plain title');
});

// ---------------------------------------------------------------- output from commands acc runs

test('output is kept as a terminal shows it: colour codes dropped, progress bars redrawn in place, a tail kept', () => {
  let lines = appendOutput([], '\x1b[32mok\x1b[0m\nDownloading  10%');
  lines = appendOutput(lines, '\rDownloading 100%\r\n');
  assert.deepEqual(lines, ['ok', 'Downloading 100%', '']);
  assert.equal(appendOutput([], 'a\nb\nc\nd\n', 3).length, 3);
});

test('a quiet command is asking something when its last line looks like a question', () => {
  assert.deepEqual(promptOf('Replace it? (y/n) '), { kind: 'yesno', text: 'Replace it? (y/n)' });
  assert.equal(promptOf('Continue? [Y/n]')?.kind, 'yesno');
  assert.equal(promptOf('Enter passphrase for key:')?.kind, 'secret');
  assert.equal(promptOf('Project name:')?.kind, 'text');
  assert.equal(promptOf('Press Enter to continue')?.kind, 'text');
  assert.equal(promptOf('Deploying 14 components'), null);
  assert.equal(promptOf(''), null);
  assert.equal(promptOf('https://login.salesforce.com/'), null);
});

test('only commands that need a keyboard of their own still open a terminal', () => {
  for (const c of ['claude', 'claude attach abc', 'sudo npm i -g x', 'gh auth login', 'sf org login web --alias "<alias>"']) assert.ok(needsTerminal(c), c);
  for (const c of ['sf org login web --alias dev --instance-url https://x.my.salesforce.com', 'npm install', 'acc doctor', 'git diff --stat a...b', 'claude update']) assert.ok(!needsTerminal(c), c);
});

test('a run reads in words: running, waiting for you, done, failed with its exit code, stopped', () => {
  const r = (over: Partial<RunInput>): RunInput => ({ id: 'r', label: 'x', command: 'x', startedAt: 0, endedAt: null, code: null, stopped: false, lines: [], prompt: null, step: null, ...over });
  assert.equal(runCard(r({})).look.label, 'Running');
  assert.deepEqual([runCard(r({ prompt: { kind: 'yesno', text: '?' } })).look.label, runCard(r({ prompt: { kind: 'yesno', text: '?' } })).look.tone], ['Waiting for you', 'orange']);
  assert.equal(runCard(r({ endedAt: 1, code: 0 })).look.label, 'Done');
  assert.equal(runCard(r({ endedAt: 1, code: 2 })).look.label, 'Failed (exit 2)');
  // acc analyze exits 1 when its analysis has questions (D-054): the run says whether it went well.
  assert.equal(runCard(r({ endedAt: 1, code: 1, ok: true })).look.label, 'Done', 'a run that went well is done, whatever its exit code');
  assert.equal(runCard(r({ endedAt: 1, code: 1 })).look.label, 'Failed (exit 1)', 'with nothing said, an exit code other than 0 fails');
  assert.equal(runCard(r({ endedAt: 1, code: null, stopped: true })).look.label, 'Stopped');
  assert.equal(runCard(r({ endedAt: 1, code: 0, prompt: { kind: 'text', text: '?' } })).prompt, null, 'a finished run asks nothing');
});

// ---------------------------------------------------------------- agents' questions

test('a permission prompt reads in words, and "don\'t ask again" names what it would allow', () => {
  assert.deepEqual(describePermission('Bash', { command: 'npm run deploy', description: 'Deploy' }, '/w'), { icon: 'terminal', title: 'wants to run a command', code: 'npm run deploy', detail: 'Deploy' });
  assert.equal(describePermission('Write', { file_path: '/w/src/a.ts' }, '/w').code, 'src/a.ts');
  assert.equal(describePermission('mcp__github__create_pr', { title: 'x' }, '/w').title, 'wants to use github: create pr');
  assert.equal(alwaysLabel([{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }] }]), 'Always allow npm test:* this session');
  assert.equal(alwaysLabel([{ type: 'setMode', mode: 'acceptEdits' }]), 'Allow all edits this session');
  assert.equal(alwaysLabel([]), null);
});

test('questions are asked by the task their agent works on, and come first on the Overview, without repeats', () => {
  const hub = sampleHub();
  const cards = questionCards(hub);
  assert.deepEqual(cards.map((c) => [c.who, c.kind]), [['ACME-14', 'permission'], ['ACME-12', 'question']]);
  assert.equal(cards[1]!.questions[0]!.options.length, 3);
  const home = homeModel({ hub, section: 'overview', boards: () => sampleBoards(), identity: () => sampleIdentity(), setup: sampleSetup(), runs: sampleRuns() });
  assert.equal(home.overview.questions.length, 2);
  const titles = home.overview.attention.map((a) => a.title);
  assert.ok(!titles.some((t) => t.startsWith('ACME-14') || t.startsWith('ACME-12')), 'a task whose question is shown isn\'t listed again');
  assert.ok(titles.includes('ACME-11'), 'an agent waiting in its own terminal still shows, to attach to');
  assert.equal(home.nav[0]!.count, needsYouCount(home.overview));
  assert.equal(home.overview.stats.find((s) => s.label === 'Agents working')!.value, '2', 'agents waiting on a question aren\'t counted as working');
  assert.equal(home.runs[0]!.look.label, 'Waiting for you');
});

test('an agent\'s page: its task, its question, its actions, and an ended session still readable', () => {
  const hub = sampleHub();
  const m = agentModel({ hub, key: 's-acme-14', seen: null, entries: [{ k: 'say', id: 's', at: null, text: '**Done** soon' }], readable: true, lastAt: null });
  assert.equal(m.task?.id, 'ACME-14');
  assert.equal(m.look.label, 'Needs you: wants permission');
  assert.equal(m.questions.length, 1);
  assert.deepEqual(m.actions.map((a) => a.command), ['acc.agent.openInClaude', 'acc.agent.attach', 'acc.agent.openFolder', 'acc.agent.stop']);
  assert.ok(m.entries[0]!.k === 'say' && m.entries[0]!.body.blocks.length === 1, 'what it said is rendered from markdown');
  const ended = agentModel({ hub, key: 'gone', seen: { cwd: '/x', kind: 'background', startedAt: 1, sessionId: 'gone', name: 'T-9' }, entries: [], readable: false, lastAt: null });
  assert.deepEqual([ended.live, ended.look.label, ended.actions.map((a) => a.command)], [false, 'Ended', ['acc.agent.openInClaude', 'acc.agent.openFolder']], 'an ended session still opens in Claude Code');
});

test('answers from the page are checked, and only the fields a decision has reach the hook', () => {
  assert.ok(isFromWebview({ type: 'answer', id: 'm1-aaaa0001', decision: 'allow', answers: { 'Which?': 'Blue' } }));
  assert.ok(!isFromWebview({ type: 'answer', id: 'm1', decision: 'yes' }));
  assert.ok(!isFromWebview({ type: 'answer', id: 'm1', decision: 'allow', answers: ['Blue'] }));
  assert.ok(!isFromWebview({ type: 'run-input', run: 'r', text: 'y\nrm -rf /' }), 'one line at a time');
  assert.ok(isFromWebview({ type: 'run-control', run: 'r', action: 'stop' }));
  assert.ok(!isFromWebview({ type: 'run-control', run: 'r', action: 'kill-all' }));
  assert.deepEqual(answerOf({ type: 'answer', id: 'x', decision: 'deny', message: '  ', always: true }), { decision: 'deny' });
  assert.deepEqual(answerOf({ type: 'answer', id: 'x', decision: 'allow', always: true }), { decision: 'allow', always: true, scope: 'session' }, 'always is for the session unless the project is chosen');
});

// ---------------------------------------------------------------- history (D-037)

test('a question that has ended reads as what it asked and what you decided, blue for your yes and neutral otherwise', () => {
  const base = { v: 1 as const, id: 'h', sessionId: 's', cwd: '/w', askedAt: 1, endedAt: 2 };
  const allowed = decisionOf({ ...base, tool: 'Bash', input: { command: 'npm test' }, outcome: 'allowed-for-session' });
  assert.deepEqual([allowed.asked, allowed.code, allowed.look.label, allowed.look.tone], ['wanted to run a command', 'npm test', 'You allowed it for the session', 'blue']);
  const no = decisionOf({ ...base, tool: 'Bash', input: { command: 'git push' }, outcome: 'denied', message: 'never push' });
  assert.deepEqual([no.look.label, no.look.tone, no.detail], ['You said no', 'neutral', '"never push"']);
  const q = decisionOf({ ...base, tool: 'AskUserQuestion', input: { questions: [{ question: 'Which?', options: [] }] }, outcome: 'answered', answers: { 'Which?': 'Blue' } });
  assert.deepEqual([q.asked, q.detail, q.look.label], ['asked: Which?', 'Which? → Blue', 'You answered']);
  assert.equal(decisionOf({ ...base, tool: 'AskUserQuestion', input: {}, outcome: 'denied' }).look.label, 'You let it decide');
  assert.match(decisionOf({ ...base, tool: 'Bash', input: {}, outcome: 'no-window' }).look.label, /no Command Center was open/);
});

test('the history holds your answers, task moves, autopilot\'s steps and finished commands, newest first, and an agent\'s page shows its own decisions in place', () => {
  const hub = sampleHub();
  const items = historyItems(hub, sampleRuns());
  assert.deepEqual([...new Set(items.map((i) => i.kind))].sort(), ['answer', 'autopilot', 'move', 'run']);
  assert.ok(!items.some((i) => i.kind === 'run' && i.label.startsWith('Autopilot')), 'autopilot running is no command finished');
  assert.ok(items.every((it, i) => i === 0 || items[i - 1]!.at >= it.at), 'newest first');
  const answer = items.find((i) => i.kind === 'answer' && i.decision.look.label === 'You answered');
  assert.ok(answer && answer.kind === 'answer' && answer.who === 'ACME-12');
  assert.ok(!items.some((i) => i.kind === 'run' && i.label === 'Each branch points at the right org'), 'a command still running isn\'t history yet');
  const page = agentModel({ hub, key: 's-acme-14', seen: null, entries: [
    { k: 'say', id: 'a', at: new Date(Date.now() - 30 * 60_000).toISOString(), text: 'start' },
    { k: 'say', id: 'b', at: new Date(Date.now() - 20 * 60_000).toISOString(), text: 'after the lint fix' },
  ], readable: true, lastAt: null });
  assert.deepEqual(page.entries.map((e) => e.k), ['say', 'decision', 'say', 'decision'], 'each decision where it happened in the conversation');
});

test('a permission card offers every answer Claude Code\'s own prompt does, in its order, and a plan gets the plan\'s', () => {
  const rule = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], destination: 'localSettings' }];
  assert.deepEqual(choicesFor('Bash', rule).map((c) => c.label), [
    'Yes', 'Yes, and always allow `npm test:*` in this session', 'Yes, and always allow `npm test:*` in this project', 'Yes, and switch to auto mode',
    'Edit the command, then allow…', 'No, and tell it what to do instead…', 'No, and stop it',
  ]);
  assert.deepEqual(choicesFor('Write', []).map((c) => c.key), ['allow', 'auto', 'deny', 'stop'], 'nothing to always-allow, and only commands can be edited');
  assert.deepEqual(choicesFor('ExitPlanMode', []).map((c) => c.key), ['accept-edits', 'manual-edits', 'keep-planning', 'stop']);
  assert.deepEqual(choicesFor('AskUserQuestion', []), [], 'a question has its own options');
  assert.equal(choicesFor('Bash', rule).find((c) => c.key === 'edit')!.needs, 'command');
  assert.equal(questionCards(sampleHub())[0]!.choices.length, 7);
  assert.deepEqual(answerOf({ type: 'answer', id: 'x', decision: 'allow', always: true, scope: 'project' }), { decision: 'allow', always: true, scope: 'project' });
  assert.deepEqual(answerOf({ type: 'answer', id: 'x', decision: 'deny', stop: true }), { decision: 'deny', stop: true });
  assert.ok(!isFromWebview({ type: 'answer', id: 'x', decision: 'allow', mode: 'bypassPermissions' }));
});

test('a session opens in Claude Code through its documented link, which takes the full session id', () => {
  assert.equal(claudeSessionUri('vscode', '1f60afe9-da26-427b-a43b-7acea42f73ae'), 'vscode://anthropic.claude-code/open?session=1f60afe9-da26-427b-a43b-7acea42f73ae');
  assert.equal(claudeSessionUri('vscode-insiders', 'a', 'go on & finish'), 'vscode-insiders://anthropic.claude-code/open?session=a&prompt=go%20on%20%26%20finish');
  assert.ok(isSessionId('1f60afe9-da26-427b-a43b-7acea42f73ae'));
  assert.ok(!isSessionId('1f60afe9'), 'the short background id is not the session');
  assert.ok(!isSessionId(undefined));
});

test('a conversation is found where it is saved, from any window: likely folders first, then anywhere (D-046)', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { savedFolder } = await import('../src/transcript.ts');
  const projects = mkdtempSync(join(tmpdir(), 'projects-'));
  const wt = '/Users/me/My Repo/.claude/worktrees/GH-13';
  const id = '7bc4abb5-b4aa-4b62-a376-eced9d81d05a';
  mkdirSync(transcriptDir(projects, wt), { recursive: true });
  // It started in the main checkout and moved into its worktree: both cwds are in the file.
  writeFileSync(join(transcriptDir(projects, wt), `${id}.jsonl`), [
    JSON.stringify({ type: 'user', cwd: '/Users/me/My Repo', message: { content: 'go' } }),
    'not json',
    JSON.stringify({ type: 'assistant', cwd: wt, message: { content: [] } }),
  ].join('\n'));
  assert.equal(savedFolder(projects, id, ['/Users/me/My Repo', wt]), wt, 'a likely folder that holds it');
  assert.equal(savedFolder(projects, id, ['/Users/me/Other Client']), wt, 'from another repo\'s window: found by its file, named by its cwd');
  assert.equal(savedFolder(projects, '00000000-0000-0000-0000-000000000000', ['/Users/me/My Repo']), null, 'saved nowhere: no guess');
  assert.equal(savedFolder(join(projects, 'missing'), id, []), null);
});

test('you can write to an agent from its page only when it isn\'t working, asking, or open elsewhere (D-060)', async () => {
  const { replyState, isFromWebview } = await import('../src/model.ts');
  const bg = { kind: 'background', id: 'abc12345', pid: 42, cwd: '/w', startedAt: 1, sessionId: '7bc4abb5-b4aa-4b62-a376-eced9d81d05a' } as const;
  assert.deepEqual(replyState(null, false, false, false).can, true, 'an ended session carries on from its page');
  assert.match(replyState({ ...bg, state: 'done', status: 'idle' } as never, false, false, false).hint, /stops its background session/);
  assert.equal(replyState({ ...bg, state: 'working', status: 'busy' } as never, false, false, false).can, false);
  assert.match(replyState(null, true, false, false).hint, /Answer its question above first/);
  assert.equal(replyState({ ...bg, kind: 'interactive' } as never, false, false, false).can, false, 'open in a terminal or a Claude Code tab: one place at a time');
  assert.match(replyState(null, false, true, false).hint, /answering/);
  assert.ok(isFromWebview({ type: 'agent-reply', text: 'Use the Premium Support hours.' }));
  assert.ok(!isFromWebview({ type: 'agent-reply', text: '   ' }));
  assert.ok(!isFromWebview({ type: 'agent-reply', text: 'x'.repeat(70_000) }));
});
