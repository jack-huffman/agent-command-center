/**
 * One document model for every ticket's rich text: GitHub's markdown, Jira's ADF and acc's own briefs
 * all become a Doc, and the ticket page draws a Doc with DOM calls only. Nothing from a ticket is ever
 * parsed as HTML (D-026). Comments typed in VSCode go back out as markdown, or as ADF for Jira.
 */
import { marked, type Token, type Tokens } from 'marked';

export type Mark = 'strong' | 'em' | 'code' | 'strike' | 'underline';

export type Inline =
  | { t: 'text'; text: string; marks?: Mark[]; href?: string }
  | { t: 'br' }
  | { t: 'mention'; text: string }
  | { t: 'image'; alt: string; href: string | null };

export interface ListItem {
  /** A task-list checkbox: true or false, or absent for an ordinary item. */
  checked?: boolean;
  c: Block[];
}

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'list'; ordered: boolean; start?: number; items: ListItem[] }
  | { t: 'code'; lang: string | null; text: string }
  | { t: 'quote'; c: Block[]; label?: string }
  | { t: 'hr' }
  | { t: 'table'; head: Inline[][] | null; rows: Inline[][][] }
  /** An attachment, image or embed the page doesn't load, shown as a labelled link. */
  | { t: 'media'; label: string; href: string | null };

export interface Doc {
  blocks: Block[];
}

export const emptyDoc = (): Doc => ({ blocks: [] });

/** Only web links are kept: a ticket can't hand the page a javascript: or file: URL. */
export const safeHref = (href: string | null | undefined): string | null => (href && /^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : null);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (s: string): string => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
  if (ENTITIES[e.toLowerCase()]) return ENTITIES[e.toLowerCase()]!;
  if (e[0] === '#') {
    const n = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
  }
  return m;
});

// ---------------------------------------------------------------- markdown → Doc

export interface MarkdownOptions {
  /** Turns `#12` into a link, for GitHub's issue references. */
  issueUrl?: (n: number) => string;
  /** Turns `@name` into a link, for GitHub's mentions. */
  userUrl?: (login: string) => string;
}

/** Inline HTML that has a plain meaning; any other tag is dropped and its text kept. */
const HTML_MARKS: Record<string, Mark> = { b: 'strong', strong: 'strong', i: 'em', em: 'em', code: 'code', kbd: 'code', s: 'strike', del: 'strike', strike: 'strike', u: 'underline', ins: 'underline' };

