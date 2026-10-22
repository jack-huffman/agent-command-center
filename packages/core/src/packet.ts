// The builder's packet and its session's settings: what acc writes into a task's worktree when it dispatches it.

import { autoMergeFor, builderGatesFor, type Config, type Environment, fullGates, requiredGates } from './config.ts';
import { DONE_COMMAND, NOTE_LIMITS, noteMarkdown, type Task } from './ledger.ts';
import { permissionHook } from './questions.ts';
import { type Analysis, analysisSection } from './analyze.ts';
import { recordPacketSection } from './records.ts';
import { type ChecksReport, checksSection, type QueueReport, queueSection } from './checks.ts';
import type { Verdict } from './review.ts';
import { shapeSection } from './shape-split.ts';
import { type Team, teamSection } from './team.ts';

// ---------------------------------------------------------------- the packet (DESIGN.md section 8)

export interface PacketInput {
  task: Task;
  config: Config;
  env: Environment;
  worktree: string;
  branch: string;
  rules: string | null;
  environmentSpecific: string[];
  /** The full path of the acc executable, given as a fallback in case an agent doubts it's on PATH. */
  accPath?: string;
  /** On a rework, the review that asked for changes (D-032). */
  review?: Verdict | null;
  /** On a rework, the task branch's latest commit. A passed review's findings reach a person's send-back only when the review was of this commit (T-76). */
  head?: string;
  /** On a rework autopilot sent back, what GitHub's checks said on its pull request (D-076). */
  checks?: ChecksReport | null;
  /** On a rework the merge queue sent back, what it found: a conflict with the base, or the full check failing (GH-73). */
  queue?: QueueReport | null;
  /** What the task's analysis found, and what a person answered (D-052). */
  analysis?: Analysis | null;
  /** The tasks it depends on, directly, with the note each one's builder left (D-106). */
  deps?: Pick<Task, 'id' | 'title' | 'run' | 'state' | 'changes'>[];
  /** Its team as dispatch saw it (T-103): the other tasks in flight, sharing first, and what merged since its branch left. */
  team?: Team | null;
}

/**
 * On a re-dispatch, what the task's last run left (D-106): its builder's note, or that it left none, so
 * this builder checks the tree before trusting what's there. `task.run` is still the last run here.
 */
function lastRunSection(task: Task, env: Environment): string[] {
  const r = task.run;
  if (!r) return [];
  const check = `\`git status\`, \`git log --oneline origin/${env.branch}..HEAD\` and \`acc gate list\``;
  const which = r.n ? ` (builder ${r.n})` : '';
  const blocked = [...task.history].reverse().find((h) => h.to === 'blocked' && h.from === 'running' && (!r.startedAt || h.at >= r.startedAt));
  const said = blocked?.reason?.trim() ? ['', 'It blocked, saying:', '', ...blocked.reason.trim().split('\n').map((l) => `> ${l}`)] : [];
  if (!r.note) {
    return [
      '## Your last run left no note',
      '',
      `This task ran before${which}, and that run ended without a note: it may have crashed, run out of context or been stopped, or a person moved it. Don't assume its work is finished, or that none was done. Start by checking the tree: ${check}.`,
      ...said,
      '',
    ];
  }
  return [
    '## What your last run left',
    '',
    `This task ran before${which}, and its builder left this note when it ${r.note.ended === 'blocked' ? 'blocked' : 'moved it to review'}. It's that builder's own account: check it against the tree (${check}) before you build on it.`,
    ...said,
    '',
    ...noteMarkdown(r.note),
    '',
  ];
}

/** The notes the tasks it depends on left when they finished (D-106). One that left none isn't listed. */
function depsSection(deps: PacketInput['deps']): string[] {
  const noted = (deps ?? []).filter((d) => d.run?.note);
  if (!noted.length) return [];
  return [
    '## What the tasks it depends on left',
    '',
    `This task builds on ${noted.length === 1 ? 'another, whose builder' : `${noted.length} others, whose builders each`} left a note when it finished. Each is that builder's own account.`,
    '',
    ...noted.flatMap((d) => [`### ${d.id}: ${d.title}`, '', ...noteMarkdown(d.run!.note!), '']),
  ];
}

