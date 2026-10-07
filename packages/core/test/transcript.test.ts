import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { claudeProjectsDir, lastModelIn, lastSaid, lastSaidIn, savedFolder, transcriptDir, transcriptFile } from '../src/transcript.ts';
import { gh41Lines, SLEPT, tempDir } from './support.ts';

test('the last thing an agent said is its newest text, Claude Code\'s own API error included (GH-41)', () => {
  const projects = tempDir('projects-');
  const cwd = '/Users/me/repo/.claude/worktrees/GH-41';
  const dir = transcriptDir(projects, cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sess-41.jsonl'), gh41Lines('sess-41', cwd).join('\n') + '\n');
  assert.equal(lastSaid(projects, 'sess-41', [cwd]), SLEPT);
  assert.equal(lastSaid(projects, 'sess-41', []), SLEPT, 'found anywhere in the projects folder');
  assert.equal(transcriptFile(projects, 'sess-41', [cwd]), join(dir, 'sess-41.jsonl'));
  assert.equal(savedFolder(projects, 'sess-41', []), cwd, 'the folder it\'s saved under, from the cwd it recorded (D-046)');
  assert.equal(lastSaid(projects, 'no-such-session', [cwd]), null);
  assert.equal(lastSaidIn(join(dir, 'missing.jsonl')), null);
});

test('only the end of a long transcript is read, and a cut first line is skipped', () => {
  const projects = tempDir('projects-');
  const file = join(projects, 'long.jsonl');
  const filler = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(1000) } });
  const said = (text: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  writeFileSync(file, [said('said long ago'), ...Array(400).fill(filler), said('  the latest words  '), filler].join('\n'));
  assert.equal(lastSaidIn(file), 'the latest words');
  writeFileSync(file, [said('said long ago'), ...Array(400).fill(filler)].join('\n'));
  assert.equal(lastSaidIn(file), null, 'words before the last 256 KB aren\'t looked for');
});

test('the model an agent last answered with is read from its transcript\'s end, past Claude Code\'s own messages and a helper\'s turns (D-086)', () => {
  const file = join(tempDir('projects-'), 'model.jsonl');
  const turn = (model: string, o: Record<string, unknown> = {}) => JSON.stringify({ type: 'assistant', ...o, message: { model, content: [{ type: 'text', text: 'hi' }] } });
  writeFileSync(file, [turn('claude-opus-5-5'), turn('claude-sonnet-5-5'), turn('claude-haiku-4-5-20251001', { isSidechain: true }), turn('<synthetic>'), JSON.stringify({ type: 'user', message: { content: 'go on' } })].join('\n') + '\n');
  assert.equal(lastModelIn(file), 'claude-sonnet-5-5');
  writeFileSync(file, JSON.stringify({ type: 'user', message: { content: 'start' } }) + '\n');
  assert.equal(lastModelIn(file), null, 'before its first answer');
  assert.equal(lastModelIn(join(tempDir('projects-'), 'missing.jsonl')), null);
});

test('Claude Code\'s projects folder follows CLAUDE_CONFIG_DIR', () => {
  assert.equal(claudeProjectsDir({ CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/me' }), '/cfg/projects');
  assert.equal(claudeProjectsDir({ HOME: '/home/me' }), '/home/me/.claude/projects');
});
