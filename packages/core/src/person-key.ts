/**
 * The person's key (T-171). Some files under acc's state directory stand for a person's word: where they picked
 * a ticket to deploy (deploy-pick.ts), the environment's name they typed in a deploy guide's chat
 * (deploy-guide.ts), and a floor they relaxed (ratchets.ts). Every process of the same user can write a file
 * there, a builder's tests and build scripts among them, which run code the guard can't read. So acc signs each
 * of those records with a key that lives in the system's own secret store, never in the state directory or
 * in any agent's environment, and reads an unsigned record, or one signed by another key, as no record, with
 * a reason a person can read.
 *
 * One Ed25519 key pair per account on this machine. Its private half is read only to sign: by a person's own
 * command (acc deploy --guide, acc gate relax) and by the UserPromptSubmit hook of the guide's chat, which is
 * the one process that sees what the person types. Its public half is what every reader checks against, so
 * the guide's acc deploy and a builder's acc gate run verify without ever loading the private key. A record
 * signs the task and the environment it is for, so a signed record for one can't stand for another.
 *
 * Where the store is, by system: a Mac's login keychain, through the security command (an item made by
 * security can be read by security without a prompt, so any process of the same user reads it while the
 * keychain is unlocked; other programs get the keychain's prompt); on Windows a file under %LOCALAPPDATA%
 * encrypted by DPAPI in the user's scope (another user, or a copy of the file taken off the machine, can't
 * decrypt it; any process running as the user can); elsewhere a file in the person's config folder, which is
 * no secret store at all. Tests and CI point acc at a folder store with ACC_PERSON_STORE, which no person's
 * acc sets.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AccError, type Runner } from './exec.ts';

/** Tests and CI: a folder that stands in for the system's store. A person's own acc never sets it. */
export const PERSON_STORE_ENV = 'ACC_PERSON_STORE';
/** The keychain service, or the folder, the key's two items are kept under. */
export const PERSON_KEY_SERVICE = 'acc-person-key';
/** The store's two items: the private key (PKCS8 DER, base64) and the public key (SPKI DER, base64). */
export const PRIVATE_ITEM = 'private';
export const PUBLIC_ITEM = 'public';

/** Where a system keeps the key, and what a person is told about it. */
export interface PersonStore {
  kind: 'keychain' | 'dpapi' | 'file' | 'folder';
  /** Where it is, in words a person can check: the keychain's service, or the folder. */
  where: string;
  read(item: string): string | null;
  write(item: string, value: string): void;
  delete(item: string): boolean;
}

