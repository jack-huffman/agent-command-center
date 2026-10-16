// History's day lines (D-170), and the task page's activity feed: each day's name, in the person's time zone,
// and an entry's time of day. No DOM, so it's testable.

const DAY = 86_400_000;
const FORMATS = new Map<string, Intl.DateTimeFormat>();

/** A formatter, made once for each time zone and kind. Without a time zone, it's the person's own. */
function format(timeZone: string | undefined, kind: 'date' | 'clock' | 'name'): Intl.DateTimeFormat {
  const key = `${timeZone ?? ''}|${kind}`;
  let f = FORMATS.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', kind === 'date' ? { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }
      : kind === 'clock' ? { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
        : { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    FORMATS.set(key, f);
  }
  return f;
}

const parts = (ms: number, timeZone: string | undefined, kind: 'date' | 'name'): Record<string, string> =>
  Object.fromEntries(format(timeZone, kind).formatToParts(ms).map((p) => [p.type, p.value]));

/** The day a moment falls on in the time zone, counted in whole days, so two moments' days can be told apart. */
export function dayNumber(ms: number, timeZone?: string): number {
  const p = parts(ms, timeZone, 'date');
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / DAY;
}

/**
 * A day's name for its line: "Today", "Yesterday", its weekday within the last 7 days, then its date, as
 * "Tuesday, 7 October", with its year when that isn't this year's. A moment after now, as a clock a little
 * ahead gives, is Today.
 */
export function dayName(at: string | number, now: number, timeZone?: string): string {
  const ms = typeof at === 'number' ? at : Date.parse(at);
  const ago = dayNumber(now, timeZone) - dayNumber(ms, timeZone);
  if (ago <= 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  const p = parts(ms, timeZone, 'name');
  if (ago < 7) return p.weekday!;
  const year = parts(now, timeZone, 'name').year === p.year ? '' : ` ${p.year}`;
  return `${p.weekday}, ${p.day} ${p.month}${year}`;
}

/** An entry's time of day, on the 24-hour clock: "14:05". */
export function clock(at: string | number, timeZone?: string): string {
  return format(timeZone, 'clock').format(typeof at === 'number' ? at : Date.parse(at));
}
