/**
 * Ratchets (GH-99): a check whose command prints one number that may only get better, such as how many
 * tests run or how many violations a scan finds. Each is held to a floor (or a ceiling) in the committed
 * `.acc/floors.json`, so the floors travel with branches and a person can read them. A change can land
 * partial progress, never a regression. When a task's number beats its floor, `acc gate run` writes the
 * better floor in the task's worktree and the builder commits it with the change. acc never raises one
 * anywhere else, and only a person relaxes one, with a reason, as only a person waives a check (D-031).
 */
import { isObj } from './text.ts';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Config, RatchetLimit, RatchetSpec } from './config.ts';
import { AccError, type RunResult, type Runner } from './exec.ts';
import type { Gate, GateInput, Outcome } from './gates.ts';
import { writeAtomic } from './atomic.ts';
import { type Ledger } from './ledger.ts';
import type { RatchetDetails, Receipt } from './receipts.ts';
import { storedFloorSpec } from './stored-floors.ts';

/** Where the floors live, from the checkout's top: committed, beside the config. */
export const FLOORS_FILE = '.acc/floors.json';

/** Who relaxed a floor, why, when, and what it was before. */
export interface Relaxed {
  by: string;
  reason: string;
  at: string;
  was: number | null;
}

/** One ratchet's entry: a floor or a ceiling, and who relaxed it to that, if a person did. */
export interface FloorEntry {
  floor?: number;
  ceiling?: number;
  relaxed?: Relaxed;
}

/** Each ratchet's entry, by its name. */
export type Floors = Record<string, FloorEntry>;

const isRelaxed = (v: unknown): v is Relaxed => isObj(v) && typeof v.by === 'string' && typeof v.reason === 'string' && typeof v.at === 'string' && (v.was === null || typeof v.was === 'number');

/**
 * The floors in a file's text: each entry a floor or a ceiling, a finite number, and maybe who relaxed it.
 * Null when it's anything else, so nothing is read from a file a person or a merge left broken.
 */
export function parseFloors(text: string): Floors | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw)) return null;
  const out: Floors = {};
  for (const [name, e] of Object.entries(raw)) {
    if (!isObj(e)) return null;
    const keys = Object.keys(e);
    const limits = keys.filter((k) => k === 'floor' || k === 'ceiling');
    if (limits.length !== 1 || keys.some((k) => k !== limits[0] && k !== 'relaxed')) return null;
    const value = e[limits[0]!];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    if (e.relaxed !== undefined && !isRelaxed(e.relaxed)) return null;
    out[name] = { [limits[0]!]: value, ...(e.relaxed ? { relaxed: e.relaxed as Relaxed } : {}) };
  }
  return out;
}

/** The file's text: 2-space JSON, one entry a ratchet, in the order they were added. */
export const formatFloors = (floors: Floors): string => `${JSON.stringify(floors, null, 2)}\n`;

/** The floors in a checkout's file: none when there's no file yet. A broken file is an error. */
export function readFloors(file: string): Floors {
  if (!existsSync(file)) return {};
  const floors = parseFloors(readFileSync(file, 'utf8'));
  if (!floors) throw new AccError('bad-floors', `${file} isn't a list of floors: each entry needs a "floor" or a "ceiling", a number.`);
  return floors;
}

/** Written whole or not at all, so a reader never finds half a floors file. */
export function writeFloors(file: string, floors: Floors): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, formatFloors(floors));
  renameSync(tmp, file);
}

/** The floors committed at a commit: none when it has no file. A broken file is an error. */
export function floorsAt(run: Runner, root: string, ref: string): Floors {
  const r = run('git', ['show', `${ref}:${FLOORS_FILE}`], { cwd: root });
  if (r.code !== 0) return {};
  const floors = parseFloors(r.stdout);
  if (!floors) throw new AccError('bad-floors', `${FLOORS_FILE} at ${ref.slice(0, 7)} isn't a list of floors: each entry needs a "floor" or a "ceiling", a number.`);
  return floors;
}

