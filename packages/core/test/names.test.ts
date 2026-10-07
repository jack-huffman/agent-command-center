import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanName, NAME_PART_MAX, sessionName, shortTitle, tokenLike } from '../src/names.ts';

test('an agent is named for its project, task and role, in the form the author chose (D-???)', () => {
  assert.equal(sessionName({ project: 'Acme Service', key: 'ACME-12', title: 'Case escalation rules', role: 'builder' }), 'Acme Service · ACME-12 Case escalation rules · builder');
  // The next word would take the title past 39 characters, so it's cut before it.
  assert.equal(sessionName({ project: 'Acme Service', key: 'ACME-21', title: 'Contact roles missing on OpportunityContactRoleRecords', role: 'analysis' }), 'Acme Service · ACME-21 Contact roles missing on… · analysis');
  assert.equal(sessionName({ project: 'Acme Service', key: 'ACME-12', title: 'Case escalation rules', role: 'review' }), 'Acme Service · ACME-12 Case escalation rules · review');
});

test('only builders are numbered, from their second dispatch on', () => {
  const name = (role: 'builder' | 'review' | 'analysis', n?: number) => sessionName({ project: 'P', key: 'T-1', title: 'Work', role, n });
  assert.equal(name('builder'), 'P · T-1 Work · builder');
  assert.equal(name('builder', 1), 'P · T-1 Work · builder');
  assert.equal(name('builder', 2), 'P · T-1 Work · builder 2');
  assert.equal(name('builder', 3), 'P · T-1 Work · builder 3');
  assert.equal(name('review', 2), 'P · T-1 Work · review', 'each review is a one-off');
  assert.equal(name('analysis', 3), 'P · T-1 Work · analysis');
});

test('a title is cut at a word to 40 characters, its … included', () => {
  const forty = 'abcd efgh ijkl mnop qrst uvwx yzab cdefg';
  assert.equal(forty.length, 40);
  assert.equal(shortTitle(forty), forty, 'exactly 40 stays whole');
  assert.equal(shortTitle(`${forty}h`), 'abcd efgh ijkl mnop qrst uvwx yzab…', '41 is cut at the last word that fits');
  const word = 'x'.repeat(60);
  assert.equal(shortTitle(word), `${'x'.repeat(39)}…`, 'one long word is cut where it must be');
  assert.equal(shortTitle('Fix the layout, then the related list pages'), 'Fix the layout, then the related list…');
  assert.equal(shortTitle('Fix the layout of the Account page, refreshing it'), 'Fix the layout of the Account page…', 'a comma before the cut goes');
  for (const t of [forty, `${forty}h`, word, 'a '.repeat(50)]) assert.ok(shortTitle(t).length <= NAME_PART_MAX, t);
  assert.equal(sessionName({ project: 'P', key: 'T-1', title: '', role: 'builder' }), 'P · T-1 · builder', 'no title leaves the key alone');
  assert.equal(sessionName({ project: 'P', key: 'T-1', title: '$$$ ???', role: 'builder' }), 'P · T-1 · builder', 'nor does a title that cleans away');
  assert.equal(sessionName({ project: 'A very long project name for one of our clients', key: 'T-1', title: 'Work', role: 'builder' }), 'A very long project name for one of our… · T-1 Work · builder');
});

test('a name holds nothing a shell or Claude Code would trip on, and no path or token', () => {
  for (const c of ['"', '\'', '`', '$', '\\', '!', ';', '|', '&', '<', '>', '*', '?', '/', '~', '·', '…', '\n', '\t', '\r', '\u0007', '\u001b']) {
    const name = sessionName({ project: `Acme${c}Co`, key: 'T-1', title: `Fix${c}it`, role: 'builder' });
    assert.ok(!name.slice(0, -' · builder'.length).replace(' · T-1 ', ' ').includes(c), JSON.stringify(c));
    assert.equal(name.split(' · ').length, 3, `${JSON.stringify(c)} never adds a separator`);
  }
  assert.equal(cleanName('Fix "it" now; rm -rf ~/x && echo $HOME'), 'Fix it now rm -rf x echo HOME');
  assert.equal(cleanName('Read /Users/jack/repo/force-app\\main'), 'Read Users jack repo force-app main', 'a path falls apart into words');
  assert.equal(cleanName('Line one\nline two\ttab'), 'Line one line two tab');
  assert.equal(cleanName('Région: Ünïcode (ok) + #12, done.'), 'Région: Ünïcode (ok) + #12, done.', 'letters of any language stay');
  assert.equal(cleanName('Add Region__c to Account'), 'Add Region__c to Account');
  assert.equal(cleanName('Rotate ghp_abcdefghijklmnop1234567890 now'), 'Rotate now');
  assert.equal(cleanName('Key sk-ant-api03-abcDEF123 leaked'), 'Key leaked');
  assert.equal(cleanName('Token a1b2c3d4e5f6a7b8c9d0e1f2 here'), 'Token here');
  assert.equal(cleanName('Slack xoxb-123-456 and AKIAIOSFODNN7EXAMPLE and eyJhbGciOiJIUzI1NiJ9'), 'Slack and and');
  assert.ok(tokenLike('github_pat_11ABC'));
  assert.ok(!tokenLike('OpportunityContactRoleRecords'), 'a long word of letters alone is a word');
  assert.ok(!tokenLike('Salesforce2026'), 'a short word with a year is a word');
  assert.equal(sessionName({ project: 'P', key: 'T-1; rm -rf /', title: 'x', role: 'builder' }), 'P · T-1rm-rf x · builder', 'a key that isn\'t an id is cut to what an id holds');
});