function inlines(tokens: Token[] | undefined, opts: MarkdownOptions, marks: Mark[] = [], href?: string): Inline[] {
  const out: Inline[] = [];
  const stack = [...marks];
  const text = (s: string) => {
    if (!s) return;
    if (href || !(opts.issueUrl || opts.userUrl)) {
      out.push({ t: 'text', text: decode(s), ...(stack.length ? { marks: [...stack] } : {}), ...(href ? { href } : {}) });
      return;
    }
    // GitHub references: #12 and @someone become links.
    let last = 0;
    for (const m of s.matchAll(/(^|[\s(])(#(\d+)|@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})))(?=$|[\s.,;:!?)])/g)) {
      const start = m.index! + m[1]!.length;
      const url = m[3] && opts.issueUrl ? opts.issueUrl(Number(m[3])) : m[4] && opts.userUrl ? opts.userUrl(m[4]) : null;
      if (!url) continue;
      if (start > last) out.push({ t: 'text', text: decode(s.slice(last, start)), ...(stack.length ? { marks: [...stack] } : {}) });
      out.push({ t: 'text', text: m[2]!, href: url, ...(stack.length ? { marks: [...stack] } : {}) });
      last = start + m[2]!.length;
    }
    if (last < s.length) out.push({ t: 'text', text: decode(s.slice(last)), ...(stack.length ? { marks: [...stack] } : {}) });
  };
  for (const tok of tokens ?? []) {
    switch (tok.type) {
      case 'text': if ('tokens' in tok && tok.tokens?.length) out.push(...inlines(tok.tokens, opts, stack, href)); else text(tok.text); break;
      case 'escape': text(tok.text); break;
      case 'strong': out.push(...inlines(tok.tokens, opts, [...stack, 'strong'], href)); break;
      case 'em': out.push(...inlines(tok.tokens, opts, [...stack, 'em'], href)); break;
      case 'del': out.push(...inlines(tok.tokens, opts, [...stack, 'strike'], href)); break;
      case 'codespan': out.push({ t: 'text', text: decode(tok.text), marks: [...stack, 'code'], ...(href ? { href } : {}) }); break;
      case 'br': out.push({ t: 'br' }); break;
      case 'link': {
        const safe = safeHref(tok.href);
        out.push(...inlines(tok.tokens, opts, stack, safe ?? undefined));
        break;
      }
      case 'image': out.push({ t: 'image', alt: tok.text || 'image', href: safeHref(tok.href) }); break;
      case 'html': {
        const m = /^<\s*(\/)?\s*([a-z0-9]+)[^>]*?(\/)?\s*>$/i.exec(tok.text.trim());
        if (!m) break; // comments and anything unusual: dropped
        const [, closing, tag] = m;
        const name = tag!.toLowerCase();
        if (name === 'br') { out.push({ t: 'br' }); break; }
        const mark = HTML_MARKS[name];
        if (!mark) break;
        if (closing) { const i = stack.lastIndexOf(mark); if (i >= 0) stack.splice(i, 1); } else stack.push(mark);
        break;
      }
      default: if ('text' in tok && typeof tok.text === 'string') text(tok.text);
    }
  }
  return out;
}

function blocks(tokens: Token[], opts: MarkdownOptions): Block[] {
  const out: Block[] = [];
  for (const tok of tokens) {
    switch (tok.type) {
      case 'space': break;
      case 'heading': out.push({ t: 'h', level: Math.min(6, Math.max(1, tok.depth)), c: inlines(tok.tokens, opts) }); break;
      case 'paragraph': {
        // A paragraph that's only an image becomes a media block, so the page can lay it out on its own.
        const c = inlines(tok.tokens, opts);
        if (c.length === 1 && c[0]!.t === 'image') out.push({ t: 'media', label: c[0]!.alt, href: c[0]!.href });
        else out.push({ t: 'p', c });
        break;
      }
      case 'text': out.push({ t: 'p', c: 'tokens' in tok && tok.tokens ? inlines(tok.tokens, opts) : inlines([tok], opts) }); break;
      case 'code': out.push({ t: 'code', lang: tok.lang ? String(tok.lang).split(/\s/)[0]! : null, text: tok.text }); break;
      case 'blockquote': out.push({ t: 'quote', c: blocks(tok.tokens ?? [], opts) }); break;
      case 'hr': out.push({ t: 'hr' }); break;
      case 'list': {
        const list = tok as Tokens.List;
        out.push({
          t: 'list', ordered: list.ordered, ...(list.ordered && typeof list.start === 'number' && list.start !== 1 ? { start: list.start } : {}),
          items: list.items.map((item) => ({
            ...(item.task ? { checked: !!item.checked } : {}),
            c: blocks((item.tokens ?? []).filter((t) => t.type !== 'checkbox'), opts),
          })),
        });
        break;
      }
      case 'table': {
        const table = tok as Tokens.Table;
        out.push({ t: 'table', head: table.header.map((h) => inlines(h.tokens, opts)), rows: table.rows.map((r) => r.map((cell) => inlines(cell.tokens, opts))) });
        break;
      }
      case 'html': {
        // Block HTML (details, comments, divs): keep its words, never its markup.
        const words = decode(tok.text.replace(/<!--[\s\S]*?-->/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).trim();
        if (words) out.push({ t: 'p', c: [{ t: 'text', text: words }] });
        break;
      }
      default: if ('text' in tok && typeof tok.text === 'string' && tok.text.trim()) out.push({ t: 'p', c: [{ t: 'text', text: tok.text }] });
    }
  }
  return out;
}

export function fromMarkdown(md: string | null | undefined, opts: MarkdownOptions = {}): Doc {
  if (!md?.trim()) return emptyDoc();
  return { blocks: blocks(marked.lexer(md.replace(/\r\n/g, '\n'), { gfm: true }), opts) };
}

// ---------------------------------------------------------------- Jira's ADF → Doc

export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: AdfNode[];
}

const ADF_MARKS: Record<string, Mark> = { strong: 'strong', em: 'em', code: 'code', strike: 'strike', underline: 'underline' };
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function adfInlines(nodes: AdfNode[] | undefined): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes ?? []) {
    switch (n.type) {
      case 'text': {
        const marks = (n.marks ?? []).map((m) => ADF_MARKS[m.type]).filter((m): m is Mark => !!m);
        const link = n.marks?.find((m) => m.type === 'link');
        const href = safeHref(str(link?.attrs?.href));
        out.push({ t: 'text', text: n.text ?? '', ...(marks.length ? { marks } : {}), ...(href ? { href } : {}) });
        break;
      }
      case 'hardBreak': out.push({ t: 'br' }); break;
      case 'mention': out.push({ t: 'mention', text: str(n.attrs?.text).replace(/^@?/, '@') || '@someone' }); break;
      case 'emoji': out.push({ t: 'text', text: str(n.attrs?.text) || str(n.attrs?.shortName) }); break;
      case 'inlineCard': {
        const url = safeHref(str(n.attrs?.url));
        if (url) out.push({ t: 'text', text: url, href: url });
        break;
      }
      case 'status': out.push({ t: 'text', text: str(n.attrs?.text).toUpperCase(), marks: ['code'] }); break;
      case 'date': {
        const ms = Number(n.attrs?.timestamp);
        out.push({ t: 'text', text: Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '' });
        break;
      }
      default: if (n.content) out.push(...adfInlines(n.content)); else if (n.text) out.push({ t: 'text', text: n.text });
    }
  }
  return out;
}

const PANEL_LABELS: Record<string, string> = { info: 'Info', note: 'Note', warning: 'Warning', error: 'Error', success: 'Success', tip: 'Tip' };

function adfBlocks(nodes: AdfNode[] | undefined): Block[] {
  const out: Block[] = [];
  for (const n of nodes ?? []) {
    switch (n.type) {
      case 'paragraph': out.push({ t: 'p', c: adfInlines(n.content) }); break;
      case 'heading': out.push({ t: 'h', level: Math.min(6, Math.max(1, Number(n.attrs?.level) || 2)), c: adfInlines(n.content) }); break;
      case 'bulletList':
      case 'orderedList': {
        const start = Number(n.attrs?.order);
        out.push({ t: 'list', ordered: n.type === 'orderedList', ...(n.type === 'orderedList' && start > 1 ? { start } : {}), items: (n.content ?? []).map((li) => ({ c: adfBlocks(li.content) })) });
        break;
      }
      case 'taskList': out.push({ t: 'list', ordered: false, items: (n.content ?? []).map((ti) => ({ checked: ti.attrs?.state === 'DONE', c: [{ t: 'p', c: adfInlines(ti.content) }] })) }); break;
      case 'codeBlock': out.push({ t: 'code', lang: str(n.attrs?.language) || null, text: (n.content ?? []).map((c) => c.text ?? '').join('') }); break;
      case 'blockquote': out.push({ t: 'quote', c: adfBlocks(n.content) }); break;
      case 'panel': out.push({ t: 'quote', c: adfBlocks(n.content), label: PANEL_LABELS[str(n.attrs?.panelType)] ?? 'Note' }); break;
      case 'rule': out.push({ t: 'hr' }); break;
      case 'expand':
      case 'nestedExpand':
        out.push({ t: 'quote', c: adfBlocks(n.content), label: str(n.attrs?.title) || 'Details' });
        break;
      case 'table': {
        const rows = (n.content ?? []).filter((r) => r.type === 'tableRow');
        // A cell is drawn as one line of text: its paragraphs, with a break between them.
        const cells = (r: AdfNode) => (r.content ?? []).map((c) => adfBlocks(c.content).flatMap((b, i): Inline[] => {
          const words = b.t === 'p' || b.t === 'h' ? b.c : [];
          return i ? [{ t: 'br' }, ...words] : words;
        }));
        const headed = rows[0]?.content?.every((c) => c.type === 'tableHeader') ?? false;
        out.push({ t: 'table', head: headed ? cells(rows[0]!) : null, rows: (headed ? rows.slice(1) : rows).map(cells) });
        break;
      }
      case 'mediaSingle':
      case 'mediaGroup':
        for (const m of n.content ?? []) out.push({ t: 'media', label: str(m.attrs?.alt) || str(m.attrs?.__fileName) || 'Attachment', href: null });
        break;
      case 'blockCard':
      case 'embedCard': {
        const url = safeHref(str(n.attrs?.url));
        out.push({ t: 'media', label: url ?? 'Linked page', href: url });
        break;
      }
      default: if (n.content) out.push(...adfBlocks(n.content));
    }
  }
  return out;
}

export function fromAdf(adf: AdfNode | null | undefined): Doc {
  if (!adf || typeof adf !== 'object') return emptyDoc();
  return { blocks: adfBlocks(adf.type === 'doc' ? adf.content : [adf]) };
}

// ---------------------------------------------------------------- Doc → ADF, for comments sent to Jira

function toAdfInlines(c: Inline[]): AdfNode[] {
  return c.flatMap((i): AdfNode[] => {
    if (i.t === 'br') return [{ type: 'hardBreak' }];
    if (i.t === 'mention') return [{ type: 'text', text: i.text }];
    if (i.t === 'image') return i.href ? [{ type: 'text', text: i.alt, marks: [{ type: 'link', attrs: { href: i.href } }] }] : [{ type: 'text', text: i.alt }];
    if (!i.text) return [];
    // ADF allows code only on its own, with no other marks.
    const marks = i.marks?.includes('code') ? [{ type: 'code' }] : (i.marks ?? []).map((m) => ({ type: m }));
    if (i.href && !i.marks?.includes('code')) marks.push({ type: 'link', attrs: { href: i.href } } as never);
    return [{ type: 'text', text: i.text, ...(marks.length ? { marks } : {}) }];
  });
}

function toAdfBlocks(bs: Block[]): AdfNode[] {
  return bs.map((b): AdfNode => {
    switch (b.t) {
      case 'p': return { type: 'paragraph', content: toAdfInlines(b.c) };
      case 'h': return { type: 'heading', attrs: { level: b.level }, content: toAdfInlines(b.c) };
      case 'list': return {
        type: b.ordered ? 'orderedList' : 'bulletList', ...(b.ordered ? { attrs: { order: b.start ?? 1 } } : {}),
        content: b.items.map((it) => ({ type: 'listItem', content: toAdfBlocks(it.c.length ? it.c : [{ t: 'p', c: [] }]) })),
      };
      case 'code': return { type: 'codeBlock', ...(b.lang ? { attrs: { language: b.lang } } : {}), content: b.text ? [{ type: 'text', text: b.text }] : [] };
      case 'quote': return { type: 'blockquote', content: toAdfBlocks(b.c) };
      case 'hr': return { type: 'rule' };
      case 'table': return {
        type: 'table',
        content: [
          ...(b.head ? [{ type: 'tableRow', content: b.head.map((c) => ({ type: 'tableHeader', content: [{ type: 'paragraph', content: toAdfInlines(c) }] })) }] : []),
          ...b.rows.map((r) => ({ type: 'tableRow', content: r.map((c) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: toAdfInlines(c) }] })) })),
        ],
      };
      case 'media': return { type: 'paragraph', content: toAdfInlines([b.href ? { t: 'text', text: b.label, href: b.href } : { t: 'text', text: b.label }]) };
    }
  });
}

