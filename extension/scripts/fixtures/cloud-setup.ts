/** Set up cloud builders (T-145) at each of its steps, on a Mac and on Windows, done and not done. */
import { cloudSetupModel, type CloudSetupModel, type CloudSetupState, type CloudSetupStep } from '../../src/model/cloud-setup.ts';
import { ROOT } from './shared.ts';

export const CLOUD_SYSTEMS = { mac: 'darwin', win: 'win32' } as const;
export type CloudSystem = keyof typeof CLOUD_SYSTEMS;

/** The project every check passed for. */
const DONE: Omit<CloudSetupState, 'step' | 'platform'> = {
  id: 'cloud-sample', rev: 1, root: ROOT, project: 'Acme Service', repo: 'acme/service', moved: true, on: true, routine: 'trig_01HX4Q9ZP7W2M5K8D3RT6YB1NC',
  github: { status: 'pass', detail: 'The Claude GitHub App is installed on acme/service.' }, githubConfirmed: false,
  token: { status: 'pass', detail: 'Kept in this Mac\'s keychain' }, signin: { status: 'pass', detail: 'Signed in to claude.ai' },
  guard: { status: 'pass', detail: 'Committed, and on GitHub\'s main' },
  place: { base: 'main', checkedOut: 'main', local: { ok: true, why: null }, pushed: { ok: true, why: null }, ahead: 0 },
  busy: null, error: null, copied: false,
};

/** What a step looks like before it's done: its own check failing, every step before it done. */
function todo(step: CloudSetupStep, sys: CloudSystem): Partial<CloudSetupState> {
  switch (step) {
    case 'on': return { on: false, routine: null, github: { status: 'unknown', detail: 'Checked once cloud builders are on' } };
    case 'github': return { github: { status: 'unknown', detail: 'gh couldn\'t list the apps installed for you. If you connected with /web-setup, tick this yourself.' } };
    case 'task': return { routine: null };
    case 'token': return { token: { status: 'fail', detail: 'No token kept yet' } };
    case 'signin': return { signin: { status: 'fail', detail: sys === 'win' ? 'The Claude Code CLI (claude) isn\'t on PATH.' : 'Claude Code isn\'t signed in.' } };
    // On the Mac shot not committed yet (Do it); on the Windows one committed, not pushed (Push…).
    case 'guard': return sys === 'mac'
      ? { guard: { status: 'fail', detail: 'Not committed on main' }, place: { base: 'main', checkedOut: 'main', local: { ok: false, why: 'main doesn\'t carry the guard' }, pushed: { ok: false, why: 'not on GitHub' }, ahead: 0 } }
      : { guard: { status: 'fail', detail: 'Committed here, not on GitHub\'s main yet' }, place: { base: 'main', checkedOut: 'main', local: { ok: true, why: null }, pushed: { ok: false, why: 'not on GitHub' }, ahead: 1 } };
    // Ready before every step is: the sign-in ran out since.
    case 'ready': return { signin: { status: 'fail', detail: 'Claude Code isn\'t signed in.' } };
  }
}

/** The model for a shot by its name, cloud-setup-<step>-<mac|win>-<todo|done|open> (pages.ts lists them), or null for another page. */
export function sampleCloudSetup(kind: string): CloudSetupModel | null {
  const m = /^cloud-setup-(\w+)-(mac|win)-(todo|done|open)$/.exec(kind);
  if (!m) return null;
  const step = m[1] as CloudSetupStep;
  const sys = m[2] as CloudSystem;
  const how = m[3]!;
  const base: CloudSetupState = { ...DONE, step, platform: CLOUD_SYSTEMS[sys], ...(sys === 'win' ? { token: { status: 'pass', detail: 'Kept in VS Code on this machine' } } : {}) };
  return cloudSetupModel({ ...base, ...(how === 'done' ? {} : todo(step, sys)), ...(step === 'task' && how === 'done' ? { copied: true } : {}) });
}

/** The webview's memory for a shot: the step's detail opened, for the two that show it. */
export function cloudSetupState(kind: string): { cloudFolds: string[] } | null {
  const step = /^cloud-setup-(\w+)-(?:mac|win)-open$/.exec(kind)?.[1];
  return step ? { cloudFolds: [step] } : null;
}
