// A plain line with markdown's inline marks in it, as an analysis or a builder's note writes them:
// `code` and **bold**. The page can't bundle core's parser, so this reads just those two, and
// extension/test/inline.test.ts checks it against core's fromMarkdown, which reads them the same way.

import type { Inline, Mark } from '../../packages/core/src/trackers/doc.ts';

// A code span closes on a run of as many backticks as opened it. Bold opens after a space or bracket
// and closes before one, so a glob such as force-app/**/lwc/** stays as written.
const MARKS = /(`+)(?!`)([\s\S]*?[^`])\1(?!`)|(^|[\s(\[])\*\*(?=\S)([\s\S]*?\S)\*\*(?=$|[\s.,;:!?)\]])/g;

export function inlineMarks(s: string, marks: Mark[] = []): Inline[] {
  const out: Inline[] = [];
  const text = (t: string, m: Mark[]) => {
    if (!t) return;
    const prev = out[out.length - 1];
    const same = prev?.t === 'text' && (prev.marks ?? []).join() === m.join();
    if (same && prev.t === 'text') prev.text += t;
    else out.push({ t: 'text', text: t, ...(m.length ? { marks: [...m] } : {}) });
  };
  let last = 0;
  for (const x of s.matchAll(MARKS)) {
    const [whole, , code, lead, bold] = x;
    const start = x.index! + (lead?.length ?? 0);
    text(s.slice(last, start), marks);
    if (code !== undefined) {
      // One space each side is padding, as in `` `x` ``, unless the span is only spaces.
      const inner = /^ [\s\S]* $/.test(code) && code.trim() ? code.slice(1, -1) : code;
      out.push({ t: 'text', text: inner, marks: [...new Set<Mark>([...marks, 'code'])] });
    } else {
      for (const i of inlineMarks(bold!, [...marks, 'strong'])) {
        if (i.t === 'text' && !(i.marks ?? []).includes('code')) text(i.text, i.marks ?? []);
        else out.push(i);
      }
    }
    last = x.index! + whole.length;
  }
  text(s.slice(last), marks);
  return out;
}