/** An entry's limit, from the key it uses. */
export const limitOf = (e: FloorEntry): RatchetLimit => (e.ceiling !== undefined ? 'ceiling' : 'floor');
/** An entry's number, or null when there's none or it's the other kind of limit. */
export const valueOf = (e: FloorEntry | undefined, limit: RatchetLimit): number | null => (e && limitOf(e) === limit ? e[limit] ?? null : null);

/** Whether `a` is worse than `than`: lower against a floor, higher against a ceiling. */
export const isWorse = (limit: RatchetLimit, a: number, than: number): boolean => (limit === 'floor' ? a < than : a > than);
/** The better of two numbers: the higher for a floor, the lower for a ceiling. */
export const better = (limit: RatchetLimit, a: number, b: number): number => (isWorse(limit, a, b) ? b : a);

/** A number as a page shows it: whole, or to two places. */
export const num = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));
/** A difference with its sign, such as +5 or −3. */
export const signed = (n: number): string => (n > 0 ? `+${num(n)}` : n < 0 ? `−${num(-n)}` : '±0');

/** The number a command printed: its last line that says anything, when that line is one number. */
export function parseNumber(stdout: string): number | null {
  const line = stdout.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? '';
  return /^[-+]?(\d+(\.\d+)?|\.\d+)$/.test(line) ? Number(line) : null;
}

/**
 * How pages show a ratchet: `tests 669 → 674 (+5)`, from the environment's floor where the branch began to
 * the number on this commit, or `tests 674 (first floor)` when there was none.
 */
export function ratchetLine(d: Pick<RatchetDetails, 'label' | 'value' | 'base' | 'diff'>): string {
  return d.base === null ? `${d.label} ${num(d.value)} (first floor)` : `${d.label} ${num(d.base)} → ${num(d.value)} (${signed(d.diff ?? d.value - d.base)})`;
}

// ---------------------------------------------------------------- the gate

/** What a ratchet is held to, worked out once a run (runGates): the floors on this commit and where the branch began. */
export interface RatchetFloors {
  /** The floors committed on the commit being checked. */
  head: Floors;
  /** The floors on the environment's branch at the merge base. */
  base: Floors;
  /** The floors people relaxed for the task being checked, from acc's records (relaxesFor). */
  relaxed: RelaxRecord[];
  /** Whether a better number is written as the new floor: a task's own worktree, clean, from acc gate run. */
  raise: boolean;
}

const words = (limit: RatchetLimit) => (limit === 'floor' ? { limit: 'floor', worse: 'below', lowers: 'lowers' } : { limit: 'ceiling', worse: 'above', lowers: 'raises' });

/**
 * Judges a ratchet's number against its floor (GH-99). The floor is the branch's, unless that's worse than
 * the environment's where the branch began and no person relaxed it: a builder can't make one worse by
 * hand. A number worse than the floor fails; at it passes; better passes, and, where acc may raise floors,
 * is raised: the receipt says so, and satisfies nothing until the new floor is committed.
 */
