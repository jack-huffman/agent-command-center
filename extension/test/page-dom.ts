// A small document for the page's modules to run in under Node (T-71): elements that take children,
// attributes, classes, listeners and focus, and the VSCode API the page posts its messages to. It is no
// browser: what a browser does with layout, keys and dialogs is the behaviour run's (scripts/behaviour.ts).

/** An element: its tag, attributes, children and listeners; focus() makes it the document's active element. */
export class PageElement {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly children: (PageElement | string)[] = [];
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, ((e: unknown) => void)[]>();
  className = '';
  type = '';
  title = '';
  disabled = false;
  private readonly doc: PageDocument;
  constructor(tag: string, doc: PageDocument) {
    this.tagName = tag.toUpperCase();
    this.doc = doc;
  }
  append(...nodes: (PageElement | string)[]): void { this.children.push(...nodes); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  addEventListener(type: string, f: (e: unknown) => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]); }
  /** Runs its listeners for a click, as a person's click does. */
  click(): void { if (!this.disabled) for (const f of this.listeners.get('click') ?? []) f({ type: 'click' }); }
  focus(): void { this.doc.activeElement = this; }
  get textContent(): string { return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
}

export class PageDocument {
  readonly body: PageElement = new PageElement('body', this);
  /** What has focus: the body, as a browser's page starts. */
  activeElement: PageElement = this.body;
  createElement(tag: string): PageElement { return new PageElement(tag, this); }
  createTextNode(text: string): string { return text; }
  getElementById(): PageElement { return this.createElement('main'); }
}

/** The document the page runs in, and the messages it sent the extension. */
export interface Page { document: PageDocument; sent: unknown[] }

/**
 * Sets up the document and the VSCode API as globals, as the webview has them, before the page's modules are
 * imported: state.ts reads both as it loads. Import the page's modules after this, with `await import(…)`.
 */
export function pageDom(): Page {
  const page: Page = { document: new PageDocument(), sent: [] };
  const g = globalThis as Record<string, unknown>;
  g.document = page.document;
  g.acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => undefined, setState: () => {} });
  return page;
}
