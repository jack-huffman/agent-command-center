// How a fix line is written for its shell (T-124): chaining and quoting for sh and for Windows PowerShell 5.1.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chain, powerShellQuote, quoteArg } from '../src/onboarding/fix-lines.ts';

test('chain joins commands with && in sh, and with a test of the last one\'s success in PowerShell, which has no &&', () => {
  assert.equal(chain('sh', 'a', 'b', 'c'), 'a && b && c');
  assert.equal(chain('powershell', 'a', 'b', 'c'), 'a; if ($?) { b; if ($?) { c } }');
  assert.equal(chain('powershell', 'a', 'b'), 'a; if ($?) { b }');
});

test('edge case: one command, or none, needs no chain in either shell', () => {
  for (const shell of ['sh', 'powershell'] as const) {
    assert.equal(chain(shell, 'only'), 'only', shell);
    assert.equal(chain(shell), '', shell);
  }
});

test('PowerShell 5.1 quoting: single quotes doubled, a double quote written \\" and the empty word as \'""\'; sh quoting is POSIX', () => {
  assert.equal(powerShellQuote(''), `'""'`, 'a plain \'\' would be dropped');
  assert.equal(powerShellQuote('a "b" c'), `'a \\"b\\" c'`);
  assert.equal(powerShellQuote("it's"), "'it''s'");
  assert.equal(powerShellQuote('acme-dev'), 'acme-dev');
  assert.equal(quoteArg('powershell'), powerShellQuote);
  assert.equal(quoteArg('sh')(''), "''");
  assert.equal(quoteArg('sh')("it's"), "'it'\\''s'");
  assert.equal(quoteArg('sh')('a b'), "'a b'");
});
