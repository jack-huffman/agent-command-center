// What the junk test (GH-106, junk.test.ts) found acc doing with bad arguments, one test a cause, each naming
// the commands it covers. They run acc from its source, as the command groups' tests do, in throwaway repos.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DONE_COMMAND } from '../../core/src/index.ts';
import { GENERIC_CONFIG, makeRepo, tempDir } from '../../core/test/support.ts';
import { failureLine } from '../src/main.ts';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const HEAVY_DIR = join(tempDir('acc-heavy-'), 'slots');

function acc(cwd: string, args: string[]) {
  const r = spawnSync(process.execPath, ['--no-warnings', MAIN, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ACC_ROLE: '', ACC_TASK: '', ACC_HEAVY_DIR: HEAVY_DIR },
  });
  return { code: r.status ?? 1, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}

const repoWithConfig = (): string => makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });

/** A refusal in one line on stderr, with no stack: what every junk call must get. */
const oneLine = (r: { code: number; err: string }, code: number): string => {
  assert.equal(r.code, code, r.err);
  const lines = r.err.split('\n').filter((l) => l.trim());
  assert.equal(lines.length, 1, r.err);
  assert.doesNotMatch(r.err, /^\s+at /m);
  return lines[0]!;
};

test('a file that can\'t be read is a usage error in words, not a raw ENOENT: acc import --file, acc intake jira|azure|monday --file, acc update post --text-file (GH-106)', () => {
  const dir = repoWithConfig();
  const folder = tempDir('acc-folder-');
  assert.match(oneLine(acc(dir, ['import', '--file', join(folder, 'missing.json')]), 2), /^✗ Can't read .*missing\.json: there's no such file\.$/);
  assert.match(oneLine(acc(dir, ['import', '--file', folder]), 2), /: it's a folder\.$/);
  assert.match(oneLine(acc(dir, ['import', '--file', 'x'.repeat(5000)]), 2), /: the name is too long\.$/);
  for (const kind of ['jira', 'azure', 'monday']) assert.match(oneLine(acc(dir, ['intake', kind, '--file', join(folder, 'nope.json')]), 2), /there's no such file/, kind);
  const json = acc(dir, ['import', '--file', folder, '--json']);
  assert.equal(json.code, 2);
  assert.deepEqual(json.json(), { error: 'usage', message: `Can't read ${folder}: it's a folder.` });
});

test('a folder named as a team template or rules file is refused in one line: acc template show, acc init --from, acc rules import (GH-106)', () => {
  const dir = repoWithConfig();
  const folder = tempDir('acc-folder-');
  assert.match(oneLine(acc(dir, ['template', 'show', folder]), 1), /isn't a file, so it can't be a team template\./);
  assert.match(oneLine(acc(makeRepo(), ['init', '--from', folder]), 1), /isn't a file/);
  assert.match(oneLine(acc(dir, ['rules', 'import', folder]), 1), /isn't a file/);
});

test('an id that climbs out of the repo reaches no file: acc analysis, acc analysis answer (GH-106)', () => {
  const dir = repoWithConfig();
  // What "../../../../OUTSIDE/X" reaches from .git/acc/analyses: a folder beside the repo, with an analysis that names it.
  const outside = join(dir, '..', 'OUTSIDE');
  mkdirSync(outside, { recursive: true });
  const id = '../../../../OUTSIDE/X';
  const bait = JSON.stringify({ v: 1, task: id, verdict: 'questions', questions: [{ id: 'q1', text: 'Bait?', options: [] }] });
  writeFileSync(join(outside, 'X.json'), bait);
  assert.match(oneLine(acc(dir, ['analysis', 'answer', id, 'q1', 'hi']), 1), /hasn't been analyzed yet/);
  assert.equal(readFileSync(join(outside, 'X.json'), 'utf8'), bait, 'the file outside is unchanged');
  assert.match(oneLine(acc(dir, ['analysis', id]), 1), /hasn't been analyzed yet/, 'nor read');
  rmSync(outside, { recursive: true, force: true });
});

test('a failure that echoes a long argument cuts it to 200 characters, and keeps acc\'s own words: acc show, dispatch, review and every other id (GH-106)', () => {
  const dir = repoWithConfig();
  const long = 'x'.repeat(100_000);
  for (const args of [['show', long], ['dispatch', long], ['review', long]]) {
    const line = oneLine(acc(dir, args), 1);
    assert.ok(line.length <= 260, `acc ${args[0]}: ${line.length} characters`);
    assert.match(line, /x{199}…/i, 'the echoed word ends with an ellipsis');
  }
  assert.ok((acc(dir, ['show', long, '--json']).json() as { message: string }).message.length <= 260, 'and with --json');
  // A refusal of acc's own that gives the command to run, as acc done's does at about 400 characters, is kept whole.
  const own = `Run: ${DONE_COMMAND}. ${'Give a flag again for each further line. '.repeat(6)}`;
  assert.equal(failureLine(own), own.trim());
  assert.equal(failureLine('w '.repeat(2000)).length, 1000, 'with a backstop');
});

test('long output reaches a pipe whole before acc exits: acc doctor --json, acc onboard --json (GH-106)', () => {
  const dir = repoWithConfig();
  for (const cmd of ['doctor', 'onboard']) {
    const r = acc(dir, [cmd, '--json']);
    assert.ok(r.out.length > 8192, `${cmd} printed ${r.out.length} characters, more than a pipe takes at once`);
    assert.ok(Array.isArray(r.json()), `${cmd}'s JSON is whole`);
  }
});

test('acc drift refuses a project with no orgs in one line, before saying it retrieves anything (GH-106)', () => {
  assert.match(oneLine(acc(repoWithConfig(), ['drift', 'main']), 2), /This project has no orgs\./);
});