export function toAdf(doc: Doc): AdfNode {
  return { type: 'doc', version: 1, content: toAdfBlocks(doc.blocks) } as AdfNode;
}

// ---------------------------------------------------------------- plain text

const inlineText = (c: Inline[]): string => c.map((i) => (i.t === 'br' ? '\n' : i.t === 'image' ? i.alt : i.text)).join('');

/** The words of a document, for previews and search. */
export function plainText(doc: Doc): string {
  const walk = (bs: Block[]): string[] => bs.flatMap((b) => {
    switch (b.t) {
      case 'p': case 'h': return [inlineText(b.c)];
      case 'list': return b.items.flatMap((it) => walk(it.c));
      case 'code': return [b.text];
      case 'quote': return walk(b.c);
      case 'table': return [...(b.head ? [b.head.map(inlineText).join(' ')] : []), ...b.rows.map((r) => r.map(inlineText).join(' '))];
      case 'media': return [b.label];
      case 'hr': return [];
    }
  });
  return walk(doc.blocks).join('\n').trim();
}

// ---------------------------------------------------------------- Doc → markdown, for builders' briefs

function mdInlines(c: Inline[]): string {
  return c.map((i) => {
    if (i.t === 'br') return '  \n';
    if (i.t === 'mention') return i.text;
    if (i.t === 'image') return i.href ? `![${i.alt}](${i.href})` : i.alt;
    let s = i.marks?.includes('code') ? `\`${i.text}\`` : i.text;
    for (const m of i.marks ?? []) {
      if (m === 'strong') s = `**${s}**`;
      else if (m === 'em') s = `_${s}_`;
      else if (m === 'strike') s = `~~${s}~~`;
    }
    return i.href && i.href !== i.text ? `[${s}](${i.href})` : s;
  }).join('');
}