/** A folder of plain files, one an item, each readable by its owner alone: tests, CI and systems with no store. */
export function folderStore(dir: string, kind: 'folder' | 'file' = 'folder'): PersonStore {
  const file = (item: string): string => join(dir, item);
  return {
    kind, where: dir,
    read: (item) => {
      try {
        return readFileSync(file(item), 'utf8').trim() || null;
      } catch {
        return null;
      }
    },
    write: (item, value) => {
      mkdirSync(dir, { recursive: true });
      const tmp = `${file(item)}.${process.pid}.tmp`;
      writeFileSync(tmp, `${value}\n`, { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, file(item));
    },
    delete: (item) => {
      const had = existsSync(file(item));
      rmSync(file(item), { force: true });
      return had;
    },
  };
}

/** A Mac's login keychain, through security: one generic password an item, under the service. */
export function keychainStore(run: Runner, env: NodeJS.ProcessEnv, service: string = PERSON_KEY_SERVICE): PersonStore {
  const quote = (s: string) => `"${s.replace(/(["\\])/g, '\\$1')}"`;
  return {
    kind: 'keychain', where: `this Mac's keychain, as ${service}`,
    read: (item) => {
      const r = run('security', ['find-generic-password', '-s', service, '-a', item, '-w'], { env, timeoutMs: 20_000 });
      return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
    },
    // security reads its command from stdin in interactive mode, so the key never goes on a command line.
    write: (item, value) => {
      const r = run('security', ['-i'], { env, input: `add-generic-password -U -s ${quote(service)} -a ${quote(item)} -w ${quote(value)}\n`, timeoutMs: 20_000 });
      if (r.code !== 0) throw new AccError('refused', `The keychain wouldn't keep the person's key: ${(r.stderr || r.stdout).trim().split('\n')[0] || `security exited ${r.code}`}`);
    },
    delete: (item) => run('security', ['delete-generic-password', '-s', service, '-a', item], { env, timeoutMs: 20_000 }).code === 0,
  };
}

/** The PowerShell that encrypts, or decrypts, a file for the user alone by DPAPI; the file and the value come in its environment. */
export const DPAPI_WRITE = 'Add-Type -AssemblyName System.Security; [System.IO.File]::WriteAllBytes($env:ACC_STORE_FILE, [System.Security.Cryptography.ProtectedData]::Protect([System.Text.Encoding]::UTF8.GetBytes($env:ACC_STORE_VALUE), $null, \'CurrentUser\'))';
export const DPAPI_READ = 'Add-Type -AssemblyName System.Security; [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect([System.IO.File]::ReadAllBytes($env:ACC_STORE_FILE), $null, \'CurrentUser\')))';

/** Windows: a file an item under the folder, each encrypted by DPAPI in the user's scope. */
export function dpapiStore(run: Runner, env: NodeJS.ProcessEnv, dir: string): PersonStore {
  const file = (item: string): string => join(dir, `${item}.dpapi`);
  const ps = (script: string, extra: Record<string, string>) => run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...env, ...extra }, timeoutMs: 60_000 });
  return {
    kind: 'dpapi', where: `${dir}, encrypted for this Windows account by DPAPI`,
    read: (item) => {
      if (!existsSync(file(item))) return null;
      const r = ps(DPAPI_READ, { ACC_STORE_FILE: file(item) });
      return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
    },
    // Written whole: PowerShell encrypts into a file beside it, which is then renamed into place.
    write: (item, value) => {
      mkdirSync(dir, { recursive: true });
      const tmp = `${file(item)}.${process.pid}.tmp`;
      const r = ps(DPAPI_WRITE, { ACC_STORE_FILE: tmp, ACC_STORE_VALUE: value });
      if (r.code !== 0 || !existsSync(tmp)) throw new AccError('refused', `Windows wouldn't keep the person's key: ${(r.stderr || r.stdout).trim().split('\n')[0] || `powershell exited ${r.code}`}`);
      renameSync(tmp, file(item));
    },
    delete: (item) => {
      const had = existsSync(file(item));
      rmSync(file(item), { force: true });
      return had;
    },
  };
}

/** Where a system without a secret store keeps the key: a folder of the person's own. */
export const personKeyFolder = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string = homedir()): string =>
  (platform === 'win32' ? join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'acc', PERSON_KEY_SERVICE) : join(env.XDG_CONFIG_HOME || join(home, '.config'), 'acc', PERSON_KEY_SERVICE));

/** This system's store for the person's key: the folder ACC_PERSON_STORE names when set, else the system's own. */
export function personStore(env: NodeJS.ProcessEnv, run: Runner, platform: NodeJS.Platform = process.platform, opts: { home?: string; service?: string } = {}): PersonStore {
  const given = env[PERSON_STORE_ENV]?.trim();
  if (given) return folderStore(given);
  if (platform === 'darwin') return keychainStore(run, env, opts.service);
  const folder = personKeyFolder(platform, env, opts.home);
  if (platform === 'win32') return dpapiStore(run, env, opts.service ? join(folder, opts.service) : folder);
  return folderStore(opts.service ? join(folder, opts.service) : folder, 'file');
}

/** What a record is, under its signature: the kind keeps a signed pick from reading as a signed yes. */
export type RecordKind = 'deploy-pick' | 'typed-yes' | 'relax';

