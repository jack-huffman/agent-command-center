// acc's plan commands (T-97): a person chooses an option for each of a plan's design choices, and
// approves its latest version. Only a person does either.

import { type Analysis, AccError, approvePlan, askOf, choiceName, choosePlan, lapsedWords, planProblems, planVersion, recommendedName } from '../../../core/src/index.ts';
import { tone } from '../format.ts';
import { type CommandArea, noAgent, now, type Opts, out, project } from '../shared.ts';

/**
 * A plan's version, its choices with their options, and its approval, as a person reads them. A first
 * version with no choices that nobody approved shows nothing, as before plans.
 */
export function planLines(a: Analysis): string[] {
  const v = planVersion(a);
  if (v === 1 && !a.decisions?.length && !a.approval && !a.lapsed) return [];
  const lapsed = lapsedWords(a);
  return [
    a.approval ? tone(`✓ Plan v${v}, approved by ${a.approval.by} at ${a.approval.at}`, 'blue') : tone(`! Plan v${v}: ${lapsed ? `${lapsed}. Approve it again` : 'not approved yet'}`, 'orange'),
    ...(a.changes?.length ? ['', `What changed in v${v}`, ...a.changes.map((c) => `  - ${c}`)] : []),
    ...(a.decisions?.length ? ['', 'Choices', ...a.decisions.flatMap((d) => [
      `  ${d.id}. ${d.title}${d.choice ? tone(`  → ${choiceName(d)} (${d.choice.by})`, 'blue') : tone('  (not chosen yet)', 'orange')}`,
      ...d.options.map((o) => `     ${o.id}) ${o.name}${o.id === d.recommended ? ' [recommended]' : ''}  Effort ${o.effort}. ${o.means}`),
      tone(`     Recommends ${recommendedName(d)}: ${d.because}`, 'dim'),
    ])] : []),
    ...(a.earlier?.length ? ['', tone(`Earlier versions: ${a.earlier.map((e) => `v${planVersion(e)}${e.approval ? ' (approved)' : ''}`).join(', ')}`, 'dim')] : []),
  ];
}

/** "for you" or "for the ticket's author", after a question. */
export const askedOf = (q: Parameters<typeof askOf>[0]): string => (askOf(q) === 'author' ? 'for the ticket\'s author' : 'for you');

function cmdChoose(o: Opts, id: string, decision: string, option: string | undefined): number {
  const by = noAgent(o, 'make a plan\'s choices');
  const text = typeof o.text === 'string' ? o.text : undefined;
  if (option === undefined && text === undefined) throw new AccError('usage', 'acc plan choose <id> <choice> <option|--text "…">');
  const { paths } = project(process.cwd());
  const { plan: a, decision: d, changed } = choosePlan(paths, id.toUpperCase(), decision, text !== undefined ? { text, ...(option !== undefined ? { option } : {}) } : { option }, by, now, o.yes === true);
  const left = planProblems(a, a.task);
  out(o, () => [
    // The option already chosen, picked again: nothing changed, and an approval holds.
    changed ? tone(`Chosen for ${a.task}'s ${d.id}, ${d.title}: ${choiceName(d)}.`, 'blue') : tone(`${a.task}'s ${d.id}, ${d.title}, is already ${choiceName(d)}: nothing changed.`, 'blue'),
    ...(a.lapsed && !a.approval ? [tone(`! ${lapsedWords(a)}: approve it again with acc plan approve ${a.task}.`, 'orange')] : []),
    ...(left.length ? left.map((l) => tone(`  ${l}`, 'dim')) : []),
  ].join('\n'), a);
  return 0;
}

function cmdApprove(o: Opts, id: string): number {
  const by = noAgent(o, 'approve a plan');
  const { paths } = project(process.cwd());
  const a = approvePlan(paths, id.toUpperCase(), by, now);
  out(o, () => tone(`Approved ${a.task}'s plan v${a.approval!.version}. It can be built now: acc dispatch ${a.task}.`, 'blue'), a);
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Agents',
    order: 32,
    lines: `  acc plan choose <id> <choice> <option> Choose one of the options for a design choice in the task's plan, by its
                                        letter or name; --text "<your own option>" instead of an option. A change
                                        on an approved plan undoes the approval: --yes says you mean it
  acc plan approve <id>                 Approve the plan's latest version. Where a plan is required, a task is
                                        built only once its choices are made and its latest version approved`,
  },
  options: {
    text: { type: 'string' },
    yes: { type: 'boolean', default: false },
  },
  subcommands: { plan: ['choose', 'approve'] },
  commands: {
    plan: (o, rest) => {
      if (rest[0] === 'choose') {
        if (!rest[1] || !rest[2]) throw new AccError('usage', 'acc plan choose <id> <choice> <option|--text "…">');
        return cmdChoose(o, rest[1], rest[2], rest[3] === undefined ? undefined : rest.slice(3).join(' '));
      }
      if (rest[0] === 'approve') {
        if (!rest[1]) throw new AccError('usage', 'acc plan approve <id>');
        return cmdApprove(o, rest[1]);
      }
      throw new AccError('usage', 'acc plan choose <id> <choice> <option|--text "…">, or acc plan approve <id>');
    },
  },
};