const findingAt = (f: { file?: string; line?: number }) => (f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`: ` : '');

/** On a rework: what the review asked for, so the next run fixes that and leaves the rest. */
function reviewSection(v: Verdict | null | undefined): string[] {
  if (!v || v.verdict !== 'changes') return [];
  const must = v.findings.filter((f) => f.must);
  const unmet = v.criteria.filter((c) => !c.met);
  return [
    '## What the review asked for',
    '',
    `This is a rework. The reviewer looked at ${v.sha.slice(0, 7)} and asked for changes: ${v.summary}`,
    '',
    ...must.map((f) => `- ${findingAt(f)}${f.message}${f.rule ? ` (rule: ${f.rule})` : ''}`),
    ...unmet.map((c) => `- Not met yet: ${c.text}. ${c.evidence}`),
    ...(must.length || unmet.length ? [''] : []),
    'Fix these, and keep the rest of the change as it is. Then finish as below.',
    '',
  ];
}

/**
 * The findings a passed review listed, for a person's send-back (T-76): the review of the branch's latest
 * commit only. A review that asked for changes shows its must-fix findings in reviewSection, so it adds
 * none here; one of an older commit, or none, says nothing.
 */
function passedFindings(v: Verdict | null | undefined, head: string | undefined): string[] {
  if (!v || v.verdict !== 'pass' || !v.findings.length || !head || v.sha !== head) return [];
  return [
    `The review of ${v.sha.slice(0, 7)} passed, and listed these findings:`,
    '',
    ...v.findings.map((f) => `- ${f.must ? '**Must fix:** ' : ''}${findingAt(f)}${f.message}${f.rule ? ` (rule: ${f.rule})` : ''}`),
    '',
  ];
}

/**
 * On a rework a person sent back: why, in their words. A review that passed shows no findings, so without
 * this the builder sees nothing to fix and finishes unchanged, as GH-80 did twice.
 */
function sentBackSection(task: Task, review: Verdict | null | undefined, head: string | undefined): string[] {
  const back = [...task.history].reverse().find((h) => h.to === 'rework');
  if (task.state !== 'rework' || !back || back.actor !== 'human' || !back.reason?.trim()) return [];
  return [
    '## Why a person sent it back',
    '',
    `${back.by.replace(/^human:/, '')} moved it back to rework${back.from ? ` from ${back.from}` : ''}, saying:`,
    '',
    ...back.reason.trim().split('\n').map((l) => `> ${l}`),
    '',
    ...passedFindings(review, head),
    'Do what it asks, and keep the rest of the change as it is. Then finish as below.',
    '',
  ];
}

/** What a person wrote for the builder (T-74), under its own heading; nothing when there are no notes. */
export function notesSection(task: Pick<Task, 'notes'>): string[] {
  const notes = task.notes?.trim();
  return notes ? ['## Notes for the builder', '', notes, ''] : [];
}

function commitRef(task: Task): string {
  if (task.source.kind === 'github') return ` Add \`refs #${task.id.replace(/^GH-/, '')}\` on its own line, so GitHub links the commit to the issue.`;
  return '';
}

