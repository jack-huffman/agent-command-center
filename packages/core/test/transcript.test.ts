import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { claudeProjectsDir, lastSaid, lastSaidIn, savedFolder, transcriptDir, transcriptFile } from '../src/transcript.ts';
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

test('Claude Code\'s projects folder follows CLAUDE_CONFIG_DIR', () => {
  assert.equal(claudeProjectsDir({ CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/me' }), '/cfg/projects');
  assert.equal(claudeProjectsDir({ HOME: '/home/me' }), '/home/me/.claude/projects');
});