export function judgeRatchet(name: string, spec: RatchetSpec, value: number, floors: RatchetFloors, env: string): Outcome {
  const { label, limit } = spec;
  const w = words(limit);
  const headEntry = floors.head[name];
  if (headEntry && limitOf(headEntry) !== limit) {
    return { status: 'error', summary: `${FLOORS_FILE} gives ${name} a ${limitOf(headEntry)}, but .acc/config.json says it has a ${limit}. Make them agree.` };
  }
  const head = valueOf(headEntry, limit);
  const base = valueOf(floors.base[name], limit);
  const details = (floor: number | null, raised?: RatchetDetails['raised']): Record<string, unknown> => ({
    ratchet: { label, limit, value, floor, base, diff: base === null ? null : value - base, ...(raised ? { raised } : {}) } satisfies RatchetDetails,
  });
  // Made worse on the branch, by hand: only a person relaxes a floor, and acc keeps a record when one does.
  if (base !== null && (head === null || isWorse(limit, head, base)) && !(head !== null && relaxedTo(floors.relaxed, name, limit, head, base))) {
    const what = head === null ? `drops ${name}'s ${w.limit}` : `${w.lowers} ${name}'s ${w.limit} to ${num(head)}`;
    return { status: 'fail', summary: `${FLOORS_FILE} ${what}, from ${num(base)} on ${env}, and no person relaxed it. Put it back to ${num(base)}: only a person relaxes a ${w.limit}, with acc gate relax.`, details: details(base) };
  }
  const floor = head ?? base;
  if (floor === null) {
    if (floors.raise) return { status: 'pass', summary: `${label} ${num(value)}, the first ${w.limit}: wrote it in ${FLOORS_FILE}. Commit that file, then run acc gate run again.`, details: details(null, { from: null, to: value }) };
    return { status: 'pass', summary: `${label} ${num(value)}. No ${w.limit} yet.`, details: details(null) };
  }
  if (isWorse(limit, value, floor)) {
    return { status: 'fail', summary: `${label} ${num(value)} is ${w.worse} its ${w.limit} ${num(floor)}, by ${num(Math.abs(value - floor))}. Make it ${num(floor)} or better. If this change has to make it worse, block and say why: only a person relaxes a ${w.limit}.`, details: details(floor) };
  }
  if (value === floor) return { status: 'pass', summary: `${label} ${num(value)}, at its ${w.limit}.`, details: details(floor) };
  if (floors.raise) {
    return { status: 'pass', summary: `${label} ${num(value)} beats the ${w.limit} ${num(floor)}: raised it in ${FLOORS_FILE}. Commit that file, then run acc gate run again.`, details: details(floor, { from: floor, to: value }) };
  }
  return { status: 'pass', summary: `${label} ${num(value)} beats the ${w.limit} ${num(floor)} by ${num(Math.abs(value - floor))}.`, details: details(floor) };
}

/** Reads a ratchet's command: its last line is the number. No number, or a command that failed, is an error, never a pass. */
export function readRatchet(name: string, spec: RatchetSpec, r: RunResult, floors: RatchetFloors, env: string): Outcome {
  const last = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? '';
  if (r.code !== 0) return { status: 'error', summary: `${spec.label} couldn't be measured: ${last(r.stderr) || last(r.stdout) || `the command exited with ${r.code}`}.` };
  const value = parseNumber(r.stdout);
  if (value === null) return { status: 'error', summary: `${spec.label} couldn't be measured: the command's last line isn't a number${last(r.stdout) ? ` ("${last(r.stdout).slice(0, 80)}")` : ''}.` };
  return judgeRatchet(name, spec, value, floors, env);
}

/** A ratchet as a gate: its command runs in the checkout, like one in `gates.commands`, and its number is judged. */
export function ratchetGate(name: string, spec: RatchetSpec, heavy: boolean): Gate {
  return {
    name, heavy, about: `${spec.command} (${spec.label}, which may only go ${spec.limit === 'floor' ? 'up' : 'down'})`,
    plan: (input: GateInput) => {
      const floors = input.floors?.();
      if (!floors || 'problem' in floors) return { outcome: { status: 'error', summary: floors?.problem ?? `${name}'s floors weren't read.` } };
      return { cmd: 'sh', args: ['-c', spec.command], env: { ACC_CHANGED: input.changes.files.join('\n') }, read: (r: RunResult) => readRatchet(name, spec, r, floors, input.env.branch) };
    },
  };
}

/** The floors with each raise written in: a floor or ceiling of its own, with no one's relaxing left on it. New ratchets go last. */
export function withRaises(floors: Floors, raises: { gate: string; limit: RatchetLimit; to: number }[]): Floors {
  const out: Floors = { ...floors };
  for (const r of raises) out[r.gate] = { [r.limit]: r.to };
  return out;
}

// ---------------------------------------------------------------- carrying checks over a raise (GH-99)

/**
 * Whether a commit's checks can be carried from its parent's: all it changes is `.acc/floors.json`, and
 * every ratchet it changes there is set to the number the parent's own receipt measured and acc raised.
 * Anything else, such as a relaxed or dropped entry, is checked afresh.
 */
