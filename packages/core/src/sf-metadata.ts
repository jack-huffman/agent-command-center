/**
 * The salesforce profile's names for source paths (T-99, D-003): a person reads Salesforce metadata by type
 * and name, "Custom Field: Contact.Job_Title__c", not by its path in source format. Each path maps to the
 * component it is part of, with the Metadata API's name for its type, so a ticket's package.xml (T-101) can
 * use it too. A path this doesn't know is null, and its caller shows it as itself.
 */

/** A metadata component: the Metadata API's type, the type as a person reads it, and the member's name. */
export interface SfComponent {
  type: string;
  label: string;
  name: string;
}

/** A folder of single-file components: the files' suffix, and the type they are. */
interface FileKind {
  suffix: string;
  type: string;
  label: string;
}

/** What each metadata folder holds, by its name in source format. */
const FILES: Record<string, FileKind> = {
  applications: { suffix: '.app', type: 'CustomApplication', label: 'App' },
  assignmentRules: { suffix: '.assignmentRules', type: 'AssignmentRules', label: 'Assignment Rules' },
  classes: { suffix: '.cls', type: 'ApexClass', label: 'Apex Class' },
  components: { suffix: '.component', type: 'ApexComponent', label: 'Visualforce Component' },
  customMetadata: { suffix: '.md', type: 'CustomMetadata', label: 'Custom Metadata Record' },
  escalationRules: { suffix: '.escalationRules', type: 'EscalationRules', label: 'Escalation Rules' },
  flexipages: { suffix: '.flexipage', type: 'FlexiPage', label: 'Lightning Page' },
  flows: { suffix: '.flow', type: 'Flow', label: 'Flow' },
  globalValueSets: { suffix: '.globalValueSet', type: 'GlobalValueSet', label: 'Global Value Set' },
  labels: { suffix: '.labels', type: 'CustomLabels', label: 'Custom Labels' },
  layouts: { suffix: '.layout', type: 'Layout', label: 'Page Layout' },
  pages: { suffix: '.page', type: 'ApexPage', label: 'Visualforce Page' },
  permissionsetgroups: { suffix: '.permissionsetgroup', type: 'PermissionSetGroup', label: 'Permission Set Group' },
  permissionsets: { suffix: '.permissionset', type: 'PermissionSet', label: 'Permission Set' },
  profiles: { suffix: '.profile', type: 'Profile', label: 'Profile' },
  queues: { suffix: '.queue', type: 'Queue', label: 'Queue' },
  quickActions: { suffix: '.quickAction', type: 'QuickAction', label: 'Quick Action' },
  staticresources: { suffix: '.resource', type: 'StaticResource', label: 'Static Resource' },
  tabs: { suffix: '.tab', type: 'CustomTab', label: 'Tab' },
  triggers: { suffix: '.trigger', type: 'ApexTrigger', label: 'Apex Trigger' },
};

/** Folders whose components live in folders of their own: the components' suffix, their type, and the folder's. */
const FOLDERED: Record<string, FileKind & { folderSuffix: string; folderLabel: string }> = {
  reports: { suffix: '.report', type: 'Report', label: 'Report', folderSuffix: '.reportFolder', folderLabel: 'Report Folder' },
  dashboards: { suffix: '.dashboard', type: 'Dashboard', label: 'Dashboard', folderSuffix: '.dashboardFolder', folderLabel: 'Dashboard Folder' },
  email: { suffix: '.email', type: 'EmailTemplate', label: 'Email Template', folderSuffix: '.emailFolder', folderLabel: 'Email Folder' },
  documents: { suffix: '', type: 'Document', label: 'Document', folderSuffix: '.documentFolder', folderLabel: 'Document Folder' },
};

/** Folders of bundles: every file under a bundle's folder is part of it. */
const BUNDLES: Record<string, Omit<FileKind, 'suffix'>> = {
  lwc: { type: 'LightningComponentBundle', label: 'Lightning Web Component' },
  aura: { type: 'AuraDefinitionBundle', label: 'Aura Component' },
};

