// The shell a fix line is for: its quoting, how the runner and the terminal start it, and how its page labels it (T-124).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INSTALL_LINES, INSTALL_SYSTEMS, shellOf } from '../../packages/core/src/onboarding/install-lines.ts';
import { STEPS } from '../../packages/core/src/onboarding/steps.ts';
import { shq } from '../src/logic/shared.ts';
import { encodedPowerShell, fenceFor, psq, quoteFor, runnerLine, terminalShell } from '../src/logic/shells.ts';
import { importRulesCommand, initCommand, stepMedia } from '../src/logic/setup.ts';

test('each line in the install table carries the shell it is written for: PowerShell on Windows, sh elsewhere', () => {
  let counted = 0;
  for (const [tool, lines] of Object.entries(INSTALL_LINES)) {
    for (const system of INSTALL_SYSTEMS) {
      const line = lines[system];
      if (!('command' in line)) continue;
      counted++;
      assert.equal(line.shell, shellOf(system), `${tool} on ${system}`);
    }
  }
  assert.ok(counted >= 10, `${counted} lines checked`);
  assert.deepEqual(['mac', 'windows', 'linux'].map((s) => shellOf(s as 'mac')), ['sh', 'powershell', 'sh']);
});

test('PowerShell quoting doubles a single quote and leaves $, backticks, spaces and double quotes as typed; edge case: an empty word, an @, a comma and curly quotes', () => {
  assert.equal(psq('acme-dev'), 'acme-dev');
  assert.equal(psq('Acme Dev SB'), "'Acme Dev SB'");
  assert.equal(psq("Pat's org"), "'Pat''s org'");
  assert.equal(psq('$HOME `x` "q"'), '\'$HOME `x` \\"q\\"\'', 'a double quote is written \\" so 5.1 keeps it');
  assert.equal(psq('a,b'), "'a,b'", 'a comma is PowerShell\'s array operator');
  assert.equal(psq('@x'), "'@x'", 'an @ is splatting');
  assert.equal(psq('it‘s’'), "'it‘‘s’’'", 'curly single quotes are quotes to PowerShell');
  assert.equal(psq(''), "'\"\"'", 'the empty word is \'""\', since 5.1 drops a plain empty one');
  assert.equal(quoteFor('powershell'), psq);
  for (const w of ['plain', 'a b', "it's", '$x', '']) assert.equal(quoteFor('sh')(w), shq(w), `sh quotes ${JSON.stringify(w)} as the extension's shq does`);
});

test('acc init and a rules import quote each argument for their shell', () => {
  const choice = { from: "/work/Pat's $team `x`/tools.json", profile: 'generic' as const };
  const sh = initCommand(choice, 'sh');
  const ps = initCommand(choice, 'powershell');
  assert.ok(sh.includes("'/work/Pat'\\''s $team `x`/tools.json'"), sh);
  assert.ok(ps.includes("'/work/Pat''s $team `x`/tools.json'"), ps);
  assert.ok(sh.startsWith('acc init') && ps.startsWith('acc init'));
  assert.equal(importRulesCommand({ source: "/work/pat's rules", name: 'a b', force: true }, 'sh'), "acc rules import '/work/pat'\\''s rules' --name 'a b' --force");
  assert.equal(importRulesCommand({ source: "/work/pat's rules", name: 'a b', force: true }, 'powershell'), "acc rules import '/work/pat''s rules' --name 'a b' --force");
  assert.equal(importRulesCommand({ source: 'rules' }, 'powershell'), 'acc rules import rules', 'no name and no force add nothing');
});

test('on Windows the runner gets the line encoded for PowerShell, and on a Mac and Linux it gets the line as it is', () => {
  const line = "winget install --id Git.Git -e; Write-Output 'it''s ünï'";
  const enc = runnerLine(line, 'windows');
  const m = /^powershell\.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(enc);
  assert.ok(m, enc);
  assert.equal(Buffer.from(m![1]!, 'base64').toString('utf16le'), line, 'it decodes to the readable line');
  assert.equal(enc, encodedPowerShell(line));
  assert.equal(runnerLine('brew install git', 'mac'), 'brew install git');
  assert.equal(runnerLine('brew install git', 'linux'), 'brew install git');
  assert.ok(!enc.includes(' -e'), 'nothing of the line is left for a shell to read');
});

test('Setup\'s terminal is created with PowerShell on Windows, and as it was on a Mac and Linux', () => {
  assert.deepEqual(terminalShell('windows'), { shellPath: 'powershell.exe', shellArgs: ['-NoLogo'] });
  assert.deepEqual(terminalShell('mac'), {});
  assert.deepEqual(terminalShell('linux'), {});
});

test('a step page labels a line\'s code block powershell on Windows and bash on a Mac, and an install step shows each system\'s own', () => {
  assert.equal(fenceFor('powershell'), 'powershell');
  assert.equal(fenceFor('sh'), 'bash');
  const update = STEPS.find((s) => s.id === 'A1.claude')!;
  assert.ok(stepMedia(update, 'mac').includes('```bash\nclaude update\n```'));
  assert.ok(stepMedia(update, 'windows').includes('```powershell\nclaude update\n```'));
  const git = stepMedia(STEPS.find((s) => s.id === 'A1.git')!, 'mac');
  assert.ok(git.includes('```bash\nbrew install git\n```') && git.includes('```powershell\nwinget install --id Git.Git -e\n```'));
  assert.ok(!stepMedia(update, 'windows').includes('-EncodedCommand'), 'the page never shows the encoded form');
});