export function renderPacket(p: PacketInput & { enterWorktree?: boolean; cloud?: boolean }): string {
  const { task, config, env } = p;
  const sf = config.profile === 'salesforce';
  // A builder's checks: the lighter ones, where the merge queue runs the full one before the merge (GH-73).
  const required = requiredGates(config, env.branch, 'builder');
  const lighter = builderGatesFor(config, env.branch);
  const lines: string[] = [
    `# Task ${task.id}: ${task.title}`,
    '',
    `You are the builder for ${task.id}. Work only on this task, only in this worktree, and stop when it's done.`,
    '',
  ];
  if (p.enterWorktree) {
    lines.push(
      '## First, before anything else',
      '',
      `Call the **EnterWorktree** tool with the path \`${p.worktree}\`. Do this before reading or editing any file. Your session starts in the main checkout, which you must never change. Claude Code keeps you inside the worktree once you've entered it.`,
      '',
    );
  }
  lines.push(
    '## The task',
    '',
    task.brief.trim() || '_No details were given beyond the title. If the title alone is too vague to build from, block (see the finish line) and say what you need._',
    '',
    task.source.url ? `Ticket: ${task.source.url}` : `Source: ${task.source.kind}`,
    '',
    ...notesSection(task),
    ...analysisSection(p.analysis ?? null),
    ...recordPacketSection(p.analysis?.recordChanges ?? [], config.profile === 'salesforce'),
    ...depsSection(p.deps),
    // The rest of a shape-first split names the shape it builds on (T-104).
    ...shapeSection(task, p.deps ?? []),
    ...(p.team ? teamSection(p.team, 'builder') : []),
    ...lastRunSection(task, env),
    ...reviewSection(p.review),
    ...sentBackSection(task, p.review, p.head),
    ...checksSection(p.checks),
    ...queueSection(p.queue),
    '## Where you are',
    '',
    // A cloud builder's workspace is its session's clone (GH-69): the worktree is where acc collects its branch.
    // The Mac's paths stay out of the cloud's instructions: they name the home folder, and mean nothing there.
    ...(p.cloud ? ['- **Workspace:** this cloud session\'s clone of the repo. acc collects your branch into the task\'s worktree on the Mac.'] : [`- **Worktree:** \`${p.worktree}\`. This is your only workspace.`]),
    `- **Branch:** \`${p.branch}\`, started from \`${env.branch}\`, the ${env.name} environment's branch.${p.cloud ? ' It\'s on GitHub already: check it out, and push only it.' : ''}`,
  );
  if (sf && env.org) lines.push(`- **Org:** \`${env.org}\` (${env.name}). It's already this worktree's default org.`);
  lines.push(
    '',
    '## How to work',
    '',
    `- **Commits:** \`${task.id}: <what changed>\`, one logical change per commit.${commitRef(task)} Never write "fixes", "closes" or "resolves" in a commit message; the ticket is closed by a person.`,
    '- **Changes:** keep them to what the task asks. If you find something else that needs fixing, put it in your note\'s `--open` lines (see the finish line) instead of fixing it.',
  );
  if (sf) {
    lines.push(
      '- **Salesforce:** validate, never deploy. `acc gate run validate` proves a change with a check-only deploy to the org; nothing is saved. Real deploys happen after a person merges.',
      '- **Tests:** if you change Apex, name the test classes that cover it and why each is the right one: `acc gate run validate --test <TestClass>="<why>"`, once per class.',
    );
  }
  lines.push('', '## The finish line', '');
  lines.push('1. **Commit** everything the task needs. Leave nothing uncommitted.');
  if (required.length) {
    lines.push(
      `2. **Checks:** run exactly \`acc gate run\`. It runs the required checks (${required.map((g) => `\`${g}\``).join(', ')}) on your latest commit and records each result; \`acc done\` refuses until every one has passed. If one fails, fix it, commit, and run \`acc gate run\` again. If a check can't run at all (it says error), block and quote its message.`,
    );
    // The full check's own: stray-files is a builder's too (GH-103).
    const queued = fullGates(config).filter((g) => !required.includes(g));
    if (lighter && queued.length) {
      lines.push(`   These are the lighter checks, such as the tests near what you changed. The full check (${queued.map((g) => `\`${g}\``).join(', ')}) runs once, in the merge queue, before your pull request merges, so you needn't run it, though \`acc gate run ${queued[0]}\` does if you want to.`);
    }
    // A number that may only get better (GH-99): acc raises its floor, the builder commits it, and only a person relaxes one.
    const ratchets = required.filter((g) => config.gates.ratchets?.[g]);
    if (ratchets.length) {
      lines.push(`   ${ratchets.map((g) => `\`${g}\``).join(', ')} ${ratchets.length === 1 ? 'is a ratchet' : 'are ratchets'}: a number that may only get better. When yours beats its floor, \`acc gate run\` writes the new floor to \`.acc/floors.json\`: commit that file, then run \`acc gate run\` again. Never make the number, or a floor in that file, worse by hand. If this change has to make one worse, block and say why: only a person relaxes a floor.`);
    }
    if (sf) {
      lines.push('   If you changed Apex, add `--test <TestClass>="<why it covers the change>"` once per test class, for example `acc gate run --test AccountServiceTest="covers the new discount rule"`. Those flags are the only thing to add.');
    }
  } else {
    lines.push('2. **Checks:** run the project\'s tests or build if it has them, and report the results.');
  }
  lines.push(
    `3. **Finish** with a note, by running \`acc done\` as its own command, all on one line: \`${DONE_COMMAND}\`. It is already on your PATH and pre-approved. Don't run it through npm scripts, \`npx\`, or other wrappers, and don't chain it with other commands, or it will stop for permission.`,
    `   The note is for whoever comes next: the reviewer, the next builder and the pull request read it, and it's posted on the pull request on GitHub, so keep secrets and client data out of it. \`--landed\` says what the change does now; \`--moved\` which numbers moved (tests added, checks passed, ratchets raised); \`--open\` what's left undone or worth a follow-up, each line something a person could make a task of. Give a flag again for each further line, up to ${NOTE_LIMITS.lines} a part and ${NOTE_LIMITS.chars} characters a line. \`--moved none\` and \`--open none\` say there was nothing. Use double quotes, with no backticks or \`$\` inside them. \`acc done\` refuses without a note.`,
    '   If you\'re stuck, run exactly `acc block "<what you need>"` instead, and stop. If part of the work landed, add the same `--landed`, `--moved` and `--open` to it.',
    '   If only the client can answer what you need (a business rule, access you don\'t have, or a choice that\'s theirs to make), run exactly `acc block --client "<your question>"` instead, and stop. Write the question for the client, in plain words with no code, file or tool names: a person reads it before it goes on the ticket.',
    ...(p.accPath ? [`   If \`acc\` really isn't found, its full path is \`${p.accPath}\`.`] : []),
    '4. **Summarize** your note in your final message, with anything a reviewer should look at.',
    '',
    '## Never',
    '',
    // Merging the base into this branch is the builder's to do when the merge queue asks (GH-73); a pull request isn't.
    '- push, merge a pull request, or open one (a person, `acc land` and autopilot do that)',
  );
  if (sf) lines.push('- deploy to any org (`sf project deploy start`)');
  lines.push(
    '- edit files outside this worktree, or check out another branch',
    '- change the ticket or the task list, apart from `acc done` and `acc block`',
  );
  if (p.environmentSpecific.length) {
    lines.push('- edit an environment-specific file (D-016). Each org keeps its own version of these:', ...p.environmentSpecific.map((f) => `  - \`${f}\``));
  }
  // Every project's rules (GH-104), the profile's, then rules copied in, then the repo's own, which win (GH-108): rulesText's order.
  if (p.rules?.trim()) lines.push('', '## Rules', '', p.rules.trim());
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- the builder's session

