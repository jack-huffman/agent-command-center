/**
 * A check's stored floors (T-102): floors a check's own run keeps in `.acc/floors.json` under the check's
 * name, such as `screenshots.a11y`, and raises when a clean whole run examines more. They only go up, as a
 * ratchet's do (GH-99): a branch that lowers one fails its check, unless a person relaxed it for that
 * task with acc gate relax, which keeps the same record as a ratchet's relax (GH-130).
 */
import type { Config, RatchetSpec } from './config.ts';
import { FLOORS_FILE, isWorse, num, type RatchetFloors, relaxedTo, valueOf } from './ratchets.ts';

/** A stored floor's name: its check, a dot, and what it counts, as `screenshots.a11y`. */
const STORED = /^([^.]+)\.(.+)$/;

/**
 * What a person relaxes when they name a stored floor: a floor, labelled with its own name. Null when the
 * name isn't `<check>.<what>` for a check in `gates.commands`, so a typo is never a floor of its own.
 */
export function storedFloorSpec(config: Pick<Config, 'gates'>, name: string): RatchetSpec | null {
  const m = STORED.exec(name);
  const command = m ? config.gates.commands[m[1]!] : undefined;
  return command === undefined ? null : { command, limit: 'floor', label: name };
}

/**
 * Why a check fails before it runs: its branch lowered or dropped one of its stored floors from where the
 * branch began, and no person relaxed it for this task. Null when each is at or above its base, or relaxed to it.
 */
export function storedFloorsLowered(check: string, floors: RatchetFloors): string | null {
  const lowered = Object.keys(floors.base).filter((name) => name.startsWith(`${check}.`)).flatMap((name) => {
    const base = valueOf(floors.base[name], 'floor');
    const head = valueOf(floors.head[name], 'floor');
    if (base === null || (head !== null && !isWorse('floor', head, base)) || (head !== null && relaxedTo(floors.relaxed, name, 'floor', head, base))) return [];
    return [head === null ? `drops ${name} (${num(base)})` : `lowers ${name} from ${num(base)} to ${num(head)}`];
  });
  if (!lowered.length) return null;
  return `${FLOORS_FILE} ${lowered.join(', ')}, and no person relaxed it. Put it back: only a person relaxes a floor, with acc gate relax <name> --to <n> --reason "<why>".`;
}