/** The bytes a signature covers: the kind, then the signed fields in the order given, as JSON. */
export const canonical = (kind: RecordKind, body: Record<string, unknown>): Buffer => Buffer.from(`acc ${kind}\n${JSON.stringify(body)}`);

/** Signs a record's body, as a person's command or the guide chat's hook does. */
export interface Signer {
  sign(kind: RecordKind, body: Record<string, unknown>): string;
}

/** Checks a record's signature: null when it is the person's, else why it isn't, in words for a person. */
export interface Verifier {
  verify(kind: RecordKind, body: Record<string, unknown>, sig: unknown): string | null;
}

/** The roles whose acc never signs: the key is a person's, and the guide's chat hook is the one agent process that signs. */
export const NEVER_SIGN = new Set(['builder', 'reviewer', 'analyst']);

const privateKeyOf = (b64: string): KeyObject => createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' });
const publicKeyOf = (b64: string): KeyObject => createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });

/** The key pair's two halves as the store keeps them. */
export function newKeyPair(): { private: string; public: string } {
  const pair = generateKeyPairSync('ed25519');
  return {
    private: (pair.privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer).toString('base64'),
    public: (pair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64'),
  };
}

/** What a reader says when this machine has no key yet: only a person's command makes one. */
export const NO_KEY = 'This machine has no person key yet, so nothing can be read as the person\'s word. A person\'s own acc deploy --guide, or acc gate relax, makes one.';

/**
 * The signer for a person's command, or the guide chat's hook. A builder, a reviewer and an analyst are
 * refused by role, whatever they claim. With no key in the store yet, a person's command makes one
 * (`create`); the hook never does, so a chat on a machine with no key keeps nothing, and the deploy says why.
 */
export function signingKey(store: PersonStore, env: NodeJS.ProcessEnv, opts: { create: boolean }): Signer {
  const role = env.ACC_ROLE;
  if (role && NEVER_SIGN.has(role)) throw new AccError('refused', `${role === 'analyst' ? 'An' : 'A'} ${role} never signs the person's word.`);
  let b64 = store.read(PRIVATE_ITEM);
  if (!b64) {
    if (!opts.create) throw new AccError('refused', NO_KEY);
    const pair = newKeyPair();
    store.write(PRIVATE_ITEM, pair.private);
    store.write(PUBLIC_ITEM, pair.public);
    b64 = pair.private;
  }
  const key = privateKeyOf(b64);
  // A person's command puts the public half back when it's missing (a store half written), so readers can check.
  if (opts.create && !store.read(PUBLIC_ITEM)) store.write(PUBLIC_ITEM, (createPublicKey(key).export({ type: 'spki', format: 'der' }) as Buffer).toString('base64'));
  return { sign: (kind, body) => cryptoSign(null, canonical(kind, body), key).toString('base64') };
}

/**
 * The verifier every reader uses: the public key from the store, never the private one. On a machine with
 * no key, every record reads as none, with NO_KEY as the reason.
 */
export function verifier(store: PersonStore): Verifier {
  const b64 = store.read(PUBLIC_ITEM);
  let key: KeyObject | null = null;
  try {
    key = b64 ? publicKeyOf(b64) : null;
  } catch {
    key = null;
  }
  return {
    verify: (kind, body, sig) => {
      if (!key) return NO_KEY;
      if (typeof sig !== 'string' || !sig) return 'it isn\'t signed';
      try {
        return cryptoVerify(null, canonical(kind, body), key, Buffer.from(sig, 'base64')) ? null : 'it isn\'t signed by this machine\'s person key';
      } catch {
        return 'it isn\'t signed by this machine\'s person key';
      }
    },
  };
}

/** A verifier's reason as a clause in a longer sentence: NO_KEY is a sentence of its own, the others are clauses. */
export const asClause = (why: string): string => why.replace(/\.$/, '');

/** The body a record signs: its fields in the order given, so the bytes are the same on both sides. */
export function signedBody<T extends object>(record: T, fields: readonly (keyof T & string)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f] = (record as Record<string, unknown>)[f];
  return out;
}