/** What an object's folder holds besides the object itself, by subfolder: the files' suffix, and the type. */
const OBJECT_PARTS: Record<string, FileKind> = {
  fields: { suffix: '.field', type: 'CustomField', label: 'Custom Field' },
  listViews: { suffix: '.listView', type: 'ListView', label: 'List View' },
  recordTypes: { suffix: '.recordType', type: 'RecordType', label: 'Record Type' },
  validationRules: { suffix: '.validationRule', type: 'ValidationRule', label: 'Validation Rule' },
  webLinks: { suffix: '.webLink', type: 'WebLink', label: 'Button or Link' },
  compactLayouts: { suffix: '.compactLayout', type: 'CompactLayout', label: 'Compact Layout' },
  fieldSets: { suffix: '.fieldSet', type: 'FieldSet', label: 'Field Set' },
  businessProcesses: { suffix: '.businessProcess', type: 'BusinessProcess', label: 'Business Process' },
};

const OBJECT: Omit<FileKind, 'suffix'> = { type: 'CustomObject', label: 'Custom Object' };

/** A file's name without its suffix: Foo.cls and Foo.cls-meta.xml are Foo. Null when it has another. */
function stem(file: string, suffix: string): string | null {
  const bare = file.endsWith('-meta.xml') ? file.slice(0, -'-meta.xml'.length) : file;
  if (!suffix) return bare.replace(/\.[^.]+$/, '') || null;
  return bare.endsWith(suffix) && bare.length > suffix.length ? bare.slice(0, -suffix.length) : null;
}

/** The component a path under a metadata folder is part of, from that folder on; null when it isn't one. */
function fromFolder(dir: string, rest: string[]): SfComponent | null {
  const files = FILES[dir];
  if (files && rest.length === 1) {
    // A static resource's archive or file sits beside its -meta.xml, under the same name.
    const name = stem(rest[0]!, files.suffix) ?? (dir === 'staticresources' ? stem(rest[0]!, '') : null);
    return name ? { type: files.type, label: files.label, name } : null;
  }
  if (dir === 'staticresources' && rest.length > 1) return { type: FILES.staticresources!.type, label: FILES.staticresources!.label, name: rest[0]! };
  const bundle = BUNDLES[dir];
  if (bundle && rest.length >= 2) return { ...bundle, name: rest[0]! };
  const foldered = FOLDERED[dir];
  if (foldered) {
    if (rest.length === 1) {
      const folder = stem(rest[0]!, foldered.folderSuffix);
      return folder ? { type: foldered.type, label: foldered.folderLabel, name: folder } : null;
    }
    const name = stem(rest[rest.length - 1]!, foldered.suffix);
    return name ? { type: foldered.type, label: foldered.label, name: [...rest.slice(0, -1), name].join('/') } : null;
  }
  if (dir === 'objects' && rest.length >= 2) {
    const [object, second, third] = rest as [string, string, string | undefined];
    if (rest.length === 2) return stem(second, '.object') === object ? { ...OBJECT, name: object } : null;
    const part = OBJECT_PARTS[second];
    const name = part && rest.length === 3 && third ? stem(third, part.suffix) : null;
    return part && name ? { type: part.type, label: part.label, name: `${object}.${name}` } : null;
  }
  return null;
}

/**
 * The component a source path is part of, as the salesforce profile names it: "Custom Field" and
 * "Contact.Job_Title__c" for force-app/main/default/objects/Contact/fields/Job_Title__c.field-meta.xml.
 * The first metadata folder in the path that the rest of it fits decides. Null for a path it doesn't know.
 */
export function sfComponent(path: string): SfComponent | null {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    const found = fromFolder(parts[i]!, parts.slice(i + 1));
    if (found) return found;
  }
  return null;
}
