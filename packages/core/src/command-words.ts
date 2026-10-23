/**
 * A shell command line read as its commands and words (T-88), as far as the builder's rules need: the
 * builder's hook, the records hook and the config's own check of a command gate (D-T-115) all read a line
 * the same way. The cloud guard's rawCommandsOf splits the same way (GH-69), and cloud-guard.test.ts keeps
 * the two the same.
 */

/** What a `$( )` or backtick pair leaves in the word it stood in. */
export const SUBSTITUTED = '$(...)';

/** What a backslash escapes inside bash's $'…' (T-88): the characters it names, besides \nnn, \xHH, \uHHHH, \UHHHHHHHH and \cX. */
const ANSI_C: Record<string, string> = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };

/**
 * Reads bash's $'…' quoting from just after its opening quote (T-88), as bash does: each backslash escape
 * decoded, so $'\x2d-upload-pack=sh' is --upload-pack=sh, the word git would see. `add` takes each
 * character. Returns the index of the closing quote, or the line's end when it never closes. The cloud
 * guard's rawCommandsOf has the same, and cloud-guard.test.ts keeps the two the same.
 */
function ansiC(line: string, from: number, add: (c: string) => void): number {
  let i = from;
  while (i < line.length && line[i] !== "'") {
    const c = line[i]!;
    if (c !== '\\' || i + 1 >= line.length) { add(c); i++; continue; }
    const e = line[i + 1]!;
    let m: RegExpExecArray | null;
    if (ANSI_C[e] !== undefined) { add(ANSI_C[e]); i += 2; }
    else if ((m = /^[0-7]{1,3}/.exec(line.slice(i + 1, i + 4)))) { add(String.fromCharCode(parseInt(m[0], 8) & 0xff)); i += 1 + m[0].length; }
    else if (e === 'x' && (m = /^[0-9a-fA-F]{1,2}/.exec(line.slice(i + 2, i + 4)))) { add(String.fromCharCode(parseInt(m[0], 16))); i += 2 + m[0].length; }
    else if (e === 'u' && (m = /^[0-9a-fA-F]{1,4}/.exec(line.slice(i + 2, i + 6)))) { add(String.fromCodePoint(parseInt(m[0], 16))); i += 2 + m[0].length; }
    else if (e === 'U' && (m = /^[0-9a-fA-F]{1,8}/.exec(line.slice(i + 2, i + 10)))) { add(String.fromCodePoint(Math.min(parseInt(m[0], 16), 0x10ffff))); i += 2 + m[0].length; }
    else if (e === 'c' && i + 2 < line.length) { add(String.fromCharCode(line.charCodeAt(i + 2) & 0x1f)); i += 3; }
    // A backslash before anything else stays, as bash keeps it.
    else { add(c); i++; }
  }
  return i;
}

/**
 * A command line split into its commands, and each into words, as far as matters for these rules: quotes
 * kept together, separators cut, a `$( )` or backtick read as its own command even inside double quotes
 * (only single quotes are literal), a heredoc's body skipped, bash's `$'…'` read with its escapes decoded
 * (T-88). The command around a substitution stays whole, with SUBSTITUTED where the substitution stood;
 * the substitution's own commands come first. The cloud guard's rawCommandsOf splits the same way (GH-69),
 * and cloud-guard.test.ts keeps the two the same.
 */
