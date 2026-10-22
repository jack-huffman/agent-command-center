/**
 * Record changes (T-100), the Salesforce profile's kind of change outside git (D-003): renaming an Account,
 * adding the records a flow depends on, changing a custom setting. Git never sees them, so each is kept with
 * its ticket, named by something that is the same in every org: an external ID, a unique name, or a set of
 * field values that matches one record. Never by its record ID, which differs in every org. At promotion
 * each becomes a step a person reviews and runs, with the `sf data` commands that make it.
 */
import type { OutsideKind, OutsideState } from './outside-changes.ts';
import { isObj } from './text.ts';

export const RECORD_ACTIONS = ['create', 'update', 'delete'] as const;
export type RecordAction = (typeof RECORD_ACTIONS)[number];

/** A field and its value, as the record is found by. */
export interface RecordMatch {
  field: string;
  value: string;
}

/** A field it sets: what it was, where that's known, and what it becomes. */
export interface RecordField {
  field: string;
  from: string | null;
  to: string;
}

export interface RecordChange {
  object: string;
  action: RecordAction;
  /** How to find the record in any org: never its record ID. */
  match: RecordMatch[];
  fields: RecordField[];
}

/** A record change the plan lists (T-100), with why, and why it's refused when it can only be named by ID. */
export interface PlannedRecordChange extends RecordChange {
  why: string;
  refused?: string;
}

/**
 * A Salesforce record ID, 15 or 18 characters: a three-character prefix, two for the instance, the reserved
 * 0, then nine. It is different in every org, so nothing that names one can be replicated.
 */
export const RECORD_ID = /^[a-zA-Z0-9]{5}0[a-zA-Z0-9]{9}(?:[a-zA-Z0-9]{3})?$/;

/** An object's or a field's API name: Account, Region__c, ns__Thing__c, Account.Name for a parent's field. */
const API_NAME = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/;

/** The field names that make one record's name read as a name: "Account 'Acme Corp'". */
const NAMES = ['Name', 'DeveloperName', 'MasterLabel'];

/** `<field>=<value>` as `acc change record` takes it, split at the first =. Null when there's no field before it. */
export function recordPair(text: string): RecordMatch | null {
  const at = text.indexOf('=');
  if (at < 1) return null;
  const field = text.slice(0, at).trim();
  return field ? { field, value: text.slice(at + 1).trim() } : null;
}

/**
 * Why this record change can't be kept, or nothing. A change named only by its record ID (the Id field, or a
 * value shaped like an ID) is refused with why: it would find no record, or the wrong one, in another org.
 */
export function recordProblems(c: RecordChange): string[] {
  const p: string[] = [];
  if (!API_NAME.test(c.object) || c.object.includes('.')) p.push(`"${c.object}" isn't an object's API name, such as Account or Region__c.`);
  if (!(RECORD_ACTIONS as readonly string[]).includes(c.action)) p.push(`A record change creates, updates or deletes: "${c.action}" isn't one of those.`);
  if (!c.match.length) p.push('Name the record by something that is the same in every org: an external ID field, a unique name, or field values that match one record (--match <field>=<value>).');
  for (const m of [...c.match, ...c.fields.map((f) => ({ field: f.field, value: f.to }))]) {
    if (!API_NAME.test(m.field)) p.push(`"${m.field}" isn't a field's API name.`);
  }
  const byId = c.match.filter((m) => m.field.toLowerCase() === 'id' || RECORD_ID.test(m.value));
  if (byId.length) {
    p.push(`It names the record by its ID (${byId.map((m) => `${m.field}=${m.value}`).join(', ')}). A record ID is different in every org, so production would find no record, or the wrong one. Name it by an external ID field, a unique name, or field values that match one record.`);
  }
  const setsId = c.fields.filter((f) => f.field.toLowerCase() === 'id' || RECORD_ID.test(f.to));
  if (setsId.length) {
    p.push(`It sets ${setsId.map((f) => f.field).join(', ')} to a record ID, which is different in every org. Say in --why which record it should point to, and set that by hand in each org.`);
  }
  if (c.action === 'update' && !c.fields.length) p.push('An update sets at least one field (--set <field>=<value>).');
  if (c.action === 'delete' && c.fields.length) p.push('A delete sets no fields: leave out --set.');
  return p;
}

const quoted = (v: string): string => `'${v}'`;

/** How the record is named in words: "'Acme Corp'" by its name, else each field and value. */
export function recordKeyWords(c: Pick<RecordChange, 'match'>): string {
  const [one] = c.match;
  if (c.match.length === 1 && one && NAMES.includes(one.field)) return quoted(one.value);
  return c.match.map((m) => `${m.field} ${quoted(m.value)}`).join(', ');
}

