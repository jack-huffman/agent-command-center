/**
 * Runs in the output panel as rows (T-64): a deploy still running, the same deploy done, with more rows than
 * the panel shows, and a lint that failed. The run waiting for an answer is Setup's (runs.ts).
 */
import type { RunInput } from '../../src/model/runs.ts';
import { MIN, ROOT } from './shared.ts';

export type RunSample = 'running' | 'done' | 'failed';

/** Each sample's run id, which the panel opens on. */
export const RUN_SAMPLE_ID: Record<RunSample, string> = { running: 'r-deploy', done: 'r-deployed', failed: 'r-lint' };

const CLASSES = 'force-app/main/default/classes';
const ORG = 'https://acme--dev.sandbox.my.salesforce.com';

/** The deploy's first lines: what it deploys and where, its spinner, and a file it converts. */
const deployStart = [
  '\x1b[1mDeploying v62.0 metadata to jordan@acme.example.dev using the v62.0 SOAP API.\x1b[22m',
  'Deploy ID: 0Af5g00000XyZabCAB',
  '',
  '⠋ Waiting for the org to respond',
  '⠙ Waiting for the org to respond',
  '⠹ Waiting for the org to respond',
  '\x1b[32m✓\x1b[39m Preparing the deploy',
  `Converting ${CLASSES}/WelcomeEmailService.cls`,
];

/** A run in the output panel: a deploy running or done, or a lint that failed. */
export function sampleRunView(now: number, kind: RunSample): RunInput {
  const base = { id: RUN_SAMPLE_ID[kind], code: null, stopped: false, prompt: null, cwd: ROOT, step: null } as const;
  if (kind === 'running') {
    return { ...base, label: 'Deploy to Dev', command: 'sf project deploy start --target-org "Acme Dev"', startedAt: now - 2 * MIN - 14_000, endedAt: null,
      lines: [...deployStart, 'Deploying components 14/40', 'Deploying components 15/40', 'Deploying components 16/40'] };
  }
  if (kind === 'done') {
    // 236 components, one row each: more than the panel shows, so it counts the rest.
    const each = Array.from({ length: 236 }, (_, i) => `Deployed ${CLASSES}/Service${String(i + 1).padStart(3, '0')}.cls`);
    return { ...base, label: 'Deploy to Dev', command: 'sf project deploy start --target-org "Acme Dev"', startedAt: now - 9 * MIN, endedAt: now - 9 * MIN + 3 * MIN + 12_000, code: 0,
      lines: [...deployStart, ...each, 'Warning: WelcomeEmailService has no test that covers it.', 'Deploying components 236/236', `See the deploy in Setup: ${ORG}/lightning/setup/DeployStatus/home`, '\x1b[32mDeploy succeeded.\x1b[39m'] };
  }
  // A lint that found problems: a warning and errors at their files and lines, a summary, and a report outside the folder.
  const LWC = 'force-app/main/default/lwc';
  return {
    ...base, label: 'Lint the changed files', command: `npx eslint ${LWC}`, startedAt: now - 5 * MIN, endedAt: now - 5 * MIN + 41_000, code: 1,
    lines: [
      'Linting 42 files…',
      `${LWC}/welcomeCard/welcomeCard.js:12:5  warning  Unexpected console statement  no-console`,
      `${LWC}/welcomeCard/welcomeCard.js:31:9  error  'contact' is assigned a value but never used  no-unused-vars`,
      `${LWC}/renewalDate/renewalDate.js:8:1  error  Parsing error: Unexpected token )`,
      '',
      '\x1b[31m✖ 3 problems (2 errors, 1 warning)\x1b[39m',
      'The full report is in /Users/me/.cache/eslint/report-2026-10-16.html',
    ],
  };
}