export function carriesOver(parentFloors: Floors, headFloors: Floors, parentReceipts: Record<string, Receipt>): boolean {
  const same = (a: FloorEntry | undefined, b: FloorEntry | undefined) => JSON.stringify(a) === JSON.stringify(b);
  if (Object.keys(parentFloors).some((k) => !(k in headFloors))) return false;
  const changed = Object.keys(headFloors).filter((k) => !same(parentFloors[k], headFloors[k]));
  if (!changed.length) return false;
  return changed.every((k) => {
    const e = headFloors[k]!;
    const measured = parentReceipts[k]?.details?.ratchet as RatchetDetails | undefined;
    return !e.relaxed && !!measured?.raised && measured.limit === limitOf(e) && measured.value === valueOf(e, measured.limit) && measured.raised.to === measured.value;
  });
}

// ---------------------------------------------------------------- two branches that both raised a floor (GH-99)

/**
 * The floors file merged, when both sides only made numbers better than the merge base's: each ratchet
 * keeps the better of the two. Null when either side made one worse (a person relaxed it), dropped one,
 * changed its kind, or left a file that isn't floors: those are a person's to resolve. The base branch's
 * ratchets come first, in its order, then the task branch's new ones.
 */
export function mergeFloors(common: string, ours: string, theirs: string): string | null {
  const [c, o, t] = [common.trim() ? parseFloors(common) : {}, parseFloors(ours), parseFloors(theirs)];
  if (!c || !o || !t) return null;
  const out: Floors = {};
  for (const name of [...new Set([...Object.keys(t), ...Object.keys(o), ...Object.keys(c)])]) {
    const [ce, oe, te] = [c[name], o[name], t[name]];
    if (ce && (!oe || !te)) return null;
    const limit = limitOf((oe ?? te)!);
    if ([ce, oe, te].some((e) => e && limitOf(e) !== limit)) return null;
    const [cv, ov, tv] = [valueOf(ce, limit), valueOf(oe, limit), valueOf(te, limit)];
    if (cv !== null && ((ov !== null && isWorse(limit, ov, cv)) || (tv !== null && isWorse(limit, tv, cv)))) return null;
    out[name] = ov === null ? te! : tv === null ? oe! : isWorse(limit, ov, tv) ? te! : oe!;
  }
  return formatFloors(out);
}

// ---------------------------------------------------------------- relaxing a floor: a person's, always (GH-99)

/** acc's record of a floor a person relaxed, kept in its state beside the receipts. */
export interface RelaxRecord {
  ratchet: string;
  limit: RatchetLimit;
  to: number;
  was: number | null;
  by: string;
  reason: string;
  at: string;
  /** The task it was relaxed for: it backs a floor only on that task's branch (GH-130). A record from before GH-130 has none, and backs nothing. */
  task?: string;
  /** The checkout whose floors file it changed. */
  root: string;
}

/** Every floor people relaxed in this clone. */
export function readRelaxed(file: string): RelaxRecord[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try {
      const r = JSON.parse(l) as RelaxRecord;
      return typeof r.ratchet === 'string' && typeof r.to === 'number' && (r.limit === 'floor' || r.limit === 'ceiling') ? [r] : [];
    } catch {
      return [];
    }
  });
}

/** Whether a record can still back a floor: its task is still on the board, and not done (GH-130). */
export function relaxCounts(r: RelaxRecord, ledger: Ledger): boolean {
  const task = r.task ? ledger.tasks.find((t) => t.id === r.task) : undefined;
  return !!task && task.state !== 'done';
}

/**
 * The records that back a floor on this run (GH-130): the ones made for the task being checked, while it's
 * still open, and only on that task's own branch, where its builder's checks and the merge queue's merge
 * of it both run. Another task's branch, even one that began at the same floor, gets none: a relax is for
 * one task, and its builder alone can't lower a floor a person relaxed for someone else.
 */
export function relaxesFor(records: RelaxRecord[], ledger: Ledger, task: string | undefined, branch: string | null): RelaxRecord[] {
  const t = task ? ledger.tasks.find((x) => x.id === task) : undefined;
  if (!t || !branch || t.run?.branch !== branch) return [];
  return records.filter((r) => r.task === t.id && relaxCounts(r, ledger));
}

/**
 * Drops the records that can't back a floor any more: their task is done or left the board, or they name
 * none (GH-130). The file is written whole. Only acc's own commands call this, holding the ledger's lock,
 * never the Command Center as it reads (D-012). How many it dropped.
 */
