/**
 * Where each component opens in its org (T-161), for the salesforce profile (D-003): a person who comes back to a
 * built ticket opens each component it deployed at its own page, `sf org open --path <page>`. Most of these pages
 * need the record's id, which only the org knows: those types name a query for the id by the component's name,
 * the page with that id, and a list page to open where the query finds none. A type the table doesn't name opens
 * Setup. Plain data, no I/O: the caller runs the query and the open.
 */

import type { SfComponent } from './sf-metadata.ts';

/** Setup's home: where a component of a type with no known page opens. */
export const SETUP_HOME = '/lightning/setup/SetupOneHome/home';

/** A query for a component's id by its name: through the Tooling API or not, the SOQL, and the page that takes the id. */
export interface IdLookup {
  tooling: boolean;
  soql: (name: string) => string;
  page: (id: string) => string;
}

/** One type's place in the org: what it opens, in words, and either its page from the name alone, or a lookup and a list to fall back on. */
export interface OrgPage {
  /** What it opens, in words: "Object Manager", "Flow Builder". */
  where: string;
  /** Its page from its name alone, or null when the name doesn't fit a URL. */
  page?: (name: string) => string | null;
  lookup?: IdLookup;
  /** Where it opens when the lookup finds no id. */
  list?: string;
}

/** A name a URL or a SOQL string can carry as it is: letters, digits and underscores. Anything else is refused, never escaped. */
export const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Each object page in Object Manager, by its part of the URL. */
const objectPage = (part: string) => (obj: string): string | null => (SAFE_NAME.test(obj) ? `/lightning/setup/ObjectManager/${obj}/${part}/view` : null);

/** The object a component of an object belongs to: "Contact" of "Contact.Job_Title__c". */
const objectOf = (name: string): string => name.split('.')[0]!;

/** A page with a Setup record's id, as Setup's own links make it. */
const setupRecord = (setup: string) => (id: string): string => `/lightning/setup/${setup}/page?address=%2F${id}`;

/** One query for an Id by a name field, with that name in quotes: the name is checked against SAFE_NAME first. */
const byName = (from: string, field: string, more = ''): ((name: string) => string) => (name) => `SELECT Id FROM ${from} WHERE ${field} = '${name}'${more} LIMIT 1`;

/**
 * Each type's place in the org, by the Metadata API's name for it (sfComponent's `type`). An object or a part of
 * one opens in Object Manager; a flow in Flow Builder; an Apex class or trigger at its Setup page; a Lightning page
 * in the App Builder; a permission set or group at its page; a report or a dashboard at its record.
 */
