// Changing one key of a JSON file a person keeps, such as .acc/config.json, and nothing else in it (GH-111).

import { readFileSync, writeFileSync } from 'node:fs';
import { AccError } from './exec.ts';

/** Where a value sits in the text: from its first character to just after its last. */
interface Span {
  start: number;
  end: number;
}

/** An object's member: where its key starts, and its value. */
interface Member {
  key: string;
  keyStart: number;
  value: Span;
}

/** An object in the text: its braces, and its members in order. */
interface ObjectSpan extends Span {
  members: Member[];
}

/**
 * Reads JSON text for where things are, not what they hold: each value's span, and each object's members.
 * Only objects are looked into; anything else is skipped over whole. Throws on text that isn't JSON.
 */
class Scanner {
  private i = 0;
  private readonly text: string;
  readonly objects = new Map<number, ObjectSpan>();

  constructor(text: string) {
    this.text = text;
  }

  /** The top value's span, every object found on the way kept by where it starts. */
  scan(): Span {
    this.space();
    const v = this.value();
    this.space();
    if (this.i !== this.text.length) this.fail('more after the end');
    return v;
  }

  private fail(why: string): never {
    throw new SyntaxError(`Not JSON at ${this.i}: ${why}`);
  }

  private space(): void {
    while (this.i < this.text.length && ' \t\n\r'.includes(this.text[this.i]!)) this.i++;
  }

  private value(): Span {
    const start = this.i;
    const c = this.text[this.i];
    if (c === '{') return this.object();
    if (c === '[') {
      this.i++;
      this.space();
      if (this.text[this.i] === ']') { this.i++; return { start, end: this.i }; }
      for (;;) {
        this.value();
        this.space();
        if (this.text[this.i] === ',') { this.i++; this.space(); continue; }
        if (this.text[this.i] === ']') { this.i++; return { start, end: this.i }; }
        this.fail('expected , or ]');
      }
    }
    if (c === '"') { this.string(); return { start, end: this.i }; }
    const m = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(this.text.slice(this.i));
    if (!m) this.fail('expected a value');
    this.i += m[0].length;
    return { start, end: this.i };
  }

  private string(): string {
    const start = this.i;
    this.i++;
    while (this.i < this.text.length && this.text[this.i] !== '"') this.i += this.text[this.i] === '\\' ? 2 : 1;
    if (this.i >= this.text.length) this.fail('a string never ends');
    this.i++;
    return JSON.parse(this.text.slice(start, this.i)) as string;
  }

  private object(): ObjectSpan {
    const start = this.i;
    this.i++;
    const members: Member[] = [];
    this.space();
    if (this.text[this.i] !== '}') {
      for (;;) {
        this.space();
        if (this.text[this.i] !== '"') this.fail('expected a key');
        const keyStart = this.i;
        const key = this.string();
        this.space();
        if (this.text[this.i] !== ':') this.fail('expected :');
        this.i++;
        this.space();
        members.push({ key, keyStart, value: this.value() });
        this.space();
        if (this.text[this.i] === ',') { this.i++; continue; }
        if (this.text[this.i] === '}') break;
        this.fail('expected , or }');
      }
    }
    this.i++;
    const o = { start, end: this.i, members };
    this.objects.set(start, o);
    return o;
  }
}

/** The values, whatever order an object's keys are in. */
const canon = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
  : Array.isArray(v) ? v.map(canon) : v);

export const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** The whitespace a line starts with, for the line holding `at`. */
const indentAt = (text: string, at: number): string => /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', at - 1) + 1))![0];

/** One step of indentation as the file has it: its first indented line's, else two spaces. */
const indentUnit = (text: string): string => /\n([ \t]+)\S/.exec(text)?.[1] ?? '  ';

/** A value written as the file writes values, its later lines at `indent`. */
const shaped = (value: unknown, unit: string, indent: string): string => JSON.stringify(value, null, unit).replace(/\n/g, `\n${indent}`);

/** A value on one line, spaced as a person writes one there: [ "a", "b" ]. JSON escapes a string's own line breaks. */
const inline = (value: unknown): string => JSON.stringify(value, null, 1).replace(/\n\s*/g, ' ');