export function commandsOf(line: string): string[][] {
  const out: string[][] = [];
  let words: string[] = [];
  let word = '';
  let quote: '"' | "'" | null = null;
  let any = false;
  // What to go back to when a `$( )` or a backtick pair closes: the command it opened in, its word so far
  // with SUBSTITUTED added, and the quote it opened inside, if any. A `(` alone opens a group, which cuts.
  const stack: ({ group: true } | { group: false; back: '"' | null; tick: boolean; words: string[]; word: string })[] = [];
  // Heredoc terminators still to skip, in order; a `<<` alone takes the next word as its terminator.
  const heredocs: string[] = [];
  let delimiterNext = false;
  const end = () => {
    if (any) {
      if (delimiterNext) { heredocs.push(word.replace(/^['"]|['"]$/g, '')); delimiterNext = false; }
      else if (word === '<<' || word === '<<-') delimiterNext = true;
      else if (/^<<-?./.test(word)) heredocs.push(word.replace(/^<<-?/, '').replace(/^['"]|['"]$/g, ''));
      words.push(word);
    }
    word = '';
    any = false;
  };
  const next = () => { end(); if (words.length) out.push(words); words = []; };
  const open = (back: '"' | null, tick: boolean) => { stack.push({ group: false, back, tick, words, word: word + SUBSTITUTED }); words = []; word = ''; any = false; quote = null; };
  const close = (top: { back: '"' | null; words: string[]; word: string }) => { next(); words = top.words; word = top.word; any = true; quote = top.back; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote === "'") {
      if (c === "'") quote = null;
      else { word += c; any = true; }
      continue;
    }
    if (quote === '"') {
      if (c === '"') { quote = null; continue; }
      if (c === '\\' && i + 1 < line.length) { word += line[++i]; any = true; continue; }
      if (c === '`') { open('"', true); continue; }
      if (c === '$' && line[i + 1] === '(') { open('"', false); i++; continue; }
      word += c;
      any = true;
      continue;
    }
    // bash's $'…' (T-88): its escapes decoded into the word; $"…" is "…" for the shell's locale.
    if (c === '$' && line[i + 1] === "'") { i = ansiC(line, i + 2, (ch) => { word += ch; }); any = true; continue; }
    if (c === '$' && line[i + 1] === '"') { quote = '"'; any = true; i++; continue; }
    if (c === '"' || c === "'") { quote = c; any = true; continue; }
    if (c === '\\' && i + 1 < line.length) { word += line[++i]; any = true; continue; }
    if (c === '`') {
      const top = stack[stack.length - 1];
      if (top && !top.group && top.tick) { stack.pop(); close(top); }
      else open(null, true);
      continue;
    }
    if (c === '$' && line[i + 1] === '(') { open(null, false); i++; continue; }
    if (c === '(') { next(); stack.push({ group: true }); continue; }
    if (c === ')') {
      const top = stack.pop();
      if (top && !top.group) close(top);
      else next();
      continue;
    }
    if (c === '\n') {
      next();
      // A heredoc's body is the command's input, not commands: skip to its terminator line.
      while (heredocs.length && i < line.length) {
        const term = heredocs.shift();
        let j = i + 1;
        for (;;) {
          const nl = line.indexOf('\n', j);
          const l = nl < 0 ? line.slice(j) : line.slice(j, nl);
          if (l.replace(/^\t+/, '') === term || nl < 0) { i = nl < 0 ? line.length : nl; break; }
          j = nl + 1;
        }
      }
      continue;
    }
    if (/\s/.test(c)) { end(); continue; }
    if (c === ';' || c === '|' || c === '&') { next(); continue; }
    word += c;
    any = true;
  }
  // A substitution left open at the end still leaves its command whole: the shell would refuse the line.
  for (let top = stack.pop(); top; top = stack.pop()) if (!top.group) close(top);
  next();
  // Leading environment assignments and wrappers don't change what runs.
  return out.map((w) => {
    let i = 0;
    while (i < w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i]!) || ['nice', 'env', 'time', 'command', 'npx', 'sudo'].includes(w[i]!) || (w[i - 1] === 'nice' && /^-n$|^-\d+$/.test(w[i]!)) || (w[i - 2] === 'nice' && w[i - 1] === '-n'))) i++;
    return w.slice(i);
  }).filter((w) => w.length);
}

/**
 * Whether a command line has a backtick or a $ the shell would act on: anywhere outside single quotes,
 * unless a backslash escapes it. In a note, it would run or expand before acc saw the words (D-106).
 */
export function expands(line: string): boolean {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote === "'") { if (c === "'") quote = null; continue; }
    if (c === '\\') { i++; continue; }
    if (c === '`' || c === '$') return true;
    if (c === '"') quote = quote ? null : '"';
    else if (c === "'" && !quote) quote = "'";
  }
  return false;
}