function mdBlocks(bs: Block[], indent = ''): string[] {
  return bs.flatMap((b): string[] => {
    switch (b.t) {
      case 'p': return [indent + mdInlines(b.c), ''];
      case 'h': return [`${indent}${'#'.repeat(b.level)} ${mdInlines(b.c)}`, ''];
      case 'list': return [...b.items.flatMap((it, n) => {
        const bullet = b.ordered ? `${(b.start ?? 1) + n}.` : '-';
        const box = it.checked === undefined ? '' : it.checked ? '[x] ' : '[ ] ';
        const [first, ...rest] = mdBlocks(it.c, `${indent}  `).filter((l, i, all) => l !== '' || (i > 0 && i < all.length - 1));
        return [`${indent}${bullet} ${box}${(first ?? '').trimStart()}`, ...rest];
      }), ''];
      case 'code': return [`${indent}\`\`\`${b.lang ?? ''}`, ...b.text.split('\n').map((l) => indent + l), `${indent}\`\`\``, ''];
      case 'quote': {
        const inner = mdBlocks(b.label ? [{ t: 'p', c: [{ t: 'text', text: b.label, marks: ['strong'] }] }, ...b.c] : b.c);
        while (inner.at(-1) === '') inner.pop();
        return [...inner.map((l) => `${indent}> ${l}`.trimEnd()), ''];
      }
      case 'hr': return [`${indent}---`, ''];
      case 'table': {
        const row = (cells: Inline[][]) => `${indent}| ${cells.map((c) => mdInlines(c).replace(/\|/g, '\\|')).join(' | ')} |`;
        const width = b.head?.length ?? b.rows[0]?.length ?? 0;
        return [row(b.head ?? Array.from({ length: width }, () => [])), `${indent}|${' --- |'.repeat(width)}`, ...b.rows.map(row), ''];
      }
      case 'media': return [indent + (b.href ? `[${b.label}](${b.href})` : `_${b.label} (attachment)_`), ''];
    }
  });
}

/** A document as markdown: how a Jira ticket's description reaches a builder's brief. */
export function toMarkdown(doc: Doc): string {
  return mdBlocks(doc.blocks).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