export function pruneRelaxed(file: string, ledger: Ledger): number {
  const all = readRelaxed(file);
  const kept = all.filter((r) => relaxCounts(r, ledger));
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
  if (kept.length === lines) return 0;
  writeAtomic(file, kept.map((r) => `${JSON.stringify(r)}\n`).join(''));
  return lines - kept.length;
}

/**
 * Whether a person relaxed this ratchet, from the floor the branch began at, to this number or a worse one.
 * The records are this task's own (relaxesFor). A floor acc raised again after a person relaxed it is still
 * backed by that record, so the commit that records the raise passes. A person who relaxes it again relaxes
 * from the floor they set, so the chain of relaxes that starts at the branch's floor backs the last one. A
 * record relaxed from any other floor backs nothing here: the environment's floor moved on since.
 */
export function relaxedTo(records: RelaxRecord[], name: string, limit: RatchetLimit, value: number, base: number): boolean {
  const mine = records.filter((r) => r.ratchet === name && r.limit === limit);
  const from = new Set<number | null>([base]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of mine) if (from.has(r.was) && !from.has(r.to)) { from.add(r.to); grew = true; }
  }
  return mine.some((r) => from.has(r.was) && (r.to === value || isWorse(limit, r.to, value)));
}

export interface RelaxRequest {
  ratchet: string;
  to: number;
  reason: string;
  by: string;
  now: () => Date;
  /** The task it's for: the record backs a floor only on that task's branch (GH-130). */
  task: string;
}

/**
 * A person relaxes a ratchet's floor (or ceiling) for a task, in a checkout, with a reason (GH-99): the worse
 * number goes in its floors file with who, why, when and what it was, and acc keeps a record naming the
 * task, which is what lets that task's worse floor pass (GH-130). The CLI refuses builders, as it does
 * waivers (D-031). Nothing is committed.
 */
export function relaxFloor(relaxedFile: string, floorsFile: string, root: string, config: Pick<Config, 'gates'>, req: RelaxRequest): RelaxRecord {
  const ratchets = config.gates.ratchets ?? {};
  // A check's stored floor (T-102), such as screenshots.a11y, relaxes as a ratchet's floor does.
  const spec = ratchets[req.ratchet] ?? storedFloorSpec(config, req.ratchet);
  if (!spec) throw new AccError('usage', `No ratchet ${req.ratchet}. This project's ratchets: ${Object.keys(ratchets).join(', ') || 'none'}, or a check's floor in ${FLOORS_FILE}, such as ${Object.keys(config.gates.commands)[0] ?? '<check>'}.<what>.`);
  const reason = req.reason.trim();
  if (!reason) throw new AccError('usage', `Say why it's relaxed: acc gate relax ${req.ratchet} --to <n> --reason "<why>". The reason is kept with the floor.`);
  if (!Number.isFinite(req.to)) throw new AccError('usage', `--to takes the ${spec.limit} as a number, such as --to 640.`);
  const floors = readFloors(floorsFile);
  const was = valueOf(floors[req.ratchet], spec.limit);
  const w = words(spec.limit);
  if (was === null) throw new AccError('refused', `${req.ratchet} has no ${w.limit} in ${floorsFile} yet, so there's nothing to relax.`);
  if (!isWorse(spec.limit, req.to, was)) throw new AccError('refused', `${num(req.to)} isn't ${w.worse} ${req.ratchet}'s ${w.limit}, ${num(was)}, so it doesn't relax it. acc raises a ${w.limit} itself when a change beats it.`);
  const at = req.now().toISOString();
  writeFloors(floorsFile, { ...floors, [req.ratchet]: { [spec.limit]: req.to, relaxed: { by: req.by, reason, at, was } } });
  const record: RelaxRecord = { ratchet: req.ratchet, limit: spec.limit, to: req.to, was, by: req.by, reason, at, task: req.task, root };
  mkdirSync(dirname(relaxedFile), { recursive: true });
  appendFileSync(relaxedFile, `${JSON.stringify(record)}\n`);
  return record;
}