/** A record change in plain words: "Account 'Acme Corp': Name → 'Acme Corporation'". */
export function recordWords(c: RecordChange): string {
  const fields = c.fields.map((f) => `${f.field} ${f.from !== null ? `${quoted(f.from)} ` : ''}→ ${quoted(f.to)}`).join(', ');
  const key = recordKeyWords(c);
  if (c.action === 'create') return `New ${c.object} ${key}${fields ? `: ${fields}` : ''}`;
  if (c.action === 'delete') return `Delete ${c.object} ${key}`;
  return `${c.object} ${key}: ${fields}`;
}

/** The same record and the same action: how a recorded change is matched with the plan's. */
export const recordKey = (c: Pick<RecordChange, 'object' | 'action' | 'match'>): string =>
  [c.object.toLowerCase(), c.action, ...c.match.map((m) => `${m.field.toLowerCase()}=${m.value}`).sort()].join('|');

/** A value inside an sf `--values` or `--where` list: single-quoted, its own quotes escaped. */
const sfValue = (v: string): string => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
/** A shell argument in double quotes, with what the shell would act on escaped. */
const shellArg = (s: string): string => `"${s.replace(/[\\"$`]/g, '\\$&')}"`;
const pairs = (xs: RecordMatch[]): string => shellArg(xs.map((x) => `${x.field}=${sfValue(x.value)}`).join(' '));
/** A SOQL string literal. */
const soql = (v: string): string => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * The commands that make the change in an org, matched on its stable key: a query that should find one
 * record (none, for a create), then `sf data create|update|delete record`. A person reviews and runs them;
 * nothing runs them by itself. `org` is the destination's alias, or a placeholder when it has none.
 */
export function recordScript(c: RecordChange, org: string | null): string[] {
  const target = `--target-org ${org === null ? '<org>' : shellArg(org)}`;
  const where = c.match.map((m) => `${m.field} = ${soql(m.value)}`).join(' AND ');
  const check = `sf data query ${target} --query ${shellArg(`SELECT Id FROM ${c.object} WHERE ${where}`)}`;
  if (c.action === 'create') {
    const values = [...c.match.filter((m) => !c.fields.some((f) => f.field === m.field)), ...c.fields.map((f) => ({ field: f.field, value: f.to }))];
    return [`# It should find no record yet:`, check, `sf data create record ${target} --sobject ${c.object} --values ${pairs(values)}`];
  }
  if (c.action === 'delete') return ['# It should find exactly one record:', check, `sf data delete record ${target} --sobject ${c.object} --where ${pairs(c.match)}`];
  return ['# It should find exactly one record:', check, `sf data update record ${target} --sobject ${c.object} --where ${pairs(c.match)} --values ${pairs(c.fields.map((f) => ({ field: f.field, value: f.to })))}`];
}

/** The keys of the plan's record changes that can be kept: one refused for its ID matches nothing. */
export const plannedRecordKeys = (a: { recordChanges?: PlannedRecordChange[] } | null): string[] => (a?.recordChanges ?? []).filter((p) => !p.refused).map(recordKey);

/** Record changes as the Salesforce profile adds them to the core's changes outside git (D-003). */
export const RECORD_KIND: OutsideKind<RecordChange> = {
  kind: 'record',
  profile: 'salesforce',
  label: 'Record changes',
  problems: recordProblems,
  words: recordWords,
  key: recordKey,
  script: recordScript,
};

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** One record change from what an agent wrote, with whatever shape it has; null when it names no object. */
export function readRecordChange(v: unknown): RecordChange | null {
  if (!isObj(v) || !text(v.object)) return null;
  const list = <T>(x: unknown, f: (y: Record<string, unknown>) => T | null): T[] => (Array.isArray(x) ? x.filter(isObj).map(f).filter((y): y is T => !!y) : []);
  return {
    object: text(v.object),
    action: (RECORD_ACTIONS as readonly string[]).includes(v.action as string) ? v.action as RecordAction : 'update',
    match: list(v.match, (m) => (text(m.field) ? { field: text(m.field), value: text(m.value) } : null)),
    fields: list(v.fields, (f) => (text(f.field) ? { field: text(f.field), from: text(f.from) || null, to: text(f.to) } : null)),
  };
}

/**
 * The plan's record changes (T-100), as the analyst wrote them. Each keeps its why; one that can only be named
 * by its record ID stays, refused with why, so a person sees it and the plan is fixed.
 */
