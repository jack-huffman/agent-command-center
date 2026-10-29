// This machine by its platform's name (T-150): a Mac on darwin, a PC on win32, a computer elsewhere, and the
// messages, the place labels and the cloud builder's prompt read it from there, so Windows never hears "Mac".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builderPlaceLook, cloudText } from '../src/cloud.ts';
import { cloudReviewWait } from '../src/cloud-review.ts';
import type { Config, Environment } from '../src/config.ts';
import type { Task } from '../src/ledger.ts';
import { machineNoun, thisMachine, thisMachineLabel } from '../src/this-machine.ts';

/** Runs fn as if acc ran on another system: process.platform reads `platform` until it returns. */
function onSystem<T>(platform: NodeJS.Platform, fn: () => T): T {
  const was = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...was, value: platform });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', was);
  }
}

test('this machine is a Mac on darwin, a PC on win32 and a computer on Linux, as a noun, mid-sentence and as a label', () => {
  const cases: [string, string, string, string][] = [
    ['darwin', 'Mac', 'this Mac', 'This Mac'],
    ['win32', 'PC', 'this PC', 'This PC'],
    ['linux', 'computer', 'this computer', 'This computer'],
  ];
  for (const [platform, noun, mid, label] of cases) {
    assert.deepEqual([machineNoun(platform), thisMachine(platform), thisMachineLabel(platform)], [noun, mid, label], platform);
  }
  assert.equal(cases.length, 3);
});

test('edge case: a system acc doesn\'t name, or none, is a computer, never a Mac', () => {
  for (const platform of ['freebsd', 'aix', 'sunos', '']) assert.equal(machineNoun(platform), 'computer', platform || 'empty');
});

test('the words follow the system acc runs on when none is given: process.platform, read at the call', () => {
  assert.equal(onSystem('win32', () => thisMachine()), 'this PC');
  assert.equal(onSystem('darwin', () => thisMachineLabel()), 'This Mac');
  assert.equal(onSystem('linux', () => machineNoun()), 'computer');
});

test('a local builder\'s place is This PC on Windows and This Mac on a Mac, with the same icon; the cloud is the cloud on both', () => {
  assert.deepEqual(builderPlaceLook('win32'), { local: { label: 'This PC', icon: 'device-desktop' }, cloud: { label: 'Cloud', icon: 'cloud' } });
  assert.deepEqual(builderPlaceLook('darwin'), { local: { label: 'This Mac', icon: 'device-desktop' }, cloud: { label: 'Cloud', icon: 'cloud' } });
  assert.equal(onSystem('win32', () => builderPlaceLook().local.label), 'This PC', 'with no system given, the one acc runs on');
});

test('on Windows, a quiet cloud review and the cloud builder\'s prompt say PC and never Mac; on a Mac they say Mac as before', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  const task = { state: 'review', cloudReview: { firedAt: '2026-10-29T08:00:00Z', branch: 'acc/review/T-1-abc', sha: 'abc', url: 'u', sessionId: 's' } } as unknown as Task;
  const config = { agents: { cloud: { quietMinutes: 120 } }, gates: { commands: {} } } as unknown as Config;
  const prompt = () => cloudText({ task: { ...task, id: 'T-1', title: 'A thing' }, config, env: { branch: 'main' } as Environment, branch: 'task/T-1', packet: 'The packet.', checks: { inCloud: ['lint'], macOnly: ['deploy'] } });
  const wait = (p: NodeJS.Platform) => onSystem(p, () => cloudReviewWait(task, config, now));
  assert.equal(wait('win32'), 'no verdict from its cloud reviewer for 240 minutes: review it on this PC');
  assert.equal(wait('darwin'), 'no verdict from its cloud reviewer for 240 minutes: review it on this Mac');
  const onPc = onSystem('win32', prompt);
  assert.doesNotMatch(onPc, /\bMac\b/);
  assert.match(onPc, /acc runs them on the PC when it collects your branch/);
  assert.match(onSystem('darwin', prompt), /acc runs them on the Mac when it collects your branch/);
});