/** A list or object that was on one line, with something in it, stays on one line. */
const oneLine = (text: string, span: Span): boolean => {
  const old = text.slice(span.start, span.end);
  return /^[[{]/.test(old) && !old.includes('\n') && !/^(\[\s*\]|\{\s*\})$/.test(old);
};

/** The value at a path, as the whole thing would be with it, or without it when the value is undefined. */
function withValue(raw: unknown, path: string[], value: unknown): unknown {
  const [key, ...rest] = path;
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  if (!rest.length) {
    const { [key!]: _old, ...others } = obj;
    return value === undefined ? others : { ...obj, [key!]: value };
  }
  if (value === undefined && !(key! in obj)) return obj;
  return { ...obj, [key!]: withValue(obj[key!], rest, value) };
}

/**
 * Sets one key of a JSON text, at a path of object keys, or removes it when the value is undefined, and
 * leaves every other character as it was: the value replaced where it stands, a new key put after the
 * last of its object's, with any objects on the way to it, indented as the file is. What it returns is
 * checked: it must read back as the old text with only that change, or the whole text is written again in
 * the file's indentation instead. Throws on text that isn't JSON.
 */
export function editJsonKey(text: string, path: string[], value: unknown): string {
  if (!path.length) throw new Error('editJsonKey needs a path.');
  const raw = JSON.parse(text) as unknown;
  const wanted = withValue(raw, path, value);
  const unit = indentUnit(text);
  const whole = JSON.stringify(wanted, null, unit) + '\n';
  if (sameJson(raw, wanted)) return text;
  const fits = (edited: string): boolean => {
    try {
      return sameJson(JSON.parse(edited), wanted);
    } catch {
      return false;
    }
  };
  let edited: string | null = null;
  try {
    edited = editAt(text, path, value, unit);
  } catch {
    edited = null;
  }
  return edited !== null && fits(edited) ? edited : whole;
}

function editAt(text: string, path: string[], value: unknown, unit: string): string | null {
  const s = new Scanner(text);
  const top = s.scan();
  let obj = s.objects.get(top.start);
  if (!obj) return null;
  for (let depth = 0; depth < path.length; depth++) {
    const key = path[depth]!;
    // The last of a key a file names twice is the one JSON reads.
    const m = obj.members.filter((x) => x.key === key).at(-1);
    const last = depth === path.length - 1;
    if (m && last) {
      if (value !== undefined) return text.slice(0, m.value.start) + (oneLine(text, m.value) ? inline(value) : shaped(value, unit, indentAt(text, m.keyStart))) + text.slice(m.value.end);
      return removeMember(text, obj, m);
    }
    if (m) {
      const inner = s.objects.get(m.value.start);
      if (!inner) return null; // not an object: written whole
      obj = inner;
      continue;
    }
    if (value === undefined) return text; // nothing there to remove
    // The rest of the path is new: one key here, holding objects down to the value.
    const nested = path.slice(depth + 1).reduceRight<unknown>((v, k) => ({ [k]: v }), value);
    return addMember(text, obj, key, nested, unit);
  }
  return null;
}

/** A new key after the last one in its object, on its own line, as the object's other keys are. */
function addMember(text: string, obj: ObjectSpan, key: string, value: unknown, unit: string): string {
  const prev = obj.members.at(-1);
  if (!prev) {
    // An empty object: the key on a line of its own, the closing brace back where its line started.
    const outer = indentAt(text, obj.start);
    const indent = outer + unit;
    return `${text.slice(0, obj.start)}{\n${indent}${JSON.stringify(key)}: ${shaped(value, unit, indent)}\n${outer}}${text.slice(obj.end)}`;
  }
  const sameLine = !text.slice(obj.start, prev.keyStart).includes('\n');
  const indent = sameLine ? '' : indentAt(text, prev.keyStart);
  const gap = sameLine ? ' ' : `\n${indent}`;
  return `${text.slice(0, prev.value.end)},${gap}${JSON.stringify(key)}: ${sameLine ? inline(value) : shaped(value, unit, indent)}${text.slice(prev.value.end)}`;
}

/** A key taken out with its comma, and its line when it had one to itself. */
function removeMember(text: string, obj: ObjectSpan, m: Member): string {
  const i = obj.members.indexOf(m);
  const before = obj.members[i - 1];
  const after = obj.members[i + 1];
  if (after) return text.slice(0, m.keyStart) + text.slice(after.keyStart);
  if (before) return text.slice(0, before.value.end) + text.slice(m.value.end);
  // The only key: the object is left empty.
  return `${text.slice(0, obj.start)}{}${text.slice(obj.end)}`;
}

/**
 * Sets one key of a JSON file, or removes it when the value is undefined, changing nothing else in it:
 * editJsonKey, read and written. A file it can't read or that isn't JSON is refused, and left alone.
 */
export function writeJsonKey(file: string, path: string[], value: unknown): void {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
    JSON.parse(text);
  } catch (e) {
    throw new AccError('bad-config', `Couldn't read ${file}: ${(e as Error).message}`);
  }
  const edited = editJsonKey(text, path, value);
  if (edited !== text) writeFileSync(file, edited);
}
