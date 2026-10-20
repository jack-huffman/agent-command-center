// acc tracking (T-73): whether a Salesforce project uses source tracking, shown, or set by a person.
// acc runs from its source, in throwaway repos (support.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GENERIC_CONFIG, makeRepo, SF_CONFIG } from '../../core/test/support.ts';
import { cli } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

test('acc tracking shows it, and a person turns it off and on in .acc/config.json, changing nothing else', () => {
  const text = JSON.stringify(SF_CONFIG, null, 2) + '\n';
  const dir = makeRepo({ '.acc/config.json': text });
  const file = join(dir, '.acc', 'config.json');
  assert.deepEqual(acc(dir, ['tracking', '--json']).json(), { salesforce: true, sourceTracking: true });
  assert.match(acc(dir, ['tracking']).out, /^source tracking on \(project\): Setup checks that each Developer sandbox is source tracked/);

  const off = acc(dir, ['tracking', 'off', '--json']);
  assert.equal(off.code, 0, off.err);
  assert.deepEqual(off.json(), { salesforce: true, sourceTracking: false });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { ...SF_CONFIG, sourceTracking: false }, 'only the key was added');
  assert.match(acc(dir, ['tracking']).out, /^source tracking off \(project\): this project doesn't use source tracking, so Setup skips its source-tracking checks\./);
  // Setup's B8 steps skip, with the reason.
  const doctor = acc(dir, ['doctor', '--part', 'project', '--step', 'B8.tracking', '--json']);
  assert.match(doctor.out, /doesn't use source tracking/);

  assert.match(acc(dir, ['tracking', 'on']).out, /^source tracking on \(project\): .* Set in \.acc\/config\.json: commit it to share it\./);
  assert.equal(readFileSync(file, 'utf8'), text, 'on is the default, so the key goes again');
});

test('edge cases: a wrong word, an agent, and a project that isn\'t Salesforce are refused, and the file is left alone', () => {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(SF_CONFIG) });
  const file = join(dir, '.acc', 'config.json');
  const before = readFileSync(file, 'utf8');
  assert.equal(acc(dir, ['tracking', 'maybe']).code, 2);
  assert.equal(acc(dir, ['tracking', 'off', 'now']).code, 2);
  for (const role of ['builder', 'reviewer', 'analyst']) {
    const r = acc(dir, ['tracking', 'off'], undefined, { ACC_ROLE: role, ACC_TASK: 'T-1' });
    assert.equal(r.code, 1, role);
    assert.match(r.err, new RegExp(`${role} can't change whether the project uses source tracking`));
  }
  assert.equal(readFileSync(file, 'utf8'), before, 'nothing refused touched the file');

  const generic = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  assert.deepEqual(acc(generic, ['tracking', '--json']).json(), { salesforce: false, sourceTracking: null });
  const r = acc(generic, ['tracking', 'off']);
  assert.equal(r.code, 1);
  assert.match(r.err, /Source tracking is a Salesforce setting: this project isn't a Salesforce project\./);
});
