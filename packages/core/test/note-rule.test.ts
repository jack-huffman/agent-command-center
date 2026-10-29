// How an agent writes to a person (T-146): every place a builder or reviewer is told it says it, and a review's
// words reach a person with their API names as code. The fields here are made up.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { BLOCK_SHAPE, NOTE_RULE } from '../src/agent-notes.ts';
import { parseConfig } from '../src/config.ts';
import { shortPacket } from '../src/hooks.ts';
import { emptyLedger, upsertTasks } from '../src/ledger.ts';
import { renderPacket } from '../src/packet.ts';
import { approvedPlanLines } from '../src/plan.ts';
import { checkVerdict, reviewPrompt } from '../src/review.ts';
import { rulesText } from '../src/rules.ts';
import { GENERIC_CONFIG, makeRepo } from './support.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const now = () => new Date('2026-10-29T12:00:00Z');

function task() {
  const config = parseConfig(GENERIC_CONFIG).config!;
  const l = emptyLedger();
  upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Regions on deals', brief: 'b' }], 'human', 'human:test', () => {}, now);
  return { config, task: l.tasks[0]! };
}

test('the packet, its short version, the plan\'s rules and the plugin\'s skills each tell the note\'s shape; none is missing', () => {
  const { config, task: t } = task();
  const repo = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  const told = {
    packet: renderPacket({ task: t, config, env: config.environments.find((e) => e.default)!, worktree: '/w', branch: 'b', rules: rulesText(repo, config.profile), environmentSpecific: [] }),
    short: shortPacket({ ...t, run: { worktree: '/w', branch: 'b' } } as never, ['test']),
    plan: approvedPlanLines({ approval: null, decisions: [] } as never).join('\n'),
  };
  let checked = 0;
  for (const [where, text] of Object.entries(told)) {
    assert.ok(text.includes(NOTE_RULE), where);
    checked++;
  }
  for (const skill of ['plugin/skills/task/SKILL.md']) {
    const text = readFileSync(join(ROOT, skill), 'utf8');
    assert.ok(text.includes(BLOCK_SHAPE), skill);
    assert.match(text, /acc puts it in backticks as it records the note/, skill);
    checked++;
  }
  assert.match(readFileSync(join(ROOT, 'plugin/skills/orchestrate/SKILL.md'), 'utf8'), /a headline, then a bullet per thing/);
  assert.equal(checked, 4);
  assert.match(NOTE_RULE, /never a paragraph/);
  assert.match(NOTE_RULE, /at most three/);
});

test('the reviewer is told to keep findings short with API names in backticks, and a verdict missing them gets them as it\'s read', () => {
  const { config, task: t } = task();
  const { system } = reviewPrompt({ task: t, config, envName: 'dev', envBranch: 'main', sha: 'abcdef1234', packet: '# packet', diff: '', stat: '', checks: [], rules: null });
  assert.match(system, /each finding is one thing, never a paragraph of several\. Put API names in backticks/);
  const v = checkVerdict({ verdict: 'changes', summary: 'It sets Region__c twice.', client: 'Regions show on deals.', criteria: [], findings: [{ message: 'Deal_Page.flexipage-meta.xml names Region__c; use `Territory__c`.', must: true }] });
  assert.equal(v.summary, 'It sets `Region__c` twice.');
  assert.equal(v.findings[0]!.message, '`Deal_Page.flexipage-meta.xml` names `Region__c`; use `Territory__c`.');
  assert.equal(v.client, 'Regions show on deals.', 'the client\'s sentence has no code, and none is added');
});
