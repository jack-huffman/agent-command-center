// The docs a new person reads (GH-61) pass the package's personal-data scan (D-079), with this repo's own
// account, commit email and name as its words: they name the repo only as github.com/<repo>.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { STEPS } from '../../packages/core/src/onboarding/steps.ts';
import { matcher, ROOT, scanFiles, scanLine, type Terms } from '../packaging.ts';

const config = JSON.parse(readFileSync(join(ROOT, '.acc', 'config.json'), 'utf8'));
const steps = readdirSync(join(ROOT, 'extension', 'media', 'steps')).map((f) => `extension/media/steps/${f}`);
const DOCS = ['README.md', 'docs/ONBOARDING.md', 'docs/FIRST-RUN.md', 'docs/TEMPLATES.md', 'docs/RULES.md', 'extension/README.md', 'extension/package.json', ...steps];

/** This repo's own account, commit email and name, as GH-60's scan would find them, and its address allowed. */
const TERMS = (): Terms => ({
  emails: [config.commitIdentity.email], logins: [config.github.account], names: [config.commitIdentity.name],
  hosts: [], repos: [], allowed: [`github.com/${config.github.repo}`],
});

test('the README, the onboarding guide, the first run, the template and rules guides and the extension\'s pages hold nothing personal: only the repo\'s own address', () => {
  assert.ok(steps.includes('extension/media/steps/A4.plugin.md'));
  const hits = scanFiles(DOCS.map((rel) => [rel, join(ROOT, rel)]), matcher(TERMS())).map((h) => `${h.file}:${h.line}: ${h.what}`);
  assert.deepEqual(hits, []);
  // The repo's address is there, and allowed: it's how a new person installs it.
  assert.ok(readFileSync(join(ROOT, 'README.md'), 'utf8').includes(`https://github.com/${config.github.repo}`));
});

test('the first run\'s checklist has a heading for every step, in the walkthroughs\' order: the machine, a generic project, then Salesforce\'s own', () => {
  const md = readFileSync(join(ROOT, 'docs', 'FIRST-RUN.md'), 'utf8');
  const got = [...md.matchAll(/^### ([AB]\d+\.[\w-]+): (.+)$/gm)].map((m) => `${m[1]}: ${m[2]}`);
  const heading = (s: (typeof STEPS)[number]) => `${s.id}: ${s.title}`;
  const project = STEPS.filter((s) => s.part === 'project');
  const want = [
    ...STEPS.filter((s) => s.part === 'machine'),
    ...project.filter((s) => !s.profiles),
    ...project.filter((s) => s.profiles?.includes('salesforce')),
  ].map(heading);
  assert.deepEqual(got, want, 'docs/FIRST-RUN.md should have one "### <id>: <title>" heading per step, in this order.');
});

test('the scan would catch the repo written bare, as owner/repo, so the docs use the full URL', () => {
  const m = matcher({ ...TERMS(), emails: [] });
  assert.equal(scanLine(`claude plugin marketplace add ${config.github.repo}`, m).length, 1);
  assert.deepEqual(scanLine(`claude plugin marketplace add https://github.com/${config.github.repo}`, m), []);
  assert.deepEqual(scanLine(`gh release download -R github.com/${config.github.repo} -p '*.vsix'`, m), []);
});
