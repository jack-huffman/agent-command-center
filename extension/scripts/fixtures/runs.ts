/** Commands acc ran from the Command Center, for Setup's output panel. */
import type { RunInput } from '../../src/model/runs.ts';
import { MIN } from './shared.ts';

/** Commands acc ran from Setup: one asking a question, one that failed, one that worked. */
export function sampleRuns(now = Date.now()): RunInput[] {
  return [
    { id: 'r-login', label: 'Each branch points at the right org', command: 'sf org login web --alias "Acme Dev" --instance-url https://acme--dev.sandbox.my.salesforce.com', startedAt: now - 40_000, endedAt: null, code: null, stopped: false, step: 'B6.org-match',
      lines: ['Opening the browser to log in…', 'Waiting for you to sign in. Press Ctrl+C to cancel.', '', 'An org with the alias "Acme Dev" already exists.', 'Replace it? (y/n) '], prompt: { kind: 'yesno', text: 'Replace it? (y/n)' } },
    { id: 'r-npm', label: 'The required checks can run', command: 'npm install', startedAt: now - 5 * MIN, endedAt: now - 4 * MIN, code: 1, stopped: false, step: 'B13.gate-tools',
      lines: ['npm ERR! code ERESOLVE', 'npm ERR! ERESOLVE unable to resolve dependency tree', 'npm ERR! Found: eslint@9.12.0', 'npm ERR! Could not resolve dependency: peer eslint@"^8" from @salesforce/eslint-config-lwc@3.6.0'], prompt: null },
    { id: 'r-open', label: 'Open Dev', command: 'sf org open -o "Acme Dev"', startedAt: now - 9 * MIN, endedAt: now - 9 * MIN + 4000, code: 0, stopped: false, step: null, lines: ['Opening org Acme Dev as jordan@acme.example.dev…'], prompt: null },
    // Autopilot, switched on in the status bar (D-064): it runs as long as the window, and is never shown first.
    { id: 'r-autopilot', label: 'Autopilot · Acme Service', command: 'acc autopilot --every 60', startedAt: now - 2 * 60 * MIN, endedAt: null, code: null, stopped: false, step: null, background: true,
      lines: ['Autopilot pass at 10:41:07', '✓ ACME-20  Review passed: Adds the field to the layout.', '… ACME-25  Waiting: Autopilot couldn\'t land d4e5f6a: git push refused. It waits for a person, or a new commit.', '9 other tasks: nothing to do.'], prompt: null },
  ];
}
