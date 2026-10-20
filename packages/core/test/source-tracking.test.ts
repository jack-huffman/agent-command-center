// Whether a Salesforce project uses source tracking (T-73): the default, and how a person changes it.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { loadConfig, parseConfig } from '../src/config.ts';
import { NO_TRACKING_REASON, setSourceTracking, usesSourceTracking } from '../src/source-tracking.ts';
import { GENERIC_CONFIG, SF_CONFIG, tempDir } from './support.ts';

const configFile = (raw: unknown, text = JSON.stringify(raw, null, 2) + '\n'): string => {
  const file = join(tempDir('tracking-'), 'config.json');
  writeFileSync(file, text);
  return file;
};

test('a project uses source tracking unless its config says false', () => {
  assert.equal(usesSourceTracking(parseConfig(SF_CONFIG).config!), true, 'left out');
  assert.equal(usesSourceTracking(parseConfig({ ...SF_CONFIG, sourceTracking: true }).config!), true);
  assert.equal(usesSourceTracking(parseConfig({ ...SF_CONFIG, sourceTracking: false }).config!), false);
  assert.match(NO_TRACKING_REASON, /^This project doesn't use source tracking/);
});

test('off writes false and changes nothing else; on takes the key out again, since on is the default', () => {
  const text = JSON.stringify(SF_CONFIG, null, 2) + '\n';
  const file = configFile(null, text);
  setSourceTracking(file, false);
  const off = readFileSync(file, 'utf8');
  assert.equal(loadConfig(file).config.sourceTracking, false);
  assert.deepEqual(JSON.parse(off), { ...SF_CONFIG, sourceTracking: false }, 'nothing else changed');
  setSourceTracking(file, false);
  assert.equal(readFileSync(file, 'utf8'), off, 'the same value twice changes nothing');
  setSourceTracking(file, true);
  assert.equal(readFileSync(file, 'utf8'), text, 'back as it was');
  assert.deepEqual(readdirSync(dirname(file)), ['config.json'], 'no temp file is left beside it');
});

test('edge cases: a project that isn\'t Salesforce, a file that isn\'t JSON, and one that\'s missing are refused and left alone', () => {
  const generic = configFile(GENERIC_CONFIG);
  const before = readFileSync(generic, 'utf8');
  for (const on of [true, false]) {
    assert.throws(() => setSourceTracking(generic, on), /Source tracking is a Salesforce setting: this project isn't a Salesforce project\./);
  }
  assert.equal(readFileSync(generic, 'utf8'), before);
  const broken = configFile(null, '{ not json');
  assert.throws(() => setSourceTracking(broken, false), /config\.json isn't valid JSON/);
  assert.equal(readFileSync(broken, 'utf8'), '{ not json');
  assert.throws(() => setSourceTracking(join(tempDir('none-'), 'config.json'), false), /No .*config\.json/);
  assert.throws(() => setSourceTracking(configFile(null, 'null'), false), /has problems/);
});

test('setSourceTracking has no read and parse of its own: it checks the profile and calls writeJsonKey', () => {
  const src = readFileSync(new URL('../src/source-tracking.ts', import.meta.url), 'utf8');
  assert.match(src, /writeJsonKey\(configFile/);
  assert.doesNotMatch(src, /readFileSync|JSON\.parse|editJsonKey|writeAtomic/);
});

test('edge case: a Salesforce config with any other problem is refused, whichever way tracking is set, and left alone (T-77)', () => {
  const file = configFile({ ...SF_CONFIG, agents: { max: 'many' } });
  const before = readFileSync(file, 'utf8');
  for (const on of [true, false]) {
    assert.throws(() => setSourceTracking(file, on), /has problems/);
    assert.equal(readFileSync(file, 'utf8'), before, 'left alone');
  }
});
