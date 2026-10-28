// A small document for the page's modules to run in under Node (T-71): elements that take children,
// attributes, classes, listeners and focus, and the VSCode API the page posts its messages to. It is no
// browser: what a browser does with layout, keys and dialogs is the behaviour run's (scripts/behaviour.ts).

/** An element's inline style (T-91): the custom properties the page sets on it, such as a chip's --tint-colour. */
export class PageStyle {
  readonly properties = new Map<string, string>();
  setProperty(name: string, value: string): void { this.properties.set(name, value); }
  getPropertyValue(name: string): string { return this.properties.get(name) ?? ''; }
}

/** An element: its tag, attributes, children and listeners; focus() makes it the document's active element. */
export class PageElement {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly children: (PageElement | string)[] = [];
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, ((e: unknown) => void)[]>();
  readonly style = new PageStyle();
  className = '';
  type = '';
  title = '';
  disabled = false;
  hidden = false;
  tabIndex = -1;
  /** Its classes, read from and written to className, as a browser's classList is. */
  readonly classList = {
    add: (...c: string[]): void => { this.className = [...new Set([...this.classes(), ...c])].join(' '); },
    remove: (...c: string[]): void => { this.className = this.classes().filter((x) => !c.includes(x)).join(' '); },
    contains: (c: string): boolean => this.classes().includes(c),
    toggle: (c: string, on?: boolean): boolean => { const want = on ?? !this.classes().includes(c); if (want) this.classList.add(c); else this.classList.remove(c); return want; },
  };
  private readonly doc: PageDocument;
  constructor(tag: string, doc: PageDocument) {
    this.tagName = tag.toUpperCase();
    this.doc = doc;
  }
  append(...nodes: (PageElement | string)[]): void { this.children.push(...nodes); }
  replaceChildren(...nodes: (PageElement | string)[]): void { this.children.splice(0, this.children.length, ...nodes); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  addEventListener(type: string, f: (e: unknown) => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]); }
  /** Runs its listeners for a click, as a person's click does: a button's stops it going further. */
  click(): void { if (!this.disabled) for (const f of this.listeners.get('click') ?? []) f({ type: 'click', stopPropagation: () => undefined }); }
  focus(): void { this.doc.activeElement = this; }
  get textContent(): string { return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  get childElementCount(): number { return this.children.filter((c) => typeof c !== 'string').length; }
  private classes(): string[] { return this.className.split(/\s+/).filter(Boolean); }
  /** Every element under it, depth first, as a selector of one class would find them. */
  all(cls?: string): PageElement[] {
    const under = this.children.flatMap((c) => (typeof c === 'string' ? [] : [c, ...c.all()]));
    return cls ? under.filter((e) => e.classList.contains(cls)) : under;
  }
  /** The first element under it a selector finds: one class, written as .name, or what querySelectorAll finds (T-132). */
  querySelector(selector: string): PageElement | null { return /^\.[\w-]+$/.test(selector) ? this.all(selector.slice(1))[0] ?? null : this.querySelectorAll(selector)[0] ?? null; }
  /**
   * The elements under it a simple selector finds (T-127): a list of them split by commas, each a tag and classes
   * (article.card, .a.b), one under another (.a .b), or its own children (:scope > .column). No more than the board asks.
   */
  querySelectorAll(selector: string): PageElement[] {
    const matches = (e: PageElement, compound: string): boolean => {
      const [tag, ...classes] = compound.split('.');
      return (!tag || e.tagName === tag.toUpperCase()) && classes.every((c) => e.classList.contains(c));
    };
    const found = selector.split(',').flatMap((part) => {
      const own = part.trim().startsWith(':scope >');
      const steps = part.trim().replace(/^:scope >\s*/, '').split(/\s+/);
      let at: PageElement[] = [this];
      steps.forEach((step, i) => {
        at = at.flatMap((x) => (own && i === 0 ? x.children.filter((c): c is PageElement => typeof c !== 'string') : x.all())).filter((e) => matches(e, step));
      });
      return at;
    });
    return [...new Set(found)];
  }
}

export class PageDocument {
  readonly body: PageElement = new PageElement('body', this);
  /** What has focus: the body, as a browser's page starts. */
  activeElement: PageElement = this.body;
  createElement(tag: string): PageElement { return new PageElement(tag, this); }
  createTextNode(text: string): string { return text; }
  /** The elements a simple selector finds under the body (T-127), as an element's querySelectorAll does. */
  querySelectorAll(selector: string): PageElement[] { return this.body.querySelectorAll(selector); }
  /** Listeners the page sets on the document as it loads, such as the ⋯ menus' close on a click elsewhere. */
  readonly listeners = new Map<string, ((e: unknown) => void)[]>();
  addEventListener(type: string, f: (e: unknown) => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]); }
  private readonly byId = new Map<string, PageElement>();
  /** One element per id, made on first ask, so a module that looks an id up twice gets the same one. */
  getElementById(id: string): PageElement {
    let e = this.byId.get(id);
    if (!e) { e = this.createElement('main'); this.byId.set(id, e); }
    return e;
  }
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
  // A fold checks after a frame whether it needs its toggle (dom.ts's foldable); here no frame comes.
  g.requestAnimationFrame ??= () => 0;
  return page;
}
