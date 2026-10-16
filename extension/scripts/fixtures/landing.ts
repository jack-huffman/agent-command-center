/**
 * The Overview as a landing page (GH-160), when everything is busy at once: ten suggested rules, six tasks
 * building with their checks running, three questions, two update drafts and twelve things in History.
 * Generic sample wording, written for these screenshots: no real project's work.
 */
import type { Question } from '../../../packages/core/src/questions.ts';
import type { Suggestion } from '../../../packages/core/src/rule-suggestions.ts';
import { stepInWords } from '../../src/logic/relayed.ts';
import type { ProjectNotice } from '../../src/logic/notices.ts';
import type { TaskRow } from '../../src/logic/shared.ts';
import type { HubLike } from '../../src/model/shared.ts';
import type { RunInput } from '../../src/model/runs.ts';
import type { RepoJobs } from '../../src/progress.ts';
import type { LastStep } from '../../src/transcript.ts';
import { sampleAutopilot, sampleLongHistory } from './history.ts';
import { sampleHub } from './hub.ts';
import { sampleSuggestions } from './rules.ts';
import { MIN, ROOT, wt } from './shared.ts';

/** Eight more suggestions after the two the rules page shows: ten in all, each from a few reviews. */
function moreSuggestions(now: number): Suggestion[] {
  const at = (ago: number) => new Date(now - ago * MIN).toISOString();
  const heads = [
    'Every new Apex class has a test class beside it', 'A flow names its fault path', 'Field labels are sentence case', 'A trigger does no work outside its handler',
    'Each page names its controls for a screen reader', 'Queries in a loop are moved out of it', 'A permission set grants each new field', 'Dates are shown in the user\'s time zone',
  ];
  return heads.map((head, i): Suggestion => {
    const sha = `${(0xb1c2d3e + i * 0x10101).toString(16)}`.padEnd(40, '0').slice(0, 40);
    const task = `ACME-${12 + (i % 4)}`;
    return {
      id: `r-${(0x5a0000 + i).toString(16)}`, kind: i % 3 === 2 ? 'check' : 'rule', by: 'rule', head, line: `${head}.`, written: i % 3 === 2 ? 'CLAUDE.md' : null, again: null,
      findings: 3 + (i % 3), tasks: 3, must: i % 2, hint: i % 2 ? 'test' : 'lint',
      sources: [0, 1, 2].map((k) => ({
        finding: `${task}@${sha.slice(0, 7)}#${k + 1}`, task: `ACME-${12 + ((i + k) % 4)}`, sha, at: at((i + 1) * 60 + k * 30), sessionId: `5e5500${i}${k}-0000-4000-8000-000000000000`,
        name: `Review ACME-${12 + ((i + k) % 4)}`, message: `${head}: found again in this review.`, must: k === 0 && i % 2 === 1, file: `force-app/main/default/classes/Sample${i}.cls`, line: 10 + k, counted: true,
      })),
    };
  });
}

/** A third question: ACME-13's builder wants to run its tests against the Dev org. */
function thirdQuestion(now: number): Question {
  return {
    v: 1, id: 'm1-aaaa0003', pid: 1, at: now - 2 * MIN, sessionId: 's-acme-13', cwd: wt('ACME-13'), transcript: null, tool: 'Bash',
    input: { command: 'sf apex run test --class-names LeadServiceTest --target-org "Acme Dev" --wait 20', description: 'Run the duplicate-lead tests in the Dev org' }, suggestions: [],
  };
}

/** Three more tasks building, each with a check running, beside ACME-14, ACME-12 and ACME-13. */
const BUILDING: [string, string, string][] = [
  ['ACME-43', 'Archive email attachments to Files', 'claude-sonnet-5-5'],
  ['ACME-44', 'Show the SLA timer on the case page', 'claude-opus-5-5'],
  ['ACME-45', 'Import price books from the ERP export', 'claude-sonnet-5-5'],
];
/** And three more ready, so Ready has more than it shows. */
const READY: [string, string][] = [
  ['ACME-46', 'Add a renewal stage to the Opportunity path'],
  ['ACME-47', 'Email the case contact when a case reopens'],
  ['ACME-48', 'Hide closed territories from the picker'],
];

/**
 * The busy Overview (GH-160). Six tasks build at once, six of six builders, each with a heavy check in a slot
 * and ACME-13's second check waiting for one; ten rules suggested by findings that keep coming back; three
 * questions; two update drafts; and twelve things in History: five moves, four of autopilot's steps and
 * three answers.
 */