export const ORG_PAGES: Record<string, OrgPage> = {
  CustomObject: { where: 'Object Manager', page: objectPage('Details') },
  CustomField: { where: 'Object Manager', page: (n) => objectPage('FieldsAndRelationships')(objectOf(n)) },
  ValidationRule: { where: 'Object Manager', page: (n) => objectPage('ValidationRules')(objectOf(n)) },
  RecordType: { where: 'Object Manager', page: (n) => objectPage('RecordTypes')(objectOf(n)) },
  CompactLayout: { where: 'Object Manager', page: (n) => objectPage('CompactLayouts')(objectOf(n)) },
  FieldSet: { where: 'Object Manager', page: (n) => objectPage('FieldSets')(objectOf(n)) },
  WebLink: { where: 'Object Manager', page: (n) => objectPage('ButtonsLinksActions')(objectOf(n)) },
  // A page layout's name is its object, a hyphen, then its own name: "Contact-Contact Layout".
  Layout: { where: 'Object Manager', page: (n) => objectPage('PageLayouts')(n.split('-')[0]!) },
  Flow: {
    where: 'Flow Builder',
    lookup: { tooling: true, soql: byName('FlowDefinition', 'DeveloperName'), page: (id) => `/builder_platform_interaction/flowBuilder.app?flowDefId=${id}` },
    list: '/lightning/setup/Flows/home',
  },
  ApexClass: {
    where: 'its Setup page',
    lookup: { tooling: true, soql: byName('ApexClass', 'Name', ' AND NamespacePrefix = null'), page: setupRecord('ApexClasses') },
    list: '/lightning/setup/ApexClasses/home',
  },
  ApexTrigger: {
    where: 'its Setup page',
    lookup: { tooling: true, soql: byName('ApexTrigger', 'Name', ' AND NamespacePrefix = null'), page: setupRecord('ApexTriggers') },
    list: '/lightning/setup/ApexTriggers/home',
  },
  FlexiPage: {
    where: 'the Lightning App Builder',
    lookup: { tooling: true, soql: byName('FlexiPage', 'DeveloperName'), page: (id) => `/visualEditor/appBuilder.app?pageId=${id}` },
    list: '/lightning/setup/FlexiPageList/home',
  },
  PermissionSet: {
    where: 'its Setup page',
    lookup: { tooling: false, soql: byName('PermissionSet', 'Name'), page: setupRecord('PermSets') },
    list: '/lightning/setup/PermSets/home',
  },
  PermissionSetGroup: {
    where: 'its Setup page',
    lookup: { tooling: false, soql: byName('PermissionSetGroup', 'DeveloperName'), page: setupRecord('PermSetGroups') },
    list: '/lightning/setup/PermSetGroups/home',
  },
  Report: {
    where: 'its record',
    lookup: { tooling: false, soql: byName('Report', 'DeveloperName'), page: (id) => `/lightning/r/Report/${id}/view` },
    list: '/lightning/o/Report/home',
  },
  Dashboard: {
    where: 'its record',
    lookup: { tooling: false, soql: byName('Dashboard', 'DeveloperName'), page: (id) => `/lightning/r/Dashboard/${id}/view` },
    list: '/lightning/o/Dashboard/home',
  },
};

/**
 * How to open one component: its page now, or a query for its id first. A report or a dashboard is named by its
 * folder and its own name: only its own name is asked for. A name that isn't safe, or a type the table doesn't
 * name, opens where it can without one: the type's list, else Setup.
 */
export type OrgOpen =
  | { kind: 'page'; page: string; where: string }
  | { kind: 'lookup'; tooling: boolean; soql: string; page: (id: string) => string; list: string; where: string };

export function orgOpen(c: Pick<SfComponent, 'type' | 'name'>): OrgOpen {
  const p = ORG_PAGES[c.type];
  if (!p) return { kind: 'page', page: SETUP_HOME, where: 'Setup' };
  const page = p.page?.(c.name);
  if (page) return { kind: 'page', page, where: p.where };
  const own = c.name.split('/').at(-1)!;
  if (p.lookup && SAFE_NAME.test(own)) return { kind: 'lookup', tooling: p.lookup.tooling, soql: p.lookup.soql(own), page: p.lookup.page, list: p.list ?? SETUP_HOME, where: p.where };
  return { kind: 'page', page: p.list ?? SETUP_HOME, where: p.list ? p.where : 'Setup' };
}

/** sf's arguments for the query of a lookup, its answer as JSON. */
export const idQueryArgs = (org: string, o: Extract<OrgOpen, { kind: 'lookup' }>): string[] =>
  ['data', 'query', ...(o.tooling ? ['--use-tooling-api'] : []), '--query', o.soql, '--target-org', org, '--json'];

/** The id in a query's answer, or null: sf failed, it found none, or the id isn't one. */
export function idFrom(stdout: string): string | null {
  try {
    const id = (JSON.parse(stdout) as { result?: { records?: { Id?: unknown }[] } }).result?.records?.[0]?.Id;
    return typeof id === 'string' && /^[A-Za-z0-9]{15,18}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** The page a lookup opens: the record's own with the id it found, else the type's list. */
export const lookedUp = (o: Extract<OrgOpen, { kind: 'lookup' }>, id: string | null): string => (id ? o.page(id) : o.list);

/** sf's arguments to open an org in the browser: at a page when given, else its home. */
export const orgOpenArgs = (org: string, page?: string): string[] => ['org', 'open', '--target-org', org, ...(page ? ['--path', page] : [])];