/**
 * Settings for the builder session: who it is, acc on its PATH, routine commands allowed, and the
 * dangerous ones denied. Deny beats allow, so this holds even when the user's own settings allow them.
 */
export function builderSettings(task: Task, config: Config, accBinDir: string, basePath: string, accCommand?: string): Record<string, unknown> {
  const sf = config.profile === 'salesforce';
  const allow = [
    'Bash(acc done*)', 'Bash(acc block *)', 'Bash(acc show *)', 'Bash(acc gate run)', 'Bash(acc gate run *)', 'Bash(acc gate list*)',
    // Its team as of now, and taking in a teammate's merge (T-103): acc refresh merges into its own branch only, and pushes nothing.
    'Bash(acc team*)', 'Bash(acc refresh)',
    'Bash(git status*)', 'Bash(git diff*)', 'Bash(git add *)', 'Bash(git commit *)', 'Bash(git log*)', 'Bash(git show *)',
    // Bringing its own base in, as the merge queue asks when it conflicts (GH-73), with or without flags such
    // as --no-edit: only where the queue runs, so where auto-merge is off, a Salesforce project above all, a
    // builder still asks first. Any other branch it still asks about.
    ...(autoMergeFor(config, task.environment) ? [`Bash(git merge origin/${task.environment})`, `Bash(git merge origin/${task.environment} *)`] : []),
    'Bash(npm test*)', 'Bash(npm run *)', 'Bash(npx prettier *)', 'Bash(npx eslint *)', 'Bash(node --test*)', 'Bash(node --no-warnings --test*)',
    // A project may ask for builds and tests under nice, so the machine stays usable: the same commands, niced.
    'Bash(nice -n 15 npm test*)', 'Bash(nice -n 15 npm run *)', 'Bash(nice -n 15 npx prettier *)', 'Bash(nice -n 15 npx eslint *)',
    'Bash(nice -n 15 node --test*)', 'Bash(nice -n 15 node --no-warnings --test*)',
    ...(sf ? ['Bash(sf project deploy validate *)', 'Bash(sf code-analyzer run *)', 'Bash(sf apex run test *)', 'Bash(sf data query *)', 'Bash(acc change record *)', 'Bash(acc change none *)', 'Bash(acc change list*)'] : []),
  ];
  const deny = [
    'Bash(git push*)', 'Bash(gh pr *)', 'Bash(git checkout *)', 'Bash(git switch *)', 'Bash(git worktree *)', 'Bash(git reset --hard*)',
    'Bash(acc set *)', 'Bash(acc edit*)', 'Bash(acc dispatch *)', 'Bash(acc init*)', 'Bash(acc gate waive*)', 'Bash(acc gate relax*)', 'Bash(acc land*)', 'Bash(acc review*)', 'Bash(acc autopilot*)', 'Bash(acc agents set*)', 'Bash(acc agents autonomy*)', 'Bash(acc agents auto-merge*)', 'Bash(acc agents max*)', 'Bash(acc gate required*)', 'Bash(acc gate builder*)', 'Bash(acc analyze*)', 'Bash(acc analysis answer*)', 'Bash(acc rules import*)', 'Bash(acc rules accept*)', 'Bash(acc rules dismiss*)', 'Bash(acc trackers set*)', 'Bash(acc github use*)', 'Bash(acc tidy add*)', 'Bash(acc tidy skip*)', 'Bash(acc promote*)', 'Bash(acc deploy*)', 'Bash(acc update*)', 'Bash(acc resume*)', 'Bash(acc machine*)', 'Bash(acc sync --close-done*)', 'Bash(acc collect*)', 'Bash(acc cloud*)', 'Bash(acc change step*)',
    // Releases are a person's (D-079): npm run * is allowed above, and deny beats allow.
    'Bash(gh release create*)', 'Bash(gh release upload*)', 'Bash(gh release edit*)', 'Bash(gh release delete*)', 'Bash(npm run release*)', 'Bash(nice -n 15 npm run release*)',
    ...(sf ? ['Bash(sf project deploy start*)', 'Bash(sf project deploy quick*)', 'Bash(sf org delete *)'] : []),
  ];
  return {
    env: { ACC_TASK: task.id, ACC_ROLE: 'builder', PATH: `${accBinDir}:${basePath}` },
    permissions: { allow, deny },
    // Its permission prompts and questions go to the Command Center when one is open (D-030).
    ...(accCommand ? { hooks: permissionHook(accCommand) } : {}),
  };
}