export function sampleLandingHub(now = Date.now()): HubLike {
  const hub = sampleHub(now);
  const root = hub.projects[0]!.root;
  const ago = (min: number) => new Date(now - min * MIN).toISOString();
  const base = hub.taskRows(root);
  const source = (id: string) => ({ kind: 'jira', url: `https://acme.atlassian.net/browse/${id}` });
  const building = BUILDING.map(([id, title, model], i): TaskRow => ({
    id, title, state: 'running', display: 'running', environment: 'dev', deps: [], source: source(id),
    run: { bgId: `bg${id.slice(5)}`, sessionId: `s-${id.toLowerCase()}`, worktree: wt(id), model, name: id }, agent: { label: 'Working', icon: 'sync~spin', tone: 'blue' }, model,
    since: ago(6 + i * 7), branchStats: { commits: 1 + i, files: 2 + i * 2, uncommitted: i },
  }));
  const ready = READY.map(([id, title]): TaskRow => ({ id, title, state: 'todo', display: 'ready', environment: 'dev', deps: [], source: source(id), analysisRequired: false, files: { known: false, shares: [], first: [], held: null } }));
  // The stopped builders would be In progress too: six tasks build here, no more.
  const rows = [...base.filter((r) => r.id !== 'ACME-28' && r.id !== 'ACME-29').map((r) => ({ ...r, analyzing: null })), ...building, ...ready];
  const jobs: RepoJobs = { repo: `${root}/.git/acc/ledger.json`, max: 6, jobs: [], reviews: [], analyses: [], resumes: [] };
  const steps: Record<string, LastStep> = {
    's-acme-14': { step: { icon: 'terminal', title: 'Validate the routing against the Dev org', at: ago(3) }, model: 'claude-opus-5-5' },
    's-acme-12': { step: { icon: 'edit', title: 'Edited force-app/main/default/classes/EscalationService.cls', at: ago(2) }, model: 'claude-sonnet-5-5' },
    's-acme-13': { step: { icon: 'terminal', title: 'Run the Apex tests for the duplicate-lead batch', at: ago(1) }, model: 'claude-opus-5-5' },
    's-acme-43': { step: { icon: 'edit', title: 'Edited force-app/main/default/classes/AttachmentArchiver.cls', at: ago(1) }, model: 'claude-sonnet-5-5' },
    's-acme-44': { step: { icon: 'search', title: 'Read force-app/main/default/lwc/slaTimer/slaTimer.js', at: ago(2) }, model: 'claude-opus-5-5' },
    's-acme-45': { step: { icon: 'terminal', title: 'Run the price book import against a sample file', at: ago(4) }, model: 'claude-sonnet-5-5' },
  };
  const held = (slot: number, what: string, task: string, min: number) => ({ slot, pid: 7000 + slot, at: now - min * MIN, what, task, project: 'Acme Service', cwd: wt(task) });
  const suggestions = [...sampleSuggestions(now), ...moreSuggestions(now)];
  const autopilot = sampleAutopilot(now).filter((r) => [203, 210, 219, 221].includes(r.seq)).map(stepInWords);
  const answers = (hub.answers ?? []).filter((a) => ['h1', 'h3', 'h4'].includes(a.id));
  return {
    ...hub,
    questions: [...(hub.questions ?? []), thirdQuestion(now)],
    answers,
    taskRows: () => rows,
    updates: () => hub.updates!(root).filter((u) => u.id === 'ACME-10.2' || u.id === 'ACME-12.2'),
    suggestions: (r: string) => (r === root ? suggestions : []),
    autopilotLog: () => autopilot,
    heavy: {
      dir: '/Users/me/.acc/heavy', slots: 6,
      held: [held(1, 'validate', 'ACME-14', 5), held(2, 'validate', 'ACME-12', 2), held(3, 'near-tests', 'ACME-13', 1), held(4, 'tests', 'ACME-43', 3), held(5, 'validate', 'ACME-44', 4), held(6, 'near-tests', 'ACME-45', 1)],
      waiting: [{ pid: 7100, at: now - 1 * MIN, place: 1, what: 'tests', task: 'ACME-13', project: 'Acme Service' }],
    },
    machine: { load: 9.1, cpus: 10 },
    jobsOf: () => jobs,
    stepOf: (id) => steps[id] ?? null,
  };
}

/**
 * No command this window ran: History's twelve are its moves, autopilot's steps and your answers, and the
 * output panel stays shut.
 */
export const sampleLandingRuns = (): RunInput[] => [];

/**
 * What changed while the person was away (D-164), for Since you last looked: a review passed, a pull request
 * merged, a task ready for review with a long title, an analysis ready and one back.
 */
export const sampleSince = (): ProjectNotice[] => [
  { root: ROOT, notice: { kind: 'passed', task: 'ACME-16', text: 'The review passed ACME-16. It\'s ready to land.', urgent: false } },
  { root: ROOT, notice: { kind: 'merged', task: 'ACME-17', text: 'Pull request #142 merged. ACME-17 is done.', urgent: false } },
  { root: ROOT, notice: { kind: 'review', task: 'ACME-43', text: 'ACME-43 is ready for review: Archive email attachments to Files, and remove each one from its email once the copy is checked', urgent: false } },
  { root: ROOT, notice: { kind: 'analysis-ready', task: 'ACME-46', text: 'ACME-46\'s analysis is ready.', urgent: false } },
  { root: ROOT, notice: { kind: 'analysis-back', task: 'ACME-14', text: 'ACME-14\'s analysis is back. Its 2 questions can be answered on its page.', urgent: false } },
];

/**
 * The busy Overview with History of more than two pages (D-???): 100 entries over six or seven days, each a
 * task's move or a command acc ran, and none of autopilot's steps or your answers.
 */
export function sampleLongHub(now = Date.now()): { hub: HubLike; runs: RunInput[] } {
  const long = sampleLongHistory(now);
  return { hub: { ...sampleLandingHub(now), history: () => long.moves, autopilotLog: () => [], answers: [] }, runs: long.runs };
}
