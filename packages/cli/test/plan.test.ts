// acc plan choose and acc plan approve (T-97): a person's choices in a task's plan, and their approval.
// acc runs from its source, in throwaway repos (support.ts).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SF_CONFIG } from '../../core/test/support.ts';
import { askedOf, planLines } from '../src/commands/plan.ts';
import { cli, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

const option = (id: string, name: string) => ({ id, name, means: `${name} means this`, pros: [], cons: [], effort: 'S', risks: [], touches: [] });

/** A Salesforce repo, where a plan is required, with ACME-7 to do and its plan: a question for you, one for the author, and a choice. */
function planRepo(plan = true) {
  const dir = repoWithConfig(SF_CONFIG);
  assert.equal(acc(dir, ['import'], JSON.stringify([{ source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Track stage history' }])).code, 0);
  if (plan) {
    mkdirSync(join(dir, '.git', 'acc', 'analyses'), { recursive: true });
    writeFileSync(join(dir, '.git', 'acc', 'analyses', 'ACME-7.json'), JSON.stringify({
      v: 1, task: 'ACME-7', env: 'dev', base: 'x', verdict: 'questions', summary: 'Track Stage.', requirements: { goal: '', criteria: [], assumptions: [], outOfScope: [] },
      questions: [{ id: 'q1', question: 'Closed deals too?', why: '', suggested: 'Yes', askOf: 'you' }, { id: 'q2', question: 'Who reads it?', why: '', suggested: 'Managers', askOf: 'author' }],
      decisions: [{ id: 'd1', title: 'Where history is kept', why: '', options: [option('a', 'Field history'), option('b', 'Custom object')], recommended: 'a', because: 'Nothing to build.' }],
      findings: [], approach: { plan: [], files: [], refactors: [], risks: [], tests: [], size: 'S' }, split: [], orgs: [], sessionId: 's', at: '2026-10-22T10:00:00Z', durationMs: 0, costUsd: null,
    }));
  }
  return dir;
}

const plan = (dir: string) => JSON.parse(readFileSync(join(dir, '.git', 'acc', 'analyses', 'ACME-7.json'), 'utf8'));

test('acc plan choose records an option, or the person\'s own words with --text, with --json', () => {
  const dir = planRepo();
  const r = acc(dir, ['plan', 'choose', 'acme-7', 'd1', 'b', '--json'], undefined, { USER: 'jordan' });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual({ ...r.json().decisions[0].choice, at: '' }, { option: 'b', by: 'human:jordan', at: '' });
  const human = acc(dir, ['plan', 'choose', 'ACME-7', '1', 'Field', 'history']);
  assert.equal(human.code, 0, human.err);
  assert.match(human.out, /Chosen for ACME-7's d1, Where history is kept: Field history\./);
  const own = acc(dir, ['plan', 'choose', 'ACME-7', 'd1', '--text', 'A big object', '--json']);
  assert.equal(own.code, 0, own.err);
  assert.equal(own.json().decisions[0].choice.option, null);
  assert.equal(plan(dir).decisions[0].choice.text, 'A big object');
  // acc analysis shows the choice, the plan's version and who can answer each question.
  const shown = acc(dir, ['analysis', 'ACME-7']);
  assert.match(shown.out, /Plan v1: not approved yet/);
  assert.match(shown.out, /d1\. Where history is kept {2}→ A big object/);
  assert.match(shown.out, /a\) Field history \[recommended\] {2}Effort S\. Field history means this/);
  assert.match(shown.out, /q2\. Who reads it\? \(for the ticket's author\)/);
});

test('acc plan approve is refused until the questions for you and the choices are settled, then pins the version, and a change undoes it', () => {
  const dir = planRepo();
  const early = acc(dir, ['plan', 'approve', 'ACME-7', '--json']);
  assert.equal(early.code, 1);
  assert.match(early.out + early.err, /isn't ready to approve: answer q1, and choose d1 first/);
  assert.equal(acc(dir, ['analysis', 'answer', 'ACME-7', 'q1', 'Yes']).code, 0, 'q2 is for the author, so it waits on nothing');
  assert.equal(acc(dir, ['plan', 'choose', 'ACME-7', 'd1', 'a']).code, 0);
  const held = acc(dir, ['dispatch', 'ACME-7', '--json']);
  assert.equal(held.code, 1);
  assert.match(held.out + held.err, /ACME-7's plan v1 isn't approved/);
  const ok = acc(dir, ['plan', 'approve', 'ACME-7', '--json'], undefined, { USER: 'jordan' });
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual({ ...ok.json().approval, at: '' }, { version: 1, by: 'human:jordan', at: '' });
  assert.match(acc(dir, ['analysis', 'ACME-7']).out, /✓ Plan v1, approved by human:jordan/);
  // A changed choice undoes the approval, once the person says yes to that, and says so.
  const changed = acc(dir, ['plan', 'choose', 'ACME-7', 'd1', 'b', '--yes']);
  assert.equal(changed.code, 0, changed.err);
  assert.match(changed.out, /v1 changed since it was approved: approve it again with acc plan approve ACME-7\./);
  assert.equal(plan(dir).approval, undefined);
  assert.equal(plan(dir).lapsed.version, 1);
});

test('on an approved plan, acc plan choose refuses a change without --yes, takes it with --yes and --json, and changes nothing for the option already chosen', () => {
  const dir = planRepo();
  assert.equal(acc(dir, ['analysis', 'answer', 'ACME-7', 'q1', 'Yes']).code, 0);
  assert.equal(acc(dir, ['plan', 'choose', 'ACME-7', 'd1', 'a']).code, 0);
  assert.equal(acc(dir, ['plan', 'approve', 'ACME-7'], undefined, { USER: 'jordan' }).code, 0);
  // The option already chosen, by its letter or its name: nothing changes, and the approval holds.
  const same = acc(dir, ['plan', 'choose', 'ACME-7', 'd1', 'Field', 'history']);
  assert.equal(same.code, 0, same.err);
  assert.match(same.out, /ACME-7's d1, Where history is kept, is already Field history: nothing changed\./);
  assert.doesNotMatch(same.out, /approve it again/);
  const sameJson = acc(dir, ['plan', 'choose', 'ACME-7', 'd1', 'a', '--json']);
  assert.equal(sameJson.json().approval.by, 'human:jordan');
  // Another option, or the person's own words, without --yes: refused, with why, and nothing changes.
  for (const args of [['d1', 'b'], ['d1', '--text', 'A big object'], ['d1', 'b', '--json']]) {
    const r = acc(dir, ['plan', 'choose', 'ACME-7', ...args]);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.out + r.err, /This plan is approved\. Changing this choice undoes the approval, and the plan must be approved again before it's built\. To change it anyway, run it again with --yes\./);
  }
  assert.deepEqual([plan(dir).approval.version, plan(dir).decisions[0].choice.option], [1, 'a'], 'refused: still approved, still a');
  // With --yes it changes, and the approval lapses.
  const yes = acc(dir, ['plan', 'choose', 'ACME-7', 'd1', 'b', '--yes', '--json']);
  assert.equal(yes.code, 0, yes.err);
  assert.deepEqual([yes.json().decisions[0].choice.option, yes.json().approval, yes.json().lapsed.version], ['b', undefined, 1]);
});

test('acc plan refuses anyone but a person, an unknown choice or option, no plan, and a missing argument', () => {
  const dir = planRepo();
  for (const role of ['builder', 'reviewer', 'analyst']) {
    for (const args of [['plan', 'choose', 'ACME-7', 'd1', 'a'], ['plan', 'approve', 'ACME-7']]) {
      const r = acc(dir, args, undefined, { ACC_ROLE: role, ACC_TASK: 'ACME-7' });
      assert.equal(r.code, 1, `${role}: ${args.join(' ')}`);
      assert.match(r.err, new RegExp(`An? ${role} can't (make a plan's choices|approve a plan)\\. A person does that\\.`));
    }
  }
  const autopilot = acc(dir, ['plan', 'approve', 'ACME-7', '--as', 'orchestrator', '--by', 'orchestrator:autopilot']);
  assert.equal(autopilot.code, 1);
  assert.match(autopilot.err, /Only a person can approve a plan/);
  assert.equal(plan(dir).decisions[0].choice, undefined, 'nobody but a person chose');
  const unknown = acc(dir, ['plan', 'choose', 'ACME-7', 'd1', 'z']);
  assert.equal(unknown.code, 2, 'a usage error');
  assert.match(unknown.err, /d1 has no option z\. It has: a \(Field history\), b \(Custom object\)/);
  assert.match(acc(dir, ['plan', 'choose', 'ACME-7', 'd4', 'a']).err, /has no choice d4/);
  assert.match(acc(dir, ['plan', 'choose', 'ACME-7', 'd1']).err, /acc plan choose <id> <choice> <option\|--text/);
  assert.match(acc(dir, ['plan', 'choose', 'ACME-7', 'd1', 'a', '--text', 'mine']).err, /not both/);
  assert.match(acc(dir, ['plan', 'approve']).err, /acc plan approve <id>/);
  assert.match(acc(dir, ['plan', 'nothing']).err, /acc plan choose/);
  const none = planRepo(false);
  for (const args of [['plan', 'choose', 'ACME-7', 'd1', 'a'], ['plan', 'approve', 'ACME-7', '--json']]) {
    const r = acc(none, args);
    assert.equal(r.code, 1);
    assert.match(r.out + r.err, /ACME-7 has no plan yet: acc analyze ACME-7\./);
  }
});

test('acc plan split makes the shape task and the rest for a person, and is refused for an agent, with no suggestion, and with no id', () => {
  const dir = planRepo();
  const file = join(dir, '.git', 'acc', 'analyses', 'ACME-7.json');
  const none = acc(dir, ['plan', 'split', 'ACME-7']);
  assert.equal(none.code, 1);
  assert.match(none.err, /ACME-7's plan suggests no shape-first split/);
  const suggested = { ...plan(dir), sharedShapes: [{ name: 'Stage history format', kind: 'schema', why: 'ACME-8 reads it', files: ['force-app/History__c.object'], users: ['ACME-8'] }], shapeSplit: { why: 'ACME-8 needs only the format.', first: { title: 'The stage history format', brief: 'The object and its tests.' }, rest: { title: 'Show stage history', brief: 'The page.' } } };
  writeFileSync(file, JSON.stringify(suggested));
  const agent = acc(dir, ['plan', 'split', 'ACME-7'], undefined, { ACC_ROLE: 'builder', ACC_TASK: 'ACME-7' });
  assert.equal(agent.code, 1);
  assert.match(agent.err, /A builder can't split a task\. A person does that\./);
  assert.match(acc(dir, ['plan', 'split']).err, /acc plan split <id>/);
  const ok = acc(dir, ['plan', 'split', 'acme-7', '--json'], undefined, { USER: 'jordan' });
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual(ok.json(), { first: 'T-1', rest: 'T-2' });
  assert.deepEqual(plan(dir).shapeSplit.made.by, 'human:jordan');
  const tasks = acc(dir, ['list', '--json']).json();
  const rest = tasks.find((t: { id: string }) => t.id === 'T-2');
  assert.deepEqual(rest.deps, ['T-1']);
  assert.equal(tasks.find((t: { id: string }) => t.id === 'ACME-7').state, 'blocked');
  assert.match(acc(dir, ['plan', 'split', 'ACME-7']).err, /already split into T-1 and T-2/);
});

test('planLines shows nothing for a first plan with no choices and no approval, as before plans; askedOf names who answers', () => {
  const plain = { version: 1, questions: [], decisions: [] } as never;
  assert.deepEqual(planLines(plain), []);
  assert.match(planLines({ ...(plain as object), version: 2, earlier: [{ version: 1, approval: { version: 1, by: 'human:me', at: '' } }] } as never).join('\n'), /Plan v2: not approved yet[\s\S]*Earlier versions: v1 \(approved\)/);
  assert.equal(askedOf({}), 'for you');
  assert.equal(askedOf({ askOf: 'author' }), 'for the ticket\'s author');
});
