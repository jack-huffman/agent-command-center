// The screenshot pages, one list a line (T-102): written once, a page a line in groups, and merged by git as
// a union of both sides' lines, so two branches that each add a page both keep theirs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { run } from '../../packages/core/src/exec.ts';
import { PAGES, STILL, viewOf, WIDTHS } from '../scripts/pages.ts';
import { HOME_SECTIONS } from '../src/model/shared.ts';
import { root } from './support.ts';

const FILE = 'extension/scripts/pages.ts';
const top = join(root, '..');

test('pages.ts names each page on a line of its own, under a comment that says its group', () => {
  const text = readFileSync(join(top, FILE), 'utf8');
  const list = text.slice(text.indexOf('export const PAGES = ['), text.indexOf('] as const;'));
  const lines = list.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  const named = lines.filter((l) => l.startsWith('\''));
  assert.ok(named.length > 100, `it read ${named.length} pages`);
  for (const l of named) assert.match(l, /^'[a-z0-9-]+',$/, `one page a line: ${l}`);
  assert.equal(named.length + HOME_SECTIONS.length, PAGES.length, 'every page but the sections is one of these lines');
  assert.ok(lines.filter((l) => l.startsWith('//')).length >= 5, 'in groups, each with its comment');
  assert.ok(lines.every((l) => l.startsWith('\'') || l.startsWith('//') || l === '...HOME_SECTIONS,'), 'nothing else in the list');
});

test('git merges pages.ts as a union, and the floors file with the floors driver', () => {
  const attr = (path: string) => run('git', ['check-attr', 'merge', '--', path], { cwd: top }).stdout.trim();
  assert.equal(attr(FILE), `${FILE}: merge: union`);
  assert.equal(attr('.acc/floors.json'), '.acc/floors.json: merge: acc-floors');
  assert.equal(attr('extension/scripts/screenshot.ts'), 'extension/scripts/screenshot.ts: merge: unspecified', 'an edge case: no other file is a union, where two versions of one line would both be kept');
});

test('the kind of tab each page draws in, the widths, and the pages drawn with no model', () => {
  assert.deepEqual([viewOf('ticket-talk'), viewOf('agent'), viewOf('agents-path'), viewOf('tasks')], ['ticket', 'agent', 'home', 'home']);
  assert.deepEqual([...WIDTHS], [1000, 620, 500]);
  assert.deepEqual([...STILL], ['loading']);
});