export function parsePlannedRecords(v: unknown): PlannedRecordChange[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    const c = readRecordChange(x);
    if (!c) return [];
    const problems = recordProblems(c);
    return [{ ...c, why: text((x as Record<string, unknown>).why), ...(problems.length ? { refused: problems.join(' ') } : {}) }];
  });
}

/** What the analyst answers with for its planned record changes: one property of the plan's schema. */
export const RECORD_CHANGES_SCHEMA = {
  type: 'array',
  description: 'Every record the work must create, change or delete in the org, which git never sees: data a flow needs, a renamed record, a custom setting. Find each one by an external ID field, a unique name, or field values that match one record, never by its record ID. Empty when it changes no records',
  items: {
    type: 'object', additionalProperties: false, required: ['object', 'action', 'match', 'fields', 'why'],
    properties: {
      object: { type: 'string', description: 'The object\'s API name, such as Account or Region__c' },
      action: { type: 'string', enum: [...RECORD_ACTIONS] },
      match: {
        type: 'array', description: 'How to find the record in any org: fields and values that match one record. Never Id',
        items: { type: 'object', additionalProperties: false, required: ['field', 'value'], properties: { field: { type: 'string' }, value: { type: 'string' } } },
      },
      fields: {
        type: 'array', description: 'The fields it sets: the value now (empty when unknown or for a create) and the new value. Empty for a delete',
        items: { type: 'object', additionalProperties: false, required: ['field', 'from', 'to'], properties: { field: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } } },
      },
      why: { type: 'string' },
    },
  },
} as const;

/** What the analyst is told about record changes, on a Salesforce project. */
export const RECORD_PLAN_PROMPT = 'List every record the work must create, change or delete (recordChanges): git never sees them, and production needs them too. Say how to find each one without a record ID: an external ID field, a unique name, or field values that match one record.';

const bullets = (xs: string[]): string[] => xs.map((x) => `- ${x}`);

/** A planned record change as a builder or a reviewer reads it: its words, why, and why it's refused. */
const plannedLine = (p: PlannedRecordChange): string => `${recordWords(p)}${p.why ? `. Why: ${p.why}` : ''}${p.refused ? ` (Refused: ${p.refused})` : ''}`;

/** The builder's instructions on record changes (T-100), on a Salesforce project: how to record them, and the plan's. */
export function recordPacketSection(planned: PlannedRecordChange[], sf: boolean): string[] {
  if (!sf) return [];
  return [
    '## Record changes',
    '',
    'Git never sees a change to a record in the org, so production would miss it. Record each record you create, change or delete, right after you make it:',
    '',
    '`acc change record --object <Object> --match \'<field>=<value>\' [--set \'<field>=<value>\']... [--create|--delete] --why "<why>"`',
    '',
    'Name the record by what is the same in every org: an external ID field, a unique name, or field values that match one record. Never by its record ID: acc refuses that.',
    'acc notes each command you run that can write records (`sf data create|update|delete|upsert|import`, `sf apex run`, an SFDMU run). `acc done` refuses until a change is recorded after it, or you say it made none: `acc change none "<why>"`.',
    '',
    ...(planned.length ? ['The plan lists these record changes:', '', ...bullets(planned.map(plannedLine)), ''] : []),
  ];
}

/** What the reviewer checks of record changes (T-100): what was recorded, what acc noted, and what the builder said made none. */
export function recordReviewSection(o: Pick<OutsideState, 'changes' | 'noted' | 'none'>, sf: boolean): string[] {
  if (!sf) return [];
  return [
    '## Record changes',
    '',
    'Check the recorded record changes against the plan\'s (in the task above) and the commands acc noted. A finding with must: true for a planned change nobody recorded, a noted command with no change recorded after it and no reason, or a change named by a value only one org has. A recorded change the plan didn\'t list needs a reason in the note.',
    '',
    'Recorded:',
    '',
    ...(o.changes.length ? bullets(o.changes.map((c) => `${c.id}: ${recordWords(c.detail as RecordChange)}. Why: ${c.why}. ${c.planned ? 'Planned' : 'Not in the plan'}, by ${c.by} at ${c.at}`)) : ['- none']),
    '',
    'Commands acc noted that can write records:',
    '',
    ...(o.noted.length ? bullets(o.noted.map((n) => `\`${n.command}\` at ${n.at}`)) : ['- none']),
    ...(o.none.length ? ['', 'Said to have made no change:', '', ...bullets(o.none.map((n) => `${n.why} (${n.by} at ${n.at})`))] : []),
    '',
  ];
}
