// packages/cli/src/main.ts
import { realpathSync as realpathSync8 } from "node:fs";
import { resolve as resolve5 } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

// packages/core/src/agents.ts
import { readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";

// packages/core/src/exec.ts
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
var within = (ms) => ms % 6e4 === 0 ? `${ms / 6e4} minute${ms === 6e4 ? "" : "s"}` : `${ms / 1e3} seconds`;
var ghEnv = (env = process.env) => ({ ...env, GH_NO_UPDATE_NOTIFIER: "1", GH_PROMPT_DISABLED: "1" });
var isGh = (cmd) => basename(cmd) === "gh";
var run = (cmd, args, opts = {}) => {
  const gh = isGh(cmd);
  const timeout = opts.timeoutMs ?? 12e4;
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: gh ? ghEnv(opts.env) : opts.env ?? process.env,
    input: opts.input,
    encoding: "utf8",
    timeout,
    // At the timeout node signals the process, then waits for it to exit. A gh that catches SIGTERM would
    // outlive its timeout, and gh has nothing to tidy, so it gets SIGKILL. Others keep SIGTERM: git
    // removes its lock files on it (D-051).
    killSignal: gh ? "SIGKILL" : "SIGTERM",
    maxBuffer: 64 * 1024 * 1024
  });
  if (r.error?.code === "ETIMEDOUT") {
    return { code: 127, stdout: "", stderr: `${basename(cmd)} didn't finish within ${within(timeout)}, so acc stopped it.`, timedOut: true };
  }
  if (r.error) return { code: 127, stdout: "", stderr: r.error.message };
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
var AccError = class extends Error {
  code;
  constructor(code2, message2) {
    super(message2);
    this.code = code2;
    this.name = "AccError";
  }
};
var sfEnv = (env = process.env) => ({
  ...env,
  NO_COLOR: "1",
  FORCE_COLOR: "0",
  SF_NO_UPDATE_NOTIFIER: "true",
  SF_SKIP_NEW_VERSION_CHECK: "true",
  SF_DISABLE_TELEMETRY: "true"
});
function parseJsonOutput(text) {
  const plain = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  try {
    return JSON.parse(plain);
  } catch {
    const start = plain.search(/^[{[]/m);
    if (start < 0) throw new SyntaxError("No JSON in the output.");
    return JSON.parse(plain.slice(start));
  }
}

// packages/core/src/text.ts
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var firstSaid = (r) => (r.stderr || r.stdout).trim().split("\n")[0]?.trim() || `exit ${r.code}`;
var sentence = (text) => text.trim().replace(/([^.!?])$/, "$1.");
var clip = (s, max) => s.length > max ? `${s.slice(0, max - 1).trimEnd()}\u2026` : s;
var plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
var escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// packages/core/src/config.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// node_modules/marked/lib/marked.esm.js
function I() {
  return { async: false, breaks: false, extensions: null, gfm: true, hooks: null, pedantic: false, renderer: null, silent: false, tokenizer: null, walkTokens: null };
}
var y = I();
function W(l3) {
  y = l3;
}
var A = { exec: () => null };
function C(l3) {
  let e = [];
  return (t) => {
    let n = Math.max(0, Math.min(3, t - 1)), s = e[n];
    return s || (s = l3(n), e[n] = s), s;
  };
}
function h(l3, e = "") {
  let t = typeof l3 == "string" ? l3 : l3.source, n = { replace: (s, r) => {
    let o = typeof r == "string" ? r : r.source;
    return o = o.replace(x.caret, "$1"), t = t.replace(s, o), n;
  }, getRegex: () => new RegExp(t, e) };
  return n;
}
var _e = ((l3 = "") => {
  try {
    return !!new RegExp("(?<=1)(?<!1)" + l3);
  } catch {
    return false;
  }
})();
var x = { codeRemoveIndent: /^(?: {0,3}\t| {1,4})/gm, outputLinkReplace: /\\([\[\]])/g, indentCodeCompensation: /^(\s+)(?:```)/, beginningSpace: /^\s+/, endingHash: /#$/, startingSpaceChar: /^ /, endingSpaceChar: / $/, endingSpaceTabChar: /[ \t]$/, nonSpaceChar: /[^ ]/, newLineCharGlobal: /\n/g, tabCharGlobal: /\t/g, leadingSpaceTab: /^[ \t]+/, multipleSpaceGlobal: /\s+/g, blankLine: /^[ \t]*$/, doubleBlankLine: /\n[ \t]*\n[ \t]*$/, blockquoteStart: /^ {0,3}>/, blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g, blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm, listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g, listIsTask: /^\[[ xX]\] +\S/, listReplaceTask: /^\[[ xX]\] +/, listTaskCheckbox: /\[[ xX]\]/, anyLine: /\n.*\n/, hrefBrackets: /^<(.*)>$/, tableDelimiter: /[:|]/, tableAlignChars: /^\||\| *$/g, tableRowBlankLine: /\n[ \t]*$/, tableAlignRight: /^ *-+: *$/, tableAlignCenter: /^ *:-+: *$/, tableAlignLeft: /^ *:-+ *$/, startATag: /^<a /i, endATag: /^<\/a>/i, startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i, endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i, startAngleBracket: /^</, endAngleBracket: />$/, pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/, unicodeAlphaNumeric: /[\p{L}\p{N}]/u, numericCharacterReference: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/g, escapeTest: /[&<>"']/, escapeReplace: /[&<>"']/g, escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/, escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, caret: /(^|[^\[])\^/g, percentDecode: /%25/g, findPipe: /\|/g, splitPipe: / \|/, slashPipe: /\\\|/g, carriageReturn: /\r\n|\r/g, spaceLine: /^ +$/gm, notSpaceStart: /^\S*/, endingNewline: /\n$/, listItemRegex: (l3) => new RegExp(`^( {0,3}${l3})((?:[	 ][^\\n]*)?(?:\\n|$))`), nextBulletRegex: C((l3) => new RegExp(`^ {0,${l3}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)), hrRegex: C((l3) => new RegExp(`^ {0,${l3}}((?:-[ 	]*){3,}|(?:_[ 	]*){3,}|(?:\\*[ 	]*){3,})(?:\\n+|$)`)), fencesBeginRegex: C((l3) => new RegExp(`^ {0,${l3}}(?:\`\`\`|~~~)`)), headingBeginRegex: C((l3) => new RegExp(`^ {0,${l3}}#`)), htmlBeginRegex: C((l3) => new RegExp(`^ {0,${l3}}(?:</?(?:${N})(?: +|$|/?>)|<(?:script|pre|style|textarea|!--))`, "i")), blockquoteBeginRegex: C((l3) => new RegExp(`^ {0,${l3}}>`)) };
var $e = /^(?:[ \t]*(?:\n|$))+/;
var Le = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
var ze = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
var G = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
var Ae = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
var J = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
var ce = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/;
var he = h(ce).replace(/bull/g, J).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex();
var Ee = h(ce).replace(/bull/g, J).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex();
var V = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
var Me = /^[^\n]+/;
var Y = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/;
var Ie = h(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", Y).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
var Ce = h(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, J).getRegex();
var N = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
var ee = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
var Be = h("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", ee).replace("tag", N).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
var de = (l3) => h(V).replace("hr", G).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", l3).replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", N).getRegex();
var De = de(/ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/);
var qe = de(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/);
var ve = h(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", qe).getRegex();
var te = { blockquote: ve, code: Le, def: Ie, fences: ze, heading: Ae, hr: G, html: Be, lheading: he, list: Ce, newline: $e, paragraph: De, table: A, text: Me };
var le = h("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", G).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", N).getRegex();
var Ze = { ...te, lheading: Ee, table: le, paragraph: h(V).replace("hr", G).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", le).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", N).getRegex() };
var He = { ...te, html: h(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", ee).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(), def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/, heading: /^(#{1,6})(.*)(?:\n+|$)/, fences: A, lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/, paragraph: h(V).replace("hr", G).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", he).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex() };
var Ge = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
var Ne = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
var ke = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
var Qe = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
var $ = /[\p{P}\p{S}]/u;
var B = /[\s\p{P}\p{S}]/u;
var Q = /[^\s\p{P}\p{S}]/u;
var je = h(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, B).getRegex();
var Fe = /[\p{Pi}\p{Ps}"']/u;
var ge = /(?!~)[\p{P}\p{S}]/u;
var Ue = /(?!~)[\s\p{P}\p{S}]/u;
var Ke = /(?:[^\s\p{P}\p{S}]|~)/u;
var We = h(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", _e ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex();
var fe = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
var Xe = h(fe, "u").replace(/punct/g, $).getRegex();
var Je = h(fe, "u").replace(/punct/g, ge).getRegex();
var Ve = /^(?:\*+(?:((?!\*)(?!openQuote)punct)|([^\s*]))?)|^_+(?:((?!_)(?!openQuote)punct)|([^\s_]))?/;
var Ye = h(Ve, "u").replace(/openQuote/g, Fe).replace(/punct/g, $).getRegex();
var me = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)";
var et = h(me, "gu").replace(/notPunctSpace/g, Q).replace(/punctSpace/g, B).replace(/punct/g, $).getRegex();
var tt = h(me, "gu").replace(/notPunctSpace/g, Ke).replace(/punctSpace/g, Ue).replace(/punct/g, ge).getRegex();
var nt = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)[\\s](\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|(?:(?!\\*)punct|notPunctSpace)(\\*+)(?!\\*)(?=notPunctSpace)";
var rt = h(nt, "gu").replace(/notPunctSpace/g, Q).replace(/punctSpace/g, B).replace(/punct/g, $).getRegex();
var st = h("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, Q).replace(/punctSpace/g, B).replace(/punct/g, $).getRegex();
var it = "^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)[\\s](_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)|(?:(?!_)punct|notPunctSpace)(_+)(?!_)(?=notPunctSpace)";
var ot = h(it, "gu").replace(/notPunctSpace/g, Q).replace(/punctSpace/g, B).replace(/punct/g, $).getRegex();
var at = h(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, $).getRegex();
var lt = "^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)";
var ut = h(lt, "gu").replace(/notPunctSpace/g, Q).replace(/punctSpace/g, B).replace(/punct/g, $).getRegex();
var pt = h(/\\(punct)/, "gu").replace(/punct/g, $).getRegex();
var ct = h(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
var ht = h(ee).replace("(?:-->|$)", "-->").getRegex();
var dt = h("^comment|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", ht).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
var xe = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
var U = h(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/).replace("brackets", xe).getRegex();
var kt = h(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?\s*\)/).replace("label", U).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
var gt = h(/^!?\[(label)\]\[(ref)\]/).replace("label", U).replace("ref", Y).getRegex();
var ft = h(/^!?\[(ref)\](?:\[\])?/).replace("ref", Y).getRegex();
var ue = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/;
var mt = h(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/).replace("brackets", xe).getRegex();
var xt = h("reflink|nolink(?!\\()", "g").replace("reflink", h(/^!?\[(label)\]\[(ref)\]/).replace("label", mt).replace("ref", ue).getRegex()).replace("nolink", h(/^!?\[(ref)\](?:\[\])?/).replace("ref", ue).getRegex()).getRegex();
var pe = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
var bt = /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
var Rt = h(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/).replace(/email/g, bt).getRegex();
var ne = { _backpedal: A, anyPunctuation: pt, autolink: ct, blockSkip: We, br: ke, code: Ne, del: A, delLDelim: A, delRDelim: A, emStrongLDelim: Xe, emStrongRDelimAst: et, emStrongRDelimUnd: st, escape: Ge, link: kt, nolink: ft, punctuation: je, reflink: gt, reflinkSearch: xt, tag: dt, text: Qe, url: A };
var Tt = { ...ne, emStrongLDelim: Ye, emStrongRDelimAst: rt, emStrongRDelimUnd: ot, link: h(/^!?\[(label)\]\((.*?)\)/).replace("label", U).getRegex(), reflink: h(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", U).getRegex() };
var X = { ...ne, emStrongRDelimAst: tt, emStrongLDelim: Je, delLDelim: at, delRDelim: ut, url: h(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("emailProtocol", Rt).replace("protocol", pe).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).getRegex(), _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/, del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/, text: h(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/).replace("protocol", pe).replace(/emailProtocol/g, /(?:mailto|xmpp):/).getRegex() };
var Ot = { ...X, br: h(ke).replace("{2,}", "*").getRegex(), text: h(X.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex() };
var j = { normal: te, gfm: Ze, pedantic: He };
var D = { normal: ne, gfm: X, breaks: Ot, pedantic: Tt };
var wt = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
var be = (l3) => wt[l3];
function O(l3, e) {
  if (e) {
    if (x.escapeTest.test(l3)) return l3.replace(x.escapeReplace, be);
  } else if (x.escapeTestNoEncode.test(l3)) return l3.replace(x.escapeReplaceNoEncode, be);
  return l3;
}
function Re(l3) {
  return l3.replace(x.numericCharacterReference, (e, t, n) => {
    let s = t === void 0 ? Number.parseInt(n, 16) : Number.parseInt(t, 10);
    return s === 0 || s > 1114111 || s >= 55296 && s <= 57343 ? "\uFFFD" : String.fromCodePoint(s);
  });
}
function re(l3) {
  try {
    l3 = encodeURI(l3).replace(x.percentDecode, "%");
  } catch {
    return null;
  }
  return l3;
}
function se(l3, e) {
  let t = l3.replace(x.findPipe, (r, o, i) => {
    let u = false, a2 = o;
    for (; --a2 >= 0 && i[a2] === "\\"; ) u = !u;
    return u ? "|" : " |";
  }), n = t.split(x.splitPipe), s = 0;
  if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) if (n.length > e) n.splice(e);
  else for (; n.length < e; ) n.push("");
  for (; s < n.length; s++) n[s] = n[s].trim().replace(x.slashPipe, "|");
  return n;
}
function L(l3, e, t) {
  let n = l3.length;
  if (n === 0) return "";
  let s = 0;
  for (; s < n; ) {
    let r = l3.charAt(n - s - 1);
    if (r === e && !t) s++;
    else if (r !== e && t) s++;
    else break;
  }
  return l3.slice(0, n - s);
}
function ie(l3) {
  let e = l3.split(`
`), t = e.length - 1;
  for (; t >= 0 && x.blankLine.test(e[t]); ) t--;
  return e.length - t <= 2 ? l3 : e.slice(0, t + 1).join(`
`);
}
function q(l3) {
  return l3.trim().toLowerCase().toUpperCase().toLowerCase();
}
function Te(l3, e) {
  if (l3.indexOf(e[1]) === -1) return -1;
  let t = 0;
  for (let n = 0; n < l3.length; n++) if (l3[n] === "\\") n++;
  else if (l3[n] === e[0]) t++;
  else if (l3[n] === e[1] && (t--, t < 0)) return n;
  return t > 0 ? -2 : -1;
}
function oe(l3, e = 0) {
  let t = e, n = "";
  for (let s of l3) if (s === "	") {
    let r = 4 - t % 4;
    n += " ".repeat(r), t += r;
  } else n += s, t++;
  return n;
}
function Oe(l3, e, t, n, s) {
  let r = e.href, o = e.title || null, i = l3[1].replace(s.other.outputLinkReplace, "$1"), u = l3[0].charAt(0) === "!";
  n.state.inLink = true;
  let a2 = n.state.linkEmitted, p = n.state.inRawBlock;
  n.state.linkEmitted = false;
  let c = n.inlineTokens(i), d = n.state.linkEmitted;
  if (n.state.linkEmitted = a2, n.state.inLink = false, !u) {
    if (d) {
      n.state.inRawBlock = p;
      return;
    }
    n.state.linkEmitted = true;
  }
  return { type: u ? "image" : "link", raw: t, href: r, title: o, text: i, tokens: c };
}
function yt(l3, e, t) {
  let n = l3.match(t.other.indentCodeCompensation);
  if (n === null) return e;
  let s = n[1];
  return e.split(`
`).map((r) => {
    let o = r.match(t.other.beginningSpace);
    if (o === null) return r;
    let [i] = o;
    return r.slice(Math.min(i.length, s.length));
  }).join(`
`);
}
function we(l3, e, t, n) {
  if (!e.includes("<")) return false;
  for (let s = 0; s < e.length; s++) {
    if (e[s] === "\\") {
      s++;
      continue;
    }
    if (e[s] === "`") {
      let i = n.inline.code.exec(e.slice(s));
      if (i) {
        s += i[0].length - 1;
        continue;
      }
    }
    if (e[s] !== "<") continue;
    let r = l3.slice(t + s), o = n.inline.tag.exec(r) || n.inline.autolink.exec(r);
    if (o) {
      if (o[0].length > e.length - s) return true;
      s += o[0].length - 1;
    }
  }
  return false;
}
var P = class {
  options;
  rules;
  lexer;
  constructor(e) {
    this.options = e || y;
  }
  space(e) {
    let t = this.rules.block.newline.exec(e);
    if (t && t[0].length > 0) return { type: "space", raw: t[0] };
  }
  code(e) {
    let t = this.rules.block.code.exec(e);
    if (t) {
      let n = this.options.pedantic ? t[0] : ie(t[0]), s = n.replace(this.rules.other.codeRemoveIndent, "");
      return { type: "code", raw: n, codeBlockStyle: "indented", text: s };
    }
  }
  fences(e) {
    let t = this.rules.block.fences.exec(e);
    if (t) {
      let n = t[0], s = yt(n, t[3] || "", this.rules);
      return { type: "code", raw: n, lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2], text: s };
    }
  }
  heading(e) {
    let t = this.rules.block.heading.exec(e);
    if (t) {
      let n = t[2].trim();
      if (this.rules.other.endingHash.test(n)) {
        let s = L(n, "#");
        (this.options.pedantic || !s || this.rules.other.endingSpaceTabChar.test(s)) && (n = s.trim());
      }
      return { type: "heading", raw: L(t[0], `
`), depth: t[1].length, text: n, tokens: this.lexer.inline(n) };
    }
  }
  hr(e) {
    let t = this.rules.block.hr.exec(e);
    if (t) return { type: "hr", raw: L(t[0], `
`) };
  }
  blockquote(e) {
    let t = this.rules.block.blockquote.exec(e);
    if (t) {
      let n = L(t[0], `
`).split(`
`), s = "", r = "", o = [];
      for (; n.length > 0; ) {
        let i = false, u = [], a2;
        for (a2 = 0; a2 < n.length; a2++) if (this.rules.other.blockquoteStart.test(n[a2])) u.push(n[a2]), i = true;
        else if (!i) u.push(n[a2]);
        else break;
        n = n.slice(a2);
        let p = u.join(`
`), c = p.replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
        s = s ? `${s}
${p}` : p, r = r ? `${r}
${c}` : c;
        let d = this.lexer.state.top;
        if (this.lexer.state.top = true, this.lexer.blockTokens(c, o, true), this.lexer.state.top = d, n.length === 0) break;
        let m = o.at(-1);
        if (m?.type === "code") break;
        if (m?.type === "blockquote") {
          let b = m, g = n.join(`
`), w = b.raw + `
` + g.replace(this.rules.other.blockquoteSetextReplace2, ""), f = this.blockquote(w);
          o[o.length - 1] = f;
          let M = w.substring(f.raw.length).replace(/^\n/, ""), v = M ? M.split(`
`).length : 0, Z = v ? n.slice(0, -v) : n;
          Z.length > 0 && (s = `${s}
${Z.join(`
`)}`), r = r.substring(0, r.length - b.text.length) + f.text;
          break;
        } else if (m?.type === "list") {
          let b = m, g = b.raw + `
` + n.join(`
`), w = this.list(g);
          o[o.length - 1] = w, s = s.substring(0, s.length - m.raw.length) + w.raw, r = r.substring(0, r.length - b.raw.length) + w.raw, n = g.substring(o.at(-1).raw.length).split(`
`);
          continue;
        }
      }
      return { type: "blockquote", raw: s, tokens: o, text: r };
    }
  }
  list(e) {
    let t = this.rules.block.list.exec(e);
    if (t) {
      let n = t[1].trim(), s = n.length > 1, r = { type: "list", raw: "", ordered: s, start: s ? +n.slice(0, -1) : "", loose: false, items: [] };
      n = s ? `\\d{1,9}\\${n.slice(-1)}` : `\\${n}`, this.options.pedantic && (n = s ? n : "[*+-]");
      let o = this.rules.other.listItemRegex(n), i = false;
      for (; e; ) {
        let a2 = false, p = "", c = "";
        if (!(t = o.exec(e)) || this.rules.block.hr.test(e)) break;
        p = t[0], e = e.substring(p.length);
        let d = t[2].split(`
`, 1)[0], m = t[1].length, b = this.options.pedantic ? oe(d, m) : d.replace(this.rules.other.leadingSpaceTab, (M) => oe(M, m)), g = e.split(`
`, 1)[0], w = !b.trim(), f = 0;
        if (this.options.pedantic ? (f = 2, c = b.trimStart()) : w ? f = m + 1 : (f = b.search(this.rules.other.nonSpaceChar), f = f > 4 ? 1 : f, c = b.slice(f), f += m), w && this.rules.other.blankLine.test(g) && (p += g + `
`, e = e.substring(g.length + 1), a2 = true), !a2) {
          let M = this.rules.other.nextBulletRegex(f), v = this.rules.other.hrRegex(f), Z = this.rules.other.fencesBeginRegex(f), ae = this.rules.other.headingBeginRegex(f), ye = this.rules.other.htmlBeginRegex(f), Pe = this.rules.other.blockquoteBeginRegex(f);
          for (; e; ) {
            let K = e.split(`
`, 1)[0], H;
            if (g = K, this.options.pedantic ? (g = g.replace(this.rules.other.listReplaceNesting, "  "), H = g) : H = g.replace(this.rules.other.leadingSpaceTab, (Se) => Se.replace(this.rules.other.tabCharGlobal, "    ")), Z.test(g) || ae.test(g) || ye.test(g) || Pe.test(g) || M.test(g) || v.test(g)) break;
            if (H.search(this.rules.other.nonSpaceChar) >= f || !g.trim()) c += `
` + H.slice(f);
            else {
              if (w || b.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || Z.test(b) || ae.test(b) || v.test(b)) break;
              c += `
` + g;
            }
            w = !g.trim(), p += K + `
`, e = e.substring(K.length + 1), b = H.slice(f);
          }
        }
        r.loose || (i ? r.loose = true : this.rules.other.doubleBlankLine.test(p) && (i = true)), r.items.push({ type: "list_item", raw: p, task: !!this.options.gfm && this.rules.other.listIsTask.test(c), loose: false, text: c, tokens: [] }), r.raw += p;
      }
      let u = r.items.at(-1);
      if (u) u.raw = u.raw.trimEnd(), u.text = u.text.trimEnd();
      else return;
      r.raw = r.raw.trimEnd();
      for (let a2 of r.items) if (this.lexer.state.top = false, a2.tokens = this.lexer.blockTokens(a2.text, []), !r.loose) {
        let p = a2.tokens.filter((d) => d.type === "space"), c = p.length > 0 && p.some((d) => this.rules.other.anyLine.test(d.raw));
        r.loose = c;
      }
      for (let a2 of r.items) {
        let p = a2.tokens[0];
        if (a2.task && (p?.type === "text" || p?.type === "paragraph")) {
          a2.text = a2.text.replace(this.rules.other.listReplaceTask, ""), p.raw = p.raw.replace(this.rules.other.listReplaceTask, ""), p.text = p.text.replace(this.rules.other.listReplaceTask, "");
          for (let d = this.lexer.inlineQueue.length - 1; d >= 0; d--) if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[d].src)) {
            this.lexer.inlineQueue[d].src = this.lexer.inlineQueue[d].src.replace(this.rules.other.listReplaceTask, "");
            break;
          }
          let c = this.rules.other.listTaskCheckbox.exec(a2.raw);
          if (c) {
            let d = { type: "checkbox", raw: c[0] + " ", checked: c[0] !== "[ ]" };
            a2.checked = d.checked, r.loose ? a2.tokens[0] && ["paragraph", "text"].includes(a2.tokens[0].type) && "tokens" in a2.tokens[0] && a2.tokens[0].tokens ? (a2.tokens[0].raw = d.raw + a2.tokens[0].raw, a2.tokens[0].text = d.raw + a2.tokens[0].text, a2.tokens[0].tokens.unshift(d)) : a2.tokens.unshift({ type: "paragraph", raw: d.raw, text: d.raw, tokens: [d] }) : a2.tokens.unshift(d);
          }
        } else a2.task && (a2.task = false);
      }
      if (r.loose) for (let a2 of r.items) {
        a2.loose = true;
        for (let p of a2.tokens) p.type === "text" && (p.type = "paragraph");
      }
      return r;
    }
  }
  html(e) {
    let t = this.rules.block.html.exec(e);
    if (t) {
      let n = ie(t[0]);
      return { type: "html", block: true, raw: n, pre: t[1] === "pre" || t[1] === "script" || t[1] === "style", text: n };
    }
  }
  def(e) {
    let t = this.rules.block.def.exec(e);
    if (t) {
      let n = q(t[1]).replace(this.rules.other.multipleSpaceGlobal, " "), s = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", r = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
      return { type: "def", tag: n, raw: L(t[0], `
`), href: s, title: r };
    }
  }
  table(e) {
    let t = this.rules.block.table.exec(e);
    if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
    let n = se(t[1]), s = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), r = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], o = { type: "table", raw: L(t[0], `
`), header: [], align: [], rows: [] };
    if (n.length === s.length) {
      for (let i of s) this.rules.other.tableAlignRight.test(i) ? o.align.push("right") : this.rules.other.tableAlignCenter.test(i) ? o.align.push("center") : this.rules.other.tableAlignLeft.test(i) ? o.align.push("left") : o.align.push(null);
      for (let i = 0; i < n.length; i++) o.header.push({ text: n[i], tokens: this.lexer.inline(n[i]), header: true, align: o.align[i] });
      for (let i of r) o.rows.push(se(i, o.header.length).map((u, a2) => ({ text: u, tokens: this.lexer.inline(u), header: false, align: o.align[a2] })));
      return o;
    }
  }
  lheading(e) {
    let t = this.rules.block.lheading.exec(e);
    if (t) {
      let n = t[1].trim();
      return { type: "heading", raw: L(t[0], `
`), depth: t[2].charAt(0) === "=" ? 1 : 2, text: n, tokens: this.lexer.inline(n) };
    }
  }
  paragraph(e) {
    let t = this.rules.block.paragraph.exec(e);
    if (t) {
      let n = t[1].charAt(t[1].length - 1) === `
` ? t[1].slice(0, -1) : t[1];
      return { type: "paragraph", raw: t[0], text: n, tokens: this.lexer.inline(n) };
    }
  }
  text(e) {
    let t = this.rules.block.text.exec(e);
    if (t) return { type: "text", raw: t[0], text: t[0], tokens: this.lexer.inline(t[0]) };
  }
  escape(e) {
    let t = this.rules.inline.escape.exec(e);
    if (t) return { type: "escape", raw: t[0], text: t[1] };
  }
  tag(e) {
    let t = this.rules.inline.tag.exec(e);
    if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = true : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = false), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = true : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = false), { type: "html", raw: t[0], inLink: this.lexer.state.inLink, inRawBlock: this.lexer.state.inRawBlock, block: false, text: t[0] };
  }
  link(e) {
    let t = this.rules.inline.link.exec(e);
    if (t) {
      let n = t[0].charAt(0) === "!" ? 2 : 1;
      if (!this.options.pedantic && we(e, t[1], n, this.rules)) return;
      let s = t[2].trim();
      if (!this.options.pedantic && this.rules.other.startAngleBracket.test(s)) {
        if (!this.rules.other.endAngleBracket.test(s)) return;
        let i = L(s.slice(0, -1), "\\");
        if ((s.length - i.length) % 2 === 0) return;
      } else {
        let i = Te(t[2], "()");
        if (i === -2) return;
        if (i > -1) {
          let a2 = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + i;
          t[2] = t[2].substring(0, i), t[0] = t[0].substring(0, a2).trim(), t[3] = "";
        }
      }
      let r = t[2], o = "";
      if (this.options.pedantic) {
        let i = this.rules.other.pedanticHrefTitle.exec(r);
        i && (r = i[1], o = i[3]);
      } else o = t[3] ? t[3].slice(1, -1) : "";
      return r = r.trim(), this.rules.other.startAngleBracket.test(r) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(s) ? r = r.slice(1) : r = r.slice(1, -1)), Oe(t, { href: r && r.replace(this.rules.inline.anyPunctuation, "$1"), title: o && o.replace(this.rules.inline.anyPunctuation, "$1") }, t[0], this.lexer, this.rules);
    }
  }
  reflink(e, t) {
    let n;
    if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
      let s = n[0].charAt(0) === "!" ? 2 : 1;
      if (!this.options.pedantic && we(e, n[1], s, this.rules)) return;
      let r = (n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " "), o = t[q(r)];
      if (!o) {
        let i = n[0].charAt(0);
        return { type: "text", raw: i, text: i };
      }
      return Oe(n, o, n[0], this.lexer, this.rules);
    }
  }
  emStrong(e, t, n = "") {
    let s = this.rules.inline.emStrongLDelim.exec(e);
    if (!s || !s[1] && !s[2] && !s[3] && !s[4] || s[4] && n.match(this.rules.other.unicodeAlphaNumeric)) return;
    if (!(s[1] || s[3] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let o = [...s[0]].length - 1, i, u, a2 = o, p = 0, c = s[0][0], d = n === c, m = c === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
      for (m.lastIndex = 0, t = t.slice(-1 * e.length + o); (s = m.exec(t)) !== null; ) {
        if (i = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !i) continue;
        if (u = [...i].length, s[3] || s[4]) {
          a2 += u;
          continue;
        } else if (s[5] || s[6]) {
          if (o % 3 && !((o + u) % 3)) {
            p += u;
            continue;
          }
          if (d) break;
        }
        if (a2 -= u, a2 > 0) continue;
        u = Math.min(u, u + a2 + p);
        let b = [...s[0]][0].length, g = e.slice(0, o + s.index + b + u);
        if (Math.min(o, u) % 2) {
          let f = g.slice(1, -1);
          return { type: "em", raw: g, text: f, tokens: this.lexer.inlineTokens(f) };
        }
        let w = g.slice(2, -2);
        return { type: "strong", raw: g, text: w, tokens: this.lexer.inlineTokens(w) };
      }
    }
  }
  codespan(e) {
    let t = this.rules.inline.code.exec(e);
    if (t) {
      let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), s = this.rules.other.nonSpaceChar.test(n), r = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
      return s && r && (n = n.substring(1, n.length - 1)), { type: "codespan", raw: t[0], text: n };
    }
  }
  br(e) {
    let t = this.rules.inline.br.exec(e);
    if (t) return { type: "br", raw: t[0] };
  }
  del(e, t, n = "") {
    let s = this.rules.inline.delLDelim.exec(e);
    if (!s) return;
    if (!(s[1] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let o = [...s[0]].length - 1, i, u, a2 = o, p = this.rules.inline.delRDelim;
      for (p.lastIndex = 0, t = t.slice(-1 * e.length + o); (s = p.exec(t)) !== null; ) {
        if (i = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !i || (u = [...i].length, u !== o)) continue;
        if (s[3] || s[4]) {
          a2 += u;
          continue;
        }
        if (a2 -= u, a2 > 0) continue;
        u = Math.min(u, u + a2);
        let c = [...s[0]][0].length, d = e.slice(0, o + s.index + c + u), m = d.slice(o, -o);
        return { type: "del", raw: d, text: m, tokens: this.lexer.inlineTokens(m) };
      }
    }
  }
  autolink(e) {
    let t = this.rules.inline.autolink.exec(e);
    if (t) {
      let n, s;
      return t[2] === "@" ? (n = t[1], s = "mailto:" + n) : (n = t[1], s = n), { type: "link", raw: t[0], text: n, href: s, autolink: true, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  url(e) {
    let t;
    if (t = this.rules.inline.url.exec(e)) {
      let n, s;
      if (t[2] === "@") n = t[0], s = "mailto:" + n;
      else {
        let r;
        do
          r = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
        while (r !== t[0]);
        n = t[0], t[1] === "www." ? s = "http://" + t[0] : s = t[0];
      }
      return { type: "link", raw: t[0], text: n, href: s, autolink: true, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  inlineText(e) {
    let t = this.rules.inline.text.exec(e);
    if (t) {
      let n = this.lexer.state.inRawBlock;
      return { type: "text", raw: t[0], text: n ? t[0] : Re(t[0]), escaped: n };
    }
  }
};
var R = class l {
  tokens;
  options;
  state;
  inlineQueue;
  tokenizer;
  constructor(e) {
    this.tokens = [], this.tokens.links = /* @__PURE__ */ Object.create(null), this.options = e || y, this.options.tokenizer = this.options.tokenizer || new P(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = { inLink: false, inRawBlock: false, linkEmitted: false, top: true };
    let t = { other: x, block: j.normal, inline: D.normal };
    this.options.pedantic ? (t.block = j.pedantic, t.inline = D.pedantic) : this.options.gfm && (t.block = j.gfm, this.options.breaks ? t.inline = D.breaks : t.inline = D.gfm), this.tokenizer.rules = t;
  }
  static get rules() {
    return { block: j, inline: D };
  }
  static lex(e, t) {
    return new l(t).lex(e);
  }
  static lexInline(e, t) {
    return new l(t).inlineTokens(e);
  }
  lex(e) {
    e = e.replace(x.carriageReturn, `
`), this.blockTokens(e, this.tokens);
    for (let t = 0; t < this.inlineQueue.length; t++) {
      let n = this.inlineQueue[t];
      this.inlineTokens(n.src, n.tokens);
    }
    return this.inlineQueue = [], this.tokens;
  }
  blockTokens(e, t = [], n = false) {
    this.tokenizer.lexer = this, this.options.pedantic && (e = e.replace(x.tabCharGlobal, "    ").replace(x.spaceLine, ""));
    let s = 1 / 0;
    for (; e; ) {
      if (e.length < s) s = e.length;
      else {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
      let r;
      if (this.options.extensions?.block?.some((i) => (r = i.call({ lexer: this }, e, t)) ? (e = e.substring(r.raw.length), t.push(r), true) : false)) continue;
      if (r = this.tokenizer.space(e)) {
        e = e.substring(r.raw.length);
        let i = t.at(-1);
        r.raw.length === 1 && i !== void 0 ? i.raw += `
` : t.push(r);
        continue;
      }
      if (r = this.tokenizer.code(e)) {
        e = e.substring(r.raw.length);
        let i = t.at(-1);
        i?.type === "paragraph" || i?.type === "text" ? (i.raw += (i.raw.endsWith(`
`) ? "" : `
`) + r.raw, i.text += `
` + r.text, this.inlineQueue.at(-1).src = i.text) : t.push(r);
        continue;
      }
      if (r = this.tokenizer.fences(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.heading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.hr(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.blockquote(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.list(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.html(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.def(e)) {
        e = e.substring(r.raw.length);
        let i = t.at(-1);
        i?.type === "paragraph" || i?.type === "text" ? (i.raw += (i.raw.endsWith(`
`) ? "" : `
`) + r.raw, i.text += `
` + r.raw, this.inlineQueue.at(-1).src = i.text) : this.tokens.links[r.tag] || (this.tokens.links[r.tag] = { href: r.href, title: r.title }, t.push(r));
        continue;
      }
      if (r = this.tokenizer.table(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.lheading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      let o = e;
      if (this.options.extensions?.startBlock) {
        let i = 1 / 0, u = e.slice(1), a2;
        this.options.extensions.startBlock.forEach((p) => {
          a2 = p.call({ lexer: this }, u), typeof a2 == "number" && a2 >= 0 && (i = Math.min(i, a2));
        }), i < 1 / 0 && i >= 0 && (o = e.substring(0, i + 1));
      }
      if (this.state.top && (r = this.tokenizer.paragraph(o))) {
        let i = t.at(-1);
        n && i?.type === "paragraph" ? (i.raw += (i.raw.endsWith(`
`) ? "" : `
`) + r.raw, i.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = i.text) : t.push(r), n = o.length !== e.length, e = e.substring(r.raw.length);
        continue;
      }
      if (r = this.tokenizer.text(e)) {
        e = e.substring(r.raw.length);
        let i = t.at(-1);
        i?.type === "text" ? (i.raw += (i.raw.endsWith(`
`) ? "" : `
`) + r.raw, i.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = i.text) : t.push(r);
        continue;
      }
      if (e) {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
    }
    return this.state.top = true, t;
  }
  inline(e, t = []) {
    return this.inlineQueue.push({ src: e, tokens: t }), t;
  }
  linkInText(e) {
    if (!e.includes("[")) return false;
    let t = this.tokenizer.rules.inline.link;
    for (let n of e.matchAll(this.tokenizer.rules.inline.blockSkip)) if (t.test(n[0]) && e.charAt(n.index - 1) !== "!") return true;
    for (let n of e.matchAll(this.tokenizer.rules.inline.reflinkSearch)) {
      let s = n[0], r = s.lastIndexOf("[");
      if (!(s.charAt(0) === "!" || !Object.hasOwn(this.tokens.links, q(s.slice(r + 1, -1)))) && !(r > 1 && this.linkInText(s.slice(1, r - 1)))) return true;
    }
    return false;
  }
  inlineTokens(e, t = []) {
    this.tokenizer.lexer = this;
    let n = e;
    if (this.tokens.links && e.includes("[")) {
      let i = this.tokenizer.rules.inline.reflinkSearch, u = (a2) => {
        let p = a2.lastIndexOf("[");
        if (!Object.hasOwn(this.tokens.links, q(a2.slice(p + 1, -1)))) return a2;
        if (p > 1 && a2.charAt(0) !== "!") {
          let c = a2.slice(1, p - 1);
          if (this.linkInText(c)) return "[" + c.replace(i, u) + "][" + "a".repeat(a2.length - p - 2) + "]";
        }
        return "[" + "a".repeat(a2.length - 2) + "]";
      };
      n = n.replace(i, u);
    }
    n = n.replace(this.tokenizer.rules.inline.anyPunctuation, (i) => "+".repeat(i.length)), n = n.replace(this.tokenizer.rules.inline.blockSkip, (i, u, a2) => {
      let p = a2 ? a2.length : 0;
      return i.slice(0, p) + "[" + "a".repeat(i.length - p - 2) + "]";
    }), n = this.options.hooks?.emStrongMask?.call({ lexer: this }, n) ?? n;
    let s = false, r = "", o = 1 / 0;
    for (; e; ) {
      if (e.length < o) o = e.length;
      else {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
      s || (r = ""), s = false;
      let i;
      if (this.options.extensions?.inline?.some((a2) => (i = a2.call({ lexer: this }, e, t)) ? (e = e.substring(i.raw.length), t.push(i), true) : false)) continue;
      if (i = this.tokenizer.escape(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.tag(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.link(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.reflink(e, this.tokens.links)) {
        e = e.substring(i.raw.length);
        let a2 = t.at(-1);
        i.type === "text" && a2?.type === "text" ? (a2.raw += i.raw, a2.text += i.text) : t.push(i);
        continue;
      }
      if (i = this.tokenizer.emStrong(e, n, r)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.codespan(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.br(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.del(e, n, r)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.autolink(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (!this.state.inLink && (i = this.tokenizer.url(e))) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      let u = e;
      if (this.options.extensions?.startInline) {
        let a2 = 1 / 0, p = e.slice(1), c;
        this.options.extensions.startInline.forEach((d) => {
          c = d.call({ lexer: this }, p), typeof c == "number" && c >= 0 && (a2 = Math.min(a2, c));
        }), a2 < 1 / 0 && a2 >= 0 && (u = e.substring(0, a2 + 1));
      }
      if (i = this.tokenizer.inlineText(u)) {
        e = e.substring(i.raw.length), i.raw.slice(-1) !== "_" && (r = i.raw.slice(-1)), s = true;
        let a2 = t.at(-1);
        a2?.type === "text" ? (a2.raw += i.raw, a2.text += i.text) : t.push(i);
        continue;
      }
      if (e) {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
    }
    return t;
  }
  infiniteLoopError(e) {
    let t = "Infinite loop on byte: " + e;
    if (this.options.silent) console.error(t);
    else throw new Error(t);
  }
};
var S = class {
  options;
  parser;
  constructor(e) {
    this.options = e || y;
  }
  space(e) {
    return "";
  }
  code({ text: e, lang: t, escaped: n }) {
    let s = (t || "").match(x.notSpaceStart)?.[0], r = e ? e.replace(x.endingNewline, "") + `
` : "";
    return s ? '<pre><code class="language-' + O(s) + '">' + (n ? r : O(r, true)) + `</code></pre>
` : "<pre><code>" + (n ? r : O(r, true)) + `</code></pre>
`;
  }
  blockquote({ tokens: e }) {
    return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
  }
  html({ text: e }) {
    return e;
  }
  def(e) {
    return "";
  }
  heading({ tokens: e, depth: t }) {
    return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
  }
  hr(e) {
    return `<hr>
`;
  }
  list(e) {
    let t = e.ordered, n = e.start, s = "";
    for (let i = 0; i < e.items.length; i++) {
      let u = e.items[i];
      s += this.listitem(u);
    }
    let r = t ? "ol" : "ul", o = t && n !== 1 ? ' start="' + n + '"' : "";
    return "<" + r + o + `>
` + s + "</" + r + `>
`;
  }
  listitem(e) {
    return `<li>${this.parser.parse(e.tokens)}</li>
`;
  }
  checkbox({ checked: e }) {
    return "<input " + (e ? 'checked="" ' : "") + 'disabled="" type="checkbox"> ';
  }
  paragraph({ tokens: e }) {
    return `<p>${this.parser.parseInline(e)}</p>
`;
  }
  table(e) {
    let t = "", n = "";
    for (let r = 0; r < e.header.length; r++) n += this.tablecell(e.header[r]);
    t += this.tablerow({ text: n });
    let s = "";
    for (let r = 0; r < e.rows.length; r++) {
      let o = e.rows[r];
      n = "";
      for (let i = 0; i < o.length; i++) n += this.tablecell(o[i]);
      s += this.tablerow({ text: n });
    }
    return s && (s = `<tbody>${s}</tbody>`), `<table>
<thead>
` + t + `</thead>
` + s + `</table>
`;
  }
  tablerow({ text: e }) {
    return `<tr>
${e}</tr>
`;
  }
  tablecell(e) {
    let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
    return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
  }
  strong({ tokens: e }) {
    return `<strong>${this.parser.parseInline(e)}</strong>`;
  }
  em({ tokens: e }) {
    return `<em>${this.parser.parseInline(e)}</em>`;
  }
  codespan({ text: e }) {
    return `<code>${O(e, true)}</code>`;
  }
  br(e) {
    return "<br>";
  }
  del({ tokens: e }) {
    return `<del>${this.parser.parseInline(e)}</del>`;
  }
  link({ href: e, title: t, text: n, tokens: s, autolink: r }) {
    let o = r ? O(n, true) : this.parser.parseInline(s), i = re(e);
    if (i === null) return o;
    e = O(i, r);
    let u = '<a href="' + e + '"';
    return t && (u += ' title="' + O(t) + '"'), u += ">" + o + "</a>", u;
  }
  image({ href: e, title: t, text: n, tokens: s }) {
    s && (n = this.parser.parseInline(s, this.parser.textRenderer));
    let r = re(e);
    if (r === null) return O(n);
    e = r;
    let o = `<img src="${O(e)}" alt="${O(n)}"`;
    return t && (o += ` title="${O(t)}"`), o += ">", o;
  }
  text(e) {
    return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : O(e.text);
  }
};
var z = class {
  strong({ text: e }) {
    return e;
  }
  em({ text: e }) {
    return e;
  }
  codespan({ text: e }) {
    return e;
  }
  del({ text: e }) {
    return e;
  }
  html({ text: e }) {
    return e;
  }
  text({ text: e }) {
    return e;
  }
  link({ text: e }) {
    return "" + e;
  }
  image({ text: e }) {
    return "" + e;
  }
  br() {
    return "";
  }
  checkbox({ raw: e }) {
    return e;
  }
};
var T = class l2 {
  options;
  renderer;
  textRenderer;
  constructor(e) {
    this.options = e || y, this.options.renderer = this.options.renderer || new S(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new z();
  }
  static parse(e, t) {
    return new l2(t).parse(e);
  }
  static parseInline(e, t) {
    return new l2(t).parseInline(e);
  }
  parse(e) {
    this.renderer.parser = this;
    let t = "";
    for (let n = 0; n < e.length; n++) {
      let s = e[n];
      if (this.options.extensions?.renderers?.[s.type]) {
        let o = s, i = this.options.extensions.renderers[o.type].call({ parser: this }, o);
        if (i !== false || !["space", "hr", "heading", "code", "table", "blockquote", "list", "checkbox", "html", "def", "paragraph", "text"].includes(o.type)) {
          t += i || "";
          continue;
        }
      }
      let r = s;
      switch (r.type) {
        case "space": {
          t += this.renderer.space(r);
          break;
        }
        case "hr": {
          t += this.renderer.hr(r);
          break;
        }
        case "heading": {
          t += this.renderer.heading(r);
          break;
        }
        case "code": {
          t += this.renderer.code(r);
          break;
        }
        case "table": {
          t += this.renderer.table(r);
          break;
        }
        case "blockquote": {
          t += this.renderer.blockquote(r);
          break;
        }
        case "list": {
          t += this.renderer.list(r);
          break;
        }
        case "checkbox": {
          t += this.renderer.checkbox(r);
          break;
        }
        case "html": {
          t += this.renderer.html(r);
          break;
        }
        case "def": {
          t += this.renderer.def(r);
          break;
        }
        case "paragraph": {
          t += this.renderer.paragraph(r);
          break;
        }
        case "text": {
          t += this.renderer.text(r);
          break;
        }
        default: {
          let o = 'Token with "' + r.type + '" type was not found.';
          if (this.options.silent) return console.error(o), "";
          throw new Error(o);
        }
      }
    }
    return t;
  }
  parseInline(e, t = this.renderer) {
    this.renderer.parser = this;
    let n = "";
    for (let s = 0; s < e.length; s++) {
      let r = e[s];
      if (this.options.extensions?.renderers?.[r.type]) {
        let i = this.options.extensions.renderers[r.type].call({ parser: this }, r);
        if (i !== false || !["escape", "html", "link", "image", "checkbox", "strong", "em", "codespan", "br", "del", "text"].includes(r.type)) {
          n += i || "";
          continue;
        }
      }
      let o = r;
      switch (o.type) {
        case "escape": {
          n += t.text(o);
          break;
        }
        case "html": {
          n += t.html(o);
          break;
        }
        case "link": {
          n += t.link(o);
          break;
        }
        case "image": {
          n += t.image(o);
          break;
        }
        case "checkbox": {
          n += t.checkbox(o);
          break;
        }
        case "strong": {
          n += t.strong(o);
          break;
        }
        case "em": {
          n += t.em(o);
          break;
        }
        case "codespan": {
          n += t.codespan(o);
          break;
        }
        case "br": {
          n += t.br(o);
          break;
        }
        case "del": {
          n += t.del(o);
          break;
        }
        case "text": {
          n += t.text(o);
          break;
        }
        default: {
          let i = 'Token with "' + o.type + '" type was not found.';
          if (this.options.silent) return console.error(i), "";
          throw new Error(i);
        }
      }
    }
    return n;
  }
};
var _ = class {
  options;
  block;
  constructor(e) {
    this.options = e || y;
  }
  static passThroughHooks = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens", "emStrongMask"]);
  static passThroughHooksRespectAsync = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens"]);
  preprocess(e) {
    return e;
  }
  postprocess(e) {
    return e;
  }
  processAllTokens(e) {
    return e;
  }
  emStrongMask(e) {
    return e;
  }
  provideLexer(e = this.block) {
    return e ? R.lex : R.lexInline;
  }
  provideParser(e = this.block) {
    return e ? T.parse : T.parseInline;
  }
};
var F = class {
  defaults = I();
  options = this.setOptions;
  parse = this.parseMarkdown(true);
  parseInline = this.parseMarkdown(false);
  Parser = T;
  Renderer = S;
  TextRenderer = z;
  Lexer = R;
  Tokenizer = P;
  Hooks = _;
  constructor(...e) {
    this.use(...e);
  }
  walkTokens(e, t) {
    let n = [];
    for (let s of e) switch (n = n.concat(t.call(this, s)), s.type) {
      case "table": {
        let r = s;
        for (let o of r.header) n = n.concat(this.walkTokens(o.tokens, t));
        for (let o of r.rows) for (let i of o) n = n.concat(this.walkTokens(i.tokens, t));
        break;
      }
      case "list": {
        let r = s;
        n = n.concat(this.walkTokens(r.items, t));
        break;
      }
      default: {
        let r = s;
        this.defaults.extensions?.childTokens?.[r.type] ? this.defaults.extensions.childTokens[r.type].forEach((o) => {
          let i = r[o].flat(1 / 0);
          n = n.concat(this.walkTokens(i, t));
        }) : r.tokens && (n = n.concat(this.walkTokens(r.tokens, t)));
      }
    }
    return n;
  }
  use(...e) {
    let t = this.defaults.extensions || { renderers: {}, childTokens: {} };
    return e.forEach((n) => {
      let s = { ...n };
      if (s.async = this.defaults.async || s.async || false, n.extensions && (n.extensions.forEach((r) => {
        if (!r.name) throw new Error("extension name required");
        if ("renderer" in r) {
          let o = t.renderers[r.name];
          o ? t.renderers[r.name] = function(...i) {
            let u = r.renderer.apply(this, i);
            return u === false && (u = o.apply(this, i)), u;
          } : t.renderers[r.name] = r.renderer;
        }
        if ("tokenizer" in r) {
          if (!r.level || r.level !== "block" && r.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
          let o = t[r.level];
          o ? o.unshift(r.tokenizer) : t[r.level] = [r.tokenizer], r.start && (r.level === "block" ? t.startBlock ? t.startBlock.push(r.start) : t.startBlock = [r.start] : r.level === "inline" && (t.startInline ? t.startInline.push(r.start) : t.startInline = [r.start]));
        }
        "childTokens" in r && r.childTokens && (t.childTokens[r.name] = r.childTokens);
      }), s.extensions = t), n.renderer) {
        let r = this.defaults.renderer || new S(this.defaults);
        for (let o in n.renderer) {
          if (!(o in r)) throw new Error(`renderer '${o}' does not exist`);
          if (["options", "parser"].includes(o)) continue;
          let i = o, u = n.renderer[i], a2 = r[i];
          r[i] = (...p) => {
            let c = u.apply(r, p);
            return c === false && (c = a2.apply(r, p)), c || "";
          };
        }
        s.renderer = r;
      }
      if (n.tokenizer) {
        let r = this.defaults.tokenizer || new P(this.defaults);
        for (let o in n.tokenizer) {
          if (!(o in r)) throw new Error(`tokenizer '${o}' does not exist`);
          if (["options", "rules", "lexer"].includes(o)) continue;
          let i = o, u = n.tokenizer[i], a2 = r[i];
          r[i] = (...p) => {
            let c = u.apply(r, p);
            return c === false && (c = a2.apply(r, p)), c;
          };
        }
        s.tokenizer = r;
      }
      if (n.hooks) {
        let r = this.defaults.hooks || new _();
        for (let o in n.hooks) {
          if (!(o in r)) throw new Error(`hook '${o}' does not exist`);
          if (["options", "block"].includes(o)) continue;
          let i = o, u = n.hooks[i], a2 = r[i];
          _.passThroughHooks.has(o) ? r[i] = (p) => {
            if (this.defaults.async && _.passThroughHooksRespectAsync.has(o)) return (async () => {
              let d = await u.call(r, p);
              return a2.call(r, d);
            })();
            let c = u.call(r, p);
            return a2.call(r, c);
          } : r[i] = (...p) => {
            if (this.defaults.async) return (async () => {
              let d = await u.apply(r, p);
              return d === false && (d = await a2.apply(r, p)), d;
            })();
            let c = u.apply(r, p);
            return c === false && (c = a2.apply(r, p)), c;
          };
        }
        s.hooks = r;
      }
      if (n.walkTokens) {
        let r = this.defaults.walkTokens, o = n.walkTokens;
        s.walkTokens = function(i) {
          let u = [];
          return u.push(o.call(this, i)), r && (u = u.concat(r.call(this, i))), u;
        };
      }
      this.defaults = { ...this.defaults, ...s };
    }), this;
  }
  setOptions(e) {
    return this.defaults = { ...this.defaults, ...e }, this;
  }
  lexer(e, t) {
    return R.lex(e, t ?? this.defaults);
  }
  parser(e, t) {
    return T.parse(e, t ?? this.defaults);
  }
  parseMarkdown(e) {
    return (n, s) => {
      let r = { ...s }, o = { ...this.defaults, ...r }, i = this.onError(!!o.silent, !!o.async);
      if (this.defaults.async === true && r.async === false) return i(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
      if (typeof n > "u" || n === null) return i(new Error("marked(): input parameter is undefined or null"));
      if (typeof n != "string") return i(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
      if (o.hooks && (o.hooks.options = o, o.hooks.block = e), o.async) return (async () => {
        let u = o.hooks ? await o.hooks.preprocess(n) : n, p = await (o.hooks ? await o.hooks.provideLexer(e) : e ? R.lex : R.lexInline)(u, o), c = o.hooks ? await o.hooks.processAllTokens(p) : p;
        o.walkTokens && await Promise.all(this.walkTokens(c, o.walkTokens));
        let m = await (o.hooks ? await o.hooks.provideParser(e) : e ? T.parse : T.parseInline)(c, o);
        return o.hooks ? await o.hooks.postprocess(m) : m;
      })().catch(i);
      try {
        o.hooks && (n = o.hooks.preprocess(n));
        let a2 = (o.hooks ? o.hooks.provideLexer(e) : e ? R.lex : R.lexInline)(n, o);
        o.hooks && (a2 = o.hooks.processAllTokens(a2)), o.walkTokens && this.walkTokens(a2, o.walkTokens);
        let c = (o.hooks ? o.hooks.provideParser(e) : e ? T.parse : T.parseInline)(a2, o);
        return o.hooks && (c = o.hooks.postprocess(c)), c;
      } catch (u) {
        return i(u);
      }
    };
  }
  onError(e, t) {
    return (n) => {
      if (n.message += `
Please report this to https://github.com/markedjs/marked.`, e) {
        let s = "<p>An error occurred:</p><pre>" + O(n.message + "", true) + "</pre>";
        return t ? Promise.resolve(s) : s;
      }
      if (t) return Promise.reject(n);
      throw n;
    };
  }
};
var E = new F();
function k(l3, e) {
  return E.parse(l3, e);
}
k.options = k.setOptions = function(l3) {
  return E.setOptions(l3), k.defaults = E.defaults, W(k.defaults), k;
};
k.getDefaults = I;
k.defaults = y;
function Pt(...l3) {
  return E.use(...l3), k.defaults = E.defaults, W(k.defaults), k;
}
k.use = Pt;
k.walkTokens = function(l3, e) {
  return E.walkTokens(l3, e);
};
k.parseInline = E.parseInline;
k.Parser = T;
k.parser = T.parse;
k.Renderer = S;
k.TextRenderer = z;
k.Lexer = R;
k.lexer = R.lex;
k.Tokenizer = P;
k.Hooks = _;
k.parse = k;
var gn = k.options;
var fn = k.setOptions;
var mn = k.walkTokens;
var xn = k.parseInline;
var Rn = T.parse;
var Tn = R.lex;

// packages/core/src/trackers/types.ts
var TRACKER_KINDS = ["github", "jira", "azure", "monday", "slack"];
var isTrackerKind = (v) => TRACKER_KINDS.includes(v);
var TRACKER_NAMES = { github: "GitHub", jira: "Jira", azure: "Azure DevOps", monday: "monday.com", slack: "Slack" };
var trackerName = (kind) => TRACKER_NAMES[kind];
var orList = (names3) => names3.length < 2 ? names3.join("") : `${names3.slice(0, -1).join(", ")} or ${names3.at(-1)}`;
function placeText(p) {
  if (p.kind === "slack") return `Slack \xB7 ${p.workspace ?? "?"} \xB7 channel ${p.channel ?? "?"}`;
  if (p.kind === "monday") return `monday.com \xB7 ${p.account ?? "?"} \xB7 ${p.boardName ?? `board ${p.board ?? "?"}`}${p.group ? ` \xB7 group ${p.groupName ?? p.group}` : ""}`;
  if (p.kind === "github") {
    const labels = p.labels ?? [];
    return `GitHub \xB7 ${p.repo ?? "?"}${labels.length ? ` \xB7 label${labels.length > 1 ? "s" : ""} ${orList(labels)}` : ""}`;
  }
  if (p.kind === "jira") return `Jira \xB7 ${p.project ?? "?"}${p.epic ? ` \xB7 epic ${p.epic}${p.epicName ? ` ${p.epicName}` : ""}` : ""}${p.sprint ? ` \xB7 ${sprintPlace(p.sprint, p.sprints ?? null)}` : ""}`;
  return `Azure DevOps \xB7 ${p.project ?? "?"}${p.team ? ` \xB7 ${p.team}` : ""}${p.areaPath ? ` \xB7 area ${p.areaPath}` : ""}`;
}
var DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
function sprintDates(s) {
  const day = (iso) => iso && !Number.isNaN(Date.parse(iso)) ? DAY.format(new Date(iso)) : null;
  const [a2, b] = [day(s.start), day(s.end)];
  return a2 && b ? `${a2} to ${b}` : a2 ? `from ${a2}` : b ? `to ${b}` : null;
}
function sprintPlace(sprint, found) {
  if (!found) return sprint === "active" ? "the active sprint" : `sprint ${sprint}`;
  if (!found.length) return sprint === "active" ? "no active sprint" : `sprint ${sprint}`;
  const word = sprint === "active" ? `active sprint${found.length > 1 ? "s" : ""}` : "sprint";
  return `${word} ${found.map((s) => `${s.name}${sprintDates(s) ? ` (${sprintDates(s)})` : ""}`).join(" and ")}`;
}

// packages/core/src/trackers/slack.ts
var SLACK_PREFIX = "SL";
var SLACK_WORKSPACE = /^[a-z0-9][a-z0-9-]*$/i;
var SLACK_CHANNEL = /^[CGD](?=[A-Z0-9]*\d)[A-Z0-9]{6,}$/i;

// packages/core/src/config.ts
var PROFILES = ["generic", "salesforce"];
var ENV_TYPES = ["production", "full", "partial", "developer", "developer_pro", "none"];
var AUTONOMY = ["manual", "dispatch", "review", "full"];
var PERMISSION_MODES = ["default", "acceptEdits", "plan", "auto", "dontAsk"];
var EFFORTS = ["low", "medium", "high", "xhigh", "max"];
var isEffort = (v) => EFFORTS.includes(v);
var BUILDER_PLACES = ["local", "cloud"];
var ROUTINE_ID = /^trig_[A-Za-z0-9]{8,}$/;
var CLOUD_QUIET_MINUTES = 120;
var CLOUD_MAX = 3;
var MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,79}$/;
var DEFAULT_MODEL = "claude-opus-5-5";
var AGENT_ROLES = ["builder", "reviewer"];
var noProfile = () => ({ model: null, effort: null, fallbackModel: null });
var CARD_STATES = ["todo", "ready", "running", "review", "rework", "blocked", "done"];
var RATCHET_LIMITS = ["floor", "ceiling"];
var RATCHET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
var TEMPLATE_DIGEST = /^sha256:[0-9a-f]{64}$/;
var CONFIG_KEYS = [
  "schema",
  "project",
  "profile",
  "github.repo",
  "github.account",
  "commitIdentity.name",
  "commitIdentity.email",
  "environments[].name",
  "environments[].branch",
  "environments[].type",
  "environments[].org",
  "environments[].default",
  "environments[].protected",
  "environments[].promotesTo",
  "environmentSpecific",
  "knownDrift",
  "trackers[].kind",
  "trackers[].site",
  "trackers[].project",
  "trackers[].repo",
  "trackers[].organization",
  "trackers[].account",
  "trackers[].workspace",
  "trackers[].channel",
  "trackers[].team",
  "trackers[].board",
  "trackers[].statusColumn",
  "trackers[].prefix",
  "trackers[].skipLabels",
  "trackers[].epic",
  "trackers[].sprint",
  "trackers[].labels",
  "trackers[].areaPath",
  "trackers[].group",
  "trackers[].edits",
  "trackers[].statusFor",
  "agents.max",
  "agents.permissionMode",
  "agents.builder.model",
  "agents.builder.effort",
  "agents.builder.fallbackModel",
  "agents.reviewer.model",
  "agents.reviewer.effort",
  "agents.reviewer.fallbackModel",
  "agents.cloud.routine",
  "agents.cloud.default",
  "agents.cloud.quietMinutes",
  "agents.cloud.max",
  "autonomy",
  "worktrees.root",
  "worktrees.setup",
  "gates.required",
  "gates.commands",
  "gates.heavy",
  "gates.severity",
  "gates.builder",
  "gates.tests",
  "gates.ratchets",
  "gates.nearIndexes",
  "secretScan.paths",
  "secretScan.exclude",
  "strayFiles.required",
  "strayFiles.allow",
  "strayFiles.data",
  "analysis.required",
  "sourceTracking",
  "autopilot.appendOnly",
  "autopilot.autoMerge",
  "dispatch.shared",
  "tidy.every",
  "template.name",
  "template.source",
  "template.digest",
  "tools[].title",
  "tools[].why",
  "tools[].check",
  "tools[].fix"
];
var LEVELS = /* @__PURE__ */ new Map();
for (const key of CONFIG_KEYS) {
  const parts = key.split(".");
  parts.forEach((part, i) => {
    const at2 = parts.slice(0, i).join(".");
    LEVELS.set(at2, (LEVELS.get(at2) ?? /* @__PURE__ */ new Set()).add(part.replace(/\[\]$/, "")));
  });
}
function unknownKeys(raw) {
  const out3 = [];
  const walk = (v, at2, said2) => {
    for (const [k2, x2] of Object.entries(v)) {
      const path = at2 ? `${at2}.${k2}` : k2;
      const name = said2 ? `${said2}.${k2}` : k2;
      if (!LEVELS.get(at2)?.has(k2)) out3.push(`Unknown key "${name}" is ignored.`);
      else if (Array.isArray(x2) && LEVELS.has(`${path}[]`)) x2.forEach((e, i) => {
        if (isObj(e)) walk(e, `${path}[]`, `${name}[${i}]`);
      });
      else if (isObj(x2) && LEVELS.has(path)) walk(x2, path, name);
    }
  };
  walk(raw, "", "");
  return out3;
}
var DEFAULT_HEAVY = {
  generic: ["build", "test", "check"],
  salesforce: ["static", "lwc-tests", "validate"]
};
var BUILT_IN_GATES = {
  // Every profile has stray-files (GH-103), STRAY_FILES below, so a ratchet can't take its name.
  generic: ["stray-files"],
  salesforce: ["format", "lint", "static", "lwc-tests", "validate", "stray-files"]
};
function branchFor(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}
var isStr = (v) => typeof v === "string" && v.trim() !== "";
var strList = (v) => Array.isArray(v) && v.every(isStr);
var inRepo = (v) => strList(v) && !v.some((f) => f.startsWith("/") || f.split("/").includes(".."));
var JIRA_ISSUE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
function sprintProblem(kind, sprint) {
  if (kind !== "jira") return '"sprint" applies only to a Jira tracker: other trackers have no sprints here.';
  if (sprint === "active" || Number.isSafeInteger(sprint) && sprint > 0) return null;
  return `"sprint" must be "active", for the board's open sprints, or a sprint's id, such as 42.`;
}
function parseConfig(raw) {
  const errors = [];
  const warnings = [];
  if (!isObj(raw)) return { config: null, errors: ["The config must be a JSON object."], warnings };
  warnings.push(...unknownKeys(raw));
  if (raw.schema !== 1) errors.push('"schema" must be 1.');
  if (!isStr(raw.project)) errors.push('"project" must be a name.');
  const profile = raw.profile ?? "generic";
  if (!PROFILES.includes(profile)) errors.push(`"profile" must be one of ${PROFILES.join(", ")}.`);
  let github = null;
  if (raw.github !== void 0 && raw.github !== null) {
    const g2 = raw.github;
    if (!isObj(g2) || !isStr(g2.repo) || !/^[\w.-]+\/[\w.-]+$/.test(g2.repo) || !isStr(g2.account)) {
      errors.push('"github" needs "repo" (owner/name) and "account" (the gh account for this repo).');
    } else github = { repo: g2.repo, account: g2.account };
  }
  let commitIdentity = null;
  if (raw.commitIdentity !== void 0 && raw.commitIdentity !== null) {
    const c = raw.commitIdentity;
    if (!isObj(c) || !isStr(c.name) || !isStr(c.email)) errors.push('"commitIdentity" needs "name" and "email".');
    else commitIdentity = { name: c.name, email: c.email };
  }
  const environments = parseEnvironments(raw.environments, profile, errors);
  const optPath = (key) => {
    const v = raw[key];
    if (v === void 0 || v === null) return null;
    if (!isStr(v)) {
      errors.push(`"${key}" must be a path inside the repo.`);
      return null;
    }
    return v;
  };
  const environmentSpecific = optPath("environmentSpecific");
  const knownDrift = optPath("knownDrift");
  const trackers = [];
  if (raw.trackers !== void 0) {
    if (!Array.isArray(raw.trackers)) errors.push('"trackers" must be a list.');
    else raw.trackers.forEach((t, i) => {
      if (!isObj(t) || !isTrackerKind(t.kind)) {
        errors.push(`trackers[${i}]: "kind" must be ${orList([...TRACKER_KINDS])}.`);
        return;
      }
      if (t.kind === "monday" && (!isStr(t.account) || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(t.account.trim()) || !Number.isSafeInteger(t.board) || t.board <= 0)) {
        errors.push(`trackers[${i}]: a monday.com tracker needs "account" (as in acme.monday.com) and "board" (the board's id, a number).`);
        return;
      }
      if (t.kind === "slack") {
        const missing = ["workspace", "channel"].filter((k2) => !isStr(t[k2]));
        if (missing.length) {
          errors.push(`trackers[${i}]: a Slack tracker needs ${missing.map((k2) => `"${k2}"`).join(" and ")}: "workspace" as in acme.slack.com, and "channel", a channel's id such as C0123ABCD.`);
          return;
        }
        if (!SLACK_WORKSPACE.test(String(t.workspace).trim())) {
          errors.push(`trackers[${i}]: "workspace" must be a Slack workspace's domain, as in acme.slack.com: letters, digits and hyphens.`);
          return;
        }
        if (!SLACK_CHANNEL.test(String(t.channel).trim())) {
          errors.push(`trackers[${i}]: "channel" must be a Slack channel's id, such as C0123ABCD, not its name.`);
          return;
        }
      }
      if (t.kind === "azure" && (!isStr(t.organization) || !isStr(t.project))) {
        errors.push(`trackers[${i}]: an Azure DevOps tracker needs "organization" and "project".`);
        return;
      }
      if (t.prefix !== void 0 && !(isStr(t.prefix) && /^[A-Za-z][A-Za-z0-9]{0,9}$/.test(t.prefix))) {
        errors.push(`trackers[${i}]: "prefix" must be a few letters, such as AB.`);
        return;
      }
      if (t.kind === "jira" && (!isStr(t.site) || !isStr(t.project))) {
        errors.push(`trackers[${i}]: a Jira tracker needs "site" and "project".`);
        return;
      }
      if (t.skipLabels !== void 0 && !(Array.isArray(t.skipLabels) && t.skipLabels.every(isStr))) {
        errors.push(`trackers[${i}]: "skipLabels" must be a list of label names, such as ["milestone"].`);
        return;
      }
      if (t.kind !== "github" && Array.isArray(t.skipLabels) && t.skipLabels.length) {
        warnings.push(`trackers[${i}]: "skipLabels" applies only to a GitHub tracker, so it's ignored.`);
      }
      const placeKeys = [
        { key: "epic", kind: "jira", on: "a Jira", ok: isStr(t.epic) && JIRA_ISSUE.test(t.epic.trim()), error: `"epic" must be a Jira epic's key, such as ACME-3.` },
        { key: "labels", kind: "github", on: "a GitHub", ok: strList(t.labels), error: '"labels" must be a list of label names, such as ["billing"].' },
        { key: "areaPath", kind: "azure", on: "an Azure DevOps", ok: isStr(t.areaPath), error: '"areaPath" must be an Azure DevOps area path, such as "CRM\\\\Billing".' },
        { key: "group", kind: "monday", on: "a monday.com", ok: isStr(t.group), error: `"group" must be a monday.com group's id, such as "topics".` },
        { key: "statusColumn", kind: "monday", on: "a monday.com", ok: isStr(t.statusColumn), error: `"statusColumn" must be a monday.com status column's id, such as "status".` },
        { key: "workspace", kind: "slack", on: "a Slack", ok: isStr(t.workspace), error: `"workspace" must be a Slack workspace's domain, as in acme.slack.com.` },
        { key: "channel", kind: "slack", on: "a Slack", ok: isStr(t.channel), error: `"channel" must be a Slack channel's id, such as C0123ABCD.` }
      ];
      const set = placeKeys.filter((p) => t[p.key] !== void 0 && t[p.key] !== null);
      const bad = set.filter((p) => !p.ok);
      if (bad.length) {
        for (const p of bad) errors.push(`trackers[${i}]: ${p.error}`);
        return;
      }
      for (const p of set) {
        const empty = Array.isArray(t[p.key]) && !t[p.key].length;
        if (t.kind !== p.kind && !empty) warnings.push(`trackers[${i}]: "${p.key}" applies only to ${p.on} tracker, so it's ignored.`);
      }
      if (t.sprint !== void 0 && t.sprint !== null) {
        const why = sprintProblem(t.kind, t.sprint);
        if (why) {
          errors.push(`trackers[${i}]: ${why}`);
          return;
        }
      }
      if (t.edits !== void 0 && typeof t.edits !== "boolean") {
        errors.push(`trackers[${i}]: "edits" must be true or false: whether the task page may change a ticket's status, assignee and labels, and on GitHub, whether acc sync closes an issue when its work merges.`);
        return;
      }
      if (t.statusFor !== void 0 && t.statusFor !== null) {
        const sf2 = t.statusFor;
        const bad2 = !isObj(sf2) || Object.entries(sf2).some(([k2, v]) => !CARD_STATES.includes(k2) || !isStr(v));
        if (bad2) {
          errors.push(`trackers[${i}]: "statusFor" names a GitHub Project column for each state, such as { "review": "QA" }. Its states: ${CARD_STATES.join(", ")}.`);
          return;
        }
        if (t.kind !== "github") warnings.push(`trackers[${i}]: "statusFor" applies only to a GitHub tracker, so it's ignored.`);
      }
      const boardOk = t.board === void 0 || t.board === null || (t.kind === "azure" ? isStr(t.board) : Number.isSafeInteger(t.board) && t.board > 0);
      if (!boardOk) {
        errors.push(`trackers[${i}]: "board" must be ${t.kind === "azure" ? "an Azure board's name, such as Stories" : "a Jira board id or a GitHub Project number"}.`);
        return;
      }
      trackers.push({
        kind: t.kind,
        site: isStr(t.site) ? t.site : null,
        project: isStr(t.project) ? t.project : null,
        repo: isStr(t.repo) ? t.repo : null,
        organization: isStr(t.organization) ? t.organization : null,
        account: t.kind === "monday" && isStr(t.account) ? t.account.trim().toLowerCase() : null,
        workspace: t.kind === "slack" && isStr(t.workspace) ? t.workspace.trim().toLowerCase() : null,
        channel: t.kind === "slack" && isStr(t.channel) ? t.channel.trim().toUpperCase() : null,
        team: isStr(t.team) ? t.team : null,
        board: Number.isInteger(t.board) || isStr(t.board) ? t.board : null,
        statusColumn: t.kind === "monday" && isStr(t.statusColumn) ? t.statusColumn.trim() : null,
        prefix: isStr(t.prefix) ? t.prefix.toUpperCase() : null,
        skipLabels: t.kind === "github" && strList(t.skipLabels) ? t.skipLabels : [],
        epic: t.kind === "jira" && isStr(t.epic) ? t.epic.trim().toUpperCase() : null,
        sprint: t.kind === "jira" && (t.sprint === "active" || Number.isSafeInteger(t.sprint)) ? t.sprint : null,
        labels: t.kind === "github" && strList(t.labels) ? t.labels.map((l3) => l3.trim()) : [],
        areaPath: t.kind === "azure" && isStr(t.areaPath) ? t.areaPath.trim() : null,
        group: t.kind === "monday" && isStr(t.group) ? t.group.trim() : null,
        edits: t.edits === true,
        statusFor: t.kind === "github" && isObj(t.statusFor) && Object.keys(t.statusFor).length ? Object.fromEntries(Object.entries(t.statusFor).map(([k2, v]) => [k2, String(v).trim()])) : null
      });
    });
    const seen = /* @__PURE__ */ new Map();
    trackers.forEach((t, i) => {
      const p = keyPrefix(t);
      if (!p) return;
      const first = seen.get(p);
      if (first === void 0) seen.set(p, i);
      else warnings.push(`trackers[${first}] and trackers[${i}] both give tickets keys like ${p}-12, so those keys go to trackers[${first}]. Give one of them its own "prefix".`);
    });
  }
  const a2 = isObj(raw.agents) ? raw.agents : {};
  const max = a2.max ?? 3;
  if (typeof max !== "number" || !Number.isInteger(max) || max < 1 || max > 16) errors.push('"agents.max" must be a whole number from 1 to 16.');
  const permissionMode = a2.permissionMode ?? "acceptEdits";
  if (typeof permissionMode !== "string" || !PERMISSION_MODES.includes(permissionMode)) {
    errors.push(`"agents.permissionMode" must be one of ${PERMISSION_MODES.join(", ")}. bypassPermissions is never allowed for builders.`);
  }
  const profileOf = (role) => {
    const p = a2[role];
    if (p === void 0 || p === null) return noProfile();
    if (!isObj(p)) {
      errors.push(`"agents.${role}" must be an object with model, effort and fallbackModel.`);
      return noProfile();
    }
    const model = (v, key) => {
      if (v === void 0 || v === null) return null;
      if (typeof v !== "string" || !MODEL_NAME.test(v)) {
        errors.push(`"agents.${role}.${key}" must be a model alias, such as sonnet, or a full model name.`);
        return null;
      }
      return v;
    };
    let effort = null;
    if (p.effort !== void 0 && p.effort !== null) {
      if (isEffort(p.effort)) effort = p.effort;
      else errors.push(`"agents.${role}.effort" must be one of ${EFFORTS.join(", ")}.`);
    }
    return { model: model(p.model, "model"), effort, fallbackModel: model(p.fallbackModel, "fallbackModel") };
  };
  const builder = profileOf("builder");
  const reviewer = profileOf("reviewer");
  let cloud = null;
  if (a2.cloud !== void 0 && a2.cloud !== null) {
    if (!isObj(a2.cloud)) errors.push('"agents.cloud" must be an object: { "routine": "trig_\u2026", "default": "local" | "cloud", "quietMinutes": 120, "max": 3 }.');
    else {
      const c = a2.cloud;
      if (c.routine !== void 0 && c.routine !== null && (typeof c.routine !== "string" || !ROUTINE_ID.test(c.routine))) errors.push(`"agents.cloud.routine" must be a routine's API trigger id, such as trig_01ABC\u2026, from claude.ai/code/routines.`);
      const where = c.default ?? "local";
      if (!BUILDER_PLACES.includes(where)) errors.push(`"agents.cloud.default" must be one of ${BUILDER_PLACES.join(", ")}.`);
      const quiet = c.quietMinutes ?? CLOUD_QUIET_MINUTES;
      if (typeof quiet !== "number" || !Number.isInteger(quiet) || quiet < 5 || quiet > 1440) errors.push('"agents.cloud.quietMinutes" must be a whole number of minutes from 5 to 1440.');
      const cmax = c.max ?? CLOUD_MAX;
      if (typeof cmax !== "number" || !Number.isInteger(cmax) || cmax < 1 || cmax > 16) errors.push('"agents.cloud.max" must be a whole number from 1 to 16.');
      cloud = { routine: typeof c.routine === "string" ? c.routine : null, default: where, quietMinutes: quiet, max: cmax };
    }
  }
  const autonomy = raw.autonomy ?? "manual";
  if (!AUTONOMY.includes(autonomy)) errors.push(`"autonomy" must be one of ${AUTONOMY.join(", ")}.`);
  const w = isObj(raw.worktrees) ? raw.worktrees : {};
  if (w.root !== void 0 && w.root !== null && !isStr(w.root)) errors.push('"worktrees.root" must be a path.');
  if (w.setup !== void 0 && !strList(w.setup)) errors.push('"worktrees.setup" must be a list of commands.');
  const g = isObj(raw.gates) ? raw.gates : {};
  if (g.required !== void 0 && !strList(g.required)) errors.push('"gates.required" must be a list of gate names.');
  const commands = {};
  if (g.commands !== void 0) {
    if (!isObj(g.commands) || !Object.values(g.commands).every(isStr)) errors.push('"gates.commands" must map gate names to commands.');
    else Object.assign(commands, g.commands);
  }
  if (g.heavy !== void 0 && !strList(g.heavy)) errors.push('"gates.heavy" must be a list of gate names.');
  if (g.builder !== void 0 && !strList(g.builder)) errors.push('"gates.builder" must be a list of gate names: the lighter checks builders run where the merge queue runs the required ones.');
  if (g.tests !== void 0 && !strList(g.tests)) errors.push('"gates.tests" must be a list of gate names: the checks that run tests, whose receipts count what ran.');
  if (g.nearIndexes !== void 0 && !strList(g.nearIndexes)) errors.push(`"gates.nearIndexes" must be a list of paths from the repo's root, such as "src/web/main.ts": each gathers every code file in its folder.`);
  if (g.severity !== void 0 && !(Number.isInteger(g.severity) && g.severity >= 1 && g.severity <= 5)) {
    errors.push('"gates.severity" must be a whole number from 1 (only the worst problems fail) to 5 (everything fails).');
  }
  const ratchets = {};
  if (g.ratchets !== void 0) {
    if (!isObj(g.ratchets)) errors.push('"gates.ratchets" must map names to { "command", "limit", "label" }, such as { "tests": { "command": "node scripts/count-tests.mjs", "limit": "floor", "label": "tests" } }.');
    else for (const [name, r] of Object.entries(g.ratchets)) {
      const at2 = `gates.ratchets.${name}`;
      if (!RATCHET_NAME.test(name)) errors.push(`"${at2}": a ratchet's name is letters, digits, dots, dashes and underscores, up to 40 of them.`);
      else if (!isObj(r) || !isStr(r.command)) errors.push(`"${at2}" needs "command": one whose last line of output is the number.`);
      else if (!RATCHET_LIMITS.includes(r.limit)) errors.push(`"${at2}.limit" must be "floor" (the number may only go up) or "ceiling" (it may only go down).`);
      else if (!isStr(r.label) || r.label.trim().length > 24) errors.push(`"${at2}.label" must be a short name for the number, up to 24 characters, such as "tests".`);
      else if (commands[name] !== void 0 || (BUILT_IN_GATES[profile] ?? []).includes(name)) errors.push(`"${at2}": ${name} is already a gate${commands[name] !== void 0 ? ' in "gates.commands"' : `, built into the ${profile} profile`}. Give the ratchet a name of its own.`);
      else {
        for (const k2 of Object.keys(r)) if (!["command", "limit", "label"].includes(k2)) warnings.push(`Unknown key "${at2}.${k2}" is ignored.`);
        ratchets[name] = { command: r.command, limit: r.limit, label: r.label.trim() };
      }
    }
  }
  const s = isObj(raw.secretScan) ? raw.secretScan : {};
  if (s.paths !== void 0 && !strList(s.paths)) errors.push('"secretScan.paths" must be a list.');
  if (s.exclude !== void 0 && !strList(s.exclude)) errors.push('"secretScan.exclude" must be a list.');
  const defaultScan = profile === "salesforce" ? ["force-app", "config", "scripts"] : ["."];
  const sf = isObj(raw.strayFiles) ? raw.strayFiles : {};
  if (raw.strayFiles !== void 0 && !isObj(raw.strayFiles)) errors.push('"strayFiles" must be an object, such as { "allow": ["LICENSE"] }.');
  if (sf.required !== void 0 && typeof sf.required !== "boolean") errors.push('"strayFiles.required" must be true or false: whether a change must pass the stray-files check.');
  if (sf.allow !== void 0 && !inRepo(sf.allow)) errors.push('"strayFiles.allow" must be a list of paths inside the repo, such as ["LICENSE", "fixtures"].');
  if (sf.data !== void 0 && !inRepo(sf.data)) errors.push('"strayFiles.data" must be a list of folders inside the repo, such as ["data/samples"].');
  if (profile !== "salesforce" && Array.isArray(sf.data) && sf.data.length) warnings.push(`"strayFiles.data" applies only to a Salesforce project, so it's ignored.`);
  const an = isObj(raw.analysis) ? raw.analysis : {};
  if (raw.analysis !== void 0 && !isObj(raw.analysis)) errors.push('"analysis" must be an object, such as { "required": true }.');
  if (an.required !== void 0 && typeof an.required !== "boolean") errors.push('"analysis.required" must be true or false.');
  const tracking = raw.sourceTracking;
  if (tracking !== void 0 && typeof tracking !== "boolean") errors.push('"sourceTracking" must be true or false: whether the project uses Salesforce source tracking.');
  if (profile !== "salesforce" && tracking === false) warnings.push(`"sourceTracking" applies only to a Salesforce project, so it's ignored.`);
  let autopilot;
  if (raw.autopilot !== void 0) {
    const ap = raw.autopilot;
    if (!isObj(ap)) errors.push('"autopilot" must be an object, such as { "appendOnly": ["docs/DECISIONS.md"] }.');
    else {
      const list = ap.appendOnly ?? [];
      const autoMerge = ap.autoMerge ?? false;
      if (!inRepo(list)) {
        errors.push('"autopilot.appendOnly" must be a list of paths inside the repo, such as ["docs/DECISIONS.md"].');
      } else if (typeof autoMerge !== "boolean") {
        errors.push('"autopilot.autoMerge" must be true or false: whether autopilot merges a reviewed pull request whose checks passed.');
      } else if (autoMerge && profile === "salesforce") {
        errors.push(`"autopilot.autoMerge" can't be on in a Salesforce project: a person merges every pull request there.`);
      } else autopilot = { appendOnly: list, ...autoMerge ? { autoMerge: true } : {} };
    }
  }
  let dispatch2;
  if (raw.dispatch !== void 0) {
    const d = raw.dispatch;
    if (!isObj(d)) errors.push('"dispatch" must be an object, such as { "shared": ["README.md"] }.');
    else {
      const list = d.shared ?? [];
      if (!inRepo(list)) {
        errors.push('"dispatch.shared" must be a list of paths inside the repo, such as ["README.md", "docs"].');
      } else dispatch2 = { shared: list };
    }
  }
  let tools;
  if (raw.tools !== void 0) {
    const list = raw.tools;
    if (!Array.isArray(list) || !list.every((t) => isObj(t) && ["title", "why", "check", "fix"].every((k2) => isStr(t[k2])))) {
      errors.push('"tools" must be a list of tools, each with "title", "why", "check" (a command that exits 0 when the tool is there) and "fix" (a command that sets it up).');
    } else tools = list.map((t) => ({ title: t.title, why: t.why, check: t.check, fix: t.fix }));
  }
  let tidy;
  if (raw.tidy !== void 0) {
    const t = raw.tidy;
    if (!isObj(t)) errors.push('"tidy" must be an object, such as { "every": 8 }.');
    else if (t.every !== void 0) {
      if (typeof t.every !== "number" || !Number.isInteger(t.every) || t.every < 0 || t.every > 100) {
        errors.push('"tidy.every" must be a whole number from 0 to 100: how many tasks merge before a tidy-up is offered, or 0 for never.');
      } else tidy = { every: t.every };
    }
  }
  let template;
  if (raw.template !== void 0 && raw.template !== null) {
    const t = raw.template;
    if (!isObj(t) || !isStr(t.name) || !isStr(t.source) || typeof t.digest !== "string" || !TEMPLATE_DIGEST.test(t.digest)) {
      errors.push('"template" needs "name", "source" and "digest" (sha256:<64 hex digits>): the team template the project was started from.');
    } else template = { name: t.name, source: t.source, digest: t.digest };
  }
  if (errors.length) return { config: null, errors, warnings };
  return {
    config: {
      schema: 1,
      project: raw.project,
      profile,
      github,
      commitIdentity,
      environments,
      environmentSpecific,
      knownDrift,
      trackers,
      agents: { max, permissionMode, builder, reviewer, cloud },
      autonomy,
      worktrees: { root: isStr(w.root) ? w.root : null, setup: strList(w.setup) ? w.setup : [] },
      gates: {
        required: strList(g.required) ? g.required : [],
        commands,
        heavy: strList(g.heavy) ? g.heavy : DEFAULT_HEAVY[profile],
        severity: g.severity ?? 2,
        ...strList(g.builder) ? { builder: g.builder } : {},
        ...g.ratchets !== void 0 ? { ratchets } : {},
        ...strList(g.tests) ? { tests: g.tests } : {},
        ...strList(g.nearIndexes) ? { nearIndexes: g.nearIndexes } : {}
      },
      secretScan: {
        paths: strList(s.paths) ? s.paths : defaultScan,
        exclude: strList(s.exclude) ? s.exclude : []
      },
      strayFiles: {
        required: sf.required !== false,
        allow: inRepo(sf.allow) ? sf.allow : [],
        data: inRepo(sf.data) ? sf.data : []
      },
      ...typeof an.required === "boolean" ? { analysis: { required: an.required } } : {},
      ...typeof tracking === "boolean" ? { sourceTracking: tracking } : {},
      ...autopilot ? { autopilot } : {},
      ...dispatch2 ? { dispatch: dispatch2 } : {},
      ...tidy ? { tidy } : {},
      ...template ? { template } : {},
      ...tools ? { tools } : {}
    },
    errors,
    warnings
  };
}
function parseEnvironments(raw, profile, errors, opts = {}) {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push('"environments" must list at least one environment.');
    return [];
  }
  const envs = [];
  raw.forEach((e, i) => {
    const at2 = `environments[${i}]`;
    if (!isObj(e) || !isStr(e.name)) {
      errors.push(`${at2}: needs a "name".`);
      return;
    }
    const branch = branchFor(e.name);
    if (e.branch !== void 0 && e.branch !== branch) {
      errors.push(`${at2}: the branch for "${e.name}" must be "${branch}", the environment name in lower case (D-015).`);
    }
    const left = opts.typesFromDiscovery && profile !== "generic" && e.type === void 0;
    const type = e.type ?? (profile === "generic" ? "none" : void 0);
    if (!left && (type === void 0 || !ENV_TYPES.includes(type))) {
      errors.push(`${at2}: "type" must be one of ${ENV_TYPES.join(", ")}.`);
      return;
    }
    if (profile === "salesforce" && type === "none") errors.push(`${at2}: a Salesforce environment needs its org type.`);
    if (e.org !== void 0 && e.org !== null && !isStr(e.org)) errors.push(`${at2}: "org" must be an org alias.`);
    const isProd = type === "production" || left && profile === "salesforce" && branch === "production";
    if (isProd && e.protected === false) errors.push(`${at2}: Production is always protected.`);
    if (e.promotesTo !== void 0 && !strList(e.promotesTo)) errors.push(`${at2}: "promotesTo" must be a list of branches.`);
    envs.push({
      name: e.name,
      branch,
      type: type ?? null,
      org: isStr(e.org) ? e.org : null,
      default: e.default === true,
      protected: isProd || e.protected === true,
      promotesTo: strList(e.promotesTo) ? e.promotesTo.map(branchFor) : []
    });
  });
  const seen = /* @__PURE__ */ new Set();
  for (const env of envs) {
    if (seen.has(env.branch)) errors.push(`Two environments share the branch "${env.branch}".`);
    seen.add(env.branch);
  }
  const defaults = envs.filter((e) => e.default);
  if (envs.length && defaults.length !== 1) errors.push('Mark exactly one environment as "default": the one day-to-day work starts from.');
  for (const d of defaults) if (d.protected) errors.push(`The default environment "${d.name}" can't be protected.`);
  for (const env of envs) {
    for (const to of env.promotesTo) {
      if (to === env.branch) errors.push(`"${env.name}" can't promote to itself.`);
      else if (!seen.has(to)) errors.push(`"${env.name}" promotes to "${to}", which isn't a listed environment.`);
    }
  }
  const cycle = findCycle(envs);
  if (cycle) errors.push(`The promotion paths loop: ${cycle.join(" \u2192 ")}.`);
  return envs;
}
function findCycle(envs) {
  const next = new Map(envs.map((e) => [e.branch, e.promotesTo]));
  const state = /* @__PURE__ */ new Map();
  const stack = [];
  const visit = (b) => {
    if (state.get(b) === "done") return null;
    if (state.get(b) === "visiting") return [...stack.slice(stack.indexOf(b)), b];
    state.set(b, "visiting");
    stack.push(b);
    for (const to of next.get(b) ?? []) {
      const c = visit(to);
      if (c) return c;
    }
    stack.pop();
    state.set(b, "done");
    return null;
  };
  for (const e of envs) {
    const c = visit(e.branch);
    if (c) return c;
  }
  return null;
}
function loadConfig(file) {
  if (!existsSync(file)) throw new AccError("no-config", `No ${file}. Run "acc init" first.`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new AccError("bad-config", `${file} isn't valid JSON: ${e.message}`);
  }
  const r = parseConfig(raw);
  if (!r.config) throw new AccError("bad-config", `${file} has problems:
- ${r.errors.join("\n- ")}`);
  return r;
}
function writeConfig(file, config) {
  mkdirSync(dirname(file), { recursive: true });
  const profile = (p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null));
  const { builder, reviewer, cloud, ...agents } = config.agents;
  const cloudOut = cloud ? { cloud: { ...cloud.routine ? { routine: cloud.routine } : {}, default: cloud.default, quietMinutes: cloud.quietMinutes, max: cloud.max } } : {};
  const out3 = {
    ...config,
    environments: config.environments.map(({ branch: _branch, ...e }) => e),
    // A tracker is written as it was given, so the file loads again: what it doesn't set stays out, and it
    // says it may change tickets only when it may (D-066).
    trackers: config.trackers.map(({ edits, ...t }) => ({
      ...Object.fromEntries(Object.entries(t).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length))),
      ...edits ? { edits } : {}
    })),
    agents: { ...agents, ...Object.keys(profile(builder)).length ? { builder: profile(builder) } : {}, ...Object.keys(profile(reviewer)).length ? { reviewer: profile(reviewer) } : {}, ...cloudOut }
  };
  writeFileSync(file, JSON.stringify(out3, null, 2) + "\n");
}
var TIDY_EVERY = 8;
var tidyEvery = (config) => config.tidy?.every ?? TIDY_EVERY;
function defaultEnvironment(config) {
  const env = config.environments.find((e) => e.default);
  if (!env) throw new AccError("bad-config", "No default environment.");
  return env;
}
function environmentByBranch(config, branch) {
  return config.environments.find((e) => e.branch === branch);
}
var autoMergeOn = (config) => config.autopilot?.autoMerge === true && config.profile !== "salesforce";
function autoMergeFor(config, branch) {
  if (!autoMergeOn(config) || config.autonomy !== "review") return false;
  const env = environmentByBranch(config, branch);
  return !!env && !env.protected;
}
function builderGatesFor(config, branch) {
  return !!config.gates.builder?.length && autoMergeFor(config, branch);
}
var STRAY_FILES = "stray-files";
var withStrayFiles = (config, gates) => config.strayFiles.required && !gates.includes(STRAY_FILES) ? [...gates, STRAY_FILES] : gates;
var fullGates = (config) => withStrayFiles(config, config.gates.required);
function requiredGates(config, branch, scope) {
  return scope === "builder" && builderGatesFor(config, branch) ? withStrayFiles(config, config.gates.builder) : fullGates(config);
}
function isTestGate(config, name) {
  return !!config.gates.tests?.includes(name) || name === "test" || config.profile === "salesforce" && name === "lwc-tests";
}
function keyPrefix(t) {
  if (t.kind === "github") return "GH";
  if (t.kind === "azure") return (t.prefix ?? "AB").toUpperCase();
  if (t.kind === "monday") return (t.prefix ?? "MON").toUpperCase();
  if (t.kind === "slack") return (t.prefix ?? SLACK_PREFIX).toUpperCase();
  return t.project ? t.project.toUpperCase() : null;
}
function trackerForKey(trackers, key) {
  const k2 = key.toUpperCase();
  const i = trackers.findIndex((t) => {
    if (/^GH-\d+$/.test(k2)) return t.kind === "github";
    const p = t.kind === "github" ? null : keyPrefix(t);
    return !!p && k2.startsWith(`${p}-`);
  });
  return i >= 0 ? i : null;
}
function withTracker(trackers, tracker) {
  const where = (t) => t.site ?? t.organization ?? t.account ?? t.workspace ?? t.repo ?? null;
  const board = (t) => t.kind === "monday" && t.board !== void 0 && t.board !== null ? String(t.board) : t.kind === "slack" && isStr(t.channel) ? t.channel.trim().toUpperCase() : null;
  const i = trackers.findIndex((t) => t.kind === tracker.kind && (t.project ?? null) === (tracker.project ?? null) && where(t) === where(tracker) && board(t) === board(tracker));
  if (i < 0) return [...trackers, setKeys(ownPrefix(trackers, tracker))];
  return trackers.map((t, k2) => k2 === i ? setKeys({ ...t, ...tracker }) : t);
}
var rawPrefix = (t) => keyPrefix({ kind: t.kind, project: isStr(t.project) ? t.project : null, prefix: isStr(t.prefix) ? t.prefix : null });
function ownPrefix(trackers, tracker) {
  const base = rawPrefix(tracker);
  if (tracker.kind !== "monday" && tracker.kind !== "slack" || isStr(tracker.prefix) || !base) return tracker;
  const used = new Set(trackers.map(rawPrefix));
  if (!used.has(base)) return tracker;
  let n = 2;
  while (used.has(`${base}${n}`)) n++;
  return { ...tracker, prefix: `${base}${n}` };
}
var setKeys = (t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v !== null && v !== void 0));
function replaceTracker(trackers, index, tracker) {
  const was = trackers[index];
  if (!was || was.kind !== tracker.kind) throw new AccError("config-changed", "The trackers in .acc/config.json changed since this page opened. Open it again from the board.");
  return trackers.map((t, k2) => k2 === index ? setKeys({ ...t, ...tracker }) : t);
}
function saveTracker(file, index, record2) {
  if (!isObj(record2) || !isTrackerKind(record2.kind)) throw new AccError("usage", `A tracker needs a "kind": ${orList([...TRACKER_KINDS])}.`);
  if (index !== null && (!Number.isInteger(index) || index < 0)) throw new AccError("usage", "The tracker to change is its place in the list, from 0.");
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new AccError(existsSync(file) ? "bad-config" : "no-config", existsSync(file) ? `${file} isn't valid JSON: ${e.message}` : `No ${file}. Run "acc init" first.`);
  }
  if (!isObj(raw)) throw new AccError("bad-config", `${file} must be a JSON object.`);
  const was = Array.isArray(raw.trackers) ? raw.trackers : [];
  const trackers = index === null ? withTracker(was, record2) : replaceTracker(was, index, record2);
  const wanted = { ...raw, trackers };
  const checked = parseConfig(wanted);
  if (!checked.config) throw new AccError("bad-config", `That tracker would leave ${file} with problems, so nothing was written:
- ${checked.errors.join("\n- ")}`);
  writeFileSync(file, JSON.stringify(wanted, null, 2) + "\n");
  return { index: index ?? trackers.findIndex((t, k2) => was[k2] !== t), warnings: checked.warnings };
}

// packages/core/src/efforts.ts
var EFFORT_SOURCE = { url: "https://platform.claude.com/docs/en/build-with-claude/effort", read: "2026-10-09" };
var ALL = EFFORTS;
var NO_XHIGH = ["low", "medium", "high", "max"];
var MODEL_EFFORTS = {
  "claude-fable-5-1": { levels: ALL, default: "high" },
  "claude-mythos-5-1": { levels: ALL, default: "high" },
  "claude-fable-5": { levels: ALL, default: "high" },
  "claude-mythos-5": { levels: ALL, default: "high" },
  "claude-mythos-preview": { levels: NO_XHIGH, default: "high" },
  "claude-opus-5-5": { levels: ALL, default: "medium" },
  "claude-opus-5": { levels: ALL, default: "high" },
  "claude-opus-4-8": { levels: ALL, default: "high" },
  "claude-opus-4-7": { levels: ALL, default: "high" },
  "claude-opus-4-6": { levels: NO_XHIGH, default: "high" },
  "claude-opus-4-5": { levels: ["low", "medium", "high"], default: "high" },
  "claude-sonnet-5-5": { levels: ALL, default: "high" },
  "claude-sonnet-5": { levels: ALL, default: "high" },
  "claude-sonnet-4-6": { levels: NO_XHIGH, default: "high" },
  "claude-haiku-5-5": { levels: ALL, default: "medium" },
  "claude-haiku-4-5": { levels: [], default: null }
};
function modelEfforts(model) {
  const base = model.replace(/\[[^\]]*\]$/, "").replace(/-\d{8}$/, "");
  return Object.hasOwn(MODEL_EFFORTS, base) ? MODEL_EFFORTS[base] : null;
}
var effortSourceWords = () => `acc's list of each model's levels is from ${EFFORT_SOURCE.url}, read ${EFFORT_SOURCE.read}`;
function checkEffortName(v, also = "") {
  if (!isEffort(v)) throw new AccError("usage", `"${v}" isn't an effort level. Effort is one of ${EFFORTS.join(", ")}${also}.`);
}
function checkEffortPick(v) {
  if (v !== "default") checkEffortName(v, ", or default for the builder's own");
}
var modelTakes = (model, effort) => modelEfforts(model)?.levels.includes(effort) ?? true;
function checkModelEffort(model, effort, fix) {
  if (!effort || modelTakes(model, effort)) return;
  const m = modelEfforts(model);
  const takes = m.levels.length ? `It takes ${m.levels.join(", ")}.` : "It takes no effort level: leave effort unset for it.";
  throw new AccError("usage", `${model} doesn't take effort ${effort}. ${takes}${fix ? ` ${fix}` : ""} (${effortSourceWords()}.)`);
}
function effortFixWords(id, picked, model, on = "dispatch") {
  const another = (modelEfforts(model)?.levels.length ?? 1) > 0;
  if (on === "resume") {
    return picked ? `It was picked for ${id}, and the builder's model has changed since: set it back with acc agents set builder --model <m>.` : `It's the builder's own: change it with acc agents set builder ${another ? "--effort <level> or " : ""}--clear effort.`;
  }
  return picked ? `It was picked for ${id}: ${another ? `pick another with acc dispatch ${id} --effort <level>, or ` : ""}drop it with acc dispatch ${id} --effort default.` : `It's the builder's own: ${another ? `pick one for ${id} with acc dispatch ${id} --effort <level>, or ` : ""}clear it with acc agents set builder --clear effort.`;
}
function builderEffort(task, config, chosen) {
  const picked = chosen ?? (task.run?.effortPicked ? task.run.effort : void 0);
  return picked && picked !== "default" ? { effort: picked, picked: true } : { effort: config.agents.builder.effort, picked: false };
}
var effortDroppedWords = (effort, model) => `Its effort ${effort}, picked for it before, was dropped: ${model} doesn't take it. The builder's own applies.`;
function dispatchEffort(task, config, model, opts) {
  const earlier = task.held?.effort ?? (task.run?.effortPicked ? task.run.effort : void 0);
  if (opts.effort === void 0 && earlier && earlier !== "default" && opts.modelPicked && !modelTakes(model, earlier)) {
    return { ...builderEffort(task, config, "default"), keep: "default", dropped: earlier };
  }
  const keep = opts.effort ?? earlier;
  return { ...builderEffort(task, config, keep ?? "default"), keep, dropped: null };
}

// packages/core/src/agents.ts
var KEYS = { model: "model", effort: "effort", fallbackModel: "fallbackmodel" };
var gitKey = (role, field) => `acc.${role}.${KEYS[field]}`;
function cloneProfile(run2, root, role) {
  const out3 = {};
  for (const field of Object.keys(KEYS)) {
    const r = run2("git", ["config", "--get", gitKey(role, field)], { cwd: root });
    const v = r.code === 0 ? r.stdout.trim() : "";
    if (!v) continue;
    if (field === "effort") {
      if (isEffort(v)) out3.effort = v;
    } else if (MODEL_NAME.test(v)) out3[field] = v;
  }
  return out3;
}
var modelOf = (p) => p?.model ?? DEFAULT_MODEL;
function profileView(config, run2, root, role) {
  const project2 = config.agents[role];
  const mine = cloneProfile(run2, root, role);
  const pick = (f) => mine[f] != null ? { v: mine[f], from: "clone" } : project2[f] != null ? { v: project2[f], from: "project" } : { v: null, from: "default" };
  const m = pick("model");
  const e = pick("effort");
  const fb = pick("fallbackModel");
  return {
    model: m.v ?? DEFAULT_MODEL,
    effort: e.v,
    fallbackModel: fb.v,
    from: { model: m.from === "default" ? "acc" : m.from, effort: e.from, fallbackModel: fb.from }
  };
}
function withCloneAgents(config, root, run2) {
  const merge = (role) => ({ ...config.agents[role], ...cloneProfile(run2, root, role) });
  return { ...config, agents: { ...config.agents, builder: merge("builder"), reviewer: merge("reviewer") } };
}
function agentArgs(p) {
  const model = modelOf(p);
  return ["--model", model, ...p?.effort ? ["--effort", p.effort] : [], ...p?.fallbackModel && p.fallbackModel !== model ? ["--fallback-model", p.fallbackModel] : []];
}
function checkModelName(v) {
  if (!MODEL_NAME.test(v)) throw new AccError("usage", `"${v}" isn't a model name. Use an alias such as opus, sonnet or fable, or a full model name.`);
}
function check(change2) {
  for (const f of ["model", "fallbackModel"]) {
    const v = change2[f];
    if (v != null) checkModelName(v);
  }
  if (change2.effort != null) checkEffortName(change2.effort);
}
function setProfile(run2, root, configFile, role, change2, scope) {
  check(change2);
  if (scope === "clone") {
    for (const f of Object.keys(change2)) {
      const v = change2[f];
      if (v === void 0) continue;
      const r = v === null ? run2("git", ["config", "--unset", gitKey(role, f)], { cwd: root }) : run2("git", ["config", gitKey(role, f), v], { cwd: root });
      if (r.code !== 0 && !(v === null && r.code === 5)) throw new AccError("git", `git config refused ${gitKey(role, f)}: ${r.stderr.trim()}`);
    }
    return;
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync2(configFile, "utf8"));
  } catch (e) {
    throw new AccError("bad-config", `Couldn't read ${configFile}: ${e.message}`);
  }
  raw.agents ??= {};
  const p = { ...raw.agents[role] ?? {} };
  for (const f of Object.keys(change2)) {
    const v = change2[f];
    if (v === void 0) continue;
    if (v === null) delete p[f];
    else p[f] = v;
  }
  if (Object.keys(p).length) raw.agents[role] = p;
  else delete raw.agents[role];
  writeFileSync2(configFile, JSON.stringify(raw, null, 2) + "\n");
}
var SETTABLE_AUTONOMY = ["manual", "review"];
function setAutonomy(configFile, value) {
  if (value === "dispatch" || value === "full") {
    throw new AccError("refused", `autonomy "${value}" isn't built yet: autopilot would also start Ready tasks (D-055). Choose manual or review.`);
  }
  if (!SETTABLE_AUTONOMY.includes(value)) throw new AccError("usage", `Autonomy is ${SETTABLE_AUTONOMY.join(" or ")}.`);
  let text;
  let raw;
  try {
    text = readFileSync2(configFile, "utf8");
    raw = JSON.parse(text);
  } catch (e) {
    throw new AccError("bad-config", `Couldn't read ${configFile}: ${e.message}`);
  }
  const wanted = { ...raw, autonomy: value };
  const at2 = [...text.matchAll(/("autonomy"\s*:\s*)"[^"\\]*"/g)];
  if (at2.length === 1) {
    const edited = text.replace(/("autonomy"\s*:\s*)"[^"\\]*"/, `$1${JSON.stringify(value)}`);
    try {
      if (JSON.stringify(JSON.parse(edited)) === JSON.stringify(wanted)) {
        writeFileSync2(configFile, edited);
        return;
      }
    } catch {
    }
  }
  writeFileSync2(configFile, JSON.stringify(wanted, null, 2) + "\n");
}
function setAutoMerge(configFile, on) {
  let text;
  let raw;
  try {
    text = readFileSync2(configFile, "utf8");
    raw = JSON.parse(text);
  } catch (e) {
    throw new AccError("bad-config", `Couldn't read ${configFile}: ${e.message}`);
  }
  if (on && raw.profile === "salesforce") throw new AccError("refused", "A Salesforce project never auto-merges: a person merges every pull request there.");
  const was = raw.autopilot && typeof raw.autopilot === "object" && !Array.isArray(raw.autopilot) ? raw.autopilot : null;
  if (!on && was?.autoMerge === void 0) return;
  const wanted = { ...raw, autopilot: { ...was ?? {}, autoMerge: on } };
  const canon2 = (v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k2) => [k2, canon2(v[k2])])) : Array.isArray(v) ? v.map(canon2) : v;
  const fits = (edited) => {
    try {
      return JSON.stringify(canon2(JSON.parse(edited))) === JSON.stringify(canon2(wanted));
    } catch {
      return false;
    }
  };
  const tries = [];
  const value = /("autoMerge"\s*:\s*)(true|false)/;
  if ([...text.matchAll(new RegExp(value, "g"))].length === 1) tries.push(text.replace(value, `$1${on}`));
  const block = /("autopilot"\s*:\s*\{)(\s*)(?=")/;
  if (block.test(text)) tries.push(text.replace(block, (_m, open, gap) => `${open}${gap}"autoMerge": ${on},${gap}`));
  const indent = /^\{\s*?\n([ \t]+)"/.exec(text)?.[1] ?? "  ";
  if (!was) tries.push(text.replace(/(\S)(\s*)\}\s*$/, (_m, last, gap) => `${last},
${indent}"autopilot": {
${indent}${indent}"autoMerge": ${on}
${indent}}${gap}}
`));
  writeFileSync2(configFile, tries.find(fits) ?? JSON.stringify(wanted, null, 2) + "\n");
}

// packages/core/src/analyze.ts
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync as existsSync5, mkdirSync as mkdirSync6, readFileSync as readFileSync8, renameSync as renameSync4, rmSync as rmSync5, writeFileSync as writeFileSync8 } from "node:fs";
import { join as join5 } from "node:path";

// packages/core/src/awake.ts
import { spawn, spawnSync as spawnSync2 } from "node:child_process";
import { mkdirSync as mkdirSync3, readFileSync as readFileSync4, rmSync as rmSync2, writeFileSync as writeFileSync4 } from "node:fs";
import { basename as basename2, join as join2 } from "node:path";

// packages/core/src/lock.ts
import { mkdirSync as mkdirSync2, readFileSync as readFileSync3, rmSync, statSync, writeFileSync as writeFileSync3 } from "node:fs";
import { join } from "node:path";
var sleep = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
function withLock(lockDir, fn2, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 15e3;
  const staleMs = opts.staleMs ?? 6e4;
  const started = Date.now();
  for (; ; ) {
    try {
      mkdirSync2(lockDir);
      writeFileSync3(join(lockDir, "owner"), JSON.stringify({ pid: process.pid, at: Date.now() }));
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let owner = null;
      try {
        owner = JSON.parse(readFileSync3(join(lockDir, "owner"), "utf8"));
      } catch {
        owner = null;
      }
      let age = 0;
      try {
        age = Date.now() - (owner?.at ?? statSync(lockDir).mtimeMs);
      } catch {
        continue;
      }
      if (owner && !alive(owner.pid) || age > staleMs) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started > timeoutMs) {
        throw new AccError("lock-timeout", `Another acc process is holding ${lockDir}. Try again in a moment.`);
      }
      sleep(20 + Math.floor(Math.random() * 40));
    }
  }
  try {
    return fn2();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

// packages/core/src/awake.ts
var detached = (cmd, args) => {
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.on("error", () => void 0);
  return child;
};
var stop = (pid) => {
  try {
    process.kill(pid);
  } catch {
  }
};
function holdAwake(watchPid, deps = {}) {
  if ((deps.platform ?? process.platform) !== "darwin" || !Number.isInteger(watchPid) || watchPid <= 0) return null;
  const child = (deps.spawn ?? detached)("caffeinate", ["-i", "-w", String(watchPid)]);
  child.unref();
  const pid = child.pid;
  if (!pid) return null;
  const kill = deps.kill ?? stop;
  return { pid, release: () => kill(pid) };
}
var awakePath = (paths, id) => join2(paths.stateDir, "awake", `${id}.pid`);
function isCaffeinate(pid) {
  if (!alive(pid)) return false;
  const r = spawnSync2("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" });
  return r.status === 0 && basename2(r.stdout.trim()) === "caffeinate";
}
function keepAwakeFor(paths, id, watchPid, deps = {}) {
  releaseAwake(paths, id, deps);
  const held = holdAwake(watchPid, deps);
  if (!held) return null;
  try {
    mkdirSync3(join2(paths.stateDir, "awake"), { recursive: true });
    writeFileSync4(awakePath(paths, id), JSON.stringify({ pid: held.pid, watch: watchPid }));
  } catch {
  }
  return held;
}
function releaseAwake(paths, id, deps = {}) {
  const file = awakePath(paths, id);
  let rec;
  try {
    rec = JSON.parse(readFileSync4(file, "utf8"));
  } catch {
    return false;
  }
  rmSync2(file, { force: true });
  if (!Number.isInteger(rec.pid) || rec.pid <= 0) return false;
  if (deps.kill) deps.kill(rec.pid);
  else if (isCaffeinate(rec.pid)) stop(rec.pid);
  return true;
}

// packages/core/src/names.ts
var NAME_PART_MAX = 40;
var NAME_SEP = " \xB7 ";
var SECRET_PREFIX = /^(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|sk-|xox|AKIA|eyJ)/;
var tokenLike = (word) => SECRET_PREFIX.test(word) || word.length >= 20 && new RegExp("\\p{L}", "u").test(word) && new RegExp("\\p{N}", "u").test(word);
function cleanName(text) {
  return text.normalize("NFC").replace(/[\p{Cc}\p{Z}\s/\\~·]+/gu, " ").replace(/[^\p{L}\p{M}\p{N} _.,:()+#-]/gu, "").split(" ").filter((w) => w && !tokenLike(w)).join(" ");
}
function shortTitle(text, max = NAME_PART_MAX) {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = chars.slice(0, max).join("");
  const hard = chars.slice(0, max - 1).join("");
  const space = head.lastIndexOf(" ");
  const cut3 = (space > 0 ? head.slice(0, space) : hard).replace(/[\s.,:(+#_-]+$/u, "");
  return `${cut3 || hard}\u2026`;
}
var cleanKey = (key) => /^[A-Z][A-Z0-9_]*-\d+$/.test(key) ? key : key.replace(/[^A-Za-z0-9_-]/g, "");
function sessionName(p) {
  const project2 = shortTitle(cleanName(p.project));
  const title = shortTitle(cleanName(p.title));
  const key = cleanKey(p.key);
  const task = [key, title].filter(Boolean).join(" ");
  const role = p.role === "builder" && p.n && p.n > 1 ? `${p.role} ${p.n}` : p.role;
  return [project2, task, role].filter(Boolean).join(NAME_SEP);
}

// packages/core/src/ledger.ts
import { appendFileSync, closeSync, existsSync as existsSync2, mkdirSync as mkdirSync4, openSync, readFileSync as readFileSync5, readSync, renameSync, statSync as statSync2, writeFileSync as writeFileSync5 } from "node:fs";
import { dirname as dirname2 } from "node:path";
var STATES = ["todo", "running", "review", "rework", "blocked", "done"];
var ACTORS = ["human", "orchestrator", "builder", "reviewer", "sync"];
var SOURCE_KINDS = [...TRACKER_KINDS, "manual"];
var AUTOPILOT_STEPS = ["review", "land", "dispatch", "refresh", "resume", "checks", "merge", "start", "queue"];
var emptyLedger = () => ({ schema: 1, seq: 0, tasks: [] });
function readLedger(file) {
  if (!existsSync2(file)) return emptyLedger();
  const l3 = JSON.parse(readFileSync5(file, "utf8"));
  if (l3.schema !== 1 || !Array.isArray(l3.tasks)) throw new AccError("bad-ledger", `${file} isn't a ledger this version understands.`);
  return l3;
}
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync5(tmp, text);
  renameSync(tmp, file);
}
function mutate(paths, now2, fn2) {
  mkdirSync4(paths.stateDir, { recursive: true });
  return withLock(paths.lock, () => {
    const ledger = readLedger(paths.ledger);
    const events = [];
    const emit = (e) => events.push({ ...e, seq: ++ledger.seq, at: now2().toISOString() });
    const result = fn2(ledger, emit);
    if (events.length) {
      mkdirSync4(dirname2(paths.events), { recursive: true });
      appendFileSync(paths.events, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
      writeAtomic(paths.ledger, JSON.stringify(ledger, null, 2) + "\n");
    }
    return result;
  });
}
var JIRA_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
function normalizeId(ref, defaultKind = "jira") {
  const r = ref.trim();
  const gh = /^(?:#|GH-)?(\d+)$/i.exec(r);
  if (gh && (defaultKind === "github" || /^(#|GH-)/i.test(r))) return `GH-${gh[1]}`;
  return r.toUpperCase();
}
function isValidId(id) {
  return JIRA_KEY.test(id);
}
function nextManualId(ledger) {
  const n = ledger.tasks.map((t) => /^T-(\d+)$/.exec(t.id)?.[1]).filter(Boolean).map(Number);
  return `T-${(n.length ? Math.max(...n) : 0) + 1}`;
}
function environmentProblem(config, env) {
  const def = environmentByBranch(config, env);
  if (!def) return `environment "${env}" isn't in the config.`;
  if (def.protected) return `"${env}" is protected, so no task can build on it directly.`;
  return null;
}
var taskDeps = (deps, kind) => deps.map((d) => normalizeId(d, kind));
function upsertTasks(ledger, config, inputs, actor, by, emit, now2) {
  const res = { added: [], updated: [], unchanged: [], errors: [] };
  const defaultEnv = defaultEnvironment(config).branch;
  inputs.forEach((input, i) => {
    const at2 = `item ${i + 1}`;
    if (!input || typeof input.title !== "string" || !input.title.trim()) {
      res.errors.push(`${at2}: needs a title.`);
      return;
    }
    const kind = input.source?.kind;
    if (!SOURCE_KINDS.includes(kind)) {
      res.errors.push(`${at2}: source kind must be ${SOURCE_KINDS.join(", ")}.`);
      return;
    }
    let id;
    if (kind === "manual") id = input.source.key ? normalizeId(input.source.key) : nextManualId(ledger);
    else {
      if (!input.source.key) {
        res.errors.push(`${at2}: a ${kind} task needs its tracker key.`);
        return;
      }
      id = normalizeId(input.source.key, kind);
    }
    if (!isValidId(id)) {
      res.errors.push(`${at2}: "${id}" isn't a valid task id.`);
      return;
    }
    const env = input.environment ?? defaultEnv;
    const envWhy = environmentProblem(config, env);
    if (envWhy) {
      res.errors.push(`${id}: ${envWhy}`);
      return;
    }
    const deps = taskDeps(input.deps ?? [], kind);
    const fields = {
      title: input.title.trim(),
      brief: (input.brief ?? "").trim(),
      deps,
      labels: input.labels ?? [],
      url: input.source.url ?? null
    };
    const existing = ledger.tasks.find((t) => t.id === id);
    const stamp = now2().toISOString();
    if (!existing) {
      const task = {
        id,
        title: fields.title,
        brief: fields.brief,
        source: { kind, key: kind === "manual" ? null : input.source.key ?? null, url: fields.url },
        environment: env,
        deps,
        labels: fields.labels,
        state: "todo",
        blocker: null,
        run: null,
        pr: null,
        history: [{ at: stamp, actor, by, from: null, to: "todo", reason: null }],
        createdAt: stamp,
        updatedAt: stamp
      };
      ledger.tasks.push(task);
      emit({ type: "task.added", task: id, actor, by, data: { title: task.title, source: task.source } });
      res.added.push(id);
      return;
    }
    const changed = {};
    if (existing.title !== fields.title) changed.title = existing.title = fields.title;
    if (existing.brief !== fields.brief) changed.brief = existing.brief = fields.brief;
    if (existing.source.url !== fields.url) changed.url = existing.source.url = fields.url;
    if (JSON.stringify(existing.deps) !== JSON.stringify(deps)) changed.deps = existing.deps = deps;
    if (JSON.stringify(existing.labels) !== JSON.stringify(fields.labels)) changed.labels = existing.labels = fields.labels;
    if (Object.keys(changed).length) {
      existing.updatedAt = stamp;
      emit({ type: "task.updated", task: id, actor, by, data: changed });
      res.updated.push(id);
    } else res.unchanged.push(id);
  });
  return res;
}
var DONE_COMMAND = `acc done --landed "<what landed>" --moved "<tests, checks, ratchets that moved>" --open "<what's still open, or none>"`;
var NOTE_LIMITS = { lines: 10, chars: 300 };
var NOTE_PARTS = ["landed", "moved", "open"];
function noteInput(parts) {
  const out3 = {};
  for (const k2 of NOTE_PARTS) {
    const given2 = parts[k2];
    if (given2 === void 0) continue;
    out3[k2] = given2.map((l3) => l3.replace(/\s+/g, " ").trim()).filter((l3) => l3 && l3.toLowerCase() !== "none");
  }
  return out3;
}
var NOTE_LABELS = { landed: "What landed", moved: "Numbers that moved", open: "Still open" };
function noteMarkdown(n) {
  return NOTE_PARTS.flatMap((k2, i) => [...i ? [""] : [], `**${NOTE_LABELS[k2]}**`, "", ...n[k2].length ? n[k2].map((l3) => `- ${l3}`) : ["- none"]]);
}
function shownNote(task) {
  const r = task.run;
  if (!r) return { note: null, fromLast: false, missing: false };
  if (r.note) return { note: r.note, fromLast: false, missing: false };
  if (task.state === "running") return { note: r.before ?? null, fromLast: true, missing: r.before === null };
  return { note: null, fromLast: false, missing: task.state !== "done" };
}
var noteGiven = (n) => !!n && NOTE_PARTS.some((k2) => n[k2] !== void 0);
function noteProblems(n, required) {
  const p = [];
  for (const k2 of NOTE_PARTS) {
    const lines = n?.[k2] ?? [];
    if (lines.length > NOTE_LIMITS.lines) p.push(`The note's --${k2} has ${lines.length} lines. It takes at most ${NOTE_LIMITS.lines}.`);
    const long = lines.filter((l3) => l3.length > NOTE_LIMITS.chars).length;
    if (long) p.push(`${long === 1 ? "A line" : `${long} lines`} in the note's --${k2} ${long === 1 ? "is" : "are"} over ${NOTE_LIMITS.chars} characters. Say it shorter.`);
  }
  if (required) {
    const missing = NOTE_PARTS.filter((k2) => n?.[k2] === void 0 || k2 === "landed" && !n[k2].length);
    if (missing.length) {
      p.push(`A builder finishes with a note for whoever comes next: what landed, which numbers moved, and what's still open (it says nothing about ${missing.map((k2) => `--${k2}`).join(", ")}). Run: ${DONE_COMMAND}. Give a flag again for each further line. --moved none and --open none say there was nothing.`);
    }
  }
  return p;
}
var RULES = [
  { from: "todo", to: "running", actors: ["human", "orchestrator"], requires: ["depsDone", "underCap", "envNotProtected"] },
  { from: "running", to: "review", actors: ["builder", "human"], requires: ["gatesPassed", "note"] },
  // The orchestrator is autopilot sending back a pull request whose checks failed on GitHub (D-076).
  { from: "review", to: "rework", actors: ["reviewer", "human", "orchestrator"], requires: ["reason"] },
  { from: "rework", to: "running", actors: ["human", "orchestrator"], requires: ["underCap", "envNotProtected"] },
  { from: "review", to: "done", actors: ["sync", "human"], requires: [] },
  // Its issue was closed on GitHub before anyone started it: acc intake moves it.
  { from: "todo", to: "done", actors: ["sync"], requires: [] },
  { from: "running", to: "todo", actors: ["human"], requires: ["reason"] },
  { from: "done", to: "rework", actors: ["human", "sync"], requires: ["reason"] },
  { from: "blocked", to: "todo", actors: ["human"], requires: [] },
  // A person settled what blocked finished work, such as by waiving a check (D-031).
  { from: "blocked", to: "review", actors: ["human"], requires: ["gatesPassed"] },
  { from: "any", to: "blocked", actors: [...ACTORS], requires: ["reason"] }
];
var noGateHooks = { missingGates: () => [] };
function findRule(from, to) {
  return RULES.find((r) => r.from === from && r.to === to) ?? RULES.find((r) => r.from === "any" && r.to === to && from !== "blocked" && from !== "done");
}
var runPlace = (run2) => run2?.where === "cloud" ? "cloud" : "local";
var builders = (ledger, except, where = "local") => ledger.tasks.filter((t) => t.state === "running" && t.id !== except && runPlace(t.run) === where).length;
var projectCapWords = (n, max) => `${n} ${n === 1 ? "builder is" : "builders are"} running in this project, and its cap is ${max} (agents.max).`;
var cloudCapWords = (n, max) => `${n} cloud ${n === 1 ? "builder is" : "builders are"} running for this project, and its cap is ${max} (agents.cloud.max).`;
function checkMove(ledger, config, task, req, hooks) {
  if (!STATES.includes(req.to)) return [`"${req.to}" isn't a state. States: ${STATES.join(", ")}.`];
  if (!ACTORS.includes(req.actor)) return [`"${req.actor}" isn't an actor.`];
  if (task.state === req.to) return [`${task.id} is already ${req.to}.`];
  const reason = req.reason?.trim() ?? "";
  if (noteGiven(req.note)) {
    if (!task.run || req.to !== "review" && req.to !== "blocked") return [`A note goes with a run's end: acc done, or acc block. ${task.id} ${task.run ? `is moving to ${req.to}` : "has no run"}.`];
    const over = noteProblems(req.note, false);
    if (over.length) return over;
  }
  if (req.force) {
    const p = [];
    if (req.actor !== "human") p.push("Only a person can force a move.");
    if (!reason) p.push("A forced move needs --reason.");
    return p;
  }
  const rule = findRule(task.state, req.to);
  if (!rule) return [`There's no rule for ${task.state} \u2192 ${req.to}. A person can force it with --force --reason.`];
  if (!rule.actors.includes(req.actor)) {
    return [`A ${req.actor} can't move a task from ${task.state} to ${req.to}. Allowed: ${rule.actors.join(", ")}.`];
  }
  const problems = [];
  for (const r of rule.requires) {
    if (r === "reason" && !reason) problems.push(`Moving to ${req.to} needs a reason.`);
    if (r === "depsDone") {
      for (const d of task.deps) {
        const dep = ledger.tasks.find((t) => t.id === d);
        if (!dep) problems.push(`It depends on ${d}, which isn't in the ledger.`);
        else if (dep.state !== "done") problems.push(`It's waiting on ${d}, which is ${dep.state}.`);
      }
    }
    if (r === "underCap") {
      if (req.where === "cloud") {
        const max = config.agents.cloud?.max ?? 0;
        const running = builders(ledger, task.id, "cloud");
        if (!config.agents.cloud) problems.push("This project hasn't opted in to cloud builders (agents.cloud).");
        else if (running >= max) problems.push(cloudCapWords(running, max));
      } else {
        const running = builders(ledger, task.id);
        if (running >= config.agents.max) problems.push(projectCapWords(running, config.agents.max));
      }
    }
    if (r === "envNotProtected") {
      const env = environmentByBranch(config, task.environment);
      if (!env) problems.push(`Its environment "${task.environment}" isn't in the config.`);
      else if (env.protected) problems.push(`"${env.name}" is protected. Agents never work on it directly.`);
    }
    if (r === "gatesPassed") {
      const missing = hooks.missingGates(task);
      if (missing.length) problems.push(`These required checks haven't passed on the current commit: ${missing.join(", ")}. Commit everything, then run: acc gate run`);
    }
    if (r === "note" && req.actor === "builder") problems.push(...noteProblems(req.note, true));
  }
  return problems;
}
function applyMove(task, req, emit, now2, data = {}) {
  const at2 = now2().toISOString();
  const entry = { at: at2, actor: req.actor, by: req.by, from: task.state, to: req.to, reason: req.reason?.trim() || null };
  if (req.force) entry.override = true;
  task.blocker = req.to === "blocked" ? entry.reason ?? null : null;
  if (task.autopilot?.failed) task.autopilot.failed = null;
  if (task.autopilot?.queued) task.autopilot.queued = null;
  if (task.autopilot?.carried) task.autopilot.carried = null;
  if (task.held) task.held = null;
  const note = noteGiven(req.note) && task.run && (req.to === "review" || req.to === "blocked") ? { landed: req.note.landed ?? [], moved: req.note.moved ?? [], open: req.note.open ?? [], at: at2, by: req.by, ended: req.to } : null;
  if (note) task.run.note = note;
  task.state = req.to;
  task.updatedAt = at2;
  task.history.push(entry);
  emit({ type: "task.moved", task: task.id, actor: req.actor, by: req.by, data: { from: entry.from, to: entry.to, reason: entry.reason, override: req.force ?? false, ...note ? { note } : {}, ...data } });
  return entry;
}
function moveTask(paths, config, id, req, hooks, now2) {
  const moved = mutate(paths, now2, (ledger, emit) => {
    const task = ledger.tasks.find((t) => t.id === id);
    if (!task) throw new AccError("no-task", `No task ${id}.`);
    const problems = checkMove(ledger, config, task, req, hooks);
    if (problems.length) throw new AccError("move-refused", `Can't move ${id} to ${req.to}:
- ${problems.join("\n- ")}`);
    const entry = applyMove(task, req, emit, now2);
    return { task, entry };
  });
  if (moved.entry.from === "running") releaseAwake(paths, id);
  return moved;
}
function isReady(ledger, task) {
  return task.state === "todo" && task.deps.every((d) => ledger.tasks.find((t) => t.id === d)?.state === "done");
}
var autopilotFailure = (task) => task.autopilot?.failed && task.autopilot.failed.state === task.state ? task.autopilot.failed : null;
function sessionsOf(task, sessions) {
  const run2 = task.run;
  if (run2?.where === "cloud") return [];
  if (run2?.bgId || run2?.sessionId) return sessions.filter((s) => !!run2.bgId && s.id === run2.bgId || !!run2.sessionId && s.sessionId === run2.sessionId);
  const name = run2?.name ?? task.id;
  return sessions.filter((s) => s.kind === "background" && s.name === name);
}
function sessionActive(s) {
  if (!s.pid) return false;
  if (s.kind !== "background") return true;
  if (s.state === "done" || s.state === "failed" || s.state === "stopped") return false;
  return s.status !== "idle";
}
var STOPPED_GRACE_MS = 2 * 6e4;
function runStartedAt(task) {
  const times = [task.run?.startedAt, ...(task.run?.resumes ?? []).map((r) => r.at)].filter((t) => !!t);
  return times.sort().at(-1) ?? null;
}
function builderStopped(task, sessions, o) {
  if (task.state !== "running" || !sessions || o.resuming) return false;
  if (task.run?.where === "cloud") return false;
  const started = runStartedAt(task);
  if (!started || o.now.getTime() - Date.parse(started) < (o.graceMs ?? STOPPED_GRACE_MS)) return false;
  return !sessionsOf(task, sessions).some(sessionActive);
}
var closedPr = (task) => task.state === "review" && task.pr?.state === "closed" ? task.pr : null;
var AUTOPILOT_BY = "orchestrator:autopilot";
var sentBackByAutopilot = (h2) => h2.from === "review" && h2.to === "rework" && h2.by === AUTOPILOT_BY;
function reworkCause(task) {
  const h2 = task.history.findLast((x2) => x2.to === "rework");
  if (!h2) return null;
  return sentBackByAutopilot(h2) ? task.autopilot?.sentBack?.kind ?? "checks" : "review";
}
var SEND_BACKS = 3;
var sendBacks = (task) => task.history.filter(sentBackByAutopilot).length;
var sentBackAt = (task, sha) => !!sha && task.autopilot?.sentBack?.sha === sha;
var inQueue = (task, config) => task.state === "review" && !!task.autopilot?.queued && autoMergeFor(config, task.environment);
function displayState(ledger, task, session, config) {
  if (task.state === "todo" && task.held?.failed) return "needs-you";
  if (task.state === "todo" && isReady(ledger, task)) return "ready";
  if (autopilotFailure(task)) return "needs-you";
  if (task.state === "running" && (session?.stopped || session?.quiet || session?.state === "blocked" || session?.status === "waiting")) return "needs-you";
  if (task.state === "review" && task.pr?.state === "open" && (task.pr.ci === "failing" && !sentBackAt(task, task.pr.sha) || task.pr.changesRequested || !!task.pr.conflicts?.length && !(config && inQueue(task, config)))) return "needs-you";
  if (closedPr(task)) return "needs-you";
  return task.state;
}
var DISPLAY = {
  todo: { label: "To do", icon: "circle-outline", glyph: "\u25CB", tone: "neutral" },
  ready: { label: "Ready", icon: "play-circle", glyph: "\u25B7", tone: "blue" },
  running: { label: "Running", icon: "sync", glyph: "\u21BB", tone: "blue" },
  "needs-you": { label: "Needs you", icon: "bell", glyph: "!", tone: "orange" },
  review: { label: "In review", icon: "eye", glyph: "\u25CE", tone: "blue" },
  rework: { label: "Rework", icon: "debug-restart", glyph: "\u21BA", tone: "orange" },
  blocked: { label: "Blocked", icon: "circle-slash", glyph: "\u2298", tone: "orange" },
  done: { label: "Done", icon: "check", glyph: "\u2713", tone: "neutral" }
};

// packages/core/src/rules.ts
import { createHash } from "node:crypto";
import { existsSync as existsSync4, mkdirSync as mkdirSync5, mkdtempSync as mkdtempSync2, readdirSync, readFileSync as readFileSync7, renameSync as renameSync2, rmSync as rmSync4, writeFileSync as writeFileSync6 } from "node:fs";
import { homedir as homedir2, tmpdir as tmpdir2 } from "node:os";
import { basename as basename3, dirname as dirname3, isAbsolute as isAbsolute2, join as join4 } from "node:path";

// packages/core/src/source.ts
import { existsSync as existsSync3, mkdtempSync, readFileSync as readFileSync6, rmSync as rmSync3, statSync as statSync3 } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join as join3, relative, resolve, sep } from "node:path";
var COPY_KINDS = {
  template: {
    noun: "team template",
    short: "template",
    recordedIn: "the project's config",
    example: "templates/salesforce.json",
    maxBytes: 64 * 1024,
    bad: "bad-template",
    missing: "no-template"
  },
  rules: {
    noun: "rules file",
    short: "rules file",
    recordedIn: "the copy's header",
    example: "rules/salesforce.md",
    maxBytes: 64 * 1024,
    bad: "bad-rules",
    missing: "no-rules"
  }
};
var FETCH_TIMEOUT_MS = 2 * 6e4;
var a = (s) => /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`;
var possessive = (s) => `${s[0].toUpperCase()}${s.slice(1)}'s`;
function sourceProblem(source, kind = "template") {
  const k2 = COPY_KINDS[kind];
  const s = source.trim();
  if (!s) return "Give a path, a GitHub file URL, or <git-url>#<path>.";
  if (s.startsWith("-")) return `${possessive(a(k2.short))} source can't start with "-", which git would read as an option. For a file, start it with ./`;
  if (/^http:\/\//i.test(s)) return `Use https://: acc doesn't fetch ${a(k2.short)} over plain http.`;
  const userinfo = /^[a-z][a-z0-9+.-]*:\/\/([^/@#?]*)@/i.exec(s);
  if (userinfo && (/^https:/i.test(s) || userinfo[1].includes(":"))) return `Take the sign-in out of the URL: gh and git sign in for you, and the source is written into ${k2.recordedIn}.`;
  return null;
}
var GITHUB_BLOB = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:blob|raw)\/([^/?#]+)\/([^?#]+)(?:[?#].*)?$/;
var GITHUB_RAW = /^https:\/\/raw\.githubusercontent\.com\/([\w.-]+)\/([\w.-]+)\/(?:refs\/(?:heads|tags)\/)?([^/?#]+)\/([^?#]+)(?:[?#].*)?$/;
function parseSource(source, base = process.cwd(), home = homedir(), kind = "template") {
  const k2 = COPY_KINDS[kind];
  const s = source.trim();
  const problem = sourceProblem(s, kind);
  if (problem) throw new AccError(k2.bad, problem);
  const gh = GITHUB_BLOB.exec(s) ?? GITHUB_RAW.exec(s);
  if (gh) return { kind: "github", owner: gh[1], repo: gh[2], ref: decodeURIComponent(gh[3]), path: decodeURIComponent(gh[4]) };
  const hash = s.lastIndexOf("#");
  if (hash > 0) {
    const path = s.slice(hash + 1).replace(/^\/+/, "");
    if (!path || path.split("/").includes("..")) throw new AccError(k2.bad, `"${s}" needs a file's path in the repo after the #, such as #${k2.example}.`);
    return { kind: "git", url: s.slice(0, hash), path };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    throw new AccError(k2.bad, `acc fetches ${a(k2.short)} only with gh or git. Give a github.com file URL, <git-url>#<path>, or a path. "${s}" is neither.`);
  }
  const expanded = s === "~" ? home : s.startsWith("~/") ? join3(home, s.slice(2)) : s;
  return { kind: "file", path: resolve(base, expanded) };
}
function recordedSource(source, opts = {}) {
  const src = parseSource(source, opts.base, opts.home, opts.kind);
  if (src.kind !== "file") return source.trim();
  const inside2 = (dir) => {
    const rel = relative(dir, src.path);
    return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split(sep).join("/") : null;
  };
  const inRepo2 = opts.root ? inside2(opts.root) : null;
  if (inRepo2) return inRepo2.startsWith("-") ? `./${inRepo2}` : inRepo2;
  const inHome = inside2(opts.home ?? homedir());
  return inHome ? `~/${inHome}` : src.path;
}
var firstLine = (s) => s.trim().split("\n")[0] ?? "";
function fetchSource(run2, source, kind, opts = {}) {
  const k2 = COPY_KINDS[kind];
  const src = parseSource(source, opts.base, opts.home, kind);
  const total = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const deadline = opts.deadline ?? Date.now() + total;
  const timeoutMs = () => {
    const left = deadline - Date.now();
    const secs = Math.ceil(total / 1e3);
    if (left <= 0) throw new AccError(k2.missing, `Couldn't read ${source} within ${secs} second${secs === 1 ? "" : "s"}, so acc stopped.`);
    return left;
  };
  const tooBig = () => new AccError(k2.bad, `${source} is over ${k2.maxBytes / 1024} KB, too big for ${a(k2.noun)}.`);
  const env = opts.env ?? process.env;
  if (src.kind === "file") {
    if (!existsSync3(src.path)) throw new AccError(k2.missing, `There's no ${k2.noun} at ${source}.`);
    const stat = statSync3(src.path);
    if (!stat.isFile()) throw new AccError(k2.bad, `${source} isn't a file, so it can't be ${a(k2.noun)}.`);
    if (stat.size > k2.maxBytes) throw tooBig();
    return { text: readFileSync6(src.path, "utf8"), commit: null };
  }
  if (src.kind === "github") {
    const who = opts.account ?? "gh's active account";
    let ghEnv3 = env;
    if (opts.account) {
      const t = run2("gh", ["auth", "token", "-u", opts.account], { env, timeoutMs: timeoutMs() });
      if (t.code !== 0 || !t.stdout.trim()) throw new AccError("no-github", `gh isn't logged in as ${opts.account}, the account that reads ${source}. Sign in from Setup, or run gh auth login.`);
      ghEnv3 = { ...env, GH_TOKEN: t.stdout.trim() };
    }
    const path = src.path.split("/").map(encodeURIComponent).join("/");
    const r = run2("gh", ["api", `repos/${src.owner}/${src.repo}/contents/${path}?ref=${encodeURIComponent(src.ref)}`, "-H", "Accept: application/vnd.github.raw"], { env: ghEnv3, timeoutMs: timeoutMs() });
    if (r.code !== 0) {
      const why = firstLine(r.stderr || r.stdout);
      if (/\b404\b|not found/i.test(why)) throw new AccError(k2.missing, `${source} wasn't found as ${who}. Check the address, and that ${who} can read ${src.owner}/${src.repo}.`);
      throw new AccError(k2.missing, `Couldn't read ${source} as ${who}: ${why || `gh exited ${r.code}`}`);
    }
    if (Buffer.byteLength(r.stdout) > k2.maxBytes) throw tooBig();
    if (!opts.commit) return { text: r.stdout, commit: null };
    const c = run2("gh", ["api", `repos/${src.owner}/${src.repo}/commits?path=${encodeURIComponent(src.path)}&sha=${encodeURIComponent(src.ref)}&per_page=1`, "--jq", ".[0].sha"], { env: ghEnv3, timeoutMs: timeoutMs() });
    const sha = c.stdout.trim();
    return { text: r.stdout, commit: c.code === 0 && /^[0-9a-f]{40}$/.test(sha) ? sha : null };
  }
  const dir = mkdtempSync(join3(tmpdir(), `acc-${kind}-`));
  try {
    const gitEnv = { ...env, GIT_TERMINAL_PROMPT: "0", ...env.GIT_SSH_COMMAND ? {} : { GIT_SSH_COMMAND: "ssh -o BatchMode=yes" } };
    const clone = run2("git", ["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--no-checkout", "--", src.url, join3(dir, "repo")], { env: gitEnv, timeoutMs: timeoutMs() });
    if (clone.code !== 0) throw new AccError(k2.missing, `Couldn't fetch ${src.url} with git: ${firstLine(clone.stderr || clone.stdout) || `git exited ${clone.code}`}`);
    const show = run2("git", ["show", `HEAD:${src.path}`], { cwd: join3(dir, "repo"), env: gitEnv, timeoutMs: timeoutMs() });
    if (show.code !== 0) throw new AccError(k2.missing, `${src.url} has no ${src.path} on its default branch.`);
    if (Buffer.byteLength(show.stdout) > k2.maxBytes) throw tooBig();
    if (!opts.commit) return { text: show.stdout, commit: null };
    const head = run2("git", ["rev-parse", "HEAD"], { cwd: join3(dir, "repo"), env: gitEnv, timeoutMs: timeoutMs() }).stdout.trim();
    return { text: show.stdout, commit: /^[0-9a-f]{40,64}$/.test(head) ? head : null };
  } finally {
    rmSync3(dir, { recursive: true, force: true });
  }
}

// packages/core/src/rules.ts
var RULES_DIR = ".acc/rules";
var OWN_RULES = ".acc/rules.md";
var RULES_TOTAL_MAX_BYTES = 128 * 1024;
var BASE_RULES = [
  "Put new behaviour in its own file. Where a list must name every area, such as an index or a registry, register it there with one line. Parallel tasks then rarely change the same lines, so their work merges.",
  "If another task's change breaks your build, block with the reason (`acc block \"<what broke, and which change>\"`); don't edit its files. That task fixes its own breakage, and two fixes to one breakage conflict.",
  "Write a manifest or config file whole: write a temp file beside it, then rename it into place. Never leave one half-written for another process, or a crash, to find."
];
var PROFILE_RULES = {
  generic: [],
  salesforce: [
    "Apex is bulk-safe: no SOQL or DML inside loops, and triggers handle 200 records.",
    "Apex respects sharing and object and field access where the data calls for it.",
    "Apex tests assert outcomes, cover the changed paths, and don't depend on org data they don't create.",
    "Metadata carries no values that belong to one org: user names, record ids, org URLs."
  ]
};
var PROFILE_NAME = { generic: "generic", salesforce: "Salesforce" };
var RULES_ORDER = "These come in a fixed order: every project's rules, then the profile's, then rules copied in from elsewhere, then this repo's own. Where two disagree, the later one wins, so this repo's own rules win over the others.";
var rulesDigest = (text) => createHash("sha256").update(text).digest("hex");
var MARK = "<!-- acc-rules v1:";
var NOTE = "copied in by acc rules import. This repo keeps its own copy and may edit it; acc rules diff compares it with the source.";
var KEYS2 = ["source", "commit", "copied", "sha256"];
function renderHeader(h2) {
  return [`${MARK} ${NOTE}`, `source: ${h2.source}`, ...h2.commit ? [`commit: ${h2.commit}`] : [], `copied: ${h2.copied}`, `sha256: ${h2.sha256}`, "-->", ""].join("\n");
}
function parseRulesFile(text) {
  if (!text.startsWith(MARK)) return { header: null, problem: null, body: text };
  const end = text.indexOf("\n-->");
  const bad = (why) => ({ header: null, problem: `Its header can't be read: ${why}`, body: text });
  if (end < 0) return bad("it has no closing -->.");
  const after = text.slice(end + 4);
  if (after && !after.startsWith("\n")) return bad("its --> isn't on a line of its own.");
  const lines = text.slice(0, end).split("\n").slice(1);
  const seen = {};
  for (const line of lines) {
    const m = /^([a-z0-9]+): (.+)$/.exec(line);
    const key = m?.[1];
    if (!m || !key || !KEYS2.includes(key)) return bad(`"${line.slice(0, 60)}" isn't a line acc writes.`);
    if (seen[key] !== void 0) return bad(`it says ${key} twice.`);
    seen[key] = m[2].trim();
  }
  if (!seen.source) return bad("it names no source.");
  if (seen.commit !== void 0 && !/^[0-9a-f]{40,64}$/.test(seen.commit)) return bad(`its commit, "${seen.commit}", isn't a commit id.`);
  if (!seen.copied || !/^\d{4}-\d{2}-\d{2}$/.test(seen.copied)) return bad("its copied date isn't a YYYY-MM-DD date.");
  if (!seen.sha256 || !/^[0-9a-f]{64}$/.test(seen.sha256)) return bad("its sha256 isn't a sha256.");
  return { header: { source: seen.source, commit: seen.commit ?? null, copied: seen.copied, sha256: seen.sha256 }, problem: null, body: after.slice(1) };
}
function importedRules(dir) {
  const at2 = join4(dir, RULES_DIR);
  if (!existsSync4(at2)) return [];
  return readdirSync(at2, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name).sort().map((n) => {
    const path = join4(at2, n);
    const text = readFileSync7(path, "utf8");
    const f = parseRulesFile(text);
    return { ...f, name: n.slice(0, -3), file: `${RULES_DIR}/${n}`, path, edited: !!f.header && rulesDigest(f.body) !== f.header.sha256, bytes: Buffer.byteLength(text) };
  });
}
function withoutHeader(body) {
  if (!body.startsWith(MARK)) return body;
  const end = body.indexOf("\n-->");
  return end >= 0 ? body.slice(end + 4).replace(/^\n/, "") : body.split("\n").slice(1).join("\n");
}
function rulesText(dir, profile) {
  const parts = ["### Every project's rules", "", ...BASE_RULES.map((r) => `- ${r}`), ""];
  const own = PROFILE_RULES[profile];
  if (own.length) parts.push(`### The ${PROFILE_NAME[profile]} profile's rules`, "", ...own.map((r) => `- ${r}`), "");
  for (const c of importedRules(dir)) {
    const body = withoutHeader(c.body).trim();
    if (!body) continue;
    const heading = c.header ? `Copied in from ${c.header.source}` : c.problem ? "Copied in, but its header can't be read" : "Kept in this repo";
    parts.push(`### ${heading} (\`${c.file}\`)`, "", body, "");
  }
  const ownFile = join4(dir, OWN_RULES);
  const mine = existsSync4(ownFile) ? readFileSync7(ownFile, "utf8").trim() : "";
  if (mine) parts.push(`### This repo's own rules (\`${OWN_RULES}\`)`, "", mine, "");
  return [RULES_ORDER, "", ...parts].join("\n").trim();
}
var NAME = /^[a-z0-9][a-z0-9._-]{0,59}$/;
function rulesName(source, base, home) {
  const src = parseSource(source, base, home, "rules");
  const n = basename3(src.path).replace(/\.(md|markdown|txt)$/i, "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|-+$/g, "").slice(0, 60);
  return n || "rules";
}
function checkName(name) {
  const n = name.trim().replace(/\.md$/i, "").toLowerCase();
  if (!NAME.test(n)) throw new AccError("usage", `"${name}" can't be a rules file's name: use lower-case letters, digits, dots, dashes and underscores, such as acme-salesforce.`);
  return n;
}
function templateRulesProblem(source) {
  const problem = sourceProblem(source, "rules");
  if (problem) return problem;
  try {
    const src = parseSource(source, "/", homedir2(), "rules");
    const s = source.trim();
    if (src.kind === "file" && !isAbsolute2(s) && s !== "~" && !s.startsWith("~/")) return `${s} is a relative path, which would mean a different file on each machine. Give a GitHub file URL, <git-url>#<path>, or a path from / or ~/.`;
  } catch (e) {
    return e.message;
  }
  return null;
}
var localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function prepareImport(run2, root, source, opts = {}) {
  const s = source.trim();
  const problem = sourceProblem(s, "rules") ?? (/[\r\n]|-->/.test(s) ? "A rules file's source is one line, with no -->, since its copy's header holds it." : null);
  if (problem) throw new AccError("bad-rules", problem);
  const name = opts.name ? checkName(opts.name) : rulesName(s, opts.base, opts.home);
  const fetched = fetchSource(run2, s, "rules", { ...opts, commit: true });
  const text = fetched.text;
  if (!text.trim()) throw new AccError("bad-rules", `${s} is empty: there are no rules in it to copy in.`);
  if (text.includes("\0")) throw new AccError("bad-rules", `${s} isn't text, so it can't be rules.`);
  const file = `${RULES_DIR}/${name}.md`;
  const path = join4(root, RULES_DIR, `${name}.md`);
  const copies = importedRules(root);
  const there = copies.find((c) => c.name === name);
  const header = { source: recordedSource(s, { base: opts.base, home: opts.home, root, kind: "rules" }), commit: fetched.commit, copied: localDay((opts.now ?? (() => /* @__PURE__ */ new Date()))()), sha256: rulesDigest(text) };
  const imp = { name, file, path, header, text, replaces: there ? { source: there.header?.source ?? null, copied: there.header?.copied ?? null, edited: there.edited } : null };
  checkTotal(root, [imp], s);
  return imp;
}
function checkTotal(root, imps, what) {
  const names3 = new Set(imps.map((i) => i.name));
  const total = importedRules(root).filter((c) => !names3.has(c.name)).reduce((n, c) => n + c.bytes, 0) + imps.reduce((n, i) => n + Buffer.byteLength(renderHeader(i.header) + i.text), 0);
  if (total > RULES_TOTAL_MAX_BYTES) {
    throw new AccError("bad-rules", `With ${what}, the copied-in rules would come to ${Math.ceil(total / 1024)} KB, over the ${RULES_TOTAL_MAX_BYTES / 1024} KB every packet, review and analysis can carry. Copy in less, or remove a copy from ${RULES_DIR}/ first.`);
  }
}
function prepareImports(run2, root, sources, opts = {}) {
  const imps = sources.map((s) => prepareImport(run2, root, s, opts));
  checkTotal(root, imps.filter((i) => !i.replaces), sources.length === 1 ? sources[0] : "the template's rules");
  return imps;
}
function writeImport(imp) {
  mkdirSync5(dirname3(imp.path), { recursive: true });
  writeFileSync6(`${imp.path}.tmp`, renderHeader(imp.header) + imp.text);
  renameSync2(`${imp.path}.tmp`, imp.path);
}
function importRules(run2, root, source, opts = {}) {
  const imp = prepareImport(run2, root, source, opts);
  if (imp.replaces && !opts.force && !opts.dryRun) {
    const from = imp.replaces.source ? `, copied from ${imp.replaces.source}${imp.replaces.copied ? ` on ${imp.replaces.copied}` : ""}` : "";
    throw new AccError("exists", `${imp.file} is already here${from}. To replace it with ${source.trim()} as it is now, add --force; git shows the change before you commit it. Or give this copy another name with --name.`);
  }
  if (!opts.dryRun) writeImport(imp);
  return { ...imp, written: !opts.dryRun };
}
var RULES_TIMEOUT_MS = 6e4;
function rulesStatus(run2, root, opts = {}, only) {
  const total = opts.timeoutMs ?? RULES_TIMEOUT_MS;
  const deadline = Date.now() + total;
  const home = opts.home ?? opts.env?.HOME ?? homedir2();
  return importedRules(root).filter((c) => only === void 0 || c.name === only).map((c) => {
    const base = { name: c.name, file: c.file, source: c.header?.source ?? null, commit: c.header?.commit ?? null, copied: c.header?.copied ?? null, edited: c.edited, body: c.body, now: null };
    if (c.problem) return { ...base, state: "bad-header", reason: c.problem };
    if (!c.header) return { ...base, state: "local", reason: null };
    const src = c.header.source;
    const problem = sourceProblem(src, "rules");
    if (problem) return { ...base, state: "bad-header", reason: `Its header's source, ${src}, can't be read: ${problem}` };
    let local = null;
    try {
      const parsed = parseSource(src, root, home, "rules");
      if (parsed.kind === "file") local = parsed.path;
    } catch (e) {
      return { ...base, state: "bad-header", reason: `Its header's source, ${src}, can't be read: ${e.message}` };
    }
    if (local && !existsSync4(local)) return { ...base, state: "not-here", reason: `It came from ${src}, which isn't on this machine.` };
    if (Date.now() >= deadline) return { ...base, state: "unchecked", reason: `The ${Math.ceil(total / 1e3)} seconds ran out before ${src} was read.` };
    let text;
    try {
      text = fetchSource(run2, src, "rules", { ...opts, base: root, home, timeoutMs: total, deadline }).text;
    } catch (e) {
      return { ...base, state: "unreachable", reason: `Couldn't read ${src}: ${e.message}` };
    }
    return { ...base, now: text, state: rulesDigest(text) === c.header.sha256 ? "unchanged" : "changed", reason: null };
  });
}
function unifiedDiff(run2, from, to, labels) {
  if (from === to) return "";
  const dir = mkdtempSync2(join4(tmpdir2(), "acc-rules-diff-"));
  try {
    mkdirSync5(join4(dir, "copy"));
    mkdirSync5(join4(dir, "source"));
    writeFileSync6(join4(dir, "copy", "rules.md"), from);
    writeFileSync6(join4(dir, "source", "rules.md"), to);
    const r = run2("git", ["-c", "core.quotepath=off", "diff", "--no-index", "--no-color", "--no-ext-diff", "--no-prefix", "--", "copy/rules.md", "source/rules.md"], { cwd: dir });
    if (r.code !== 0 && r.code !== 1) throw new AccError("rules", `git couldn't compare the copy with its source: ${r.stderr.trim().split("\n")[0] ?? `git exited ${r.code}`}`);
    const lines = r.stdout.split("\n");
    const at2 = lines.findIndex((l3) => l3.startsWith("@@"));
    return [`--- ${labels.from}`, `+++ ${labels.to}`, ...lines.slice(at2 < 0 ? lines.length : at2)].join("\n").trimEnd();
  } finally {
    rmSync4(dir, { recursive: true, force: true });
  }
}
function rulesDiff(run2, root, name, opts = {}) {
  const only = name ? name.trim().replace(/\.md$/i, "") : void 0;
  const wanted = rulesStatus(run2, root, opts, only);
  if (name && !wanted.length) throw new AccError("usage", `There's no ${RULES_DIR}/${name}.md. acc rules list shows the copies.`);
  return wanted.map((c) => ({
    name: c.name,
    file: c.file,
    source: c.source,
    state: c.state,
    edited: c.edited,
    reason: c.reason,
    diff: c.state === "changed" || c.now !== null && c.edited ? unifiedDiff(run2, c.body, c.now ?? "", { from: `${c.file} (this repo's copy)`, to: `${c.source} (the source now)` }) || null : null
  }));
}
var reimportCommand = (c) => `acc rules import '${(c.source ?? "").replace(/'/g, `'\\''`)}' --name ${c.name} --force`;

// packages/core/src/ste.ts
var W2 = "[\\p{L}\\p{N}_]";
var B2 = `(?:(?<=${W2})(?!${W2})|(?<!${W2})(?=${W2}))`;
function py(source, flags = "") {
  return new RegExp(source.replace(/\\b/g, B2).replace(/\\w/g, W2), `u${flags}`);
}
var cpLen = (s) => {
  let n = 0;
  for (const _2 of s) n++;
  return n;
};
var words = (s) => s.split(/\s+/u).filter(Boolean);
function splitLines(text) {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/u);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
var IRREGULAR_PARTICIPLES = "given|taken|made|done|found|seen|known|shown|written|built|sent|set|run|read|kept|held|left|put|cut|hit|let|shut|split|spread|begun|become|come|gone|got|gotten|lost|met|paid|said|sold|told|thought|brought|bought|caught|taught|won|worn|torn|born|drawn|grown|thrown|flown|driven|risen|chosen|broken|spoken|frozen|hidden|ridden|forgotten|fallen|eaten|beaten|understood|stood|struck|stuck|swung|hung|led|fed|bled|fled|sped|bound|wound|dug|spun|slid|bit|lit|quit";
var PASSIVE_PARTICIPLES = "given|taken|made|done|found|seen|known|shown|written|built|sent|set|run|read|kept|held|left|put";
var MODAL_PERFECT_PREFIX = py("\\b(?:may|might|could|should|would|must|can|will|shall)(?:\\s+not|n['\u2019]t)?\\s+$", "i");
var STE_RULES = [
  { id: "semicolon", level: "hard", pattern: py(";", "g"), message: "STE bans the semicolon (Rule 8.1). Split into separate sentences." },
  {
    id: "phrasal-verb",
    level: "hard",
    pattern: py("\\b(spin(?:ning|s)? up|spun up|reach(?:ing|es|ed)? out|div(?:e|es|ing|ed) into|dove into|kick(?:ing|s|ed)? off|circl(?:e|es|ing|ed) back|touch(?:ing|es|ed)? base)\\b", "gi"),
    message: "Soft phrasal verb. Use the single plain verb (start, contact, read, begin)."
  },
  {
    id: "marketing-adjective",
    level: "hard",
    pattern: py("\\b(seamless(?:ly)?|robust(?:ly)?|cutting-edge|effortless(?:ly)?|blazing[- ]fast|world-class|state-of-the-art|game-chang(?:ing|er))\\b", "gi"),
    message: "Marketing adjective. Delete, or replace with the measurement that earns the claim."
  },
  {
    id: "nominalization",
    level: "hard",
    pattern: py("\\b(perform|performs|performed|conduct|conducts|conducted|carry out|carries out|carried out)\\s+(?:a|an|the)\\s+\\w+(?:tion|sion|ment|ance|ence|ysis)\\b", "gi"),
    message: "Action frozen into a noun. Use the verb (analyze, not perform an analysis of)."
  },
  {
    id: "passive-voice",
    level: "advisory",
    pattern: py(`\\b(is|are|was|were|been|being)\\s+(\\w+ed|${PASSIVE_PARTICIPLES})\\b(?!\\s+(?:to|for|by)\\s+\\w+ing)`, "gi"),
    message: "Possible passive voice. Name the actor and use an active verb, unless the actor is unknown or irrelevant."
  },
  {
    id: "present-perfect",
    level: "advisory",
    // A modal and a perfect infinitive ("may have failed") is a hedge, which this never flags.
    pattern: py(`(?<!\\bmay )(?<!\\bmight )(?<!\\bcould )(?<!\\bshould )(?<!\\bwould )(?<!\\bmust )\\b(has|have|had)\\s+(?:been\\s+)?(?:\\w+(?:ed|en)|${IRREGULAR_PARTICIPLES})\\b`, "gi"),
    message: "Compound tense. Use simple past/present unless current relevance is the point (then keep and flag)."
  }
];
var SYNONYM_GROUPS = [
  ["check", "verify", "confirm", "validate"],
  ["delete", "remove", "erase"],
  ["start", "launch", "begin", "initiate"],
  ["stop", "halt", "terminate"],
  ["show", "display"],
  ["use", "utilize", "employ"],
  ["fix", "repair", "correct"],
  ["send", "transmit"],
  ["get", "retrieve", "fetch", "obtain"],
  ["change", "modify", "alter"]
];
var STE_MAX_WORDS = 25;
var CODE_FENCE = /^(```|~~~)/u;
var INLINE_CODE = /`[^`]*`/gu;
var LIST_ITEM_START = /^( {0,3})([-*+]|[0-9]+[.)])( +)(.*)$/u;
var CONJUNCTION_END = py("\\b(?:and|or)\\s*$", "i");
var TABLE_SEPARATOR_CELL = /^:?-{3,}:?$/u;
var SENTENCE_BREAK = /(?<=[.!?])\s+/u;
var wordRes = /* @__PURE__ */ new Map();
var wordRe = (base) => {
  let re2 = wordRes.get(base);
  if (!re2) wordRes.set(base, re2 = py(`\\b${base}(?:s|es|ed|d|ing)?\\b`, "i"));
  return re2;
};
var leadingSpaces = (line) => line.length - line.replace(/^ +/, "").length;
function isListContinuation(line, contentIndent) {
  if (!line.trim()) return true;
  if (LIST_ITEM_START.test(line)) return false;
  return leadingSpaces(line) >= contentIndent;
}
function splitTableRow(line) {
  const lead = line.length - line.trimStart().length;
  const right = line.trimEnd().length;
  let content = right > lead ? line.slice(lead, right) : "";
  if (!content.includes("|")) return null;
  let left = cpLen(line.slice(0, lead));
  if (content.startsWith("|")) {
    content = content.slice(1);
    left += 1;
  }
  if (content.endsWith("|")) content = content.slice(0, -1);
  const raw = content.split(/(?<!\\)\|/u);
  if (raw.length < 2) return null;
  const cells = [];
  let column = left;
  for (const cell2 of raw) {
    const leading = cell2.length - cell2.trimStart().length;
    cells.push([cell2.trim(), column + cpLen(cell2.slice(0, leading))]);
    column += cpLen(cell2) + 1;
  }
  return cells;
}
function tableCells(lines) {
  const cells = /* @__PURE__ */ new Map();
  let index = 1;
  while (index < lines.length) {
    const separator = splitTableRow(lines[index]);
    const header = splitTableRow(lines[index - 1]);
    if (!separator || !header || separator.length !== header.length || !separator.every(([c]) => TABLE_SEPARATOR_CELL.test(c))) {
      index++;
      continue;
    }
    cells.set(index - 1, header);
    cells.set(index, []);
    index++;
    while (index < lines.length) {
      const row = splitTableRow(lines[index]);
      if (!row || row.length !== separator.length) break;
      cells.set(index, row);
      index++;
    }
  }
  return cells;
}
function danglingConjunctions(text, file) {
  const lines = splitLines(text);
  const found = [];
  let inFence = false;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (CODE_FENCE.test(line.trim())) {
      inFence = !inFence;
      index++;
      continue;
    }
    if (inFence) {
      index++;
      continue;
    }
    const start = LIST_ITEM_START.exec(line);
    if (!start) {
      index++;
      continue;
    }
    const [, indent, marker, gap, body] = start;
    const contentIndent = indent.length + marker.length + gap.length;
    const item = [[index, body]];
    let next = index + 1;
    let itemFence = false;
    while (next < lines.length) {
      const candidate = lines[next];
      if (CODE_FENCE.test(candidate.trim())) {
        itemFence = !itemFence;
        next++;
        continue;
      }
      if (itemFence) {
        next++;
        continue;
      }
      if (!isListContinuation(candidate, contentIndent)) break;
      item.push([next, candidate]);
      next++;
    }
    const meaningful = item.map(([i, l3]) => [i, l3.replace(INLINE_CODE, " CODE ").trim()]).filter(([, l3]) => l3);
    const last = meaningful[meaningful.length - 1];
    if (last && CONJUNCTION_END.test(last[1])) {
      const [endIndex, endLine] = last;
      let line1;
      let col;
      if (endIndex === index) {
        line1 = index + 1;
        col = indent.length + 1;
      } else {
        const raw = item.find(([i]) => i === endIndex)[1];
        const masked = raw.replace(INLINE_CODE, (m) => " ".repeat(cpLen(m)));
        const at2 = CONJUNCTION_END.exec(masked);
        line1 = endIndex + 1;
        col = at2 ? cpLen(masked.slice(0, at2.index)) + 1 : 1;
      }
      found.push({
        file,
        line: line1,
        col,
        rule: "dangling-conjunction",
        level: "hard",
        match: endLine,
        message: "List item ends with a coordinating conjunction. Complete the item or join it with the next item."
      });
    }
    index = next;
  }
  return found;
}
var placeOrder = (a2, b) => a2[0] - b[0] || a2[1] - b[1] || (a2[2] < b[2] ? -1 : a2[2] > b[2] ? 1 : a2[3] < b[3] ? -1 : a2[3] > b[3] ? 1 : 0);
function steLint(text, file = "<stdin>") {
  const findings = [];
  let total = 0;
  let inFence = false;
  const lines = splitLines(text);
  const table2 = tableCells(lines);
  const seen = /* @__PURE__ */ new Map();
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    if (CODE_FENCE.test(raw.trim())) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    for (const [segment, column] of table2.get(i) ?? [[raw, 0]]) {
      const line = segment.replace(INLINE_CODE, "");
      total += words(line).length;
      const col = (at2) => column + cpLen(line.slice(0, at2)) + 1;
      for (const r of STE_RULES) {
        for (const m of line.matchAll(r.pattern)) {
          if (r.id === "present-perfect" && MODAL_PERFECT_PREFIX.test(line.slice(0, m.index))) continue;
          findings.push({ file, line: lineNo, col: col(m.index), rule: r.id, level: r.level, match: m[0], message: r.message });
        }
      }
      SYNONYM_GROUPS.forEach((group, g) => {
        for (const base of group) {
          if (seen.has(`${g}:${base}`)) continue;
          const m = wordRe(base).exec(line);
          if (m) seen.set(`${g}:${base}`, [lineNo, col(m.index), m[0]]);
        }
      });
      for (const sentence3 of line.split(SENTENCE_BREAK)) {
        const n = words(sentence3).length;
        if (n > STE_MAX_WORDS) {
          findings.push({ file, line: lineNo, col: column + 1, rule: "long-sentence", level: "hard", match: `${n} words`, message: `Sentence has ${n} words (cap ${STE_MAX_WORDS}). Split it.` });
        }
      }
    }
  });
  SYNONYM_GROUPS.forEach((group, g) => {
    const present = group.filter((b) => seen.has(`${g}:${b}`)).map((b) => [...seen.get(`${g}:${b}`), b]).sort(placeOrder);
    if (present.length < 2) return;
    const keeper = present[0][3];
    for (const [line, col, match, base] of present.slice(1)) {
      findings.push({ file, line, col, rule: "synonym-rotation", level: "hard", match, message: `'${base}' and '${keeper}' name the same action. Pick one and use it every time.` });
    }
  });
  findings.push(...danglingConjunctions(text, file));
  findings.sort((a2, b) => a2.line - b.line || a2.col - b.col);
  return { findings, words: total };
}
var steLine = (f) => `${f.file}:${f.line}:${f.col} ${f.rule}: ${f.message} [${f.match}]`;
function requirementWording(r) {
  const lines = [
    ...r.goal.trim() ? [["goal", 0, r.goal]] : [],
    ...["criteria", "assumptions", "outOfScope"].flatMap((part) => r[part].map((text, i) => [part, i, text]))
  ];
  return lines.flatMap(([part, index, text]) => steLint(part === "goal" ? text : `- ${text}`).findings.filter((f) => f.level === "hard").map((f) => ({ part, index, text, rule: f.rule, match: f.match, message: f.message })));
}
var wordingWords = (n) => n ? `Wording: ${n} finding${n === 1 ? "" : "s"}` : null;
var PART_WORDS = { goal: "Goal", criteria: "Criterion", assumptions: "Assumption", outOfScope: "Out of scope" };
var wordingMatch = (f) => f.match.trim() === f.text.trim() ? null : f.match;
var wordingPlace = (f) => f.part === "goal" ? PART_WORDS.goal : `${PART_WORDS[f.part]} ${f.index + 1}`;

// packages/core/src/steps.ts
import { renameSync as renameSync3, writeFileSync as writeFileSync7 } from "node:fs";
var STEPS_VAR = "ACC_STEPS";
var NOTE_MAX = 300;
var cut = (s) => clip(s.replace(/\s+/g, " ").trim(), NOTE_MAX);
function stepsTo(file, now2 = () => /* @__PURE__ */ new Date()) {
  const lines = [];
  const labels = /* @__PURE__ */ new Map();
  const open = /* @__PURE__ */ new Set();
  let used = false;
  let ended = false;
  const write = (e) => {
    if (ended || !file) return;
    if (e.kind === "result") ended = true;
    else used = true;
    lines.push(JSON.stringify(e));
    try {
      writeFileSync7(`${file}.tmp`, `${lines.join("\n")}
`);
      renameSync3(`${file}.tmp`, file);
    } catch {
    }
  };
  const at2 = () => now2().toISOString();
  const event = (id, state, note) => {
    if (state === "started") open.add(id);
    else open.delete(id);
    write({ kind: "step", id, label: labels.get(id) ?? id, state, ...note?.trim() ? { note: cut(note) } : {}, at: at2() });
  };
  const steps2 = {
    get on() {
      return file !== null;
    },
    get used() {
      return used;
    },
    get ended() {
      return ended;
    },
    start(id, label, note) {
      labels.set(id, label);
      event(id, "started", note);
    },
    done(id, note) {
      event(id, "done", note);
    },
    skip(id, label, note) {
      labels.set(id, label);
      event(id, "skipped", note);
    },
    fail(id, note) {
      event(id, "failed", note);
    },
    result(ok, sentence3) {
      if (ended) return;
      for (const id of [...open]) event(id, ok ? "done" : "failed", ok ? void 0 : sentence3);
      write({ kind: "result", ok, sentence: cut(sentence3), at: at2() });
    },
    step(id, label, fn2) {
      steps2.start(id, label);
      let out3;
      try {
        out3 = fn2();
      } catch (e) {
        steps2.fail(id, e?.message ?? String(e));
        throw e;
      }
      steps2.done(id);
      return out3;
    }
  };
  return steps2;
}
var stepsFrom = (env, now2) => stepsTo(env[STEPS_VAR]?.trim() || null, now2);
var NO_STEPS = stepsTo(null);

// packages/core/src/analyze.ts
var SIZE_MEANING = { S: "an hour or two", M: "a day", L: "a few days", XL: "split it" };
var strings = { type: "array", items: { type: "string" } };
var ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary", "requirements", "questions", "findings", "approach", "split"],
  properties: {
    verdict: { type: "string", enum: ["ready", "questions", "split"], description: "questions when a person must answer something before it can be built well; split when it is too big for one task" },
    summary: { type: "string", description: "Two or three plain sentences: what the task needs, what is already there, and how to build it" },
    requirements: {
      type: "object",
      additionalProperties: false,
      required: ["goal", "criteria", "assumptions", "outOfScope"],
      properties: {
        goal: { type: "string", description: "What the person asking wants, in a sentence. Write it in STE Strict mode" },
        criteria: { ...strings, description: "Acceptance criteria, each one testable. Write each in STE Strict mode" },
        assumptions: { ...strings, description: "What you assumed that the ticket does not say. Write each in STE Strict mode" },
        outOfScope: { ...strings, description: "What this task should not do. Write each in STE Strict mode" }
      }
    },
    questions: {
      type: "array",
      description: "Only what a person must decide, and nothing you could find out yourself",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "why", "suggested"],
        properties: { question: { type: "string" }, why: { type: "string", description: "What changes depending on the answer" }, suggested: { type: "string", description: "What you would assume if nobody answers" } }
      }
    },
    findings: {
      type: "array",
      description: "What is already there that this task touches or depends on",
      items: { type: "object", additionalProperties: false, required: ["area", "detail", "source"], properties: { area: { type: "string" }, detail: { type: "string" }, source: { type: "string", description: "A file path, or the org alias and the query or command" } } }
    },
    approach: {
      type: "object",
      additionalProperties: false,
      required: ["plan", "files", "refactors", "risks", "tests", "size"],
      properties: {
        plan: { ...strings, description: "The steps to build it, in order" },
        files: {
          type: "array",
          items: { type: "object", additionalProperties: false, required: ["path", "change", "why"], properties: { path: { type: "string" }, change: { type: "string", enum: ["create", "update", "delete"] }, why: { type: "string" } } }
        },
        refactors: {
          type: "array",
          description: "Changes to what is there that the task needs first, and why",
          items: { type: "object", additionalProperties: false, required: ["what", "why"], properties: { what: { type: "string" }, why: { type: "string" } } }
        },
        risks: strings,
        tests: { ...strings, description: "How to prove it works: the tests to write or run" },
        size: { type: "string", enum: ["S", "M", "L", "XL"], description: Object.entries(SIZE_MEANING).map(([s, m]) => `${s}: ${m}`).join(". ") }
      }
    },
    split: { ...strings, description: "When the verdict is split: the smaller tasks, one line each. Otherwise empty" }
  }
};
function fileId(task) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(task) || task.includes("..")) throw new AccError("usage", `${task} isn't a task id.`);
  return task;
}
var analysisPath = (paths, task) => join5(paths.analyses, `${fileId(task)}.json`);
var runningPath = (paths, task) => join5(paths.analyses, `${fileId(task)}.running.json`);
function readAnalysis(paths, task) {
  try {
    const a2 = JSON.parse(readFileSync8(analysisPath(paths, task), "utf8"));
    return a2.v === 1 && a2.task === task ? a2 : null;
  } catch {
    return null;
  }
}
function writeAnalysis(paths, a2) {
  mkdirSync6(paths.analyses, { recursive: true });
  const file = analysisPath(paths, a2.task);
  writeFileSync8(`${file}.tmp`, JSON.stringify(a2, null, 2) + "\n");
  renameSync4(`${file}.tmp`, file);
}
var openQuestions = (a2) => (a2?.questions ?? []).filter((q2) => !q2.answer);
var analysisRequired = (config) => config.analysis?.required ?? config.profile === "salesforce";
function analysisProblems(paths, config, task) {
  if (task.state !== "todo" || !analysisRequired(config)) return [];
  const a2 = readAnalysis(paths, task.id);
  if (!a2) return [`${task.id} hasn't been analyzed. This project wants an analysis before a build: acc analyze ${task.id}.`];
  if (a2.verdict === "split") return [`${task.id}'s analysis says it's too big for one task. Split it into: ${a2.split.join("; ")}. Or a person dispatches it anyway with --without-analysis.`];
  const open = openQuestions(a2);
  if (open.length) return [`${open.length} question${open.length === 1 ? "" : "s"} from ${task.id}'s analysis ${open.length === 1 ? "is" : "are"} unanswered: ${open.map((q2) => `${q2.id}. ${q2.question}`).join(" ")} Answer with acc analysis answer ${task.id} <q> "<answer>".`];
  return [];
}
var SALESFORCE_COOKBOOK = [
  "Reading the org. Every command takes --target-org <alias> and --json. You can only read: nothing you run changes an org.",
  '- Which org, for sure: `sf org display --target-org <alias> --json`, and `sf data query --target-org <alias> --query "SELECT IsSandbox, Name, OrganizationType FROM Organization"`. Say which org each finding came from.',
  "- An object's fields and picklists: `sf sobject describe --sobject <Object> --target-org <alias> --json`.",
  "- Automation on an object, which runs in this order on save: validation rules, before-save flows, before triggers, after triggers, after-save flows. With --use-tooling-api:",
  "  - `SELECT ValidationName, Active, ErrorMessage FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = '<Object>'`",
  "  - `SELECT Name, Status, UsageBeforeInsert, UsageAfterInsert, UsageBeforeUpdate, UsageAfterUpdate FROM ApexTrigger WHERE TableEnumOrId = '<Object>'`",
  "  - `SELECT Name, TableEnumOrId FROM WorkflowRule WHERE TableEnumOrId = '<Object>'`",
  "  - and without the tooling API: `SELECT ApiName, Label, ProcessType, TriggerType, RecordTriggerType, TriggerObjectOrEventLabel, IsActive FROM FlowDefinitionView WHERE TriggerObjectOrEventLabel = '<Object label>'`",
  "- What uses a component (tooling API): `SELECT MetadataComponentName, MetadataComponentType FROM MetadataComponentDependency WHERE RefMetadataComponentName = '<Name>'`.",
  "- Code and its tests: `SELECT Name, LastModifiedDate, LastModifiedBy.Name FROM ApexClass WHERE Name LIKE '%<word>%'`, and coverage with `SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate` (tooling API).",
  "- Volumes and limits: `sf limits recordcounts display --sobject <Object> --target-org <alias>` and `sf limits api display --target-org <alias>`.",
  "- A component's source as the org has it: `sf project retrieve start --metadata <Type>:<Name> --target-org <alias>` from your working folder, which is a scratch project. It never touches the repo.",
  "- Records: you may read a few to learn their shape (LIMIT 5, only the fields you need). Don't copy names, emails or other personal details into your analysis: describe patterns instead.",
  "Compare the org with the repo: the repo's branch is meant to match its org. Say where they differ for what this task touches."
];
var SALESFORCE_FOCUS = [
  "What automation already runs on the objects this touches, in order, and whether the change should join it (an existing flow or trigger handler) instead of adding one more.",
  "Bulk safety and limits at the volumes you found: SOQL and DML out of loops, 200 records a transaction.",
  "Sharing and field access, permission sets and profiles that would need the new fields or classes.",
  "Tests: which test classes cover what changes, and what new tests prove it.",
  "Environment-specific files (D-016) and anything that would differ between orgs."
];
var STE_STRICT = [
  "Write the goal, each acceptance criterion, each assumption and each out-of-scope item in Simplified Technical English (ASD-STE100), Strict mode. A builder agent reads them, and each must have one meaning only:",
  '- Use the active voice. Name who or what does the action: "acc writes the file", not "the file is written".',
  "- Use one instruction or one statement in each sentence. Use no more than 20 words in an instruction and no more than 25 in a description.",
  "- Do not use a semicolon. Write two sentences.",
  '- Use simple tenses: the simple present, past or future. Do not use the present perfect ("has failed") or other compound tenses. Keep a hedge as it is ("may have failed" stays).',
  '- Do not use phrasal verbs ("set up", "spin up", "carry out"). Use one plain verb (start, make, do).',
  '- Use the verb for an action, not a noun made from it: "analyze the log", not "perform an analysis of the log".',
  '- Use one word for one thing, and use it every time. Do not change between "check", "verify" and "confirm" for the same action.',
  "- Do not use marketing adjectives (seamless, robust, powerful, cutting-edge). Give the measurement instead.",
  "- Use no more than 3 nouns together as one name. Do not leave out the subject, the verb or the article to make a sentence shorter.",
  '- Do not end an item on "and" or "or".'
];
function analysisPrompt(i) {
  const sf = i.config.profile === "salesforce";
  const system = [
    `You are the analyst for ${i.task.id}. Before anyone builds it, you work out what it asks for, what is already there, and how it should be built. A builder agent is given your analysis; a person answers your questions first.`,
    `You can read the repo at ${i.root} (Read, Grep, Glob, and git log, show, diff and grep)${sf ? ", and read the Salesforce orgs listed below with the sf CLI" : ""}. You can't change anything: no edits, no writes, no deploys.`,
    "Work like a careful senior consultant on a new ticket:",
    "- Read the ticket. Restate the goal. Turn what it asks for into testable acceptance criteria. Name your assumptions and what is out of scope.",
    `- Investigate before you decide: find the code${sf ? " and the org configuration" : ""} this touches, what depends on it, and how it behaves today. Every finding names its source.`,
    "- Decide the approach: the steps, the files, any refactor the task needs first and why, the risks, and the tests that prove it.",
    "- Ask only what a person must decide: business rules, priorities, trade-offs. Never ask what you could find out yourself. Give each question your suggested answer.",
    "- If it is too big for one task (more than a few days), say split and list the smaller tasks.",
    ...sf ? ["", "For a Salesforce project, also cover:", ...SALESFORCE_FOCUS.map((f) => `- ${f}`), "", ...SALESFORCE_COOKBOOK] : [],
    "",
    ...STE_STRICT,
    "",
    "Be concrete and brief: names, files, numbers. No filler."
  ].join("\n");
  const prompt = [
    `# Analyze ${i.task.id}: ${i.task.title}`,
    "",
    `For the ${i.env.name} environment (branch \`${i.env.branch}\`).${i.checkedOut ? ` The repo is checked out on \`${i.checkedOut}\`: read the environment's files with git show ${i.env.branch}:<path>.` : ""}`,
    i.task.source.url ? `Ticket: ${i.task.source.url}` : `Source: ${i.task.source.kind}`,
    "",
    "## The ticket",
    "",
    i.task.brief.trim() || "_Only the title was given._",
    "",
    ...sf && i.orgs.length ? ["## The orgs you may read", "", ...i.orgs.map((o) => `- \`${o.alias}\`: ${o.name} (${o.type})`), ""] : [],
    ...i.previous?.questions.some((q2) => q2.answer) ? [
      "## What a person already answered",
      "",
      ...i.previous.questions.filter((q2) => q2.answer).map((q2) => `- ${q2.question} **${q2.answer.text}**`),
      "",
      "Don't ask these again.",
      ""
    ] : [],
    ...i.rules?.trim() ? ["## Rules", "", i.rules.trim(), ""] : []
  ].join("\n");
  return { system, prompt };
}
function parseAnalysis(stdout) {
  let r;
  try {
    r = JSON.parse(stdout.trim().split("\n").filter(Boolean).pop() ?? "");
  } catch {
    throw new AccError("analyze", `The analyst gave no result Claude Code could read: ${stdout.trim().slice(0, 200) || "(nothing)"}`);
  }
  const s = r.structured_output;
  if (r.is_error || !s || !["ready", "questions", "split"].includes(s.verdict) || typeof s.summary !== "string") {
    throw new AccError("analyze", `The analysis didn't finish (${r.subtype ?? "no result"}): ${String(r.result ?? "").slice(0, 300)}`);
  }
  const list = (v) => Array.isArray(v) ? v.filter((x2) => typeof x2 === "string" && !!x2.trim()) : [];
  const req = s.requirements ?? {};
  const ap = s.approach ?? {};
  const questions = (Array.isArray(s.questions) ? s.questions : []).filter((q2) => typeof q2?.question === "string" && q2.question.trim()).map((q2, n) => ({ id: `q${n + 1}`, question: q2.question, why: String(q2.why ?? ""), suggested: String(q2.suggested ?? "") }));
  const analysis = {
    // A ready verdict with questions waiting isn't ready.
    verdict: s.verdict === "ready" && questions.length ? "questions" : s.verdict,
    summary: s.summary,
    requirements: { goal: String(req.goal ?? ""), criteria: list(req.criteria), assumptions: list(req.assumptions), outOfScope: list(req.outOfScope) },
    questions,
    findings: (Array.isArray(s.findings) ? s.findings : []).filter((f) => typeof f?.detail === "string").map((f) => ({ area: String(f.area ?? ""), detail: f.detail, source: String(f.source ?? "") })),
    approach: {
      plan: list(ap.plan),
      files: (Array.isArray(ap.files) ? ap.files : []).filter((f) => typeof f?.path === "string" && ["create", "update", "delete"].includes(f.change)).map((f) => ({ path: f.path, change: f.change, why: String(f.why ?? "") })),
      refactors: (Array.isArray(ap.refactors) ? ap.refactors : []).filter((x2) => typeof x2?.what === "string").map((x2) => ({ what: x2.what, why: String(x2.why ?? "") })),
      risks: list(ap.risks),
      tests: list(ap.tests),
      size: ["S", "M", "L", "XL"].includes(ap.size) ? ap.size : "M"
    },
    split: list(s.split)
  };
  return { analysis: { ...analysis, wording: requirementWording(analysis.requirements) }, sessionId: typeof r.session_id === "string" ? r.session_id : null, costUsd: typeof r.total_cost_usd === "number" ? r.total_cost_usd : null };
}
var ANALYST_COMMANDS = {
  any: ["git log", "git show", "git diff", "git grep", "git ls-files"],
  salesforce: [
    "sf org display",
    "sf org list metadata",
    "sf org list metadata-types",
    "sf data query",
    "sf sobject describe",
    "sf sobject list",
    "sf limits api display",
    "sf limits recordcounts display",
    "sf project retrieve start",
    "sf apex list log",
    "sf apex get log"
  ]
};
var git = (run2, cwd, ...args) => run2("git", args, { cwd });
function scratchProject(paths, id) {
  const dir = join5(paths.analyses, `${fileId(id)}.work`);
  rmSync5(dir, { recursive: true, force: true });
  mkdirSync6(join5(dir, "force-app"), { recursive: true });
  const project2 = join5(paths.root, "sfdx-project.json");
  if (existsSync5(project2)) {
    try {
      const p = JSON.parse(readFileSync8(project2, "utf8"));
      writeFileSync8(join5(dir, "sfdx-project.json"), JSON.stringify({ ...p, packageDirectories: [{ path: "force-app", default: true }] }, null, 2));
    } catch {
      copyFileSync(project2, join5(dir, "sfdx-project.json"));
    }
  } else {
    writeFileSync8(join5(dir, "sfdx-project.json"), JSON.stringify({ packageDirectories: [{ path: "force-app", default: true }], sourceApiVersion: "62.0" }, null, 2));
  }
  return dir;
}
function analyze(paths, config, id, deps, opts = {}) {
  const { run: run2, now: now2 } = deps;
  const steps2 = deps.steps ?? NO_STEPS;
  const { task, env } = steps2.step("task", "Check the task", () => {
    const task2 = readLedger(paths.ledger).tasks.find((t) => t.id === id);
    if (!task2) throw new AccError("no-task", `No task ${id}.`);
    if (task2.state === "done") throw new AccError("refused", `${id} is done. There's nothing left to analyze.`);
    if (task2.state === "running") throw new AccError("refused", `${id} is being built. Analyze before dispatch, or after it's abandoned.`);
    const env2 = environmentByBranch(config, task2.environment);
    if (!env2) throw new AccError("analyze", `${id}'s environment "${task2.environment}" isn't in the config.`);
    return { task: task2, env: env2 };
  });
  const sf = config.profile === "salesforce";
  steps2.start("gather", "Gather what the analyst reads");
  const base = git(run2, paths.root, "rev-parse", "--verify", "--quiet", env.branch).stdout.trim() || git(run2, paths.root, "rev-parse", "HEAD").stdout.trim();
  const current3 = git(run2, paths.root, "branch", "--show-current").stdout.trim();
  const orgs = sf ? config.environments.filter((e) => e.org).map((e) => ({ alias: e.org, name: e.name, type: e.type })) : [];
  const previous = readAnalysis(paths, id);
  const { system, prompt } = analysisPrompt({ task, config, env, root: paths.root, checkedOut: current3 && current3 !== env.branch ? current3 : null, orgs, rules: rulesText(paths.root, config.profile), previous });
  const allowed = [...ANALYST_COMMANDS.any, ...sf ? ANALYST_COMMANDS.salesforce : []].map((c) => `Bash(${c}:*)`);
  const settings = deps.accCommand ? { hooks: { PreToolUse: [{ matcher: "Bash|Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: `${deps.accCommand} hook pre-tool-use` }] }] } } : null;
  const cwd = sf ? scratchProject(paths, id) : paths.root;
  steps2.done("gather", orgs.length ? `The code and ${orgs.length} org(s)` : "The code");
  const sessionId = (deps.uuid ?? randomUUID)();
  const name = sessionName({ project: config.project, key: id, title: task.title, role: "analysis" });
  mkdirSync6(paths.analyses, { recursive: true });
  const marker = runningPath(paths, id);
  const startedAt = now2();
  writeFileSync8(marker, JSON.stringify({ sessionId, name, startedAt: startedAt.toISOString(), pid: process.pid }));
  deps.onStart?.(sessionId, name);
  steps2.start("analyze", `Analyze ${id}`, "The analyst reads, and changes nothing");
  const awake = holdAwake(process.pid, deps.awake);
  let out3;
  try {
    out3 = run2("claude", [
      "-p",
      "--session-id",
      sessionId,
      "--name",
      name,
      "--permission-mode",
      "dontAsk",
      ...agentArgs(config.agents.reviewer),
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(ANALYSIS_SCHEMA),
      "--append-system-prompt",
      system,
      ...cwd !== paths.root ? ["--add-dir", paths.root] : [],
      ...settings ? ["--settings", JSON.stringify(settings)] : [],
      "--allowedTools",
      "Read",
      "Grep",
      "Glob",
      ...allowed,
      "--disallowedTools",
      "Edit",
      "Write",
      "NotebookEdit",
      "WebFetch",
      "WebSearch"
    ], { cwd, input: prompt, env: { ...sf ? sfEnv(deps.env) : deps.env, ACC_ROLE: "analyst", ACC_TASK: id }, timeoutMs: 45 * 6e4 });
  } finally {
    awake?.release();
    rmSync5(marker, { force: true });
  }
  if (out3.timedOut) throw new AccError("analyze", `The analysis didn't finish within 45 minutes, so acc stopped it.`);
  if (out3.code === 127 && !out3.stdout) throw new AccError("analyze", `Claude Code didn't start: ${out3.stderr.trim().split("\n")[0] ?? "claude not found"}`);
  steps2.done("analyze");
  const parsed = steps2.step("read", "Read the analysis", () => parseAnalysis(out3.stdout));
  steps2.start("save", "Save the analysis");
  const finished = now2();
  const answered = new Map((previous?.questions ?? []).filter((q2) => q2.answer).map((q2) => [q2.question.trim().toLowerCase(), q2.answer]));
  const questions = parsed.analysis.questions.map((q2) => answered.has(q2.question.trim().toLowerCase()) ? { ...q2, answer: answered.get(q2.question.trim().toLowerCase()) } : q2);
  const analysis = {
    v: 1,
    task: id,
    env: env.branch,
    base,
    ...parsed.analysis,
    questions,
    verdict: parsed.analysis.verdict === "questions" && !questions.some((q2) => !q2.answer) ? "ready" : parsed.analysis.verdict,
    orgs: orgs.map((o) => o.alias),
    sessionId: parsed.sessionId ?? sessionId,
    name,
    at: finished.toISOString(),
    durationMs: finished.getTime() - startedAt.getTime(),
    costUsd: parsed.costUsd
  };
  writeAnalysis(paths, analysis);
  mutate(paths, now2, (_l, emit) => {
    emit({ type: "task.updated", task: id, actor: opts.actor ?? "human", by: opts.by ?? `analyst:${id}`, data: { analyzed: { verdict: analysis.verdict, questions: analysis.questions.length } } });
  });
  steps2.done("save");
  return analysis;
}
function answerAnalysis(paths, id, question, text, by, now2) {
  const a2 = readAnalysis(paths, id);
  if (!a2) throw new AccError("no-analysis", `${id} hasn't been analyzed yet: acc analyze ${id}.`);
  const q2 = a2.questions.find((x2) => x2.id === question.toLowerCase() || x2.id === `q${question}`);
  if (!q2) throw new AccError("usage", `${id}'s analysis has no question ${question}. It has: ${a2.questions.map((x2) => x2.id).join(", ") || "none"}.`);
  if (!text.trim()) throw new AccError("usage", "Give an answer.");
  q2.answer = { text: text.trim(), by, at: now2().toISOString() };
  if (a2.verdict === "questions" && !openQuestions(a2).length) a2.verdict = "ready";
  writeAnalysis(paths, a2);
  mutate(paths, now2, (_l, emit) => {
    emit({ type: "task.updated", task: id, actor: "human", by, data: { answered: { question: q2.id } } });
  });
  return a2;
}
function analysisSection(a2) {
  if (!a2) return [];
  const bullets = (xs) => xs.map((x2) => `- ${x2}`);
  return [
    "## What the analysis found",
    "",
    `An analyst read the ticket${a2.orgs.length ? `, the code and the orgs (${a2.orgs.join(", ")})` : " and the code"} before you. Build from this, and check what it says as you go: if something here turns out to be wrong, say so in your final message.`,
    "",
    a2.summary,
    "",
    ...a2.requirements.criteria.length ? ["**Acceptance criteria**", "", ...bullets(a2.requirements.criteria), ""] : [],
    ...a2.questions.length ? ["**Decided by a person**", "", ...a2.questions.map((q2) => `- ${q2.question} ${q2.answer ? `**${q2.answer.text}**` : `Nobody answered; assume: ${q2.suggested}`}`), ""] : [],
    ...a2.requirements.assumptions.length ? ["**Assumptions**", "", ...bullets(a2.requirements.assumptions), ""] : [],
    ...a2.requirements.outOfScope.length ? ["**Out of scope**", "", ...bullets(a2.requirements.outOfScope), ""] : [],
    ...a2.findings.length ? ["**What is there now**", "", ...a2.findings.map((f) => `- ${f.area}: ${f.detail}${f.source ? ` (${f.source})` : ""}`), ""] : [],
    ...a2.approach.plan.length ? ["**The approach**", "", ...a2.approach.plan.map((s, i) => `${i + 1}. ${s}`), ""] : [],
    ...a2.approach.refactors.length ? ["**Refactors first**", "", ...a2.approach.refactors.map((r) => `- ${r.what}: ${r.why}`), ""] : [],
    ...a2.approach.files.length ? ["**Files**", "", ...a2.approach.files.map((f) => `- ${f.change} \`${f.path}\`: ${f.why}`), ""] : [],
    ...a2.approach.risks.length ? ["**Risks**", "", ...bullets(a2.approach.risks), ""] : [],
    ...a2.approach.tests.length ? ["**Tests**", "", ...bullets(a2.approach.tests), ""] : []
  ];
}

// packages/core/src/autopilot-log.ts
var byAutopilot = (by) => by === AUTOPILOT_BY || by.endsWith(` for ${AUTOPILOT_BY}`);
var EVENTS_TAIL_BYTES = 256 * 1024;

// packages/core/src/checks.ts
import { mkdirSync as mkdirSync21, readFileSync as readFileSync23, writeFileSync as writeFileSync22 } from "node:fs";
import { join as join21 } from "node:path";

// packages/core/src/land.ts
import { mkdtempSync as mkdtempSync3, rmSync as rmSync13, writeFileSync as writeFileSync21 } from "node:fs";
import { tmpdir as tmpdir3 } from "node:os";
import { join as join20 } from "node:path";

// packages/core/src/jobs.ts
import { mkdirSync as mkdirSync7, readdirSync as readdirSync2, readFileSync as readFileSync9, renameSync as renameSync5, rmSync as rmSync6, writeFileSync as writeFileSync9 } from "node:fs";
import { join as join6 } from "node:path";
var JOB_KINDS = ["land", "refresh", "promote", "deploy", "autopilot"];
var jobsDir = (paths) => join6(paths.stateDir, "jobs");
var marked = 0;
function readJobs(paths) {
  const dir = jobsDir(paths);
  let names3 = [];
  try {
    names3 = readdirSync2(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out3 = [];
  for (const n of names3) {
    try {
      const j2 = JSON.parse(readFileSync9(join6(dir, n), "utf8"));
      if (!JOB_KINDS.includes(j2.kind) || !Number.isInteger(j2.pid) || j2.pid <= 0 || typeof j2.startedAt !== "string") continue;
      if (j2.step !== void 0 && !AUTOPILOT_STEPS.includes(j2.step)) continue;
      out3.push({ ...j2, key: n.slice(0, -5) });
    } catch {
    }
  }
  return out3;
}
function startJob(paths, job, now2 = () => /* @__PURE__ */ new Date()) {
  const dir = jobsDir(paths);
  mkdirSync7(dir, { recursive: true });
  for (const old of readJobs(paths)) if (!alive(old.pid)) rmSync6(join6(dir, `${old.key}.json`), { force: true });
  const key = `${job.kind}-${job.task ?? job.env ?? "repo"}-${process.pid}-${++marked}`.replace(/[^\w.-]/g, "_");
  const file = join6(dir, `${key}.json`);
  writeFileSync9(`${file}.tmp`, JSON.stringify({ ...job, key, pid: process.pid, startedAt: now2().toISOString() }) + "\n");
  renameSync5(`${file}.tmp`, file);
  return key;
}
function endJob(paths, key) {
  rmSync6(join6(jobsDir(paths), `${key}.json`), { force: true });
}
function withJob(paths, job, fn2, now2) {
  let key = null;
  try {
    key = startJob(paths, job, now2);
  } catch {
    key = null;
  }
  try {
    return fn2();
  } finally {
    if (key) endJob(paths, key);
  }
}

// packages/core/src/ratchets.ts
import { appendFileSync as appendFileSync2, existsSync as existsSync6, mkdirSync as mkdirSync8, readFileSync as readFileSync10, renameSync as renameSync6, writeFileSync as writeFileSync10 } from "node:fs";
import { dirname as dirname4 } from "node:path";
var FLOORS_FILE = ".acc/floors.json";
var isRelaxed = (v) => isObj(v) && typeof v.by === "string" && typeof v.reason === "string" && typeof v.at === "string" && (v.was === null || typeof v.was === "number");
function parseFloors(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw)) return null;
  const out3 = {};
  for (const [name, e] of Object.entries(raw)) {
    if (!isObj(e)) return null;
    const keys = Object.keys(e);
    const limits = keys.filter((k2) => k2 === "floor" || k2 === "ceiling");
    if (limits.length !== 1 || keys.some((k2) => k2 !== limits[0] && k2 !== "relaxed")) return null;
    const value = e[limits[0]];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (e.relaxed !== void 0 && !isRelaxed(e.relaxed)) return null;
    out3[name] = { [limits[0]]: value, ...e.relaxed ? { relaxed: e.relaxed } : {} };
  }
  return out3;
}
var formatFloors = (floors) => `${JSON.stringify(floors, null, 2)}
`;
function readFloors(file) {
  if (!existsSync6(file)) return {};
  const floors = parseFloors(readFileSync10(file, "utf8"));
  if (!floors) throw new AccError("bad-floors", `${file} isn't a list of floors: each entry needs a "floor" or a "ceiling", a number.`);
  return floors;
}
function writeFloors(file, floors) {
  mkdirSync8(dirname4(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync10(tmp, formatFloors(floors));
  renameSync6(tmp, file);
}
function floorsAt(run2, root, ref) {
  const r = run2("git", ["show", `${ref}:${FLOORS_FILE}`], { cwd: root });
  if (r.code !== 0) return {};
  const floors = parseFloors(r.stdout);
  if (!floors) throw new AccError("bad-floors", `${FLOORS_FILE} at ${ref.slice(0, 7)} isn't a list of floors: each entry needs a "floor" or a "ceiling", a number.`);
  return floors;
}
var limitOf = (e) => e.ceiling !== void 0 ? "ceiling" : "floor";
var valueOf = (e, limit) => e && limitOf(e) === limit ? e[limit] ?? null : null;
var isWorse = (limit, a2, than) => limit === "floor" ? a2 < than : a2 > than;
var num = (n) => Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
var signed = (n) => n > 0 ? `+${num(n)}` : n < 0 ? `\u2212${num(-n)}` : "\xB10";
function parseNumber(stdout) {
  const line = stdout.replace(/\x1b\[[0-9;]*m/g, "").split("\n").map((l3) => l3.trim()).filter(Boolean).at(-1) ?? "";
  return /^[-+]?(\d+(\.\d+)?|\.\d+)$/.test(line) ? Number(line) : null;
}
function ratchetLine(d) {
  return d.base === null ? `${d.label} ${num(d.value)} (first floor)` : `${d.label} ${num(d.base)} \u2192 ${num(d.value)} (${signed(d.diff ?? d.value - d.base)})`;
}
var words2 = (limit) => limit === "floor" ? { limit: "floor", worse: "below", lowers: "lowers" } : { limit: "ceiling", worse: "above", lowers: "raises" };
function judgeRatchet(name, spec, value, floors, env) {
  const { label, limit } = spec;
  const w = words2(limit);
  const headEntry = floors.head[name];
  if (headEntry && limitOf(headEntry) !== limit) {
    return { status: "error", summary: `${FLOORS_FILE} gives ${name} a ${limitOf(headEntry)}, but .acc/config.json says it has a ${limit}. Make them agree.` };
  }
  const head = valueOf(headEntry, limit);
  const base = valueOf(floors.base[name], limit);
  const details = (floor2, raised) => ({
    ratchet: { label, limit, value, floor: floor2, base, diff: base === null ? null : value - base, ...raised ? { raised } : {} }
  });
  if (base !== null && (head === null || isWorse(limit, head, base)) && !(head !== null && relaxedTo(floors.relaxed, name, limit, head, base))) {
    const what = head === null ? `drops ${name}'s ${w.limit}` : `${w.lowers} ${name}'s ${w.limit} to ${num(head)}`;
    return { status: "fail", summary: `${FLOORS_FILE} ${what}, from ${num(base)} on ${env}, and no person relaxed it. Put it back to ${num(base)}: only a person relaxes a ${w.limit}, with acc gate relax.`, details: details(base) };
  }
  const floor = head ?? base;
  if (floor === null) {
    if (floors.raise) return { status: "pass", summary: `${label} ${num(value)}, the first ${w.limit}: wrote it in ${FLOORS_FILE}. Commit that file, then run acc gate run again.`, details: details(null, { from: null, to: value }) };
    return { status: "pass", summary: `${label} ${num(value)}. No ${w.limit} yet.`, details: details(null) };
  }
  if (isWorse(limit, value, floor)) {
    return { status: "fail", summary: `${label} ${num(value)} is ${w.worse} its ${w.limit} ${num(floor)}, by ${num(Math.abs(value - floor))}. Make it ${num(floor)} or better. If this change has to make it worse, block and say why: only a person relaxes a ${w.limit}.`, details: details(floor) };
  }
  if (value === floor) return { status: "pass", summary: `${label} ${num(value)}, at its ${w.limit}.`, details: details(floor) };
  if (floors.raise) {
    return { status: "pass", summary: `${label} ${num(value)} beats the ${w.limit} ${num(floor)}: raised it in ${FLOORS_FILE}. Commit that file, then run acc gate run again.`, details: details(floor, { from: floor, to: value }) };
  }
  return { status: "pass", summary: `${label} ${num(value)} beats the ${w.limit} ${num(floor)} by ${num(Math.abs(value - floor))}.`, details: details(floor) };
}
function readRatchet(name, spec, r, floors, env) {
  const last = (t) => t.replace(/\x1b\[[0-9;]*m/g, "").split("\n").map((l3) => l3.trim()).filter(Boolean).at(-1) ?? "";
  if (r.code !== 0) return { status: "error", summary: `${spec.label} couldn't be measured: ${last(r.stderr) || last(r.stdout) || `the command exited with ${r.code}`}.` };
  const value = parseNumber(r.stdout);
  if (value === null) return { status: "error", summary: `${spec.label} couldn't be measured: the command's last line isn't a number${last(r.stdout) ? ` ("${last(r.stdout).slice(0, 80)}")` : ""}.` };
  return judgeRatchet(name, spec, value, floors, env);
}
function ratchetGate(name, spec, heavy) {
  return {
    name,
    heavy,
    about: `${spec.command} (${spec.label}, which may only go ${spec.limit === "floor" ? "up" : "down"})`,
    plan: (input) => {
      const floors = input.floors?.();
      if (!floors || "problem" in floors) return { outcome: { status: "error", summary: floors?.problem ?? `${name}'s floors weren't read.` } };
      return { cmd: "sh", args: ["-c", spec.command], env: { ACC_CHANGED: input.changes.files.join("\n") }, read: (r) => readRatchet(name, spec, r, floors, input.env.branch) };
    }
  };
}
function withRaises(floors, raises) {
  const out3 = { ...floors };
  for (const r of raises) out3[r.gate] = { [r.limit]: r.to };
  return out3;
}
function carriesOver(parentFloors, headFloors, parentReceipts) {
  const same2 = (a2, b) => JSON.stringify(a2) === JSON.stringify(b);
  if (Object.keys(parentFloors).some((k2) => !(k2 in headFloors))) return false;
  const changed = Object.keys(headFloors).filter((k2) => !same2(parentFloors[k2], headFloors[k2]));
  if (!changed.length) return false;
  return changed.every((k2) => {
    const e = headFloors[k2];
    const measured = parentReceipts[k2]?.details?.ratchet;
    return !e.relaxed && !!measured?.raised && measured.limit === limitOf(e) && measured.value === valueOf(e, measured.limit) && measured.raised.to === measured.value;
  });
}
function mergeFloors(common, ours, theirs) {
  const [c, o, t] = [common.trim() ? parseFloors(common) : {}, parseFloors(ours), parseFloors(theirs)];
  if (!c || !o || !t) return null;
  const out3 = {};
  for (const name of [.../* @__PURE__ */ new Set([...Object.keys(t), ...Object.keys(o), ...Object.keys(c)])]) {
    const [ce2, oe2, te2] = [c[name], o[name], t[name]];
    if (ce2 && (!oe2 || !te2)) return null;
    const limit = limitOf(oe2 ?? te2);
    if ([ce2, oe2, te2].some((e) => e && limitOf(e) !== limit)) return null;
    const [cv, ov, tv] = [valueOf(ce2, limit), valueOf(oe2, limit), valueOf(te2, limit)];
    if (cv !== null && (ov !== null && isWorse(limit, ov, cv) || tv !== null && isWorse(limit, tv, cv))) return null;
    out3[name] = ov === null ? te2 : tv === null ? oe2 : isWorse(limit, ov, tv) ? te2 : oe2;
  }
  return formatFloors(out3);
}
function readRelaxed(file) {
  if (!existsSync6(file)) return [];
  return readFileSync10(file, "utf8").split("\n").filter(Boolean).flatMap((l3) => {
    try {
      const r = JSON.parse(l3);
      return typeof r.ratchet === "string" && typeof r.to === "number" && (r.limit === "floor" || r.limit === "ceiling") ? [r] : [];
    } catch {
      return [];
    }
  });
}
function relaxCounts(r, ledger) {
  const task = r.task ? ledger.tasks.find((t) => t.id === r.task) : void 0;
  return !!task && task.state !== "done";
}
function relaxesFor(records, ledger, task, branch) {
  const t = task ? ledger.tasks.find((x2) => x2.id === task) : void 0;
  if (!t || !branch || t.run?.branch !== branch) return [];
  return records.filter((r) => r.task === t.id && relaxCounts(r, ledger));
}
function pruneRelaxed(file, ledger) {
  const all = readRelaxed(file);
  const kept = all.filter((r) => relaxCounts(r, ledger));
  const lines = existsSync6(file) ? readFileSync10(file, "utf8").split("\n").filter(Boolean).length : 0;
  if (kept.length === lines) return 0;
  writeAtomic(file, kept.map((r) => `${JSON.stringify(r)}
`).join(""));
  return lines - kept.length;
}
function relaxedTo(records, name, limit, value, base) {
  const mine = records.filter((r) => r.ratchet === name && r.limit === limit);
  const from = /* @__PURE__ */ new Set([base]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of mine) if (from.has(r.was) && !from.has(r.to)) {
      from.add(r.to);
      grew = true;
    }
  }
  return mine.some((r) => from.has(r.was) && (r.to === value || isWorse(limit, r.to, value)));
}
function relaxFloor(relaxedFile, floorsFile, root, config, req) {
  const ratchets = config.gates.ratchets ?? {};
  const spec = ratchets[req.ratchet];
  if (!spec) throw new AccError("usage", `No ratchet ${req.ratchet}. This project's ratchets: ${Object.keys(ratchets).join(", ") || "none"}.`);
  const reason = req.reason.trim();
  if (!reason) throw new AccError("usage", `Say why it's relaxed: acc gate relax ${req.ratchet} --to <n> --reason "<why>". The reason is kept with the floor.`);
  if (!Number.isFinite(req.to)) throw new AccError("usage", `--to takes the ${spec.limit} as a number, such as --to 640.`);
  const floors = readFloors(floorsFile);
  const was = valueOf(floors[req.ratchet], spec.limit);
  const w = words2(spec.limit);
  if (was === null) throw new AccError("refused", `${req.ratchet} has no ${w.limit} in ${floorsFile} yet, so there's nothing to relax.`);
  if (!isWorse(spec.limit, req.to, was)) throw new AccError("refused", `${num(req.to)} isn't ${w.worse} ${req.ratchet}'s ${w.limit}, ${num(was)}, so it doesn't relax it. acc raises a ${w.limit} itself when a change beats it.`);
  const at2 = req.now().toISOString();
  writeFloors(floorsFile, { ...floors, [req.ratchet]: { [spec.limit]: req.to, relaxed: { by: req.by, reason, at: at2, was } } });
  const record2 = { ratchet: req.ratchet, limit: spec.limit, to: req.to, was, by: req.by, reason, at: at2, task: req.task, root };
  mkdirSync8(dirname4(relaxedFile), { recursive: true });
  appendFileSync2(relaxedFile, `${JSON.stringify(record2)}
`);
  return record2;
}

// packages/core/src/receipts.ts
import { existsSync as existsSync7, mkdirSync as mkdirSync9, readdirSync as readdirSync3, readFileSync as readFileSync11, renameSync as renameSync7, writeFileSync as writeFileSync11 } from "node:fs";
import { join as join7 } from "node:path";
function ratchetOf(r) {
  const d = r?.details?.ratchet;
  return d && typeof d.value === "number" && typeof d.label === "string" && (d.limit === "floor" || d.limit === "ceiling") ? d : null;
}
var satisfies = (r) => (r?.status === "pass" || r?.status === "skip") && !ratchetOf(r)?.raised;
function receiptPath(paths, sha, gate) {
  return join7(paths.receipts, sha, `${gate}.json`);
}
function readReceipt(paths, sha, gate) {
  const f = receiptPath(paths, sha, gate);
  if (!existsSync7(f)) return null;
  try {
    return JSON.parse(readFileSync11(f, "utf8"));
  } catch {
    return null;
  }
}
function receiptsAt(paths, sha) {
  const dir = join7(paths.receipts, sha);
  if (!existsSync7(dir)) return {};
  const out3 = {};
  for (const f of readdirSync3(dir).filter((n) => n.endsWith(".json"))) {
    const r = readReceipt(paths, sha, f.slice(0, -5));
    if (r) out3[r.gate] = r;
  }
  return out3;
}
var EARLIER_LIMIT = 500;
function earlierCounts(paths, run2, base, gate, command, sha) {
  const kept = existsSync7(paths.receipts) ? new Set(readdirSync3(paths.receipts)) : /* @__PURE__ */ new Set();
  kept.delete(sha);
  if (!kept.size) return null;
  const nearest = (range, ok) => {
    const r = run2("git", ["rev-list", `--max-count=${EARLIER_LIMIT}`, ...range], { cwd: paths.root });
    for (const at2 of r.code === 0 ? r.stdout.split("\n").map((l3) => l3.trim()).filter((l3) => kept.has(l3)) : []) {
      const receipt = readReceipt(paths, at2, gate);
      if (receipt?.counts && receipt.command === command && ok(receipt)) return receipt;
    }
    return null;
  };
  return nearest([sha, `^${base}`], (r) => !!r.waived) ?? nearest([base], () => true);
}
function writeReceipt(paths, receipt) {
  const f = receiptPath(paths, receipt.sha, receipt.gate);
  mkdirSync9(join7(paths.receipts, receipt.sha), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync11(tmp, JSON.stringify(receipt, null, 2) + "\n");
  renameSync7(tmp, f);
  return f;
}
function receiptHooks(paths, config, run2) {
  return {
    missingGates(task, scope = "builder") {
      const required = requiredGates(config, task.environment, scope);
      if (!required.length) return [];
      const branch = task.run?.branch;
      if (!branch) return required;
      const sha = run2("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: paths.root });
      if (sha.code !== 0) return required;
      const head = sha.stdout.trim();
      const passed = (g) => satisfies(readReceipt(paths, head, g));
      const missing = required.filter((g) => !passed(g));
      const full = fullGates(config);
      if (missing.length && full.length && full.every(passed)) return [];
      return missing;
    }
  };
}

// packages/core/src/refresh.ts
import { existsSync as existsSync15 } from "node:fs";

// packages/core/src/dispatch.ts
import { spawnSync as spawnSync3 } from "node:child_process";
import { existsSync as existsSync14, mkdirSync as mkdirSync20, readFileSync as readFileSync22, realpathSync as realpathSync3, symlinkSync, writeFileSync as writeFileSync20 } from "node:fs";
import { homedir as homedir5 } from "node:os";
import { basename as basename5, dirname as dirname8, isAbsolute as isAbsolute4, join as join19, resolve as resolve2, sep as sep2 } from "node:path";

// packages/core/src/cloud.ts
import { chmodSync, existsSync as existsSync11, mkdirSync as mkdirSync16, rmSync as rmSync9, writeFileSync as writeFileSync16 } from "node:fs";
import { join as join14 } from "node:path";

// packages/core/src/config-edit.ts
import { readFileSync as readFileSync12 } from "node:fs";
var Scanner = class {
  i = 0;
  text;
  objects = /* @__PURE__ */ new Map();
  constructor(text) {
    this.text = text;
  }
  /** The top value's span, every object found on the way kept by where it starts. */
  scan() {
    this.space();
    const v = this.value();
    this.space();
    if (this.i !== this.text.length) this.fail("more after the end");
    return v;
  }
  fail(why) {
    throw new SyntaxError(`Not JSON at ${this.i}: ${why}`);
  }
  space() {
    while (this.i < this.text.length && " 	\n\r".includes(this.text[this.i])) this.i++;
  }
  value() {
    const start = this.i;
    const c = this.text[this.i];
    if (c === "{") return this.object();
    if (c === "[") {
      this.i++;
      this.space();
      if (this.text[this.i] === "]") {
        this.i++;
        return { start, end: this.i };
      }
      for (; ; ) {
        this.value();
        this.space();
        if (this.text[this.i] === ",") {
          this.i++;
          this.space();
          continue;
        }
        if (this.text[this.i] === "]") {
          this.i++;
          return { start, end: this.i };
        }
        this.fail("expected , or ]");
      }
    }
    if (c === '"') {
      this.string();
      return { start, end: this.i };
    }
    const m = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(this.text.slice(this.i));
    if (!m) this.fail("expected a value");
    this.i += m[0].length;
    return { start, end: this.i };
  }
  string() {
    const start = this.i;
    this.i++;
    while (this.i < this.text.length && this.text[this.i] !== '"') this.i += this.text[this.i] === "\\" ? 2 : 1;
    if (this.i >= this.text.length) this.fail("a string never ends");
    this.i++;
    return JSON.parse(this.text.slice(start, this.i));
  }
  object() {
    const start = this.i;
    this.i++;
    const members = [];
    this.space();
    if (this.text[this.i] !== "}") {
      for (; ; ) {
        this.space();
        if (this.text[this.i] !== '"') this.fail("expected a key");
        const keyStart = this.i;
        const key = this.string();
        this.space();
        if (this.text[this.i] !== ":") this.fail("expected :");
        this.i++;
        this.space();
        members.push({ key, keyStart, value: this.value() });
        this.space();
        if (this.text[this.i] === ",") {
          this.i++;
          continue;
        }
        if (this.text[this.i] === "}") break;
        this.fail("expected , or }");
      }
    }
    this.i++;
    const o = { start, end: this.i, members };
    this.objects.set(start, o);
    return o;
  }
};
var canon = (v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k2) => [k2, canon(v[k2])])) : Array.isArray(v) ? v.map(canon) : v;
var sameJson = (a2, b) => JSON.stringify(canon(a2)) === JSON.stringify(canon(b));
var indentAt = (text, at2) => /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", at2 - 1) + 1))[0];
var indentUnit = (text) => /\n([ \t]+)\S/.exec(text)?.[1] ?? "  ";
var shaped = (value, unit, indent) => JSON.stringify(value, null, unit).replace(/\n/g, `
${indent}`);
var inline = (value) => JSON.stringify(value, null, 1).replace(/\n\s*/g, " ");
var oneLine = (text, span) => {
  const old = text.slice(span.start, span.end);
  return /^[[{]/.test(old) && !old.includes("\n") && !/^(\[\s*\]|\{\s*\})$/.test(old);
};
function withValue(raw, path, value) {
  const [key, ...rest] = path;
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (!rest.length) {
    const { [key]: _old, ...others } = obj;
    return value === void 0 ? others : { ...obj, [key]: value };
  }
  if (value === void 0 && !(key in obj)) return obj;
  return { ...obj, [key]: withValue(obj[key], rest, value) };
}
function editJsonKey(text, path, value) {
  if (!path.length) throw new Error("editJsonKey needs a path.");
  const raw = JSON.parse(text);
  const wanted = withValue(raw, path, value);
  const unit = indentUnit(text);
  const whole = JSON.stringify(wanted, null, unit) + "\n";
  if (sameJson(raw, wanted)) return text;
  const fits = (edited2) => {
    try {
      return sameJson(JSON.parse(edited2), wanted);
    } catch {
      return false;
    }
  };
  let edited = null;
  try {
    edited = editAt(text, path, value, unit);
  } catch {
    edited = null;
  }
  return edited !== null && fits(edited) ? edited : whole;
}
function editAt(text, path, value, unit) {
  const s = new Scanner(text);
  const top = s.scan();
  let obj = s.objects.get(top.start);
  if (!obj) return null;
  for (let depth = 0; depth < path.length; depth++) {
    const key = path[depth];
    const m = obj.members.filter((x2) => x2.key === key).at(-1);
    const last = depth === path.length - 1;
    if (m && last) {
      if (value !== void 0) return text.slice(0, m.value.start) + (oneLine(text, m.value) ? inline(value) : shaped(value, unit, indentAt(text, m.keyStart))) + text.slice(m.value.end);
      return removeMember(text, obj, m);
    }
    if (m) {
      const inner = s.objects.get(m.value.start);
      if (!inner) return null;
      obj = inner;
      continue;
    }
    if (value === void 0) return text;
    const nested = path.slice(depth + 1).reduceRight((v, k2) => ({ [k2]: v }), value);
    return addMember(text, obj, key, nested, unit);
  }
  return null;
}
function addMember(text, obj, key, value, unit) {
  const prev = obj.members.at(-1);
  if (!prev) {
    const outer = indentAt(text, obj.start);
    const indent2 = outer + unit;
    return `${text.slice(0, obj.start)}{
${indent2}${JSON.stringify(key)}: ${shaped(value, unit, indent2)}
${outer}}${text.slice(obj.end)}`;
  }
  const sameLine = !text.slice(obj.start, prev.keyStart).includes("\n");
  const indent = sameLine ? "" : indentAt(text, prev.keyStart);
  const gap = sameLine ? " " : `
${indent}`;
  return `${text.slice(0, prev.value.end)},${gap}${JSON.stringify(key)}: ${sameLine ? inline(value) : shaped(value, unit, indent)}${text.slice(prev.value.end)}`;
}
function removeMember(text, obj, m) {
  const i = obj.members.indexOf(m);
  const before = obj.members[i - 1];
  const after = obj.members[i + 1];
  if (after) return text.slice(0, m.keyStart) + text.slice(after.keyStart);
  if (before) return text.slice(0, before.value.end) + text.slice(m.value.end);
  return `${text.slice(0, obj.start)}{}${text.slice(obj.end)}`;
}
function writeJsonKey(file, path, value) {
  let text;
  try {
    text = readFileSync12(file, "utf8");
    JSON.parse(text);
  } catch (e) {
    throw new AccError("bad-config", `Couldn't read ${file}: ${e.message}`);
  }
  const edited = editJsonKey(text, path, value);
  if (edited !== text) writeAtomic(file, edited);
}

// packages/core/src/cloud-guard.ts
import { existsSync as existsSync8, mkdirSync as mkdirSync10, readFileSync as readFileSync13, writeFileSync as writeFileSync12, renameSync as renameSync8 } from "node:fs";
import { dirname as dirname5, join as join8 } from "node:path";
var GUARD_PATH = ".claude/hooks/acc-push-guard.mjs";
var PRE_PUSH_PATH = ".claude/hooks/acc-pre-push";
var SETTINGS_PATH = ".claude/settings.json";
var GUARD_MATCHER = "Bash|Edit|Write|MultiEdit|NotebookEdit";
var GUARD_COMMAND = `node "$CLAUDE_PROJECT_DIR"/${GUARD_PATH} || exit 2`;
var SESSION_COMMAND = `node "$CLAUDE_PROJECT_DIR"/${GUARD_PATH} --session-start || exit 2`;
var RECORD_LINE = "Acc-Branch";
var GUARD_SCRIPT = `#!/usr/bin/env node
// acc's cloud push guard (GH-69): what a cloud builder must never do, refused before it runs. Written by
// acc cloud enable, which writes it again when acc's own changes; committed under .claude/hooks/ beside
// acc-pre-push, and run by the hooks in .claude/settings.json: PreToolUse on Bash, Edit, Write, MultiEdit
// and NotebookEdit, and SessionStart (--session-start) to install the git pre-push hook. It needs no acc,
// no ledger and no plugin: a cloud session runs only what the repo commits.
//
// Two lines of defence, in a cloud session (CLAUDE_CODE_REMOTE=true, or CLAUDE_CODE_REMOTE_SESSION_ID set):
//
// 1. Before a command runs, this script reads it. Only \`git push origin <branch>\` and \`git push origin
//    HEAD:<branch>\` pass, with -u or --set-upstream before origin if wanted, where <branch> is the task's
//    from the record acc put in the fire's text (an Acc-Branch line), read from the session's first message
//    in its transcript: never from the checkout, which a builder could switch. Everything else that could
//    push is refused: any other push; a push reached through git's global options, a path to git, a
//    wrapper (timeout, env, nohup, xargs, eval, exec), an assignment of GIT_*, HOME, PATH, XDG_*, LD_*,
//    EDITOR or VISUAL, a program that runs another from its arguments (find -exec, npm exec, watch, flock,
//    script, parallel), a shell with -c, whose inner line is guarded the same way, or a script file; \`git\`
//    followed by \`push\` or \`send-pack\` anywhere else in a command's words, or with a substitution's
//    placeholder where the branch would be; an alias, git's or the shell's, and hash -p; --no-verify with
//    any program; git clone and git init; core.hooksPath set by any means; a git config key off a short
//    allow-list (user.name, user.email, commit.gpgsign and the like: core.editor, diff.external, filter.*,
//    sequence.editor and gpg.program run code); a remote changed; gh off its allow-list (pr view|list|diff|checks, issue view,
//    run view|list, api with GET, auth status); curl or wget writing to GitHub; a deploy. It also refuses
//    what could change the guard or its hooks: from Bash, a write anywhere under .claude/ or .git/ (globs
//    and symlinks resolved; reads pass); from Edit, Write, MultiEdit or NotebookEdit, the hooks, any
//    .claude/settings*.json and anything under .git/; \`git checkout <ref> -- <paths>\`, \`git apply\`, \`git
//    am\` and \`patch\` where they would touch .claude/ or .git/; a checkout, reset, merge, rebase,
//    cherry-pick or revert that would change the guard's files.
//
// 2. The push itself. A git pre-push hook, acc-pre-push beside this file, is installed into the clone's
//    .git/hooks/ when the session starts and again before any push passes. It reads the refs git is about
//    to update and refuses any update other than refs/heads/<branch>, a deletion, and one that isn't a
//    fast-forward, however git was invoked: a wrapper, an alias, a renamed or copied binary, a script in any
//    language. The branch is in .git/acc-task-branch, written here from the record. --no-verify and
//    core.hooksPath would switch it off, which is why the first line refuses them.
//
// It fails closed: input it can't read, or an error of its own, blocks the command (exit 2), and the hook
// entry runs it as \`node \u2026 || exit 2\`, so a guard that can't load denies too. Outside a cloud session it
// prints nothing and exits 0: local builders have the plugin's guards (D-042), and a person on main isn't
// a builder.
import { execFileSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The line acc puts in the fire's text, which names the task's branch: the guard's record. */
export const RECORD = 'Acc-Branch';
/** What the task's branch looks like. */
export const BRANCH = /^task\\/[A-Za-z0-9._/-]+$/;
/** Whether this is a cloud session: the documented session id, or the flag the CLI sets. */
export const inCloud = (env = process.env) => env.CLAUDE_CODE_REMOTE === 'true' || !!env.CLAUDE_CODE_REMOTE_SESSION_ID;
/** The tools the guard looks at; every other tool passes without a word. */
const TOOLS = new Set(['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
/** The git pre-push hook beside this file, and the record it reads, in the clone's git dir. */
export const PRE_PUSH = 'acc-pre-push';
export const PRE_PUSH_RECORD = 'acc-task-branch';

// ---------------------------------------------------------------- the command line, split

/** What a \`$( )\` or backtick pair leaves in the word it stood in: it names nothing the guard allows. */
export const SUBSTITUTED = '$(...)';

/**
 * A command line split into its commands, and each into words: quotes kept together, separators cut, a
 * \`$( )\` or backtick read as its own command even inside double quotes (only single quotes are literal), a
 * heredoc's body skipped. The command around a substitution stays whole, with SUBSTITUTED where the
 * substitution stood, so \`git push origin "task/x$(echo :main)"\` reads as a push of \`task/x$(...)\`, never
 * of \`task/x\`; the substitution's own commands come first. Nothing stripped. acc's hooks.ts commandsOf splits the same way, and a test keeps
 * the two the same.
 */
export function rawCommandsOf(line) {
  const out = [];
  let words = [];
  let word = '';
  let quote = null;
  let any = false;
  // What to go back to when a \`$( )\` or a backtick pair closes: the command it opened in, its word so far
  // with SUBSTITUTED added, and the quote it opened inside, if any. A \`(\` alone opens a group, which cuts.
  const stack = [];
  // Heredoc terminators still to skip, in order; a \`<<\` alone takes the next word as its terminator.
  const heredocs = [];
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
  const open = (back, tick) => { stack.push({ group: false, back, tick, words, word: word + SUBSTITUTED }); words = []; word = ''; any = false; quote = null; };
  const close = (top) => { next(); words = top.words; word = top.word; any = true; quote = top.back; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else { word += c; any = true; }
      continue;
    }
    if (quote === '"') {
      if (c === '"') { quote = null; continue; }
      if (c === '\\\\' && i + 1 < line.length) { word += line[++i]; any = true; continue; }
      if (c === '\`') { open('"', true); continue; }
      if (c === '$' && line[i + 1] === '(') { open('"', false); i++; continue; }
      word += c;
      any = true;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; any = true; continue; }
    if (c === '\\\\' && i + 1 < line.length) { word += line[++i]; any = true; continue; }
    if (c === '\`') {
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
    if (c === '\\n') {
      next();
      // A heredoc's body is the command's input, not commands: skip to its terminator line.
      while (heredocs.length && i < line.length) {
        const term = heredocs.shift();
        let j = i + 1;
        for (;;) {
          const nl = line.indexOf('\\n', j);
          const l = nl < 0 ? line.slice(j) : line.slice(j, nl);
          if (l.replace(/^\\t+/, '') === term || nl < 0) { i = nl < 0 ? line.length : nl; break; }
          j = nl + 1;
        }
      }
      continue;
    }
    if (/\\s/.test(c)) { end(); continue; }
    if (c === ';' || c === '|' || c === '&') { next(); continue; }
    word += c;
    any = true;
  }
  // A substitution left open at the end still leaves its command whole: the shell would refuse the line.
  for (let top = stack.pop(); top; top = stack.pop()) if (!top.group) close(top);
  next();
  return out;
}

/** The same, with leading environment assignments and the wrappers that don't change what runs stripped: as acc's hooks.ts commandsOf, and a test keeps the two the same. */
export function commandsOf(line) {
  return rawCommandsOf(line).map((w) => {
    let i = 0;
    while (i < w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i]) || ['nice', 'env', 'time', 'command', 'npx', 'sudo'].includes(w[i]) || (w[i - 1] === 'nice' && /^-n$|^-\\d+$/.test(w[i])) || (w[i - 2] === 'nice' && w[i - 1] === '-n'))) i++;
    return w.slice(i);
  }).filter((w) => w.length);
}

// ---------------------------------------------------------------- the record

/**
 * The task's branch from the transcript (the fire's text, in the session's first message): the first
 * Acc-Branch line in a user message before the first assistant turn. Later messages never count: a tool's
 * result comes back as a user message too, and a builder could put anything in one.
 */
export function recordOf(transcript) {
  const pattern = new RegExp(\`^\\\\s*\${RECORD}:\\\\s*(\\\\S+)\\\\s*$\`, 'm');
  for (const raw of transcript.split('\\n')) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type === 'assistant') return null;
    if (entry?.type !== 'user') continue;
    const content = entry.message?.content;
    const texts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter((b) => b && b.type === 'text').map((b) => String(b.text ?? '')) : [];
    for (const t of texts) {
      const m = pattern.exec(t);
      if (m) return BRANCH.test(m[1]) ? m[1] : null;
    }
  }
  return null;
}

/** The first part of a file, enough for the session's first message. */
function readHead(file, bytes = 4 * 1024 * 1024) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.toString('utf8', 0, n);
  } finally {
    closeSync(fd);
  }
}

// ---------------------------------------------------------------- paths

const name = (word) => (word ? basename(word) : '');

/** A path with its symlinks resolved, down to its deepest part that exists: a link made first can't hide where a write lands. */
function realDeep(p) {
  let cur = p;
  const rest = [];
  while (!existsSync(cur)) {
    rest.unshift(basename(cur));
    const up = dirname(cur);
    if (up === cur) return p;
    cur = up;
  }
  try {
    return join(realpathSync(cur), ...rest);
  } catch {
    return p;
  }
}

const realOf = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

/** Whether \`path\` is \`dir\` or inside it. */
function within(path, dir) {
  const r = relative(dir, path);
  return r === '' || (!r.startsWith('..') && !r.startsWith('/'));
}

/** The segments of an absolute path that are the guard's or git's: \`.claude/hooks/\u2026\`, \`.claude/settings*.json\`, \`.git/\u2026\`. */
const GUARD_SEGMENT = /(^|\\/)\\.claude\\/(hooks(\\/|$)|settings[^/]*\\.json$)/;
const GIT_SEGMENT = /(^|\\/)\\.git(\\/|$)/;

/** The clone's git dir, resolved, or null where git can't say. */
function gitDirOf(ctx) {
  try {
    return realOf(execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: ctx.projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    return null;
  }
}

/** Whether a file, by its path from cwd, is one the guard keeps: resolved through symlinks, as the write would land. */
function isGuarded(given, ctx, what) {
  const abs = resolve(ctx.cwd, given);
  const root = realOf(ctx.projectDir);
  for (const p of [abs, realDeep(abs)]) {
    const rel = within(p, root) ? relative(root, p) : null;
    if (rel !== null && (GUARD_SEGMENT.test(\`/\${rel}\`) || GIT_SEGMENT.test(\`/\${rel}\`))) return true;
    if (what === 'any' && rel !== null && (rel === '.claude' || rel.startsWith('.claude/'))) return true;
    // Settings or hooks of any .claude folder, the home's among them, and any .git: the session's own.
    if (GUARD_SEGMENT.test(p) || GIT_SEGMENT.test(p)) return true;
    const gitDir = ctx.gitDir === undefined ? (ctx.gitDir = gitDirOf(ctx)) : ctx.gitDir;
    if (gitDir && within(p, gitDir)) return true;
    if (ctx.transcript && p === resolve(ctx.transcript)) return true;
  }
  return false;
}

/** The entries a glob names, in its folder: \`.cl*\` names .claude. A dot pattern matches dot entries, as the shell does. */
function globbed(word, ctx) {
  const dir = dirname(word);
  const pat = basename(word);
  if (/[*?[]/.test(dir)) return [word.replace(/[*?[].*$/, '')];
  let entries;
  try {
    entries = readdirSync(resolve(ctx.cwd, dir));
  } catch {
    return [];
  }
  const re = new RegExp(\`^\${pat.replace(/[.+^\${}()|\\\\]/g, '\\\\$&').replace(/\\*+/g, '[^/]*').replace(/\\?/g, '[^/]')}$\`);
  return entries.filter((e) => (pat.startsWith('.') || !e.startsWith('.')) && re.test(e)).map((e) => join(dir, e));
}

// ---------------------------------------------------------------- git

const WRAPPERS = new Set(['timeout', 'env', 'nohup', 'xargs', 'nice', 'ionice', 'sudo', 'doas', 'time', 'command', 'builtin', 'exec', 'setsid', 'stdbuf', 'unbuffer', 'chronic', 'caffeinate', 'npx']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const INTERPRETERS = new Set(['node', 'nodejs', 'deno', 'bun', 'python', 'python3', 'ruby', 'perl', 'php', 'tsx', 'ts-node']);
/** An assignment that changes what git is, where it looks, or what runs for it: a command after one isn't plain. */
const SENSITIVE_VAR = /^(GIT_|XDG_|LD_|DYLD_)|^(HOME|PATH|EDITOR|VISUAL|SHELL|BASH_ENV|ENV)$/;
/** git settings a cloud builder may set, for a command or for good: identity and the like, none of which runs code or sends a push elsewhere. */
const CONFIG_ALLOWED = /^(user\\.(name|email)|commit\\.gpgsign|tag\\.gpgsign|core\\.(autocrlf|safecrlf|filemode|ignorecase|quotepath|symlinks|longpaths|precomposeunicode)|init\\.defaultbranch|pull\\.(rebase|ff)|merge\\.(ff|conflictstyle)|rebase\\.(autostash|autosquash|updaterefs)|rerere\\.(enabled|autoupdate)|fetch\\.prune|log\\.date|diff\\.(renames|algorithm|colormoved)|status\\.(showuntrackedfiles|branch|short)|branch\\.(autosetuprebase|autosetupmerge)|advice\\.[a-z]+|color\\.[a-z.]+|column\\.[a-z]+|safe\\.directory)$/i;
const FORCE = { '-f': 'force-push', '--force': 'force-push', '--force-with-lease': 'force-push', '--force-if-includes': 'force-push', '--mirror': 'push everything', '--all': 'push everything', '--tags': 'push tags', '--follow-tags': 'push tags', '--delete': 'delete a branch', '-d': 'delete a branch', '--prune': 'delete branches' };
/** Commands that only read, so a line of them may name the guard's files; find isn't one (-delete, -exec). */
const READ_ONLY = new Set(['cat', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'ls', 'wc', 'stat', 'file', 'diff', 'cmp', 'md5sum', 'shasum', 'sha256sum', 'jq', 'echo', 'printf', 'test', '[', 'true', 'false', 'tree', 'du', 'pwd', 'which', 'type', 'sort', 'uniq', 'cut', 'tr', 'basename', 'dirname', 'realpath', 'readlink', 'date']);
const GIT_READS = new Set(['diff', 'show', 'log', 'status', 'blame', 'cat-file', 'ls-files', 'ls-tree', 'grep', 'rev-parse', 'branch', 'remote', 'config']);
/** The programs the guard reads on their own; found later in another program's words, they're guarded as what it runs. */
const HANDLED = new Set(['git', 'gh', 'sf', 'curl', 'wget', 'eval', 'source', 'patch', ...SHELLS, ...INTERPRETERS]);
/** The guard's own files, as paths from the repo's root. */
export const GUARD_FILES = ['.claude/hooks', '.claude/settings.json'];

const allowedPush = (record) => \`git push origin \${record} (or git push origin HEAD:\${record}, with -u before origin if you like)\`;

/** Why this push may not run, given the task's branch from the record, or null for the two allowed forms. */
export function pushProblem(args, record) {
  if (!record) return \`The guard has no record of your branch: no \${RECORD} line in this session's first message. It allows no push without one. Commit your work and stop: a person collects it.\`;
  const words = [...args];
  if (words[0] === '-u' || words[0] === '--set-upstream') words.shift();
  if (words.length === 2 && words[0] === 'origin' && (words[1] === record || words[1] === \`HEAD:\${record}\`)) return null;
  const how = \`Push only your task branch, plainly: \${allowedPush(record)}.\`;
  const redirect = words.find((a) => /^\\d*[<>]/.test(a));
  if (redirect) return \`Push plainly, with nothing after the branch (not \${redirect}). \${how}\`;
  const flag = words.find((a) => a.startsWith('-'));
  if (flag) {
    const short = /^-[a-zA-Z]+$/.test(flag) ? [...flag.slice(1)].map((c) => \`-\${c}\`).find((f) => FORCE[f]) : null;
    const why = FORCE[flag] ?? FORCE[flag.split('=')[0]] ?? (short ? FORCE[short] : null);
    return \`Never \${why ?? \`push with \${flag}\`} (\${flag}). \${how}\`;
  }
  const [remote, ...specs] = words;
  if (!remote) return \`A bare git push could go anywhere. \${how}\`;
  if (remote !== 'origin') return \`Push to origin only, not \${remote}. \${how}\`;
  for (const spec of specs) {
    if (spec.startsWith('+')) return \`Never force-push (\${spec}). \${how}\`;
    const [src, dst] = spec.includes(':') ? spec.split(':', 2) : [spec, spec];
    if (!src) return \`Never delete a branch (\${spec}). \${how}\`;
    const plain = (r) => r.replace(/^refs\\/heads\\//, '');
    if (plain(dst) !== record) return \`Push only your task branch, \${record}, not \${plain(dst)}. A person lands it: never push \${plain(dst)}. \${how}\`;
    if (plain(src) !== record && src !== 'HEAD') return \`Push only your task branch, \${record}, not \${plain(src)}. \${how}\`;
  }
  return \`\${how} Not: git push \${args.join(' ')}.\`;
}

/** Why a git setting may not be set, or null: off the allow-list, it could run code or send a push elsewhere. */
function keyProblem(key, how) {
  if (/hookspath/i.test(key)) return \`Never set core.hooksPath\${how}: the clone's pre-push hook is the guard's last line, and it wouldn't run.\`;
  if (!CONFIG_ALLOWED.test(key)) return \`Never set \${key}\${how}: only user.name, user.email, commit.gpgsign and the like may be set here. An alias, push, remote, url, credential, hook, editor, filter or program setting could make git push somewhere else, or run something.\`;
  return null;
}

const CONFIG_VALUED = new Set(['-f', '--file', '--blob', '--default', '--type', '-t', '--get-color', '--get-colorbool', '--worktree-path']);
/** Whether \`git config\` with these words only reads. */
const configReads = (rest) => !rest.includes('-e') && !rest.includes('--edit') && rest[0] !== 'edit' && (rest.some((a) => /^(--get|--get-all|--get-regexp|--get-urlmatch|-l|--list|--show-origin|--show-scope)$/.test(a)) || rest[0] === 'get' || rest[0] === 'list');
function configProblem(rest) {
  if (rest.includes('-e') || rest.includes('--edit') || rest[0] === 'edit') return 'Never open the git config in an editor. Set user.name and user.email plainly, if that\\'s what you need.';
  if (configReads(rest)) return null;
  const words = ['set', 'unset', 'rename-section', 'remove-section', 'unset-all', 'replace-all', 'add'].includes(rest[0] ?? '') ? rest.slice(1) : rest;
  let key = null;
  for (let i = 0; i < words.length; i++) {
    const a = words[i];
    if (a.startsWith('-')) { if (CONFIG_VALUED.has(a)) i++; continue; }
    key = a;
    break;
  }
  if (!key) return null;
  return keyProblem(key, '');
}

/** Why \`git checkout <ref> -- <paths>\` may not run: the paths reach the guard's files, and the ref's differ from HEAD's. */
function restoreProblem(sub, before, paths, ctx) {
  const ref = before.find((a) => !a.startsWith('-'));
  if (!ref) return null;
  const reaches = paths.some((p) => {
    if (p.startsWith(':') || /[*?[]/.test(p)) return true;
    const rel = relative(realOf(ctx.projectDir), realDeep(resolve(ctx.cwd, p)));
    return rel === '' || rel === '.' || rel.startsWith('..') || rel === '.claude' || rel.startsWith('.claude/') || GIT_SEGMENT.test(\`/\${rel}\`);
  });
  return reaches ? touchProblem(sub, [ref], ctx) : null;
}

function checkoutProblem(sub, rest, record, ctx) {
  const at = rest.indexOf('--');
  if (at >= 0) return restoreProblem(sub, rest.slice(0, at), rest.slice(at + 1), ctx);
  if (rest.some((a) => ['-b', '-B', '-c', '-C', '--orphan', '--detach', '-t', '--track'].includes(a) || a.startsWith('--orphan=') || a.startsWith('--track='))) return \`Make no new branch. Stay on your task branch\${record ? \`, \${record}\` : ''}.\`;
  const target = rest.find((a) => !a.startsWith('-'));
  if (!target) return null;
  if (!record) return \`The guard has no record of your branch (no \${RECORD} line in this session's first message), so it can't let you switch to \${target}.\`;
  if (target !== record) return \`Stay on your task branch, \${record}. git \${sub} \${target} would leave it. To restore a file, use git checkout -- <file>.\`;
  return null;
}

/** Why merging, rebasing onto, cherry-picking, reverting or restoring from these refs may not run: one of them changes the guard. */
function touchProblem(sub, rest, ctx) {
  for (const ref of rest.filter((a) => !a.startsWith('-'))) {
    const args = sub === 'cherry-pick' || sub === 'revert' ? ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', ref, '--', ...GUARD_FILES] : ['diff', '--name-only', 'HEAD', ref, '--', ...GUARD_FILES];
    let out;
    try {
      out = execFileSync('git', args, { cwd: ctx.projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return \`The guard couldn't read \${ref} to see whether git \${sub} would change the guard: check the ref, and fetch it first if it's origin's.\`;
    }
    if (out.trim()) return \`git \${sub} \${ref} would change the guard (\${out.trim().split('\\n').join(', ')}): a person does that. Commit what you have and block.\`;
  }
  return null;
}

/** A patch's headers that name the guard's folders, however many path parts a -p strips. */
const PATCH_NAMES = /^(?:diff --git a\\/|\\+\\+\\+ (?:b\\/)?|--- (?:a\\/)?|rename (?:to|from) |copy (?:to|from) )(?:\\.\\/)?(?:[^\\s/]+\\/)*\\.(?:claude|git)(?:\\/|\\s|$)/m;
const APPLY_DRY = new Set(['--check', '--numstat', '--stat', '--summary', '--dry-run', '--show-current-patch']);

/** Why \`git apply\`, \`git am\` or \`patch\` may not run: it reads from a pipe the guard can't see, or its patch would touch .claude/ or .git/. */
function patchProblem(what, rest, ctx, raw) {
  if (rest.some((a) => APPLY_DRY.has(a))) return null;
  if (what === 'git am' && rest.some((a) => ['--abort', '--continue', '--skip', '--quit', '--resolved', '-r'].includes(a))) return null;
  const files = [];
  if (what === 'patch') {
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '-i' || rest[i] === '--input') files.push(rest[++i]);
      else if (rest[i].startsWith('--input=')) files.push(rest[i].slice('--input='.length));
      else if (/^-i./.test(rest[i])) files.push(rest[i].slice(2));
    }
  } else {
    files.push(...rest.filter((a) => !a.startsWith('-')));
  }
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '<' && raw[i + 1]) files.push(raw[i + 1]);
    else if (/^<[^<]/.test(raw[i])) files.push(raw[i].slice(1));
  }
  if (!files.filter(Boolean).length) return \`The guard can't see what \${what} would change from a pipe, or from nothing: write the patch to a file and name it (\${what} <file>).\`;
  for (const f of files.filter(Boolean)) {
    let text;
    try {
      text = readFileSync(resolve(ctx.cwd, f), 'utf8');
    } catch {
      return \`The guard couldn't read \${f} to see what \${what} would change. Write the patch to a file it can read.\`;
    }
    if (PATCH_NAMES.test(text)) return \`\${what} \${f} would change .claude/ or .git/, where the guard and its hooks live: a person does that. Leave them out of the patch.\`;
  }
  if (what === 'git apply') {
    // The surest list, from git itself: --numstat applies nothing.
    let out;
    try {
      out = execFileSync('git', ['apply', '--numstat', ...rest], { cwd: ctx.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return \`The guard couldn't read the patch to see what git apply would change (git apply --numstat failed): fix the patch first.\`;
    }
    for (const l of out.split('\\n')) {
      const path = l.split('\\t')[2];
      if (path && /(^|[\\s/{"])\\.(claude|git)(\\/|$)/.test(path)) return \`git apply would change \${path.trim()}, where the guard and its hooks live: a person does that.\`;
    }
  }
  return null;
}

/** Whether \`git <sub>\` is an alias in this clone: an alias could stand for anything, so a cloud builder runs none. */
function isAlias(sub, ctx) {
  try {
    execFileSync('git', ['config', '--get', \`alias.\${sub}\`], { cwd: ctx.projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch (e) {
    if (e && e.status === 1) return false;
    throw new Error(\`git config couldn't say whether \${sub} is an alias: \${e?.message ?? e}\`);
  }
}

/** Why this git command may not run, or null. \`wrapped\` says a wrapper, an assignment or a path led here: a push then never passes. */
export function gitProblem(args, record, ctx, wrapped, raw) {
  let i = 0;
  const configs = [];
  // Any option before the subcommand means a push isn't plain, so it never passes; some are refused outright.
  while (i < args.length && args[i].startsWith('-')) {
    const a = args[i];
    if (a === '-c' || a === '--config-env') { configs.push(args[i + 1] ?? ''); i += 2; wrapped = true; continue; }
    if (/^-c./.test(a)) { configs.push(a.slice(2)); i++; wrapped = true; continue; }
    if (a.startsWith('--config-env=')) { configs.push(a.slice('--config-env='.length)); i++; wrapped = true; continue; }
    if (['--no-pager', '-P', '--paginate', '-p', '--literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs', '--no-optional-locks', '--no-replace-objects', '--version', '--help', '-h'].includes(a)) { i++; wrapped = wrapped || !['--version', '--help', '-h'].includes(a); continue; }
    return \`Run git plainly, without \${a.split('=')[0]} before the command: the guard can't tell what git \${a.split('=')[0]} would push from, or as.\`;
  }
  for (const kv of configs) {
    const why = keyProblem(kv.split('=')[0] ?? '', ' for a command');
    if (why) return why;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (!sub || sub === '--version' || sub === '--help') return null;
  if (!/^[a-z][a-z0-9-]*$/i.test(sub)) return \`The guard doesn't know the git command "\${sub}". Run a plain git command.\`;
  if (rest.includes('--no-verify') || (sub === 'commit' && rest.some((a) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(a)))) return 'Never skip the repo\\'s git hooks (--no-verify): the clone\\'s pre-push hook is the guard\\'s last line. If a hook fails, fix what it found.';
  if (sub === 'clone' || sub === 'init') return \`Work in this clone: a repo from git \${sub} has none of the guard's hooks, so nothing would check a push from it.\`;
  if (sub === 'push') {
    if (wrapped) return \`Push plainly, as its own command: \${allowedPush(record ?? '<your task branch>')}. Not through a wrapper, an assignment, a path to git, or git's own options.\`;
    const why = pushProblem(rest, record);
    // A push the guard allows: noted for the hook, which installs the pre-push hook before it lets it run.
    if (!why) ctx.pushes = true;
    return why;
  }
  if (sub === 'send-pack' || sub === 'request-pull') return \`Push only with git push: \${allowedPush(record ?? '<your task branch>')}.\`;
  if (isAlias(sub, ctx)) return \`git \${sub} is an alias here, and a cloud builder runs no aliases: run the command it stands for, plainly.\`;
  if (sub === 'config') return configProblem(rest);
  if (sub === 'remote') {
    const verb = rest.find((a) => !a.startsWith('-'));
    if (verb && ['add', 'set-url', 'rename', 'remove', 'rm', 'set-head', 'set-branches', 'update', 'prune'].includes(verb)) return \`Never change the remotes (git remote \${verb}): origin is the only remote, as it is.\`;
    return null;
  }
  if (sub === 'checkout' || sub === 'switch') return checkoutProblem(sub, rest, record, ctx);
  if (sub === 'reset' && rest.some((a) => ['--hard', '--merge', '--keep'].includes(a))) return 'Don\\'t reset --hard, --merge or --keep: it throws away work, and could take the guard with it. Revert or amend what you need instead.';
  if (sub === 'restore' && rest.some((a) => a === '-s' || a === '--source' || a.startsWith('--source='))) return 'Don\\'t restore from another commit (--source): it could change the guard. git restore <file>, from the index, is fine.';
  if (sub === 'pull') return 'Don\\'t pull: git fetch origin <branch>, then git merge origin/<branch>, so the guard can look at what comes in.';
  if (sub === 'worktree') return 'acc makes and removes worktrees. Work in this clone.';
  if (['update-index', 'read-tree', 'checkout-index'].includes(sub)) return \`Don't write the index or the tree with git \${sub}: it could put another guard in place. Use git add, git checkout -- <file> and git restore.\`;
  if (sub === 'apply' || sub === 'am') return patchProblem(\`git \${sub}\`, rest, ctx, raw);
  if (['merge', 'rebase', 'cherry-pick', 'revert'].includes(sub)) return touchProblem(sub, rest, ctx);
  return null;
}

// ---------------------------------------------------------------- the pre-push hook

/** The clone's path for one of git's own files: \`.git/hooks\`, \`.git/acc-task-branch\`. */
function gitPath(ctx, what) {
  return resolve(ctx.projectDir, execFileSync('git', ['rev-parse', '--git-path', what], { cwd: ctx.projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
}

function writeIfChanged(file, text, mode) {
  let current = null;
  try { current = readFileSync(file, 'utf8'); } catch { current = null; }
  if (current !== text) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = \`\${file}.\${process.pid}.tmp\`;
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  }
  if (mode !== undefined) chmodSync(file, mode);
}

/**
 * Installs the pre-push hook into the clone's .git/hooks/, from acc-pre-push beside this file, and writes
 * the record it reads. Returns why it couldn't, or null. core.hooksPath set anywhere means git wouldn't run
 * it, and that's refused rather than worked around.
 */
export function installPrePush(ctx, record) {
  const source = join(ctx.guardDir ?? join(ctx.projectDir, '.claude', 'hooks'), PRE_PUSH);
  let script;
  try {
    script = readFileSync(source, 'utf8');
  } catch {
    return \`The pre-push hook's script isn't beside the guard (\${PRE_PUSH}): acc cloud enable writes it, on the Mac, and it's committed with the guard. No push until it is.\`;
  }
  let hooksPath = '';
  try {
    hooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: ctx.projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    if (!(e && e.status === 1)) throw new Error(\`git config couldn't say whether core.hooksPath is set: \${e?.message ?? e}\`);
  }
  if (hooksPath) return \`core.hooksPath is set (\${hooksPath}), so the clone's pre-push hook wouldn't run: no push until a person unsets it.\`;
  writeIfChanged(join(gitPath(ctx, 'hooks'), 'pre-push'), script, 0o755);
  if (record) writeIfChanged(gitPath(ctx, PRE_PUSH_RECORD), \`\${record}\\n\`);
  return null;
}

/** Before a plain push passes: the hook in place and the record written, or the push waits. */
function prePushProblem(ctx, record) {
  try {
    return installPrePush(ctx, record);
  } catch (e) {
    return \`The guard couldn't install the clone's pre-push hook, so no push runs: \${e?.message ?? e}\`;
  }
}

// ---------------------------------------------------------------- gh, curl, sf

function apiProblem(rest) {
  let method = 'GET';
  let fields = false;
  let path = null;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-X' || a === '--method') { method = String(rest[++i] ?? '').toUpperCase(); continue; }
    if (a.startsWith('--method=')) { method = a.slice('--method='.length).toUpperCase(); continue; }
    if (/^-X./.test(a)) { method = a.slice(2).toUpperCase(); continue; }
    if (['-f', '-F', '--field', '--raw-field', '--input'].includes(a)) { fields = true; i++; continue; }
    if (/^(-f|-F)./.test(a) || /^(--field|--raw-field|--input)=/.test(a)) { fields = true; continue; }
    if (['-H', '--header', '-q', '--jq', '-t', '--template', '--cache', '--hostname', '--preview'].includes(a)) { i++; continue; }
    if (!a.startsWith('-') && path === null) path = a;
  }
  if (path && /(^|\\/)graphql$/.test(path)) return 'gh api graphql posts, and GitHub\\'s proxy refuses it in a cloud session anyway: read with gh api <path> (GET), or gh pr view.';
  if (method !== 'GET') return \`gh api only reads here (GET), not \${method}: a person changes GitHub. Push your task branch and stop.\`;
  if (fields) return 'gh api with a field (-f, -F, --input) posts: a person changes GitHub.';
  if (path && /(^|\\/)git\\/refs(\\/|$)/.test(path)) return 'Never touch git/refs through the API: push only your task branch, with git push.';
  if (path && /pulls\\/\\d+\\/merge|\\/merges?$/.test(path)) return 'Never merge through the API. A person merges.';
  return null;
}

/** gh, by allow-list: what a builder reads. Everything else is a person's. */
const GH_ALLOWED = { pr: ['view', 'list', 'diff', 'checks'], issue: ['view'], run: ['view', 'list'], auth: ['status'] };
function ghProblem(sub, rest) {
  if (!sub || sub === '--version' || sub === 'version' || sub === 'help' || sub === '--help') return null;
  if (sub === 'api') return apiProblem(rest);
  const verb = rest.find((a) => !a.startsWith('-')) ?? '';
  if ((GH_ALLOWED[sub] ?? []).includes(verb)) return null;
  const how = 'A cloud builder reads with gh pr view|list|diff|checks, gh issue view, gh run view|list, gh api <path> (GET) and gh auth status, and changes nothing on GitHub';
  if (sub === 'pr' && ['merge', 'create', 'close', 'ready', 'reopen'].includes(verb)) return \`Pull requests are a person's: acc land opens one after review, and a person merges it. Push your task branch with an Acc-Done trailer and stop. \${how}.\`;
  return \`gh \${sub}\${verb ? \` \${verb}\` : ''} isn't one of a cloud builder's commands: \${how}. A person does the rest.\`;
}

function httpProblem(prog, rest, line) {
  if (!/github\\.com/i.test(line)) return null;
  const writes = prog === 'wget'
    ? rest.some((a) => /^--(post-data|post-file|method|body-data|body-file)(=|$)/.test(a))
    : rest.some((a, i) => (a === '-X' || a === '--request') && String(rest[i + 1] ?? '').toUpperCase() !== 'GET') || rest.some((a) => /^(-X(?!GET$).|--request=(?!GET$)|-d.|--data|-F.|--form|-T.|--upload-file|--json)/.test(a) || ['-d', '-F', '-T'].includes(a));
  return writes ? \`Never write to GitHub with \${prog}: a person changes GitHub. Push only your task branch, with git push.\` : null;
}

function sfProblem(sub, rest) {
  if (sub === 'project' && rest[0] === 'deploy' && ['start', 'quick', 'resume'].includes(rest[1] ?? '') && !rest.includes('--dry-run')) return 'Builders validate and never deploy (D-011). A cloud session has no org anyway.';
  return null;
}

// ---------------------------------------------------------------- the line

const isAssignment = (w) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w);
const isRedirect = (w) => /^\\d*>>?$/.test(w) || /^\\d*>>?./.test(w) || w === '&>' || w === '>|';

/** Whether a command only reads: a reader, or git reading, with no redirect, tee or dd. */
function isRead(raw) {
  const u = unwrap(raw).words;
  const p = name(u[0]);
  return (READ_ONLY.has(p) || (p === 'git' && GIT_READS.has(u[1] ?? '') && !(u[1] === 'config' && !configReads(u.slice(2))) && !(u[1] === 'remote' && u.length > 2 && u[2] !== '-v' && u[2] !== 'show' && u[2] !== 'get-url'))) && !raw.some((x) => isRedirect(x) || x === 'tee' || x === 'dd');
}

/**
 * Why a line may not name the guard's files, git's, the transcript, or anything under .claude/: only reads
 * may. By the words as written, and by where each path would land once globs and symlinks are resolved.
 */
function namesGuard(line, commands, ctx) {
  const says = (what) => \`Nothing under \${what} is changed from Bash: the guard, its hooks and the session's settings live there. Read them if you like; for another file under .claude/, use the Edit or Write tool.\`;
  if (/(^|[^A-Za-z0-9_.-])\\.git(\\/|$|[^A-Za-z0-9_.-])/.test(line)) return says('.git/');
  if (/(^|[^A-Za-z0-9_.-])\\.claude(\\/|$|[^A-Za-z0-9_.-])/.test(line) || /\\bacc-push-guard\\.mjs\\b|\\bacc-pre-push\\b|\\bacc-task-branch\\b/.test(line)) return says('.claude/');
  if (ctx.transcript && line.includes(basename(ctx.transcript))) return says('.claude/');
  for (const words of commands) {
    // Every word but the program and its flags: a bare name lands somewhere too, when the shell's cwd is inside .claude/ or .git/.
    for (const w of words.slice(1)) {
      const word = w.replace(/^\\d*>>?/, '').replace(/^&>/, '');
      if (!word || word.startsWith('-') || isAssignment(word)) continue;
      const paths = /[*?[]/.test(word) ? globbed(word, ctx) : [word];
      for (const p of paths) if (isGuarded(p, ctx, 'any')) return says(/\\.git(\\/|$)/.test(realDeep(resolve(ctx.cwd, p))) ? '.git/' : '.claude/');
    }
  }
  return null;
}

/** Drops a wrapper and its own options from the front of a command, until a program is left. Says whether it dropped anything that makes the command less than plain. */
function unwrap(words) {
  let w = words;
  let wrapped = false;
  for (let n = 0; n < 12 && w.length; n++) {
    const prog = name(w[0]);
    if (isAssignment(w[0])) {
      // An assignment that changes what git is, where it looks or what runs for it makes a push less than plain.
      if (SENSITIVE_VAR.test(w[0].split('=')[0])) wrapped = true;
      w = w.slice(1);
      continue;
    }
    if (!WRAPPERS.has(prog)) return { words: w, wrapped };
    wrapped = true;
    w = w.slice(1);
    // The wrapper's own options and values: timeout's duration, nice's -n 15, env's -i or -u NAME, xargs' -I {}, stdbuf's -o0, sudo's -u NAME.
    if (prog === 'timeout') { while (w.length && w[0].startsWith('-')) w = w.slice(['-s', '-k', '--signal', '--kill-after'].includes(w[0]) ? 2 : 1); w = w.slice(1); continue; }
    while (w.length && w[0].startsWith('-')) {
      const o = w[0];
      const takesValue = ['-n', '-u', '-C', '-S', '-I', '-L', '-P', '-d', '-a', '--arg-file', '--max-args', '--max-procs', '--delimiter', '--unset', '--chdir', '-g', '-c', '-p', '-o', '-e', '-i'].includes(o) && !(prog === 'env' && o === '-i') && !(prog === 'xargs' && o === '-i');
      w = w.slice(takesValue ? 2 : 1);
    }
  }
  return { words: w, wrapped };
}

/** Why one command of a line may not run, or null. */
function commandProblem(given, record, ctx, depth, wrappedOuter, line) {
  const raw = given.filter((w) => w !== '');
  const { words, wrapped } = unwrap(raw);
  const [first, ...rest] = words;
  if (!first) {
    // Assignments alone set a variable and run nothing, unless they change what git is or where it looks,
    // which the session's shell would keep; a wrapper alone would read commands the guard can't see.
    if (raw.length && !raw.every(isAssignment)) return \`\${raw[0]} runs nothing by itself here: run the command plainly.\`;
    const sensitive = raw.find((w) => SENSITIVE_VAR.test(w.split('=')[0]));
    if (sensitive) return \`Never set \${sensitive.split('=')[0]} in the session: it changes what git is, where it looks, or what runs for it.\`;
    return null;
  }
  // A \`$\` left over from an older splitter's \`$( \u2026 )\`: what's inside is read as its own command.
  if (first === '$') return null;
  // --no-verify with any program: npm, a script runner or a wrapper could pass it on to git.
  if (raw.some((w) => w === '--no-verify' || w.startsWith('--no-verify='))) return 'Never skip the repo\\'s git hooks (--no-verify), with any program: the clone\\'s pre-push hook is the guard\\'s last line. If a hook fails, fix what it found.';
  if (first.includes('$')) return \`The guard can't tell what \${first} runs: write the program's name, plainly.\`;
  for (let i = 0; i < raw.length; i++) {
    if ((isRedirect(raw[i]) && (raw[i].length > (/^\\d*>>?/.exec(raw[i])?.[0].length ?? 0) ? raw[i] : raw[i + 1] ?? '').includes('$')) || (['tee', 'cp', 'mv', 'ln', 'dd', 'install', 'rsync'].includes(name(first)) && i > 0 && raw[i].includes('$'))) return \`The guard can't tell where \${raw[i]} writes: name the file plainly.\`;
  }
  const prog = name(first);
  const viaPath = first !== prog;
  const wrap = wrapped || viaPath || wrappedOuter;
  // What would change the program a later command's name runs: an alias, or hash -p.
  if (prog === 'alias') return 'A cloud builder defines no shell aliases: an alias could make git, or any command, run something the guard never sees. Run the command plainly.';
  if (prog === 'hash' && rest.some((a) => /^-[a-zA-Z]*p/.test(a))) return 'Never point a command\\'s name at another program (hash -p): the guard reads names, so run the program by its own.';
  if (prog === 'export' || prog === 'declare' || prog === 'typeset' || prog === 'setenv') {
    const sensitive = rest.find((w) => SENSITIVE_VAR.test(w.split('=')[0]));
    if (sensitive) return \`Never set \${sensitive.split('=')[0]} in the session: it changes what git is, where it looks, or what runs for it.\`;
    return null;
  }
  if (prog === 'git') return gitProblem(rest, record, ctx, wrap, raw);
  if (prog === 'gh') return ghProblem(rest[0], rest.slice(1));
  if (prog === 'sf') return sfProblem(rest[0], rest.slice(1));
  if (prog === 'curl' || prog === 'wget') return httpProblem(prog, rest, line);
  // eval is a wrapper: what it runs is guarded, and a push through it never passes.
  if (prog === 'eval') return guard(rest.join(' '), record, ctx, depth + 1, true);
  if (prog === 'source' || prog === '.') return 'Never run a script file (source): run its commands plainly, one by one.';
  if (SHELLS.has(prog)) {
    const at = rest.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
    if (at >= 0) {
      const inner = rest.slice(at + 1).find((a) => !a.startsWith('-'));
      if (inner === undefined) return \`\${prog} -c with no command runs nothing: run the command plainly.\`;
      return guard(inner, record, ctx, depth + 1, wrap);
    }
    return rest.some((a) => !a.startsWith('-')) ? \`Never run a script file with \${prog}: run its commands plainly, one by one, so the guard can see each.\` : \`A bare \${prog} reads commands the guard can't see: run the command plainly.\`;
  }
  if (/\\.(sh|bash|zsh|ksh)$/.test(prog)) return \`Never run a script file (\${prog}): run its commands plainly, one by one, so the guard can see each.\`;
  if (INTERPRETERS.has(prog)) {
    const inline = rest.findIndex((a) => ['-e', '--eval', '-c', '-p', '--print', '-r', '--input-type=module'].includes(a));
    if (inline >= 0 && rest.slice(inline + 1).some((a) => /\\b(git|gh|push)\\b/i.test(a))) return \`The guard can't see what \${prog} \${rest[inline]} does with git: run the git command plainly.\`;
    return null;
  }
  if (prog === 'patch') return patchProblem('patch', rest, ctx, raw);
  if (prog === 'rm' && rest.some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === '--recursive') && rest.some((a) => ['.', './', '..', '/', '*', './*', '~', '.git'].includes(a))) return 'Never remove the whole checkout or its .git: the guard and the session\\'s settings live in it.';
  // A program that runs another from its arguments (find -exec, npm exec, watch, flock, script, parallel,
  // make): what it would run is guarded as if wrapped, so a push through it never passes. Readers aside.
  if (!READ_ONLY.has(prog)) {
    for (let j = 1; j < words.length; j++) {
      const w = words[j];
      const tokens = w.split(/\\s+/).filter(Boolean);
      if (!tokens.length || !HANDLED.has(name(tokens[0]))) continue;
      const why = tokens.length > 1 ? guard(w, record, ctx, depth + 1, true) : commandProblem(words.slice(j), record, ctx, depth + 1, true, line);
      if (why) return why;
    }
  }
  return null;
}

/**
 * Why a cloud builder may not run this command line, or null. \`record\` is the task's branch; depth bounds
 * shells within shells. It reads the line and writes no file: a push it allows sets ctx.pushes, and the hook
 * installs the pre-push hook before that push runs.
 */
export function guard(line, record, ctx, depth = 0, wrappedOuter = false) {
  if (depth > 4) return 'Shells within shells: run the command plainly.';
  const commands = rawCommandsOf(line);
  // A line of reads may name the guard's files; one that writes (a redirect, tee) may not.
  const reads = commands.every(isRead);
  if (!reads) {
    const named = namesGuard(line, commands, ctx);
    if (named) return named;
    if (/hookspath/i.test(line)) return 'Never set core.hooksPath, by any means: the clone\\'s pre-push hook is the guard\\'s last line, and it wouldn\\'t run.';
  }
  for (const raw of commands) {
    const why = commandProblem(raw, record, ctx, depth, wrappedOuter, line);
    if (why) return why;
  }
  // The backstop: git followed by push or send-pack anywhere else in a command's words, however it got there.
  for (const raw of commands) {
    const u = unwrap(raw).words;
    for (let i = 1; i < u.length - 1; i++) {
      if (name(u[i]) === 'git' && (u[i + 1] === 'push' || u[i + 1] === 'send-pack')) return \`Push plainly, as its own command: \${allowedPush(record ?? '<your task branch>')}. Not through \${u[0]}.\`;
    }
  }
  return null;
}

/** Why an Edit, Write, MultiEdit or NotebookEdit may not touch this file, or null: the guard's own files, any .claude/ settings or hooks, anything under .git/, and the transcript the record is read from, each resolved through symlinks. */
export function fileProblem(input, ctx) {
  const given = input?.file_path ?? input?.notebook_path ?? input?.path;
  if (typeof given !== 'string' || !given) return 'The guard couldn\\'t see which file that would write: give its path.';
  const abs = resolve(ctx.cwd, given);
  if (ctx.transcript && (abs === resolve(ctx.transcript) || realDeep(abs) === realOf(ctx.transcript))) return 'The session\\'s transcript isn\\'t yours to edit: the guard reads its record there.';
  if (isGuarded(given, ctx, 'own')) return \`\${relative(ctx.projectDir, realDeep(abs)) || given} is the guard a cloud session runs, its hooks, its settings or git's own files: a cloud builder never changes them. acc cloud enable writes the guard, on the Mac.\`;
  return null;
}

// ---------------------------------------------------------------- the hook

const deny = (reason) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));

/** Fails closed: a block (exit 2), with the reason on stderr, which Claude Code shows. */
function block(reason) {
  process.stderr.write(\`acc's cloud push guard: \${reason}\\n\`);
  process.exit(2);
}

async function main() {
  if (!inCloud()) return;
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return block('the hook\\'s input wasn\\'t JSON, so the guard couldn\\'t read what would run. Nothing runs until it can.');
  }
  const cwd = typeof input?.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const ctx = { cwd, pushes: false, projectDir: process.env.CLAUDE_PROJECT_DIR || cwd, transcript: typeof input?.transcript_path === 'string' ? input.transcript_path : null, guardDir: dirname(fileURLToPath(import.meta.url)) };
  let record = null;
  if (ctx.transcript) {
    try {
      record = recordOf(readHead(ctx.transcript));
    } catch {
      record = null;
    }
  }
  // The session starting: the pre-push hook goes into the clone now, and the record with it if the fire's
  // text is already in the transcript; the first command writes it otherwise.
  if (process.argv[2] === '--session-start') {
    const why = installPrePush(ctx, record);
    if (why) return block(\`the clone's pre-push hook isn't installed: \${why}\`);
    return;
  }
  const tool = input?.tool_name;
  if (typeof tool !== 'string') return block('the hook\\'s input named no tool.');
  if (!TOOLS.has(tool)) return;
  // Kept current on every call, so the record is in place before any push; a push insists on it.
  try { installPrePush(ctx, record); } catch { /* the push path says why */ }
  if (tool !== 'Bash') {
    const why = fileProblem(input.tool_input, ctx);
    if (why) deny(why);
    return;
  }
  const line = input.tool_input?.command;
  if (typeof line !== 'string') return block('the Bash call carried no command string.');
  const why = guard(line, record, ctx);
  if (why) return deny(why);
  // A push the guard allowed: the pre-push hook in place and the record written, or the push waits.
  if (ctx.pushes) {
    const hookWhy = prePushProblem(ctx, record);
    if (hookWhy) deny(hookWhy);
  }
}

/** Whether this file is the program run, not a module a test imported: by real paths, since a temp folder may be a symlink. */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  main().catch((e) => block(\`it hit an error of its own, so nothing runs: \${e?.message ?? e}\`));
}
`;
var PRE_PUSH_SCRIPT = `#!/bin/sh
# acc's cloud pre-push hook (GH-69). Written by acc cloud enable beside the push guard, committed under
# .claude/hooks/, and installed into the clone's .git/hooks/pre-push by the guard when a cloud session
# starts, and again before any push passes. Git runs it on every push, however git was invoked: a wrapper,
# an alias, a renamed or copied binary, a script in any language. It reads the refs git is about to update
# on stdin and refuses any update other than the task's own branch, any deletion, and any update that isn't
# a fast-forward. The task's branch is in .git/acc-task-branch, written by the guard from the record acc
# put in the fire's text. It fails closed: no record, no push. --no-verify and core.hooksPath would skip
# it, which is why the guard refuses both before the command runs.
refuse() {
  echo "acc's pre-push hook: $1" >&2
  exit 1
}
record=$(git rev-parse --git-path acc-task-branch 2>/dev/null) || refuse "git couldn't say where the record is: no push."
if [ -z "$record" ] || [ ! -s "$record" ]; then
  refuse "no record of the task's branch (acc-task-branch in the git dir), so no push. Commit your work and stop: a person collects it."
fi
branch=$(sed -n 1p "$record" | tr -d '\\r')
case "$branch" in
  task/*) ;;
  *) refuse "the record names no task branch ($branch): no push." ;;
esac
while read -r local_ref local_sha remote_ref remote_sha; do
  [ -n "$remote_ref" ] || continue
  if [ "$remote_ref" != "refs/heads/$branch" ]; then
    refuse "push only your task branch, $branch, not $remote_ref. A person lands it."
  fi
  case "$local_sha" in
    *[!0]*) ;;
    *) refuse "never delete a branch ($remote_ref)." ;;
  esac
  case "$remote_sha" in
    *[!0]*)
      git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null || refuse "never force-push: $branch on origin ($remote_sha) isn't behind what you'd push ($local_sha). Fetch it and merge, then push again."
      ;;
  esac
done
exit 0
`;
function settingsRunGuard(text) {
  try {
    const s = JSON.parse(text);
    const pre = (s.hooks?.PreToolUse ?? []).some((h2) => h2.matcher === GUARD_MATCHER && (h2.hooks ?? []).some((x2) => x2.command === GUARD_COMMAND));
    const start = (s.hooks?.SessionStart ?? []).some((h2) => (h2.hooks ?? []).some((x2) => x2.command === SESSION_COMMAND));
    return pre && start;
  } catch {
    return false;
  }
}
function guardCommitted(run2, root, ref) {
  const show = (path) => run2("git", ["show", `${ref}:${path}`], { cwd: root });
  const fix = `run acc cloud enable, commit ${GUARD_PATH}, ${PRE_PUSH_PATH} and ${SETTINGS_PATH} on it, and merge that into any branch a cloud session starts from`;
  for (const [path, text] of [[GUARD_PATH, GUARD_SCRIPT], [PRE_PUSH_PATH, PRE_PUSH_SCRIPT]]) {
    const r = show(path);
    if (r.code !== 0) return { ok: false, why: `${ref} doesn't carry ${path}: ${fix}.` };
    if (r.stdout !== text) return { ok: false, why: `${ref} carries an older ${path} than this acc writes: ${fix}.` };
  }
  const settings = show(SETTINGS_PATH);
  if (settings.code !== 0) return { ok: false, why: `${ref} doesn't carry ${SETTINGS_PATH}: ${fix}.` };
  if (!settingsRunGuard(settings.stdout)) return { ok: false, why: `${SETTINGS_PATH} on ${ref} doesn't run the guard on ${GUARD_MATCHER} and at SessionStart: ${fix}.` };
  return { ok: true, why: null };
}
function installGuard(root) {
  const written = [];
  for (const [path, text] of [[GUARD_PATH, GUARD_SCRIPT], [PRE_PUSH_PATH, PRE_PUSH_SCRIPT]]) {
    const file2 = join8(root, path);
    mkdirSync10(dirname5(file2), { recursive: true });
    if (!existsSync8(file2) || readFileSync13(file2, "utf8") !== text) {
      writeWhole(file2, text);
      written.push(path);
    }
  }
  const file = join8(root, SETTINGS_PATH);
  let settings = {};
  if (existsSync8(file)) {
    try {
      settings = JSON.parse(readFileSync13(file, "utf8"));
    } catch (e) {
      throw new Error(`${SETTINGS_PATH} isn't valid JSON: ${e.message}`);
    }
  }
  if (!existsSync8(file) || !settingsRunGuard(readFileSync13(file, "utf8"))) {
    const hooks = settings.hooks ?? {};
    const ours = (x2) => !!x2.command && /acc-push-guard\.mjs/.test(x2.command);
    const pre = (hooks.PreToolUse ?? []).filter((h2) => !(h2.hooks ?? []).some(ours));
    pre.push({ matcher: GUARD_MATCHER, hooks: [{ type: "command", command: GUARD_COMMAND, timeout: 20 }] });
    const start = (hooks.SessionStart ?? []).filter((h2) => !(h2.hooks ?? []).some(ours));
    start.push({ hooks: [{ type: "command", command: SESSION_COMMAND, timeout: 20 }] });
    settings = { ...settings, hooks: { ...hooks, PreToolUse: pre, SessionStart: start } };
    writeWhole(file, JSON.stringify(settings, null, 2) + "\n");
    written.push(SETTINGS_PATH);
  }
  return { written };
}
function writeWhole(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync12(tmp, text);
  renameSync8(tmp, file);
}

// packages/core/src/gates.ts
import { existsSync as existsSync9, mkdirSync as mkdirSync13, readFileSync as readFileSync16, writeFileSync as writeFileSync15 } from "node:fs";
import { join as join11, posix } from "node:path";

// packages/core/src/semaphore.ts
import { mkdirSync as mkdirSync12, readdirSync as readdirSync4, readFileSync as readFileSync15, rmSync as rmSync7, statSync as statSync4, utimesSync, writeFileSync as writeFileSync14 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { join as join10 } from "node:path";

// packages/core/src/machine.ts
import { mkdirSync as mkdirSync11, readFileSync as readFileSync14, renameSync as renameSync9, writeFileSync as writeFileSync13 } from "node:fs";
import { dirname as dirname6, join as join9 } from "node:path";
function machineDir(env = process.env) {
  if (env.ACC_MACHINE_FILE) return dirname6(env.ACC_MACHINE_FILE);
  const home = env.HOME || env.USERPROFILE;
  return home ? join9(home, ".acc") : null;
}
function machineJson(env = process.env) {
  const dir = machineDir(env);
  return env.ACC_MACHINE_FILE || (dir ? join9(dir, "machine.json") : null);
}
function readMachineKey(key, env = process.env) {
  const file = machineJson(env);
  if (!file) return void 0;
  try {
    return JSON.parse(readFileSync14(file, "utf8"))?.[key];
  } catch {
    return void 0;
  }
}
function machineJsonToWrite(env = process.env) {
  const file = machineJson(env);
  if (!file) throw new AccError("refused", "acc can't tell where this machine's settings are kept: its environment has no HOME. Set HOME, or ACC_MACHINE_FILE, and try again.");
  return file;
}
function setMachineKey(key, value, env = process.env) {
  const file = machineJsonToWrite(env);
  mkdirSync11(dirname6(file), { recursive: true });
  withLock(`${file}.lock`, () => {
    let current3 = {};
    try {
      current3 = JSON.parse(readFileSync14(file, "utf8"));
    } catch {
    }
    const { [key]: _was, ...rest } = current3;
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync13(tmp, JSON.stringify(value === void 0 ? rest : { ...rest, [key]: value }, null, 2) + "\n");
    renameSync9(tmp, file);
  });
}

// packages/core/src/semaphore.ts
var heavyDir = (env = process.env) => env.ACC_HEAVY_DIR || join10(homedir3(), ".acc", "heavy");
var MAX_HEAVY_SLOTS = 8;
var slotCount = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_HEAVY_SLOTS, n) : null;
};
function heavySlots(env = process.env) {
  const fromEnv = slotCount(env.ACC_HEAVY_SLOTS);
  if (fromEnv) return fromEnv;
  return slotCount(readMachineKey("heavySlots", env)) ?? 1;
}
function setHeavySlots(n, env = process.env) {
  const slots = slotCount(n);
  if (!slots || slots !== n) throw new AccError("usage", `Heavy-check slots are a whole number from 1 to ${MAX_HEAVY_SLOTS}.`);
  setMachineKey("heavySlots", slots, env);
  return slots;
}
var UNOWNED_GRACE_MS = 1e4;
function take(slot, owner) {
  try {
    mkdirSync12(slot);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    return false;
  }
  writeFileSync14(join10(slot, "owner"), JSON.stringify({ ...owner, pid: process.pid, at: Date.now() }));
  return true;
}
function reclaim(slot) {
  let owner = null;
  try {
    owner = JSON.parse(readFileSync15(join10(slot, "owner"), "utf8"));
  } catch {
    owner = null;
  }
  let age = 0;
  try {
    age = Date.now() - statSync4(slot).mtimeMs;
  } catch {
    return;
  }
  if (owner ? !alive(owner.pid) : age > UNOWNED_GRACE_MS) rmSync7(slot, { recursive: true, force: true });
}
function freeSlots(dir, slots) {
  const free = [];
  for (let i = 0; i < slots; i++) {
    const slot = join10(dir, `slot-${i}`);
    reclaim(slot);
    try {
      statSync4(slot);
    } catch {
      free.push(slot);
    }
  }
  return free;
}
var waitingDir = (dir) => join10(dir, "waiting");
var STALE_WAIT_MS = 15e3;
var waited = 0;
function liveWaiters(dir, staleMs, now2 = Date.now()) {
  const folder = waitingDir(dir);
  let names3 = [];
  try {
    names3 = readdirSync4(folder).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out3 = [];
  for (const name of names3) {
    const file = join10(folder, name);
    try {
      if (now2 - statSync4(file).mtimeMs > staleMs) continue;
      const w = JSON.parse(readFileSync15(file, "utf8"));
      if (Number.isInteger(w.pid) && w.pid > 0 && typeof w.at === "number" && alive(w.pid)) out3.push({ ...w, file });
    } catch {
    }
  }
  return out3.sort((a2, b) => a2.at - b.at || a2.file.localeCompare(b.file));
}
function withSlot(fn2, opts = {}) {
  const dir = opts.dir ?? heavyDir();
  const slots = opts.slots ?? heavySlots();
  const timeoutMs = opts.timeoutMs ?? 3 * 60 * 6e4;
  const pollMs = opts.pollMs ?? 500;
  const staleMs = Math.max(STALE_WAIT_MS, pollMs * 10);
  mkdirSync12(dir, { recursive: true });
  const started = Date.now();
  let mine = null;
  let told = false;
  try {
    for (; ; ) {
      const free = freeSlots(dir, slots);
      const line = liveWaiters(dir, staleMs);
      const place2 = mine ? line.findIndex((w) => w.file === mine) : -1;
      if (mine && place2 < 0) mine = null;
      const ahead = place2 >= 0 ? place2 : line.length;
      if (ahead < free.length) {
        for (const slot of free) {
          if (!take(slot, opts.owner)) continue;
          if (mine) rmSync7(mine, { force: true });
          mine = null;
          if (told) opts.onTake?.();
          try {
            return fn2();
          } finally {
            rmSync7(slot, { recursive: true, force: true });
          }
        }
      }
      if (!mine) {
        mkdirSync12(waitingDir(dir), { recursive: true });
        const file = join10(waitingDir(dir), `${process.pid}-${++waited}.json`);
        writeFileSync14(file, JSON.stringify({ ...opts.owner, pid: process.pid, at: Date.now() }));
        mine = file;
        if (!told) {
          told = true;
          opts.onWait?.();
        }
      } else {
        const t = /* @__PURE__ */ new Date();
        try {
          utimesSync(mine, t, t);
        } catch {
          mine = null;
        }
      }
      if (Date.now() - started > timeoutMs) {
        throw new AccError("busy", `Every heavy-check slot in ${dir} stayed taken for ${Math.round(timeoutMs / 6e4)} minutes. If no check is running, delete that folder.`);
      }
      sleep(pollMs);
    }
  } finally {
    if (mine) rmSync7(mine, { force: true });
  }
}

// packages/core/src/test-counts.ts
var ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
var linesOf = (text) => text.replace(ANSI, "").replace(/\r/g, "").split("\n");
var NODE_KEYS = ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo", "duration_ms"];
var NODE_LINE = { spec: /^ℹ ([a-z_]+) (\d+(?:\.\d+)?)$/, tap: /^# ([a-z_]+) (\d+(?:\.\d+)?)$/ };
function nodeBlocks(lines) {
  const out3 = [];
  for (const re2 of Object.values(NODE_LINE)) {
    for (let i = 0; i < lines.length; i++) {
      if (re2.exec(lines[i])?.[1] !== "tests") continue;
      const block = /* @__PURE__ */ new Map();
      let j2 = i;
      for (; j2 < lines.length; j2++) {
        const m = re2.exec(lines[j2]);
        if (!m || !NODE_KEYS.includes(m[1]) || block.has(m[1])) break;
        block.set(m[1], Number(m[2]));
      }
      i = j2 - 1;
      if (!["tests", "pass", "fail", "skipped", "todo"].every((k2) => block.has(k2))) continue;
      const failed = block.get("fail") + (block.get("cancelled") ?? 0);
      out3.push({ run: block.get("pass") + failed, passed: block.get("pass"), failed, skipped: block.get("skipped"), todo: block.get("todo") });
    }
  }
  return out3;
}
function nodeSkipped(lines) {
  const out3 = [];
  for (const l3 of lines) {
    const spec = /^\s*﹣ (.*?)(?: \(\d+(?:\.\d+)?ms\))? # .*$/.exec(l3);
    if (spec) out3.push(spec[1]);
    const tap = /^\s*ok \d+ - (.*?) # SKIP\b/i.exec(l3);
    if (tap) out3.push(tap[1].replace(/\\#/g, "#").replace(/\\\\/g, "\\"));
  }
  return out3;
}
function jestBlocks(lines) {
  const out3 = [];
  lines.forEach((l3, i) => {
    if (/^No tests found\b/.test(l3)) out3.push({ run: 0, passed: 0, failed: 0, skipped: 0, todo: 0 });
    const m = /^Tests:\s+(.*)$/.exec(l3);
    if (!m || !/^Test Suites:/.test(lines[i - 1] ?? "")) return;
    if (!/\d+ total\b/.test(m[1])) return;
    const n = (word) => Number(new RegExp(`(\\d+) ${word}\\b`).exec(m[1])?.[1] ?? 0);
    out3.push({ run: n("passed") + n("failed"), passed: n("passed"), failed: n("failed"), skipped: n("skipped"), todo: n("todo") });
  });
  return out3;
}
var jestSkipped = (lines) => lines.map((l3) => /^\s+○ skipped (.+)$/.exec(l3)?.[1]).filter((n) => !!n);
var add = (a2, b) => ({
  run: a2.run + b.run,
  passed: a2.passed + b.passed,
  failed: a2.failed + b.failed,
  skipped: a2.skipped + b.skipped,
  todo: a2.todo + b.todo
});
function readTestCounts(stdout, stderr = "") {
  const lines = linesOf(`${stdout}
${stderr}`);
  const found = [
    { runner: "node:test", blocks: nodeBlocks(lines), names: nodeSkipped(lines) },
    { runner: "jest", blocks: jestBlocks(lines), names: jestSkipped(lines) }
  ].filter((f) => f.blocks.length);
  if (!found.length) return null;
  const total = found.flatMap((f) => f.blocks).reduce(add);
  const names3 = found.flatMap((f) => f.names);
  return { ...total, ...names3.length ? { skippedNames: names3 } : {}, runner: found.map((f) => f.runner).join(", ") };
}
var num2 = (v) => typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : null;
function apexCounts(result) {
  const rtr = result?.details?.runTestResult;
  const run2 = num2(rtr?.numTestsRun) ?? num2(result?.numberTestsTotal);
  const failed = num2(rtr?.numFailures) ?? num2(result?.numberTestErrors);
  if (run2 === null || failed === null) return null;
  return { run: run2, passed: Math.max(run2 - failed, 0), failed, skipped: 0, todo: 0, runner: "apex" };
}
var NO_COUNTS = "No test summary acc can read in its output, so it can't say how many tests ran.";
function countsLine(c) {
  return [`${c.run} run`, ...c.failed ? [`${c.failed} failed`] : [], `${c.skipped} skipped`, ...c.todo ? [`${c.todo} todo`] : []].join(", ");
}
var testsText = (r) => r.counts ? countsLine(r.counts) : r.countsNote === NO_COUNTS ? "not read" : "";
function newlySkipped(now2, before) {
  const was = before.skippedNames ?? (before.skipped === 0 ? [] : null);
  if (!now2.skippedNames || !was) return [];
  const left = /* @__PURE__ */ new Map();
  for (const n of was) left.set(n, (left.get(n) ?? 0) + 1);
  return now2.skippedNames.filter((n) => {
    const k2 = left.get(n) ?? 0;
    if (k2) left.set(n, k2 - 1);
    return !k2;
  });
}

// packages/core/src/stray-files.ts
var DATA_EXT = /\.(csv|xls|xlsx|eml)$/i;
var MAX_FILE_BYTES = 1024 * 1024;
var SCRATCH = /\.(log|tmp|orig|rej)$/i;
var inside = (path, list) => list.some((p) => path === p || path.startsWith(`${p.replace(/\/+$/, "")}/`));
function findStrayFiles(added, rules) {
  const out3 = [];
  for (const { path, bytes } of added) {
    if (inside(path, rules.allow)) continue;
    const name = path.slice(path.lastIndexOf("/") + 1);
    const rule = SCRATCH.test(name) || name === ".DS_Store" ? "scratch" : rules.profile === "salesforce" && DATA_EXT.test(name) && !inside(path, rules.data) ? "data" : bytes > MAX_FILE_BYTES ? "size" : !path.includes("/") ? "root" : null;
    if (rule) out3.push({ path, rule });
  }
  return out3;
}
var WHY = {
  scratch: "a log, temp file or merge leftover",
  data: "a data export",
  size: "over 1 MB",
  root: "a new file at the repo root"
};
function rulesAt(config, show) {
  let own;
  try {
    const text = show();
    own = text ? parseConfig(JSON.parse(text)).config?.strayFiles : void 0;
  } catch {
    own = void 0;
  }
  const strayFiles = own ?? config.strayFiles;
  return { profile: config.profile, allow: strayFiles.allow, data: strayFiles.data };
}
function strayOutcome(found, checked, profile) {
  if (!found.length) {
    const what = profile === "salesforce" ? "a log or temp file, a new root file, a file over 1 MB or a data export" : "a log or temp file, a new root file or a file over 1 MB";
    return { status: "pass", summary: `Checked ${checked} added file${checked === 1 ? "" : "s"}: none is ${what}.` };
  }
  const quote = (p) => /^[\w@%+=:,./-]+$/.test(p) ? p : JSON.stringify(p);
  const each = found.map((f) => `${f.path} (${WHY[f.rule]})`).join(", ");
  const listing = profile === "salesforce" ? `list it under "strayFiles.allow" in .acc/config.json, or a data file's folder under "strayFiles.data"` : 'list it under "strayFiles.allow" in .acc/config.json';
  return {
    status: "fail",
    summary: `This change adds ${found.length === 1 ? "a file" : `${found.length} files`} that shouldn't be committed: ${each}. Take each out of the commit with git rm --cached ${found.map((f) => quote(f.path)).join(" ")} and add it to .gitignore, or, if it belongs in the repo, ${listing}.`,
    details: { files: found }
  };
}
var strayFilesGate = {
  name: "stray-files",
  heavy: false,
  about: "no logs, temp files, new root files, files over 1 MB or (Salesforce) data exports added",
  plan({ config, changes, unknownBase, git: git10 }) {
    if (unknownBase) return { outcome: { status: "error", summary: `${unknownBase} stray-files checks only the files a change adds, so it needs that branch.` } };
    if (!changes.added.length) return { outcome: { status: "skip", summary: "This change adds no files." } };
    const sizes = git10(["cat-file", "--batch-check=%(objectsize)"], changes.added.map((p) => `HEAD:${p}
`).join(""));
    if (sizes.code !== 0) return { outcome: { status: "error", summary: `git couldn't size the added files: ${sizes.stderr.trim().split("\n")[0] ?? ""}` } };
    const lines = sizes.stdout.split("\n");
    const added = changes.added.map((path, i) => ({ path, bytes: Number(lines[i]) || 0 }));
    const rules = rulesAt(config, () => {
      const r = git10(["show", "HEAD:.acc/config.json"]);
      return r.code === 0 ? r.stdout : null;
    });
    return { outcome: strayOutcome(findStrayFiles(added, rules), added.length, config.profile) };
  }
};

// packages/core/src/gates.ts
var pass = (summary, details) => ({ status: "pass", summary, details });
var fail = (summary, details) => ({ status: "fail", summary, details });
var error = (summary) => ({ status: "error", summary });
var skip = (summary) => ({ status: "skip", summary });
var listOf = (items, max = 3) => items.slice(0, max).join(", ") + (items.length > max ? ` and ${items.length - max} more` : "");
function lastLine(text) {
  const lines = text.replace(/\x1b\[[0-9;]*m/g, "").split("\n").map((l3) => l3.trim()).filter(Boolean);
  const line = lines.at(-1) ?? "";
  return line.length > 200 ? `${line.slice(0, 197)}\u2026` : line;
}
var shellLine = (cmd, args) => [cmd, ...args].map((a2) => /^[\w@%+=:,./-]+$/.test(a2) ? a2 : `'${a2.replace(/'/g, `'\\''`)}'`).join(" ");
var exitRead = (r) => r.code === 0 ? pass("Passed.") : r.code === 127 ? error(lastLine(r.stderr) || "The command wasn't found.") : fail(lastLine(r.stdout + "\n" + r.stderr) || `Exited with ${r.code}.`);
function checkEnv(env = process.env, heavyDir2) {
  const { ACC_ROLE: _role, ACC_TASK: _task, ACC_CHANGED: _changed, ACC_NEAR_TESTS: _near, ...rest } = env;
  return heavyDir2 ? { ...rest, ACC_HEAVY_DIR: heavyDir2 } : rest;
}
function commandGate(name, command, heavy, changeBound) {
  return {
    name,
    heavy,
    about: command,
    changeBound,
    plan: ({ changes, near }) => ({
      cmd: "sh",
      args: ["-c", command],
      read: exitRead,
      env: { ACC_CHANGED: changes.files.join("\n"), ACC_NEAR_TESTS: near().join("\n") }
    })
  };
}
var TEST_FILE = /(^|\/)(test_[^/]+\.\w+|[^/]+[._](test|spec)\.\w+)$/;
var isTest = (path) => TEST_FILE.test(path);
function packageOf(path, tracked) {
  const parts = path.split("/");
  const at2 = parts.findIndex((p, i) => i < parts.length - 1 && ["src", "lib", "app"].includes(p));
  if (at2 >= 0) return parts.slice(0, at2).join("/");
  for (let n = parts.length - 1; n >= 0; n--) if (tracked.has([...parts.slice(0, n), "package.json"].join("/"))) return parts.slice(0, n).join("/");
  return parts.slice(0, -1).join("/");
}
var CODE = /\.[cm]?[jt]sx?$/;
var withoutExt = (path) => path.replace(CODE, "");
function nearTests(changed, tracked, read2, indexes = []) {
  const files = new Set(tracked);
  const texts = /* @__PURE__ */ new Map();
  const text = (f) => {
    if (!texts.has(f)) texts.set(f, read2(f) ?? "");
    return texts.get(f);
  };
  const relative4 = /* @__PURE__ */ new Map();
  const pathsIn = (f) => {
    if (!relative4.has(f)) relative4.set(f, new Set([...text(f).matchAll(/['"`](\.\.?\/[^'"`\n]*)['"`]/g)].map((m) => withoutExt(posix.join(posix.dirname(f), m[1])))));
    return relative4.get(f);
  };
  const tests = tracked.filter(isTest);
  const code2 = tracked.filter((f) => CODE.test(f) && !isTest(f));
  const folderOf = (f) => posix.dirname(f);
  const importsIndex = (f, index) => pathsIn(f).has(withoutExt(index)) || /^index\./.test(posix.basename(index)) && pathsIn(f).has(folderOf(index));
  const nearOne = (f, loads) => {
    const base = f.split("/").at(-1);
    const stem2 = base.replace(/\.[^.]+$/, "");
    if (!stem2 || stem2 === base) return [];
    const pkg = packageOf(f, files);
    const named2 = new RegExp(`(^|/)(${escapeRegExp(stem2)}[._](test|spec)\\.\\w+|test_${escapeRegExp(stem2)}\\.\\w+)$`);
    const imports = new RegExp(`['"\`][^'"\`\\n]*\\/${escapeRegExp(stem2)}(\\.[cm]?[jt]sx?)?['"\`]`);
    return tests.filter((t) => (!pkg || t.startsWith(`${pkg}/`)) && (named2.test(t) || (loads ? loads(t) : imports.test(text(t)))));
  };
  const nearIndex = (index) => /^index\./.test(posix.basename(index)) ? nearOne(index, (t) => importsIndex(t, index)) : nearOne(index);
  const named = indexes.filter((i) => code2.includes(i));
  const indexesOf = (f) => {
    if (!CODE.test(f)) return [];
    const ownNamed = named.filter((i) => folderOf(i) === folderOf(f));
    if (ownNamed.length) return ownNamed.filter((i) => i !== f);
    const folder = code2.filter((c) => folderOf(c) === folderOf(f));
    return folder.filter((i) => {
      if (i === f || !pathsIn(i).has(withoutExt(f))) return false;
      const others = folder.filter((c) => c !== i);
      const gathered = others.filter((c) => pathsIn(i).has(withoutExt(c))).length;
      return gathered >= 2 && gathered * 2 > others.length;
    });
  };
  const out3 = new Set(changed.filter((f) => isTest(f) && files.has(f)));
  for (const f of changed.filter((x2) => !isTest(x2))) {
    for (const t of nearOne(f)) out3.add(t);
    const pkg = packageOf(f, files);
    for (const index of indexesOf(f)) {
      const loaders = code2.filter((c) => c !== index && (!pkg || c.startsWith(`${pkg}/`)) && importsIndex(c, index));
      for (const t of [...nearIndex(index), ...loaders.flatMap((g) => nearOne(g))]) out3.add(t);
    }
  }
  return [...out3].sort();
}
var nodeBin = (root, name) => join11(root, "node_modules", ".bin", name);
var missingTool = (root, name) => error(`${name} isn't installed in this repo. Run npm install in the main checkout, then try again.`);
function packageDirs(root) {
  try {
    const p = JSON.parse(readFileSync16(join11(root, "sfdx-project.json"), "utf8"));
    const dirs = (p.packageDirectories ?? []).map((d) => d.path?.replace(/\/+$/, "")).filter((d) => !!d);
    return dirs.length ? dirs : ["force-app"];
  } catch {
    return ["force-app"];
  }
}
var under = (files, dirs) => files.filter((f) => dirs.some((d) => f === d || f.startsWith(`${d}/`)));
var FORMATTED = /(\.(cls|trigger)$)|((^|\/)lwc\/.+\.(js|html|css)$)/;
var COMPONENT_JS = /(^|\/)(lwc|aura)\/.+\.js$/;
var LWC = /(^|\/)lwc\//;
var APEX = /\.(cls|trigger)(-meta\.xml)?$/;
var format = {
  name: "format",
  heavy: false,
  about: "prettier --check on changed Apex and LWC code",
  plan({ root, changes }) {
    const files = changes.files.filter((f) => FORMATTED.test(f));
    if (!files.length) return { outcome: skip("No Apex or LWC code has changed.") };
    const bin = nodeBin(root, "prettier");
    if (!existsSync9(bin)) return { outcome: missingTool(root, "prettier") };
    return {
      cmd: bin,
      args: ["--check", ...files],
      read(r) {
        if (r.code === 0) return pass(`${plural(files.length, "changed file")} formatted.`);
        const bad = (r.stdout + "\n" + r.stderr).split("\n").map((l3) => /^\[warn\] (.+)$/.exec(l3.trim())?.[1]).filter((f) => !!f && files.includes(f));
        if (r.code === 1 && bad.length) return fail(`${plural(bad.length, "file")} need formatting: ${listOf(bad)}. Fix with: npx prettier --write ${bad.join(" ")}`);
        return error(lastLine(r.stderr || r.stdout) || `prettier exited with ${r.code}.`);
      }
    };
  }
};
var lint = {
  name: "lint",
  heavy: false,
  about: "ESLint on changed LWC and Aura JavaScript",
  plan({ root, changes }) {
    const files = changes.files.filter((f) => COMPONENT_JS.test(f));
    if (!files.length) return { outcome: skip("No LWC or Aura JavaScript has changed.") };
    const bin = nodeBin(root, "eslint");
    if (!existsSync9(bin)) return { outcome: missingTool(root, "eslint") };
    return {
      cmd: bin,
      args: files,
      read: (r) => r.code === 0 ? pass(`${plural(files.length, "file")} lint clean.`) : r.code === 1 ? fail(lastLine(r.stdout) || "ESLint found problems.") : error(lastLine(r.stderr || r.stdout))
    };
  }
};
var lwcTests = {
  name: "lwc-tests",
  heavy: true,
  about: "Jest tests related to changed LWC",
  changeBound: true,
  plan({ root, changes }) {
    const files = changes.files.filter((f) => LWC.test(f));
    if (!files.length) return { outcome: skip("No LWC has changed.") };
    const bin = nodeBin(root, "sfdx-lwc-jest");
    if (!existsSync9(bin)) return { outcome: missingTool(root, "sfdx-lwc-jest") };
    return {
      cmd: bin,
      args: ["--", "--findRelatedTests", ...files, "--passWithNoTests"],
      read: (r) => r.code === 0 ? pass(lastLine(r.stderr.split("\n").filter((l3) => /^Tests:/.test(l3.trim())).join("\n")) || "Related tests passed.") : fail(lastLine(r.stderr.split("\n").filter((l3) => /^Tests:/.test(l3.trim())).join("\n")) || "Related tests failed.")
    };
  }
};
function readAnalyzer(file, severity, root) {
  try {
    const j2 = JSON.parse(readFileSync16(file, "utf8"));
    const all = j2.violations ?? [];
    const worst = all.filter((v) => (v.severity ?? 5) <= severity).map((v) => {
      const at2 = v.locations?.[v.primaryLocationIndex ?? 0];
      const where = at2?.file ? `${at2.file.startsWith(root) ? at2.file.slice(root.length + 1) : at2.file}${at2.startLine ? `:${at2.startLine}` : ""}` : "";
      return `${where} ${v.rule ?? "rule"} (sev ${v.severity}): ${(v.message ?? "").trim()}`.trim();
    });
    return { worst, total: all.length };
  } catch {
    return null;
  }
}
var staticGate = {
  name: "static",
  heavy: true,
  about: "Salesforce Code Analyzer on changed source",
  plan({ root, config, changes, scratch }) {
    const files = under(changes.files, packageDirs(root));
    if (!files.length) return { outcome: skip("No Salesforce source has changed.") };
    const severity = config.gates.severity;
    const results = join11(scratch, "code-analyzer.json");
    return {
      cmd: "sf",
      args: ["code-analyzer", "run", "--workspace", ".", ...files.flatMap((f) => ["--target", f]), "--severity-threshold", String(severity), "--view", "table", "--output-file", results],
      read(r) {
        const found = readAnalyzer(results, severity, root);
        if (!found) return error(lastLine(r.stderr || r.stdout) || `Code Analyzer exited with ${r.code} and wrote no results.`);
        if (found.worst.length) return fail(`${plural(found.worst.length, "violation")} at severity ${severity} or worse: ${listOf(found.worst, 2)}`, { violations: found.worst });
        if (r.code !== 0) return error(lastLine(r.stderr || r.stdout) || `Code Analyzer exited with ${r.code}.`);
        return pass(`No violations at severity ${severity} or worse${found.total ? ` (${plural(found.total, "milder one")})` : ""}.`);
      }
    };
  }
};
function validateArgs(org, source, tests) {
  return [
    "project",
    "deploy",
    "start",
    "--dry-run",
    "--target-org",
    org,
    "--wait",
    "60",
    "--ignore-conflicts",
    "--json",
    ...source.flatMap((f) => ["--source-dir", f]),
    "--test-level",
    tests.length ? "RunSpecifiedTests" : "NoTestRun",
    ...tests.flatMap((t) => ["--tests", t.name])
  ];
}
var asList = (x2) => x2 == null ? [] : Array.isArray(x2) ? x2 : [x2];
function readDeploy(r, org, tests, sourceCount) {
  let j2;
  try {
    j2 = parseJsonOutput(r.stdout);
  } catch {
    return error(lastLine(r.stderr || r.stdout) || `sf exited with ${r.code} and printed no JSON.`);
  }
  const res = j2.result ?? j2.data;
  if (!res?.id) return error(j2.message?.trim() || lastLine(r.stderr) || "sf returned no deploy result.");
  const details = { jobId: res.id, org, testLevel: tests.length ? "RunSpecifiedTests" : "NoTestRun", tests };
  const n = res.numberComponentsTotal ?? sourceCount;
  const counts = tests.length ? apexCounts(res) : null;
  const withCounts = (o) => counts ? { ...o, counts } : o;
  if (res.success) {
    const ran = tests.length ? `, ${plural(res.numberTestsCompleted ?? 0, "test")} passed` : "";
    return withCounts(pass(`Validated ${plural(n, "component")} against ${org}${ran}. Nothing was saved (job ${res.id}).`, details));
  }
  const problems = [
    ...asList(res.details?.componentFailures).map((f) => `${f.fileName ?? f.fullName ?? "?"}${f.lineNumber ? `:${f.lineNumber}` : ""}: ${f.problem ?? "failed"}`),
    ...asList(res.details?.runTestResult?.failures).map((f) => `${f.name}.${f.methodName}: ${f.message}`)
  ];
  return withCounts(fail(problems.length ? `${plural(problems.length, "problem")}: ${listOf(problems, 2)}` : j2.message?.trim() || `The validation ${res.status ?? "failed"}.`, { ...details, problems }));
}
var validate = {
  name: "validate",
  heavy: true,
  about: "a check-only deploy of changed source to the environment's org",
  changeBound: true,
  plan({ root, env, changes, tests }) {
    if (!env.org) return { outcome: error(`${env.name} has no org alias in .acc/config.json.`) };
    if (env.protected) return { outcome: error(`${env.name} is protected. Tasks are checked against their own environment, never a protected one.`) };
    if (changes.envSpecific.length) {
      return { outcome: fail(`This branch changes environment-specific files, which differ by design in every org and are never part of a task (D-016): ${listOf(changes.envSpecific)}. Undo those changes.`) };
    }
    if (changes.deleted.length) {
      return { outcome: fail(`Deletions (and renames) go to a person for now: ${listOf(changes.deleted)}. Restore them, or block the task and say what should be deleted.`) };
    }
    const source = under(changes.files, packageDirs(root));
    if (!source.length) return { outcome: skip("No Salesforce source has changed.") };
    const apex = source.filter((f) => APEX.test(f));
    if (apex.length && !tests.length) {
      return { outcome: fail(`Apex changed (${listOf(apex)}). Name the test classes that cover it: acc gate run validate --test <TestClass>="<why it covers the change>"`) };
    }
    return { cmd: "sf", args: validateArgs(env.org, source, tests), read: (r) => readDeploy(r, env.org, tests, source.length), tests: tests.length > 0 };
  }
};
var SALESFORCE_GATES = [format, lint, staticGate, lwcTests, validate];
function gatesFor(config) {
  const heavy = (name) => config.gates.heavy.includes(name);
  const full = fullGates(config);
  const lighter = (name) => !!config.gates.builder?.includes(name) && !full.includes(name);
  const builtIn = [strayFilesGate, ...config.profile === "salesforce" ? SALESFORCE_GATES : []].map((g) => ({ ...g, heavy: heavy(g.name) }));
  const custom = Object.entries(config.gates.commands).map(([name, cmd]) => commandGate(name, cmd, heavy(name), lighter(name)));
  const ratchets = Object.entries(config.gates.ratchets ?? {}).map(([name, spec]) => ratchetGate(name, spec, heavy(name)));
  return [...builtIn.filter((g) => !config.gates.commands[g.name]), ...custom, ...ratchets];
}
function priorTests(paths, config, sha) {
  if (config.profile !== "salesforce") return [];
  const tests = readReceipt(paths, sha, "validate")?.details?.tests;
  return Array.isArray(tests) ? tests.filter((t) => typeof t?.name === "string" && typeof t?.reason === "string") : [];
}
var listLines = (text) => text.split("\n").map((l3) => l3.trim()).filter((l3) => l3 && !l3.startsWith("#"));
function readList(root, rel) {
  if (!rel) return [];
  try {
    return listLines(readFileSync16(join11(root, rel), "utf8"));
  } catch {
    return [];
  }
}
var listed = (path, list) => list.some((p) => path === p || path.startsWith(`${p.replace(/\/+$/, "")}/`));
var git2 = (run2, root, args) => run2("git", args, { cwd: root });
function baseFor(run2, root, env, head = "HEAD") {
  for (const ref of [`origin/${env.branch}`, env.branch]) {
    if (git2(run2, root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).code !== 0) continue;
    const mb = git2(run2, root, ["merge-base", head, ref]);
    if (mb.code === 0 && mb.stdout.trim()) return mb.stdout.trim();
  }
  throw new AccError("no-base", `There's no ${env.branch} or origin/${env.branch} branch here to compare with.`);
}
function changedPaths(run2, cwd, base, head) {
  const r = git2(run2, cwd, ["diff", "--name-status", "--no-renames", "-z", base, ...head ? [head] : []]);
  if (r.code !== 0) throw new AccError("git", `git diff failed: ${lastLine(r.stderr)}`);
  const parts = r.stdout.split("\0").filter(Boolean);
  const out3 = [];
  for (let i = 0; i + 1 < parts.length; i += 2) out3.push({ status: parts[i], path: parts[i + 1] });
  return out3;
}
function changesFor(run2, root, config, env) {
  const base = baseFor(run2, root, env);
  const specific = readList(root, config.environmentSpecific);
  const files = [];
  const added = [];
  const deleted = [];
  const envSpecific = [];
  for (const { status, path } of changedPaths(run2, root, base, "HEAD")) {
    if (listed(path, specific)) envSpecific.push(path);
    else if (status.startsWith("D")) deleted.push(path);
    else {
      files.push(path);
      if (status.startsWith("A")) added.push(path);
    }
  }
  return { base, files, added, deleted, envSpecific };
}
function gateTarget(config, ledger, branch, opts) {
  const byName = (name) => config.environments.find((e) => e.branch === name.toLowerCase() || e.name.toLowerCase() === name.toLowerCase());
  const taskById = opts.task ? ledger.tasks.find((t) => t.id === opts.task.toUpperCase()) : void 0;
  if (opts.task && !taskById) throw new AccError("no-task", `No task ${opts.task}.`);
  const task = taskById ?? (branch ? ledger.tasks.find((t) => t.run?.branch === branch) : void 0) ?? null;
  if (opts.env) {
    const env2 = byName(opts.env);
    if (!env2) throw new AccError("usage", `No environment "${opts.env}". The config has: ${config.environments.map((e) => e.branch).join(", ")}.`);
    return { env: env2, task };
  }
  const env = task && byName(task.environment) || branch && byName(branch) || (config.environments.length === 1 ? config.environments[0] : void 0);
  if (!env) throw new AccError("usage", `This branch${branch ? ` (${branch})` : ""} isn't a task's or an environment's. Name the environment to check against: --env <${config.environments.map((e) => e.branch).join("|")}>`);
  return { env, task };
}
function assertCheckOnly(cmd, args) {
  const i = args.indexOf("deploy");
  if (/(^|\/)sf$/.test(cmd) && i >= 0 && args[i + 1] !== "validate" && !args.includes("--dry-run")) {
    throw new AccError("refused", `A gate tried to run a real deploy (${[cmd, ...args.slice(0, 4)].join(" ")} \u2026). Gates only validate.`);
  }
}
function settle(outcome, check2) {
  const c = outcome.counts;
  if (!c) return check2.tests && outcome.status !== "skip" ? { ...outcome, countsNote: NO_COUNTS } : outcome;
  if (outcome.status !== "pass") return outcome;
  if (c.run === 0) {
    return { ...outcome, status: "hold", summary: `Ran no tests${c.skipped || c.todo ? ` (${countsLine(c)})` : ""}, so it can't vouch for the change.` };
  }
  if (!check2.compared) return outcome;
  const before = check2.earlier?.counts;
  if (!check2.earlier || !before) return { ...outcome, countsNote: `Nothing earlier on ${check2.env} to compare its skipped tests with.` };
  const at2 = check2.earlier.sha.slice(0, 7);
  const fresh = newlySkipped(c, before);
  const note = `Compared with ${before.skipped} skipped on ${at2}, the nearest earlier count on ${check2.env}.${fresh.length ? ` Newly skipped: ${fresh.join(", ")}.` : ""}`;
  if (c.skipped <= before.skipped) return { ...outcome, countsNote: note };
  return { ...outcome, status: "hold", summary: `${c.skipped} skipped, up from ${before.skipped} on ${at2}${fresh.length ? `: ${listOf(fresh)} newly skipped` : ""}.`, countsNote: note };
}
var niced = (cmd, args) => process.platform === "win32" ? [cmd, args] : ["nice", ["-n", "15", cmd, ...args]];
function runGates(paths, config, env, names3, tests, deps) {
  const root = paths.root;
  const all = gatesFor(config);
  const required = requiredGates(config, env.branch, "builder");
  const wanted = names3.length ? names3 : required.some((g) => g !== STRAY_FILES) ? required : all.map((g) => g.name);
  const unknownNames = wanted.filter((n) => !all.some((g) => g.name === n));
  if (unknownNames.length) {
    const known = all.map((g) => g.name).join(", ") || "none yet";
    throw new AccError("usage", `No gate ${unknownNames.join(", ")}. This project's gates: ${known}.${config.profile === "generic" ? ' Add commands under "gates.commands" in .acc/config.json.' : ""}`);
  }
  const head = git2(deps.run, root, ["rev-parse", "HEAD"]);
  if (head.code !== 0) throw new AccError("git", "This checkout has no commit to check yet.");
  const sha = head.stdout.trim();
  const dirty = git2(deps.run, root, ["status", "--porcelain"]).stdout.trim() !== "";
  let changes = null;
  let unknownBase = null;
  try {
    changes = changesFor(deps.run, root, config, env);
  } catch (e) {
    if (config.profile === "salesforce") throw e;
    unknownBase = e.message;
  }
  let near = null;
  const input = {
    root,
    config,
    env,
    tests,
    changes: changes ?? { base: sha, files: [], added: [], deleted: [], envSpecific: [] },
    unknownBase,
    git: (args, gitInput) => deps.run("git", args, { cwd: root, ...gitInput === void 0 ? {} : { input: gitInput } }),
    scratch: join11(paths.logs, "gates", sha),
    near: () => near ??= nearTests(input.changes.files, git2(deps.run, root, ["ls-files", "-z"]).stdout.split("\0").filter(Boolean), (f) => {
      try {
        return readFileSync16(join11(root, f), "utf8");
      } catch {
        return null;
      }
    }, config.gates.nearIndexes)
  };
  let floors = null;
  input.floors = () => floors ??= (() => {
    try {
      const on = git2(deps.run, root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).stdout.trim() || null;
      const relaxed = relaxesFor(readRelaxed(paths.relaxed), readLedger(paths.ledger), deps.task, on);
      return { head: floorsAt(deps.run, root, sha), base: floorsAt(deps.run, root, input.changes.base), relaxed, raise: !!deps.raise && !dirty };
    } catch (e) {
      return { problem: e.message };
    }
  })();
  mkdirSync13(input.scratch, { recursive: true });
  const carryFrom = carriedFrom(paths, config, deps.run, sha);
  const results = [];
  for (const name of wanted) {
    const gate = all.find((g) => g.name === name);
    const kept = readReceipt(paths, sha, gate.name);
    if (kept?.waived) {
      results.push({ status: "skip", summary: kept.summary, ...kept.counts ? { counts: kept.counts } : {}, gate: gate.name, recorded: true, receipt: kept });
      continue;
    }
    const carried = carryFrom ? carryReceipt(paths, config, input, gate.name, carryFrom, sha) : null;
    if (carried) {
      if (!dirty) writeReceipt(paths, carried);
      results.push({
        status: carried.status,
        summary: carried.summary,
        ...carried.details ? { details: carried.details } : {},
        ...carried.counts ? { counts: carried.counts } : {},
        ...carried.countsNote ? { countsNote: carried.countsNote } : {},
        gate: gate.name,
        recorded: !dirty,
        receipt: carried
      });
      continue;
    }
    deps.onStart?.(gate);
    const started = deps.now();
    const plan = gate.plan(input);
    let outcome;
    let command = null;
    let log = null;
    if ("outcome" in plan) {
      outcome = plan.outcome;
    } else {
      assertCheckOnly(plan.cmd, plan.args);
      command = shellLine(plan.cmd, plan.args);
      const [cmd, args] = niced(plan.cmd, plan.args);
      const exec = () => deps.run(cmd, args, { cwd: root, timeoutMs: (gate.heavy ? 90 : 20) * 6e4, env: plan.cmd === "sf" ? sfEnv() : { ...checkEnv(process.env, gate.heavy ? join11(input.scratch, "heavy") : void 0), ...plan.env } });
      const owner = { what: gate.name, ...deps.task ? { task: deps.task } : {}, project: config.project, cwd: root };
      const r = gate.heavy ? withSlot(exec, { owner, ...deps.slots, onWait: () => deps.onWait?.(gate) }) : exec();
      log = join11(input.scratch, `${gate.name}.log`);
      writeFileSync15(log, `$ ${command}
# exit ${r.code}

${r.stdout}${r.stderr ? `
--- stderr ---
${r.stderr}` : ""}`);
      outcome = (plan.read ?? exitRead)(r);
      const counts = outcome.counts ?? readTestCounts(r.stdout, r.stderr);
      if (counts) outcome = { ...outcome, counts };
      const compared = !gate.changeBound && !!changes;
      const earlier = compared && counts && outcome.status === "pass" ? earlierCounts(paths, deps.run, changes.base, gate.name, command, sha) : null;
      outcome = settle(outcome, { tests: plan.tests ?? isTestGate(config, gate.name), compared, earlier, env: env.branch });
    }
    const finished = deps.now();
    const waiver = outcome.status === "hold" && deps.waivedOn && deps.waivedOn !== sha ? readReceipt(paths, deps.waivedOn, gate.name)?.waived : void 0;
    const held = outcome.summary;
    if (waiver) outcome = { ...outcome, status: "skip", summary: `Waived by ${waiver.by.replace(/^human:/, "")} on ${deps.waivedOn.slice(0, 7)}, the branch's head: ${waiver.reason}` };
    const receipt = {
      gate: gate.name,
      sha,
      env: env.branch,
      status: outcome.status,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
      summary: outcome.summary,
      command,
      log,
      ...outcome.details ? { details: outcome.details } : {},
      ...outcome.counts ? { counts: outcome.counts } : {},
      ...outcome.countsNote ? { countsNote: outcome.countsNote } : {},
      ...waiver ? { waived: { ...waiver, was: "hold", wasSummary: held } } : {}
    };
    if (!dirty) writeReceipt(paths, receipt);
    results.push({ ...outcome, gate: gate.name, recorded: !dirty, receipt });
  }
  const raised = results.flatMap((r) => {
    const d = ratchetOf(r.receipt);
    return d?.raised ? [{ gate: r.gate, label: d.label, limit: d.limit, from: d.raised.from, to: d.raised.to }] : [];
  });
  if (raised.length) writeFloors(paths.floors, withRaises(readFloors(paths.floors), raised));
  return { sha, env, dirty, changes, results, raised: raised.map(({ limit: _limit, ...r }) => r) };
}
function carriedFrom(paths, config, run2, sha) {
  if (!Object.keys(config.gates.ratchets ?? {}).length) return null;
  const parents = git2(run2, paths.root, ["rev-list", "--parents", "-n", "1", sha]).stdout.trim().split(/\s+/).slice(1);
  if (parents.length !== 1) return null;
  const parent = parents[0];
  const diff = git2(run2, paths.root, ["diff", "--name-only", "--no-renames", parent, sha]);
  if (diff.code !== 0 || diff.stdout.trim() !== FLOORS_FILE) return null;
  try {
    return carriesOver(floorsAt(run2, paths.root, parent), floorsAt(run2, paths.root, sha), receiptsAt(paths, parent)) ? parent : null;
  } catch {
    return null;
  }
}
function carryReceipt(paths, config, input, gate, from, sha) {
  const before = readReceipt(paths, from, gate);
  if (!before || before.waived || before.status !== "pass" && before.status !== "skip") return null;
  const { details: _details, ...rest } = before;
  const spec = config.gates.ratchets?.[gate];
  if (!spec) return { ...before, sha, carried: { from } };
  const measured = ratchetOf(before);
  const floors = input.floors?.();
  if (!measured || !floors || "problem" in floors) return null;
  const outcome = judgeRatchet(gate, spec, measured.value, { ...floors, raise: false }, input.env.branch);
  if (outcome.status !== "pass") return null;
  return { ...rest, sha, status: outcome.status, summary: outcome.summary, ...outcome.details ? { details: outcome.details } : {}, carried: { from } };
}
function waiveGates(paths, config, req) {
  const all = gatesFor(config);
  const reason = req.reason.trim();
  if (!reason) throw new AccError("usage", `Say why it's waived: acc gate waive <gate> --reason "<why>". The reason is kept with the commit's checks.`);
  if (!req.gates.length) throw new AccError("usage", `Name the gates to waive. This project's gates: ${all.map((g) => g.name).join(", ") || "none"}.`);
  const unknown2 = req.gates.filter((n) => !all.some((g) => g.name === n));
  if (unknown2.length) throw new AccError("usage", `No gate ${unknown2.join(", ")}. This project's gates: ${all.map((g) => g.name).join(", ")}.`);
  const ratchet = req.gates.find((n) => config.gates.ratchets?.[n]);
  if (ratchet) throw new AccError("refused", `${ratchet} is a ratchet: waived, its number could merge below its floor and fail every task after it. A person relaxes the floor instead: acc gate relax ${ratchet} --to <n> --reason "<why>".`);
  const at2 = req.now().toISOString();
  const out3 = [];
  for (const gate of [...new Set(req.gates)]) {
    const before = readReceipt(paths, req.sha, gate);
    if (before?.status === "pass") throw new AccError("refused", `${gate} already passes on ${req.sha.slice(0, 7)}, so there's nothing to waive.`);
    const was = before?.waived ? before.waived.was : before?.status ?? null;
    const wasSummary = before?.waived ? before.waived.wasSummary : before?.summary ?? null;
    const receipt = {
      gate,
      sha: req.sha,
      env: req.env.branch,
      status: "skip",
      startedAt: at2,
      finishedAt: at2,
      durationMs: 0,
      summary: `Waived by ${req.by.replace(/^human:/, "")}: ${reason}`,
      command: before?.counts ? before.command : null,
      log: before?.log ?? null,
      ...before?.details ? { details: before.details } : {},
      ...before?.counts ? { counts: before.counts } : {},
      ...before?.countsNote ? { countsNote: before.countsNote } : {},
      waived: { by: req.by, reason, at: at2, was, wasSummary }
    };
    writeReceipt(paths, receipt);
    out3.push(receipt);
  }
  return out3;
}

// packages/core/src/carried.ts
function arrivedAt(t, branch) {
  if (t.environment === branch && t.pr?.state === "merged") return t.pr.mergeSha ?? t.pr.sha;
  const merged = (t.promotions ?? []).filter((p) => p.to === branch && p.state === "merged" && p.mergeSha);
  return merged.sort((a2, b) => (a2.mergedAt ?? a2.at).localeCompare(b.mergedAt ?? b.at))[0]?.mergeSha;
}
var git3 = (run2, root, ...args) => run2("git", args, { cwd: root });
function carriedTasks(paths, run2, plan) {
  const on = (sha, tip) => git3(run2, paths.root, "merge-base", "--is-ancestor", sha, tip).code === 0;
  const reached = readLedger(paths.ledger).tasks.filter((t) => {
    const at2 = arrivedAt(t, plan.from.branch);
    return !!at2 && !arrivedAt(t, plan.to.branch) && on(at2, plan.fromSha);
  });
  if (!reached.length) return [];
  const others = [...new Set(reached.map((t) => t.environment).filter((b) => b !== plan.from.branch))];
  if (others.length) git3(run2, paths.root, "fetch", "--quiet", "origin", ...others);
  const moving = /* @__PURE__ */ new Set([...plan.files, ...plan.deleted]);
  return reached.filter((t) => {
    const own = t.pr?.state === "merged" ? t.pr.mergeSha ?? t.pr.sha : void 0;
    if (!own) return true;
    const r = git3(run2, paths.root, "diff-tree", "-r", "-z", "--no-commit-id", "--name-only", "-m", "--first-parent", own);
    if (r.code !== 0) return true;
    return r.stdout.split("\0").some((f) => moving.has(f));
  });
}

// packages/core/src/trackers/github.ts
var issueRepo = (url) => url ? /github\.com\/([\w.-]+\/[\w.-]+)\/issues\/\d+/i.exec(url)?.[1] ?? null : null;
function hasPlaceLabel(issue, labels) {
  if (!labels.length) return true;
  const want = new Set(labels.map((l3) => l3.toLowerCase()));
  return (issue.labels ?? []).some((l3) => want.has(l3.name.toLowerCase()));
}
function githubOutside(issue, repo, labels, projectOnly = false) {
  const now2 = issueRepo(issue.url);
  if (now2 && now2.toLowerCase() !== repo.toLowerCase()) return `it moved to ${now2}`;
  if (projectOnly || hasPlaceLabel(issue, labels)) return null;
  return labels.length === 1 ? `it has no label ${labels[0]}` : `it has none of the labels ${orList(labels)}`;
}
function pickProject(nodes, board) {
  const all = nodes.filter((p) => p.field?.options?.length);
  return (board != null ? all.find((x2) => x2.number === board) : all.find((x2) => !x2.closed)) ?? null;
}

// packages/core/src/updates.ts
import { mkdirSync as mkdirSync14, readdirSync as readdirSync5, readFileSync as readFileSync17, rmSync as rmSync8 } from "node:fs";
import { join as join12 } from "node:path";
var SLACK_UPDATE_EVENTS = ["merged", "deployed", "blocked", "question"];
var STALE_POSTING_MS = 5 * 6e4;
var UPDATE_TEXT_MAX = 65536;
var UPDATE_ID = /^[A-Z][A-Z0-9_]*-\d+\.\d{1,6}$/;
var REPLACES_MAX = 20;
var updateFile = (paths, id) => join12(paths.updates, `${id}.json`);
var EVENT_WORDS = {
  "pr-opened": "ready for review",
  "pr-updated": "updated for review",
  merged: "merged",
  "promotion-opened": "promotion opened",
  promoted: "promoted",
  deployed: "deployed",
  blocked: "a question for the client",
  question: "a question from its analysis"
};
function ticketOf(task) {
  const { kind, key, url } = task.source;
  if (!isTrackerKind(kind) || !key) return null;
  return { tracker: kind, key, url };
}
function githubIssue(u, repo) {
  const m = u.url ? /github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/.exec(u.url) : null;
  if (m) return { repo: m[1], number: m[2] };
  const n = /(\d+)$/.exec(u.key)?.[1];
  return n && repo ? { repo, number: n } : null;
}
function updateText(event, c) {
  const summary = c.summary?.trim() ? `
${sentence(c.summary)}` : "";
  switch (event) {
    case "pr-opened":
      return `The change is ready for review: ${c.pr?.url ?? ""}${summary}`;
    case "pr-updated":
      return `The change was updated and is ready for review again: ${c.pr?.url ?? ""}${summary}`;
    case "merged":
      return `The change was approved and merged into ${c.env ?? "its environment"}.`;
    case "promotion-opened":
      return `The change is ready to go to ${c.env ?? "its next environment"}: ${c.pr?.url ?? ""}`;
    case "promoted":
      return `The change is now in ${c.env ?? "its next environment"}.`;
    case "deployed":
      return `The change is now deployed to ${c.env ?? "its environment"}.`;
    case "blocked":
      return `We need your input before we can go on:
${sentence(c.question ?? "")}`;
    case "question":
      return `Before we start, a question for you:
${sentence(c.question ?? "")}`;
  }
}
function readUpdate(paths, id) {
  if (!UPDATE_ID.test(id)) return null;
  try {
    const u = JSON.parse(readFileSync17(updateFile(paths, id), "utf8"));
    return u.v === 1 && u.id === id ? u : null;
  } catch {
    return null;
  }
}
function listUpdates(paths) {
  let names3;
  try {
    names3 = readdirSync5(paths.updates);
  } catch {
    return [];
  }
  const out3 = names3.filter((n) => n.endsWith(".json")).map((n) => readUpdate(paths, n.slice(0, -5))).filter((u) => !!u);
  return out3.sort((a2, b) => a2.createdAt.localeCompare(b.createdAt) || a2.id.localeCompare(b.id, void 0, { numeric: true }));
}
var isOpenUpdate = (u) => u.state === "draft" || u.state === "posting";
var stalePosting = (u, now2) => u.state === "posting" && !!u.posting && now2.getTime() - Date.parse(u.posting.at) > STALE_POSTING_MS;
function writeUpdate(paths, u) {
  const file = updateFile(paths, u.id);
  writeAtomic(file, JSON.stringify(u, null, 2) + "\n");
}
function locked(paths, fn2) {
  mkdirSync14(paths.updates, { recursive: true });
  return withLock(`${paths.updates}.lock`, fn2);
}
var sameNews = (a2, b) => {
  const family = (e) => e === "pr-opened" || e === "pr-updated" ? "pr" : e;
  return a2.task === b.task && family(a2.event) === family(b.event) && (a2.env ?? "") === (b.env ?? "") && (a2.question ?? "") === (b.question ?? "");
};
var STAGE = { "pr-opened": 0, "pr-updated": 0, merged: 1, "promotion-opened": 1, promoted: 2, deployed: 3 };
var overtakes = (next, old) => {
  const n = STAGE[next.event];
  const o = STAGE[old.event];
  if (next.task !== old.task || n === void 0 || o === void 0 || n <= o) return false;
  return o === 0 || (old.env ?? "") === (next.env ?? "");
};
function draftUpdate(paths, task, input, by, now2) {
  const ticket = ticketOf(task);
  if (!ticket) return null;
  if (ticket.tracker === "slack" && !SLACK_UPDATE_EVENTS.includes(input.event)) return null;
  return locked(paths, () => {
    const all = listUpdates(paths);
    const mine = all.filter((u2) => u2.task === task.id);
    const replaced = mine.find((u2) => u2.state === "draft" && sameNews(u2, { task: task.id, ...input }));
    const overtaken = mine.filter((u2) => u2.state === "draft" && u2 !== replaced && overtakes({ task: task.id, ...input }, u2));
    const gone = [...replaced ? [replaced] : [], ...overtaken];
    const event = input.event === "pr-updated" && replaced?.event === "pr-opened" ? "pr-opened" : input.event;
    const text = event === input.event && input.text !== void 0 ? input.text : updateText(event, { ...input.context, ...input.pr ? { pr: input.pr } : {}, ...input.env ? { env: input.env } : {} });
    const n = Math.max(0, ...mine.map((u2) => Number(u2.id.slice(task.id.length + 1)) || 0)) + 1;
    const u = {
      v: 1,
      id: `${task.id}.${n}`,
      task: task.id,
      tracker: ticket.tracker,
      key: ticket.key,
      url: ticket.url,
      event,
      text,
      state: "draft",
      ...input.env ? { env: input.env } : {},
      ...input.pr ? { pr: { number: input.pr.number, url: input.pr.url } } : {},
      ...input.question ? { question: input.question } : {},
      createdAt: now2().toISOString(),
      by,
      ...gone.length ? { replaces: gone.flatMap((r) => [r.id, ...r.replaces ?? []]).slice(0, REPLACES_MAX) } : {}
    };
    writeUpdate(paths, u);
    for (const r of gone) rmSync8(updateFile(paths, r.id), { force: true });
    return u;
  });
}
function change(paths, id, check2, apply) {
  return locked(paths, () => {
    const u = readUpdate(paths, id);
    if (!u) throw new AccError("no-update", `No update ${id}. acc updates lists them.`);
    const why = check2(u);
    if (why) throw new AccError("refused", why);
    const next = apply(u);
    writeUpdate(paths, next);
    return next;
  });
}
var stateWords = (u) => u.state === "posted" ? `was posted${u.posted ? ` by ${u.posted.by.replace(/^human:/, "")}` : ""}` : u.state === "discarded" ? "was discarded" : "is being posted";
function claimUpdate(paths, id, by, now2, opts = {}) {
  return change(paths, id, (u) => {
    if (u.state === "draft") return null;
    if (u.state === "posting" && opts.again && stalePosting(u, now2())) return null;
    if (u.state === "posting" && stalePosting(u, now2())) return `${id} may have posted already: it was being posted at ${u.posting.at} and never confirmed. Look at ${u.key} first. If it isn't there, post it again with --again.`;
    return `${id} ${stateWords(u)}.`;
  }, (u) => ({ ...u, state: "posting", posting: { at: now2().toISOString(), by } }));
}
function markPosted(paths, id, posted, now2) {
  return change(paths, id, (u) => u.state === "posting" ? null : `${id} ${u.state === "draft" ? "wasn't claimed for posting" : stateWords(u)}.`, (u) => {
    const { failed: _failed, ...rest } = u;
    return { ...rest, state: "posted", posted: { at: now2().toISOString(), by: posted.by, text: posted.text, ...posted.url ? { url: posted.url } : {} } };
  });
}
function releaseUpdate(paths, id, reason, now2) {
  return change(paths, id, (u) => u.state === "posting" ? null : `${id} ${u.state === "draft" ? "is a draft already" : stateWords(u)}.`, (u) => {
    const { posting: _posting, ...rest } = u;
    return { ...rest, state: "draft", failed: { at: now2().toISOString(), reason: reason.trim() || "it didn't say why" } };
  });
}
function discardUpdate(paths, id, by, now2) {
  return change(paths, id, (u) => u.state === "draft" || stalePosting(u, now2()) ? null : `${id} ${stateWords(u)}.`, (u) => {
    const { posting: _posting, ...rest } = u;
    return { ...rest, state: "discarded", discarded: { at: now2().toISOString(), by } };
  });
}

// packages/core/src/closing.ts
var GH_CALL_MS = 6e4;
var ALREADY_CLOSED = "it was already closed";
var STOOD_IN = /* @__PURE__ */ new Set(["pr-opened", "pr-updated", "merged"]);
function editsTracker(config) {
  const tracker = config.trackers.find((t) => t.kind === "github");
  return tracker?.edits && config.github ? tracker : null;
}
var closesIssues = (config) => !!editsTracker(config);
function issueToClose(config, task) {
  const tracker = editsTracker(config);
  const n = /^GH-(\d+)$/.exec(task.id)?.[1];
  if (task.source.kind !== "github" || !tracker || !n) return null;
  return { repo: tracker.repo ?? config.github.repo, number: Number(n) };
}
function closeText(config, task, repo) {
  const env = environmentByBranch(config, task.environment)?.name ?? task.environment;
  const prRepo = config.github?.repo;
  const ref = prRepo && prRepo.toLowerCase() !== repo.toLowerCase() ? `${prRepo}#${task.pr.number}` : `#${task.pr.number}`;
  return `Done: pull request ${ref} merged into ${env}.`;
}
var firstLine2 = (r) => (r.stderr || r.stdout).trim().split("\n")[0] || `gh exited with ${r.code}.`;
function look(run2, env, repo, n, leaveReopened) {
  const r = run2("gh", ["issue", "view", String(n), "-R", repo, "--json", "state,stateReason,url"], { env, timeoutMs: GH_CALL_MS });
  if (r.code !== 0) {
    const why = firstLine2(r);
    return /could not resolve to an issue/i.test(why) ? { close: false, outcome: "left", reason: "GitHub can't find it" } : { close: false, outcome: "failed", reason: why };
  }
  let issue;
  try {
    issue = JSON.parse(r.stdout);
  } catch {
    return { close: false, outcome: "failed", reason: "gh's answer wasn't JSON" };
  }
  const lives = issueRepo(issue.url);
  if (lives && lives.toLowerCase() !== repo.toLowerCase()) return { close: false, outcome: "left", reason: `it moved to ${lives}` };
  const state = String(issue.state ?? "").toUpperCase();
  if (state === "CLOSED") return { close: false, outcome: "left", reason: ALREADY_CLOSED };
  if (state !== "OPEN") return { close: false, outcome: "failed", reason: "gh didn't say whether it's open" };
  if (leaveReopened && String(issue.stateReason ?? "").toUpperCase() === "REOPENED") return { close: false, outcome: "left", reason: "it was reopened" };
  return { close: true };
}
function close(run2, env, repo, n, text) {
  const r = run2("gh", ["issue", "close", String(n), "-R", repo, "--reason", "completed", "--comment", text], { env, timeoutMs: GH_CALL_MS });
  if (r.code === 0) return { outcome: "closed" };
  return { outcome: "failed", reason: r.timedOut ? `gh stopped at its timeout, and may have closed it: ${firstLine2(r)}` : firstLine2(r) };
}
function settleCloses(paths, config, deps, opts = {}) {
  const { run: run2, now: now2, env } = deps;
  const tidy = !!opts.tidy;
  const tasks = readLedger(paths.ledger).tasks.filter((t) => t.state === "done" && (tidy ? t.pr?.state === "merged" && !t.pr.issue : t.pr?.issue?.state === "pending"));
  const results = [];
  for (const t of tasks) {
    const pr = t.pr;
    const key = t.id.replace(/^GH-/, "#");
    const target = issueToClose(config, t);
    if (!target) {
      if (!tidy) results.push({ task: t.id, key, pr: pr.number, outcome: "left", reason: `its tracker doesn't say "edits": true now` });
      continue;
    }
    const seen = look(run2, env, target.repo, target.number, tidy || !!pr.issue?.reason);
    if (!seen.close) results.push({ task: t.id, key, pr: pr.number, outcome: seen.outcome, reason: seen.reason });
    else if (opts.plan) results.push({ task: t.id, key, pr: pr.number, outcome: "to close" });
    else results.push({ task: t.id, key, pr: pr.number, ...close(run2, env, target.repo, target.number, closeText(config, { environment: t.environment, pr }, target.repo)) });
  }
  if (opts.plan || !results.length) return results;
  const at2 = now2().toISOString();
  mutate(paths, now2, (ledger, emit) => {
    for (const r of results) {
      const t = ledger.tasks.find((x2) => x2.id === r.task);
      if (!t?.pr || t.pr.number !== r.pr || t.pr.issue && t.pr.issue.state !== "pending") continue;
      const issue = r.outcome === "failed" ? { state: "pending", at: at2, reason: r.reason ?? "" } : { state: r.outcome === "closed" ? "closed" : "left", at: at2, ...r.reason ? { reason: r.reason } : {} };
      if (t.pr.issue?.state === issue.state && t.pr.issue.reason === issue.reason) continue;
      t.pr = { ...t.pr, issue };
      emit({ type: "task.updated", task: t.id, actor: opts.actor ?? "sync", by: opts.by ?? "acc sync", data: { pr: t.pr } });
    }
  });
  const settled = results.filter((r) => r.outcome === "closed" || r.reason === ALREADY_CLOSED);
  const drafts = settled.length ? listUpdates(paths) : [];
  for (const r of settled) {
    const gone = [];
    for (const u of drafts) {
      if (u.task !== r.task || u.state !== "draft" || !STOOD_IN.has(u.event)) continue;
      try {
        discardUpdate(paths, u.id, "acc sync", now2);
        gone.push(u.id);
      } catch {
      }
    }
    if (gone.length) r.discarded = gone;
  }
  return results;
}
function closeWords(r, plan = false) {
  const drafts = r.discarded?.length ? `; discarded its unposted update${r.discarded.length === 1 ? "" : "s"} ${r.discarded.join(", ")}` : "";
  switch (r.outcome) {
    case "closed":
      return `closed issue ${r.key}${drafts}`;
    case "to close":
      return `would close issue ${r.key}`;
    case "left":
      return `${plan ? "would leave" : "left"} issue ${r.key} as it is: ${r.reason}${drafts}`;
    case "failed":
      return plan ? `couldn't look at issue ${r.key}: ${r.reason}` : `couldn't close issue ${r.key} (${r.reason}): the next sync tries again`;
  }
}

// packages/core/src/branches.ts
import { existsSync as existsSync10, mkdirSync as mkdirSync15, readFileSync as readFileSync18 } from "node:fs";
import { join as join13 } from "node:path";
var branchesPath = (paths) => join13(paths.stateDir, "branches.json");
function readBranches(paths) {
  const file = branchesPath(paths);
  if (!existsSync10(file)) return {};
  try {
    const raw = JSON.parse(readFileSync18(file, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}
function writeBranches(paths, records) {
  mkdirSync15(paths.stateDir, { recursive: true });
  writeAtomic(branchesPath(paths), JSON.stringify(records, null, 2) + "\n");
}
var branchMoves = (paths) => Object.values(readBranches(paths)).flatMap((r) => r.moved ? [r.moved] : []);
function knownMerges(ledger) {
  const out3 = [];
  for (const t of ledger.tasks) {
    if (t.pr?.number) out3.push({ number: t.pr.number, ...t.pr.mergeSha ? { mergeSha: t.pr.mergeSha } : {}, ...t.pr.sha ? { head: t.pr.sha } : {}, ...t.run?.branch ? { branch: t.run.branch } : {} });
    const m = t.autopilot?.merged;
    if (m) out3.push({ number: m.pr.number, head: m.sha, ...t.run?.branch ? { branch: t.run.branch } : {} });
    for (const p of t.promotions ?? []) out3.push({ number: p.pr.number, ...p.mergeSha ? { mergeSha: p.mergeSha } : {}, branch: p.from });
  }
  return out3;
}
function squashOf(subject) {
  const m = /\(#(\d+)\)\s*$/.exec(subject.trim());
  return m ? Number(m[1]) : null;
}
var commitWords = (c) => `${c.sha.slice(0, 7)} ${c.subject}`;
function unexplained(run2, root, prev, head, known) {
  if (run2("git", ["merge-base", "--is-ancestor", prev, head], { cwd: root }).code !== 0) return { listed: false, commits: [] };
  const log = run2("git", ["log", "--first-parent", "--format=%H%x00%P%x00%s", `${prev}..${head}`], { cwd: root });
  if (log.code !== 0) return { listed: false, commits: [] };
  const commits = log.stdout.split("\n").filter(Boolean).map((l3) => {
    const [sha = "", parents = "", ...rest] = l3.split("\0");
    return { sha, parents: parents.split(" ").filter(Boolean), subject: rest.join("\0").trim() };
  });
  const merges = new Set(known.flatMap((k2) => k2.mergeSha ? [k2.mergeSha] : []));
  const heads = new Set(known.flatMap((k2) => k2.head ? [k2.head] : []));
  const numbers = new Set(known.filter((k2) => !k2.mergeSha).map((k2) => k2.number));
  const explained = /* @__PURE__ */ new Set();
  for (const c of commits) {
    if (merges.has(c.sha) || c.parents.slice(1).some((p) => heads.has(p))) explained.add(c.sha);
    else if (c.parents.length === 1) {
      const n = squashOf(c.subject);
      if (n !== null && numbers.has(n)) explained.add(c.sha);
    }
  }
  const left = () => commits.filter((c) => !explained.has(c.sha));
  if (left().length) {
    const branches = [...new Set(known.flatMap((k2) => k2.branch ? [k2.branch] : []))];
    for (const branch of branches) {
      const ref = ["refs/heads", "refs/remotes/origin"].map((p) => `${p}/${branch}`).find((r) => run2("git", ["rev-parse", "--verify", "--quiet", r], { cwd: root }).code === 0);
      if (!ref) continue;
      const cherry = run2("git", ["cherry", ref, head, prev], { cwd: root });
      if (cherry.code !== 0) continue;
      for (const line of cherry.stdout.split("\n")) {
        const m = /^-\s+([0-9a-f]{40,64})$/.exec(line.trim());
        if (m) explained.add(m[1]);
      }
      if (!left().length) break;
    }
  }
  return { listed: true, commits: left() };
}
function followBranches(paths, config, ledger, deps) {
  const { run: run2, now: now2, env } = deps;
  const records = readBranches(paths);
  const known = knownMerges(ledger);
  const at2 = now2().toISOString();
  const moves = [];
  let changed = false;
  for (const e of config.environments) {
    const head = remoteHead(run2, paths.root, e.branch, env);
    if (!head) continue;
    const prev = records[e.branch];
    if (!prev) {
      records[e.branch] = { head, at: at2, moved: null };
      changed = true;
      continue;
    }
    if (prev.head === head) continue;
    const fetched = fetchBranches(run2, paths.root, [e.branch], { ...env, GIT_TERMINAL_PROMPT: "0" });
    const found = fetched ? unexplained(run2, paths.root, prev.head, head, known) : { listed: false, commits: [] };
    const ours = found.listed && found.commits.length === 0;
    const fresh = { branch: e.branch, from: prev.moved?.from ?? prev.head, to: head, at: at2, commits: [...found.commits.map(commitWords), ...prev.moved?.commits ?? []], ...prev.moved?.rewritten || prev.moved && !found.listed ? { rewritten: true } : {} };
    const move = ours ? prev.moved : fresh;
    if (move && move !== prev.moved) moves.push(move);
    records[e.branch] = { head, at: at2, moved: move };
    changed = true;
  }
  if (changed) writeBranches(paths, records);
  return moves;
}
function clearBranchMoves(paths, branch) {
  const records = readBranches(paths);
  const cleared = [];
  for (const [b, r] of Object.entries(records)) {
    if (!r.moved || branch && b !== branch) continue;
    r.moved = null;
    cleared.push(b);
  }
  if (cleared.length) writeBranches(paths, records);
  return cleared;
}
function moveWords(m) {
  const n = m.commits.length;
  const list = m.commits.slice(0, 3).join(", ");
  const rewrite = m.rewritten ? ", then moved again in a way git couldn't list: a force push or a rewrite" : "";
  return n ? `${m.branch} moved from ${m.from.slice(0, 7)} to ${m.to.slice(0, 7)} by ${n} commit${n === 1 ? "" : "s"} that ${n === 1 ? "isn't" : "aren't"} acc's merges: ${list}${n > 3 ? ` and ${n - 3} more` : ""}${rewrite}. Look before anything builds on it.` : `${m.branch} moved from ${m.from.slice(0, 7)} to ${m.to.slice(0, 7)}, and git couldn't list how: a force push or a rewrite. Look before anything builds on it.`;
}
var moveUrl = (repo, m) => `https://github.com/${repo}/compare/${m.from}...${m.to}`;

// packages/core/src/sync.ts
var mergeShaOf = (p) => p.mergeCommit?.oid && /^[0-9a-f]{40,64}$/.test(p.mergeCommit.oid) ? p.mergeCommit.oid : void 0;
var FAILED = /* @__PURE__ */ new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
function ciOf(rollup) {
  const items = rollup ?? [];
  if (!items.length) return null;
  if (items.some((c) => FAILED.has(String(c.conclusion ?? "").toUpperCase()) || FAILED.has(String(c.state ?? "").toUpperCase()))) return "failing";
  if (items.some((c) => c.status && c.status.toUpperCase() !== "COMPLETED" || ["PENDING", "EXPECTED"].includes(String(c.state ?? "").toUpperCase()))) return "pending";
  return "passing";
}
function failingOf(rollup) {
  const failed = (rollup ?? []).filter((c) => FAILED.has(String(c.conclusion ?? "").toUpperCase()) || FAILED.has(String(c.state ?? "").toUpperCase()));
  return [...new Set(failed.map((c) => c.name || c.context || c.workflowName || "").filter(Boolean))];
}
var FETCH_TIMEOUT_MS2 = 2 * 6e4;
function fetchBranches(run2, root, branches, env) {
  const refs = [...new Set(branches)].map((b) => `+refs/heads/${b}:refs/remotes/origin/${b}`);
  return run2("git", ["fetch", "--quiet", "--no-tags", "origin", ...refs], { cwd: root, env, timeoutMs: FETCH_TIMEOUT_MS2 }).code === 0;
}
function conflictsOf(run2, root, base, head) {
  const r = run2("git", ["merge-tree", "--write-tree", "--name-only", "-z", "--no-messages", `origin/${base}`, `origin/${head}`], { cwd: root });
  const [tree, ...files] = r.stdout.split("\0");
  if (r.code !== 0 && r.code !== 1 || !/^[0-9a-f]{40,64}$/.test(tree ?? "")) return null;
  return r.code === 0 ? [] : [...new Set(files.filter(Boolean))];
}
function followGithub(paths, config, deps) {
  if (!config.github || !config.agents.cloud) return { cloud: [], branches: [] };
  const ledger = readLedger(paths.ledger);
  const cloud = ledger.tasks.some((t) => t.state === "running" && t.run?.where === "cloud") ? followCloud(paths, config, deps) : [];
  followBranches(paths, config, ledger, deps);
  return { cloud, branches: branchMoves(paths) };
}
function sync(paths, config, deps) {
  const { run: run2, now: now2 } = deps;
  const tasks = readLedger(paths.ledger).tasks;
  const open = tasks.filter((t) => t.pr?.state === "open");
  const promotions = [...new Set(tasks.flatMap((t) => (t.promotions ?? []).filter((p) => p.state === "open").map((p) => p.pr.number)))];
  const closing = tasks.some((t) => t.pr?.issue?.state === "pending");
  if (!open.length && !promotions.length && !closing) return { checked: 0, changes: [], ...followGithub(paths, config, deps) };
  const gh = config.github;
  if (!gh) throw new AccError("no-github", 'This project has no "github" section in .acc/config.json, so there are no pull requests to follow.');
  const token = run2("gh", ["auth", "token", "-u", gh.account]);
  if (token.code !== 0) throw new AccError("no-github", `gh isn't logged in as ${gh.account}, the account this repo works as.`);
  const env = { ...deps.env, GH_TOKEN: token.stdout.trim() };
  const view = (n, fields) => {
    const r = run2("gh", ["pr", "view", String(n), "-R", gh.repo, "--json", fields], { env, timeoutMs: 6e4 });
    if (r.code !== 0) return void 0;
    try {
      return JSON.parse(r.stdout);
    } catch {
      return void 0;
    }
  };
  const seen = /* @__PURE__ */ new Map();
  for (const t of open) {
    const p = view(t.pr.number, "number,state,url,reviewDecision,baseRefName,headRefName,mergeCommit,statusCheckRollup");
    if (p) seen.set(t.pr.number, p);
  }
  const promoted = /* @__PURE__ */ new Map();
  for (const n of promotions) {
    const p = view(n, "number,state,url,mergeCommit,mergedAt");
    if (p) promoted.set(n, p);
  }
  const branches = /* @__PURE__ */ new Map();
  for (const t of open) {
    const p = seen.get(t.pr.number);
    const base = p?.baseRefName || t.environment;
    const head = p?.headRefName || t.run?.branch;
    if (p?.state === "OPEN" && head) branches.set(p.number, { base, head });
  }
  const conflicts = /* @__PURE__ */ new Map();
  if (branches.size && fetchBranches(run2, paths.root, [...branches.values()].flatMap((b) => [b.base, b.head]), { ...deps.env, GIT_TERMINAL_PROMPT: "0" })) {
    for (const [n, b] of branches) {
      const files = conflictsOf(run2, paths.root, b.base, b.head);
      if (files) conflicts.set(n, files);
    }
  }
  const at2 = now2().toISOString();
  const arrived = [];
  const closed = [];
  const changes = mutate(paths, now2, (ledger2, emit) => {
    const out3 = [];
    for (const t of ledger2.tasks) {
      const p = t.pr && t.pr.state === "open" ? seen.get(t.pr.number) : void 0;
      if (!p || !t.pr) continue;
      const before = JSON.stringify(t.pr);
      const ci = ciOf(p.statusCheckRollup);
      const changesRequested = p.reviewDecision === "CHANGES_REQUESTED";
      let moved = null;
      let note = "";
      if (p.state === "MERGED") {
        const mergeSha = mergeShaOf(p);
        t.pr = { ...t.pr, state: "merged", ci, ...mergeSha ? { mergeSha } : {}, syncedAt: at2 };
        const req = { to: "done", actor: "sync", by: "acc sync", reason: `Pull request #${p.number} merged.` };
        if (t.state === "review" && !checkMove(ledger2, config, t, req, noGateHooks).length) {
          moved = { from: t.state, to: "done" };
          applyMove(t, req, emit, now2);
          if (issueToClose(config, t)) t.pr.issue = { state: "pending", at: at2 };
        }
        note = `#${p.number} merged`;
      } else if (p.state === "CLOSED") {
        t.pr = { ...t.pr, state: "closed", ci, syncedAt: at2 };
        const req = { to: "blocked", actor: "sync", by: "acc sync", reason: `Pull request #${p.number} was closed without merging. Reopen it, or decide what happens to ${t.id}.` };
        if (t.state !== "blocked" && t.state !== "done" && !checkMove(ledger2, config, t, req, noGateHooks).length) {
          moved = { from: t.state, to: "blocked" };
          applyMove(t, req, emit, now2);
        }
        note = `#${p.number} closed without merging`;
      } else {
        const files = conflicts.get(p.number) ?? t.pr.conflicts;
        const failing = ci === "failing" ? failingOf(p.statusCheckRollup) : [];
        t.pr = { ...t.pr, url: p.url, ci, changesRequested, ...files ? { conflicts: files } : {}, syncedAt: at2 };
        if (failing.length) t.pr.failing = failing;
        else delete t.pr.failing;
        const why = [
          changesRequested ? "a person asked for changes" : "",
          ci === "failing" ? "checks failing" : "",
          files?.length ? `conflicts with ${branches.get(p.number)?.base ?? t.environment} in ${files.join(", ")}` : ""
        ].filter(Boolean);
        note = why.length ? `#${p.number}: ${why.join("; ")}` : `#${p.number} open${ci ? `, checks ${ci}` : ""}`;
      }
      const after = JSON.stringify({ ...t.pr, syncedAt: void 0 });
      if (moved || after !== JSON.stringify({ ...JSON.parse(before), syncedAt: void 0 })) {
        emit({ type: "task.updated", task: t.id, actor: "sync", by: "acc sync", data: { pr: t.pr } });
        out3.push({ task: t.id, pr: p.number, moved, note });
      }
    }
    for (const t of ledger2.tasks) {
      for (const promotion of t.promotions ?? []) {
        const p = promotion.state === "open" ? promoted.get(promotion.pr.number) : void 0;
        if (!p || p.state !== "MERGED" && p.state !== "CLOSED") continue;
        const env2 = environmentByBranch(config, promotion.to)?.name ?? promotion.to;
        const change2 = { task: t.id, pr: promotion.pr.number, moved: null, note: "" };
        if (p.state === "MERGED") {
          const before = arrivedAt(t, promotion.to);
          const mergeSha = mergeShaOf(p);
          promotion.state = "merged";
          if (mergeSha) promotion.mergeSha = mergeSha;
          if (p.mergedAt && !Number.isNaN(Date.parse(p.mergedAt))) promotion.mergedAt = p.mergedAt;
          change2.note = `promotion #${p.number} merged into ${env2}`;
          if (!before) arrived.push({ change: change2, env: env2 });
        } else {
          promotion.state = "closed";
          change2.note = `promotion #${p.number} to ${env2} closed without merging`;
          closed.push({ change: change2, pr: p.number });
        }
        emit({ type: "task.updated", task: t.id, actor: "sync", by: "acc sync", data: { promotion } });
        out3.push(change2);
      }
    }
    return out3;
  });
  for (const c of changes) if (c.moved?.from === "running") releaseAwake(paths, c.task);
  const ledger = readLedger(paths.ledger);
  for (const c of changes) {
    if (c.moved?.to !== "done") continue;
    const t = ledger.tasks.find((x2) => x2.id === c.task);
    if (!t || t.pr?.issue) continue;
    try {
      const u = draftUpdate(paths, t, { event: "merged", env: environmentByBranch(config, t.environment)?.name ?? t.environment }, "acc sync", now2);
      if (u) c.update = { id: u.id, key: u.key };
    } catch (e) {
      c.note += `; no update drafted: ${e.message}`;
    }
  }
  for (const { change: change2, env: env2 } of arrived) {
    const t = ledger.tasks.find((x2) => x2.id === change2.task);
    if (!t) continue;
    try {
      const u = draftUpdate(paths, t, { event: "promoted", env: env2 }, "acc sync", now2);
      if (u) change2.update = { id: u.id, key: u.key };
    } catch (e) {
      change2.note += `; no update drafted: ${e.message}`;
    }
  }
  const drafts = closed.length ? listUpdates(paths) : [];
  for (const { change: change2, pr } of closed) {
    const gone = [];
    for (const u of drafts) {
      if (u.task !== change2.task || u.event !== "promotion-opened" || u.pr?.number !== pr || u.state !== "draft") continue;
      try {
        discardUpdate(paths, u.id, "acc sync", now2);
        gone.push(u.id);
      } catch {
      }
    }
    if (gone.length) change2.note += `; discarded its unposted update ${gone.join(", ")}`;
  }
  for (const r of settleCloses(paths, config, { run: run2, now: now2, env })) {
    const issue = { key: r.key, outcome: r.outcome, ...r.reason ? { reason: r.reason } : {} };
    const c = changes.find((x2) => x2.task === r.task && x2.pr === r.pr && x2.moved?.to === "done");
    if (c) {
      c.issue = issue;
      c.note += `; ${closeWords(r)}`;
    } else changes.push({ task: r.task, pr: r.pr, moved: null, note: closeWords(r), issue });
  }
  return { checked: seen.size + promoted.size, changes, ...followGithub(paths, config, deps) };
}

// packages/core/src/cloud.ts
var BUILDER_PLACE_LOOK = {
  local: { label: "This Mac", icon: "device-desktop" },
  cloud: { label: "Cloud", icon: "cloud" }
};
var ROUTINES_URL = "https://claude.ai/code/routines";
function cloudOffered(config) {
  const cloud = config.agents.cloud;
  return [
    { id: "github", label: "The repo is on GitHub", ok: !!config.github, fix: 'Cloud builders need the repo on GitHub: a cloud session clones it from there and pushes its branch back. Add the "github" section to .acc/config.json.' },
    { id: "opted-in", label: "The project has opted in", ok: !!cloud, fix: "Cloud builders are off until a person opts the project in: acc cloud enable, or Settings' Cloud builders switch." },
    { id: "routine", label: "A routine for the repo", ok: !!cloud?.routine, fix: `Make a routine for the repo at ${ROUTINES_URL}, with an API trigger, and give acc its trigger id: acc cloud enable --routine trig_\u2026.` }
  ];
}
function cloudReason(needs) {
  const first = needs.find((n) => !n.ok);
  if (!first) return null;
  if (first.id === "github") return "Cloud builders need the repo on GitHub";
  if (first.id === "opted-in") return "Cloud builders are off for this project: opt in under Settings";
  if (first.id === "routine") return "Cloud builders need a routine for the repo: Setup says how";
  if (first.id === "token") return "Cloud builders need the routine's token: Setup says how";
  return "Cloud builders need a claude.ai sign-in: claude auth login";
}
function cloudNeeds(config, run2, env) {
  const needs = cloudOffered(config);
  const repo = config.github?.repo ?? "";
  const token = repo ? readCloudToken(run2, repo, env) : null;
  needs.push({ id: "token", label: "The routine's token is in this Mac's keychain", ok: !!token, fix: "Generate the API trigger's token on the routine's page, then keep it in the keychain: acc cloud token. It's never written to .acc/config.json or git." });
  const login = claudeLogin(run2, env);
  needs.push({ id: "login", label: "Claude Code is signed in to claude.ai", ok: login.ok, fix: login.ok ? "" : `${login.why} Run: claude auth login` });
  return needs;
}
function claudeLogin(run2, env) {
  const r = run2("claude", ["auth", "status"], { env, timeoutMs: 2e4 });
  if (r.code === 127) return { ok: false, why: "The Claude Code CLI (claude) isn't on PATH." };
  try {
    const s = parseJsonOutput(r.stdout);
    if (!s.loggedIn) return { ok: false, why: "Claude Code isn't signed in." };
    if (s.authMethod !== "claude.ai") return { ok: false, why: `Claude Code is signed in with ${s.authMethod ?? "something other than a claude.ai account"}, and cloud sessions need a claude.ai account.` };
    return { ok: true, why: "", ...s.email ? { email: s.email } : {} };
  } catch {
    return { ok: false, why: "claude auth status didn't answer." };
  }
}
var CLOUD_TOKEN_SERVICE = "acc-cloud-routine";
var CLOUD_TOKEN_ENV = "ACC_CLOUD_TOKEN";
var CLOUD_TOKEN = /^[A-Za-z0-9_-]{20,}$/;
function readCloudToken(run2, repo, env) {
  const given2 = env[CLOUD_TOKEN_ENV]?.trim();
  if (given2) return given2;
  const r = run2("security", ["find-generic-password", "-s", CLOUD_TOKEN_SERVICE, "-a", repo, "-w"], { env, timeoutMs: 2e4 });
  const token = r.code === 0 ? r.stdout.trim() : "";
  return token && CLOUD_TOKEN.test(token) ? token : null;
}
function writeCloudToken(run2, repo, token, env) {
  if (!CLOUD_TOKEN.test(token)) throw new AccError("usage", "That doesn't look like a routine's API token: letters, digits, dashes and underscores, 20 or more.");
  const quote = (s) => `"${s.replace(/(["\\])/g, "\\$1")}"`;
  const r = run2("security", ["-i"], { env, input: `add-generic-password -U -s ${quote(CLOUD_TOKEN_SERVICE)} -a ${quote(repo)} -w ${quote(token)}
`, timeoutMs: 2e4 });
  if (r.code !== 0) throw new AccError("cloud", `The keychain wouldn't keep the token: ${(r.stderr || r.stdout).trim().split("\n")[0] || `security exited ${r.code}`}`);
}
function deleteCloudToken(run2, repo, env) {
  return run2("security", ["delete-generic-password", "-s", CLOUD_TOKEN_SERVICE, "-a", repo], { env, timeoutMs: 2e4 }).code === 0;
}
var ROUTINE_FIRE_URL = (routine) => `https://api.anthropic.com/v1/claude_code/routines/${routine}/fire`;
var ROUTINE_BETA = "experimental-cc-routine-2026-04-01";
var ROUTINE_VERSION = "2023-06-01";
var FIRE_TIMEOUT_MS = 6e4;
function fireRoutine(paths, run2, routine, token, text, env) {
  const dir = join14(paths.stateDir, "cloud");
  mkdirSync16(dir, { recursive: true, mode: 448 });
  const stamp = `${process.pid}-${Date.now()}`;
  const headers = join14(dir, `fire-${stamp}.headers`);
  const body = join14(dir, `fire-${stamp}.json`);
  try {
    writeFileSync16(headers, [`Authorization: Bearer ${token}`, `anthropic-beta: ${ROUTINE_BETA}`, `anthropic-version: ${ROUTINE_VERSION}`, "Content-Type: application/json", ""].join("\n"), { mode: 384 });
    chmodSync(headers, 384);
    writeFileSync16(body, JSON.stringify({ text }), { mode: 384 });
    const r = run2("curl", ["-sS", "-X", "POST", ROUTINE_FIRE_URL(routine), "-H", `@${headers}`, "--data-binary", `@${body}`, "-w", "\n%{http_code}"], { env, timeoutMs: FIRE_TIMEOUT_MS });
    if (r.code === 127) throw new AccError("cloud", "curl isn't on PATH, and acc fires the routine with it.");
    if (r.code !== 0) throw new AccError("cloud", `The routine couldn't be fired: ${(r.stderr || r.stdout).trim().split("\n")[0] || `curl exited ${r.code}`}`);
    const lines = r.stdout.trimEnd().split("\n");
    const status = Number(lines.pop());
    const reply = lines.join("\n");
    if (status !== 200 && status !== 201) throw new AccError("cloud", `The routine refused the fire (HTTP ${status || "?"}): ${reply.trim().slice(0, 300) || "no reply"}. ${status === 401 ? "The token was refused: generate a new one on the routine's page and run acc cloud token." : status === 429 ? "The routine's hourly limit is reached (30 fires a routine, 100 an account): try later." : ""}`.trim());
    let parsed;
    try {
      parsed = JSON.parse(reply);
    } catch {
      throw new AccError("cloud", `The routine's reply wasn't JSON: ${reply.trim().slice(0, 200)}`);
    }
    const sessionId = typeof parsed.claude_code_session_id === "string" ? parsed.claude_code_session_id : "";
    const url = typeof parsed.claude_code_session_url === "string" ? parsed.claude_code_session_url : "";
    if (!sessionId || !url) throw new AccError("cloud", `The routine's reply named no session: ${reply.trim().slice(0, 200)}`);
    return { sessionId, url };
  } finally {
    rmSync9(headers, { force: true });
    rmSync9(body, { force: true });
  }
}
var DONE_TRAILER = "Acc-Done";
var BLOCKED_TRAILER = "Acc-Blocked";
var NOTE_TRAILERS = { landed: "Acc-Landed", moved: "Acc-Moved", open: "Acc-Open" };
function parseFinish(message2, id) {
  const trailers = /* @__PURE__ */ new Map();
  for (const line of message2.split("\n")) {
    const m = /^([A-Za-z][A-Za-z-]*):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1].toLowerCase();
    trailers.set(key, [...trailers.get(key) ?? [], m[2].trim()]);
  }
  const done = (trailers.get(DONE_TRAILER.toLowerCase()) ?? []).some((v) => v.toUpperCase() === id.toUpperCase());
  const blocked = trailers.get(BLOCKED_TRAILER.toLowerCase())?.filter(Boolean).join(" ") || null;
  const part = (k2) => trailers.get(NOTE_TRAILERS[k2].toLowerCase())?.filter(Boolean);
  const note = noteInput({ landed: part("landed"), moved: part("moved"), open: part("open") });
  return { done, blocked, note: done || blocked ? note : null };
}
var ORG_GATES = ["validate", "drift"];
function cloudChecks(config, env) {
  const required = requiredGates(config, env.branch, "builder");
  const macOnly = required.filter((g) => config.profile === "salesforce" && ORG_GATES.includes(g));
  return { inCloud: required.filter((g) => !macOnly.includes(g)), macOnly };
}
function cloudText(p) {
  const { task, config, env, branch, checks } = p;
  const commandOf = (g) => config.gates.commands[g] ?? config.gates.ratchets?.[g]?.command ?? null;
  const commands = checks.inCloud.map((g) => `- \`${g}\`: ${commandOf(g) ? `\`${commandOf(g)}\`` : `acc's built-in ${g} check, which acc runs on the Mac when it collects your work`}`);
  return [
    // The guard's record (GH-69): the repo's push guard reads this line from the session's first message,
    // and allows a push of this branch alone. It comes first, on its own line, exactly like this.
    `${RECORD_LINE}: ${branch}`,
    "",
    `# Cloud builder for ${task.id}: ${task.title}`,
    "",
    `This routine-fire-payload is your task: acc fired the routine to build ${task.id} in this cloud session. Do the task below as the builder, exactly as its instructions say, with these differences for a cloud session:`,
    "",
    `- **Your branch is \`${branch}\`**, already on GitHub, started from \`${env.branch}\`. Start with \`git fetch origin ${branch} && git checkout ${branch}\`. Work on it only. The \`${RECORD_LINE}\` line at the top is the repo's push guard's record of it: the guard allows \`git push origin ${branch}\` and nothing else that pushes, written plainly, as its own command.`,
    "- **acc isn't installed here.** Where the instructions say `acc gate run`, run these checks yourself and fix what fails:",
    ...commands.length ? commands : ["  - this project names no checks a cloud session can run"],
    ...checks.macOnly.length ? [`- **These checks can't run in the cloud**, since they need an org login, and acc runs them on the Mac when it collects your branch: ${checks.macOnly.map((g) => `\`${g}\``).join(", ")}. Don't try them here.`] : [],
    "- **Where the instructions say `acc done`**, finish like this instead, all in your last commit's message, a trailer on its own line each:",
    "  ```",
    `  ${DONE_TRAILER}: ${task.id}`,
    `  ${NOTE_TRAILERS.landed}: <what landed>`,
    `  ${NOTE_TRAILERS.moved}: <tests, checks, ratchets that moved, or none>`,
    `  ${NOTE_TRAILERS.open}: <what's still open, or none>`,
    "  ```",
    `  Give \`${NOTE_TRAILERS.landed}\`, \`${NOTE_TRAILERS.moved}\` or \`${NOTE_TRAILERS.open}\` again for each further line. Then push only your branch: \`git push origin ${branch}\`. acc sees the trailer on the branch's head and collects your work.`,
    `- **Where the instructions say \`acc block\`**, commit with \`${BLOCKED_TRAILER}: <what you need>\` on your last commit instead, push your branch, and stop.`,
    `- **Push only \`${branch}\`.** Never push \`${env.branch}\` or any other branch, never force-push, never merge a pull request or open one, and never deploy. The repo's hooks refuse anything else: the guard before a command runs, and a git pre-push hook in this clone on the push itself. A person lands your branch.`,
    "- **Leave the hooks alone.** From Bash, nothing under `.claude/` or `.git/` is written; the Edit and Write tools refuse `.claude/hooks/`, `.claude/settings.json` and anything under `.git/`; `--no-verify` and `core.hooksPath` are refused. Other files under `.claude/` can be edited with Edit or Write if the task needs it.",
    `- Commit as \`${config.commitIdentity?.name ?? "the repo's commit identity"}\`${config.commitIdentity ? ` (\`git config user.name "${config.commitIdentity.name}" && git config user.email "${config.commitIdentity.email}"\`)` : ""}.`,
    "",
    "---",
    "",
    p.packet.trim(),
    ""
  ].join("\n");
}
function cloudQuiet(task, config, now2) {
  const c = task.run?.cloud;
  if (task.state !== "running" || task.run?.where !== "cloud" || !c || c.finished) return false;
  const minutes = config.agents.cloud?.quietMinutes ?? CLOUD_QUIET_MINUTES;
  return now2.getTime() - Date.parse(c.lastPushAt) > minutes * 6e4;
}
function cloudWait(task, config, now2) {
  const c = task.run?.cloud;
  if (task.state !== "running" || task.run?.where !== "cloud" || !c) return null;
  if (c.collect) return `acc couldn't collect its work: ${c.collect.reason}`;
  if (cloudQuiet(task, config, now2)) return `no word from its cloud builder for ${Math.round((now2.getTime() - Date.parse(c.lastPushAt)) / 6e4)} minutes: it may be waiting for an answer on claude.ai`;
  return null;
}
function remoteHead(run2, root, branch, env) {
  const r = run2("git", ["ls-remote", "--heads", "origin", branch], { cwd: root, env: { ...env, GIT_TERMINAL_PROMPT: "0" }, timeoutMs: FETCH_TIMEOUT_MS2 });
  if (r.code !== 0) return null;
  const m = /^([0-9a-f]{40,64})\s+refs\/heads\//m.exec(r.stdout);
  return m?.[1] ?? null;
}
function followCloud(paths, config, deps, opts = {}) {
  const { run: run2, now: now2, env } = deps;
  const out3 = [];
  const tasks = readLedger(paths.ledger).tasks.filter((t) => t.state === "running" && t.run?.where === "cloud" && t.run.cloud && (!t.run.cloud.finished || t.run.cloud.collect) && (!opts.only || t.id === opts.only));
  for (const t of tasks) {
    const branch = t.run.branch;
    const head = remoteHead(run2, paths.root, branch, env);
    if (!head) {
      out3.push({ task: t.id, outcome: "unreachable", note: `origin didn't answer for ${branch}` });
      continue;
    }
    if (head === t.run.cloud.head) {
      out3.push({ task: t.id, head, outcome: "unchanged", note: `${branch} is still at ${head.slice(0, 7)}` });
      continue;
    }
    if (!fetchBranches(run2, paths.root, [branch], env)) {
      out3.push({ task: t.id, head, outcome: "unreachable", note: `couldn't fetch ${branch}` });
      continue;
    }
    const message2 = run2("git", ["log", "-1", "--format=%B", head], { cwd: paths.root }).stdout;
    const finish = parseFinish(message2, t.id);
    const at2 = now2().toISOString();
    mutate(paths, now2, (l3, emit) => {
      const x2 = l3.tasks.find((y2) => y2.id === t.id);
      if (!x2?.run?.cloud || x2.state !== "running") return;
      x2.run.cloud = { ...x2.run.cloud, head, lastPushAt: at2, ...finish.done ? { finished: true } : {}, collect: null };
      x2.updatedAt = at2;
      emit({ type: "task.updated", task: t.id, actor: "sync", by: opts.by ?? "acc sync", data: { cloud: { head, finished: finish.done, blocked: finish.blocked } } });
    });
    if (finish.blocked) {
      const req = { to: "blocked", actor: "builder", by: `builder:${t.id}`, reason: finish.blocked, ...finish.note ? { note: finish.note } : {} };
      const moved = mutate(paths, now2, (l3, emit) => {
        const x2 = l3.tasks.find((y2) => y2.id === t.id);
        if (!x2 || x2.state !== "running" || checkMove(l3, config, x2, req, receiptHooks(paths, config, run2)).length) return false;
        applyMove(x2, req, emit, now2, { cloud: true });
        return true;
      });
      out3.push({ task: t.id, head, outcome: "blocked", note: moved ? `its cloud builder blocked: ${finish.blocked}` : `its cloud builder blocked, but the move was refused: ${finish.blocked}` });
      continue;
    }
    if (!finish.done) {
      out3.push({ task: t.id, head, outcome: "pushed", note: `${branch} moved to ${head.slice(0, 7)}` });
      continue;
    }
    try {
      const c = collect(paths, config, t.id, deps, { actor: "builder", by: `builder:${t.id}`, note: finish.note });
      out3.push({ task: t.id, head, outcome: "collected", note: c.reason });
    } catch (e) {
      out3.push({ task: t.id, head, outcome: "collect-failed", note: e.message });
    }
  }
  return out3;
}
function collect(paths, config, id, deps, opts) {
  const { run: run2, now: now2, env } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  if (task.state !== "running") throw new AccError("refused", `${id} is ${task.state}. acc collects a running cloud builder's work.`);
  if (task.run?.where !== "cloud" || !task.run.cloud) throw new AccError("refused", `${id}'s builder runs on this Mac, and finishes with acc done itself.`);
  const branch = task.run.branch;
  const wt2 = task.run.worktree;
  if (!branch || !wt2) throw new AccError("refused", `${id} has no branch or worktree to collect into.`);
  const envBranch = environmentByBranch(config, task.environment);
  if (!envBranch) throw new AccError("refused", `${id}'s environment "${task.environment}" isn't in the config.`);
  const fail3 = (reason) => {
    mutate(paths, now2, (l3, emit) => {
      const x2 = l3.tasks.find((y2) => y2.id === id);
      if (!x2?.run?.cloud) return;
      x2.run.cloud.collect = { at: now2().toISOString(), reason };
      emit({ type: "task.updated", task: id, actor: opts.actor, by: opts.by, data: { cloud: { collect: x2.run.cloud.collect } } });
    });
    throw new AccError("collect", `Couldn't collect ${id}: ${reason}`);
  };
  if (!existsSync11(wt2)) return fail3(`its worktree ${wt2} isn't on disk any more.`);
  const git10 = (...args) => run2("git", args, { cwd: wt2 });
  const on = git10("symbolic-ref", "--quiet", "--short", "HEAD").stdout.trim();
  if (on !== branch) return fail3(`${wt2} is on ${on || "a detached commit"}, not ${branch}.`);
  if (git10("status", "--porcelain").stdout.trim()) return fail3(`${wt2} has changes nobody committed. Commit or discard them, then collect again: acc collect ${id}.`);
  if (!fetchBranches(run2, paths.root, [branch], { ...env, GIT_TERMINAL_PROMPT: "0" })) return fail3(`couldn't fetch ${branch} from origin.`);
  const remote = `refs/remotes/origin/${branch}`;
  const sha = git10("rev-parse", "--verify", "--quiet", remote).stdout.trim();
  if (!sha) return fail3(`origin has no ${branch}.`);
  const local = git10("rev-parse", "HEAD").stdout.trim();
  if (local !== sha) {
    if (git10("merge-base", "--is-ancestor", local, sha).code !== 0) return fail3(`${branch} has diverged: this clone has commits origin's doesn't. Bring them together by hand, then collect again: acc collect ${id}.`);
    const ff = git10("merge", "--ff-only", remote);
    if (ff.code !== 0) return fail3(`git couldn't fast-forward ${branch}: ${(ff.stderr || ff.stdout).trim().split("\n").at(-1)}`);
  }
  const gates = requiredGates(config, envBranch.branch, "builder");
  let results = [];
  if (gates.length) {
    try {
      results = runGates({ ...paths, root: wt2 }, config, envBranch, gates, priorTests(paths, config, sha), { run: run2, now: now2, slots: deps.slots, task: id }).results;
    } catch (e) {
      return fail3(`its checks couldn't run: ${e.message}`);
    }
  }
  const failed = results.filter((r) => !r.recorded || !satisfies(r.receipt));
  if (failed.length) return fail3(`${failed.map((r) => `${r.gate} ${r.status === "fail" ? "failed" : r.status === "hold" ? "needs a person" : "couldn't run"}: ${r.summary.replace(/[.!?]$/, "")}`).join("; ")}. Fix it on the branch and collect again: acc collect ${id}.`);
  const given2 = opts.note ?? null;
  const note = { landed: given2?.landed?.length ? given2.landed : ["(the cloud builder's last commit gave no Acc-Landed line)"], moved: given2?.moved ?? ["none"], open: given2?.open ?? ["none"] };
  const req = { to: "review", actor: opts.actor, by: opts.by, reason: `Collected from its cloud session at ${sha.slice(0, 7)}.`, note };
  const moved = mutate(paths, now2, (l3, emit) => {
    const x2 = l3.tasks.find((y2) => y2.id === id);
    const problems = checkMove(l3, config, x2, req, receiptHooks(paths, config, run2));
    if (problems.length) throw new AccError("collect", `Couldn't move ${id} to review:
- ${problems.join("\n- ")}`);
    if (x2.run?.cloud) x2.run.cloud = { ...x2.run.cloud, head: sha, finished: true, collect: null };
    applyMove(x2, req, emit, now2, { cloud: { sha, checks: results.map((r) => ({ gate: r.gate, status: r.status })) } });
    return x2;
  });
  return { task: moved, sha, checks: results, reason: `Collected ${sha.slice(0, 7)} from the cloud${gates.length ? `, and ${gates.join(", ")} passed on this Mac` : ""}: ${id} is in review.` };
}
function enableCloud(configFile, change2, current3) {
  if (change2.routine !== void 0 && change2.routine !== null && !ROUTINE_ID.test(change2.routine)) throw new AccError("usage", "A routine's API trigger id looks like trig_01ABC\u2026: copy it from the routine's page at claude.ai/code/routines.");
  if (change2.default !== void 0 && !BUILDER_PLACES.includes(change2.default)) throw new AccError("usage", `The default is one of ${BUILDER_PLACES.join(", ")}.`);
  if (change2.quietMinutes !== void 0 && (!Number.isInteger(change2.quietMinutes) || change2.quietMinutes < 5 || change2.quietMinutes > 1440)) throw new AccError("usage", "The quiet time is a whole number of minutes from 5 to 1440.");
  if (change2.max !== void 0 && (!Number.isInteger(change2.max) || change2.max < 1 || change2.max > 16)) throw new AccError("usage", "The cloud cap is a whole number from 1 to 16.");
  if (!current3) {
    const section = {
      ...change2.routine ? { routine: change2.routine } : {},
      default: change2.default ?? "local",
      quietMinutes: change2.quietMinutes ?? CLOUD_QUIET_MINUTES,
      max: change2.max ?? CLOUD_MAX
    };
    writeJsonKey(configFile, ["agents", "cloud"], section);
    return;
  }
  if (change2.routine !== void 0) writeJsonKey(configFile, ["agents", "cloud", "routine"], change2.routine ?? void 0);
  if (change2.default !== void 0) writeJsonKey(configFile, ["agents", "cloud", "default"], change2.default);
  if (change2.quietMinutes !== void 0) writeJsonKey(configFile, ["agents", "cloud", "quietMinutes"], change2.quietMinutes);
  if (change2.max !== void 0) writeJsonKey(configFile, ["agents", "cloud", "max"], change2.max);
}
function disableCloud(configFile) {
  writeJsonKey(configFile, ["agents", "cloud"], void 0);
}

// packages/core/src/protection.ts
var GH_TIMEOUT_MS = 3e4;
function read(run2, path, env) {
  const r = run2("gh", ["api", path, "--include"], { env, timeoutMs: GH_TIMEOUT_MS });
  const m = /^HTTP\/[\d.]+ (\d{3})/.exec(r.stdout);
  const status = m ? Number(m[1]) : r.code === 0 ? 200 : 0;
  const body = r.stdout.includes("\r\n\r\n") ? r.stdout.slice(r.stdout.indexOf("\r\n\r\n") + 4) : r.stdout.includes("\n\n") ? r.stdout.slice(r.stdout.indexOf("\n\n") + 2) : r.stdout;
  return { status, body, error: (r.stderr || "").trim().split("\n")[0] ?? "" };
}
var message = (body) => {
  try {
    const j2 = JSON.parse(body);
    return typeof j2.message === "string" ? j2.message : "";
  } catch {
    return "";
  }
};
function branchProtection(run2, repo, branch, env) {
  const protection = read(run2, `repos/${repo}/branches/${encodeURIComponent(branch)}/protection`, env);
  if (protection.status === 200) {
    const rules2 = [];
    try {
      const p = JSON.parse(protection.body);
      if (p.required_pull_request_reviews) rules2.push("a pull request with reviews");
      if (p.required_status_checks) rules2.push("passing checks");
      if (p.enforce_admins?.enabled) rules2.push("no admin bypass");
      if (p.restrictions) rules2.push("who may push");
      if (p.allow_force_pushes?.enabled === false) rules2.push("no force pushes");
      if (p.allow_deletions?.enabled === false) rules2.push("no deletion");
    } catch {
    }
    return { branch, state: "enforced", why: `GitHub protects ${branch}${rules2.length ? `: ${rules2.join(", ")}` : ""}.` };
  }
  const upgrade = (r) => r.status === 403 && /upgrade to github pro|make this repository public/i.test(message(r.body));
  if (upgrade(protection)) return { branch, state: "unavailable", why: `GitHub doesn't offer branch protection or rulesets on ${repo}: a private repo on the free plan. A push the guard didn't catch would be caught by acc's next sync, after the fact, not prevented.` };
  if (protection.status !== 404) return { branch, state: "unknown", why: `gh couldn't read ${branch}'s protection: ${message(protection.body) || protection.error || `HTTP ${protection.status || "?"}`}.` };
  const rules = read(run2, `repos/${repo}/rules/branches/${encodeURIComponent(branch)}`, env);
  if (rules.status === 200) {
    let applied = [];
    try {
      applied = JSON.parse(rules.body);
    } catch {
      applied = [];
    }
    if (Array.isArray(applied) && applied.length) return { branch, state: "enforced", why: `A ruleset applies to ${branch}: ${[...new Set(applied.map((r) => String(r.type ?? "rule").replace(/_/g, " ")))].join(", ")}.` };
    return { branch, state: "none", why: `GitHub enforces no protection and no ruleset on ${branch}: a push the guard didn't catch would be caught by acc's next sync, after the fact, not prevented. Add protection or a ruleset on GitHub to prevent it.` };
  }
  if (upgrade(rules)) return { branch, state: "unavailable", why: `GitHub doesn't offer branch protection or rulesets on ${repo}: a private repo on the free plan. A push the guard didn't catch would be caught by acc's next sync, after the fact, not prevented.` };
  return { branch, state: "unknown", why: `gh couldn't read ${branch}'s rulesets: ${message(rules.body) || rules.error || `HTTP ${rules.status || "?"}`}.` };
}
function environmentProtection(run2, repo, account, branches, env) {
  let ghEnv3;
  try {
    ghEnv3 = { ...env, GH_TOKEN: ghToken(run2, account) };
  } catch (e) {
    return branches.map((branch) => ({ branch, state: "unknown", why: `gh couldn't read ${branch}'s protection: ${e.message}` }));
  }
  return branches.map((branch) => branchProtection(run2, repo, branch, ghEnv3));
}
function protectionWarnings(found) {
  return found.filter((p) => p.state !== "enforced").map((p) => p.state === "unknown" ? `${p.why} Whether a push the guard didn't catch would be prevented isn't known.` : p.why);
}

// packages/core/src/paths.ts
import { realpathSync } from "node:fs";
import { join as join15 } from "node:path";
function repoPaths(cwd, run2) {
  const top = run2("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (top.code !== 0) throw new AccError("not-a-repo", `${cwd} isn't inside a git repository.`);
  const common = run2("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd });
  if (common.code !== 0) throw new AccError("not-a-repo", `Couldn't find the git directory for ${cwd}.`);
  const root = top.stdout.trim();
  const commonDir = common.stdout.trim();
  const stateDir = join15(commonDir, "acc");
  return {
    root,
    commonDir,
    stateDir,
    ledger: join15(stateDir, "ledger.json"),
    events: join15(stateDir, "events.jsonl"),
    lock: join15(stateDir, "ledger.lock"),
    autopilotLock: join15(stateDir, "autopilot.lock"),
    receipts: join15(stateDir, "receipts"),
    reviews: join15(stateDir, "reviews"),
    analyses: join15(stateDir, "analyses"),
    updates: join15(stateDir, "updates"),
    checks: join15(stateDir, "checks"),
    queue: join15(stateDir, "queue"),
    suggestions: join15(stateDir, "rules"),
    packets: join15(stateDir, "packets"),
    logs: join15(stateDir, "logs"),
    config: join15(root, ".acc", "config.json"),
    floors: join15(root, ".acc", "floors.json"),
    relaxed: join15(stateDir, "relaxed.jsonl")
  };
}
function samePath(a2, b) {
  if (a2 === b) return true;
  try {
    return realpathSync(a2) === realpathSync(b);
  } catch {
    return false;
  }
}

// packages/core/src/overlap.ts
import { existsSync as existsSync12 } from "node:fs";
import { isAbsolute as isAbsolute3, relative as relative2 } from "node:path";
function repoPath(path, root) {
  let p = path.trim().replace(/\\/g, "/");
  if (!p) return null;
  if (isAbsolute3(p)) {
    const rel = relative2(root, p).replace(/\\/g, "/");
    if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute3(rel)) return null;
    p = rel;
  }
  const wild = p.search(/[*?[{]/);
  if (wild >= 0) p = p.slice(0, wild).replace(/[^/]*$/, "");
  p = p.replace(/\/{2,}/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (!p || p === "." || p.split("/").includes("..")) return null;
  return p;
}
function plannedFiles(analysis, root) {
  const files = analysis?.approach?.files;
  if (!Array.isArray(files)) return null;
  const out3 = files.map((f) => typeof f?.path === "string" ? repoPath(f.path, root) : null).filter((p) => !!p);
  return out3.length ? [...new Set(out3)].sort() : null;
}
var sameFile = (a2, b) => listed(a2, [b]) || listed(b, [a2]);
var sharedFiles = (config) => [...config.autopilot?.appendOnly ?? [], ...config.dispatch?.shared ?? [], FLOORS_FILE];
function overlaps(own, others, shared) {
  if (!own?.length) return [];
  const out3 = [];
  for (const o of others) {
    const files = /* @__PURE__ */ new Set();
    for (const a2 of own) {
      for (const b of o.files) {
        if (!sameFile(a2, b)) continue;
        const file = a2.length >= b.length ? a2 : b;
        if (!listed(file, shared)) files.add(file);
      }
    }
    if (files.size) out3.push({ task: o.task, files: [...files].sort() });
  }
  return out3;
}
var IN_FLIGHT_STATES = ["running", "review", "rework", "blocked"];
var inFlight = (ledger, except) => ledger.tasks.filter((t) => t.id !== except && IN_FLIGHT_STATES.includes(t.state) && !!t.run?.branch);
var nulPaths = (stdout) => stdout.split("\0").filter(Boolean);
function branchFiles(run2, root, env, branch, worktree) {
  const ref = `refs/heads/${branch}`;
  let base;
  try {
    base = baseFor(run2, root, { branch: env }, ref);
  } catch {
    return [];
  }
  const files = /* @__PURE__ */ new Set();
  try {
    for (const c of changedPaths(run2, root, base, ref)) files.add(c.path);
  } catch {
  }
  if (worktree && existsSync12(worktree)) {
    try {
      for (const c of changedPaths(run2, worktree, base)) files.add(c.path);
    } catch {
    }
    const untracked = run2("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: worktree });
    if (untracked.code === 0) for (const f of nulPaths(untracked.stdout)) files.add(f);
  }
  return [...files].sort();
}
function branchMerged(run2, root, task) {
  if (task.state === "done" || task.pr?.state === "merged") return true;
  if (!task.pr || !task.run?.branch) return false;
  return run2("git", ["merge-base", "--is-ancestor", `refs/heads/${task.run.branch}`, `refs/remotes/origin/${task.environment}`], { cwd: root }).code === 0;
}
function inFlightFiles(paths, ledger, run2, o = {}) {
  const tasks = inFlight(ledger, o.except);
  if (o.fetch) for (const env of new Set(tasks.filter((t) => t.pr).map((t) => t.environment))) run2("git", ["fetch", "--quiet", "origin", env], { cwd: paths.root, timeoutMs: 6e4 });
  return tasks.filter((t) => !branchMerged(run2, paths.root, t)).map((t) => ({
    task: t.id,
    files: [.../* @__PURE__ */ new Set([...plannedFiles(readAnalysis(paths, t.id), paths.root) ?? [], ...branchFiles(run2, paths.root, t.environment, t.run.branch, t.run.worktree)])].sort()
  }));
}
function startOrder(task, candidates, flying, shared) {
  const shares = overlaps(task.files, flying.filter((f) => f.task !== task.id), shared);
  const first = shares.length ? candidates.filter((c) => c.id !== task.id && c.startable && !!c.files?.length && !overlaps(c.files, flying, shared).length).map((c) => c.id) : [];
  return { shares, first };
}
var waits = (look2) => look2.shares.length > 0 && look2.first.length > 0;
var envOpen = (config, task) => {
  const env = environmentByBranch(config, task.environment);
  return !!env && !env.protected;
};
function startCandidates(paths, config, ledger) {
  return ledger.tasks.filter((t) => t.state === "todo").map((t) => ({
    id: t.id,
    files: plannedFiles(readAnalysis(paths, t.id), paths.root),
    startable: isReady(ledger, t) && envOpen(config, t) && !t.held?.failed && !analysisProblems(paths, config, t).length
  }));
}
function startLook(paths, config, ledger, run2, id, o = {}) {
  const files = o.files !== void 0 ? o.files : plannedFiles(readAnalysis(paths, id), paths.root);
  const flying = o.flying ?? inFlightFiles(paths, ledger, run2, { except: id, fetch: o.fetch });
  return startOrder({ id, files }, startCandidates(paths, config, ledger), flying, sharedFiles(config));
}
function filesOf(shares, name = (f) => f.join(", ")) {
  return shares.map((s, i) => `${s.task}'s${i ? "" : " files"}: ${name(s.files)}`).join(", and ");
}
function sharesWords(shares, name = (f) => f.join(", ")) {
  return `Shares files with ${shares.map((s) => `${s.task}: ${name(s.files)}`).join(", and ")}`;
}
function taskList(ids) {
  return ids.length > 1 ? `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}` : ids[0] ?? "";
}

// packages/core/src/review.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { existsSync as existsSync13, mkdirSync as mkdirSync18, readdirSync as readdirSync7, readFileSync as readFileSync20, renameSync as renameSync11, rmSync as rmSync11, writeFileSync as writeFileSync18 } from "node:fs";
import { join as join17 } from "node:path";

// packages/core/src/questions.ts
import { chmodSync as chmodSync2, closeSync as closeSync2, fstatSync, linkSync, mkdirSync as mkdirSync17, openSync as openSync2, readdirSync as readdirSync6, readFileSync as readFileSync19, readSync as readSync2, renameSync as renameSync10, rmSync as rmSync10, statSync as statSync5, writeFileSync as writeFileSync17, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir as homedir4 } from "node:os";
import { join as join16 } from "node:path";
var questionsDir = (env = process.env) => env.ACC_QUESTIONS_DIR || join16(homedir4(), ".acc", "questions");
var ALLOWED_MODES = ["auto", "acceptEdits", "default"];
var LISTENER_STALE_MS = 45e3;
var HOOK_TIMEOUT_S = 3600;
var MAX_WAIT_MS = (HOOK_TIMEOUT_S - 120) * 1e3;
var isUnder = (path, root) => path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);
function readJson(file) {
  try {
    return JSON.parse(readFileSync19(file, "utf8"));
  } catch {
    return null;
  }
}
function writePrivate(file, data) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync17(tmp, JSON.stringify(data), { mode: 384 });
  renameSync10(tmp, file);
}
function ensureDir(dir) {
  mkdirSync17(join16(dir, "listeners"), { recursive: true, mode: 448 });
  try {
    chmodSync2(dir, 448);
  } catch {
  }
}
var HISTORY_KEEP = 1e3;
var HISTORY_MAX_BYTES = 2 * 1024 * 1024;
var HISTORY_TRIM_EVERY_BYTES = 64 * 1024;
var HISTORY_LOCK = { timeoutMs: 1e4, staleMs: 5e3 };
function appendHistory(dir, rec, trimEvery = HISTORY_TRIM_EVERY_BYTES) {
  ensureDir(dir);
  const file = join16(dir, "history.jsonl");
  withLock(join16(dir, "history.lock"), () => {
    appendLine(file, JSON.stringify(rec));
    try {
      const size = statSync5(file).size;
      if (size > trimmedSize(dir, size) + trimEvery) writePrivateText(join16(dir, "history.trimmed"), `${trimHistory(file)}
`);
    } catch {
    }
  }, HISTORY_LOCK);
}
function appendLine(file, line) {
  const fd = openSync2(file, "a+", 384);
  try {
    const { size } = fstatSync(fd);
    const last = Buffer.alloc(1);
    const torn = size > 0 && readSync2(fd, last, 0, 1, size - 1) === 1 && last[0] !== 10;
    writeSync(fd, `${torn ? "\n" : ""}${line}
`);
  } finally {
    closeSync2(fd);
  }
}
function trimmedSize(dir, size) {
  try {
    const n = Number(readFileSync19(join16(dir, "history.trimmed"), "utf8"));
    return Number.isSafeInteger(n) && n >= 0 && n <= size ? n : 0;
  } catch {
    return 0;
  }
}
function trimHistory(file) {
  const data = readFileSync19(file);
  const lines = data.toString("utf8").split("\n").filter(Boolean);
  const kept = [];
  let bytes = 0;
  for (let i = lines.length - 1; i >= 0 && kept.length < HISTORY_KEEP; i--) {
    const line = lines[i];
    if (!readRecord(line)) continue;
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > HISTORY_MAX_BYTES && kept.length) break;
    kept.push(line);
  }
  if (kept.length === lines.length) return data.length;
  const text = kept.reverse().map((l3) => `${l3}
`).join("");
  writePrivateText(file, text);
  return Buffer.byteLength(text);
}
function writePrivateText(file, text) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync17(tmp, text, { mode: 384 });
  renameSync10(tmp, file);
}
function readRecord(line) {
  try {
    const r = JSON.parse(line);
    return r?.v === 1 && typeof r.id === "string" && typeof r.outcome === "string" ? r : null;
  } catch {
    return null;
  }
}
var PREAPPROVAL_MS = 10 * 6e4;
var preapprovalFile = (dir, sessionId) => join16(dir, "approved", `${sessionId.replace(/[^A-Za-z0-9-]/g, "")}.json`);
function preapprove(dir, sessionId, command, now2 = Date.now()) {
  mkdirSync17(join16(dir, "approved"), { recursive: true, mode: 448 });
  writePrivate(preapprovalFile(dir, sessionId), { command, until: now2 + PREAPPROVAL_MS });
}
function takePreapproval(dir, sessionId, command, now2 = Date.now()) {
  const file = preapprovalFile(dir, sessionId);
  const p = readJson(file);
  if (!p || p.command !== command || typeof p.until !== "number" || now2 > p.until) return false;
  rmSync10(file, { force: true });
  return true;
}
var editedMessage = (command) => `The user edited this command in the Command Center. Run exactly this instead, as it is, and carry on:

\`\`\`
${command}
\`\`\``;
function outcomeOf(q2, a2) {
  if (a2.decision === "terminal") return "terminal";
  if (a2.decision === "deny") return a2.stop ? "denied-stopped" : "denied";
  if (q2.tool === "AskUserQuestion") return "answered";
  if (a2.command && q2.tool === "Bash") return "allowed-edited";
  if (a2.mode === "auto") return "allowed-auto-mode";
  if (a2.mode === "acceptEdits") return "allowed-accept-edits";
  if (a2.always) return a2.scope === "project" ? "allowed-for-project" : "allowed-for-session";
  return "allowed";
}
function listeners(dir, now2 = Date.now()) {
  let names3 = [];
  try {
    names3 = readdirSync6(join16(dir, "listeners")).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  return names3.flatMap((n) => {
    const l3 = readJson(join16(dir, "listeners", n));
    const ok = !!l3 && Number.isInteger(l3.pid) && typeof l3.at === "number" && Array.isArray(l3.roots) && now2 - l3.at < LISTENER_STALE_MS && alive(l3.pid);
    return ok ? [l3] : [];
  });
}
var covered = (ls, cwd) => ls.some((l3) => l3.roots.some((r) => typeof r === "string" && isUnder(cwd, r)));
function existsQuestionsDir(dir) {
  try {
    return statSync5(join16(dir, "listeners")).isDirectory();
  } catch {
    return false;
  }
}
function parseHookInput(text) {
  let x2 = null;
  try {
    x2 = JSON.parse(text);
  } catch {
    return null;
  }
  if (!x2 || typeof x2 !== "object") return null;
  const str = (v) => typeof v === "string" && v.length > 0;
  if (!str(x2.session_id) || !str(x2.cwd) || !str(x2.tool_name) || !x2.tool_input || typeof x2.tool_input !== "object") return null;
  return {
    hook_event_name: String(x2.hook_event_name ?? ""),
    session_id: x2.session_id,
    cwd: x2.cwd,
    transcript_path: str(x2.transcript_path) ? x2.transcript_path : void 0,
    tool_name: x2.tool_name,
    tool_input: x2.tool_input,
    permission_suggestions: Array.isArray(x2.permission_suggestions) ? x2.permission_suggestions : []
  };
}
function isAnswer(a2) {
  const x2 = a2;
  if (!x2 || typeof x2 !== "object") return false;
  if (x2.decision === "terminal") return true;
  if (x2.decision === "deny") return (x2.message === void 0 || typeof x2.message === "string" && x2.message.length <= 4e3) && (x2.stop === void 0 || typeof x2.stop === "boolean");
  if (x2.decision !== "allow") return false;
  if (x2.always !== void 0 && typeof x2.always !== "boolean") return false;
  if (x2.scope !== void 0 && x2.scope !== "session" && x2.scope !== "project") return false;
  if (x2.mode !== void 0 && !ALLOWED_MODES.includes(x2.mode)) return false;
  if (x2.command !== void 0 && !(typeof x2.command === "string" && x2.command.trim().length > 0 && x2.command.length <= 2e4)) return false;
  if (x2.answers === void 0) return true;
  const answers = x2.answers;
  return !!answers && typeof answers === "object" && Object.values(answers).every((v) => typeof v === "string" && v.length <= 4e3);
}
async function ask(input, opts = {}) {
  const dir = opts.dir ?? questionsDir();
  const now2 = opts.now ?? Date.now;
  const wait = opts.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 300;
  const maxWaitMs = opts.maxWaitMs ?? MAX_WAIT_MS;
  const record2 = (q2, outcome, a2) => {
    try {
      appendHistory(dir, {
        v: 1,
        id: q2.id,
        sessionId: input.session_id,
        cwd: input.cwd,
        tool: input.tool_name,
        input: input.tool_input,
        askedAt: q2.at,
        endedAt: now2(),
        outcome,
        ...a2?.decision === "allow" && a2.answers ? { answers: a2.answers } : {},
        ...a2?.decision === "deny" && a2.message ? { message: a2.message } : {},
        ...a2?.decision === "allow" && a2.command && input.tool_name === "Bash" ? { command: a2.command } : {}
      });
    } catch {
    }
  };
  if (input.tool_name === "Bash" && takePreapproval(dir, input.session_id, String(input.tool_input.command ?? ""), now2())) {
    const id = `${now2().toString(36)}-${randomBytes(4).toString("hex")}`;
    const q2 = { v: 1, id, pid: opts.pid ?? process.pid, at: now2(), sessionId: input.session_id, cwd: input.cwd, transcript: input.transcript_path ?? null, tool: input.tool_name, input: input.tool_input, suggestions: [] };
    return { question: q2, answer: { decision: "allow" } };
  }
  if (!covered(listeners(dir, now2()), input.cwd)) {
    if (listeners(dir, now2()).length || existsQuestionsDir(dir)) record2({ id: `${now2().toString(36)}-${randomBytes(4).toString("hex")}`, at: now2() }, "no-window");
    return null;
  }
  ensureDir(dir);
  const question = {
    v: 1,
    id: `${now2().toString(36)}-${randomBytes(4).toString("hex")}`,
    pid: opts.pid ?? process.pid,
    at: now2(),
    sessionId: input.session_id,
    cwd: input.cwd,
    transcript: input.transcript_path ?? null,
    tool: input.tool_name,
    input: input.tool_input,
    suggestions: input.permission_suggestions ?? []
  };
  const file = join16(dir, `${question.id}.json`);
  const answerFile = join16(dir, `${question.id}.answer.json`);
  writePrivate(file, question);
  const started = now2();
  try {
    for (let i = 0; ; i++) {
      const a2 = readJson(answerFile);
      if (isAnswer(a2)) {
        record2(question, outcomeOf(question, a2), a2);
        if (a2.decision === "allow" && a2.command && question.tool === "Bash") preapprove(dir, question.sessionId, a2.command, now2());
        return a2.decision === "terminal" ? null : { question, answer: a2 };
      }
      if (opts.signal?.aborted) {
        record2(question, "stopped");
        return null;
      }
      if (now2() - started > maxWaitMs) {
        record2(question, "timed-out");
        return null;
      }
      if (i % 10 === 9 && !covered(listeners(dir, now2()), input.cwd)) {
        record2(question, "window-closed");
        return null;
      }
      await wait(pollMs);
    }
  } finally {
    rmSync10(file, { force: true });
    rmSync10(answerFile, { force: true });
  }
}
function hookOutput(q2, a2) {
  if (a2.decision === "terminal") return null;
  let decision;
  if (a2.decision === "deny") {
    decision = { behavior: "deny", message: a2.message?.trim() ? `The user said no, from the Command Center: ${a2.message.trim()}` : "The user said no, from the Command Center." };
    if (a2.stop) decision.interrupt = true;
  } else if (q2.tool === "AskUserQuestion") {
    decision = { behavior: "allow", updatedInput: { ...q2.input, answers: a2.answers ?? {} } };
  } else {
    if (a2.command && q2.tool === "Bash") return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: editedMessage(a2.command) } } };
    decision = { behavior: "allow" };
    const updates = [];
    if (a2.always && q2.suggestions.length) updates.push(...q2.suggestions.map((s) => ({ ...s, destination: a2.scope === "project" ? "localSettings" : "session" })));
    if (a2.mode) updates.push({ type: "setMode", mode: a2.mode, destination: "session" });
    if (updates.length) decision.updatedPermissions = updates;
  }
  return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision } };
}
function permissionHook(command) {
  return { PermissionRequest: [{ matcher: "*", hooks: [{ type: "command", command: `${command} hook permission`, timeout: HOOK_TIMEOUT_S }] }] };
}
function pendingQuestions(dir) {
  let names3 = [];
  try {
    names3 = readdirSync6(dir).filter((n) => n.endsWith(".json") && !n.endsWith(".answer.json"));
  } catch {
    return [];
  }
  const out3 = [];
  for (const n of names3) {
    const q2 = readJson(join16(dir, n));
    if (!q2 || q2.v !== 1 || typeof q2.id !== "string" || `${q2.id}.json` !== n || !Number.isInteger(q2.pid)) continue;
    if (!alive(q2.pid)) {
      rmSync10(join16(dir, n), { force: true });
      rmSync10(join16(dir, `${q2.id}.answer.json`), { force: true });
      continue;
    }
    out3.push(q2);
  }
  return out3.sort((a2, b) => a2.at - b.at);
}
var askingUnder = (questions, dir) => questions.some((q2) => q2.cwd === dir || q2.cwd.startsWith(dir.endsWith("/") ? dir : `${dir}/`));

// packages/core/src/packet.ts
function lastRunSection(task, env) {
  const r = task.run;
  if (!r) return [];
  const check2 = `\`git status\`, \`git log --oneline origin/${env.branch}..HEAD\` and \`acc gate list\``;
  const which = r.n ? ` (builder ${r.n})` : "";
  const blocked = [...task.history].reverse().find((h2) => h2.to === "blocked" && h2.from === "running" && (!r.startedAt || h2.at >= r.startedAt));
  const said2 = blocked?.reason?.trim() ? ["", "It blocked, saying:", "", ...blocked.reason.trim().split("\n").map((l3) => `> ${l3}`)] : [];
  if (!r.note) {
    return [
      "## Your last run left no note",
      "",
      `This task ran before${which}, and that run ended without a note: it may have crashed, run out of context or been stopped, or a person moved it. Don't assume its work is finished, or that none was done. Start by checking the tree: ${check2}.`,
      ...said2,
      ""
    ];
  }
  return [
    "## What your last run left",
    "",
    `This task ran before${which}, and its builder left this note when it ${r.note.ended === "blocked" ? "blocked" : "moved it to review"}. It's that builder's own account: check it against the tree (${check2}) before you build on it.`,
    ...said2,
    "",
    ...noteMarkdown(r.note),
    ""
  ];
}
function depsSection(deps) {
  const noted = (deps ?? []).filter((d) => d.run?.note);
  if (!noted.length) return [];
  return [
    "## What the tasks it depends on left",
    "",
    `This task builds on ${noted.length === 1 ? "another, whose builder" : `${noted.length} others, whose builders each`} left a note when it finished. Each is that builder's own account.`,
    "",
    ...noted.flatMap((d) => [`### ${d.id}: ${d.title}`, "", ...noteMarkdown(d.run.note), ""])
  ];
}
function reviewSection(v) {
  if (!v || v.verdict !== "changes") return [];
  const where = (f) => f.file ? `\`${f.file}${f.line ? `:${f.line}` : ""}\`: ` : "";
  const must2 = v.findings.filter((f) => f.must);
  const unmet = v.criteria.filter((c) => !c.met);
  return [
    "## What the review asked for",
    "",
    `This is a rework. The reviewer looked at ${v.sha.slice(0, 7)} and asked for changes: ${v.summary}`,
    "",
    ...must2.map((f) => `- ${where(f)}${f.message}${f.rule ? ` (rule: ${f.rule})` : ""}`),
    ...unmet.map((c) => `- Not met yet: ${c.text}. ${c.evidence}`),
    ...must2.length || unmet.length ? [""] : [],
    "Fix these, and keep the rest of the change as it is. Then finish as below.",
    ""
  ];
}
function sentBackSection(task) {
  const back = [...task.history].reverse().find((h2) => h2.to === "rework");
  if (task.state !== "rework" || !back || back.actor !== "human" || !back.reason?.trim()) return [];
  return [
    "## Why a person sent it back",
    "",
    `${back.by.replace(/^human:/, "")} moved it back to rework${back.from ? ` from ${back.from}` : ""}, saying:`,
    "",
    ...back.reason.trim().split("\n").map((l3) => `> ${l3}`),
    "",
    "Do what it asks, and keep the rest of the change as it is. Then finish as below.",
    ""
  ];
}
function notesSection(task) {
  const notes = task.notes?.trim();
  return notes ? ["## Notes for the builder", "", notes, ""] : [];
}
function commitRef(task) {
  if (task.source.kind === "github") return ` Add \`refs #${task.id.replace(/^GH-/, "")}\` on its own line, so GitHub links the commit to the issue.`;
  return "";
}
function renderPacket(p) {
  const { task, config, env } = p;
  const sf = config.profile === "salesforce";
  const required = requiredGates(config, env.branch, "builder");
  const lighter = builderGatesFor(config, env.branch);
  const lines = [
    `# Task ${task.id}: ${task.title}`,
    "",
    `You are the builder for ${task.id}. Work only on this task, only in this worktree, and stop when it's done.`,
    ""
  ];
  if (p.enterWorktree) {
    lines.push(
      "## First, before anything else",
      "",
      `Call the **EnterWorktree** tool with the path \`${p.worktree}\`. Do this before reading or editing any file. Your session starts in the main checkout, which you must never change. Claude Code keeps you inside the worktree once you've entered it.`,
      ""
    );
  }
  lines.push(
    "## The task",
    "",
    task.brief.trim() || "_No details were given beyond the title. If the title alone is too vague to build from, block (see the finish line) and say what you need._",
    "",
    task.source.url ? `Ticket: ${task.source.url}` : `Source: ${task.source.kind}`,
    "",
    ...notesSection(task),
    ...analysisSection(p.analysis ?? null),
    ...depsSection(p.deps),
    ...lastRunSection(task, env),
    ...reviewSection(p.review),
    ...sentBackSection(task),
    ...checksSection(p.checks),
    ...queueSection(p.queue),
    "## Where you are",
    "",
    ...p.cloud ? ["- **Workspace:** this cloud session's clone of the repo. acc collects your branch into the task's worktree on the Mac."] : [`- **Worktree:** \`${p.worktree}\`. This is your only workspace.`],
    `- **Branch:** \`${p.branch}\`, started from \`${env.branch}\`, the ${env.name} environment's branch.${p.cloud ? " It's on GitHub already: check it out, and push only it." : ""}`
  );
  if (sf && env.org) lines.push(`- **Org:** \`${env.org}\` (${env.name}). It's already this worktree's default org.`);
  lines.push(
    "",
    "## How to work",
    "",
    `- **Commits:** \`${task.id}: <what changed>\`, one logical change per commit.${commitRef(task)} Never write "fixes", "closes" or "resolves" in a commit message; the ticket is closed by a person.`,
    "- **Changes:** keep them to what the task asks. If you find something else that needs fixing, put it in your note's `--open` lines (see the finish line) instead of fixing it."
  );
  if (sf) {
    lines.push(
      "- **Salesforce:** validate, never deploy. `acc gate run validate` proves a change with a check-only deploy to the org; nothing is saved. Real deploys happen after a person merges.",
      '- **Tests:** if you change Apex, name the test classes that cover it and why each is the right one: `acc gate run validate --test <TestClass>="<why>"`, once per class.'
    );
  }
  lines.push("", "## The finish line", "");
  lines.push("1. **Commit** everything the task needs. Leave nothing uncommitted.");
  if (required.length) {
    lines.push(
      `2. **Checks:** run exactly \`acc gate run\`. It runs the required checks (${required.map((g) => `\`${g}\``).join(", ")}) on your latest commit and records each result; \`acc done\` refuses until every one has passed. If one fails, fix it, commit, and run \`acc gate run\` again. If a check can't run at all (it says error), block and quote its message.`
    );
    const queued = fullGates(config).filter((g) => !required.includes(g));
    if (lighter && queued.length) {
      lines.push(`   These are the lighter checks, such as the tests near what you changed. The full check (${queued.map((g) => `\`${g}\``).join(", ")}) runs once, in the merge queue, before your pull request merges, so you needn't run it, though \`acc gate run ${queued[0]}\` does if you want to.`);
    }
    const ratchets = required.filter((g) => config.gates.ratchets?.[g]);
    if (ratchets.length) {
      lines.push(`   ${ratchets.map((g) => `\`${g}\``).join(", ")} ${ratchets.length === 1 ? "is a ratchet" : "are ratchets"}: a number that may only get better. When yours beats its floor, \`acc gate run\` writes the new floor to \`.acc/floors.json\`: commit that file, then run \`acc gate run\` again. Never make the number, or a floor in that file, worse by hand. If this change has to make one worse, block and say why: only a person relaxes a floor.`);
    }
    if (sf) {
      lines.push('   If you changed Apex, add `--test <TestClass>="<why it covers the change>"` once per test class, for example `acc gate run --test AccountServiceTest="covers the new discount rule"`. Those flags are the only thing to add.');
    }
  } else {
    lines.push("2. **Checks:** run the project's tests or build if it has them, and report the results.");
  }
  lines.push(
    `3. **Finish** with a note, by running \`acc done\` as its own command, all on one line: \`${DONE_COMMAND}\`. It is already on your PATH and pre-approved. Don't run it through npm scripts, \`npx\`, or other wrappers, and don't chain it with other commands, or it will stop for permission.`,
    `   The note is for whoever comes next: the reviewer, the next builder and the pull request read it, and it's posted on the pull request on GitHub, so keep secrets and client data out of it. \`--landed\` says what the change does now; \`--moved\` which numbers moved (tests added, checks passed, ratchets raised); \`--open\` what's left undone or worth a follow-up, each line something a person could make a task of. Give a flag again for each further line, up to ${NOTE_LIMITS.lines} a part and ${NOTE_LIMITS.chars} characters a line. \`--moved none\` and \`--open none\` say there was nothing. Use double quotes, with no backticks or \`$\` inside them. \`acc done\` refuses without a note.`,
    '   If you\'re stuck, run exactly `acc block "<what you need>"` instead, and stop. If part of the work landed, add the same `--landed`, `--moved` and `--open` to it.',
    "   If only the client can answer what you need (a business rule, access you don't have, or a choice that's theirs to make), run exactly `acc block --client \"<your question>\"` instead, and stop. Write the question for the client, in plain words with no code, file or tool names: a person reads it before it goes on the ticket.",
    ...p.accPath ? [`   If \`acc\` really isn't found, its full path is \`${p.accPath}\`.`] : [],
    "4. **Summarize** your note in your final message, with anything a reviewer should look at.",
    "",
    "## Never",
    "",
    // Merging the base into this branch is the builder's to do when the merge queue asks (GH-73); a pull request isn't.
    "- push, merge a pull request, or open one (a person, `acc land` and autopilot do that)"
  );
  if (sf) lines.push("- deploy to any org (`sf project deploy start`)");
  lines.push(
    "- edit files outside this worktree, or check out another branch",
    "- change the ticket or the task list, apart from `acc done` and `acc block`"
  );
  if (p.environmentSpecific.length) {
    lines.push("- edit an environment-specific file (D-016). Each org keeps its own version of these:", ...p.environmentSpecific.map((f) => `  - \`${f}\``));
  }
  if (p.rules?.trim()) lines.push("", "## Rules", "", p.rules.trim());
  return lines.join("\n") + "\n";
}
function builderSettings(task, config, accBinDir2, basePath, accCommand2) {
  const sf = config.profile === "salesforce";
  const allow = [
    "Bash(acc done*)",
    "Bash(acc block *)",
    "Bash(acc show *)",
    "Bash(acc gate run)",
    "Bash(acc gate run *)",
    "Bash(acc gate list*)",
    "Bash(git status*)",
    "Bash(git diff*)",
    "Bash(git add *)",
    "Bash(git commit *)",
    "Bash(git log*)",
    "Bash(git show *)",
    // Bringing its own base in, as the merge queue asks when it conflicts (GH-73), with or without flags such
    // as --no-edit: only where the queue runs, so where auto-merge is off, a Salesforce project above all, a
    // builder still asks first. Any other branch it still asks about.
    ...autoMergeFor(config, task.environment) ? [`Bash(git merge origin/${task.environment})`, `Bash(git merge origin/${task.environment} *)`] : [],
    "Bash(npm test*)",
    "Bash(npm run *)",
    "Bash(npx prettier *)",
    "Bash(npx eslint *)",
    "Bash(node --test*)",
    "Bash(node --no-warnings --test*)",
    // A project may ask for builds and tests under nice, so the machine stays usable: the same commands, niced.
    "Bash(nice -n 15 npm test*)",
    "Bash(nice -n 15 npm run *)",
    "Bash(nice -n 15 npx prettier *)",
    "Bash(nice -n 15 npx eslint *)",
    "Bash(nice -n 15 node --test*)",
    "Bash(nice -n 15 node --no-warnings --test*)",
    ...sf ? ["Bash(sf project deploy validate *)", "Bash(sf code-analyzer run *)", "Bash(sf apex run test *)", "Bash(sf data query *)"] : []
  ];
  const deny2 = [
    "Bash(git push*)",
    "Bash(gh pr *)",
    "Bash(git checkout *)",
    "Bash(git switch *)",
    "Bash(git worktree *)",
    "Bash(git reset --hard*)",
    "Bash(acc set *)",
    "Bash(acc edit*)",
    "Bash(acc dispatch *)",
    "Bash(acc init*)",
    "Bash(acc gate waive*)",
    "Bash(acc gate relax*)",
    "Bash(acc land*)",
    "Bash(acc review*)",
    "Bash(acc autopilot*)",
    "Bash(acc agents set*)",
    "Bash(acc agents autonomy*)",
    "Bash(acc agents auto-merge*)",
    "Bash(acc agents max*)",
    "Bash(acc gate required*)",
    "Bash(acc gate builder*)",
    "Bash(acc analyze*)",
    "Bash(acc analysis answer*)",
    "Bash(acc rules import*)",
    "Bash(acc rules accept*)",
    "Bash(acc rules dismiss*)",
    "Bash(acc trackers set*)",
    "Bash(acc github use*)",
    "Bash(acc tidy add*)",
    "Bash(acc tidy skip*)",
    "Bash(acc promote*)",
    "Bash(acc deploy*)",
    "Bash(acc update*)",
    "Bash(acc resume*)",
    "Bash(acc machine*)",
    "Bash(acc sync --close-done*)",
    "Bash(acc collect*)",
    "Bash(acc cloud*)",
    // Releases are a person's (D-079): npm run * is allowed above, and deny beats allow.
    "Bash(gh release create*)",
    "Bash(gh release upload*)",
    "Bash(gh release edit*)",
    "Bash(gh release delete*)",
    "Bash(npm run release*)",
    "Bash(nice -n 15 npm run release*)",
    ...sf ? ["Bash(sf project deploy start*)", "Bash(sf project deploy quick*)", "Bash(sf org delete *)"] : []
  ];
  return {
    env: { ACC_TASK: task.id, ACC_ROLE: "builder", PATH: `${accBinDir2}:${basePath}` },
    permissions: { allow, deny: deny2 },
    // Its permission prompts and questions go to the Command Center when one is open (D-030).
    ...accCommand2 ? { hooks: permissionHook(accCommand2) } : {}
  };
}

// packages/core/src/review.ts
var VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary", "client", "criteria", "findings"],
  properties: {
    verdict: { type: "string", enum: ["pass", "changes"], description: "changes only when something must be fixed before this merges" },
    summary: { type: "string", description: "Two or three plain sentences for the pull request: what the change does and how well" },
    client: { type: "string", description: "One plain sentence for the client: what changes for them, with no code, file, tool or agent names" },
    criteria: {
      type: "array",
      description: "Each acceptance criterion in the task, in its own words",
      items: { type: "object", additionalProperties: false, required: ["text", "met", "evidence"], properties: { text: { type: "string" }, met: { type: "boolean" }, evidence: { type: "string", description: "Where it is met (file:line), or what is missing" } } }
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["message", "must"],
        properties: {
          message: { type: "string", description: "What is wrong, and what to do instead" },
          must: { type: "boolean", description: "true if it has to be fixed before merging" },
          file: { type: "string" },
          line: { type: "integer" },
          rule: { type: "string", description: "The project rule it breaks, if any" },
          kind: { type: "string", description: "A short name for the kind of problem, a few words: reuse one of the kinds you are given when it fits" }
        }
      }
    }
  }
};
var DIFF_MAX = 15e4;
var reviewPath = (paths, task, sha) => join17(paths.reviews, `${task}-${sha}.json`);
var runningPath2 = (paths, task) => join17(paths.reviews, `${task}.running.json`);
function readVerdict(paths, task, sha) {
  try {
    return JSON.parse(readFileSync20(reviewPath(paths, task, sha), "utf8"));
  } catch {
    return null;
  }
}
function carriedVerdict(paths, task, sha) {
  const c = task.autopilot?.carried;
  if (!c || !sha || c.to !== sha) return null;
  const v = readVerdict(paths, task.id, c.from);
  return v?.verdict === "pass" ? v : null;
}
function reviewedAt(paths, task, sha) {
  const own = readVerdict(paths, task.id, sha);
  if (own) return own.verdict === "pass" ? own : null;
  return carriedVerdict(paths, task, sha);
}
function readVerdicts(paths, task) {
  let names3;
  try {
    names3 = readdirSync7(paths.reviews);
  } catch {
    return [];
  }
  const all = [];
  for (const n of names3) {
    if (!n.endsWith(".json") || n.endsWith(".running.json") || task && !n.startsWith(`${task}-`)) continue;
    try {
      const v = JSON.parse(readFileSync20(join17(paths.reviews, n), "utf8"));
      if (typeof v?.task !== "string" || typeof v.sha !== "string" || typeof v.at !== "string" || !Array.isArray(v.findings)) continue;
      if (`${v.task}-${v.sha}.json` === n && (!task || v.task === task)) all.push(v);
    } catch {
    }
  }
  return all.sort((a2, b) => a2.at.localeCompare(b.at) || a2.task.localeCompare(b.task) || a2.sha.localeCompare(b.sha));
}
function latestVerdict(paths, task) {
  return readVerdicts(paths, task).at(-1) ?? null;
}
var KINDS_MAX = 30;
function knownKinds(paths) {
  const n = /* @__PURE__ */ new Map();
  for (const v of readVerdicts(paths)) for (const f of v.findings) if (typeof f.kind === "string" && f.kind.trim()) n.set(f.kind.trim(), (n.get(f.kind.trim()) ?? 0) + 1);
  return [...n].sort((a2, b) => b[1] - a2[1] || a2[0].localeCompare(b[0])).slice(0, KINDS_MAX).map(([k2]) => k2);
}
function reviewing(paths, task) {
  try {
    const r = JSON.parse(readFileSync20(runningPath2(paths, task), "utf8"));
    return alive(r.pid) ? r : null;
  } catch {
    return null;
  }
}
function checkLine(r) {
  const result = r.waived ? `waived (it was ${r.waived.was ?? "not run"}), because ${r.waived.reason}` : `${r.status}. ${r.summary}`;
  const tests = testsText(r);
  return `- ${r.gate}: ${result}${tests ? ` Tests: ${tests}.` : ""}${r.countsNote ? ` ${r.countsNote}` : ""}`;
}
var DUPLICATE_HELPER = "Does it add a helper that does what an existing one already does? Search for one (Grep for its name and for what it does), and name both in the finding's message, each as file:line. When the existing one is exported, the finding must be fixed (must: true): use it instead. A near-copy of a local, unexported one is must: false.";
function editedSince(task) {
  const since = task.run?.startedAt ?? "";
  return new Set((task.edits ?? []).filter((e) => e.at >= since).flatMap((e) => e.fields));
}
function notesEditedSection(task) {
  if (!editedSince(task).has("notes")) return [];
  const notes = notesSection(task);
  return notes.length ? notes : ["## Notes for the builder", "", "A person removed the notes for the builder after the builder started. Disregard them.", ""];
}
function editedSection(task) {
  const fields = editedSince(task);
  if (!fields.has("title") && !fields.has("brief")) return [];
  return [
    "## The task as a person edited it since",
    "",
    "A person changed the task after the builder started. Judge the change against this text, and say where the builder followed the older text.",
    "",
    `### ${task.title}`,
    "",
    task.brief.trim() || "_No details beyond the title._",
    ""
  ];
}
function reviewPrompt(i) {
  const system = [
    `You are the reviewer for ${i.task.id}. A builder agent made this change; you judge it before a person sees the pull request.`,
    "You can read files in this worktree with Read, Grep and Glob. You can't change anything, run commands, or ask questions.",
    "Judge it as a careful senior engineer would:",
    "- Does it do what the task asks? Go through each acceptance criterion in the task, and say whether it is met, with the file and line that meets it.",
    "- Does it follow the rules you're given, if there are any? Where two disagree, the later one wins: this repo's own rules over the others.",
    "- Did it change anything the task didn't ask for?",
    "- Do the tests actually exercise the change?",
    "- Did it add a skip, only or todo to a test (it.skip, xit, describe.skip, test.only, fit, it.todo, { skip: true }, t.skip(), t.todo())? Each is a finding with must: true, unless the task asks for it: a skipped test passes having checked nothing.",
    `- ${DUPLICATE_HELPER}`,
    "The builder's note is its own account of what landed, which numbers moved and what's still open. Check it against the diff rather than trust it, and say where it's wrong.",
    "Skip formatting and style: the checks cover those. A check that a person waived is settled; don't reopen it.",
    `Give "changes" only for problems that must be fixed before this merges, each as a finding with must: true. Lesser points are findings with must: false, and they don't block.`,
    "Be specific: the file, the line, what is wrong, and what to do instead.",
    "Give each finding a kind: a few words naming the kind of problem. Reuse one of the kinds you are given when it fits, so a finding that keeps coming back is seen."
  ].join("\n");
  const prompt = [
    `# Review ${i.task.id}: ${i.task.title}`,
    "",
    `Commit ${i.sha.slice(0, 7)} on the task's branch, against ${i.envName} (\`${i.envBranch}\`).`,
    "",
    "## The task, as the builder was given it",
    "",
    i.packet.trim(),
    "",
    ...editedSection(i.task),
    ...notesEditedSection(i.task),
    "## The checks on this commit",
    "",
    ...i.checks.length ? i.checks : ["- none recorded"],
    "",
    // What the builder said as it finished or blocked (D-106): its claim, for the reviewer to check.
    "## The builder's note",
    "",
    ...i.task.run?.note ? [`What the builder said ${i.task.run.note.ended === "blocked" ? "when it blocked" : "as it finished"}, in its own words. Check it against the diff.`, "", ...noteMarkdown(i.task.run.note)] : ["The builder left no note."],
    "",
    ...i.rules?.trim() ? ["## Rules", "", i.rules.trim(), ""] : [],
    ...i.kinds?.length ? ["## Kinds of finding earlier reviews named", "", ...i.kinds.map((k2) => `- ${k2}`), ""] : [],
    "## What changed",
    "",
    "```",
    i.stat.trim() || "(no files changed)",
    "```",
    "",
    i.diff.length > DIFF_MAX ? "The diff is too long to include here. Read the changed files listed above." : ["```diff", i.diff.trim(), "```"].join("\n")
  ].join("\n");
  return { system, prompt };
}
function parseReview(stdout) {
  let r;
  try {
    r = JSON.parse(stdout.trim().split("\n").filter(Boolean).pop() ?? "");
  } catch {
    throw new AccError("review", `The reviewer gave no result Claude Code could read: ${stdout.trim().slice(0, 200) || "(nothing)"}`);
  }
  const s = r.structured_output;
  if (r.is_error || !s || s.verdict !== "pass" && s.verdict !== "changes" || typeof s.summary !== "string") {
    throw new AccError("review", `The review didn't finish with a verdict (${r.subtype ?? "no result"}): ${String(r.result ?? "").slice(0, 300)}`);
  }
  const criteria = (Array.isArray(s.criteria) ? s.criteria : []).filter((c) => typeof c?.text === "string").map((c) => ({ text: c.text, met: c.met === true, evidence: String(c.evidence ?? "") }));
  const findings = (Array.isArray(s.findings) ? s.findings : []).filter((f) => typeof f?.message === "string").map((f) => ({
    message: f.message,
    must: f.must === true,
    ...typeof f.file === "string" && f.file ? { file: f.file } : {},
    ...Number.isInteger(f.line) ? { line: f.line } : {},
    ...typeof f.rule === "string" && f.rule ? { rule: f.rule } : {},
    ...typeof f.kind === "string" && f.kind.trim() ? { kind: f.kind.trim().slice(0, 80) } : {}
  }));
  const verdict = s.verdict === "pass" && findings.some((f) => f.must) ? "changes" : s.verdict;
  const client = typeof s.client === "string" && s.client.trim() ? { client: s.client.trim() } : {};
  return { verdict: { verdict, summary: s.summary, ...client, criteria, findings }, sessionId: typeof r.session_id === "string" ? r.session_id : null, costUsd: typeof r.total_cost_usd === "number" ? r.total_cost_usd : null };
}
var git4 = (run2, cwd, ...args) => run2("git", args, { cwd });
function baseRef(run2, root, branch) {
  return git4(run2, root, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`).code === 0 ? `origin/${branch}` : branch;
}
function review(paths, config, id, deps, opts = {}) {
  const { run: run2, now: now2 } = deps;
  const ledger = readLedger(paths.ledger);
  const task = ledger.tasks.find((t) => t.id === id);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  if (task.state !== "review") throw new AccError("refused", `${id} is ${task.state}. A review is for work that's in review: acc done, or a person, moves it there.`);
  const env = environmentByBranch(config, task.environment);
  if (!env) throw new AccError("review", `${id}'s environment "${task.environment}" isn't in the config.`);
  const branch = task.run?.branch;
  const worktree = task.run?.worktree;
  if (!branch) throw new AccError("review", `${id} has no branch to review.`);
  if (!worktree || !existsSync13(worktree)) throw new AccError("review", `${id}'s worktree isn't on disk any more, so there's nothing for the reviewer to read.`);
  const sha = git4(run2, paths.root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).stdout.trim();
  if (!sha) throw new AccError("review", `The branch ${branch} isn't in this clone.`);
  const missing = receiptHooks(paths, config, run2).missingGates(task);
  if (missing.length) throw new AccError("refused", `${id}'s checks aren't settled on ${sha.slice(0, 7)}: ${missing.join(", ")}. Run acc gate run in its worktree, or waive them, then review.`);
  const base = baseRef(run2, paths.root, env.branch);
  const diff = git4(run2, paths.root, "diff", "--no-color", "--find-renames", `${base}...${sha}`).stdout;
  const stat = git4(run2, paths.root, "diff", "--stat=120", "--find-renames", `${base}...${sha}`).stdout;
  const receipts = receiptsAt(paths, sha);
  const checks = Object.values(receipts).map(checkLine);
  const packetFile = join17(paths.packets, `${id}.md`);
  const packet = existsSync13(packetFile) ? readFileSync20(packetFile, "utf8") : [`# ${task.id}: ${task.title}`, "", task.brief, "", ...notesSection(task)].join("\n");
  const rules = rulesText(worktree, config.profile);
  const { system, prompt } = reviewPrompt({ task, config, envName: env.name, envBranch: env.branch, sha, packet, diff, stat, checks, rules, kinds: knownKinds(paths) });
  const sessionId = (deps.uuid ?? randomUUID2)();
  const name = sessionName({ project: config.project, key: id, title: task.title, role: "review" });
  mkdirSync18(paths.reviews, { recursive: true });
  const marker = runningPath2(paths, id);
  const startedAt = now2();
  writeFileSync18(marker, JSON.stringify({ sessionId, name, sha, startedAt: startedAt.toISOString(), pid: process.pid }));
  deps.onStart?.(sessionId, sha, name);
  const awake = holdAwake(process.pid, deps.awake);
  let out3;
  try {
    out3 = run2("claude", [
      "-p",
      "--session-id",
      sessionId,
      "--name",
      name,
      "--permission-mode",
      "dontAsk",
      ...agentArgs(config.agents.reviewer),
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(VERDICT_SCHEMA),
      "--append-system-prompt",
      system,
      "--allowedTools",
      "Read",
      "Grep",
      "Glob",
      "--disallowedTools",
      "Bash",
      "Edit",
      "Write",
      "NotebookEdit",
      "WebFetch",
      "WebSearch"
    ], { cwd: worktree, input: prompt, env: { ...deps.env, ACC_ROLE: "reviewer", ACC_TASK: id }, timeoutMs: 45 * 6e4 });
  } finally {
    awake?.release();
    rmSync11(marker, { force: true });
  }
  if (out3.timedOut) throw new AccError("review", `The review didn't finish within 45 minutes, so acc stopped it.`);
  if (out3.code === 127 && !out3.stdout) throw new AccError("review", `Claude Code didn't start: ${out3.stderr.trim().split("\n")[0] ?? "claude not found"}`);
  const parsed = parseReview(out3.stdout);
  const finished = now2();
  const verdict = {
    v: 1,
    task: id,
    sha,
    env: env.branch,
    ...parsed.verdict,
    sessionId: parsed.sessionId ?? sessionId,
    name,
    at: finished.toISOString(),
    durationMs: finished.getTime() - startedAt.getTime(),
    costUsd: parsed.costUsd
  };
  const file = reviewPath(paths, id, sha);
  writeFileSync18(`${file}.tmp`, JSON.stringify(verdict, null, 2) + "\n");
  renameSync11(`${file}.tmp`, file);
  const actor = opts.actor ?? "reviewer";
  const by = opts.by ?? `reviewer:${id}`;
  const moved = mutate(paths, now2, (l3, emit) => {
    const t = l3.tasks.find((x2) => x2.id === id);
    if (t.state !== "review") return null;
    if (verdict.verdict === "changes") {
      const req = { to: "rework", actor, by, reason: `Review asked for changes: ${verdict.summary}` };
      const problems = checkMove(l3, config, t, req, noGateHooks);
      if (problems.length) throw new AccError("move-refused", problems.join(" "));
      applyMove(t, req, emit, now2);
      return "rework";
    }
    if (t.autopilot?.failed) t.autopilot.failed = null;
    emit({ type: "task.updated", task: id, actor, by, data: { reviewed: { sha, verdict: verdict.verdict } } });
    return null;
  });
  return { verdict, moved };
}

// packages/core/src/holding.ts
var STARTING_STALE_MS = 10 * 6e4;
var startingNow = (task, now2) => {
  const s = task.held?.starting;
  return s && now2.getTime() - Date.parse(s.at) < STARTING_STALE_MS ? s : null;
};
function holdTask(paths, now2, id, opts, look2) {
  return mutate(paths, now2, (ledger, emit) => {
    const task = ledger.tasks.find((t) => t.id === id);
    if (!task) throw new AccError("no-task", `No task ${id}.`);
    if (task.state !== "todo") throw new AccError("move-refused", `Can't dispatch ${id}: it's ${task.state} now.`);
    const at2 = now2().toISOString();
    const kept = task.held && !task.held.failed ? task.held : null;
    const model = opts.model ?? task.held?.model;
    const effort = opts.effort ?? task.held?.effort;
    task.held = { at: kept?.at ?? at2, actor: kept?.actor ?? opts.actor, by: kept?.by ?? opts.by, waitsFor: look2.shares, first: look2.first, ...model ? { model } : {}, ...effort ? { effort } : {} };
    task.updatedAt = at2;
    emit({ type: "task.updated", task: id, actor: opts.actor, by: opts.by, data: { held: task.held } });
    return { held: true, task, waitsFor: look2.shares, first: look2.first };
  });
}
function claimHeld(paths, now2, id, opts) {
  return mutate(paths, now2, (ledger, emit) => {
    const t = ledger.tasks.find((x2) => x2.id === id);
    if (!t || t.state !== "todo" || !t.held || t.held.failed || startingNow(t, now2())) return false;
    t.held.starting = { at: now2().toISOString(), by: opts.by };
    emit({ type: "task.updated", task: id, actor: opts.actor, by: opts.by, data: { held: t.held } });
    return true;
  });
}
function releaseHeld(paths, now2, id, opts, reason) {
  mutate(paths, now2, (ledger, emit) => {
    const t = ledger.tasks.find((x2) => x2.id === id);
    if (!t || t.state !== "todo" || !t.held) return;
    const at2 = now2().toISOString();
    t.held = { ...t.held, starting: null, ...reason ? { failed: { reason, at: at2, by: opts.by } } : {} };
    t.updatedAt = at2;
    emit({ type: "task.updated", task: id, actor: opts.actor, by: opts.by, data: { held: t.held } });
  });
}

// packages/core/src/limits.ts
import { createHash as createHash2 } from "node:crypto";
import { mkdirSync as mkdirSync19, readdirSync as readdirSync8, readFileSync as readFileSync21, realpathSync as realpathSync2, renameSync as renameSync12, rmSync as rmSync12, statSync as statSync6, writeFileSync as writeFileSync19 } from "node:fs";
import { basename as basename4, dirname as dirname7, join as join18 } from "node:path";
var MAX_AGENTS = 16;
function setAgentsMax(configFile, n) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_AGENTS) throw new AccError("usage", `A project's builder cap is a whole number from 1 to ${MAX_AGENTS}.`);
  writeJsonKey(configFile, ["agents", "max"], n);
  return n;
}
function configSets(configFile, key) {
  try {
    let v = JSON.parse(readFileSync21(configFile, "utf8"));
    for (const k2 of key) v = v && typeof v === "object" && Object.hasOwn(v, k2) ? v[k2] : void 0;
    return v !== void 0;
  } catch {
    return false;
  }
}
var agentsMaxSet = (configFile) => configSets(configFile, ["agents", "max"]);
function gateNames(configFile, names3, what) {
  const { config } = loadConfig(configFile);
  const known = gatesFor(config).map((g) => g.name).filter((n) => n !== STRAY_FILES);
  const list = [...new Set(names3.map((n) => n.trim()).filter(Boolean))];
  if (list.includes(STRAY_FILES)) throw new AccError("usage", `${STRAY_FILES} is required unless "strayFiles": { "required": false } turns it off in .acc/config.json, so it isn't named here. ${what} from: ${known.join(", ") || "none yet"}.`);
  const unknown2 = list.filter((n) => !known.includes(n));
  if (unknown2.length) {
    throw new AccError("usage", `${unknown2.join(", ")} ${unknown2.length === 1 ? "isn't a check" : "aren't checks"} this project has. ${what} from: ${known.join(", ") || 'none yet. Add commands under "gates.commands" in .acc/config.json'}.`);
  }
  return list;
}
function setRequiredGates(configFile, names3) {
  const list = gateNames(configFile, names3, "Name the required checks");
  if (!list.length) throw new AccError("usage", "Name at least one check: acc gate required <name>\u2026");
  writeJsonKey(configFile, ["gates", "required"], list);
  return list;
}
function setBuilderGates(configFile, names3) {
  if (names3 === null) {
    writeJsonKey(configFile, ["gates", "builder"], void 0);
    return null;
  }
  const list = gateNames(configFile, names3, "Name builders' checks");
  if (!list.length) throw new AccError("usage", "Name at least one check, or say --none: acc gate builder <name>\u2026 | --none");
  writeJsonKey(configFile, ["gates", "builder"], list);
  return list;
}
var MAX_MACHINE_AGENTS = 64;
var agentCount = (v) => Number.isInteger(v) && v >= 1 ? Math.min(MAX_MACHINE_AGENTS, v) : null;
function machineAgents(env = process.env) {
  return agentCount(readMachineKey("agents", env));
}
function setMachineAgents(n, env = process.env) {
  if (n !== null && (!Number.isInteger(n) || n < 1 || n > MAX_MACHINE_AGENTS)) {
    throw new AccError("usage", `This machine's total is a whole number from 1 to ${MAX_MACHINE_AGENTS}, or --none for no total.`);
  }
  setMachineKey("agents", n ?? void 0, env);
  return n;
}
var ledgersDir = (env = process.env) => machineDir(env) ? join18(machineDir(env), "ledgers") : null;
function realLedger(file) {
  try {
    return join18(realpathSync2(dirname7(file)), basename4(file));
  } catch {
    return file;
  }
}
var entryName = (ledger) => `${createHash2("sha256").update(ledger).digest("hex").slice(0, 16)}.json`;
function registerLedger(ledger, project2, env = process.env) {
  const dir = ledgersDir(env);
  if (!dir) return;
  const path = realLedger(ledger);
  const file = join18(dir, entryName(path));
  try {
    statSync6(file);
    return;
  } catch {
  }
  try {
    mkdirSync19(dir, { recursive: true });
    writeFileSync19(`${file}.${process.pid}.tmp`, JSON.stringify({ ledger: path, project: project2 }) + "\n");
    renameSync12(`${file}.${process.pid}.tmp`, file);
  } catch {
  }
}
function machineRepos(env = process.env, { except, prune = false } = {}) {
  const dir = ledgersDir(env);
  if (!dir) return [];
  let names3 = [];
  try {
    names3 = readdirSync8(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const skip3 = except ? realLedger(except) : null;
  const out3 = [];
  for (const n of names3.sort()) {
    let entry;
    try {
      entry = JSON.parse(readFileSync21(join18(dir, n), "utf8"));
    } catch {
      continue;
    }
    if (typeof entry.ledger !== "string" || entry.ledger === skip3) continue;
    let ledger;
    try {
      statSync6(entry.ledger);
    } catch {
      if (prune) rmSync12(join18(dir, n), { force: true });
      continue;
    }
    try {
      ledger = readLedger(entry.ledger);
    } catch {
      continue;
    }
    out3.push({ project: typeof entry.project === "string" ? entry.project : basename4(dirname7(dirname7(dirname7(entry.ledger)))), ledger: entry.ledger, running: builders(ledger, "") });
  }
  return out3;
}
function machineLoad(paths, project2, env = process.env) {
  registerLedger(paths.ledger, project2, env);
  const max = machineAgents(env);
  if (max === null) return { max, elsewhere: 0 };
  return { max, elsewhere: machineRepos(env, { except: paths.ledger, prune: true }).reduce((n, r) => n + r.running, 0) };
}
var buildersAre = (n) => `${n} ${n === 1 ? "builder is" : "builders are"}`;
var machineCapWords = (n, max) => `${buildersAre(n)} running on this machine, across every repo, and its total is ${max} (acc machine agents).`;
function machineCapProblem(ledger, except, machine) {
  if (!machine || machine.max === null) return null;
  const n = builders(ledger, except) + machine.elsewhere;
  return n >= machine.max ? machineCapWords(n, machine.max) : null;
}

// packages/core/src/dispatch.ts
function slugify(title, max = 40) {
  const words4 = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  let out3 = "";
  for (const w of words4) {
    const next = out3 ? `${out3}-${w}` : w;
    if (next.length > max) break;
    out3 = next;
  }
  return out3 || "task";
}
var taskBranch = (task) => `task/${task.id}-${slugify(task.title)}`;
function mainCheckout(run2, cwd) {
  const r = run2("git", ["worktree", "list", "--porcelain"], { cwd });
  const first = /^worktree (.+)$/m.exec(r.stdout)?.[1];
  if (r.code !== 0 || !first) throw new AccError("not-a-repo", `${cwd} isn't inside a git repository.`);
  return first;
}
function worktreeRoot(config, main2) {
  const root = config.worktrees.root;
  if (!root) return join19(main2, ".claude", "worktrees");
  return isAbsolute4(root) ? root : resolve2(main2, root);
}
var isClaudeWorktree = (main2, wt2) => wt2.startsWith(join19(main2, ".claude", "worktrees") + sep2);
function claudeStatePath(env = process.env) {
  return env.CLAUDE_CONFIG_DIR ? join19(env.CLAUDE_CONFIG_DIR, ".claude.json") : join19(env.HOME || homedir5(), ".claude.json");
}
function isTrusted(folder, env = process.env) {
  let state;
  try {
    state = JSON.parse(readFileSync22(claudeStatePath(env), "utf8"));
  } catch {
    return false;
  }
  const keys = /* @__PURE__ */ new Set([folder, folder.normalize("NFC")]);
  try {
    keys.add(realpathSync3(folder));
  } catch {
  }
  return [...keys].some((k2) => state.projects?.[k2]?.hasTrustDialogAccepted === true);
}
var git5 = (run2, cwd, ...args) => run2("git", args, { cwd });
function ensureWorktree(run2, main2, wt2, branch, env) {
  if (existsSync14(wt2)) {
    const inside2 = git5(run2, wt2, "rev-parse", "--abbrev-ref", "HEAD");
    if (inside2.code !== 0) throw new AccError("dispatch", `${wt2} exists but isn't a git worktree. Move it aside and dispatch again.`);
    if (inside2.stdout.trim() !== branch) throw new AccError("dispatch", `${wt2} is on ${inside2.stdout.trim()}, not ${branch}.`);
    return true;
  }
  mkdirSync20(dirname8(wt2), { recursive: true });
  git5(run2, main2, "fetch", "--quiet", "origin", env.branch);
  const hasLocal = git5(run2, main2, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).code === 0;
  let r;
  if (hasLocal) r = git5(run2, main2, "worktree", "add", wt2, branch);
  else {
    const remote = `refs/remotes/origin/${env.branch}`;
    const base = git5(run2, main2, "rev-parse", "--verify", "--quiet", remote).code === 0 ? `origin/${env.branch}` : env.branch;
    if (git5(run2, main2, "rev-parse", "--verify", "--quiet", base).code !== 0) throw new AccError("dispatch", `There's no "${env.branch}" branch to start from.`);
    r = git5(run2, main2, "worktree", "add", "--no-track", "-b", branch, wt2, base);
  }
  if (r.code !== 0) throw new AccError("dispatch", `git couldn't create the worktree: ${r.stderr.trim()}`);
  return false;
}
function setupWorktree(run2, config, env, main2, wt2) {
  if (config.profile === "salesforce" && env.org) {
    mkdirSync20(join19(wt2, ".sf"), { recursive: true });
    writeFileSync20(join19(wt2, ".sf", "config.json"), JSON.stringify({ "target-org": env.org }, null, 2) + "\n");
  }
  if (existsSync14(join19(main2, "node_modules")) && !existsSync14(join19(wt2, "node_modules"))) {
    symlinkSync(join19(main2, "node_modules"), join19(wt2, "node_modules"), "dir");
    excludeEverywhere(run2, main2, "node_modules");
  }
  for (const cmd of config.worktrees.setup) {
    const r = run2("sh", ["-c", cmd], { cwd: wt2 });
    if (r.code !== 0) throw new AccError("dispatch", `Setup command failed in the worktree: ${cmd}
${(r.stderr || r.stdout).trim()}`);
  }
}
function excludeEverywhere(run2, main2, pattern) {
  const common = run2("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: main2 }).stdout.trim();
  if (!common) return;
  const file = join19(common, "info", "exclude");
  const text = existsSync14(file) ? readFileSync22(file, "utf8") : "";
  if (text.split("\n").some((l3) => l3.trim() === pattern)) return;
  mkdirSync20(dirname8(file), { recursive: true });
  writeFileSync20(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}# Added by acc: worktrees link node_modules from the main checkout.
${pattern}
`);
}
function findSession(run2, cwd, name, waitMs, o = {}) {
  const until = Date.now() + waitMs;
  let found = null;
  const ours = (x2) => x2.name === name && x2.kind === "background" && (o.since === void 0 || (x2.startedAt ?? 0) >= o.since) && (!o.places || !x2.cwd || o.places.some((p) => samePath(x2.cwd, p)));
  do {
    const r = run2("claude", ["agents", "--json"], { cwd, timeoutMs: 2e4 });
    try {
      const list = JSON.parse(r.stdout);
      const s = list.filter(ours).sort((a2, b) => (b.startedAt ?? 0) - (a2.startedAt ?? 0))[0];
      if (s) {
        found = { bgId: s.id ?? null, sessionId: s.sessionId ?? null, pid: Number.isInteger(s.pid) && s.pid > 0 ? s.pid : null };
        if (found.pid) return found;
      }
    } catch {
    }
    if (Date.now() < until) sleep(500);
  } while (Date.now() < until);
  return found ?? { bgId: null, sessionId: null, pid: null };
}
var LAUNCH_SLACK_MS = 5e3;
function builderPlace(config, chosen) {
  return chosen ?? config?.agents?.cloud?.default ?? "local";
}
function builderModel(task, config, chosen) {
  const picked = chosen ?? (task.run?.modelPicked ? task.run.model : void 0);
  return picked ? { model: picked, picked: true } : { model: modelOf(config.agents.builder), picked: false };
}
function dispatch(paths, config, id, deps, opts) {
  const { run: run2, now: now2 } = deps;
  const steps2 = deps.steps ?? NO_STEPS;
  steps2.start("task", "Check the task");
  if (opts.model !== void 0) checkModelName(opts.model);
  if (opts.effort !== void 0) checkEffortPick(opts.effort);
  const before = readLedger(paths.ledger);
  const found = before.tasks.find((t) => t.id === id);
  if (!found) throw new AccError("no-task", `No task ${id}.`);
  const { model, picked } = builderModel(found, config, opts.model ?? found.held?.model);
  const { effort, picked: effortPicked, keep, dropped } = dispatchEffort(found, config, model, { effort: opts.effort, modelPicked: opts.model !== void 0 });
  checkModelEffort(model, effort, effortFixWords(id, effortPicked, model));
  const effortDropped = dropped ? { effortDropped: dropped } : {};
  const where = builderPlace(config, opts.where);
  if (where === "cloud" && opts.foreground) throw new AccError("usage", "--cloud starts the builder in a cloud session, so it can't run in this terminal: give --cloud or --foreground, not both.");
  if (where === "cloud") {
    const unmet = cloudNeeds(config, run2, deps.env).filter((n) => !n.ok);
    if (unmet.length) throw new AccError("cloud-unavailable", `Can't dispatch ${id} to the cloud:
- ${unmet.map((n) => `${n.label}: ${n.fix}`).join("\n- ")}`);
  }
  const req = { to: "running", actor: opts.actor, by: opts.by, where };
  const machine = where === "cloud" ? null : machineLoad(paths, config.project, deps.env);
  const overMachine = (l3) => {
    const p = machineCapProblem(l3, id, machine);
    return p ? [p] : [];
  };
  const problems = [...checkMove(before, config, found, req, noGateHooks), ...overMachine(before)];
  if (problems.length) throw new AccError("move-refused", `Can't dispatch ${id}:
- ${problems.join("\n- ")}`);
  const held = analysisProblems(paths, config, found);
  if (held.length && !(opts.withoutAnalysis && opts.actor === "human")) throw new AccError("move-refused", `Can't dispatch ${id}:
- ${held.join("\n- ")}`);
  const starting = opts.fromHold ? null : startingNow(found, now2());
  if (starting) throw new AccError("move-refused", `Can't dispatch ${id}: ${starting.by} is starting it.`);
  steps2.done("task");
  let shares = opts.fromHold?.shares ?? [];
  let overrode = false;
  const planned = found.state === "todo" && !opts.fromHold ? plannedFiles(readAnalysis(paths, id), paths.root) : null;
  const filesLabel = "Check the files in flight";
  if (planned) {
    steps2.start("files", filesLabel);
    const look2 = startLook(paths, config, before, run2, id, { fetch: true, files: planned });
    shares = look2.shares;
    if (waits(look2)) {
      if (!(opts.anyway && opts.actor === "human")) {
        const held2 = holdTask(paths, now2, id, { ...opts, effort: keep }, look2);
        steps2.done("files", `It waits for ${held2.waitsFor.map((w) => w.task).join(", ")}`);
        return { ...held2, ...effortDropped };
      }
      overrode = true;
    }
    steps2.done("files", overrode ? "Started anyway, by a person" : shares.length ? `It shares files with ${[...new Set(shares.map((s) => s.task))].join(", ")}` : void 0);
  } else {
    steps2.skip("files", filesLabel, opts.fromHold ? "Weighed when it began to wait" : found.state !== "todo" ? "Its branch already holds its change" : "Its analysis names no files");
  }
  const claim = !opts.fromHold && !!found.held && !found.held.failed;
  if (claim && !claimHeld(paths, now2, id, opts)) throw new AccError("move-refused", `Can't dispatch ${id}: it's being started already.`);
  try {
    steps2.start("worktree", "Make the worktree");
    const env = environmentByBranch(config, found.environment);
    if (!env) throw new AccError("dispatch", `${id}'s environment "${found.environment}" isn't in the config.`);
    const main2 = mainCheckout(run2, paths.root);
    const wt2 = join19(worktreeRoot(config, main2), found.id);
    const enter = isClaudeWorktree(main2, wt2);
    const launchDir = enter ? main2 : wt2;
    if (where === "local" && !opts.foreground && enter && !isTrusted(main2, deps.env)) {
      throw new AccError("not-trusted", `Claude Code doesn't trust ${main2} yet, so it won't start a background agent there. Run \`claude\` once in that folder, accept the trust prompt, then type /exit and dispatch again.`);
    }
    const branch = found.run?.branch ?? taskBranch(found);
    const reused = ensureWorktree(run2, main2, wt2, branch, env);
    steps2.done("worktree", reused ? `Reused ${basename5(wt2)}` : basename5(wt2));
    steps2.step("setup", "Set up the worktree", () => setupWorktree(run2, config, env, main2, wt2));
    steps2.start("packet", "Write the builder's instructions");
    const rules = rulesText(wt2, config.profile);
    const rework = found.state === "rework";
    const cause = rework ? reworkCause(found) : null;
    const head = cause === "checks" || cause === "queue" ? git5(run2, paths.root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).stdout.trim() : "";
    const packet = renderPacket({
      task: found,
      config,
      env,
      worktree: wt2,
      branch,
      rules,
      environmentSpecific: readList(wt2, config.environmentSpecific),
      enterWorktree: where === "local" && enter && !opts.foreground,
      cloud: where === "cloud",
      // The Mac's acc path names the home folder, and means nothing in the cloud (GH-69): only a local builder gets it.
      ...where === "local" ? { accPath: join19(deps.accBinDir, "acc") } : {},
      review: rework ? latestVerdict(paths, found.id) : null,
      analysis: readAnalysis(paths, found.id),
      checks: head && cause === "checks" ? readChecksReport(paths, found.id, head) : null,
      queue: head && cause === "queue" ? readQueueReport(paths, found.id, head) : null,
      // The notes the tasks it builds on left (D-106).
      deps: found.deps.flatMap((d) => before.tasks.filter((t) => t.id === d))
    });
    mkdirSync20(paths.packets, { recursive: true });
    const packetPath = join19(paths.packets, `${found.id}.md`);
    writeFileSync20(packetPath, packet);
    steps2.done("packet");
    const settings = JSON.stringify(builderSettings(found, config, deps.accBinDir, deps.env.PATH ?? "", deps.accCommand));
    const prompt = `Read your task instructions below and do the task.

${packet}`;
    const n = (found.run?.n ?? (found.run ? 1 : 0)) + 1;
    const name = sessionName({ project: config.project, key: found.id, title: found.title, role: "builder", n });
    const base = ["--name", name, "--permission-mode", config.agents.permissionMode, ...agentArgs({ ...config.agents.builder, model, effort }), "--settings", settings];
    const record2 = (bgId2, sessionId2, cloud = null) => steps2.step("record", "Record the run", () => mutate(paths, now2, (ledger, emit) => {
      const task = ledger.tasks.find((t) => t.id === id);
      const again = [...checkMove(ledger, config, task, req, noGateHooks), ...overMachine(ledger)];
      if (again.length) throw new AccError("move-refused", `Can't dispatch ${id}:
- ${again.join("\n- ")}`);
      const hold = task.held;
      const data = {
        ...opts.cause ? { cause: opts.cause } : {},
        ...shares.length ? { shares } : {},
        ...overrode ? { anyway: true } : {},
        ...opts.fromHold && hold ? { held: { at: hold.at, by: hold.by, waitedFor: hold.waitsFor.map((w) => w.task) } } : {}
      };
      applyMove(task, { ...req, reason: reused ? `re-dispatched in ${basename5(wt2)}` : null }, emit, now2, data);
      const last = task.run ? { before: task.run.note ?? null } : {};
      const at2 = now2().toISOString();
      const place2 = cloud ? { where: "cloud", cloud: { sessionId: cloud.sessionId, url: cloud.url, firedAt: at2, head: cloud.head, lastPushAt: at2 } } : {};
      task.run = { worktree: wt2, branch, startedAt: at2, model, ...picked ? { modelPicked: true } : {}, ...effort ? { effort } : {}, ...effortPicked ? { effortPicked: true } : {}, ...bgId2 ? { bgId: bgId2 } : {}, ...sessionId2 ? { sessionId: sessionId2 } : {}, name, n, ...shares.length ? { shares } : {}, ...place2, ...last };
      emit({ type: "task.updated", task: id, actor: opts.actor, by: opts.by, data: { run: task.run } });
      return task;
    }));
    if (where === "cloud") {
      steps2.start("guard", "Check the push guard");
      const gitEnv = { ...deps.env, GIT_TERMINAL_PROMPT: "0" };
      const head0 = git5(run2, main2, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD").stdout.trim();
      const base2 = head0.startsWith("origin/") ? head0.slice("origin/".length) : env.branch;
      fetchBranches(run2, main2, [base2], gitEnv);
      const baseRef2 = git5(run2, main2, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base2}`).code === 0 ? `refs/remotes/origin/${base2}` : `refs/heads/${base2}`;
      for (const ref of [baseRef2, `refs/heads/${branch}`]) {
        const committed = guardCommitted(run2, main2, ref);
        if (!committed.ok) throw new AccError("cloud-unguarded", `Can't dispatch ${id} to the cloud: the push guard isn't committed where the cloud session would load it. ${committed.why} The worktree is kept at ${wt2}, and nothing was pushed or started.`);
      }
      const warnings = protectionWarnings(environmentProtection(run2, config.github.repo, config.github.account, [.../* @__PURE__ */ new Set([base2, env.branch])], deps.env));
      steps2.done("guard", warnings.length ? `${warnings.length} warning(s) about GitHub's rules` : void 0);
      steps2.start("push", "Push the branch");
      const push = run2("git", ["push", "--set-upstream", "origin", `${branch}:${branch}`], { cwd: main2, env: gitEnv, timeoutMs: PUSH_TIMEOUT_MS });
      if (push.code !== 0) throw new AccError("dispatch", `git push refused ${branch}: ${(push.stderr || push.stdout).trim().split("\n").slice(-2).join(" ")}. The worktree is kept at ${wt2}, and nothing was started.`);
      steps2.done("push");
      const head2 = git5(run2, main2, "rev-parse", `refs/heads/${branch}`).stdout.trim();
      const text = cloudText({ task: found, config, env, branch, packet, checks: cloudChecks(config, env) });
      const fired = steps2.step("start", "Start the cloud session", () => fireRoutine(paths, run2, config.agents.cloud.routine, readCloudToken(run2, config.github.repo, deps.env), text, deps.env));
      const task = record2(null, null, { ...fired, head: head2 });
      return { held: false, task, worktree: wt2, branch, reused, packetPath, bgId: null, sessionId: null, name, shares, where, cloud: fired, ...warnings.length ? { warnings } : {}, ...effortDropped };
    }
    if (opts.foreground) {
      const task = record2(null, null);
      const awake = holdAwake(process.pid, deps.awake);
      steps2.start("start", "Run the builder in this terminal");
      try {
        spawnSync3("claude", [...base, prompt], { cwd: wt2, stdio: "inherit", env: deps.env });
      } finally {
        awake?.release();
      }
      steps2.done("start");
      return { held: false, task, worktree: wt2, branch, reused, packetPath, bgId: null, sessionId: null, name, shares, where, ...effortDropped };
    }
    const since = Date.now() - LAUNCH_SLACK_MS;
    steps2.start("start", "Start the builder");
    const launched = run2("claude", ["--bg", ...base, prompt], { cwd: launchDir, env: deps.env, timeoutMs: 6e4 });
    if (launched.code !== 0) throw new AccError("dispatch", `Claude Code didn't start the agent: ${(launched.stderr || launched.stdout).trim().split("\n")[0]}. The worktree is kept at ${wt2}.`);
    const { bgId, sessionId, pid } = findSession(run2, launchDir, name, deps.findSessionMs ?? 8e3, { since, places: [launchDir, wt2] });
    steps2.done("start", bgId ? `Background session ${bgId}` : "Its session wasn't found yet");
    try {
      const task = record2(bgId, sessionId);
      if (pid) keepAwakeFor(paths, id, pid, deps.awake);
      return { held: false, task, worktree: wt2, branch, reused, packetPath, bgId, sessionId, name, shares, where, ...effortDropped };
    } catch (e) {
      if (bgId) run2("claude", ["stop", bgId], { cwd: wt2 });
      throw e;
    }
  } catch (e) {
    if (claim) releaseHeld(paths, now2, id, opts, null);
    throw e;
  }
}
function cleanup(paths, config, id, run2, now2) {
  const ledger = readLedger(paths.ledger);
  const task = ledger.tasks.find((t) => t.id === id);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  const wt2 = task.run?.worktree ?? null;
  if (!wt2 || !existsSync14(wt2)) return { removed: false, reasons: ["It has no worktree on disk."], worktree: wt2 };
  const reasons = [];
  if (task.state === "running") reasons.push(`${id} is still running. Abandon it or let it finish first.`);
  const dirty = git5(run2, wt2, "status", "--porcelain").stdout.trim();
  if (dirty) reasons.push(`The worktree has ${dirty.split("\n").length} uncommitted change(s).`);
  const env = environmentByBranch(config, task.environment);
  const branch = task.run?.branch;
  if (branch && env) {
    const main3 = mainCheckout(run2, paths.root);
    git5(run2, main3, "fetch", "--quiet", "origin", env.branch);
    const target = git5(run2, main3, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${env.branch}`).code === 0 ? `origin/${env.branch}` : env.branch;
    const ahead = Number(git5(run2, main3, "rev-list", "--count", `${target}..${branch}`).stdout.trim() || "0");
    const merged = git5(run2, main3, "merge-base", "--is-ancestor", branch, target).code === 0;
    if (ahead > 0 && !merged) reasons.push(`${branch} has ${ahead} commit(s) that aren't in ${target} yet.`);
  }
  if (reasons.length) return { removed: false, reasons, worktree: wt2 };
  const main2 = mainCheckout(run2, paths.root);
  const r = git5(run2, main2, "worktree", "remove", wt2);
  if (r.code !== 0) return { removed: false, reasons: [`git refused: ${r.stderr.trim()}`], worktree: wt2 };
  if (branch) git5(run2, main2, "branch", "-D", branch);
  mutate(paths, now2, (l3, emit) => {
    const t = l3.tasks.find((x2) => x2.id === id);
    if (t.run) delete t.run.worktree;
    emit({ type: "task.updated", task: id, actor: "human", by: "acc cleanup", data: { worktreeRemoved: wt2 } });
  });
  return { removed: true, reasons: [], worktree: wt2 };
}

// packages/core/src/refresh.ts
var short = (sha) => sha.slice(0, 7);
var lastLines = (r) => (r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ");
function appendOnlyMerge(common, ours, theirs) {
  if (!ours.startsWith(common) || !theirs.startsWith(common)) return null;
  let start = common;
  let mine = ours.slice(common.length);
  let added = theirs.slice(common.length);
  if (start && !start.endsWith("\n") && (mine || added)) {
    if ([mine, added].some((t) => t && !t.startsWith("\n"))) return null;
    start += "\n";
    mine = mine.slice(1);
    added = added.slice(1);
  }
  if (mine === added) return start + mine;
  if (added.startsWith(mine)) return start + added;
  if (mine.startsWith(added)) return start + mine;
  return start + added + (added && mine && !added.endsWith("\n") ? "\n" : "") + mine;
}
function unmerged(run2, wt2) {
  const out3 = /* @__PURE__ */ new Map();
  for (const entry of run2("git", ["ls-files", "-u", "-z"], { cwd: wt2 }).stdout.split("\0")) {
    const m = /^(\d+) ([0-9a-f]+) ([123])\t(.+)$/s.exec(entry);
    if (!m) continue;
    const stages = out3.get(m[4]) ?? /* @__PURE__ */ new Map();
    stages.set(Number(m[3]), { mode: m[1], sha: m[2] });
    out3.set(m[4], stages);
  }
  return out3;
}
var isText = (s) => !s.includes("\0") && !s.includes("\uFFFD");
function resolveWith(run2, wt2, mergeBase, path, stages, merge, added = false) {
  const git10 = (...args) => run2("git", args, { cwd: wt2 });
  const [common, ours, theirs] = [stages.get(1), stages.get(2), stages.get(3)];
  if (!common && !added || !ours || !theirs) return false;
  if (![common, ours, theirs].every((s) => !s || s.mode === "100644" || s.mode === "100755")) return false;
  const at2 = (ref) => git10("rev-parse", "--verify", "--quiet", `${ref}:${path}`).stdout.trim();
  if (at2(mergeBase) !== (common?.sha ?? "") || at2("HEAD") !== ours.sha || at2("MERGE_HEAD") !== theirs.sha) return false;
  const blobs = [common, ours, theirs].map((s) => s ? git10("cat-file", "blob", s.sha) : { code: 0, stdout: "", stderr: "" });
  if (blobs.some((b) => b.code !== 0 || !isText(b.stdout))) return false;
  const merged = merge(blobs[0].stdout, blobs[1].stdout, blobs[2].stdout);
  if (merged === null) return false;
  const blob = run2("git", ["hash-object", "-w", "--stdin"], { cwd: wt2, input: merged });
  if (blob.code !== 0) return false;
  if (git10("update-index", "--cacheinfo", `${ours.mode},${blob.stdout.trim()},${path}`).code !== 0) return false;
  return git10("checkout", "--", path).code === 0;
}
function resolvedWords(resolved, verb = "kept", file = (f) => f) {
  const added = resolved.filter((f) => f !== FLOORS_FILE);
  return [
    ...added.length ? [`${verb} both sides' additions to ${added.map(file).join(", ")}`] : [],
    ...resolved.includes(FLOORS_FILE) ? [`${verb} the better of each ratchet's floors in ${file(FLOORS_FILE)}`] : []
  ].join(", and ");
}
var MergeConflict = class extends AccError {
  files;
  constructor(message2, files) {
    super("refresh", message2);
    this.files = files;
  }
};
var CheckFailure = class extends AccError {
  failed;
  constructor(message2, failed) {
    super("refresh", message2);
    this.failed = failed;
  }
};
var gitIn = (run2, wt2) => (...args) => run2("git", args, { cwd: wt2 });
var midMerge = (run2, wt2) => gitIn(run2, wt2)("rev-parse", "--verify", "--quiet", "MERGE_HEAD").code === 0;
var dirtyIn = (run2, wt2, untracked = true) => gitIn(run2, wt2)("status", "--porcelain", ...untracked ? [] : ["--untracked-files=no"]).stdout.trim() !== "";
function mergePlace(paths, config, task, run2) {
  const id = task.id;
  const env = environmentByBranch(config, task.environment);
  if (!env) throw new AccError("refresh", `${id}'s environment "${task.environment}" isn't in the config.`);
  const branch = task.run?.branch;
  const wt2 = task.run?.worktree;
  if (!branch) throw new AccError("refresh", `${id} has no branch.`);
  if (!wt2 || !existsSync15(wt2)) throw new AccError("refresh", `${id}'s worktree isn't on disk any more, so there's nowhere to merge ${env.branch} in.`);
  if (samePath(wt2, mainCheckout(run2, paths.root))) throw new AccError("refresh", `${id}'s worktree is the main checkout. Autopilot merges only in a task's own worktree.`);
  const git10 = gitIn(run2, wt2);
  const on = git10("symbolic-ref", "--quiet", "--short", "HEAD").stdout.trim();
  if (on !== branch) throw new AccError("refresh", `${wt2} is on ${on || "a detached commit"}, not ${branch}.`);
  if (dirtyIn(run2, wt2) || midMerge(run2, wt2)) throw new AccError("refresh", `${id}'s worktree has changes nobody committed, so autopilot leaves it alone.`);
  return { id, env, branch, wt: wt2, from: git10("rev-parse", "HEAD").stdout.trim() };
}
function fetchBase(paths, place2, run2, env) {
  const { branch, from } = place2;
  if (!fetchBranches(run2, paths.root, [place2.env.branch, branch], { ...env, GIT_TERMINAL_PROMPT: "0" })) {
    throw new AccError("refresh", `Couldn't fetch ${place2.env.branch} and ${branch} from origin.`);
  }
  if (gitIn(run2, place2.wt)("merge-base", "--is-ancestor", `refs/remotes/origin/${branch}`, from).code !== 0) {
    throw new AccError("refresh", `origin's ${branch} has commits this clone's branch doesn't, perhaps from GitHub. Bring them in by hand.`);
  }
}
var merging = (config, run2, wt2) => {
  const who = config.commitIdentity ? ["-c", `user.name=${config.commitIdentity.name}`, "-c", `user.email=${config.commitIdentity.email}`] : [];
  return (...args) => run2("git", ["-c", "rerere.enabled=false", ...who, ...args], { cwd: wt2 });
};
function putBack(config, place2, run2, how) {
  const { wt: wt2, from } = place2;
  merging(config, run2, wt2)(...how);
  const back = gitIn(run2, wt2)("rev-parse", "HEAD").stdout.trim() === from && !dirtyIn(run2, wt2, false) && !midMerge(run2, wt2);
  return back ? `The branch is as it was, at ${short(from)}, and nothing was pushed.` : `Putting the branch back at ${short(from)} didn't work: look at ${wt2} before anything else.`;
}
var undoMerge = (config, place2, run2) => putBack(config, place2, run2, ["reset", "--hard", place2.from]);
function mergeBaseIn(config, place2, run2) {
  const { env, branch, wt: wt2 } = place2;
  const git10 = gitIn(run2, wt2);
  const merge = merging(config, run2, wt2);
  const merged = merge("merge", "--no-ff", "--no-commit", `origin/${env.branch}`);
  if (!midMerge(run2, wt2)) {
    if (merged.code === 0) return null;
    throw new AccError("refresh", `git wouldn't merge ${env.branch} in: ${lastLines(merged)} ${putBack(config, place2, run2, ["reset", "--merge"])}`);
  }
  const appendOnly = config.autopilot?.appendOnly ?? [];
  const mergeBase = git10("merge-base", "HEAD", "MERGE_HEAD").stdout.trim();
  const resolved = [];
  const left = [];
  for (const [path, stages] of unmerged(run2, wt2)) {
    if (path === FLOORS_FILE ? resolveWith(run2, wt2, mergeBase, path, stages, mergeFloors, true) : listed(path, appendOnly) && resolveWith(run2, wt2, mergeBase, path, stages, appendOnlyMerge)) resolved.push(path);
    else left.push(path);
  }
  if (left.length) throw new MergeConflict(`Conflicts with ${env.branch} that autopilot can't resolve: ${left.join(", ")}. ${putBack(config, place2, run2, ["merge", "--abort"])}`, left);
  if (merged.code !== 0 && !resolved.length) throw new AccError("refresh", `git couldn't merge ${env.branch} in: ${lastLines(merged)} ${putBack(config, place2, run2, ["merge", "--abort"])}`);
  const message2 = [`Merge ${env.branch} into ${branch}`, ...resolved.length ? ["", `Autopilot ${resolvedWords(resolved)}.`] : []].join("\n");
  const commit = merge("commit", "-m", message2);
  if (commit.code !== 0) throw new AccError("refresh", `The merge commit was refused: ${lastLines(commit)} ${putBack(config, place2, run2, ["merge", "--abort"])}`);
  return { sha: git10("rev-parse", "HEAD").stdout.trim(), resolved };
}
function checkCommit(paths, config, place2, sha, gates, deps) {
  const { env, wt: wt2, from } = place2;
  const { run: run2 } = deps;
  const what = sha === from ? "Its checks" : `Merged ${env.branch} in, but its checks`;
  let failed = [];
  try {
    if (gates.length) {
      const ran = runGates(repoPaths(wt2, run2), config, env, gates, priorTests(paths, config, from), { run: run2, now: deps.now, slots: deps.slots, task: place2.id, onWait: deps.onWait, onStart: deps.onStart, waivedOn: from });
      failed = ran.results.filter((r) => !r.recorded || !satisfies(r.receipt));
    }
  } catch (e) {
    const err = e;
    throw new AccError(err.code ?? "refresh", `${what} couldn't run: ${err.message} ${putBack(config, place2, run2, ["reset", "--hard", from])}`);
  }
  if (failed.length) {
    const said2 = failed.map((r) => `${r.gate} ${!r.recorded ? "wasn't recorded" : r.status === "fail" ? "failed" : r.status === "hold" ? "needs a person" : "couldn't run"}: ${r.summary.replace(/[.!?]$/, "")}${r.receipt.log ? ` (log ${r.receipt.log})` : ""}`);
    throw new CheckFailure(`${what} failed on ${short(sha)}: ${said2.join("; ")}. ${putBack(config, place2, run2, ["reset", "--hard", from])}`, failed);
  }
}
function refresh(paths, config, id, deps, opts) {
  return withJob(paths, { kind: "refresh", task: id, by: opts.by }, () => refreshNow(paths, config, id, deps, opts), deps.now);
}
function refreshNow(paths, config, id, deps, opts) {
  const { run: run2, now: now2 } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  const pr = task.pr;
  if (task.state !== "review" || pr?.state !== "open") throw new AccError("refused", `${id} is ${task.state}${pr ? ` with pull request #${pr.number} ${pr.state}` : " with no pull request"}. Autopilot updates the open pull request of a task in review.`);
  const place2 = mergePlace(paths, config, task, run2);
  const { env, branch, from } = place2;
  fetchBase(paths, place2, run2, deps.env);
  const record2 = (change2) => mutate(paths, now2, (l3, emit) => {
    const t = l3.tasks.find((x2) => x2.id === id);
    if (!t) return;
    const data = change2(t);
    t.updatedAt = now2().toISOString();
    emit({ type: "task.updated", task: id, actor: opts.actor, by: opts.by, data });
  });
  const settled = () => {
    record2((t) => {
      if (t.pr) t.pr = { ...t.pr, conflicts: [] };
      return { pr: t.pr };
    });
    return { sha: null, from, resolved: [], reason: `Pull request #${pr.number} no longer conflicts with ${env.branch}, so nothing was merged.` };
  };
  if (conflictsOf(run2, paths.root, env.branch, branch)?.length === 0) return settled();
  const made = mergeBaseIn(config, place2, run2);
  if (!made) return settled();
  const { sha, resolved } = made;
  const required = fullGates(config);
  checkCommit(paths, config, place2, sha, required, { run: run2, now: now2, slots: deps.slots });
  const refreshed = { base: env.branch, from, to: sha, resolved };
  record2((t) => {
    if (t.autopilot?.failed) t.autopilot.failed = null;
    return { refreshed };
  });
  const kept = resolved.length ? `, ${resolvedWords(resolved, "keeping")}` : "";
  return { sha, from, resolved, reason: `Merged ${env.branch} into ${short(from)} as ${short(sha)}${kept}.${required.length ? " Its checks passed." : ""} It's reviewed next pass, then landed.` };
}

// packages/core/src/land.ts
var PUSH_TIMEOUT_MS = 5 * 6e4;
var GH_TIMEOUT_MS2 = 2 * 6e4;
var LAND_TIMEOUT_MS = PUSH_TIMEOUT_MS + FETCH_TIMEOUT_MS2 + 3 * GH_TIMEOUT_MS2 + 6e4;
var UPDATE_POST_TIMEOUT_MS = 2 * GH_TIMEOUT_MS2 + 6e4;
var STATUS_WORD = { pass: "Passed", fail: "Failed", error: "Couldn't run", skip: "Didn't apply", hold: "Needs a person" };
var cell = (s) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
function mergesWords(autoMerge) {
  return autoMerge ? "With autopilot running, it merges once its checks pass on GitHub and nothing waits on a person: auto-merge is on for this repo. Ask for changes to hold it." : "It merges only when a person merges it.";
}
function prBody(task, env, sha, verdict, receipts, autoMerge = false, carried = null) {
  const ticket = task.source.url ? `[${task.source.key ?? task.id}](${task.source.url})` : null;
  const counted = Object.values(receipts).some((r) => testsText(r));
  const lines = [
    verdict.summary.trim(),
    "",
    ...ticket ? [`Ticket: ${ticket}${task.source.kind === "github" && task.source.key ? ` (refs ${task.source.key})` : ""}`, ""] : [],
    "## Acceptance criteria",
    "",
    ...verdict.criteria.length ? verdict.criteria.map((c) => `- [${c.met ? "x" : " "}] ${c.text}${c.evidence ? ` (${c.evidence})` : ""}`) : ["_The reviewer listed none._"],
    "",
    `## Checks on ${sha.slice(0, 7)}`,
    "",
    counted ? "| Check | Result | Tests | Detail |" : "| Check | Result | Detail |",
    counted ? "|---|---|---|---|" : "|---|---|---|",
    // A ratchet shows its numbers, from the environment's floor to this commit's: tests 669 → 674 (+5) (GH-99).
    ...Object.values(receipts).map((r) => `| \`${r.gate}\` | ${r.waived ? `Waived by ${r.waived.by.replace(/^human:/, "")}` : STATUS_WORD[r.status] ?? r.status} |${counted ? ` ${testsText(r)} |` : ""} ${cell(r.waived ? r.waived.reason : ratchetOf(r) ? ratchetLine(ratchetOf(r)) : r.summary)} |`),
    "",
    "## Review",
    "",
    carried ? `Passed on ${carried.from.slice(0, 7)} by a reviewer agent that read the change and couldn't edit it. The merge queue then merged \`${carried.base}\` in as ${sha.slice(0, 7)}${carried.resolved.length ? `, ${resolvedWords(carried.resolved, "keeping", (f) => `\`${f}\``)}` : ""}, and ran the full check on it: the review carries over.` : `Passed by a reviewer agent that read the change and couldn't edit it.`,
    ...verdict.findings.length ? ["", "Worth a look, not blocking:", "", ...verdict.findings.map((f) => `- ${f.file ? `\`${f.file}${f.line ? `:${f.line}` : ""}\`: ` : ""}${f.message}`)] : [],
    "",
    // Its builder's handoff note (D-106), as its own account: the review above is what checked the change.
    "## Builder's note",
    "",
    ...task.run?.note ? [`In its builder's own words, ${task.run.note.ended === "blocked" ? "when it blocked" : "as it finished"}. The review above is what checked the change.`, "", ...noteMarkdown(task.run.note)] : ["_Its builder left no note._"],
    "",
    "---",
    `Built by a Claude Code agent and opened by \`acc land\` into \`${env.branch}\` (${env.name}). ${mergesWords(autoMerge)}`
  ];
  return lines.join("\n") + "\n";
}
function ghToken(run2, account) {
  const t = run2("gh", ["auth", "token", "-u", account], { timeoutMs: GH_TIMEOUT_MS2 });
  if (t.code !== 0 || !t.stdout.trim()) throw new AccError("no-github", `gh isn't logged in as ${account}, the account this repo works as. Sign in from the Command Center, or run gh auth login.`);
  return t.stdout.trim();
}
function land(paths, config, id, deps, opts = {}) {
  return withJob(paths, { kind: "land", task: id, by: opts.by ?? "acc land" }, () => landNow(paths, config, id, deps, opts), deps.now);
}
function landNow(paths, config, id, deps, opts) {
  const { run: run2, now: now2 } = deps;
  const steps2 = deps.steps ?? NO_STEPS;
  const { task, gh, env, branch, sha, own, verdict } = steps2.step("task", "Check its review and checks", () => {
    const task2 = readLedger(paths.ledger).tasks.find((t) => t.id === id);
    if (!task2) throw new AccError("no-task", `No task ${id}.`);
    if (task2.state !== "review") throw new AccError("refused", `${id} is ${task2.state}. A task lands from review, once its review has passed.`);
    const gh2 = config.github;
    if (!gh2) throw new AccError("no-github", 'acc land opens a pull request on GitHub, and this project has no "github" section in .acc/config.json.');
    const env2 = environmentByBranch(config, task2.environment);
    if (!env2) throw new AccError("land", `${id}'s environment "${task2.environment}" isn't in the config.`);
    const branch2 = task2.run?.branch;
    if (!branch2) throw new AccError("land", `${id} has no branch to land.`);
    const sha2 = run2("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch2}`], { cwd: paths.root }).stdout.trim();
    if (!sha2) throw new AccError("land", `The branch ${branch2} isn't in this clone.`);
    const missing = receiptHooks(paths, config, run2).missingGates(task2, opts.gates);
    if (missing.length) throw new AccError("refused", `${id}'s checks aren't settled on ${sha2.slice(0, 7)}: ${missing.join(", ")}.`);
    const own2 = readVerdict(paths, id, sha2);
    const verdict2 = own2 ?? carriedVerdict(paths, task2, sha2);
    if (!verdict2) throw new AccError("refused", `${id} hasn't been reviewed on ${sha2.slice(0, 7)}. Run acc review ${id} first.`);
    if (verdict2.verdict !== "pass") throw new AccError("refused", `${id}'s review on ${sha2.slice(0, 7)} asked for changes: ${verdict2.summary}`);
    return { task: task2, gh: gh2, env: env2, branch: branch2, sha: sha2, own: own2, verdict: verdict2 };
  });
  const ghEnv3 = { ...deps.env, GH_TOKEN: steps2.step("github", `Sign in to GitHub as ${gh.account}`, () => ghToken(run2, gh.account)) };
  const ghRun = (args) => run2("gh", args, { cwd: paths.root, env: ghEnv3, timeoutMs: GH_TIMEOUT_MS2 });
  const existing = steps2.step("find", "Look for its pull request", () => {
    const open = ghRun(["pr", "list", "-R", gh.repo, "--head", branch, "--state", "open", "--json", "number,url"]);
    const existing2 = open.code === 0 ? JSON.parse(open.stdout || "[]")[0] : void 0;
    if (!existing2 && task.pr && opts.actor === "orchestrator") {
      const seen = open.code === 0 ? "isn't open on GitHub" : `may not be open on GitHub: gh couldn't list the branch's pull requests (${(open.stderr || open.stdout).trim().split("\n")[0] || `exit ${open.code}`})`;
      throw new AccError("land", `Pull request #${task.pr.number} ${seen}. Autopilot won't open another: a person decides.`);
    }
    return existing2;
  });
  steps2.step("push", `Push ${branch}`, () => {
    const push = run2("git", ["push", "--set-upstream", "origin", `${branch}:${branch}`], { cwd: paths.root, env: deps.env, timeoutMs: PUSH_TIMEOUT_MS });
    if (push.code !== 0) throw new AccError("land", `git push refused ${branch}: ${(push.stderr || push.stdout).trim().split("\n").slice(-2).join(" ")}`);
  });
  const receipts = receiptsAt(paths, sha);
  const body = prBody(task, env, sha, verdict, receipts, autoMergeFor(config, env.branch), own ? null : task.autopilot?.carried ?? null);
  const dir = mkdtempSync3(join20(tmpdir3(), "acc-land-"));
  let pr;
  let opened;
  steps2.start("pr", existing ? `Update pull request #${existing.number}` : `Open the pull request into ${env.branch}`);
  try {
    const bodyFile = join20(dir, "body.md");
    writeFileSync21(bodyFile, body);
    if (existing) {
      const edit = ghRun(["pr", "edit", String(existing.number), "-R", gh.repo, "--body-file", bodyFile]);
      if (edit.code !== 0) throw new AccError("land", `Couldn't update pull request #${existing.number}: ${edit.stderr.trim().split("\n")[0]}`);
      pr = { number: existing.number, url: existing.url, state: "open", landedAt: now2().toISOString(), sha };
      opened = false;
    } else {
      const create = ghRun(["pr", "create", "-R", gh.repo, "--base", env.branch, "--head", branch, "--title", `${task.id}: ${task.title}`, "--body-file", bodyFile]);
      const url = create.stdout.trim().split("\n").find((l3) => /^https:\/\/github\.com\/.+\/pull\/\d+/.test(l3.trim()))?.trim();
      if (create.code !== 0 || !url) throw new AccError("land", `gh couldn't open the pull request: ${(create.stderr || create.stdout).trim().split("\n")[0]}`);
      pr = { number: Number(/\/pull\/(\d+)/.exec(url)[1]), url, state: "open", landedAt: now2().toISOString(), sha };
      opened = true;
    }
  } catch (e) {
    steps2.fail("pr", e.message);
    throw e;
  } finally {
    rmSync13(dir, { recursive: true, force: true });
  }
  steps2.done("pr", `#${pr.number}`);
  steps2.start("conflicts", `Check it merges into ${env.branch}`);
  const conflicts = fetchBranches(run2, paths.root, [env.branch, branch], deps.env) ? conflictsOf(run2, paths.root, env.branch, branch) : null;
  if (conflicts) pr = { ...pr, conflicts };
  steps2.done("conflicts", conflicts?.length ? `It conflicts in ${conflicts.join(", ")}` : void 0);
  const updated = steps2.step("record", "Record the pull request", () => mutate(paths, now2, (l3, emit) => {
    const t = l3.tasks.find((x2) => x2.id === id);
    t.pr = pr;
    if (t.autopilot?.failed) t.autopilot.failed = null;
    t.updatedAt = now2().toISOString();
    emit({ type: "task.updated", task: id, actor: opts.actor ?? "human", by: opts.by ?? "acc land", data: { pr, sha, opened } });
    return t;
  }));
  steps2.start("update", "Draft the ticket's update");
  try {
    const update = draftUpdate(paths, task, {
      event: opened ? "pr-opened" : "pr-updated",
      pr: { number: pr.number, url: pr.url },
      context: { summary: verdict.client?.trim() || task.title }
    }, opts.by ?? "acc land", now2);
    steps2.done("update", update ? void 0 : "It has no ticket");
    return { task: updated, sha, pr, opened, update: update ? { id: update.id, key: update.key } : null };
  } catch (e) {
    steps2.fail("update", e.message);
    return { task: updated, sha, pr, opened, update: null, updateError: e.message };
  }
}

// packages/core/src/checks.ts
var LOG_TAIL_LINES = 100;
var LOG_TAIL_BYTES = 10 * 1024;
var MAX_LOGS = 5;
var NO_ACTIONS_LOG = "GitHub keeps no log for it: it isn't a GitHub Actions job.";
var short2 = (sha) => sha.slice(0, 7) || "no commit";
var said = (r) => `${r.stderr}
${r.stdout}`;
var JOB_LINK = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/actions\/runs\/\d+\/job\/(\d+)(?:[/?#]|$)/;
function actionsJob(link) {
  const m = JOB_LINK.exec(link);
  if (!m) return null;
  return { repo: m[1] === "github.com" ? m[2] : `${m[1]}/${m[2]}`, id: m[3] };
}
function headOf(run2, repo, pr, env) {
  const r = run2("gh", ["pr", "view", String(pr), "-R", repo, "--json", "headRefOid"], { env, timeoutMs: GH_TIMEOUT_MS2 });
  let sha = "";
  try {
    sha = parseJsonOutput(r.stdout).headRefOid ?? "";
  } catch {
    sha = "";
  }
  if (r.code !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) throw new AccError("checks", `gh couldn't read pull request #${pr}: ${firstSaid(r)}`);
  return sha;
}
function listOf2(r) {
  try {
    const list = parseJsonOutput(r.stdout);
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}
function readChecks(run2, repo, pr, env) {
  const sha = headOf(run2, repo, pr, env);
  const checks = (...more) => run2("gh", ["pr", "checks", String(pr), "-R", repo, ...more, "--json", "name,bucket,link,workflow,state"], { env, timeoutMs: GH_TIMEOUT_MS2 });
  let required = true;
  let r = checks("--required");
  let list = listOf2(r);
  if (!list && /no required checks reported/i.test(said(r))) {
    required = false;
    r = checks();
    list = listOf2(r);
  }
  if (!list && /no checks reported/i.test(said(r))) {
    required = false;
    list = [];
  }
  if (!list) throw new AccError("checks", `gh couldn't read pull request #${pr}'s checks: ${firstSaid(r)}`);
  const name = (c) => c.name || c.workflow || "a check";
  const failed = list.filter((c) => c.bucket === "fail").map((c) => ({ name: name(c), workflow: c.workflow ?? "", link: c.link ?? "", job: actionsJob(c.link ?? "") }));
  const pending = list.filter((c) => c.bucket === "pending").map(name);
  const cancelled = list.filter((c) => c.bucket === "cancel").map(name);
  return { sha, required, failed, pending, cancelled, count: list.length };
}
var CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
var PREFIX = /^[^\t\n]*\t[^\t\n]*\t/;
var STAMP = /^﻿?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;
function tailLog(text, lines = LOG_TAIL_LINES, bytes = LOG_TAIL_BYTES) {
  return tailOf(text.replace(/\r\n?/g, "\n").split("\n").map((l3) => l3.replace(CSI, "").replace(PREFIX, "").replace(STAMP, "").trimEnd()), lines, bytes);
}
function tailText(text, lines = LOG_TAIL_LINES, bytes = LOG_TAIL_BYTES) {
  return tailOf(text.replace(/\r\n?/g, "\n").split("\n").map((l3) => l3.replace(CSI, "").trimEnd()), lines, bytes);
}
function tailOf(all, lines, bytes) {
  while (all.length && !all.at(-1)) all.pop();
  const kept = [];
  let size = 0;
  for (const line of all.slice(-lines).reverse()) {
    const b = Buffer.byteLength(line) + (kept.length ? 1 : 0);
    if (size + b > bytes) {
      if (!kept.length) kept.push(Buffer.from(line).subarray(-bytes).toString("utf8").replace(/^�+/, ""));
      break;
    }
    kept.push(line);
    size += b;
  }
  return kept.reverse().join("\n");
}
function fetchLog(run2, job, env) {
  const view = (flag) => run2("gh", ["run", "view", "--job", job.id, flag, "-R", job.repo], { env, timeoutMs: GH_TIMEOUT_MS2 });
  let r = view("--log-failed");
  if (r.code === 0 && !tailLog(r.stdout)) r = view("--log");
  if (r.code !== 0) return { error: firstSaid(r) };
  const log = tailLog(r.stdout);
  return log ? { log } : { error: "GitHub gave an empty log." };
}
var checksPath = (paths, task, sha) => join21(paths.checks, `${task}-${sha}.json`);
function readChecksReport(paths, task, sha) {
  try {
    const r = JSON.parse(readFileSync23(checksPath(paths, task, sha), "utf8"));
    return r.v === 1 && r.task === task && Array.isArray(r.checks) ? r : null;
  } catch {
    return null;
  }
}
var fence = (text) => "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
function checksSection(r) {
  if (!r?.checks.length) return [];
  const which = r.required ? "checks its base branch requires" : "its checks";
  const lines = [
    "## What GitHub's checks said",
    "",
    `This is a rework. Your change is pull request #${r.pr.number}, and ${which} failed on GitHub on ${short2(r.sha)}: ${r.checks.map((c) => c.name).join(", ")}. Its review passed: these failures are all there is to fix.`,
    "",
    "Reproduce each failure here and fix it, keeping the rest of the change as it is. Then finish as below: commit, run `acc gate run`, then `acc done`. If a failure isn't caused by this change, such as a check that fails on the base branch too or a service that was down, don't work around it: run `acc block \"<what you found>\"` and stop.",
    ""
  ];
  for (const c of r.checks) {
    lines.push(`### ${c.name}${c.workflow && c.workflow !== c.name ? ` (${c.workflow})` : ""}`, "");
    if (c.link) lines.push(`Link: ${c.link}`, "");
    if (c.log) {
      const f = fence(c.log);
      lines.push("The end of its log:", "", `${f}text`, c.log, f, "");
    } else lines.push(`Couldn't fetch its log: ${sentence(c.noLog ?? "GitHub gave none")}`, "");
  }
  return lines;
}
var queueReportPath = (paths, task, sha) => join21(paths.queue, `${task}-${sha}.json`);
function readQueueReport(paths, task, sha) {
  try {
    const r = JSON.parse(readFileSync23(queueReportPath(paths, task, sha), "utf8"));
    return r.v === 1 && r.task === task && Array.isArray(r.checks) && Array.isArray(r.conflicts) ? r : null;
  } catch {
    return null;
  }
}
function queueSection(r) {
  if (!r) return [];
  const base = `\`${r.base}\``;
  const lines = ["## What the merge queue found", ""];
  if (r.kind === "conflict") {
    lines.push(
      `This is a rework. Your change is pull request #${r.pr.number}. Its review passed, and the merge queue took it to merge into ${base}, but ${base} has moved on, and merging it into ${short2(r.sha)} conflicts in: ${r.conflicts.map((f) => `\`${f}\``).join(", ")}.`,
      "",
      `Merge it in here: run \`git merge origin/${r.base}\`, resolve each of those files so that both your change and what ${base} added hold, then commit the merge. Keep the rest of your change as it is. Then finish as below: run \`acc gate run\`, then \`acc done\`. If a conflict can't be resolved without a choice that isn't yours, run \`acc block "<what you found>"\` and stop.`,
      ""
    );
    return lines;
  }
  const where = r.merge ? `after merging ${base} in (as ${short2(r.merge)}, put back since)` : `on ${short2(r.sha)}`;
  lines.push(
    `This is a rework. Your change is pull request #${r.pr.number}. Its review passed, and the merge queue took it to merge into ${base}, but the full check failed ${where}: ${r.checks.map((c) => c.gate).join(", ")}. You ran the lighter checks; the full one runs once, in the queue.`,
    "",
    `Reproduce each failure here and fix it, keeping the rest of the change as it is.${r.merge ? ` Merge ${base} in first, with \`git merge origin/${r.base}\`, since the failure may come from the two together.` : ""} Run the failing check by name, such as \`acc gate run ${r.checks[0]?.gate ?? "check"}\`, then finish as below: commit, run \`acc gate run\`, then \`acc done\`. If a failure isn't caused by this change, such as a check that fails on ${base} too, don't work around it: run \`acc block "<what you found>"\` and stop.`,
    ""
  );
  for (const c of r.checks) {
    lines.push(`### ${c.gate}`, "", sentence(c.summary), "");
    if (c.file) lines.push(`Its whole log: \`${c.file}\``, "");
    if (c.log) {
      const f = fence(c.log);
      lines.push("The end of its log:", "", `${f}text`, c.log, f, "");
    }
  }
  return lines;
}
function sendBack(paths, config, id, deps, opts) {
  const { run: run2, now: now2 } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  const pr = task.pr;
  if (task.state !== "review" || pr?.state !== "open") throw new AccError("refused", `${id} is ${task.state}${pr ? ` with pull request #${pr.number} ${pr.state}` : " with no pull request"}. Autopilot sends back the open pull request of a task in review.`);
  const gh = config.github;
  if (!gh) throw new AccError("no-github", 'This project has no "github" section in .acc/config.json, so there are no checks to read.');
  const branch = task.run?.branch;
  const head = branch ? run2("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: paths.root }).stdout.trim() : "";
  if (!head) throw new AccError("checks", `${id}'s branch isn't in this clone.`);
  const moved = (why) => new AccError("checks-moved", why);
  if (pr.sha !== head) throw moved(`Pull request #${pr.number} was landed at ${short2(pr.sha ?? "")}, not ${short2(head)}: a land comes first.`);
  const env = { ...deps.env, GH_TOKEN: ghToken(run2, gh.account) };
  const read2 = readChecks(run2, gh.repo, pr.number, env);
  const away = (sha) => moved(`Pull request #${pr.number} is at ${short2(sha)} on GitHub, not ${short2(head)}.`);
  if (read2.sha !== head) throw away(read2.sha);
  if (read2.pending.length) throw moved(`Checks are still running on GitHub: ${read2.pending.join(", ")}.`);
  if (!read2.failed.some((c) => c.job)) throw moved(read2.failed.length ? `Checks failed on GitHub with no log there: ${read2.failed.map((c) => c.name).join(", ")}.` : "Its checks no longer fail on GitHub.");
  let fetched = 0;
  const checks = read2.failed.map((c) => {
    const base = { name: c.name, workflow: c.workflow, link: c.link };
    if (!c.job) return { ...base, log: null, noLog: NO_ACTIONS_LOG };
    if (fetched >= MAX_LOGS) return { ...base, log: null, noLog: `Not fetched: autopilot reads the logs of ${MAX_LOGS} checks at most.` };
    fetched++;
    const got = fetchLog(run2, c.job, env);
    return "log" in got ? { ...base, log: got.log, noLog: null } : { ...base, log: null, noLog: got.error };
  });
  const still = headOf(run2, gh.repo, pr.number, env);
  if (still !== head) throw away(still);
  const names3 = checks.map((c) => c.name);
  const at2 = now2().toISOString();
  const report = { v: 1, task: id, sha: head, pr: { number: pr.number, url: pr.url }, required: read2.required, checks, at: at2 };
  mkdirSync21(paths.checks, { recursive: true });
  const file = checksPath(paths, id, head);
  writeFileSync22(file, JSON.stringify(report, null, 2) + "\n");
  const reason = `Checks failed on GitHub on ${short2(head)}: ${names3.join(", ")}.`;
  mutate(paths, now2, (l3, emit) => {
    const t = l3.tasks.find((x2) => x2.id === id);
    if (!t) throw new AccError("no-task", `No task ${id}.`);
    if (t.pr?.sha !== head) throw moved(`Pull request #${pr.number} was landed again meanwhile.`);
    const req = { to: "rework", actor: opts.actor, by: opts.by, reason };
    const problems = checkMove(l3, config, t, req, noGateHooks);
    if (problems.length) throw new AccError("move-refused", `Can't send ${id} back:
- ${problems.join("\n- ")}`);
    applyMove(t, req, emit, now2, { checks: names3, sha: head });
    const sentBack = { sha: head, checks: names3, at: at2 };
    t.autopilot = { failed: null, ...t.autopilot, sentBack };
    emit({ type: "task.updated", task: id, actor: opts.actor, by: opts.by, data: { autopilot: { sentBack } } });
  });
  return { sha: head, checks: names3, report: file, reason: `Sent it back to its builder: ${reason[0].toLowerCase()}${reason.slice(1)}` };
}

// packages/core/src/held.ts
function holdWords(look2) {
  return `Waits for ${filesOf(look2.shares)}, while ${taskList(look2.first)} ${look2.first.length === 1 ? "is" : "are"} ready to start`;
}
var FOR_NOW = /* @__PURE__ */ new Set(["move-refused", "lock-timeout"]);
function startHeld(paths, config, deps, opts) {
  const out3 = { started: [], waiting: [], failed: [] };
  const tried = /* @__PURE__ */ new Set();
  const shared = sharedFiles(config);
  let fetched = false;
  const machine = machineLoad(paths, config.project, deps.env);
  for (; ; ) {
    const ledger = readLedger(paths.ledger);
    const held = ledger.tasks.filter((t) => t.state === "todo" && t.held && !t.held.failed && !tried.has(t.id) && (!opts.only || t.id === opts.only)).sort((a2, b) => a2.held.at.localeCompare(b.held.at));
    if (!held.length) break;
    const flying = inFlightFiles(paths, ledger, deps.run, { fetch: !fetched });
    fetched = true;
    const candidates = startCandidates(paths, config, ledger);
    const looks = held.map((t) => {
      const look2 = startOrder({ id: t.id, files: candidates.find((c) => c.id === t.id)?.files ?? null }, candidates, flying, shared);
      const over = machineCapProblem(ledger, t.id, machine);
      const problems = [...checkMove(ledger, config, t, { to: "running", actor: opts.actor, by: opts.by }, noGateHooks), ...over ? [over] : [], ...analysisProblems(paths, config, t)];
      const claimed = startingNow(t, deps.now());
      return { t, look: look2, problems, claimed };
    });
    const ok = looks.filter((l3) => !l3.problems.length && !l3.claimed);
    const go = ok.find((l3) => !l3.look.shares.length) ?? ok.find((l3) => !waits(l3.look));
    if (!go) {
      for (const l3 of looks) {
        const reason = l3.problems[0] ?? (l3.claimed ? `${l3.claimed.by} is starting it.` : `${holdWords(l3.look)}.`);
        out3.waiting.push({ task: l3.t.id, reason, waitsFor: l3.look.shares, first: l3.look.first });
      }
      break;
    }
    const id = go.t.id;
    tried.add(id);
    if (!claimHeld(paths, deps.now, id, opts)) continue;
    const waitedFor = go.t.held.waitsFor.map((w) => w.task);
    try {
      const r = dispatch(paths, config, id, deps, { actor: opts.actor, by: opts.by, fromHold: { shares: go.look.shares } });
      if (r.held) continue;
      out3.started.push({ task: id, worktree: r.worktree, bgId: r.bgId, shares: r.shares, waitedFor });
    } catch (e) {
      const reason = e.message.trim().split("\n").slice(0, 3).join(" ").replace(/\s+/g, " ");
      if (FOR_NOW.has(e.code)) {
        releaseHeld(paths, deps.now, id, opts, null);
        out3.waiting.push({ task: id, reason, waitsFor: go.look.shares, first: go.look.first });
      } else {
        releaseHeld(paths, deps.now, id, opts, reason);
        out3.failed.push({ task: id, reason });
      }
    }
  }
  return out3;
}
function stopWaiting(paths, now2, id, actor, by) {
  return mutate(paths, now2, (ledger, emit) => {
    const t = ledger.tasks.find((x2) => x2.id === id);
    if (!t) throw new AccError("no-task", `No task ${id}.`);
    if (!t.held) throw new AccError("not-held", `${id} isn't waiting for anything.`);
    t.held = null;
    t.updatedAt = now2().toISOString();
    emit({ type: "task.updated", task: id, actor, by, data: { held: null } });
    return t;
  });
}

// packages/core/src/merge.ts
var NO_CHECKS_GRACE_MS = 2 * 6e4;
var BLOCKED_NO_CHECKS_MS = 15 * 6e4;
var MERGE_METHODS = ["merge", "squash", "rebase"];
var MERGEABLE = /* @__PURE__ */ new Set(["CLEAN", "UNSTABLE", "HAS_HOOKS"]);
var short3 = (sha) => sha.slice(0, 7) || "no commit";
function viewPr(run2, repo, n, env) {
  const r = run2("gh", ["pr", "view", String(n), "-R", repo, "--json", "state,headRefOid,mergeable,mergeStateStatus,reviewDecision,baseRefName,isDraft"], { env, timeoutMs: GH_TIMEOUT_MS2 });
  if (r.code !== 0) return null;
  try {
    return parseJsonOutput(r.stdout);
  } catch {
    return null;
  }
}
function mergeMethod(run2, repo, env) {
  const r = run2("gh", ["repo", "view", repo, "--json", "mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed"], { env, timeoutMs: GH_TIMEOUT_MS2 });
  let allowed = null;
  try {
    allowed = r.code === 0 ? parseJsonOutput(r.stdout) : null;
  } catch {
    allowed = null;
  }
  if (!allowed) throw new AccError("merge", `gh couldn't read how ${repo} merges pull requests: ${firstSaid(r)}`);
  const key = { merge: "mergeCommitAllowed", squash: "squashMergeAllowed", rebase: "rebaseMergeAllowed" };
  const method = MERGE_METHODS.find((m) => allowed[key[m]] === true);
  if (!method) throw new AccError("merge", `${repo} allows no way to merge a pull request.`);
  return method;
}
function notCovered(config, env) {
  if (config.profile === "salesforce") return "A Salesforce project never auto-merges: a person merges every pull request there.";
  if (env.protected) return `"${env.name}" is protected: a person merges into it.`;
  if (config.autonomy !== "review") return `autonomy is "${config.autonomy}": autopilot merges only under review.`;
  return "Auto-merge is off for this project: a person merges its pull requests.";
}
function mergePr(paths, config, id, deps, opts) {
  const { run: run2, now: now2 } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  const pr = task.pr;
  if (task.state !== "review" || pr?.state !== "open") throw new AccError("refused", `${id} is ${task.state}${pr ? ` with pull request #${pr.number} ${pr.state}` : " with no pull request"}. Autopilot merges the open pull request of a task in review.`);
  const gh = config.github;
  if (!gh) throw new AccError("no-github", `This project has no "github" section in .acc/config.json, so there's no pull request to merge.`);
  const env = environmentByBranch(config, task.environment);
  if (!env) throw new AccError("merge", `${id}'s environment "${task.environment}" isn't in the config.`);
  if (!autoMergeFor(config, env.branch)) throw new AccError("refused", notCovered(config, env));
  const branch = task.run?.branch;
  const head = branch ? run2("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: paths.root }).stdout.trim() : "";
  if (!branch || !head) throw new AccError("merge", `${id}'s branch isn't in this clone.`);
  const wait = (why) => new AccError("merge-waits", why);
  const waitChecks = (why) => Object.assign(wait(why), { checks: true });
  if (task.autopilot?.merged?.sha === head) throw wait(`Autopilot already merged pull request #${pr.number}: acc sync moves ${id} to done.`);
  if (pr.sha !== head) throw wait(`Pull request #${pr.number} was landed at ${short3(pr.sha ?? "")}, not ${short3(head)}: a land comes first.`);
  if (!reviewedAt(paths, task, head)) throw wait(`${id}'s review hasn't passed on ${short3(head)}.`);
  const missing = receiptHooks(paths, config, run2).missingGates(task, "merge");
  if (missing.length) throw new AccError("merge", `Its checks aren't settled on ${short3(head)}: ${missing.join(", ")}.`);
  const wt2 = task.run?.worktree;
  if (wt2 && askingUnder(pendingQuestions(questionsDir(deps.env)), wt2)) throw wait(`An agent in ${id}'s worktree is waiting for your answer.`);
  if (!fetchBranches(run2, paths.root, [env.branch, branch], { ...deps.env, GIT_TERMINAL_PROMPT: "0" })) throw wait(`Couldn't fetch ${env.branch} and ${branch} from origin.`);
  const git10 = (...args) => run2("git", args, { cwd: paths.root });
  if (git10("merge-base", "--is-ancestor", `refs/remotes/origin/${env.branch}`, head).code !== 0) throw wait(`${env.branch} moved on since ${short3(head)}: autopilot merges it in first.`);
  const changed = git10("diff", "--name-only", "--no-renames", `refs/remotes/origin/${env.branch}...${head}`, "--", ".acc");
  if (changed.code !== 0) throw new AccError("merge", `git couldn't list what pull request #${pr.number} changes: ${firstSaid(changed)}`);
  const acc = changed.stdout.split("\n").filter(Boolean);
  if (acc.length) throw new AccError("merge", `It changes .acc/, which a person merges: ${acc.join(", ")}.`);
  const ghEnv3 = { ...deps.env, GH_TOKEN: ghToken(run2, gh.account) };
  const seen = viewPr(run2, gh.repo, pr.number, ghEnv3);
  if (!seen) throw wait(`gh couldn't read pull request #${pr.number}.`);
  if (seen.state === "MERGED") throw wait(`Pull request #${pr.number} is already merged on GitHub: acc sync moves ${id} to done.`);
  if (seen.state !== "OPEN") throw wait(`Pull request #${pr.number} is ${String(seen.state ?? "not open").toLowerCase()} on GitHub: acc sync follows it.`);
  if (seen.headRefOid !== head) throw wait(`Pull request #${pr.number} is at ${short3(seen.headRefOid ?? "")} on GitHub, not ${short3(head)}: a land or a person comes first.`);
  if (seen.baseRefName !== env.branch) throw new AccError("merge", `Pull request #${pr.number} merges into ${seen.baseRefName || "another branch"} on GitHub, not ${env.branch}: a person merges it.`);
  if (seen.reviewDecision === "CHANGES_REQUESTED") throw wait(`A person asked for changes on pull request #${pr.number}.`);
  if (seen.isDraft) throw new AccError("merge", `Pull request #${pr.number} is a draft on GitHub.`);
  let checks;
  try {
    checks = readChecks(run2, gh.repo, pr.number, ghEnv3);
  } catch (e) {
    throw wait(e.message);
  }
  if (checks.sha !== head) throw wait(`Pull request #${pr.number} is at ${short3(checks.sha)} on GitHub, not ${short3(head)}.`);
  if (checks.pending.length) throw waitChecks(`Checks are still running on GitHub: ${checks.pending.join(", ")}.`);
  if (checks.failed.length) throw new AccError("merge", `Checks failed on GitHub: ${checks.failed.map((c) => c.name).join(", ")}.`);
  if (checks.cancelled.length) throw new AccError("merge", `Checks were cancelled on GitHub: ${checks.cancelled.join(", ")}. Run them again, or merge it yourself.`);
  const landed = Date.parse(pr.landedAt ?? "");
  const since = (ms) => Number.isFinite(landed) && now2().getTime() - landed < ms;
  if (!checks.count) {
    if (checks.required) throw waitChecks(`No checks ${env.branch} requires are reported on GitHub yet.`);
    if (since(NO_CHECKS_GRACE_MS)) throw waitChecks("No checks are reported on GitHub yet: autopilot gives them 2 minutes after a land.");
  }
  if (seen.mergeable === "CONFLICTING" || seen.mergeStateStatus === "DIRTY") throw new AccError("merge", `GitHub says pull request #${pr.number} conflicts with ${env.branch}.`);
  if (seen.mergeable !== "MERGEABLE" || !seen.mergeStateStatus || seen.mergeStateStatus === "UNKNOWN") throw wait(`GitHub is still working out whether pull request #${pr.number} can merge.`);
  if (seen.mergeStateStatus === "BEHIND") throw wait(`GitHub says pull request #${pr.number} is behind ${env.branch}: autopilot merges it in first.`);
  if (seen.mergeStateStatus === "BLOCKED" && !checks.count) {
    if (since(BLOCKED_NO_CHECKS_MS)) throw waitChecks(`GitHub says ${env.branch}'s rules block pull request #${pr.number}, and no checks are reported on it yet: autopilot waits for the checks ${env.branch} requires.`);
    throw new AccError("merge", `GitHub won't merge pull request #${pr.number}: ${env.branch}'s rules block it, and no checks were reported on it in the 15 minutes after its land. It may need an approving review: merge it yourself.`);
  }
  if (seen.mergeStateStatus === "BLOCKED") throw new AccError("merge", `GitHub won't merge pull request #${pr.number}: ${env.branch}'s rules block it, such as a required approving review.`);
  if (!MERGEABLE.has(seen.mergeStateStatus)) throw new AccError("merge", `GitHub says pull request #${pr.number} can't merge (${seen.mergeStateStatus}).`);
  const method = mergeMethod(run2, gh.repo, ghEnv3);
  const r = run2("gh", ["pr", "merge", String(pr.number), "-R", gh.repo, `--${method}`, "--match-head-commit", head], { env: ghEnv3, timeoutMs: GH_TIMEOUT_MS2 });
  if (r.code !== 0) {
    const after = viewPr(run2, gh.repo, pr.number, ghEnv3);
    if (after?.state !== "MERGED") {
      if (after?.headRefOid && after.headRefOid !== head) throw wait(`Pull request #${pr.number} moved on to ${short3(after.headRefOid)} on GitHub while autopilot merged it.`);
      throw new AccError("merge", `gh couldn't merge pull request #${pr.number}: ${firstSaid(r)}${after ? "" : " GitHub didn't say afterwards whether it merged."}`);
    }
  }
  const merged = { sha: head, pr: { number: pr.number, url: pr.url }, method, at: now2().toISOString() };
  mutate(paths, now2, (l3, emit) => {
    const t = l3.tasks.find((x2) => x2.id === id);
    if (!t) return;
    t.autopilot = { ...t.autopilot, failed: null, merged };
    if (t.autopilot.queued) t.autopilot.queued = null;
    t.updatedAt = merged.at;
    emit({ type: "task.updated", task: id, actor: opts.actor, by: opts.by, data: { merged } });
  });
  return { sha: head, pr: merged.pr, method, reason: `Merged pull request #${pr.number} into ${env.branch} at ${short3(head)}. acc sync moves ${id} to done.` };
}

// packages/core/src/resume.ts
import { spawn as spawn2 } from "node:child_process";
import { appendFileSync as appendFileSync3, closeSync as closeSync4, existsSync as existsSync18, mkdirSync as mkdirSync23, openSync as openSync4, readFileSync as readFileSync25, rmSync as rmSync14, writeFileSync as writeFileSync24 } from "node:fs";
import { dirname as dirname10, join as join24 } from "node:path";

// packages/core/src/hooks.ts
import { existsSync as existsSync16, mkdirSync as mkdirSync22, realpathSync as realpathSync4, writeFileSync as writeFileSync23 } from "node:fs";
import { dirname as dirname9, join as join22, relative as relative3, resolve as resolve3, sep as sep3 } from "node:path";
function findAccRoot(cwd) {
  let dir = resolve3(cwd);
  for (; ; ) {
    if (existsSync16(join22(dir, ".acc", "config.json"))) return dir;
    const up = dirname9(dir);
    if (up === dir) return null;
    dir = up;
  }
}
var real = (p) => {
  try {
    return realpathSync4(p);
  } catch {
    return resolve3(p);
  }
};
var under2 = (path, root) => {
  const r = relative3(real(root), real(path));
  return r === "" || !r.startsWith("..") && !r.startsWith(sep3) && !/^[A-Za-z]:/.test(r);
};
function builderFor(ctx) {
  const root = findAccRoot(ctx.cwd);
  if (!root) return null;
  let tasks;
  try {
    tasks = readLedger(repoPaths(root, ctx.run).ledger).tasks;
  } catch {
    return null;
  }
  const byEnv = ctx.env.ACC_ROLE === "builder" && ctx.env.ACC_TASK ? tasks.find((t) => t.id === ctx.env.ACC_TASK) : void 0;
  const byFolder = tasks.find((t) => t.run?.worktree && (t.state === "running" || t.state === "rework") && under2(ctx.cwd, t.run.worktree));
  const task = byEnv ?? byFolder;
  if (!task?.run?.worktree) return null;
  return { task, worktree: task.run.worktree, root };
}
function guardEdit(b, filePath, envSpecific) {
  if (!filePath) return null;
  const abs = resolve3(b.worktree, filePath);
  if (!under2(abs, b.worktree)) return `You're the builder for ${b.task.id}, and your only workspace is ${b.worktree}. ${filePath} is outside it. Make the change in your worktree, or say what you need with acc block.`;
  const rel = relative3(real(b.worktree), real(abs)).split(sep3).join("/");
  if (envSpecific.some((p) => rel === p || rel.startsWith(`${p.replace(/\/+$/, "")}/`))) {
    return `${rel} is environment-specific (D-016): every org keeps its own version, and no task changes it. Leave it, and mention in your summary what it should say.`;
  }
  return null;
}
var SUBSTITUTED = "$(...)";
function commandsOf(line) {
  const out3 = [];
  let words4 = [];
  let word = "";
  let quote = null;
  let any = false;
  const stack = [];
  const heredocs = [];
  let delimiterNext = false;
  const end = () => {
    if (any) {
      if (delimiterNext) {
        heredocs.push(word.replace(/^['"]|['"]$/g, ""));
        delimiterNext = false;
      } else if (word === "<<" || word === "<<-") delimiterNext = true;
      else if (/^<<-?./.test(word)) heredocs.push(word.replace(/^<<-?/, "").replace(/^['"]|['"]$/g, ""));
      words4.push(word);
    }
    word = "";
    any = false;
  };
  const next = () => {
    end();
    if (words4.length) out3.push(words4);
    words4 = [];
  };
  const open = (back, tick) => {
    stack.push({ group: false, back, tick, words: words4, word: word + SUBSTITUTED });
    words4 = [];
    word = "";
    any = false;
    quote = null;
  };
  const close2 = (top) => {
    next();
    words4 = top.words;
    word = top.word;
    any = true;
    quote = top.back;
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else {
        word += c;
        any = true;
      }
      continue;
    }
    if (quote === '"') {
      if (c === '"') {
        quote = null;
        continue;
      }
      if (c === "\\" && i + 1 < line.length) {
        word += line[++i];
        any = true;
        continue;
      }
      if (c === "`") {
        open('"', true);
        continue;
      }
      if (c === "$" && line[i + 1] === "(") {
        open('"', false);
        i++;
        continue;
      }
      word += c;
      any = true;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      any = true;
      continue;
    }
    if (c === "\\" && i + 1 < line.length) {
      word += line[++i];
      any = true;
      continue;
    }
    if (c === "`") {
      const top = stack[stack.length - 1];
      if (top && !top.group && top.tick) {
        stack.pop();
        close2(top);
      } else open(null, true);
      continue;
    }
    if (c === "$" && line[i + 1] === "(") {
      open(null, false);
      i++;
      continue;
    }
    if (c === "(") {
      next();
      stack.push({ group: true });
      continue;
    }
    if (c === ")") {
      const top = stack.pop();
      if (top && !top.group) close2(top);
      else next();
      continue;
    }
    if (c === "\n") {
      next();
      while (heredocs.length && i < line.length) {
        const term = heredocs.shift();
        let j2 = i + 1;
        for (; ; ) {
          const nl = line.indexOf("\n", j2);
          const l3 = nl < 0 ? line.slice(j2) : line.slice(j2, nl);
          if (l3.replace(/^\t+/, "") === term || nl < 0) {
            i = nl < 0 ? line.length : nl;
            break;
          }
          j2 = nl + 1;
        }
      }
      continue;
    }
    if (/\s/.test(c)) {
      end();
      continue;
    }
    if (c === ";" || c === "|" || c === "&") {
      next();
      continue;
    }
    word += c;
    any = true;
  }
  for (let top = stack.pop(); top; top = stack.pop()) if (!top.group) close2(top);
  next();
  return out3.map((w) => {
    let i = 0;
    while (i < w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i]) || ["nice", "env", "time", "command", "npx", "sudo"].includes(w[i]) || w[i - 1] === "nice" && /^-n$|^-\d+$/.test(w[i]) || w[i - 2] === "nice" && w[i - 1] === "-n")) i++;
    return w.slice(i);
  }).filter((w) => w.length);
}
var CLOSING = /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\b[\s:]+(#\d+|[A-Z][A-Z0-9_]*-\d+|https?:\/\/)/i;
var PERSON_ONLY_ACC = /* @__PURE__ */ new Set(["set", "dispatch", "land", "review", "autopilot", "analyze", "promote", "deploy", "init", "cleanup", "agents", "setup", "update", "updates", "resume", "machine", "collect", "cloud", "gate waive", "gate relax", "gate required", "gate builder", "rules import", "trackers set", "tidy add", "tidy skip", "rules accept", "rules dismiss", "github use"]);
function expands(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "`" || c === "$") return true;
    if (c === '"') quote = quote ? null : '"';
    else if (c === "'" && !quote) quote = "'";
  }
  return false;
}
var isAcc = (cmd) => !!cmd && cmd.split("/").pop() === "acc";
function guardBash(b, line) {
  const commands = commandsOf(line);
  const ending = commands.find(([cmd, sub]) => isAcc(cmd) && (sub === "done" || sub === "block"));
  if (ending && expands(line)) {
    const again = ending[1] === "block" ? ending.includes("--client") ? 'acc block --client "<your question for the client>"' : 'acc block "<what you need>"' : DONE_COMMAND;
    return `The shell would run or expand a backtick or $ in that before acc saw your words. Write it again without them, in double quotes, all on one line: ${again}`;
  }
  for (const w of commands) {
    const [cmd, sub, ...rest] = w;
    const args = [sub, ...rest].filter((x2) => !!x2);
    if (cmd === "git") {
      if (sub === "push") return "Builders never push. Finish with acc done: a person lands your branch with acc land, which pushes it and opens the pull request.";
      if (args.includes("--no-verify") || sub === "commit" && args.includes("-n")) return "Don't skip the repo's git hooks (--no-verify). If a hook fails, fix what it found.";
      if (sub === "commit") {
        const message2 = args.filter((a2, i) => args[i - 1] === "-m" || args[i - 1] === "--message" || a2.startsWith("--message=")).join("\n");
        if (CLOSING.test(message2)) return `Don't close the ticket from a commit message ("fixes", "closes" or "resolves"): a person closes it. Refer to it plainly, as refs #12.`;
      }
      if (sub === "switch" || sub === "checkout" && !args.includes("--") && args.some((a2) => !a2.startsWith("-"))) return `Stay on your branch, ${b.task.run?.branch ?? "the task's branch"}, in your worktree. To restore a file, use git checkout -- <file>.`;
      if (sub === "worktree") return "acc makes and removes worktrees. Work in the one you have.";
      if (sub === "reset" && args.includes("--hard")) return "Don't reset --hard: it throws away work. Revert or amend what you need instead.";
    }
    if (cmd === "gh" && sub === "pr" && ["merge", "create", "close"].includes(rest[0] ?? "")) return "Pull requests are a person's: acc land opens one after review, and a person merges it.";
    if (cmd === "gh" && sub === "release" && ["create", "upload", "edit", "delete"].includes(rest[0] ?? "") || cmd === "npm" && (sub === "run" || sub === "run-script") && rest[0] === "release" || cmd === "node" && args.some((a2) => a2.endsWith("scripts/release.mjs"))) return "Releases are a person's: they run npm run release on main, after the merge. Finish with acc done.";
    if (cmd === "sf" && sub === "project" && rest[0] === "deploy") {
      const verb = rest[1];
      if (verb === "quick" || verb === "resume" || verb === "start" && !rest.includes("--dry-run")) return "Builders validate and never deploy (D-011). Use acc gate run validate, which is a check-only deploy.";
    }
    if (cmd === "sf" && sub === "org" && rest[0] === "delete") return "Builders never delete an org.";
    const two = `${sub} ${rest[0] ?? ""}`;
    if (isAcc(cmd) && sub && (PERSON_ONLY_ACC.has(sub) || PERSON_ONLY_ACC.has(two))) {
      return `acc ${PERSON_ONLY_ACC.has(sub) ? sub : two} is a person's. A builder finishes with acc done, or acc block "<what you need>".`;
    }
    if (isAcc(cmd) && sub === "sync" && rest.some((a2) => a2 === "--close-done" || a2.startsWith("--close-done="))) {
      return `acc sync --close-done is a person's: it closes GitHub issues. A builder finishes with acc done, or acc block "<what you need>".`;
    }
  }
  return null;
}
function guardAnalyst(line) {
  const allowed = [...ANALYST_COMMANDS.any, ...ANALYST_COMMANDS.salesforce].map((c) => c.split(" "));
  for (const w of commandsOf(line)) {
    if (!allowed.some((a2) => a2.every((word, i) => w[i] === word))) {
      return `The analyst only reads: ${w.slice(0, 3).join(" ")} isn't one of its commands. Use git log, show, diff or grep, or the read-only sf commands (org display, data query, sobject describe, org list metadata, limits, project retrieve start).`;
    }
    if (w[0] === "sf" && w[1] === "project" && w.includes("--output-dir") && w.some((x2) => x2.startsWith("/") || x2.startsWith(".."))) {
      return "Retrieve into your working folder, the scratch project, without --output-dir.";
    }
  }
  return null;
}
var deny = (reason) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
function preToolUseHook(input, ctx) {
  if (ctx.env.ACC_ROLE === "analyst") {
    const tool2 = input.tool_name ?? "";
    if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool2)) return deny("The analyst changes nothing. Put what you would change in the approach.");
    if (tool2 === "Bash") {
      const reason = guardAnalyst(String(input.tool_input?.command ?? ""));
      return reason ? deny(reason) : null;
    }
    return null;
  }
  const b = builderFor(ctx);
  if (!b) return null;
  const tool = input.tool_name ?? "";
  const t = input.tool_input ?? {};
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
    let list = [];
    try {
      list = readList(b.worktree, loadConfig(join22(b.worktree, ".acc", "config.json")).config.environmentSpecific);
    } catch {
      list = [];
    }
    const reason = guardEdit(b, String(t.file_path ?? t.notebook_path ?? ""), list);
    return reason ? deny(reason) : null;
  }
  if (tool === "Bash") {
    const reason = guardBash(b, String(t.command ?? ""));
    return reason ? deny(reason) : null;
  }
  return null;
}
function shortPacket(task, gates, full = []) {
  return [
    `You are the builder for ${task.id}: ${task.title}.`,
    `Work only in ${task.run?.worktree}, on ${task.run?.branch}.`,
    `Finish line: commit everything, run exactly \`acc gate run\`${gates.length ? ` (${gates.join(", ")})` : ""}, then finish with your note, all on one line: \`${DONE_COMMAND}\`. Give a flag again for each further line; use double quotes, with no backticks or $ inside. If you're stuck, run \`acc block "<what you need>"\` and stop.`,
    ...full.length ? [`The full check (${full.join(", ")}) runs once, in the merge queue, before the merge.`] : [],
    "Never push, merge a pull request, open one, or deploy.",
    // Every project's rules (GH-104), which keep parallel work mergeable, in one line.
    "Rules: put new behaviour in its own file, registered with one line where a list names every area; if another task's change breaks your build, `acc block` with the reason and don't edit its files; write a manifest or config file whole, to a temp file then a rename.",
    `Your full instructions: acc show ${task.id}.`
  ].join("\n");
}
function sessionStartHook(input, ctx) {
  const b = builderFor(ctx);
  if (!b) return null;
  const id = input.session_id;
  if (id && b.task.run && b.task.run.sessionId !== id) {
    try {
      mutate(repoPaths(b.root, ctx.run), ctx.now, (l3, emit) => {
        const t = l3.tasks.find((x2) => x2.id === b.task.id);
        if (!t?.run || t.run.sessionId === id) return;
        t.run.sessionId = id;
        emit({ type: "task.updated", task: t.id, actor: "builder", by: `builder:${t.id}`, data: { sessionId: id } });
      });
    } catch {
    }
  }
  if (input.source !== "resume" && input.source !== "compact") return null;
  let gates = [];
  let full = [];
  try {
    const config = loadConfig(join22(b.root, ".acc", "config.json")).config;
    gates = requiredGates(config, b.task.environment, "builder");
    full = builderGatesFor(config, b.task.environment) ? fullGates(config).filter((g) => !gates.includes(g)) : [];
  } catch {
    gates = [];
  }
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: shortPacket(b.task, gates, full) } };
}
var remindedPath = (stateDir, sessionId) => join22(stateDir, "hooks", `${(sessionId ?? "session").replace(/[^A-Za-z0-9-]/g, "")}.reminded`);
function stopHook(input, ctx) {
  if (input.stop_hook_active) return null;
  const b = builderFor(ctx);
  if (!b || b.task.state !== "running") return null;
  const paths = repoPaths(b.root, ctx.run);
  const mark = remindedPath(paths.stateDir, input.session_id);
  if (existsSync16(mark)) return null;
  try {
    mkdirSync22(dirname9(mark), { recursive: true });
    writeFileSync23(mark, ctx.now().toISOString());
  } catch {
    return null;
  }
  return {
    decision: "block",
    reason: `${b.task.id} is still running. If the work is done: commit everything, run exactly \`acc gate run\`, then finish with your note, all on one line: \`${DONE_COMMAND}\`. If you can't finish it, run \`acc block "<what you need>"\` and stop. If you are still working, carry on.`
  };
}
function parseEventInput(text) {
  try {
    const x2 = JSON.parse(text);
    return x2 && typeof x2 === "object" ? x2 : null;
  } catch {
    return null;
  }
}

// packages/core/src/transcript.ts
import { closeSync as closeSync3, existsSync as existsSync17, openSync as openSync3, readdirSync as readdirSync9, readFileSync as readFileSync24, readSync as readSync3, statSync as statSync7 } from "node:fs";
import { homedir as homedir6 } from "node:os";
import { join as join23 } from "node:path";
function claudeProjectsDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR ? join23(env.CLAUDE_CONFIG_DIR, "projects") : join23(env.HOME || homedir6(), ".claude", "projects");
}
var transcriptDir = (projectsDir, cwd) => `${projectsDir}/${cwd.replace(/[^A-Za-z0-9]/g, "-")}`;
function savedDir(projectsDir, file, likely) {
  for (const f of new Set(likely.filter((c) => !!c))) {
    const dir2 = transcriptDir(projectsDir, f);
    if (existsSync17(join23(dir2, file))) return { dir: dir2, folder: f };
  }
  let dirs;
  try {
    dirs = readdirSync9(projectsDir);
  } catch {
    return null;
  }
  const dir = dirs.find((d) => existsSync17(join23(projectsDir, d, file)));
  return dir ? { dir: `${projectsDir}/${dir}`, folder: null } : null;
}
function transcriptFile(projectsDir, sessionId, likely) {
  const file = `${sessionId}.jsonl`;
  const found = savedDir(projectsDir, file, likely);
  return found ? join23(found.dir, file) : null;
}
function savedFolder(projectsDir, sessionId, likely) {
  const file = `${sessionId}.jsonl`;
  const found = savedDir(projectsDir, file, likely);
  if (!found) return null;
  if (found.folder) return found.folder;
  let text;
  try {
    text = readFileSync24(join23(found.dir, file), "utf8");
  } catch {
    return null;
  }
  for (const m of text.matchAll(/"cwd":("(?:[^"\\]|\\.)*")/g)) {
    let cwd;
    try {
      cwd = JSON.parse(m[1]);
    } catch {
      continue;
    }
    if (typeof cwd === "string" && transcriptDir(projectsDir, cwd) === found.dir) return cwd;
  }
  return null;
}
var TAIL_BYTES = 256 * 1024;
function* assistantTurns(file) {
  let fd;
  try {
    fd = openSync3(file, "r");
  } catch {
    return;
  }
  let text;
  try {
    const size = statSync7(file).size;
    const from = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - from);
    readSync3(fd, buf, 0, buf.length, from);
    text = buf.toString("utf8");
    if (from > 0) text = text.slice(text.indexOf("\n") + 1);
  } catch {
    return;
  } finally {
    closeSync3(fd);
  }
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"assistant"')) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r?.type === "assistant" && !r.isSidechain) yield r;
  }
}
function lastSaidIn(file) {
  for (const r of assistantTurns(file)) {
    if (!Array.isArray(r.message?.content)) continue;
    const said2 = r.message.content.filter((b) => b?.type === "text" && typeof b.text === "string" && b.text.trim()).map((b) => b.text.trim());
    if (said2.length) return said2[said2.length - 1];
  }
  return null;
}
function lastSaid(projectsDir, sessionId, likely) {
  const file = transcriptFile(projectsDir, sessionId, likely);
  return file ? lastSaidIn(file) : null;
}

// packages/core/src/resume.ts
var resumingPath = (paths, id) => join24(paths.stateDir, "resumes", `${id}.json`);
function resuming(paths, id) {
  try {
    const r = JSON.parse(readFileSync25(resumingPath(paths, id), "utf8"));
    return Number.isInteger(r.pid) && r.pid > 0 && alive(r.pid) ? r : null;
  } catch {
    return null;
  }
}
function endResume(paths, id) {
  const r = resuming(paths, id);
  rmSync14(resumingPath(paths, id), { force: true });
  releaseAwake(paths, id);
  if (!r) return false;
  try {
    process.kill(-r.pid, "SIGTERM");
  } catch {
    try {
      process.kill(r.pid, "SIGTERM");
    } catch {
      return false;
    }
  }
  return true;
}
function listSessions(run2, cwd) {
  const r = run2("claude", ["agents", "--json"], { cwd, timeoutMs: 2e4 });
  if (r.code !== 0) return null;
  try {
    const list = parseJsonOutput(r.stdout);
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}
var clipSaid = (said2, max = 300) => {
  const one = said2.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}\u2026` : one;
};
function resumeMessage(task, said2, head) {
  const quote = said2 ? clipSaid(said2, 1500) : null;
  return [
    `You are the builder for ${task.id}: ${task.title}. Your last turn ended before you ran acc done or acc block, so ${task.id} is still running.${quote ? " The last thing you said was:" : ""}`,
    ...quote ? ["", `> ${quote}`] : [],
    "",
    "If you were cut off, carry on from where you left off. If you stopped to ask something, decide it yourself where the task allows, or block and ask.",
    "",
    `Start with \`git status\` and \`git log --oneline -3\`${head ? ` (your branch's latest commit is ${head})` : ""}, then finish the task and its finish line: commit everything, run exactly \`acc gate run\`, then finish with your note, all on one line: \`${DONE_COMMAND}\`. If you're stuck, run exactly \`acc block "<what you need>"\` and stop.`
  ].join("\n");
}
function resumeCommand(task, config, i) {
  const settings = JSON.stringify(builderSettings(task, config, i.accBinDir, i.basePath, i.accCommand));
  const { model } = builderModel(task, config);
  const { effort, picked } = builderEffort(task, config);
  checkModelEffort(model, effort, effortFixWords(task.id, picked, model, "resume"));
  const name = task.run?.name ? ["--name", task.run.name] : [];
  return {
    args: ["-p", i.message, "--resume", i.sessionId, ...name, "--permission-mode", config.agents.permissionMode, ...agentArgs({ ...config.agents.builder, model, effort }), "--settings", settings],
    env: { ACC_ROLE: "builder", ACC_TASK: task.id },
    model,
    effort
  };
}
var launchDetached = (cmd, args, o) => {
  const fd = openSync4(o.log, "a");
  try {
    const child = spawn2(cmd, args, { cwd: o.cwd, env: o.env, detached: true, stdio: ["ignore", fd, fd] });
    child.on("error", () => void 0);
    child.unref();
    return child.pid ?? null;
  } finally {
    closeSync4(fd);
  }
};
function activeWhy(id, s) {
  if (s.kind !== "background") return `${id}'s conversation is open in a terminal or a Claude Code tab, or a message to it is running: carry on there.`;
  if (s.state === "blocked" || s.status === "waiting") return `${id}'s agent is waiting for you in its own prompt: answer it there, with Open in Claude Code or claude attach ${s.id ?? ""}.`.replace(/ \.$/, ".");
  return `${id}'s agent is still working.`;
}
function resume(paths, config, id, deps, opts) {
  const { now: now2 } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  if (task.state !== "running") throw new AccError("refused", `${id} is ${task.state}. Only a running task's builder is resumed.`);
  const sessionId = task.run?.sessionId;
  if (!sessionId) throw new AccError("refused", `${id} has no session to carry on. Abandon it and dispatch it again.`);
  const worktree = task.run?.worktree;
  if (!worktree || !existsSync18(worktree)) throw new AccError("refused", `${id}'s worktree isn't on disk any more, so there's nowhere to carry on.`);
  const marker = resumingPath(paths, id);
  const log = join24(paths.logs, `${id}.resume.log`);
  claimResume(paths, id, { sessionId, pid: process.pid, startedAt: now2().toISOString(), by: opts.by, log });
  try {
    return resumeClaimed(paths, config, id, deps, opts, { task, sessionId, worktree, marker, log });
  } catch (e) {
    if (readMarker(marker)?.pid === process.pid) rmSync14(marker, { force: true });
    throw e;
  }
}
function readMarker(file) {
  try {
    return JSON.parse(readFileSync25(file, "utf8"));
  } catch {
    return null;
  }
}
function claimResume(paths, id, claim) {
  const file = resumingPath(paths, id);
  mkdirSync23(dirname10(file), { recursive: true });
  for (let tries = 0; tries < 2; tries++) {
    try {
      writeFileSync24(file, JSON.stringify(claim), { flag: "wx" });
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const already = resuming(paths, id);
      if (already) throw new AccError("refused", `${id} is already being resumed (pid ${already.pid}).`);
      rmSync14(file, { force: true });
    }
  }
  throw new AccError("refused", `${id} is already being resumed.`);
}
function resumeClaimed(paths, config, id, deps, opts, c) {
  const { run: run2, now: now2 } = deps;
  const { task, sessionId, worktree, log } = c;
  const sessions = listSessions(run2, paths.root);
  if (!sessions) throw new AccError("refused", `claude agents didn't answer, so acc can't tell whether ${id}'s agent is still at work. Try again in a moment.`);
  const mine = sessionsOf(task, sessions);
  const active = mine.find(sessionActive);
  if (active) throw new AccError("agent-active", activeWhy(id, active));
  const projectsDir = deps.projectsDir ?? claudeProjectsDir(deps.env);
  const folder = savedFolder(projectsDir, sessionId, [worktree, ...mine.map((s) => s.cwd), paths.root]);
  if (!folder) throw new AccError("refused", `${id}'s conversation (${sessionId}) isn't saved anywhere this machine can find.`);
  const said2 = lastSaid(projectsDir, sessionId, [folder]);
  const head = run2("git", ["log", "-1", "--format=%h"], { cwd: worktree }).stdout.trim() || null;
  const message2 = opts.message?.trim() || resumeMessage(task, said2, head);
  const cmd = resumeCommand(task, withCloneAgents(config, paths.root, run2), { sessionId, message: message2, accBinDir: deps.accBinDir, basePath: deps.env.PATH ?? "", accCommand: deps.accCommand });
  let stopped = null;
  for (const s of mine) {
    if (s.kind !== "background" || !s.id || !s.pid) continue;
    const r = run2("claude", ["stop", s.id], { cwd: paths.root, timeoutMs: 3e4 });
    if (r.code !== 0) throw new AccError("refused", `${id}'s background session ${s.id} wouldn't stop: ${(r.stderr || r.stdout).trim().split("\n")[0]}`);
    stopped = s.id;
  }
  mkdirSync23(dirname10(log), { recursive: true });
  const at2 = now2().toISOString();
  appendFileSync3(log, `
--- ${at2}: ${id} resumed by ${opts.by}, in ${folder} ---
`);
  const pid = (deps.launch ?? launchDetached)("claude", cmd.args, { cwd: folder, env: { ...deps.env, ...cmd.env }, log });
  if (!pid) throw new AccError("resume", `Claude Code didn't start. Its output is in ${log}.`);
  keepAwakeFor(paths, id, pid, deps.awake);
  writeFileSync24(c.marker, JSON.stringify({ sessionId, pid, startedAt: at2, by: opts.by, log }));
  rmSync14(remindedPath(paths.stateDir, sessionId), { force: true });
  try {
    const recorded = mutate(paths, now2, (l3, emit) => {
      const t = l3.tasks.find((x2) => x2.id === id);
      if (!t?.run || t.state !== "running") throw new AccError("refused", `${id} left running meanwhile, so its resume was stopped.`);
      t.run.resumes = [...t.run.resumes ?? [], { at: at2, actor: opts.actor, by: opts.by }];
      t.run.model = cmd.model;
      if (cmd.effort) t.run.effort = cmd.effort;
      else delete t.run.effort;
      if (t.autopilot?.failed) t.autopilot.failed = null;
      t.updatedAt = at2;
      emit({ type: "task.updated", task: id, actor: opts.actor, by: opts.by, data: { resumed: { said: said2 ? clipSaid(said2) : null } } });
      return t;
    });
    return { task: recorded, sessionId, pid, folder, log, message: message2, said: said2, stopped };
  } catch (e) {
    endResume(paths, id);
    throw e;
  }
}

// packages/core/src/autopilot-rules.ts
var short4 = (sha) => sha.slice(0, 7) || "no commit";
var sentence2 = (text) => text.replace(/([^.!?])$/, "$1.");
function reworkedByAutopilot(task, before) {
  let own = false;
  for (const h2 of task.history) {
    if (before !== void 0 && h2.at >= before) break;
    if (h2.to === "rework") own = sentBackByAutopilot(h2);
    else if (h2.from === "rework" && h2.to === "running" && h2.actor === "orchestrator" && !own) return true;
  }
  return false;
}
function failedChecks(task) {
  const pr = task.pr;
  if (task.state === "review" && pr?.state === "open" && pr.ci === "failing" && pr.failing?.length) return pr.failing;
  const back = task.autopilot?.sentBack;
  if (task.state === "rework" && back?.checks.length && reworkCause(task) === "checks") return back.checks;
  return null;
}
var resumedByAutopilot = (task) => !!task.run?.resumes?.some((r) => byAutopilot(r.by));
function capWait(ledger, config, except, machine) {
  const n = builders(ledger, except);
  if (n >= config.agents.max) return projectCapWords(n, config.agents.max);
  return machineCapProblem(ledger, except, machine ?? null);
}
function nextStep(ledger, config, task, facts) {
  const step = (s, reason) => {
    const f = task.autopilot?.failed;
    if (f && f.step === s && f.sha === facts.head && f.state === task.state) {
      return { step: null, outcome: "waiting", reason: `Autopilot couldn't ${failedWords(s, f.sha)}: ${sentence2(f.reason)} It waits for a person, or a new commit.` };
    }
    return { step: s, outcome: null, reason };
  };
  const none = (outcome, reason) => ({ step: null, outcome, reason });
  if (task.state === "review") {
    if (facts.reviewing) return none("waiting", `A review is running (session ${facts.reviewing}).`);
    if (!facts.verdict) return step("review", `Nothing has reviewed ${short4(facts.head)} yet.`);
    if (facts.verdict === "changes") return none("waiting", `Its review on ${short4(facts.head)} asked for changes, and it's still in review: a person decides.`);
    const pr = task.pr;
    if (pr?.state === "merged") return none("skipped", `Pull request #${pr.number} merged.`);
    const closed = closedPr(task);
    if (closed) return none("waiting", `Pull request #${closed.number} was closed without merging. Autopilot won't replace it: reopen it on GitHub and land to update it, or land to open a new one.`);
    if (pr?.state !== "open") return step("land", `Its review passed on ${short4(facts.head)}, and it has no pull request.`);
    if (facts.landed === facts.head) {
      if (autoMergeFor(config, task.environment)) return queueStep(task, facts, step, none);
      if (pr.conflicts?.length) return step("refresh", `Pull request #${pr.number} conflicts with ${task.environment} in ${pr.conflicts.join(", ")}.`);
      const checks = checksStep(task, facts, step, none);
      if (checks) return checks;
      return none("skipped", `Pull request #${pr.number} is up to date with ${short4(facts.head)}.`);
    }
    return step("land", `Its review passed on ${short4(facts.head)}, and pull request #${pr.number} is behind it.`);
  }
  if (task.state === "rework") {
    const cause = reworkCause(task);
    const own = cause === "checks" || cause === "queue";
    if (!own && reworkedByAutopilot(task)) return none("waiting", "Autopilot re-dispatched it once already. A second rework waits for a person.");
    const capped = capWait(ledger, config, task.id, facts.machine);
    if (capped) return none("waiting", capped);
    const back = task.autopilot?.sentBack;
    if (cause === "queue") return step("dispatch", back?.conflicts?.length ? `The merge queue found it conflicts with ${task.environment}: ${back.conflicts.join(", ")}.` : `The merge queue's full check failed: ${back?.checks.join(", ") || "see its report"}.`);
    return step("dispatch", own ? `Checks failed on GitHub: ${back?.checks.join(", ") || "see its pull request"}.` : "The reviewer asked for changes.");
  }
  if (task.state === "todo") {
    const held = task.held;
    if (!held) return none("skipped", "To do: autopilot starts a task to do only once a person has dispatched it.");
    if (held.failed) return none("waiting", `Its start failed: ${sentence2(held.failed.reason)} It waits for a person.`);
    const s = facts.start;
    if (!s) return none("waiting", "Autopilot couldn't tell what it shares with work in flight. It looks again next pass.");
    if (s.problems.length) return none("waiting", s.problems[0]);
    if (waits(s)) return none("waiting", `${holdWords(s)}.`);
    const capped = capWait(ledger, config, task.id, facts.machine);
    if (capped) return none("waiting", capped);
    if (s.shares.length) return step("start", `Nothing else is ready to start, so it starts sharing files with ${s.shares.map((x2) => x2.task).join(", ")}.`);
    return step("start", held.waitsFor.length ? `${held.waitsFor.map((x2) => x2.task).join(", ")}'s files are free.` : "Nothing in flight shares its files.");
  }
  if (task.state === "running") {
    if (!facts.stopped) return none("skipped", "Its builder is working.");
    if (resumedByAutopilot(task)) return none("waiting", "Its agent stopped again. Autopilot resumed it once already: a person resumes it.");
    return step("resume", "Its agent stopped before acc done or acc block.");
  }
  if (task.state === "blocked") return none("skipped", "Blocked: a person decides.");
  return none("skipped", "Done.");
}
function failedWords(s, sha) {
  if (s === "refresh") return `update ${short4(sha)} from its base`;
  if (s === "checks") return `send ${short4(sha)} back for its failing checks`;
  if (s === "queue") return `take ${short4(sha)} through the merge queue`;
  if (s === "start") return "start it";
  return `${s} ${short4(sha)}`;
}
var names = (list) => list.join(", ");
function checksStep(task, facts, step, none, queueing = false) {
  const pr = task.pr;
  const head = facts.head;
  const f = task.autopilot?.failed;
  if (f?.step === "checks" && f.sha === head && f.state === task.state) return step("checks", "");
  const settling = (reason, checks = false) => ({ step: null, outcome: "waiting", reason, ...queueing ? { settles: true, ...checks ? { checks: true } : {} } : {} });
  if (facts.checksError) return settling(`Autopilot couldn't read pull request #${pr.number}'s checks on GitHub: ${sentence2(facts.checksError)} It tries again next pass.`);
  const c = facts.checks;
  if (!c) return null;
  if (c.sha !== head) return queueing ? null : settling(`Pull request #${pr.number} is at ${short4(c.sha)} on GitHub, not ${short4(head)}: a land or a person comes first.`);
  if (c.pending.length) return settling(`Checks are still running on GitHub: ${names(c.pending)}.`, true);
  if (!c.failed.length) return null;
  const failed = names(c.failed.map((x2) => x2.name));
  if (!c.failed.some((x2) => x2.job)) return none("waiting", `Checks failed on GitHub: ${failed}. GitHub keeps no log for ${c.failed.length === 1 ? "it" : "them"}, so autopilot doesn't send it back: a person decides.`);
  const record2 = (reason) => ({ step: null, outcome: "waiting", reason, record: { step: "checks", reason } });
  if (sentBackAt(task, head)) return record2(`Checks failed on GitHub again: ${failed}. Autopilot already sent ${short4(head)} back once: a person decides.`);
  if (sendBacks(task) >= SEND_BACKS) return record2(`Checks failed on GitHub: ${failed}. Autopilot sent ${task.id} back ${queueing ? "to its builder" : "for failing checks"} ${SEND_BACKS} times already: a person decides.`);
  return step("checks", `Checks failed on GitHub on ${short4(head)}: ${failed}.`);
}
function queueStep(task, facts, step, none) {
  const pr = task.pr;
  const merged = task.autopilot?.merged;
  if (merged?.sha === facts.head) return none("skipped", `Autopilot merged pull request #${merged.pr.number}. acc sync moves it to done.`);
  const f = task.autopilot?.failed;
  if (f && (f.step === "merge" || f.step === "queue") && f.sha === facts.head && f.state === task.state) return step(f.step, "");
  const checks = checksStep(task, facts, step, none, true);
  if (checks) return checks.settles ? { ...checks, queue: "hold" } : checks;
  const failure = autopilotFailure(task);
  if (failure) return none("waiting", `Autopilot couldn't ${failedWords(failure.step, failure.sha)}: a person decides before it merges.`);
  if (pr.changesRequested) return none("waiting", `A person asked for changes on pull request #${pr.number}, so autopilot doesn't merge it.`);
  if (facts.asking) return none("waiting", `An agent in ${task.id}'s worktree is waiting for your answer: it joins the merge queue once you've answered.`);
  const hold = (reason, checks2 = false) => ({ step: null, outcome: "waiting", reason, queue: "hold", ...checks2 ? { checks: true } : {} });
  const c = facts.checks;
  if (!c) return hold(`Autopilot hasn't read pull request #${pr.number}'s checks on GitHub yet.`);
  const moved = c.sha !== facts.head;
  if (!moved && c.cancelled.length) {
    const reason = `Checks were cancelled on GitHub: ${names(c.cancelled)}. Run them again, or merge it yourself.`;
    return { step: null, outcome: "waiting", reason, record: { step: "merge", reason } };
  }
  if (!moved && !c.count && !pr.conflicts?.length && (c.required || facts.noChecksYet)) return hold(`GitHub reports no checks on pull request #${pr.number} yet. Autopilot gives them 2 minutes after a land.`, true);
  const placed = inQueueAt(task, facts.head);
  if (!placed) {
    const acc = facts.accChanges?.() ?? [];
    if (acc.length) {
      const reason = `It changes .acc/, which a person merges: ${acc.join(", ")}.`;
      return { step: null, outcome: "waiting", reason, record: { step: "merge", reason } };
    }
  }
  if (moved) return { step: null, outcome: "waiting", reason: `Pull request #${pr.number} is at ${short4(c.sha)} on GitHub, not ${short4(facts.head)}, the commit acc landed: at its turn the merge queue fetches it, and a commit this clone lacks needs a person.`, queue: "in" };
  return { step: null, outcome: "waiting", reason: placed ? "In the merge queue." : `Pull request #${pr.number} passed its review and its checks on ${short4(facts.head)}: it joins the merge queue.`, queue: "in" };
}
function inQueueAt(task, head) {
  const q2 = task.autopilot?.queued;
  return task.state === "review" && !!q2 && !!head && (q2.sha === head || task.autopilot?.carried?.to === head);
}
function checksWanted(task, facts, merging2) {
  const pr = task.pr;
  if (task.state !== "review" || pr?.state !== "open" || facts.verdict !== "pass" || facts.reviewing) return false;
  if (!facts.head || pr.sha !== facts.head || facts.landed !== facts.head || !merging2 && pr.conflicts?.length) return false;
  if (merging2 ? task.autopilot?.merged?.sha === facts.head : pr.ci === "passing") return false;
  const f = task.autopilot?.failed;
  return !(f && (f.step === "checks" || f.step === "merge") && f.sha === facts.head && f.state === task.state);
}
var settledChecks = /* @__PURE__ */ new Map();
function taskFacts(paths, task, run2, sessions = null, now2 = /* @__PURE__ */ new Date(), github) {
  const facts = { head: "", verdict: null, reviewing: null, landed: null };
  if (task.state !== "review" && task.state !== "rework" && task.state !== "running") return facts;
  const branch = task.run?.branch;
  const rev = (ref) => run2("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: paths.root }).stdout.trim();
  facts.head = branch ? rev(`refs/heads/${branch}`) : "";
  if (task.state === "running") {
    facts.stopped = builderStopped(task, sessions, { resuming: !!resuming(paths, task.id), now: now2 });
    return facts;
  }
  if (task.state !== "review") return facts;
  facts.reviewing = reviewing(paths, task.id)?.sessionId ?? null;
  facts.verdict = facts.head ? readVerdict(paths, task.id, facts.head)?.verdict ?? (carriedVerdict(paths, task, facts.head) ? "pass" : null) : null;
  if (task.pr?.state === "open") facts.landed = task.pr.sha ?? (branch ? rev(`refs/remotes/origin/${branch}`) || null : null);
  const merging2 = !!github?.autoMerge?.(task.environment);
  if (github && checksWanted(task, facts, merging2)) {
    const key = `${paths.ledger}#${task.id}`;
    const settled = settledChecks.get(key);
    if (settled?.sha === facts.head) facts.checks = settled.checks;
    else {
      try {
        facts.checks = readChecks(run2, github.repo, task.pr.number, github.env());
        const c = facts.checks;
        if (c && c.sha === facts.head && c.count && !c.pending.length && !c.failed.some((x2) => x2.job)) settledChecks.set(key, { sha: facts.head, checks: c });
      } catch (e) {
        facts.checksError = firstLines(e.message ?? String(e));
      }
    }
    const landedAt = Date.parse(task.pr?.landedAt ?? "");
    if (facts.checks && !facts.checks.count && Number.isFinite(landedAt)) facts.noChecksYet = now2.getTime() - landedAt < NO_CHECKS_GRACE_MS;
  }
  if (merging2 && branch && facts.head) {
    const base = task.environment;
    const head = facts.head;
    facts.accChanges = () => {
      const r = run2("git", ["diff", "--name-only", "--no-renames", `refs/remotes/origin/${base}...${head}`, "--", ".acc"], { cwd: paths.root });
      return r.code === 0 ? r.stdout.split("\n").filter(Boolean) : [];
    };
  }
  const wt2 = task.run?.worktree;
  if (merging2 && wt2 && task.pr?.state === "open" && facts.verdict === "pass" && github?.asking) facts.asking = github.asking(wt2);
  return facts;
}
var firstLines = (text) => text.trim().split("\n").slice(0, 3).join(" ").replace(/\s+/g, " ");

// packages/core/src/autopilot.ts
import { mkdirSync as mkdirSync25, readFileSync as readFileSync27 } from "node:fs";
import { join as join25 } from "node:path";

// packages/core/src/queue.ts
import { mkdirSync as mkdirSync24, readFileSync as readFileSync26, writeFileSync as writeFileSync25 } from "node:fs";
var short5 = (sha) => sha.slice(0, 7) || "no commit";
function queueOrder(ledger, config) {
  const index = new Map(ledger.tasks.map((t, i) => [t.id, i]));
  return ledger.tasks.filter((t) => inQueue(t, config)).sort((a2, b) => a2.autopilot.queued.at.localeCompare(b.autopilot.queued.at) || index.get(a2.id) - index.get(b.id));
}
function ordinal(n) {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}
function queuePlaces(ledger, config) {
  const order = queueOrder(ledger, config);
  return order.map((t, i) => ({ id: t.id, place: i + 1, of: order.length, ahead: i ? order[i - 1].id : null, phase: t.autopilot.queued.phase, why: t.autopilot.queued.why ?? null }));
}
function phaseWords(phase, base, why) {
  return {
    waiting: "Next to merge",
    refreshing: `Merging ${base} in`,
    slot: "Waiting for a heavy-check slot",
    checking: "Running the full check",
    github: "Waiting for GitHub's checks",
    held: why?.trim().replace(/\.$/, "") || "Waiting",
    merging: "Merging"
  }[phase];
}
function setQueued(paths, now2, id, who, change2) {
  mutate(paths, now2, (l3, emit) => {
    const t = l3.tasks.find((x2) => x2.id === id);
    if (!t || !change2(t)) return;
    t.updatedAt = now2().toISOString();
    emit({ type: "task.updated", task: id, actor: who.actor, by: who.by, data: { queued: t.autopilot?.queued ?? null } });
  });
}
function joinQueue(paths, now2, id, sha, who) {
  setQueued(paths, now2, id, who, (t) => {
    if (t.state !== "review") return false;
    t.autopilot = { failed: null, ...t.autopilot, queued: { at: now2().toISOString(), sha, phase: "waiting" } };
    return true;
  });
}
function leaveQueue(paths, now2, id, who) {
  setQueued(paths, now2, id, who, (t) => {
    if (!t.autopilot?.queued) return false;
    t.autopilot.queued = null;
    return true;
  });
}
function setPhase(paths, now2, id, phase, who, why) {
  setQueued(paths, now2, id, who, (t) => {
    const q2 = t.autopilot?.queued;
    if (!q2 || q2.phase === phase && q2.why === why) return false;
    t.autopilot.queued = { at: q2.at, sha: q2.sha, phase, ...why ? { why } : {} };
    return true;
  });
}
function holdHead(paths, now2, id, wait, who) {
  if (wait.checks) setPhase(paths, now2, id, "github", who);
  else setPhase(paths, now2, id, "held", who, wait.why);
}
var asMerge = (e) => Object.assign(e, { step: "merge" });
function queueTurn(paths, config, id, deps, who) {
  const { run: run2, now: now2 } = deps;
  const ledger = readLedger(paths.ledger);
  const task = ledger.tasks.find((t) => t.id === id);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  const waits2 = (why) => new AccError("merge-waits", why);
  if (queueOrder(ledger, config)[0]?.id !== id) throw waits2(`${id} isn't at the head of the merge queue any more.`);
  const pr = task.pr;
  if (pr?.state !== "open") throw waits2(`${id} has no open pull request.`);
  const env = environmentByBranch(config, task.environment);
  if (!env) throw new AccError("queue", `${id}'s environment "${task.environment}" isn't in the config.`);
  const branch = task.run?.branch;
  const git10 = (...args) => run2("git", args, { cwd: paths.root });
  const head = branch ? git10("rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).stdout.trim() : "";
  if (!branch || !head) throw new AccError("queue", `${id}'s branch isn't in this clone.`);
  if (pr.sha !== head) throw waits2(`Pull request #${pr.number} was landed at ${short5(pr.sha ?? "")}, not ${short5(head)}: a land comes first.`);
  const phase = (p, why) => setPhase(paths, now2, id, p, who, why);
  if (!fetchBranches(run2, paths.root, [env.branch, branch], { ...deps.env, GIT_TERMINAL_PROMPT: "0" })) throw waits2(`Couldn't fetch ${env.branch} and ${branch} from origin.`);
  const remote = git10("rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`).stdout.trim();
  if (remote !== head) {
    const more = !remote || git10("merge-base", "--is-ancestor", remote, head).code !== 0;
    throw new AccError("queue", more ? `origin's ${branch} has commits this clone's branch doesn't, perhaps pushed on GitHub, such as with Update branch. Bring them into ${short5(head)} by hand, and autopilot reviews it again.` : `origin's ${branch} is at ${short5(remote)}, behind ${short5(head)}, the commit acc landed. Land it again.`);
  }
  const behind = git10("merge-base", "--is-ancestor", `refs/remotes/origin/${env.branch}`, head).code !== 0;
  let place2 = null;
  const placed = () => {
    place2 ??= mergePlace(paths, config, task, run2);
    if (place2.from !== head) throw new AccError("queue", `${place2.wt} is at ${short5(place2.from)}, not ${short5(head)}.`);
    return place2;
  };
  const found = (f) => sendBackFromQueue(paths, config, task, deps, who, f, env.branch, head);
  let made = null;
  if (behind) {
    const p = placed();
    phase("refreshing");
    try {
      made = mergeBaseIn(config, p, run2);
    } catch (e) {
      if (e instanceof MergeConflict) return found({ kind: "conflict", conflicts: e.files });
      throw e;
    }
  }
  const sha = made?.sha ?? head;
  const missing = requiredGates(config, env.branch, "merge").filter((g) => !satisfies(readReceipt(paths, sha, g)));
  if (missing.length) {
    const p = placed();
    phase("checking");
    try {
      checkCommit(paths, config, p, sha, missing, { run: run2, now: now2, slots: { ...deps.slots, onTake: () => phase("checking") }, onWait: () => phase("slot") });
    } catch (e) {
      if (e instanceof CheckFailure) return found({ kind: "check", failed: e.failed, merge: made?.sha ?? null });
      throw e;
    }
  }
  if (made) {
    const p = place2;
    const kept = made.resolved.length ? `, ${resolvedWords(made.resolved, "keeping")}` : "";
    mutate(paths, now2, (l3, emit) => {
      const t = l3.tasks.find((x2) => x2.id === id);
      if (!t) return;
      const was = t.autopilot?.carried;
      const from = was?.to === head ? was.from : head;
      const at2 = now2().toISOString();
      t.autopilot = { failed: null, ...t.autopilot, carried: { from, to: made.sha, base: env.branch, resolved: made.resolved, at: at2 } };
      t.updatedAt = at2;
      emit({ type: "task.updated", task: id, actor: who.actor, by: who.by, data: { refreshed: { base: env.branch, from: head, to: made.sha, resolved: made.resolved, queue: true } } });
    });
    let landed;
    try {
      landed = land(paths, config, id, { run: run2, now: now2, env: deps.env }, { actor: who.actor, by: who.by, gates: "merge" });
    } catch (e) {
      const pushed = git10("rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`).stdout.trim() === made.sha;
      const back = pushed ? `${short5(made.sha)} is on GitHub, but its pull request may not say so.` : undoMerge(config, p, run2);
      throw new AccError(e.code ?? "queue", `Merged ${env.branch} in as ${short5(made.sha)} and its full check passed, but it wasn't landed: ${e.message} ${back}`);
    }
    phase("github");
    return {
      step: "queue",
      outcome: "done",
      reason: `Merged ${env.branch} into ${short5(head)} as ${short5(made.sha)}${kept}, and its full check passed. Pushed it to pull request #${landed.pr.number}: it merges once GitHub's checks pass.`,
      pr: { number: landed.pr.number, url: landed.pr.url, opened: landed.opened },
      ...landed.update ? { update: landed.update } : {}
    };
  }
  phase("merging");
  try {
    const r = mergePr(paths, config, id, { run: run2, now: now2, env: deps.env }, who);
    return { step: "merge", outcome: "done", reason: r.reason, pr: { number: r.pr.number, url: r.pr.url, opened: false } };
  } catch (e) {
    if (e.code === "merge-waits") {
      const why = e.message;
      if (e.checks) phase("github");
      else phase("held", why);
      return { step: "queue", outcome: "waiting", reason: why };
    }
    throw asMerge(e);
  }
}
function tailOfFile(file) {
  if (!file) return null;
  try {
    return tailText(readFileSync26(file, "utf8")) || null;
  } catch {
    return null;
  }
}
var cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function sendBackFromQueue(paths, config, task, deps, who, f, base, head) {
  const pr = task.pr;
  const held = f.kind === "check" ? f.failed.filter((r) => r.status === "hold") : [];
  if (held.length) {
    throw new AccError("queue", `The full check${f.kind === "check" && f.merge ? ` with ${base} merged in` : ""} needs a person: ${held.map((r) => `${r.gate}: ${r.summary.replace(/[.!?]$/, "")}`).join("; ")}. A person decides: waive it on ${short5(head)}, with a reason, or ask its builder for changes.`);
  }
  const names3 = f.kind === "check" ? f.failed.map((r) => r.gate) : [];
  const why = f.kind === "conflict" ? `merging ${base} in conflicts in ${f.conflicts.join(", ")}` : `the full check failed${f.merge ? ` with ${base} merged in` : ""}: ${names3.join(", ")}`;
  const waived = f.kind === "check" ? names3.filter((g) => readReceipt(paths, head, g)?.waived) : [];
  if (waived.length) throw new AccError("queue", `${cap(why)}. ${waived.join(", ")} ${waived.length === 1 ? "was" : "were"} waived on ${short5(head)}, and a waiver holds for its own commit only: a person decides.`);
  if (sentBackAt(task, head)) throw new AccError("queue", `${cap(why)}. Autopilot already sent ${short5(head)} back once: a person decides.`);
  if (sendBacks(task) >= SEND_BACKS) throw new AccError("queue", `${cap(why)}. Autopilot sent ${task.id} back to its builder ${SEND_BACKS} times already: a person decides.`);
  const at2 = deps.now().toISOString();
  const checks = f.kind === "check" ? f.failed.map((r) => ({ gate: r.gate, status: r.status, summary: r.summary, file: r.receipt.log, log: tailOfFile(r.receipt.log) })) : [];
  const conflicts = f.kind === "conflict" ? f.conflicts : [];
  const report = { v: 1, task: task.id, sha: head, base, pr: { number: pr.number, url: pr.url }, kind: f.kind, conflicts, checks, merge: f.kind === "check" ? f.merge : null, at: at2 };
  mkdirSync24(paths.queue, { recursive: true });
  writeFileSync25(queueReportPath(paths, task.id, head), JSON.stringify(report, null, 2) + "\n");
  const reason = `The merge queue sent it back: ${why}.`;
  mutate(paths, deps.now, (l3, emit) => {
    const t = l3.tasks.find((x2) => x2.id === task.id);
    if (!t) throw new AccError("no-task", `No task ${task.id}.`);
    if (!inQueue(t, config)) throw new AccError("merge-waits", `${task.id} left the merge queue meanwhile.`);
    const req = { to: "rework", actor: who.actor, by: who.by, reason };
    const problems = checkMove(l3, config, t, req, noGateHooks);
    if (problems.length) throw new AccError("move-refused", `Can't send ${task.id} back:
- ${problems.join("\n- ")}`);
    applyMove(t, req, emit, deps.now, { kind: "queue", checks: names3, conflicts, sha: head });
    const sentBack = { sha: head, checks: names3, at: at2, kind: "queue", ...conflicts.length ? { conflicts } : {} };
    t.autopilot = { failed: null, ...t.autopilot, sentBack };
    emit({ type: "task.updated", task: task.id, actor: who.actor, by: who.by, data: { autopilot: { sentBack } } });
  });
  return { step: "queue", outcome: "done", reason: `Sent it back to its builder: ${why}.` };
}

// packages/core/src/autopilot.ts
var AUTOPILOT_MIN_EVERY_S = 30;
var AUTOPILOT_REVIEW_DOES = "reviews finished work, lands work whose review passed, re-dispatches a rework once, sends a pull request whose GitHub checks fail back to its builder once a commit, resumes a stopped builder once a run, merges the base into a pull request that conflicts with it, and starts a task a person dispatched once the files it waits for are free";
function autopilotDoes(autoMerge) {
  return autoMerge ? `${AUTOPILOT_REVIEW_DOES}. Auto-merge is on: a pull request whose review and checks passed, with nothing waiting on a person, joins the repo's merge queue, and they merge in turn. At its turn its base is merged in, the full check runs once, and it merges once GitHub says it can, or goes back to its builder. It never merges into a protected environment.` : `${AUTOPILOT_REVIEW_DOES}. It never merges a pull request.`;
}
function autopilotMode(config) {
  const autonomy = config.autonomy;
  if (autonomy === "manual") return { autonomy, on: false, warnings: [], refusal: null };
  if (autonomy === "review") return { autonomy, on: true, warnings: [], refusal: null };
  const warnings = autonomy === "full" ? ['autonomy "full" is read as "dispatch".'] : [];
  return {
    autonomy,
    on: false,
    warnings,
    refusal: `autonomy "dispatch" (autopilot also starting Ready tasks) is not built yet. Set "autonomy" to "review" in .acc/config.json: autopilot then ${AUTOPILOT_REVIEW_DOES}.`
  };
}
function realSteps(paths, config, deps) {
  const { run: run2, now: now2, env } = deps;
  return {
    review: (id) => {
      const r = review(paths, config, id, { run: run2, now: now2, env }, { by: `reviewer:${id} for ${AUTOPILOT_BY}` });
      return { reason: r.verdict.verdict === "pass" ? `Review passed: ${r.verdict.summary}` : `Review asked for changes, so it went to rework: ${r.verdict.summary}` };
    },
    land: (id) => landStep(land(paths, config, id, { run: run2, now: now2, env }, { actor: "orchestrator", by: AUTOPILOT_BY })),
    dispatch: (id) => {
      const t = readLedger(paths.ledger).tasks.find((x2) => x2.id === id);
      const cause = (t && reworkCause(t)) ?? "review";
      const r = dispatch(paths, config, id, { run: run2, now: now2, env, accBinDir: deps.accBinDir, accCommand: deps.accCommand }, { actor: "orchestrator", by: AUTOPILOT_BY, cause });
      if (r.held) throw new AccError("start-waits", `${holdWords({ shares: r.waitsFor, first: r.first })}.`);
      return { reason: `Re-dispatched${cause === "checks" ? " for its failing checks" : cause === "queue" ? " with what the merge queue found" : ""} in ${r.worktree}${r.bgId ? `, background session ${r.bgId}` : ""}.` };
    },
    // A conflict only: where auto-merge is on, the merge queue brings a pull request up to date at its turn (GH-73).
    refresh: (id) => ({ reason: refresh(paths, config, id, { run: run2, now: now2, env, slots: deps.slots }, { actor: "orchestrator", by: AUTOPILOT_BY }).reason }),
    resume: (id) => {
      const r = resume(paths, config, id, { run: run2, now: now2, env, accBinDir: deps.accBinDir, accCommand: deps.accCommand, ...deps.resume }, { actor: "orchestrator", by: AUTOPILOT_BY });
      return { reason: `Resumed its builder${r.said ? `, which last said: ${clipSaid(r.said, 200)}` : "."}` };
    },
    checks: (id) => ({ reason: sendBack(paths, config, id, { run: run2, now: now2, env }, { actor: "orchestrator", by: AUTOPILOT_BY }).reason }),
    start: (id) => {
      const r = startHeld(paths, config, { run: run2, now: now2, env, accBinDir: deps.accBinDir, accCommand: deps.accCommand }, { actor: "orchestrator", by: AUTOPILOT_BY, only: id });
      const s = r.started[0];
      if (s) return { reason: `${startedWords(s)}${s.bgId ? `, background session ${s.bgId}` : ""}.` };
      if (r.failed[0]) throw new AccError("start-failed", r.failed[0].reason);
      throw new AccError("start-waits", r.waiting[0]?.reason ?? "It waits.");
    },
    queue: (id) => queueTurn(paths, config, id, { run: run2, now: now2, env, slots: deps.slots }, { actor: "orchestrator", by: AUTOPILOT_BY })
  };
}
function startedWords(s) {
  if (s.shares?.length) return `Started it: nothing else was ready, so it shares files with ${s.shares.map((x2) => x2.task).join(", ")}`;
  return s.waitedFor?.length ? `Started it: ${s.waitedFor.join(", ")}'s files are free` : "Started it";
}
function landStep(r) {
  return {
    reason: `${r.opened ? "Opened" : "Updated"} pull request #${r.pr.number}.`,
    pr: { number: r.pr.number, url: r.pr.url, opened: r.opened },
    ...r.update ? { update: r.update } : {}
  };
}
function temporary(e, paths, config, id, machine) {
  const code2 = e.code;
  if (code2 === "lock-timeout") return "The ledger was busy. Autopilot tries again next pass.";
  if (code2 === "agent-active" || code2 === "checks-moved" || code2 === "merge-waits") return `${e.message} Autopilot looks again next pass.`;
  if (code2 === "start-waits") return `${sentence2(e.message)} Autopilot looks again next pass.`;
  if (code2 === "move-refused") return capWait(readLedger(paths.ledger), config, id, machine);
  return null;
}
function recordFailure(paths, now2, id, failed) {
  mutate(paths, now2, (l3, emit) => {
    const t = l3.tasks.find((x2) => x2.id === id);
    if (!t || t.state !== failed.state) return;
    t.autopilot = { ...t.autopilot, failed };
    if (t.autopilot.queued) t.autopilot.queued = null;
    t.updatedAt = failed.at;
    emit({ type: "task.updated", task: id, actor: "orchestrator", by: AUTOPILOT_BY, data: { autopilot: { failed } } });
  });
}
function autopilotPass(paths, config, deps) {
  const steps2 = { ...realSteps(paths, config, deps), ...deps.steps };
  const out3 = { steps: [], updates: [] };
  const first = readLedger(paths.ledger);
  let look2 = null;
  const gh = config.github;
  let ghEnv3 = null;
  let asked = null;
  const github = gh ? {
    repo: gh.repo,
    env: () => ghEnv3 ??= { ...deps.env, GH_TOKEN: ghToken(deps.run, gh.account) },
    autoMerge: (branch) => autoMergeFor(config, branch),
    asking: (wt2) => askingUnder(asked ??= pendingQuestions(questionsDir(deps.env)), wt2)
  } : void 0;
  const who = { actor: "orchestrator", by: AUTOPILOT_BY };
  const queued = /* @__PURE__ */ new Map();
  let fetched = false;
  let machine = null;
  const load = () => machine ??= machineLoad(paths, config.project, deps.env);
  const take2 = (entry, fn2) => {
    const id = entry.task;
    try {
      const r = fn2();
      Object.assign(entry, { step: r.step ?? entry.step, outcome: r.outcome ?? "done", reason: r.reason, ...r.pr ? { pr: r.pr } : {}, ...r.update ? { update: r.update } : {} });
      if (r.update) out3.updates.push({ task: id, ...r.update });
    } catch (e) {
      if (e.code === "start-failed") {
        Object.assign(entry, { outcome: "failed", reason: firstLines(e.message) });
        return;
      }
      const wait = temporary(e, paths, config, id, machine);
      if (wait) {
        Object.assign(entry, { outcome: "waiting", reason: wait });
        return;
      }
      const step = e.step ?? entry.step;
      const reason = firstLines(e.message ?? String(e));
      let unrecorded = "";
      try {
        recordFailure(paths, deps.now, id, { step, sha: entry.sha ?? "", state: entry.state, reason, at: deps.now().toISOString() });
      } catch (err) {
        unrecorded = ` (Not recorded on the task: ${err.message})`;
      }
      Object.assign(entry, { step, outcome: "failed", reason: reason + unrecorded });
    }
  };
  for (const id of first.tasks.map((t) => t.id)) {
    if (deps.stop?.()) break;
    const ledger = readLedger(paths.ledger);
    const task = ledger.tasks.find((t) => t.id === id);
    if (!task || task.state === "done") continue;
    if (task.state === "running" && (!look2 || deps.now().getTime() - look2.at > STOPPED_GRACE_MS)) look2 = { sessions: listSessions(deps.run, paths.root), at: deps.now().getTime() };
    const facts = taskFacts(paths, task, deps.run, look2?.sessions ?? null, deps.now(), github);
    if (task.state === "rework" || task.state === "todo" && task.held && !task.held.failed) facts.machine = load();
    if (task.state === "todo" && task.held && !task.held.failed) {
      try {
        const over = machineCapProblem(ledger, id, facts.machine ?? null);
        const problems = [...checkMove(ledger, config, task, { to: "running", actor: "orchestrator", by: AUTOPILOT_BY }, noGateHooks), ...over ? [over] : [], ...analysisProblems(paths, config, task)];
        facts.start = { ...startLook(paths, config, ledger, deps.run, id, { fetch: !fetched }), problems };
        fetched = true;
      } catch {
      }
    }
    if (facts.stopped) releaseAwake(paths, id);
    const d = nextStep(ledger, config, task, facts);
    const sha = facts.head || null;
    const placed = inQueueAt(task, facts.head);
    if (d.queue === "in" || d.queue === "hold" && placed) {
      let unrecorded = "";
      try {
        if (!placed) joinQueue(paths, deps.now, id, facts.head, who);
      } catch (err) {
        unrecorded = ` (Not in the merge queue yet: ${err.message})`;
      }
      const entry2 = { task: id, state: task.state, step: null, sha, outcome: "waiting", reason: d.reason + unrecorded };
      out3.steps.push(entry2);
      if (!unrecorded) queued.set(id, { entry: entry2, decision: d, head: facts.head });
      continue;
    }
    if (task.autopilot?.queued && !d.record) {
      try {
        leaveQueue(paths, deps.now, id, who);
      } catch {
      }
    }
    if (d.record) {
      let unrecorded = "";
      try {
        recordFailure(paths, deps.now, id, { step: d.record.step, sha: facts.head, state: task.state, reason: d.record.reason, at: deps.now().toISOString() });
      } catch (err) {
        unrecorded = ` (Not recorded on the task: ${err.message})`;
      }
      out3.steps.push({ task: id, state: task.state, step: d.record.step, sha, outcome: "failed", reason: d.record.reason + unrecorded });
      continue;
    }
    if (!d.step) {
      out3.steps.push({ task: id, state: task.state, step: null, sha, outcome: d.outcome ?? "skipped", reason: d.reason });
      continue;
    }
    const act = d.step;
    if (act === "merge" || act === "queue") {
      out3.steps.push({ task: id, state: task.state, step: null, sha, outcome: "waiting", reason: d.reason || "The merge queue merges it, at its turn." });
      continue;
    }
    deps.onStep?.(id, act, facts.head);
    const entry = { task: id, state: task.state, step: act, sha, outcome: "done", reason: "" };
    out3.steps.push(entry);
    take2(entry, () => withJob(paths, { kind: "autopilot", task: id, step: act, by: AUTOPILOT_BY }, () => steps2[act](id), deps.now));
  }
  if (queued.size && !deps.stop?.()) queueTurns(paths, config, deps, steps2, queued, take2);
  return out3;
}
function queueTurns(paths, config, deps, steps2, queued, take2) {
  const order = queueOrder(readLedger(paths.ledger), config);
  order.forEach((t, i) => {
    const q2 = queued.get(t.id);
    if (!q2) return;
    if (i > 0) {
      q2.entry.reason = `In the merge queue, ${ordinal(i + 1)}: behind ${order[i - 1].id}.`;
      return;
    }
    if (q2.decision.queue !== "in") {
      q2.entry.reason = `First in the merge queue. ${q2.decision.reason}`;
      try {
        holdHead(paths, deps.now, t.id, { checks: !!q2.decision.checks, why: q2.decision.reason }, { actor: "orchestrator", by: AUTOPILOT_BY });
      } catch {
      }
      return;
    }
    deps.onStep?.(t.id, "queue", q2.head);
    Object.assign(q2.entry, { step: "queue", outcome: "done" });
    take2(q2.entry, () => withJob(paths, { kind: "autopilot", task: t.id, step: "queue", by: AUTOPILOT_BY }, () => steps2.queue(t.id), deps.now));
  });
}
function holdAutopilot(paths, fn2) {
  mkdirSync25(paths.stateDir, { recursive: true });
  let held = false;
  try {
    return withLock(paths.autopilotLock, () => {
      held = true;
      return fn2();
    }, { staleMs: Infinity, timeoutMs: 0 });
  } catch (e) {
    if (held || e.code !== "lock-timeout") throw e;
    let pid = null;
    try {
      pid = JSON.parse(readFileSync27(join25(paths.autopilotLock, "owner"), "utf8")).pid;
    } catch {
      pid = null;
    }
    throw new AccError("autopilot-running", `Autopilot is already running here (pid ${pid ?? "unknown"}). Stop that one first.${pid ? "" : ` If none is running, delete ${paths.autopilotLock}.`}`);
  }
}

// packages/core/src/cards.ts
var CARD_COLUMNS = {
  todo: ["Todo"],
  ready: ["Todo"],
  running: ["In Progress"],
  rework: ["In Progress"],
  review: ["Testing", "In Review"],
  blocked: ["Blocked"],
  done: ["Done"]
};
var cardState = (ledger, task) => task.state === "todo" && isReady(ledger, task) ? "ready" : task.state;
var namedFor = (state, statusFor) => statusFor?.[state] ?? (state === "ready" ? statusFor?.todo : void 0);
var same = (a2, b) => a2.trim().toLowerCase() === b.trim().toLowerCase();
function columnFor(state, options, statusFor) {
  const named = namedFor(state, statusFor);
  for (const want of named ? [named] : CARD_COLUMNS[state]) {
    const o = options.find((x2) => same(x2.name, want));
    if (o) return o;
  }
  return null;
}
var CARD_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    projectsV2(first: 10) { nodes { id number closed
      field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } } } }
    issue(number: $number) { projectItems(first: 20) { nodes { id project { id }
      fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { optionId name } } } } }
  }
}`;
var MOVE_MUTATION = `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) { projectV2Item { id } }
}`;
function graphql(run2, env, query, vars) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k2, v] of Object.entries(vars)) args.push(typeof v === "number" ? "-F" : "-f", `${k2}=${v}`);
  const r = run2("gh", args, { env, timeoutMs: GH_CALL_MS });
  if (r.code !== 0) {
    const why = firstLine2(r);
    return { error: /scope|INSUFFICIENT_SCOPES/i.test(why) ? `${why}. Give the account access to Projects: gh auth refresh -h github.com -s project` : why };
  }
  try {
    const out3 = JSON.parse(r.stdout);
    if (out3.errors?.length) return { error: out3.errors[0].message };
    return { data: out3.data };
  } catch {
    return { error: "gh's answer wasn't JSON" };
  }
}
function moveCard(run2, env, repo, tracker, n, state) {
  const [owner, name] = repo.split("/");
  const read2 = graphql(run2, env, CARD_QUERY, { owner, name, number: n });
  if ("error" in read2) return { outcome: "failed", reason: read2.error };
  const r = read2.data.repository;
  if (!r?.issue) return { outcome: "left", reason: `GitHub can't find issue #${n} in ${repo}` };
  const board = typeof tracker.board === "number" ? tracker.board : null;
  const project2 = pickProject(r.projectsV2.nodes, board);
  if (!project2) return { outcome: "left", reason: board != null ? `${repo} has no Project ${board} with a Status field` : `${repo} has no open Project with a Status field` };
  const item = r.issue.projectItems.nodes.find((x2) => x2.project.id === project2.id);
  if (!item) return { outcome: "left", reason: "its issue isn't on the GitHub Project" };
  const column = columnFor(state, project2.field.options, tracker.statusFor);
  if (!column) {
    const named = namedFor(state, tracker.statusFor);
    return { outcome: "left", reason: named ? `the GitHub Project has no column ${named}, which statusFor names for ${state}` : `the GitHub Project has no column for ${state}` };
  }
  if (item.fieldValueByName?.optionId === column.id) return { outcome: "already", column: column.name };
  const moved = graphql(run2, env, MOVE_MUTATION, { project: project2.id, item: item.id, field: project2.field.id, option: column.id });
  return "error" in moved ? { outcome: "failed", column: column.name, reason: moved.error } : { outcome: "moved", column: column.name };
}
function followCards(paths, config, ids, deps) {
  const tracker = editsTracker(config);
  if (!tracker || !ids.length) return [];
  const ledger = readLedger(paths.ledger);
  const due = ledger.tasks.flatMap((t) => {
    const issue = ids.includes(t.id) ? issueToClose(config, t) : null;
    return issue ? [{ t, issue }] : [];
  });
  if (!due.length) return [];
  let env;
  try {
    env = { ...deps.env, GH_TOKEN: ghToken(deps.run, config.github.account) };
  } catch (e) {
    env = { error: e.message };
  }
  const results = due.map(({ t, issue }) => {
    const state = cardState(ledger, t);
    const base = { task: t.id, state, from: t.state };
    if ("error" in env) return { ...base, outcome: "failed", reason: env.error };
    return { ...base, ...moveCard(deps.run, env, issue.repo, tracker, issue.number, state) };
  });
  const at2 = deps.now().toISOString();
  mutate(paths, deps.now, (l3, emit) => {
    for (const r of results) {
      const t = l3.tasks.find((x2) => x2.id === r.task);
      if (!t || t.state !== r.from) continue;
      let card;
      if (r.outcome === "left") {
        if (!t.card) continue;
        card = null;
      } else card = { state: t.state, column: r.column ?? null, at: at2, ...r.outcome === "failed" ? { failed: r.reason ?? "" } : {} };
      t.card = card;
      emit({ type: "task.updated", task: t.id, actor: "sync", by: "acc cards", data: { card } });
    }
  });
  return results.map(({ from: _from, ...r }) => r);
}
var cardFailure = (task) => task.card?.failed !== void 0 && task.card.state === task.state ? task.card.failed : null;
var cardWords = (r) => `Couldn't move ${r.task}'s card${r.column ? ` to ${r.column}` : ""} on its GitHub Project: ${(r.reason ?? "").replace(/[.\s]+$/, "")}. ${r.task} is ${r.state} all the same.`;

// packages/core/src/deploy.ts
import { existsSync as existsSync19, mkdirSync as mkdirSync27, mkdtempSync as mkdtempSync5, readFileSync as readFileSync28, renameSync as renameSync13, rmSync as rmSync16, writeFileSync as writeFileSync27 } from "node:fs";
import { tmpdir as tmpdir5 } from "node:os";
import { join as join27 } from "node:path";

// packages/core/src/promote.ts
import { appendFileSync as appendFileSync4, mkdirSync as mkdirSync26, mkdtempSync as mkdtempSync4, rmSync as rmSync15, writeFileSync as writeFileSync26 } from "node:fs";
import { tmpdir as tmpdir4 } from "node:os";
import { join as join26 } from "node:path";
var git6 = (run2, cwd, ...args) => run2("git", args, { cwd });
var must = (r, what) => {
  if (r.code !== 0) throw new AccError("git", `${what}: ${(r.stderr || r.stdout).trim().split("\n").pop() ?? ""}`);
  return r.stdout;
};
function promotionPaths(envs) {
  const into = new Set(envs.flatMap((e) => e.promotesTo));
  const starts = envs.filter((e) => !into.has(e.branch) && e.promotesTo.length);
  const out3 = [];
  const walk = (path) => {
    const last = envs.find((e) => e.branch === path[path.length - 1]);
    const next = (last?.promotesTo ?? []).filter((b) => !path.includes(b));
    if (!next.length) {
      out3.push(path);
      return;
    }
    for (const b of next) walk([...path, b]);
  };
  for (const s of starts) walk([s.branch]);
  return out3;
}
function envByName(config, name) {
  const e = config.environments.find((x2) => x2.branch === name.toLowerCase() || x2.name.toLowerCase() === name.toLowerCase());
  if (!e) throw new AccError("usage", `No environment "${name}". The config has: ${config.environments.map((x2) => x2.branch).join(", ")}.`);
  return e;
}
function skippedOn(config, from, to) {
  const usual = from.promotesTo[0];
  if (!usual || usual === to.branch) return [];
  const path = [];
  let at2 = from;
  while (at2?.promotesTo[0] && at2.promotesTo[0] !== to.branch) {
    const next = config.environments.find((e) => e.branch === at2.promotesTo[0]);
    if (!next || path.includes(next)) break;
    path.push(next);
    at2 = next;
  }
  return at2?.promotesTo[0] === to.branch ? path : path.slice(0, 1);
}
function specificOn(run2, root, config, refs) {
  if (!config.environmentSpecific) return [];
  const out3 = /* @__PURE__ */ new Set();
  for (const ref of refs) {
    const r = git6(run2, root, "show", `${ref}:${config.environmentSpecific}`);
    if (r.code !== 0) continue;
    for (const l3 of listLines(r.stdout)) out3.add(l3);
  }
  return [...out3];
}
function planPromotion(paths, config, fromName, toName, deps) {
  const { run: run2 } = deps;
  const steps2 = deps.steps ?? NO_STEPS;
  const { from, to, fromSha, toSha } = steps2.step("branches", "Check the branches", () => {
    const from2 = envByName(config, fromName);
    if (!from2.promotesTo.length) throw new AccError("refused", `${from2.name} doesn't promote anywhere: its "promotesTo" is empty.`);
    const to2 = toName ? envByName(config, toName) : envByName(config, from2.promotesTo[0]);
    if (!from2.promotesTo.includes(to2.branch)) throw new AccError("refused", `${from2.name} can't promote to ${to2.name}. Its "promotesTo" allows: ${from2.promotesTo.join(", ")}.`);
    must(git6(run2, paths.root, "fetch", "--quiet", "origin", from2.branch, to2.branch), `Couldn't fetch ${from2.branch} and ${to2.branch}`);
    const fromSha2 = must(git6(run2, paths.root, "rev-parse", `origin/${from2.branch}`), `No origin/${from2.branch}`).trim();
    const toSha2 = must(git6(run2, paths.root, "rev-parse", `origin/${to2.branch}`), `No origin/${to2.branch}`).trim();
    return { from: from2, to: to2, fromSha: fromSha2, toSha: toSha2 };
  });
  return steps2.step("changes", "Work out what changed", () => promotionChanges(paths, config, run2, from, to, fromSha, toSha));
}
function promotionChanges(paths, config, run2, from, to, fromSha, toSha) {
  const src = `origin/${from.branch}`;
  const dst = `origin/${to.branch}`;
  const parts = must(git6(run2, paths.root, "diff", "--name-status", "--no-renames", "-z", `${dst}...${src}`), "git diff failed").split("\0").filter(Boolean);
  const specific = specificOn(run2, paths.root, config, [src, dst]);
  const blob = (ref, f) => git6(run2, paths.root, "rev-parse", "--verify", "--quiet", `${ref}:${f}`).stdout.trim();
  const files = [];
  const deleted = [];
  const leftOut = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [status, f] = [parts[i], parts[i + 1]];
    if (listed(f, specific)) {
      leftOut.push(f);
      continue;
    }
    const there = blob(dst, f);
    if (status.startsWith("D")) {
      if (there) deleted.push(f);
      continue;
    }
    if (there && there === blob(src, f)) continue;
    files.push(f);
  }
  return { from, to, skipped: skippedOn(config, from, to), files, deleted, leftOut, fromSha, toSha };
}
var describeSkip = (plan) => plan.skipped.map((e) => `Skips \`${e.branch}\` (${e.name}): this change hasn't been validated there.`);
function promotionBody(plan, validation) {
  const list = (xs) => xs.length > 60 ? [...xs.slice(0, 60).map((f) => `- \`${f}\``), `- \u2026and ${xs.length - 60} more`] : xs.map((f) => `- \`${f}\``);
  return [
    `Promotes \`${plan.from.branch}\` (${plan.from.name}) at ${plan.fromSha.slice(0, 7)} into \`${plan.to.branch}\` (${plan.to.name}).`,
    "",
    ...plan.skipped.length ? ["> [!WARNING]", ...describeSkip(plan).map((l3) => `> ${l3}`), ""] : [],
    ...plan.deleted.length ? ["> [!WARNING]", `> Deletes ${plan.deleted.length} file${plan.deleted.length === 1 ? "" : "s"} in \`${plan.to.branch}\`. That usually means the branches have drifted apart.`, ""] : [],
    `## Changes (${plan.files.length})`,
    "",
    ...list(plan.files),
    ...plan.deleted.length ? ["", `## Deleted (${plan.deleted.length})`, "", ...list(plan.deleted)] : [],
    ...plan.leftOut.length ? ["", "## Left out: environment-specific", "", ...list(plan.leftOut)] : [],
    ...validation ? ["", "## Validation", "", `Check-only deploy to ${plan.to.name}: ${validation.status}. ${validation.summary}`] : [],
    "",
    "---",
    `Opened by \`acc promote\`. It merges only when a person merges it; deploying to ${plan.to.name} is a separate step after that.`
  ].join("\n") + "\n";
}
function promotionCheckArgs(org, source) {
  const apex = source.some((f) => /\.(cls|trigger)(-meta\.xml)?$/.test(f));
  return ["project", "deploy", "start", "--dry-run", "--target-org", org, "--wait", "90", "--json", "--ignore-conflicts", ...source.flatMap((f) => ["--source-dir", f]), "--test-level", apex ? "RunLocalTests" : "NoTestRun"];
}
function recordCarried(paths, plan, pr, carried, by, now2) {
  const problems = [];
  const at2 = now2().toISOString();
  try {
    mutate(paths, now2, (ledger, emit) => {
      for (const c of carried) {
        const t = ledger.tasks.find((x2) => x2.id === c.id);
        if (!t) continue;
        const promotion = { from: plan.from.branch, to: plan.to.branch, pr, state: "open", at: at2 };
        t.promotions = [...t.promotions ?? [], promotion];
        emit({ type: "task.updated", task: t.id, actor: "human", by, data: { promotion } });
      }
    });
  } catch (e) {
    problems.push(`Its tasks weren't recorded, so acc sync won't follow it for them: ${e.message}`);
  }
  const updates = [];
  try {
    for (const t of carried) {
      const u = draftUpdate(paths, t, { event: "promotion-opened", env: plan.to.name, pr }, by, now2);
      if (u) updates.push({ task: t.id, id: u.id, key: u.key });
    }
  } catch (e) {
    problems.push(`Its tickets' updates weren't all drafted: ${e.message}`);
  }
  return { updates, warning: problems.length ? `The pull request is open. ${problems.join(" ")}` : null };
}
function promote(paths, config, fromName, toName, deps, opts = {}) {
  const named = (name) => name ? config.environments.find((x2) => x2.branch === name.toLowerCase() || x2.name.toLowerCase() === name.toLowerCase()) : void 0;
  const from = named(fromName);
  const to = named(toName ?? from?.promotesTo[0]);
  const job = { kind: "promote", from: from?.branch ?? fromName, ...to || toName ? { env: to?.branch ?? toName } : {}, by: opts.by ?? "acc promote" };
  return withJob(paths, job, () => promoteNow(paths, config, fromName, toName, deps, opts), deps.now);
}
function promoteNow(paths, config, fromName, toName, deps, opts) {
  const { run: run2, now: now2 } = deps;
  const steps2 = deps.steps ?? NO_STEPS;
  const plan = planPromotion(paths, config, fromName, toName, deps);
  const none = { tasks: [], updates: [], warning: null };
  if (!plan.files.length && !plan.deleted.length) return { plan, branch: null, pr: null, validation: null, stopped: `${plan.to.name} already has everything from ${plan.from.name}.`, ...none };
  const gh = steps2.step("ready", "Check it can open a pull request", () => {
    if (plan.deleted.length && !opts.allowDeletions) {
      throw new AccError("refused", `Promoting would delete ${plan.deleted.length} file(s) in ${plan.to.branch}, which usually means the branches have drifted apart: ${plan.deleted.slice(0, 5).join(", ")}${plan.deleted.length > 5 ? ", \u2026" : ""}. Check them, then add --allow-deletions.`);
    }
    if (!config.github) throw new AccError("no-github", 'acc promote opens a pull request on GitHub, and this project has no "github" section.');
    return config.github;
  });
  const stamp = now2().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
  const branch = `promote/${plan.from.branch}-to-${plan.to.branch}-${stamp}`;
  const dir = mkdtempSync4(join26(tmpdir4(), "acc-promote-"));
  const wt2 = join26(dir, "wt");
  let validation = null;
  try {
    deps.onStep?.(`Building ${branch} from ${plan.to.branch}`);
    steps2.step("build", "Build the promotion branch", () => {
      must(git6(run2, paths.root, "worktree", "add", "--quiet", "-b", branch, wt2, plan.toSha), "Couldn't make the promotion worktree");
      for (let i = 0; i < plan.files.length; i += 200) must(git6(run2, wt2, "checkout", plan.fromSha, "--", ...plan.files.slice(i, i + 200)), "Couldn't bring the changes over");
      for (let i = 0; i < plan.deleted.length; i += 200) must(git6(run2, wt2, "rm", "--quiet", "--", ...plan.deleted.slice(i, i + 200)), "Couldn't remove the deleted files");
      must(git6(run2, wt2, "commit", "--quiet", "-m", `Promote ${plan.from.branch} to ${plan.to.branch}`, "-m", `${plan.files.length} changed, ${plan.deleted.length} deleted, from ${plan.fromSha.slice(0, 7)}.`), "Couldn't commit the promotion");
    });
    const source = config.profile === "salesforce" ? under(plan.files, packageDirs(wt2)) : [];
    const checkLabel2 = `Check in ${plan.to.org ?? plan.to.name}`;
    if (source.length && plan.to.org && opts.validate !== false) {
      deps.onStep?.(`Validating against ${plan.to.name} (${plan.to.org}). Nothing is saved to the org.`);
      steps2.start("check", checkLabel2, "A check-only deploy: nothing is saved to the org");
      const args = promotionCheckArgs(plan.to.org, source);
      assertCheckOnly("sf", args);
      const [cmd, a2] = niced("sf", args);
      const owner = { what: `Validate ${plan.from.branch} \u2192 ${plan.to.branch}`, env: plan.to.branch, project: config.project };
      const r = withSlot(() => run2(cmd, a2, { cwd: wt2, env: sfEnv(), timeoutMs: 120 * 6e4 }), { owner, ...deps.slots });
      validation = readDeploy(r, plan.to.org, [], source.length);
      if (validation.status !== "pass") {
        steps2.fail("check", validation.summary);
        return { plan, branch: null, pr: null, validation, stopped: `Validation against ${plan.to.name} didn't pass: ${validation.summary}`, ...none };
      }
      steps2.done("check", validation.summary);
    } else {
      steps2.skip("check", checkLabel2, opts.validate === false ? "Skipped when it was started" : !source.length ? "No Salesforce source to check" : `${plan.to.name} has no org`);
    }
    const carried = carriedTasks(paths, run2, plan);
    deps.onStep?.(`Pushing ${branch}`);
    steps2.step("push", "Push the promotion branch", () => must(run2("git", ["push", "--quiet", "--set-upstream", "origin", `${branch}:${branch}`], { cwd: wt2, env: deps.env, timeoutMs: 5 * 6e4 }), `git push refused ${branch}`));
    const pr = steps2.step("open", `Open the pull request into ${plan.to.branch}`, () => {
      const token = run2("gh", ["auth", "token", "-u", gh.account]);
      if (token.code !== 0) throw new AccError("no-github", `gh isn't logged in as ${gh.account}. The branch ${branch} is pushed; open its pull request on GitHub.`);
      const bodyFile = join26(dir, "body.md");
      writeFileSync26(bodyFile, promotionBody(plan, validation));
      const title = `Promote ${plan.from.name} to ${plan.to.name}${plan.skipped.length ? ` (skips ${plan.skipped.map((e) => e.branch).join(", ")})` : ""}`;
      const create = run2("gh", ["pr", "create", "-R", gh.repo, "--base", plan.to.branch, "--head", branch, "--title", title, "--body-file", bodyFile], { cwd: paths.root, env: { ...deps.env, GH_TOKEN: token.stdout.trim() }, timeoutMs: 2 * 6e4 });
      const url = create.stdout.trim().split("\n").find((l3) => /\/pull\/\d+/.test(l3))?.trim();
      if (create.code !== 0 || !url) throw new AccError("land", `gh couldn't open the pull request: ${(create.stderr || create.stdout).trim().split("\n")[0]}. The branch ${branch} is pushed.`);
      return { number: Number(/\/pull\/(\d+)/.exec(url)[1]), url };
    });
    steps2.start("record", "Record what it carries");
    mkdirSync26(paths.stateDir, { recursive: true });
    const tasks = carried.map((t) => t.id);
    appendFileSync4(join26(paths.stateDir, "promotions.jsonl"), JSON.stringify({ at: now2().toISOString(), from: plan.from.branch, to: plan.to.branch, fromSha: plan.fromSha, branch, pr, files: plan.files.length, deleted: plan.deleted.length, skipped: plan.skipped.map((e) => e.branch), tasks }) + "\n");
    const recorded = recordCarried(paths, plan, pr, carried, opts.by ?? "acc promote", now2);
    if (recorded.warning) steps2.fail("record", recorded.warning);
    else steps2.done("record", tasks.length ? `${tasks.length} task(s)` : "No task's change");
    return { plan, branch, pr, validation, stopped: null, tasks, ...recorded };
  } finally {
    git6(run2, paths.root, "worktree", "remove", "--force", wt2);
    git6(run2, paths.root, "branch", "-D", branch);
    git6(run2, paths.root, "worktree", "prune");
    rmSync15(dir, { recursive: true, force: true });
  }
}
var skipWarning = describeSkip;

// packages/core/src/deploy.ts
var deployRecordPath = (paths, env) => join27(paths.stateDir, "deploys", `${env}.json`);
function lastDeploy(paths, env) {
  try {
    return JSON.parse(readFileSync28(deployRecordPath(paths, env), "utf8"));
  } catch {
    return null;
  }
}
var git7 = (run2, cwd, ...args) => run2("git", args, { cwd });
function planDeploy(paths, config, envName, deps, opts = {}) {
  const steps2 = deps.steps ?? NO_STEPS;
  const { env, head, base } = steps2.step("branch", "Check the branch", () => deployBase(paths, config, envName, deps.run, opts));
  return steps2.step("changes", "Work out what changed", () => deployChanges(paths, config, deps.run, env, base, head, opts));
}
function deployBase(paths, config, envName, run2, opts) {
  if (config.profile !== "salesforce") throw new AccError("refused", "acc deploy deploys Salesforce source to an org; this project isn't a Salesforce one.");
  const env = envByName(config, envName);
  if (!env.org) throw new AccError("refused", `${env.name} has no org alias in .acc/config.json.`);
  if (opts.noTests && (env.type === "production" || env.protected)) throw new AccError("refused", `${env.name} is ${env.type === "production" ? "production" : "protected"}: its deploys run the tests. --no-tests is for sandboxes.`);
  const fetched = git7(run2, paths.root, "fetch", "--quiet", "origin", env.branch);
  if (fetched.code !== 0) throw new AccError("git", `Couldn't fetch ${env.branch}: ${fetched.stderr.trim().split("\n").pop()}`);
  const head = git7(run2, paths.root, "rev-parse", `origin/${env.branch}`).stdout.trim();
  const last = lastDeploy(paths, env.branch);
  const since = opts.since ?? last?.sha;
  if (!since) throw new AccError("usage", `${env.name} hasn't been deployed by acc before, so say where to start: --since <the commit or tag the org already has>.`);
  const base = git7(run2, paths.root, "rev-parse", "--verify", "--quiet", `${since}^{commit}`).stdout.trim();
  if (!base) throw new AccError("usage", `There's no commit "${since}" here.`);
  if (git7(run2, paths.root, "merge-base", "--is-ancestor", base, head).code !== 0) throw new AccError("refused", `${since} isn't on ${env.branch}, so it can't be where the org's deploy starts.`);
  return { env, head, base };
}
function deployChanges(paths, config, run2, env, base, head, opts) {
  const r = git7(run2, paths.root, "diff", "--name-status", "--no-renames", "-z", base, head);
  const parts = r.stdout.split("\0").filter(Boolean);
  const show = (f) => git7(run2, paths.root, "show", `${head}:${f}`);
  const sfdx = show("sfdx-project.json");
  const dirs = (() => {
    if (sfdx.code !== 0) return ["force-app"];
    const tmp = mkdtempSync5(join27(tmpdir5(), "acc-sfdx-"));
    try {
      writeFileSync27(join27(tmp, "sfdx-project.json"), sfdx.stdout);
      return packageDirs(tmp);
    } finally {
      rmSync16(tmp, { recursive: true, force: true });
    }
  })();
  const specific = config.environmentSpecific ? listLines(show(config.environmentSpecific).stdout) : [];
  const files = [];
  const deleted = [];
  const leftOut = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [status, f] = [parts[i], parts[i + 1]];
    if (!under([f], dirs).length) continue;
    if (listed(f, specific)) leftOut.push(f);
    else if (status.startsWith("D")) deleted.push(f);
    else files.push(f);
  }
  const apex = files.some((f) => /\.(cls|trigger)(-meta\.xml)?$/.test(f));
  return { env, org: env.org, base, head, files, deleted, leftOut, testLevel: apex && !opts.noTests ? "RunLocalTests" : "NoTestRun", confirm: env.protected };
}
function deployedTasks(paths, run2, plan) {
  const on = (sha, tip) => git7(run2, paths.root, "merge-base", "--is-ancestor", sha, tip).code === 0;
  return readLedger(paths.ledger).tasks.filter((t) => {
    const sha = arrivedAt(t, plan.env.branch);
    return !!sha && on(sha, plan.head) && !on(sha, plan.base);
  });
}
function deployArgs(plan) {
  return ["project", "deploy", "start", "--target-org", plan.org, "--wait", "90", "--json", "--test-level", plan.testLevel, ...plan.files.flatMap((f) => ["--source-dir", f])];
}
function deploy(paths, config, envName, deps, opts) {
  const env = config.environments.find((x2) => x2.branch === envName.toLowerCase() || x2.name.toLowerCase() === envName.toLowerCase());
  return withJob(paths, { kind: "deploy", env: env?.branch ?? envName, by: opts.by }, () => deployNow(paths, config, envName, deps, opts), deps.now);
}
function deployNow(paths, config, envName, deps, opts) {
  const { run: run2, now: now2 } = deps;
  const steps2 = deps.steps ?? NO_STEPS;
  const plan = planDeploy(paths, config, envName, deps, opts);
  if (!plan.files.length && !plan.deleted.length) return { plan, deployed: false, jobId: null, summary: `${plan.env.name} already has ${plan.env.branch} at ${plan.head.slice(0, 7)}.`, updates: [] };
  steps2.step("ready", `Check it can go to ${plan.env.name}`, () => {
    if (plan.deleted.length) {
      throw new AccError("refused", `${plan.deleted.length} file(s) were deleted on ${plan.env.branch} since the last deploy (${plan.deleted.slice(0, 5).join(", ")}${plan.deleted.length > 5 ? ", \u2026" : ""}). acc doesn't deploy deletions; remove them from the org by hand, or with a destructive-changes manifest.`);
    }
    if (plan.confirm && !opts.confirmed) throw new AccError("refused", `${plan.env.name} is protected. Deploying to it needs a person's confirmation: add --confirm-production.`);
  });
  if (!plan.files.length) return { plan, deployed: false, jobId: null, summary: "Nothing deployable changed.", updates: [] };
  const dir = mkdtempSync5(join27(tmpdir5(), "acc-deploy-"));
  const wt2 = join27(dir, "wt");
  try {
    steps2.step("checkout", `Check out ${plan.env.branch} at ${plan.head.slice(0, 7)}`, () => {
      const add2 = git7(run2, paths.root, "worktree", "add", "--quiet", "--detach", wt2, plan.head);
      if (add2.code !== 0) throw new AccError("git", `Couldn't check out ${plan.head.slice(0, 7)}: ${add2.stderr.trim()}`);
    });
    steps2.start("deploy", `Deploy to ${plan.env.name}`, `${plural(plan.files.length, "file")}, ${plan.testLevel === "RunLocalTests" ? "with the org's local tests" : "no tests"}`);
    const [cmd, args] = niced("sf", deployArgs(plan));
    const owner = { what: `Deploy ${plan.env.branch}`, env: plan.env.branch, project: config.project };
    const r = withSlot(() => run2(cmd, args, { cwd: wt2, env: sfEnv(), timeoutMs: 120 * 6e4 }), { owner, ...deps.slots, onWait: deps.onWait });
    let result;
    try {
      result = parseJsonOutput(r.stdout);
    } catch {
      throw new AccError("deploy", `sf gave no result: ${(r.stderr || r.stdout).trim().split("\n").pop() ?? ""}`);
    }
    const jobId = result.result?.id ?? null;
    if (r.code !== 0 || result.status !== 0 || result.result?.success === false) {
      const failures2 = result.result?.details?.componentFailures;
      const list = (Array.isArray(failures2) ? failures2 : failures2 ? [failures2] : []).slice(0, 3).map((f) => `${f.fullName}: ${f.problem}`);
      const why = list.join("; ") || result.message || "see sf's output";
      steps2.fail("deploy", why);
      return { plan, deployed: false, jobId, summary: `The deploy to ${plan.env.name} failed${jobId ? ` (job ${jobId})` : ""}: ${why}`, updates: [] };
    }
    steps2.done("deploy", jobId ? `Job ${jobId}` : void 0);
    steps2.step("record", "Record the deploy", () => {
      const record2 = { env: plan.env.branch, org: plan.org, sha: plan.head, at: now2().toISOString(), by: opts.by, jobId, files: plan.files.length };
      const file = deployRecordPath(paths, plan.env.branch);
      mkdirSync27(join27(paths.stateDir, "deploys"), { recursive: true });
      writeFileSync27(`${file}.tmp`, JSON.stringify(record2, null, 2) + "\n");
      renameSync13(`${file}.tmp`, file);
    });
    steps2.start("updates", "Draft the tickets' updates");
    const updates = [];
    let unsaid = "";
    try {
      for (const t of deployedTasks(paths, run2, plan)) {
        const u = draftUpdate(paths, t, { event: "deployed", env: plan.env.name }, opts.by, now2);
        if (u) updates.push({ task: t.id, id: u.id, key: u.key });
      }
      steps2.done("updates", updates.length ? `${updates.length} drafted` : "No ticket's change went");
    } catch (e) {
      unsaid = ` Its tickets' updates weren't all drafted: ${e.message}`;
      steps2.fail("updates", e.message);
    }
    return { plan, deployed: true, jobId, summary: `Deployed ${plan.files.length} file(s) from ${plan.env.branch} at ${plan.head.slice(0, 7)} to ${plan.env.name}${jobId ? ` (job ${jobId})` : ""}.${unsaid}`, updates };
  } finally {
    git7(run2, paths.root, "worktree", "remove", "--force", wt2);
    if (existsSync19(dir)) rmSync16(dir, { recursive: true, force: true });
  }
}

// packages/core/src/drift.ts
import { existsSync as existsSync20, mkdirSync as mkdirSync28, rmSync as rmSync17, writeFileSync as writeFileSync28 } from "node:fs";
import { join as join28 } from "node:path";
var BASELINE_MANIFEST = "manifest/baseline-package.xml";
function environmentNamed(config, name) {
  const env = config.environments.find((e) => e.branch === name.toLowerCase() || e.name.toLowerCase() === name.toLowerCase());
  if (!env) throw new AccError("usage", `No environment "${name}". The config has: ${config.environments.map((e) => e.branch).join(", ")}.`);
  return env;
}
var driftReportPath = (paths, branch) => join28(paths.stateDir, "drift", `${branch}.json`);
var FOLDER = {
  ApexClass: "classes",
  ApexTrigger: "triggers",
  ApexPage: "pages",
  ApexComponent: "components",
  CustomObject: "objects",
  CustomField: "fields",
  ListView: "listViews",
  RecordType: "recordTypes",
  ValidationRule: "validationRules",
  WebLink: "webLinks",
  CompactLayout: "compactLayouts",
  FieldSet: "fieldSets",
  BusinessProcess: "businessProcesses",
  Flow: "flows",
  ContentAsset: "contentassets",
  ReportType: "reportTypes",
  Layout: "layouts",
  PermissionSet: "permissionsets",
  Profile: "profiles",
  CustomTab: "tabs",
  CustomApplication: "applications",
  QuickAction: "quickActions",
  FlexiPage: "flexipages",
  StaticResource: "staticresources",
  LightningComponentBundle: "lwc",
  AuraDefinitionBundle: "aura",
  EmailTemplate: "email",
  Report: "reports",
  Dashboard: "dashboards",
  GlobalValueSet: "globalValueSets",
  StandardValueSet: "standardValueSets",
  CustomMetadata: "customMetadata",
  CustomLabels: "labels"
};
function filesFor(type, fullName, tracked) {
  const parts = fullName.split(".");
  const name = parts.pop();
  const folder = FOLDER[type];
  return tracked.filter((f) => {
    const segs = f.split("/");
    const base = segs.at(-1);
    const inBundle = segs.at(-2) === name && (type === "LightningComponentBundle" || type === "AuraDefinitionBundle");
    if (!base.startsWith(`${name}.`) && !inBundle) return false;
    if (folder && !segs.includes(folder)) return false;
    return parts.every((p) => segs.includes(p));
  });
}
function failures(stdout) {
  let files = [];
  try {
    files = parseJsonOutput(stdout).result?.files ?? [];
  } catch {
    files = [];
  }
  const failed = files.filter((f) => f.state === "Failed");
  const isAbsent = (f) => /cannot be found/i.test(f.error ?? "");
  return {
    lacking: failed.filter(isAbsent).map((f) => ({ type: f.type ?? "", fullName: f.fullName ?? "" })),
    other: failed.filter((f) => !isAbsent(f)).map((f) => `${f.type && f.fullName ? `${f.type}:${f.fullName}: ` : ""}${(f.error ?? "failed").trim()}`)
  };
}
function statusOf(run2, dir) {
  const r = run2("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: dir });
  if (r.code !== 0) throw new AccError("git", `git status failed in the drift worktree: ${lastLine(r.stderr)}`);
  const changed = [];
  const added = [];
  for (const entry of r.stdout.split("\0").filter(Boolean)) {
    const [code2, path] = [entry.slice(0, 2), entry.slice(3)];
    (code2 === "??" ? added : changed).push(path);
  }
  return { changed, added };
}
function drift(paths, config, envName, deps, opts = {}) {
  if (config.profile !== "salesforce") throw new AccError("usage", "acc drift compares a Salesforce org with its branch. This project has no orgs.");
  const env = environmentNamed(config, envName);
  if (!env.org) throw new AccError("usage", `${env.name} has no org alias in .acc/config.json.`);
  const manifest = opts.manifest ?? BASELINE_MANIFEST;
  const git10 = (args, cwd = paths.root) => deps.run("git", args, { cwd });
  if (git10(["remote", "get-url", "origin"]).code === 0) git10(["fetch", "--quiet", "origin", env.branch]);
  const ref = [`origin/${env.branch}`, env.branch].find((r) => git10(["rev-parse", "--verify", "--quiet", `${r}^{commit}`]).code === 0);
  if (!ref) throw new AccError("no-base", `There's no ${env.branch} or origin/${env.branch} branch to compare ${env.name} with.`);
  const base = git10(["rev-parse", ref]).stdout.trim();
  if (git10(["cat-file", "-e", `${base}:${manifest}`]).code !== 0) throw new AccError("usage", `${ref} has no ${manifest}. Make the baseline manifest first (ONBOARDING.md, B5), or pass --manifest.`);
  deps.onRetrieve?.(env);
  const dir = join28(paths.stateDir, "drift", `${env.branch}-${deps.now().getTime()}`);
  mkdirSync28(join28(paths.stateDir, "drift"), { recursive: true });
  const add2 = git10(["worktree", "add", "--detach", "--quiet", dir, base]);
  if (add2.code !== 0) throw new AccError("git", `Couldn't make a throwaway worktree: ${lastLine(add2.stderr)}`);
  try {
    const args = ["project", "retrieve", "start", "--manifest", manifest, "--target-org", env.org, "--ignore-conflicts", "--wait", "60", "--json"];
    const retrieve = () => deps.run(...niced("sf", args), { cwd: dir, timeoutMs: 70 * 6e4, env: sfEnv() });
    const r = withSlot(retrieve, { owner: { what: `Drift check on ${env.branch}`, env: env.branch, project: config.project }, ...deps.slots, onWait: deps.onWait });
    const log = join28(paths.logs, "drift", `${env.branch}.log`);
    mkdirSync28(join28(paths.logs, "drift"), { recursive: true });
    writeFileSync28(log, `$ ${shellLine("sf", args)}
# exit ${r.code}

${r.stdout}${r.stderr ? `
--- stderr ---
${r.stderr}` : ""}`);
    let status;
    let message2 = "";
    try {
      const j2 = parseJsonOutput(r.stdout);
      status = j2.status;
      message2 = j2.message ?? "";
    } catch {
      status = void 0;
    }
    if (r.code !== 0 || status !== 0) throw new AccError("sf", `The retrieve from ${env.org} failed: ${message2.trim() || lastLine(r.stderr || r.stdout) || `exit ${r.code}`}. The full output is in ${log}`);
    const expected = [...readList(dir, config.knownDrift), ...readList(dir, config.environmentSpecific)];
    const found = statusOf(deps.run, dir);
    const source = packageDirs(dir);
    found.changed = under(found.changed, source);
    found.added = under(found.added, source);
    const keep = (p) => !listed(p, expected);
    const changed = found.changed.filter(keep);
    const added = found.added.filter(keep);
    const { lacking, other } = failures(r.stdout);
    const tracked = under(git10(["ls-files"], dir).stdout.split("\n").filter(Boolean), source);
    const lackingFiles = [...new Set(lacking.flatMap((c) => filesFor(c.type, c.fullName, tracked)))].sort();
    const missing = lackingFiles.filter(keep);
    const result = {
      env: env.branch,
      org: env.org,
      base,
      changed,
      added,
      missing,
      unretrievable: other,
      ignored: found.changed.length + found.added.length + lackingFiles.length - changed.length - added.length - missing.length,
      checkedAt: deps.now().toISOString(),
      kept: opts.keep ? dir : null
    };
    writeFileSync28(driftReportPath(paths, env.branch), JSON.stringify(result, null, 2) + "\n");
    return result;
  } finally {
    if (!opts.keep) {
      git10(["worktree", "remove", "--force", dir]);
      if (existsSync20(dir)) rmSync17(dir, { recursive: true, force: true });
      git10(["worktree", "prune"]);
    }
  }
}

// packages/core/src/edit.ts
var EDIT_FIELDS = ["title", "brief", "deps", "environment", "labels", "notes"];
var EDIT_FIELD_WORDS = {
  title: "title",
  brief: "description",
  deps: "dependencies",
  environment: "environment",
  labels: "labels",
  notes: "notes for the builder"
};
var editedWords = (fields) => fields.map((f) => Object.hasOwn(EDIT_FIELD_WORDS, f) ? EDIT_FIELD_WORDS[f] : f).join(", ");
var EDITABLE_STATES = ["todo", "blocked", "rework", "review"];
var TRACKER_OWNED = ["title", "brief", "deps", "labels"];
function editRefusal(task) {
  if (task.state === "running") return "Its builder is working from the brief it was given. Edit it once the builder stops.";
  if (task.state === "done") return "It is done: its work has landed, so there is nothing left to change.";
  return EDITABLE_STATES.includes(task.state) ? null : `It is ${task.state}, and only a task to do, blocked, in rework or in review can be edited.`;
}
var trackerFields = (task) => task.source.kind === "manual" ? [] : TRACKER_OWNED;
function trackerOwns(task) {
  if (task.source.kind === "manual") return null;
  return `Its ${trackerName(task.source.kind)} ticket owns its title, description, dependencies and labels: change them there, and intake brings them in.`;
}
var cleanList = (xs) => [...new Set(xs.map((x2) => x2.trim()).filter(Boolean))];
function editChanges(task, config, edit) {
  const next = {};
  if (edit.title !== void 0) {
    const title = edit.title.trim();
    if (!title) throw new AccError("usage", `${task.id} needs a title.`);
    if (title !== task.title) next.title = title;
  }
  if (edit.brief !== void 0 && edit.brief.trim() !== task.brief) next.brief = edit.brief.trim();
  if (edit.deps !== void 0) {
    const deps = taskDeps(cleanList(edit.deps), task.source.kind);
    if (deps.includes(task.id)) throw new AccError("usage", `${task.id} can't depend on itself.`);
    if (JSON.stringify(deps) !== JSON.stringify(task.deps)) next.deps = deps;
  }
  if (edit.environment !== void 0 && edit.environment.trim() !== task.environment) {
    const env = edit.environment.trim();
    const why = environmentProblem(config, env);
    if (why) throw new AccError("usage", `${task.id}: ${why}`);
    next.environment = env;
  }
  if (edit.labels !== void 0) {
    const labels = cleanList(edit.labels);
    if (JSON.stringify(labels) !== JSON.stringify(task.labels)) next.labels = labels;
  }
  if (edit.notes !== void 0 && edit.notes.trim() !== (task.notes ?? "")) next.notes = edit.notes.trim();
  return next;
}
function editTask(ledger, config, id, edit, actor, by, emit, now2) {
  const task = ledger.tasks.find((t) => t.id === id);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  if (actor === "builder" || actor === "reviewer") throw new AccError("refused", `Only a person edits ${id}: a ${actor} works from the brief it was given.`);
  const refused = editRefusal(task);
  if (refused) throw new AccError("refused", `${id} can't be edited. ${refused}`);
  const next = editChanges(task, config, edit);
  const owned = trackerFields(task).filter((f) => f in next);
  if (owned.length) throw new AccError("refused", `${id}'s ${owned.map((f) => EDIT_FIELD_WORDS[f]).join(", ")} can't be edited here. ${trackerOwns(task)}`);
  const changed = EDIT_FIELDS.filter((f) => f in next);
  if (!changed.length) return { task, changed };
  Object.assign(task, next);
  const at2 = now2().toISOString();
  task.updatedAt = at2;
  (task.edits ??= []).push({ at: at2, actor, by, fields: changed });
  emit({ type: "task.updated", task: id, actor, by, data: next });
  return { task, changed };
}

// packages/core/src/github.ts
var CLONE_ACCOUNT_KEY = "acc.githubAccount";
var credentialHelper = (fallback) => `!f() { test "$1" = get || exit 0; a=$(git config --get ${CLONE_ACCOUNT_KEY} || echo ${fallback}); echo username=$a; echo "password=$(gh auth token -u $a)"; }; f`;
var LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
function cloneAccount(run2, root) {
  const r = run2("git", ["config", "--get", CLONE_ACCOUNT_KEY], { cwd: root });
  const v = r.stdout.trim();
  return r.code === 0 && LOGIN.test(v) ? v : null;
}
function withCloneAccount(config, root, run2) {
  if (!config.github) return config;
  const mine = cloneAccount(run2, root);
  return mine && mine !== config.github.account ? { ...config, github: { ...config.github, account: mine } } : config;
}
function parseGhStatus(text) {
  const out3 = [];
  for (const block of text.split(/(?=Logged in to )/)) {
    const m = /^Logged in to github\.com account (\S+)/.exec(block);
    if (!m) continue;
    const scopes = /Token scopes: (.*)/.exec(block)?.[1] ?? "";
    out3.push({ login: m[1], active: /Active account: true/.test(block), scopes: [...scopes.matchAll(/'([^']+)'/g)].map((s) => s[1]) });
  }
  return out3;
}
function ghAccounts(run2, env = process.env) {
  const r = run2("gh", ["auth", "status", "--hostname", "github.com"], { env });
  if (r.code === 127) return null;
  return parseGhStatus(r.stdout + r.stderr);
}
function pushSetup(run2, root) {
  const r = run2("git", ["config", "--get-all", "credential.helper"], { cwd: root });
  const helpers = r.code === 0 ? r.stdout.split("\n").filter((l3) => l3.trim()) : [];
  if (helpers.some((h2) => h2.includes(CLONE_ACCOUNT_KEY))) return { kind: "follows", account: null };
  const pinned = helpers.map((h2) => /gh auth token -u ([A-Za-z0-9-]+)/.exec(h2)?.[1]).find(Boolean);
  if (pinned) return { kind: "pinned", account: pinned };
  return { kind: helpers.length ? "other" : "none", account: null };
}
function githubIdentity(config, root, run2, env = process.env) {
  if (!config.github) return null;
  const mine = cloneAccount(run2, root);
  const account = mine ?? config.github.account;
  const accounts = ghAccounts(run2, env);
  const git10 = (k2) => {
    const r = run2("git", ["config", "--get", k2], { cwd: root });
    return r.code === 0 ? r.stdout.trim() || null : null;
  };
  const push = pushSetup(run2, root);
  return {
    repo: config.github.repo,
    account,
    from: mine && mine !== config.github.account ? "clone" : "config",
    projectAccount: config.github.account,
    signedIn: !!accounts?.some((a2) => a2.login.toLowerCase() === account.toLowerCase()),
    accounts,
    commit: { name: git10("user.name"), email: git10("user.email") },
    pushesAs: push.kind === "follows" ? account : push.account,
    push: push.kind
  };
}
function useGithubAccount(config, root, run2, account, env = process.env) {
  if (!config.github) throw new AccError("no-github", 'This project has no "github" section in .acc/config.json.');
  const want = account ?? config.github.account;
  if (!LOGIN.test(want)) throw new AccError("usage", `${want} isn't a GitHub login.`);
  const accounts = ghAccounts(run2, env);
  if (accounts && !accounts.some((a2) => a2.login.toLowerCase() === want.toLowerCase())) {
    throw new AccError("not-signed-in", `gh isn't logged in as ${want}. Sign in first: in VSCode, "Sign in to GitHub as this repo's account"; in a terminal, gh auth login.`);
  }
  const git10 = (...args) => run2("git", args, { cwd: root });
  if (want === config.github.account) git10("config", "--unset", CLONE_ACCOUNT_KEY);
  else if (git10("config", CLONE_ACCOUNT_KEY, want).code !== 0) throw new AccError("git", `Couldn't record ${want} in this clone's git config.`);
  if (pushSetup(run2, root).kind !== "follows") {
    git10("config", "--unset-all", "credential.helper");
    git10("config", "credential.helper", "");
    git10("config", "--add", "credential.helper", credentialHelper(config.github.account));
  }
  return githubIdentity(config, root, run2, env);
}

// packages/core/src/init.ts
import { existsSync as existsSync22 } from "node:fs";
import { join as join30 } from "node:path";

// packages/core/src/onboarding/helpers.ts
import { existsSync as existsSync21, readFileSync as readFileSync29 } from "node:fs";
import { join as join29 } from "node:path";
var pass2 = (detail) => ({ status: "pass", detail });
var fail2 = (detail, fix) => fix ? { status: "fail", detail, fix } : { status: "fail", detail };
var unknown = (detail) => ({ status: "unknown", detail });
var skip2 = (detail) => ({ status: "skip", detail });
function makeContext(cwd, run2, env = process.env, version = null) {
  let paths = null;
  try {
    paths = repoPaths(cwd, run2);
  } catch {
    paths = null;
  }
  let config = null;
  let configErrors = [];
  if (paths && existsSync21(paths.config)) {
    try {
      const r = parseConfig(JSON.parse(readFileSync29(paths.config, "utf8")));
      config = r.config;
      configErrors = r.errors;
    } catch (e) {
      configErrors = [`.acc/config.json isn't valid JSON: ${e.message}`];
    }
  }
  if (config && paths) config = withCloneAccount(config, paths.root, run2);
  return { cwd, run: run2, env, paths, config, configErrors, cache: /* @__PURE__ */ new Map(), version };
}
function cached(ctx, key, fn2) {
  if (!ctx.cache.has(key)) ctx.cache.set(key, fn2());
  return ctx.cache.get(key);
}
function versionAtLeast(version, min) {
  const a2 = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < Math.max(a2.length, b.length); i++) {
    const x2 = a2[i] ?? 0;
    const y2 = b[i] ?? 0;
    if (x2 !== y2) return x2 > y2;
  }
  return true;
}
var SEMVER = /^\d+\.\d+\.\d+$/;
var pluginBehind = (plugin, acc) => !!plugin && !!acc && SEMVER.test(plugin) && SEMVER.test(acc) && !versionAtLeast(plugin, acc);
var firstVersion = (text) => /(\d+\.\d+(?:\.\d+)?)/.exec(text)?.[1] ?? null;
function sfJson(ctx, args) {
  return cached(ctx, `sf ${args.join("\0")}`, () => {
    const r = ctx.run("sf", [...args, "--json"], { cwd: ctx.paths?.root ?? ctx.cwd, env: sfEnv(ctx.env) });
    if (r.code === 127) return { status: 127, message: "The Salesforce CLI (sf) isn't installed." };
    try {
      return parseJsonOutput(r.stdout);
    } catch {
      return { status: r.code || 1, message: (r.stderr || r.stdout).trim().split("\n")[0] ?? "sf failed" };
    }
  });
}
function ghEnv2(ctx) {
  const account = ctx.config?.github?.account;
  if (!account) return null;
  return cached(ctx, `gh-token ${account}`, () => {
    const t = ctx.run("gh", ["auth", "token", "-u", account], { env: ctx.env });
    if (t.code !== 0 || !t.stdout.trim()) return null;
    return { ...ctx.env, GH_TOKEN: t.stdout.trim() };
  });
}
function parseOrgUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { kind: "unknown" };
  }
  const sb = /^([a-z0-9-]+?)--([a-z0-9]+)\.sandbox\.my\.salesforce\.com$/.exec(host);
  if (sb) return { kind: "sandbox", domain: sb[1], sandbox: sb[2] };
  const prod = /^([a-z0-9-]+)\.my\.salesforce\.com$/.exec(host);
  if (prod) return { kind: "production", domain: prod[1] };
  return { kind: "unknown" };
}
var LICENSE_TO_TYPE = {
  DEVELOPER: "developer",
  DEVELOPER_PRO: "developer_pro",
  PARTIAL: "partial",
  FULL: "full"
};
function readText(root, rel) {
  const f = join29(root, rel);
  return existsSync21(f) ? readFileSync29(f, "utf8") : null;
}
var SECRET_PATTERN = [
  "force://[A-Za-z0-9._~-]+:[^@[:space:]]+@",
  '"access_token"[[:space:]]*:[[:space:]]*"[^"]{20,}"',
  "<consumerSecret>[A-Za-z0-9]{8,}</consumerSecret>",
  "<password>[^<[:space:]]{6,}</password>",
  "sk_live_[0-9a-zA-Z]{20,}",
  "-----BEGIN [A-Z ]*PRIVATE KEY-----",
  "gh[pousr]_[0-9A-Za-z]{30,}",
  "AKIA[0-9A-Z]{16}"
].join("|");

// packages/core/src/template.ts
import { createHash as createHash3 } from "node:crypto";
var TEMPLATE_MAX_BYTES = COPY_KINDS.template.maxBytes;
var TEMPLATE_AUTONOMY = ["manual", "review"];
var given = (v) => v !== void 0 && v !== null;
var SIGN_IN = /^(token|api[-_]?token|access[-_]?token|api[-_]?key|password|passwd|pat|secret|client[-_]?secret|email|username|user|credentials?)$/i;
var ALLOWED = {
  top: ["schema", "name", "description", "profile", "environments", "gates", "tracker", "autonomy", "agents", "rules"],
  environment: ["name", "type", "default", "protected", "promotesTo", "branch"],
  gates: ["required", "commands", "heavy", "severity"],
  agents: ["max", ...AGENT_ROLES],
  role: ["model", "effort", "fallbackModel"]
};
var OWN = "belongs to a project's own .acc/config.json, not a team template";
var PROJECT_ONLY = {
  top: {
    project: OWN,
    github: `${OWN}: acc init finds the repo and the account it pushes as`,
    commitIdentity: `${OWN}: it's each repo's own`,
    environmentSpecific: OWN,
    knownDrift: OWN,
    worktrees: OWN,
    secretScan: OWN,
    strayFiles: OWN,
    analysis: OWN,
    sourceTracking: `${OWN}: whether a client's orgs use source tracking is each project's own`,
    autopilot: OWN,
    template: `${OWN}: acc init records it`,
    trackers: `isn't a template key: a template names one tracker, under "tracker"`
  },
  environment: { org: `${OWN}: an org alias is each person's own, and acc init finds it` },
  agents: { permissionMode: `${OWN}, so a fetched file can't loosen what builders may do` },
  tracker: {
    repo: `${OWN}: a GitHub tracker reads the project's own repo`,
    team: OWN,
    edits: `${OWN}: whether acc may change tickets is each project's choice (D-082)`,
    epic: OWN,
    labels: OWN,
    areaPath: OWN,
    group: OWN,
    statusColumn: OWN,
    skipLabels: OWN
  }
};
var TRACKER_KEYS = {
  github: ["kind"],
  jira: ["kind", "site", "project"],
  azure: ["kind", "organization", "project", "prefix"],
  monday: ["kind", "account", "board", "prefix"],
  // A template never names a Slack tracker (refused below), so only its kind is known here.
  slack: ["kind"]
};
var PLACE = {
  jira: { key: "site", example: "acme.atlassian.net" },
  azure: { key: "organization", example: "acme, as in dev.azure.com/acme" },
  monday: { key: "account", example: "acme, as in acme.monday.com" }
};
var unknownKey = (at2) => `"${at2}" isn't a template key. If the template was written for a newer acc, update acc.`;
var signIn = (at2) => `"${at2}" looks like a sign-in, and a team template never holds one: each person signs in on the Command Center's Connect page.`;
function checkKeys(obj, path, allowed, own, errors, elsewhere = () => null) {
  for (const k2 of Object.keys(obj)) {
    const at2 = path ? `${path}.${k2}` : k2;
    if (SIGN_IN.test(k2)) errors.push(signIn(at2));
    else if (allowed.includes(k2)) continue;
    else if (Object.hasOwn(own, k2)) errors.push(`"${at2}" ${own[k2]}.`);
    else errors.push(elsewhere(k2) ?? unknownKey(at2));
  }
}
function parseTemplate(raw) {
  const errors = [];
  if (!isObj(raw)) return { template: null, errors: ["A team template must be a JSON object."] };
  checkKeys(raw, "", ALLOWED.top, PROJECT_ONLY.top, errors);
  if (raw.schema !== 1) errors.push('"schema" must be 1.');
  if (!isStr(raw.name) || raw.name.trim().length > 80) errors.push('"name" must be a short name for the template, such as "ACME Salesforce".');
  if (given(raw.description) && (typeof raw.description !== "string" || raw.description.length > 1e3)) errors.push('"description" must be a sentence or two about the template.');
  let profile = null;
  if (given(raw.profile)) {
    if (PROFILES.includes(raw.profile)) profile = raw.profile;
    else errors.push(`"profile" must be one of ${PROFILES.join(", ")}.`);
  }
  const p = profile ?? "generic";
  let environments = null;
  if (given(raw.environments)) {
    if (Array.isArray(raw.environments)) raw.environments.forEach((e, i) => {
      if (isObj(e)) checkKeys(e, `environments[${i}]`, ALLOWED.environment, PROJECT_ONLY.environment, errors);
    });
    environments = parseEnvironments(raw.environments, profile, errors, { typesFromDiscovery: true }).map(({ org: _org, ...e }) => e);
  }
  const probe = {
    schema: 1,
    project: "template",
    profile: p,
    environments: [{ name: "main", type: p === "salesforce" ? "developer" : "none", default: true }]
  };
  let gates = null;
  if (given(raw.gates)) {
    if (!isObj(raw.gates)) errors.push('"gates" must be an object, such as { "required": ["test"], "commands": { "test": "npm test" } }.');
    else {
      checkKeys(raw.gates, "gates", ALLOWED.gates, {}, errors);
      probe.gates = raw.gates;
      gates = Object.fromEntries(ALLOWED.gates.filter((k2) => given(raw.gates[k2])).map((k2) => [k2, raw.gates[k2]]));
    }
  }
  let agents = null;
  if (given(raw.agents)) {
    if (!isObj(raw.agents)) errors.push('"agents" must be an object, such as { "max": 3 }.');
    else {
      const a2 = raw.agents;
      checkKeys(a2, "agents", ALLOWED.agents, PROJECT_ONLY.agents, errors);
      for (const role of AGENT_ROLES) if (isObj(a2[role])) checkKeys(a2[role], `agents.${role}`, ALLOWED.role, {}, errors);
      probe.agents = { max: a2.max, builder: a2.builder, reviewer: a2.reviewer };
      const roleOf = (role) => {
        const r = a2[role];
        if (!isObj(r)) return void 0;
        const set = Object.fromEntries(ALLOWED.role.filter((k2) => given(r[k2])).map((k2) => [k2, r[k2]]));
        return Object.keys(set).length ? set : void 0;
      };
      agents = { ...given(a2.max) ? { max: a2.max } : {}, ...Object.fromEntries(AGENT_ROLES.flatMap((role) => roleOf(role) ? [[role, roleOf(role)]] : [])) };
    }
  }
  let tracker = null;
  let trackerProbe = null;
  if (given(raw.tracker)) {
    const t = raw.tracker;
    if (!isObj(t)) errors.push('"tracker" must be an object, such as { "kind": "jira", "site": "acme.atlassian.net", "project": "ACME" }.');
    else if (!isTrackerKind(t.kind)) {
      errors.push(`"tracker.kind" must be ${orList([...TRACKER_KINDS])}.`);
    } else if (t.kind === "slack") {
      errors.push(`"tracker.kind" can't be slack in a team template: a Slack tracker's channel is each project's own, so each project names it in its own config.`);
    } else {
      const kind = t.kind;
      const own = kind === "monday" ? PROJECT_ONLY.tracker : { ...PROJECT_ONLY.tracker, board: `${OWN}: which board the Tasks tab shows is each project's own` };
      const other = (k2) => {
        const takes = TRACKER_KINDS.filter((x2) => TRACKER_KEYS[x2].includes(k2));
        return takes.length ? `"tracker.${k2}" is for ${orList(takes.map(trackerName))} trackers only, and this one is ${trackerName(kind)}.` : null;
      };
      const before = errors.length;
      checkKeys(t, "tracker", TRACKER_KEYS[kind], own, errors, other);
      const place2 = PLACE[kind];
      if (place2 && !isStr(t[place2.key])) errors.push(`"tracker.${place2.key}" is needed for ${trackerName(kind)}, such as ${place2.example}.`);
      if (given(t.project) && !isStr(t.project)) errors.push(`"tracker.project" must be the project's key or name.`);
      if (errors.length === before) {
        trackerProbe = {
          kind,
          site: t.site,
          organization: t.organization,
          account: t.account,
          prefix: t.prefix,
          project: t.project ?? (kind === "jira" || kind === "azure" ? "TEMPLATE" : void 0),
          board: t.board ?? (kind === "monday" ? 1 : void 0)
        };
        probe.trackers = [trackerProbe];
        tracker = {
          kind,
          site: isStr(t.site) ? t.site.trim().toLowerCase() : null,
          organization: isStr(t.organization) ? t.organization.trim() : null,
          account: isStr(t.account) ? t.account.trim().toLowerCase() : null,
          project: isStr(t.project) ? t.project.trim() : null,
          board: Number.isSafeInteger(t.board) ? t.board : null,
          prefix: isStr(t.prefix) ? t.prefix.trim().toUpperCase() : null
        };
      }
    }
  }
  let autonomy = null;
  if (given(raw.autonomy)) {
    if (TEMPLATE_AUTONOMY.includes(raw.autonomy)) autonomy = raw.autonomy;
    else if (raw.autonomy === "dispatch" || raw.autonomy === "full") errors.push(`"autonomy" can't be ${raw.autonomy} in a template: a template starts a project at manual or review, and a person raises it in the project's own config (D-014).`);
    else errors.push(`"autonomy" must be one of ${TEMPLATE_AUTONOMY.join(", ")}.`);
  }
  let rules = null;
  if (given(raw.rules)) {
    if (!Array.isArray(raw.rules) || !raw.rules.length || !raw.rules.every(isStr)) errors.push('"rules" must be a list of rules files to copy in, such as ["https://github.com/acme/acc-rules/blob/main/salesforce.md"].');
    else {
      const named = /* @__PURE__ */ new Map();
      raw.rules.forEach((s, i) => {
        const problem = templateRulesProblem(s);
        if (problem) return errors.push(`"rules[${i}]": ${problem}`);
        const name = rulesName(s);
        if (named.has(name)) errors.push(`"rules[${i}]" and "rules[${named.get(name)}]" would both be copied to .acc/rules/${name}.md. Rename one of the files.`);
        named.set(name, i);
      });
      rules = raw.rules.map((s) => s.trim());
    }
  }
  const checked = parseConfig(probe);
  errors.push(...checked.errors.map((e) => e.replace(/^trackers\[0\]: /, "tracker: ")));
  if (errors.length) return { template: null, errors: [...new Set(errors)] };
  return {
    template: {
      name: raw.name.trim(),
      description: isStr(raw.description) ? raw.description.trim() : null,
      profile,
      environments,
      gates,
      tracker,
      autonomy,
      agents,
      rules
    },
    errors: []
  };
}
var canonical = (v) => Array.isArray(v) ? v.map(canonical) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k2) => [k2, canonical(v[k2])])) : v;
var templateDigest = (raw) => `sha256:${createHash3("sha256").update(JSON.stringify(canonical(raw))).digest("hex")}`;
function fetchTemplateText(run2, source, opts = {}) {
  return fetchSource(run2, source, "template", opts).text;
}
function readTemplate(run2, source, opts = {}) {
  const text = fetchTemplateText(run2, source, opts);
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { template: null, errors: [`It isn't valid JSON: ${e.message}`], raw: null, digest: null };
  }
  return { ...parseTemplate(raw), raw, digest: templateDigest(raw) };
}
function loadTemplate(run2, source, opts = {}) {
  const r = readTemplate(run2, source, opts);
  if (!r.template) throw new AccError("bad-template", `${source.trim()} isn't a team template acc can use:
- ${r.errors.join("\n- ")}`);
  return { template: r.template, record: { name: r.template.name, source: recordedSource(source, opts), digest: r.digest } };
}
function overlayEnvironments(tEnvs, base, profile, notes) {
  if (profile !== "salesforce") {
    return tEnvs.map((e) => ({ name: e.name, type: e.type ?? "none", org: null, default: e.default, protected: e.protected, promotesTo: [...e.promotesTo] }));
  }
  const named = new Map(tEnvs.map((e) => [e.branch, e]));
  const exists = new Set(base.map((e) => branchFor(e.name)));
  const out3 = base.map((e) => ({ ...e, promotesTo: [...e.promotesTo] }));
  for (const e of tEnvs) if (!exists.has(e.branch)) notes.push(`The template's ${e.name} isn't one of Production's sandboxes, so it's left out.`);
  const tDefault = tEnvs.find((e) => e.default);
  const useDefault = !!tDefault && exists.has(tDefault.branch);
  if (tDefault && !useDefault) {
    const stays = out3.find((e) => e.default);
    notes.push(`The template's default, ${tDefault.name}, isn't one of Production's sandboxes${stays ? `, so ${stays.name} stays the default` : ""}.`);
  }
  for (const e of out3) {
    const branch = branchFor(e.name);
    const t = named.get(branch);
    if (!t) {
      if (e.type !== "production") notes.push(`${e.name} isn't in the template, so it keeps acc's usual path${e.promotesTo.length ? ` (to ${e.promotesTo.join(", ")})` : ""}.`);
      if (useDefault) e.default = false;
      continue;
    }
    if (t.type && t.type !== e.type) notes.push(`The template says ${t.name} is ${t.type}, but Production's sandbox list says ${e.type}, and that wins.`);
    const dropped = t.promotesTo.filter((b) => !exists.has(b));
    if (dropped.length) notes.push(`${e.name}'s promotion to ${dropped.join(", ")} is left out: ${dropped.length === 1 ? "that isn't one of Production's sandboxes" : "those aren't Production's sandboxes"}.`);
    e.promotesTo = t.promotesTo.filter((b) => exists.has(b));
    e.protected = e.type === "production" || t.protected;
    if (useDefault) e.default = t.default;
  }
  return out3;
}
function overlaySettings(t, base) {
  const g = t.gates ?? {};
  const a2 = t.agents ?? {};
  const role = (r) => base.agents[r] || a2[r] ? { [r]: { ...base.agents[r], ...a2[r] } } : {};
  return {
    gates: {
      ...base.gates,
      ...g.required ? { required: [...g.required] } : {},
      commands: { ...base.gates.commands, ...g.commands },
      ...g.heavy ? { heavy: [...g.heavy] } : {},
      ...g.severity !== void 0 ? { severity: g.severity } : {}
    },
    agents: { ...base.agents, ...a2.max !== void 0 ? { max: a2.max } : {}, ...role("builder"), ...role("reviewer") },
    autonomy: t.autonomy ?? base.autonomy
  };
}
var trackerRaw = (t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v !== null));
function templateTrackers(t, flags, notes) {
  const out3 = [];
  let site = flags.jiraSite;
  let project2 = flags.jiraProject;
  const connect = "Connect one on the Command Center's Connect page.";
  if (t?.kind === "jira") {
    site ??= t.site ?? void 0;
    project2 ??= t.project ?? void 0;
  } else if (t?.kind === "azure" && !t.project) notes.push(`The template's Azure DevOps tracker, dev.azure.com/${t.organization}, names no project, so it's left out. ${connect}`);
  else if (t?.kind === "monday" && !t.board) notes.push(`The template's monday.com tracker, ${t.account}.monday.com, names no board, so it's left out. ${connect}`);
  else if (t) out3.push(trackerRaw(t));
  if (site && project2) out3.push({ kind: "jira", site, project: project2 });
  else if (t?.kind === "jira") notes.push(`The template's Jira tracker, ${site}, names no project, so it's left out. Pass --jira-project <key>, or connect one on the Command Center's Connect page.`);
  return out3;
}
function pickedTracker(tracker, was, notes) {
  const picked = Object.fromEntries(Object.entries(tracker).filter(([, v]) => v !== null && v !== void 0));
  const t = was.template;
  const host = (r) => String(r.site ?? r.organization ?? r.account ?? r.repo ?? "").toLowerCase();
  const prefix = t?.prefix && t.kind === picked.kind && host(trackerRaw(t)) === host(picked) && typeof picked.prefix !== "string" ? t.prefix : null;
  if (t) notes.push(`The tracker picked (--tracker) replaces the template's: ${trackerWords(t)}${prefix ? `, keeping its key prefix ${prefix}` : ""}.`);
  if (was.jiraSite || was.jiraProject) notes.push("The tracker picked (--tracker) replaces --jira-site and --jira-project.");
  return prefix ? { ...picked, prefix } : picked;
}
var envWords = (e) => `${e.name}${e.type ? ` (${e.type})` : ""}${e.default ? ", the default" : ""}${e.protected ? ", protected" : ""}${e.promotesTo.length ? ` \u2192 ${e.promotesTo.join(", ")}` : ""}`;
function trackerWords(t) {
  if (t.kind === "jira") return `Jira on ${t.site}${t.project ? `, project ${t.project}` : ", no project"}`;
  if (t.kind === "azure") return `Azure DevOps, dev.azure.com/${t.organization}${t.project ? `, project ${t.project}` : ", no project"}`;
  if (t.kind === "monday") return `monday.com, ${t.account}.monday.com${t.board ? `, board ${t.board}` : ", no board"}`;
  return "GitHub issues in the project's own repo";
}
var roleWords = (p) => [p.model ? `model ${p.model}` : "", p.effort ? `effort ${p.effort}` : "", p.fallbackModel ? `falls back to ${p.fallbackModel}` : ""].filter(Boolean).join(", ");
function describeTemplate(t) {
  const lines = [];
  if (t.profile) lines.push(`Profile: ${t.profile}`);
  if (t.environments) lines.push(`Environments: ${t.environments.map(envWords).join("; ")}`);
  if (t.gates?.required) lines.push(`Required checks: ${t.gates.required.join(", ") || "none"}`);
  if (t.gates?.heavy) lines.push(`Heavy checks: ${t.gates.heavy.join(", ") || "none"}`);
  if (t.gates?.severity !== void 0) lines.push(`Code Analyzer fails at severity ${t.gates.severity} and worse`);
  if (t.tracker) lines.push(`Tracker: ${trackerWords(t.tracker)}`);
  if (t.autonomy) lines.push(`Autonomy: ${t.autonomy}`);
  if (t.agents?.max !== void 0) lines.push(`Agents: at most ${t.agents.max} at once`);
  for (const role of AGENT_ROLES) if (t.agents?.[role]) lines.push(`${role === "builder" ? "Builders" : "Reviewers"}: ${roleWords(t.agents[role])}`);
  if (t.rules) lines.push(`Rules copied into .acc/rules/: ${t.rules.join("; ")}`);
  return lines;
}
var sameList = (a2, b) => JSON.stringify([...a2].sort()) === JSON.stringify([...b].sort());
var envKey = (e) => JSON.stringify([branchFor(e.name), e.type, e.org, e.default, e.protected, e.promotesTo]);
var place = (t) => (t.site ?? t.organization ?? t.account ?? "").toLowerCase();
function templateDifferences(t, config, repo) {
  const diffs = [];
  if (t.profile && t.profile !== config.profile) diffs.push("profile");
  if (t.environments && (t.profile ?? config.profile) === config.profile) {
    const base = config.environments.map(({ branch: _branch, ...e }) => e);
    const want = overlayEnvironments(t.environments, base, config.profile, []);
    if (!sameList(want.map(envKey), base.map(envKey))) diffs.push("environments");
  }
  const g = t.gates ?? {};
  if (g.required && !sameList(g.required, config.gates.required)) diffs.push("gates.required");
  if (g.commands && Object.entries(g.commands).some(([k2, v]) => config.gates.commands[k2] !== v)) diffs.push("gates.commands");
  if (g.heavy && !sameList(g.heavy, config.gates.heavy)) diffs.push("gates.heavy");
  if (g.severity !== void 0 && g.severity !== config.gates.severity) diffs.push("gates.severity");
  if (t.tracker && !config.trackers.some((c) => c.kind === t.tracker.kind && place(c) === place(t.tracker))) diffs.push("tracker");
  if (t.autonomy && t.autonomy !== config.autonomy) diffs.push("autonomy");
  if (t.agents?.max !== void 0 && t.agents.max !== config.agents.max) diffs.push("agents.max");
  for (const role of AGENT_ROLES) {
    for (const [k2, v] of Object.entries(t.agents?.[role] ?? {})) if (config.agents[role][k2] !== v) diffs.push(`agents.${role}.${k2}`);
  }
  if (t.rules && repo) {
    const copied = new Set(importedRules(repo.root).map((c) => c.header?.source));
    if (t.rules.some((s) => !copied.has(recordedSource(s, { root: repo.root, home: repo.home, kind: "rules" })))) diffs.push("rules");
  }
  return diffs;
}
var quoted = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
function previewCommand(t, record2, config) {
  const profile = t?.profile ?? config.profile;
  const prod = config.environments.find((e) => e.type === "production")?.org;
  return [
    "acc init --from",
    quoted(record2.source),
    ...t?.profile ? [] : ["--profile", config.profile],
    // A project turning Salesforce has no Production org yet: the command names where it goes.
    ...profile === "salesforce" ? ["--production-org", prod ? quoted(prod) : "<production-org-alias>"] : [],
    "--dry-run"
  ].join(" ");
}

// packages/core/src/init.ts
var sfJson2 = (run2, root, args) => {
  const r = run2("sf", [...args, "--json"], { cwd: root, env: { ...process.env, SF_NO_UPDATE_NOTIFIER: "true", SF_DISABLE_TELEMETRY: "true" } });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { status: r.code || 1, message: (r.stderr || r.stdout).trim().split("\n")[0] };
  }
};
function discoverSalesforce(run2, root, productionOrg, notes) {
  const prod = sfJson2(run2, root, ["org", "display", "-o", productionOrg]);
  if (prod.status !== 0) throw new AccError("init", `"${productionOrg}" isn't logged in: ${prod.message ?? "sf failed"}`);
  const url = parseOrgUrl(String(prod.result?.instanceUrl ?? ""));
  if (url.kind !== "production") throw new AccError("init", `"${productionOrg}" isn't a Production org (${prod.result?.instanceUrl}).`);
  const q2 = sfJson2(run2, root, ["data", "query", "--use-tooling-api", "-q", "SELECT SandboxName, LicenseType FROM SandboxInfo ORDER BY SandboxName", "-o", productionOrg]);
  if (q2.status !== 0) throw new AccError("init", `Couldn't read Production's sandbox list: ${q2.message ?? "sf failed"}`);
  const sandboxes = q2.result?.records ?? [];
  const list = sfJson2(run2, root, ["org", "list"]);
  const orgs = list.status === 0 ? Object.values(list.result ?? {}).filter(Array.isArray).flat() : [];
  const aliasFor = /* @__PURE__ */ new Map();
  for (const o of [...orgs].sort((a2, b) => String(a2.alias).localeCompare(String(b.alias)))) {
    if (!o.alias || !o.instanceUrl) continue;
    const u = parseOrgUrl(o.instanceUrl);
    if (u.kind === "sandbox" && u.domain === url.domain && !aliasFor.has(u.sandbox)) aliasFor.set(u.sandbox, o.alias);
  }
  const envs = [{ name: "Production", type: "production", org: productionOrg, default: false, protected: true, promotesTo: [] }];
  for (const s of sandboxes) {
    const branch = branchFor(s.SandboxName);
    const type = LICENSE_TO_TYPE[s.LicenseType] ?? "partial";
    const org = aliasFor.get(branch) ?? null;
    if (!org) notes.push(`${s.SandboxName} (${type}) has no logged-in alias yet. Run: sf org login web --alias "<alias>" --instance-url https://${url.domain}--${branch}.sandbox.my.salesforce.com`);
    envs.push({ name: s.SandboxName, type, org, default: false, protected: false, promotesTo: [] });
  }
  const first = (t) => envs.find((e) => e.type === t && e.org)?.name ?? envs.find((e) => e.type === t)?.name;
  const partial = first("partial");
  const full = first("full");
  const uniq = (xs) => [...new Set(xs.filter((x2) => !!x2).map(branchFor))];
  for (const e of envs) {
    if (e.type === "developer" || e.type === "developer_pro") e.promotesTo = uniq([partial, full, "Production"]);
    else if (e.type === "partial") e.promotesTo = uniq([full, "Production"]);
    else if (e.type === "full") e.promotesTo = ["production"];
  }
  const candidates = envs.filter((e) => e.org && (e.type === "developer" || e.type === "developer_pro"));
  const fallback = envs.filter((e) => e.org && e.type !== "production");
  const def = candidates[0] ?? fallback[0];
  if (!def) throw new AccError("init", "Log in to at least one sandbox first, so day-to-day work has somewhere to go.");
  def.default = true;
  if (!candidates.length) notes.push(`There's no logged-in Developer sandbox, so "${def.name}" is the default. Agents work best against a source-tracked Developer sandbox.`);
  return envs;
}
function originRepo(run2, root) {
  const r = run2("git", ["remote", "get-url", "origin"], { cwd: root });
  return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(r.stdout.trim())?.[1];
}
function pushingAccount(run2, root) {
  const fill = run2("git", ["credential", "fill"], { cwd: root, input: "protocol=https\nhost=github.com\n\n", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const token = /^password=(.*)$/m.exec(fill.stdout)?.[1];
  if (!token) return void 0;
  const who = run2("gh", ["api", "user", "--jq", ".login"], { env: { ...process.env, GH_TOKEN: token } });
  return who.code === 0 ? who.stdout.trim() : void 0;
}
function templateAccount(run2, root, explicit, pushing = () => root ? pushingAccount(run2, root) : void 0) {
  if (explicit) return explicit;
  if (!root || !originRepo(run2, root)) return null;
  return pushing() ?? null;
}
function planInit(run2, opts) {
  const notes = [];
  const root = opts.root;
  const gitGet = (k2) => run2("git", ["config", "--local", "--get", k2], { cwd: root }).stdout.trim() || void 0;
  const repo = opts.githubRepo ?? originRepo(run2, root);
  const account = opts.githubAccount ?? (repo ? pushingAccount(run2, root) : void 0);
  if (repo && !account) notes.push("Couldn't tell which GitHub account this repo pushes as. Pass --github-account.");
  const readAs = opts.from && !opts.template ? templateAccount(run2, root, opts.githubAccount, () => account) : null;
  const loaded = opts.template ?? (opts.from ? loadTemplate(run2, opts.from, { account: readAs, env: opts.env, base: opts.cwd ?? root, home: opts.home, root }) : null);
  const t = loaded?.template ?? null;
  if (opts.profile && t?.profile && opts.profile !== t.profile) {
    throw new AccError("init", `--profile ${opts.profile} disagrees with the template's profile, ${t.profile}. Leave --profile out, or use another template.`);
  }
  const profile = opts.profile ?? t?.profile ?? "generic";
  let environments;
  if (profile === "salesforce") {
    if (!opts.productionOrg) throw new AccError("init", "A Salesforce project needs --production-org <alias>, so its sandboxes can be found.");
    environments = discoverSalesforce(run2, root, opts.productionOrg, notes);
  } else {
    const head = run2("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: root }).stdout.trim().replace(/^origin\//, "");
    const cur = run2("git", ["branch", "--show-current"], { cwd: root }).stdout.trim();
    environments = [{ name: head || cur || "main", type: "none", org: null, default: true, protected: false, promotesTo: [] }];
  }
  const name = opts.commitName ?? gitGet("user.name");
  const email = opts.commitEmail ?? gitGet("user.email");
  const discovered = ["project", ...repo && account ? ["github"] : [], ...name && email ? ["commitIdentity"] : []];
  if (profile === "salesforce" || !t?.environments) discovered.push("environments");
  let settings = {
    gates: { required: profile === "salesforce" ? ["format", "static", "validate"] : [], commands: {} },
    agents: { max: 3, permissionMode: "acceptEdits" },
    autonomy: "manual"
  };
  let trackers = opts.jiraSite && opts.jiraProject ? [{ kind: "jira", site: opts.jiraSite, project: opts.jiraProject }] : [];
  const fromTemplate = [];
  if (t) {
    if (t.profile) fromTemplate.push("profile");
    if (t.environments) {
      environments = overlayEnvironments(t.environments, environments, profile, notes);
      fromTemplate.push("environments");
    }
    settings = overlaySettings(t, settings);
    if (t.gates) fromTemplate.push("gates");
    if (t.tracker && !opts.tracker) {
      trackers = templateTrackers(t.tracker, { jiraSite: opts.jiraSite, jiraProject: opts.jiraProject }, notes);
      if (trackers.length) fromTemplate.push("trackers");
    }
    if (t.autonomy) fromTemplate.push("autonomy");
    if (t.agents) fromTemplate.push("agents");
  }
  if (opts.tracker) trackers = [pickedTracker(opts.tracker, { template: t?.tracker ?? null, jiraSite: opts.jiraSite, jiraProject: opts.jiraProject }, notes)];
  const listIfPresent = (rel) => existsSync22(join30(root, rel)) ? rel : void 0;
  const raw = {
    schema: 1,
    project: opts.project ?? root.split("/").filter(Boolean).pop() ?? "project",
    profile,
    ...repo && account ? { github: { repo, account } } : {},
    ...name && email ? { commitIdentity: { name, email } } : {},
    environments,
    ...profile === "salesforce" ? {
      environmentSpecific: listIfPresent("manifest/environment-specific.txt"),
      knownDrift: listIfPresent("manifest/known-drift.txt")
    } : {},
    trackers,
    agents: settings.agents,
    autonomy: settings.autonomy,
    worktrees: { root: null, setup: [] },
    gates: settings.gates,
    ...loaded ? { template: loaded.record } : {}
  };
  const parsed = parseConfig(JSON.parse(JSON.stringify(raw)));
  if (!parsed.config) {
    const what = loaded ? `The config from ${loaded.record.name} and what was discovered doesn't validate` : "The discovered config doesn't validate";
    throw new AccError("init", `${what}:
- ${parsed.errors.join("\n- ")}`);
  }
  return { config: parsed.config, notes, fromTemplate, discovered, templateCommands: { ...t?.gates?.commands }, rules: [...t?.rules ?? []], readAs };
}
function configureRepoAccess(run2, root, account, identity) {
  const git10 = (...args) => {
    const r = run2("git", args, { cwd: root });
    if (r.code !== 0) throw new AccError("init", `git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  };
  if (identity) {
    git10("config", "user.name", identity.name);
    git10("config", "user.email", identity.email);
  }
  run2("git", ["config", "--unset-all", "credential.helper"], { cwd: root });
  git10("config", "credential.helper", "");
  git10("config", "--add", "credential.helper", credentialHelper(account));
}

// packages/core/src/intake.ts
function depsFromBody(body) {
  const out3 = /* @__PURE__ */ new Set();
  for (const m of (body ?? "").matchAll(/\b(?:depends on|blocked by)\s+((?:#\d+(?:\s*(?:,|and|&)\s*)?)+)/gi)) {
    for (const n of m[1].matchAll(/#(\d+)/g)) out3.add(`#${n[1]}`);
  }
  return [...out3];
}
function githubIssuesToTasks(issues, environment) {
  return issues.map((i) => ({
    source: { kind: "github", key: `#${i.number}`, url: i.url },
    title: i.title,
    brief: i.body ?? "",
    deps: depsFromBody(i.body).filter((d) => d !== `#${i.number}`),
    labels: (i.labels ?? []).map((l3) => l3.name),
    ...environment ? { environment } : {}
  }));
}
function skipLabelOf(issue, skip3) {
  const names3 = new Set(skip3.map((s) => s.toLowerCase()));
  return (issue.labels ?? []).map((l3) => l3.name).find((n) => names3.has(n.toLowerCase())) ?? null;
}
var noChanges = () => ({ closed: [], removed: [], left: [], leftAlone: [] });
var neverStarted = (t) => t.state === "todo" && !t.run;
var issueNumber = (t) => {
  const n = t.source.kind === "github" ? /^GH-(\d+)$/.exec(t.id)?.[1] : void 0;
  return n ? Number(n) : null;
};
function leave(ledger, t, ticket, why, emit, res) {
  if (neverStarted(t)) {
    ledger.tasks.splice(ledger.tasks.indexOf(t), 1);
    emit({ type: "task.removed", task: t.id, actor: "sync", by: "acc intake", data: { reason: why.reason, title: t.title, source: t.source } });
    res.removed.push(t.id);
    if (why.left) res.left.push(t.id);
  } else res.leftAlone.push({ task: t.id, issue: ticket, state: t.state, note: `${why.note}; ${t.id} is still ${t.state}` });
}
function reconcileGithub(ledger, config, issues, skip3, emit, now2, place2 = null) {
  const res = noChanges();
  const by = "acc intake";
  for (const t of [...ledger.tasks]) {
    const n = issueNumber(t);
    const issue = n === null || t.state === "done" ? void 0 : issues.get(n);
    if (!issue) continue;
    const key = `#${n}`;
    const label = skipLabelOf(issue, skip3);
    if (label) {
      leave(ledger, t, key, { reason: `Issue ${key} has the label "${label}", which isn't imported.`, note: `${key} has the label "${label}"`, left: false }, emit, res);
      continue;
    }
    const outside = place2 ? githubOutside(issue, place2.repo, place2.labels) : null;
    if (outside) {
      leave(ledger, t, key, { reason: `Issue ${key} left this repo's place: ${outside}.`, note: `${key} left this repo's place: ${outside}`, left: true }, emit, res);
      continue;
    }
    if (issue.state?.toUpperCase() !== "CLOSED") continue;
    const req = { to: "done", actor: "sync", by, reason: `Issue ${key} was closed on GitHub.` };
    if (neverStarted(t) && !checkMove(ledger, config, t, req, noGateHooks).length) {
      applyMove(t, req, emit, now2);
      res.closed.push(t.id);
    } else res.leftAlone.push({ task: t.id, issue: key, state: t.state, note: `${key} was closed on GitHub; ${t.id} is still ${t.state}` });
  }
  return res;
}
function intakeGithub(paths, config, deps, opts) {
  const { run: run2, now: now2 } = deps;
  const gh = config.github;
  if (!gh) throw new AccError("no-github", 'This project has no "github" section in .acc/config.json.');
  const tracker = config.trackers.find((t) => t.kind === "github");
  const place2 = { repo: tracker?.repo ?? gh.repo, labels: tracker?.labels ?? [] };
  const skip3 = tracker?.skipLabels ?? [];
  const token = run2("gh", ["auth", "token", "-u", gh.account]);
  if (token.code !== 0) throw new AccError("no-github", `gh isn't logged in as ${gh.account}. Run: gh auth login`);
  const env = { ...deps.env, GH_TOKEN: token.stdout.trim() };
  const lists = (place2.labels.length ? place2.labels : [null]).map((label) => {
    const args = ["issue", "list", "-R", place2.repo, "--state", "open", "--limit", "500"];
    if (opts.label) args.push("--label", opts.label);
    if (label) args.push("--label", label);
    const r = run2("gh", [...args, "--json", "number,title,body,url,labels"], { env });
    if (r.code !== 0) throw new AccError("github", `Couldn't list issues on ${place2.repo}: ${r.stderr.trim().split("\n")[0]}`);
    return JSON.parse(r.stdout);
  });
  const byNumber = /* @__PURE__ */ new Map();
  for (const i of lists.flat()) if (!byNumber.has(i.number)) byNumber.set(i.number, i);
  const open = lists.length === 1 ? lists[0] : [...byNumber.values()].sort((a2, b) => b.number - a2.number);
  const issues = new Map(open.map((i) => [i.number, { ...i, state: "OPEN" }]));
  for (const t of readLedger(paths.ledger).tasks) {
    const n = issueNumber(t);
    if (n === null || t.state === "done" || issues.has(n)) continue;
    const v = run2("gh", ["issue", "view", String(n), "-R", place2.repo, "--json", "number,state,labels,url"], { env, timeoutMs: 6e4 });
    if (v.code !== 0) continue;
    try {
      issues.set(n, JSON.parse(v.stdout));
    } catch {
    }
  }
  const inputs = githubIssuesToTasks(open.filter((i) => !skipLabelOf(i, skip3)));
  return mutate(paths, now2, (ledger, emit) => ({
    ...upsertTasks(ledger, config, inputs, opts.actor, opts.by, emit, now2),
    ...reconcileGithub(ledger, config, issues, skip3, emit, now2, place2)
  }));
}
function intakeOutside(paths, kind, outside, now2) {
  return mutate(paths, now2, (ledger, emit) => {
    const res = { added: [], updated: [], unchanged: [], errors: [], ...noChanges() };
    for (const o of outside) {
      const id = normalizeId(o.key, kind);
      const t = ledger.tasks.find((x2) => x2.id === id && x2.source.kind === kind);
      if (!t || t.state === "done") continue;
      leave(ledger, t, id, { reason: `${id} left this repo's place: ${o.why}.`, note: `${id} left this repo's place: ${o.why}`, left: true }, emit, res);
    }
    return res;
  });
}

// packages/core/src/repos.ts
import { randomBytes as randomBytes2 } from "node:crypto";
import { existsSync as existsSync23, mkdirSync as mkdirSync29, readFileSync as readFileSync30, realpathSync as realpathSync5, renameSync as renameSync14, rmSync as rmSync18, statSync as statSync8, writeFileSync as writeFileSync29 } from "node:fs";
import { homedir as homedir7 } from "node:os";
import { dirname as dirname11, join as join31, resolve as resolve4 } from "node:path";
var reposFile = (env = process.env) => env.ACC_REPOS_FILE || join31(homedir7(), ".acc", "repos.json");
var configOf = (root) => join31(root, ".acc", "config.json");
function listedRepos(env = process.env) {
  try {
    const j2 = JSON.parse(readFileSync30(reposFile(env), "utf8"));
    return Array.isArray(j2.repos) ? [...new Set(j2.repos.filter((r) => typeof r === "string" && r.startsWith("/")))] : [];
  } catch {
    return [];
  }
}
function rememberRepo(root, env = process.env) {
  const was = listedRepos(env);
  const kept = was.filter((r) => r === root || existsSync23(configOf(r)));
  const next = kept.includes(root) ? kept : [...kept, root];
  if (was.length === next.length && was.every((r, i) => r === next[i])) return false;
  const file = reposFile(env);
  const tmp = `${file}.${process.pid}.${randomBytes2(4).toString("hex")}.tmp`;
  try {
    mkdirSync29(dirname11(file), { recursive: true, mode: 448 });
    writeFileSync29(tmp, `${JSON.stringify({ schema: 1, repos: next }, null, 2)}
`, { mode: 384 });
    renameSync14(tmp, file);
    return true;
  } catch {
    try {
      rmSync18(tmp, { force: true });
    } catch {
    }
    return false;
  }
}

// packages/core/src/rule-suggestions.ts
import { createHash as createHash4 } from "node:crypto";
import { mkdirSync as mkdirSync30, readdirSync as readdirSync10, readFileSync as readFileSync31 } from "node:fs";
import { join as join32 } from "node:path";
var OFFER_FINDINGS = 3;
var OFFER_TASKS = 2;
var RETURN_FINDINGS = 3;
var RULE_JOIN = 0.6;
var WORDING_JOIN = 0.5;
var RULE_LINE_MAX = 300;
var RULE_TITLE_MAX = 200;
var RULE_NOTE_MAX = 4e3;
var SUGGESTION_ID = /^[rw]-[0-9a-f]{6}$/;
var WRITTEN_RULE_FILES = [OWN_RULES, "CLAUDE.md", "AGENTS.md"];
function readFindings(paths) {
  return readVerdicts(paths).flatMap((v) => v.findings.flatMap((f, i) => typeof f?.message !== "string" ? [] : [{
    id: `${v.task}@${v.sha.slice(0, 7)}#${i + 1}`,
    task: v.task,
    sha: v.sha,
    at: v.at,
    sessionId: typeof v.sessionId === "string" ? v.sessionId : "",
    name: v.name ?? null,
    message: f.message,
    must: f.must === true,
    file: typeof f.file === "string" && f.file ? f.file : null,
    line: Number.isInteger(f.line) ? f.line : null,
    rule: typeof f.rule === "string" && f.rule.trim() ? f.rule.trim() : null,
    kind: typeof f.kind === "string" && f.kind.trim() ? f.kind.trim() : null
  }]));
}
var STOP = new Set("a an the to of in on at for and or but nor is are was were be been it its this that these those with as by from into onto not no do does did any each every all when where which what who whom than then so if only one there their they them we you your our has have had can could should would will may might must also just more most less still yet very about over under before after".split(" "));
var stem = (w) => w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
function words3(text) {
  const out3 = text.toLowerCase().replace(/[’'`"]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
  return [...new Set(out3)];
}
function overlap(a2, b) {
  if (!a2.length || !b.length) return 0;
  const s = new Set(a2);
  const both = b.filter((w) => s.has(w)).length;
  return both / (a2.length + b.length - both);
}
var SOURCE_TAG = /(~\/\.claude\/CLAUDE\.md|\.acc\/rules\.md|\bCLAUDE\.md|\bAGENTS\.md)/i;
var LEAD_TAG = /^\s*(?:~\/\.claude\/CLAUDE\.md|\.acc\/rules\.md|CLAUDE\.md|AGENTS\.md|task(?: acceptance criterion| criterion)?|decided by a person(?: \(Q\d+\))?|rule)\s*:\s*/i;
var DECISION = /^\s*(D-\d{3,})\b/;
function ruleHead(rule) {
  const source = SOURCE_TAG.exec(rule)?.[1] ?? null;
  const decision = DECISION.exec(rule)?.[1] ?? null;
  let t = rule;
  for (let i = 0; i < 3 && LEAD_TAG.test(t); i++) t = t.replace(LEAD_TAG, "");
  t = t.replace(/\([^()]*\)/g, " ").split(/[:;]\s|[:;]$|\.\s|\s[–—]\s/)[0].replace(/\s+/g, " ").trim().replace(/[.,;:\s]+$/, "");
  const text = t ? t[0].toUpperCase() + t.slice(1) : "";
  return { decision, text, source: source ? source.startsWith("~") ? "~/.claude/CLAUDE.md" : source.toLowerCase() === "claude.md" ? "CLAUDE.md" : source.toLowerCase() === "agents.md" ? "AGENTS.md" : OWN_RULES : null };
}
function firstSentence(text) {
  return text.trim().split(/(?<=[.!?])\s+(?=[A-Z`'"(\d])/)[0].trim();
}
var NAMES_A_THING = /[/\\]|\.[a-z]{1,5}\b|[a-z][A-Z]|_|\d|^[A-Z]{2,}-\d|^--?[a-z]/;
function wordingText(f) {
  if (f.kind) return f.kind;
  return firstSentence(f.message).replace(/`[^`]*`/g, " ").split(/\s+/).filter((w) => w && !NAMES_A_THING.test(w.replace(/^[('"]+|[)'",.:;!?]+$/g, ""))).join(" ");
}
function findingKey(f) {
  if (f.rule) {
    const h2 = ruleHead(f.rule);
    const w2 = words3(h2.text);
    if (h2.decision) return { by: "rule", decision: h2.decision, text: h2.decision, words: [h2.decision.toLowerCase()] };
    if (w2.length) return { by: "rule", decision: null, text: h2.text, words: w2 };
  }
  const text = wordingText(f);
  const w = words3(text);
  return w.length ? { by: "wording", decision: null, text, words: w } : null;
}
var placeOf = (f) => `${f.task}|${f.file ?? ""}`;
var hex = (s) => createHash4("sha256").update(s).digest("hex").slice(0, 6);
function groupFindings(findings) {
  const groups = [];
  const sorted = [...findings].sort((a2, b) => a2.at.localeCompare(b.at) || a2.id.localeCompare(b.id, void 0, { numeric: true }));
  for (const f of sorted) {
    const k2 = findingKey(f);
    if (!k2) continue;
    let best = null;
    let score = 0;
    for (const g of groups) {
      if (g.by !== k2.by || !!g.key.decision !== !!k2.decision) continue;
      const s = k2.decision ? g.key.decision === k2.decision ? 1 : 0 : overlap(g.key.words, k2.words);
      if (s > score && s >= (k2.by === "rule" ? RULE_JOIN : WORDING_JOIN)) {
        best = g;
        score = s;
      }
    }
    if (!best) {
      best = { id: `${k2.by === "rule" ? "r" : "w"}-${hex(`${k2.by}:${k2.decision ?? k2.words.join(" ")}`)}`, by: k2.by, key: k2, findings: [], counted: [], places: [], tasks: [], must: 0 };
      groups.push(best);
    }
    best.findings.push(f);
  }
  for (const g of groups) {
    const must2 = /* @__PURE__ */ new Set();
    for (const f of g.findings) {
      const p = placeOf(f);
      if (f.must) must2.add(p);
      if (g.places.includes(p)) continue;
      g.places.push(p);
      g.counted.push(f);
      if (!g.tasks.includes(f.task)) g.tasks.push(f.task);
    }
    g.must = must2.size;
  }
  return groups;
}
function rulesIn(text, file) {
  const items = [];
  let cur = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const starts = /^([-*+]|\d+\.)\s+/.test(line) || /^#/.test(line);
    if (!line || starts) {
      if (cur) items.push(cur);
      cur = line.startsWith("#") ? "" : line.replace(/^([-*+]|\d+\.)\s+/, "");
      continue;
    }
    cur = cur ? `${cur} ${line}` : line;
  }
  if (cur) items.push(cur);
  return items.flatMap((item) => item.replace(/\*\*/g, "").split(/(?<=\.)\s+(?=[A-Z])/).map((s) => {
    const h2 = ruleHead(s).text;
    return { file, text: h2, words: words3(h2) };
  })).filter((r) => r.words.length);
}
function writtenRules(root) {
  const read2 = (f) => {
    try {
      return readFileSync31(join32(root, f), "utf8");
    } catch {
      return "";
    }
  };
  return [
    ...WRITTEN_RULE_FILES.flatMap((f) => rulesIn(read2(f), f)),
    ...importedRules(root).flatMap((c) => rulesIn(withoutHeader(c.body), c.file))
  ];
}
function whereWritten(g, written) {
  if (g.key.decision) return g.key.decision;
  if (g.key.by !== "rule") return null;
  const w = g.key.words;
  const hit = written.find((r) => overlap(w, r.words) >= RULE_JOIN || w.length >= 3 && w.every((x2) => r.words.includes(x2)));
  if (hit) return hit.file;
  for (const f of g.findings) {
    const s = f.rule ? ruleHead(f.rule).source : null;
    if (s) return s;
  }
  return null;
}
function readSuggestionRecords(paths) {
  let names3;
  try {
    names3 = readdirSync10(paths.suggestions).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out3 = [];
  for (const n of names3) {
    try {
      const r = JSON.parse(readFileSync31(join32(paths.suggestions, n), "utf8"));
      if (r?.v === 1 && Array.isArray(r.findings) && Array.isArray(r.places) && (r.outcome === "accepted" || r.outcome === "dismissed")) out3.push(r);
    } catch {
    }
  }
  return out3.sort((a2, b) => a2.at.localeCompare(b.at));
}
var CHECK_ASKS = ["lint", "test", "gate", "any", "none"];
function checkHint(text) {
  const t = text.toLowerCase();
  if (/\b(lint|eslint|literals?|hard-?cod\w*|imports?|naming|format\w*|colou?rs?)\b/.test(t)) return "lint";
  if (/\b(tests?|tested|testing|asserts?|fixtures?|cover\w*|cases?)\b/.test(t)) return "test";
  if (/\b(gates?|checks?|checked|screenshots?|builds?|ci|ratchets?|floors?|ship\w*|merg\w*|land\w*)\b/.test(t)) return "gate";
  return null;
}
function suggestRules(paths, opts = {}) {
  const groups = groupFindings(readFindings(paths)).filter((g) => g.counted.length >= OFFER_FINDINGS && g.tasks.length >= OFFER_TASKS);
  if (!groups.length) return [];
  const records = readSuggestionRecords(paths);
  const written = writtenRules(paths.root);
  const out3 = [];
  for (const g of groups) {
    const ids = new Set(g.findings.map((f) => f.id));
    const mine = records.filter((r) => r.findings.some((f) => ids.has(f)));
    const seen = new Set(mine.flatMap((r) => r.places));
    const more = g.places.filter((p) => !seen.has(p)).length;
    const last = mine.at(-1) ?? null;
    const where = whereWritten(g, written);
    const accepted = mine.some((r) => r.outcome === "accepted");
    const kind = where || accepted ? "check" : "rule";
    const lead = g.findings[0];
    const said2 = g.key.decision ? g.findings.map((f) => f.rule ? ruleHead(f.rule.replace(DECISION, "").replace(/^\s*[:;,-]\s*/, "")).text : "").find(Boolean) : null;
    const head = g.key.decision ? said2 || g.key.decision : g.key.by === "rule" ? g.key.text : lead.kind ?? firstSentence(lead.message);
    const line = sentence(g.key.decision && head !== g.key.decision ? `${head} (${g.key.decision})` : head);
    const counted = new Set(g.counted.map((f) => f.id));
    const s = {
      id: g.id,
      kind,
      by: g.by,
      head,
      line,
      written: where,
      again: last ? { outcome: last.outcome, at: last.at, by: last.by, task: last.task ?? null } : null,
      findings: g.counted.length,
      tasks: g.tasks.length,
      must: g.must,
      hint: checkHint(head),
      sources: g.findings.map((f) => ({
        finding: f.id,
        task: f.task,
        sha: f.sha,
        at: f.at,
        sessionId: f.sessionId,
        name: f.name,
        message: firstSentence(f.message),
        must: f.must,
        file: f.file,
        line: f.line,
        counted: counted.has(f.id)
      }))
    };
    if (!last || more >= RETURN_FINDINGS) out3.push(s);
    else if (opts.all) out3.push({ ...s, again: null, hidden: { outcome: last.outcome, at: last.at, by: last.by, more: RETURN_FINDINGS - more } });
  }
  return out3.sort((a2, b) => b.findings - a2.findings || b.tasks - a2.tasks || a2.id.localeCompare(b.id));
}
var defaultCheck = (s) => s.hint ?? (s.kind === "check" ? "any" : "none");
var CHECK_WORDS = { lint: "lint", test: "test", gate: "gate", any: "lint, test or gate" };
var draftTitle = (s, line) => clip(s.kind === "check" ? `Add a check for the rule: ${line.replace(/\.$/, "")}` : `Add the rule: ${line.replace(/\.$/, "")}`, 120);
var sourceLine = (x2) => `${x2.task}, review of ${x2.sha.slice(0, 7)} on ${x2.at.slice(0, 10)}${x2.file ? `, ${x2.file}${x2.line ? `:${x2.line}` : ""}` : ""}${x2.must ? " (must fix)" : ""}: ${x2.message}${x2.sessionId ? ` Reviewer session ${x2.sessionId}.` : ""}`;
function draftRuleTask(s, e = {}) {
  const line = sentence((e.line ?? s.line).replace(/\s+/g, " "));
  const check2 = e.check ?? defaultCheck(s);
  if (!line) throw new AccError("usage", "The rule's line is empty.");
  if (line.length > RULE_LINE_MAX) throw new AccError("usage", `The rule's line is ${line.length} characters, more than ${RULE_LINE_MAX}.`);
  if (!CHECK_ASKS.includes(check2)) throw new AccError("usage", `--check is lint, test, gate, any or none, not "${check2}".`);
  if (s.kind === "check" && check2 === "none") throw new AccError("usage", `${s.id} is already a rule (${s.written ?? "accepted before"}), so its task is the check: lint, test, gate or any.`);
  const title = (e.title ?? draftTitle(s, line)).replace(/\s+/g, " ").trim();
  if (!title) throw new AccError("usage", "The task needs a title.");
  if (title.length > RULE_TITLE_MAX) throw new AccError("usage", `The title is ${title.length} characters, more than ${RULE_TITLE_MAX}.`);
  const note = (e.note ?? "").trim();
  if (note.length > RULE_NOTE_MAX) throw new AccError("usage", `The note is ${note.length} characters, more than ${RULE_NOTE_MAX}.`);
  const counts = `${s.findings} findings across ${s.tasks} tasks${s.must ? `, ${s.must} of them must-fix` : ""}`;
  const already = s.written ? `It's already a rule (${s.written})` : "It was accepted as a rule before";
  const brief = [
    `A review finding keeps coming back: ${counts}. acc suggested this from the clone's reviews, and a person accepted it.`,
    "",
    "## The rule",
    "",
    s.kind === "check" ? `${already}, and the reviews keep finding it broken, so it needs a check:` : "Add this line to `.acc/rules.md`, which every builder, reviewer and analyst reads:",
    "",
    `> ${line}`,
    "",
    "## Acceptance criteria",
    "",
    ...s.kind === "rule" ? ["- [ ] `.acc/rules.md` has the line above, worded as the team wants it."] : [],
    ...check2 !== "none" ? [
      `- [ ] A ${CHECK_WORDS[check2]} checks the rule and fails when it's broken, and it proves it ran: it counts what it checked and fails on none.`,
      `- [ ] ${s.kind === "rule" || !s.written || /^D-\d/.test(s.written) ? "`.acc/rules.md`" : `\`${s.written}\``} names that check beside the rule.`
    ] : [],
    ...note ? ["", "## Notes", "", note] : [],
    "",
    "## Where it came from",
    "",
    "Each review keeps its reviewer's session, which the Command Center opens.",
    "",
    ...s.sources.map((x2) => `- ${sourceLine(x2)}${x2.counted ? "" : " Said again in a later review of the same task and file, so not counted again."}`)
  ].join("\n");
  return { source: { kind: "manual", key: null }, title, brief };
}
var lockOf = (paths) => `${paths.suggestions}.lock`;
function offered(paths, id) {
  const s = suggestRules(paths).find((x2) => x2.id === id);
  if (!s) throw new AccError("no-suggestion", `No rule is suggested as ${id} now. acc rules suggested lists them.`);
  return s;
}
function record(paths, s, outcome, by, now2, task) {
  const r = {
    v: 1,
    id: s.id,
    outcome,
    at: now2().toISOString(),
    by,
    kind: s.kind,
    head: s.head,
    findings: s.sources.map((x2) => x2.finding),
    places: [...new Set(s.sources.map(placeOf))],
    ...task ? { task } : {}
  };
  mkdirSync30(paths.suggestions, { recursive: true });
  const n = readdirSync10(paths.suggestions).filter((x2) => x2.startsWith(`${s.id}.`) && x2.endsWith(".json")).length + 1;
  const file = join32(paths.suggestions, `${s.id}.${n}.json`);
  writeAtomic(file, JSON.stringify(r, null, 2) + "\n");
  return r;
}
function dismissSuggestion(paths, id, by, now2) {
  return withLock(lockOf(paths), () => record(paths, offered(paths, id), "dismissed", by, now2));
}
function acceptSuggestion(paths, config, id, edits, actor, by, now2) {
  if (actor !== "human") throw new AccError("refused", "Only a person can accept a suggested rule.");
  return withLock(lockOf(paths), () => {
    const s = offered(paths, id);
    const input = draftRuleTask(s, edits);
    const res = mutate(paths, now2, (l3, emit) => upsertTasks(l3, config, [input], actor, by, emit, now2));
    if (res.errors.length || res.added.length !== 1) throw new AccError("refused", `The task wasn't added: ${res.errors.join(" ") || "acc added none."}`);
    const task = res.added[0];
    return { record: record(paths, s, "accepted", by, now2, task), task, input };
  });
}

// packages/core/src/setup.ts
import { copyFileSync as copyFileSync2, existsSync as existsSync24, mkdirSync as mkdirSync31, mkdtempSync as mkdtempSync6, readFileSync as readFileSync32, rmSync as rmSync19, writeFileSync as writeFileSync30 } from "node:fs";
import { tmpdir as tmpdir6 } from "node:os";
import { dirname as dirname12, join as join33 } from "node:path";
function fetchStep(run2, root, steps2) {
  steps2.step("fetch", "Fetch the branches", () => {
    if (git8(run2, root, "remote", "get-url", "origin").code === 0) git8(run2, root, "fetch", "--quiet", "origin");
  });
}
var git8 = (run2, cwd, ...args) => run2("git", args, { cwd });
function refFor(run2, root, branch) {
  for (const ref of [`origin/${branch}`, branch]) if (git8(run2, root, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`).code === 0) return ref;
  return null;
}
function inWorktree(run2, root, addArgs, fn2) {
  const tmp = mkdtempSync6(join33(tmpdir6(), "acc-setup-"));
  const dir = join33(tmp, "wt");
  const add2 = git8(run2, root, "worktree", "add", "--quiet", ...addArgs.slice(0, -1), dir, addArgs.at(-1));
  if (add2.code !== 0) {
    rmSync19(tmp, { recursive: true, force: true });
    throw new AccError("git", `Couldn't make a worktree: ${lastLine(add2.stderr)}`);
  }
  try {
    return fn2(dir);
  } finally {
    git8(run2, root, "worktree", "remove", "--force", dir);
    git8(run2, root, "worktree", "prune");
    rmSync19(tmp, { recursive: true, force: true });
  }
}
function parseManifest(xml) {
  const types = /* @__PURE__ */ new Map();
  for (const block of xml.match(/<types>[\s\S]*?<\/types>/g) ?? []) {
    const name = /<name>\s*([^<]+?)\s*<\/name>/.exec(block)?.[1];
    if (!name) continue;
    const set = types.get(name) ?? /* @__PURE__ */ new Set();
    for (const m of block.matchAll(/<members>\s*([^<]+?)\s*<\/members>/g)) set.add(m[1]);
    types.set(name, set);
  }
  return { types, version: /<version>\s*([^<]+?)\s*<\/version>/.exec(xml)?.[1] ?? null };
}
var esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function unionManifests(xmls) {
  const all = /* @__PURE__ */ new Map();
  let version = null;
  for (const xml of xmls) {
    const m = parseManifest(xml);
    for (const [t, ms] of m.types) all.set(t, /* @__PURE__ */ new Set([...all.get(t) ?? [], ...ms]));
    if (m.version && (!version || Number(m.version) > Number(version))) version = m.version;
  }
  const types = [...all.keys()].sort().map((t) => [
    "    <types>",
    ...[...all.get(t)].sort().map((m) => `        <members>${esc(m)}</members>`),
    `        <name>${esc(t)}</name>`,
    "    </types>"
  ].join("\n"));
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<Package xmlns="http://soap.sforce.com/2006/04/metadata">', ...types, `    <version>${version ?? "62.0"}</version>`, "</Package>", ""].join("\n");
}
function buildBaseline(paths, config, deps) {
  if (config.profile !== "salesforce") throw new AccError("refused", "A baseline manifest is for Salesforce projects.");
  const { run: run2 } = deps;
  const steps2 = deps.steps ?? NO_STEPS;
  fetchStep(run2, paths.root, steps2);
  const out3 = mkdtempSync6(join33(tmpdir6(), "acc-manifests-"));
  const xmls = [];
  const from = [];
  const generate = (dir, name) => {
    const dirs = packageDirs(dir).filter((d) => existsSync24(join33(dir, d)));
    const label = `List the components on ${name}`;
    if (!dirs.length) return steps2.skip(`list-${name}`, label, "It has no Salesforce source");
    deps.onStep?.(`Listing the components on ${name}`);
    steps2.step(`list-${name}`, label, () => {
      const r = run2(...niced("sf", ["project", "generate", "manifest", ...dirs.flatMap((d) => ["--source-dir", d]), "--output-dir", out3, "--name", name, "--json"]), { cwd: dir, env: sfEnv(), timeoutMs: 10 * 6e4 });
      const file2 = join33(out3, `${name}.xml`);
      if (r.code !== 0 || !existsSync24(file2)) throw new AccError("sf", `sf couldn't list the components on ${name}: ${lastLine(r.stderr || r.stdout)}`);
      xmls.push(readFileSync32(file2, "utf8"));
      from.push(name);
    });
  };
  try {
    const branches = config.environments.map((e) => ({ e, ref: refFor(run2, paths.root, e.branch) })).filter((x2) => x2.ref);
    for (const { e, ref } of branches) inWorktree(run2, paths.root, ["--detach", ref], (dir) => generate(dir, e.branch));
    if (!from.length) generate(paths.root, "this-checkout");
  } finally {
    rmSync19(out3, { recursive: true, force: true });
  }
  if (!xmls.length) throw new AccError("refused", "There's no Salesforce source on any environment branch, or in this checkout, to list.");
  const xml = unionManifests(xmls);
  const file = join33(paths.root, BASELINE_MANIFEST);
  steps2.step("write", "Write the baseline", () => {
    mkdirSync31(dirname12(file), { recursive: true });
    writeFileSync30(file, xml);
  });
  const parsed = parseManifest(xml);
  return { file, from, types: parsed.types.size, members: [...parsed.types.values()].reduce((n, s) => n + s.size, 0) };
}
function retrieveInto(run2, dir, org, deps) {
  const r = withSlot(() => run2(...niced("sf", ["project", "retrieve", "start", "--manifest", BASELINE_MANIFEST, "--target-org", org, "--ignore-conflicts", "--wait", "60", "--json"]), { cwd: dir, env: sfEnv(), timeoutMs: 70 * 6e4 }), { owner: { what: `Retrieve the baseline from ${org}`, cwd: dir }, ...deps.slots });
  try {
    const j2 = parseJsonOutput(r.stdout);
    if (r.code === 0 && j2.status === 0) return null;
    return (j2.message ?? "").trim() || lastLine(r.stderr || r.stdout) || `exit ${r.code}`;
  } catch {
    return lastLine(r.stderr || r.stdout) || `exit ${r.code}`;
  }
}
function seedBranches(paths, config, deps, opts = {}) {
  const { run: run2, now: now2 } = deps;
  const sf = config.profile === "salesforce";
  const manifest = join33(paths.root, BASELINE_MANIFEST);
  if (sf && !existsSync24(manifest)) throw new AccError("refused", `There's no ${BASELINE_MANIFEST} yet. Make it first: acc setup baseline (B5).`);
  const steps2 = deps.steps ?? NO_STEPS;
  fetchStep(run2, paths.root, steps2);
  const prod = config.environments.find((e) => e.type === "production") ?? config.environments.find((e) => e.protected) ?? null;
  const date = now2().toISOString().slice(0, 10);
  const out3 = [];
  const commitAll = (dir, message2) => {
    git8(run2, dir, "add", "-A");
    const c = git8(run2, dir, "commit", "--quiet", "--allow-empty", "-m", message2);
    if (c.code !== 0) throw new AccError("git", `Couldn't commit: ${lastLine(c.stderr)}`);
  };
  const seed = (e, start, clear) => {
    deps.onStep?.(`Making ${e.branch}${sf && e.org ? ` from ${e.org}` : ""}`);
    steps2.start(`make-${e.branch}`, `Make ${e.branch}${sf && e.org ? ` from ${e.org}` : ""}`);
    let made = false;
    try {
      inWorktree(run2, paths.root, ["-b", e.branch, start], (dir) => {
        if (sf) {
          copyFileSync2(manifest, join33(dir, BASELINE_MANIFEST));
          if (clear) {
            for (const d of packageDirs(dir)) if (existsSync24(join33(dir, d))) {
              git8(run2, dir, "rm", "-r", "-q", "--", d);
              mkdirSync31(join33(dir, d, "main", "default"), { recursive: true });
            }
          }
          if (e.org) {
            const failed = retrieveInto(run2, dir, e.org, deps);
            if (failed) throw new AccError("sf", `the retrieve from ${e.org} failed: ${failed}`);
          }
        }
        commitAll(dir, sf && e.org ? `Baseline: ${e.name} org metadata, retrieved ${date}` : `Branch for ${e.name}`);
      });
      made = true;
      const differs = prod && prod.branch !== e.branch && refFor(run2, paths.root, prod.branch) ? git8(run2, paths.root, "diff", "--no-renames", "--name-only", refFor(run2, paths.root, prod.branch), e.branch).stdout.split("\n").filter(Boolean).length : null;
      const pushed = opts.push ? git8(run2, paths.root, "push", "--quiet", "--set-upstream", "origin", `${e.branch}:${e.branch}`) : null;
      const note = !pushed ? "made locally; push it when you're happy with it" : pushed.code === 0 ? "made and pushed" : `made locally, but git push refused it: ${lastLine(pushed.stderr)}`;
      out3.push({ env: e.name, branch: e.branch, status: "made", note, differs });
      steps2.done(`make-${e.branch}`, note);
    } catch (err) {
      if (!made && git8(run2, paths.root, "rev-parse", "--verify", "--quiet", `refs/heads/${e.branch}`).code === 0) git8(run2, paths.root, "branch", "-D", e.branch);
      out3.push({ env: e.name, branch: e.branch, status: made ? "made" : "failed", note: err.message, differs: null });
      if (made) steps2.done(`make-${e.branch}`, err.message);
      else steps2.fail(`make-${e.branch}`, err.message);
    }
  };
  if (prod && !refFor(run2, paths.root, prod.branch)) seed(prod, "HEAD", false);
  const prodRef = prod ? refFor(run2, paths.root, prod.branch) : null;
  for (const e of config.environments) {
    if (e === prod || refFor(run2, paths.root, e.branch)) continue;
    seed(e, prodRef ?? "HEAD", sf && !!prodRef);
  }
  return out3;
}
var ENV_SPECIFIC = [
  /\/emailservices\//,
  /\/namedCredentials\//,
  /\/externalCredentials\//,
  /\/remoteSiteSettings\//,
  /\/authproviders\//,
  /\/samlssoconfigs\//,
  /\/connectedApps\//,
  /\/cspTrustedSites\//,
  /\/corsWhitelistOrigins\//,
  /\/sites\//,
  /\/networks\//,
  /\/certs\//,
  /\/settings\/(Case|EmailAdministration|EmailIntegration|Security|SingleSignOn|MyDomain|Domain)\.settings-meta\.xml$/
];
var KNOWN_DRIFT = [/\/contentassets\//];
function readBlobs(run2, root, specs) {
  const out3 = /* @__PURE__ */ new Map();
  if (!specs.length) return out3;
  const r = run2("git", ["cat-file", "--batch"], { cwd: root, input: specs.join("\n") + "\n" });
  const buf = Buffer.from(r.stdout, "utf8");
  let at2 = 0;
  for (const spec of specs) {
    const nl = buf.indexOf(10, at2);
    if (nl < 0) break;
    const head = buf.subarray(at2, nl).toString("utf8");
    at2 = nl + 1;
    const m = /^\S+ \S+ (\d+)$/.exec(head);
    if (!m) {
      out3.set(spec, null);
      continue;
    }
    const size = Number(m[1]);
    out3.set(spec, buf.subarray(at2, at2 + size).toString("utf8"));
    at2 += size + 1;
  }
  return out3;
}
var reorderedOnly = (a2, b) => {
  if (a2 === null || b === null || a2 === b) return false;
  const lines = (s) => s.split("\n").map((l3) => l3.trimEnd()).filter(Boolean).sort().join("\n");
  return lines(a2) === lines(b);
};
function draftLists(paths, config, deps) {
  const { run: run2 } = deps;
  if (config.profile !== "salesforce") throw new AccError("refused", "The environment-specific and known-drift lists are for Salesforce projects.");
  if (!config.environmentSpecific || !config.knownDrift) throw new AccError("refused", 'Name both lists in .acc/config.json first: "environmentSpecific": "manifest/environment-specific.txt" and "knownDrift": "manifest/known-drift.txt".');
  const steps2 = deps.steps ?? NO_STEPS;
  fetchStep(run2, paths.root, steps2);
  const prod = config.environments.find((e) => e.type === "production");
  const prodRef = prod ? refFor(run2, paths.root, prod.branch) : null;
  if (!prod || !prodRef) throw new AccError("refused", "There's no production branch to compare the others with yet. Make the branches first (B6).");
  const specific = /* @__PURE__ */ new Set();
  const drift2 = /* @__PURE__ */ new Set();
  const unexplained2 = [];
  for (const e of config.environments) {
    if (e === prod) continue;
    const ref = refFor(run2, paths.root, e.branch);
    if (!ref) continue;
    steps2.start(`compare-${e.branch}`, `Compare ${e.branch} with ${prod.branch}`);
    const files = under(git8(run2, paths.root, "diff", "--no-renames", "--name-only", prodRef, ref).stdout.split("\n").filter(Boolean), packageDirs(paths.root));
    const rest = [];
    const maybe = [];
    for (const f of files) {
      if (ENV_SPECIFIC.some((p) => p.test(f))) specific.add(f);
      else if (KNOWN_DRIFT.some((p) => p.test(f))) drift2.add(f);
      else maybe.push(f);
    }
    const blobs = readBlobs(run2, paths.root, maybe.flatMap((f) => [`${prodRef}:${f}`, `${ref}:${f}`]));
    for (const f of maybe) {
      if (reorderedOnly(blobs.get(`${prodRef}:${f}`) ?? null, blobs.get(`${ref}:${f}`) ?? null)) drift2.add(f);
      else rest.push(f);
    }
    if (rest.length) unexplained2.push({ branch: e.branch, files: rest });
    steps2.done(`compare-${e.branch}`, files.length ? `${files.length} difference(s), ${rest.length} that neither list explains` : "No differences");
  }
  const draft = (rel, found) => {
    const file = join33(paths.root, rel);
    const have = readList(paths.root, rel);
    const entries = [...found].filter((f) => !listed(f, have)).sort();
    if (existsSync24(file)) return { file, written: false, entries };
    mkdirSync31(dirname12(file), { recursive: true });
    writeFileSync30(file, entries.length ? `${entries.join("\n")}
` : "");
    return { file, written: true, entries };
  };
  const lists = steps2.step("write", "Write the lists", () => ({ environmentSpecific: draft(config.environmentSpecific, specific), knownDrift: draft(config.knownDrift, drift2) }));
  return { ...lists, unexplained: unexplained2 };
}
var README_START = "<!-- acc:environments -->";
var README_END = "<!-- /acc:environments -->";
var linkText = (s) => s.replace(/([[\]\\])/g, "\\$1");
var code = (s) => `\`${s.replace(/`/g, "")}\``;
function readmePlaces(config) {
  const out3 = [];
  for (const t of config.trackers) {
    if (t.kind === "jira" && t.epic && t.site) {
      const url = `https://${t.site}/browse/${encodeURIComponent(t.epic)}`;
      out3.push({ line: `Jira epic [${linkText(t.epic)}](${url})`, words: `the Jira epic ${t.epic}`, needs: [url] });
    } else if (t.kind === "azure" && t.areaPath && t.organization && t.project) {
      const url = `https://dev.azure.com/${encodeURIComponent(t.organization)}/${encodeURIComponent(t.project)}`;
      out3.push({ line: `Azure DevOps area path ${code(t.areaPath)} in [${linkText(t.project)}](${url})`, words: `the Azure DevOps area path ${t.areaPath}`, needs: [t.areaPath, url] });
    } else if (t.kind === "github" && t.labels.length) {
      const repo = t.repo ?? config.github?.repo ?? null;
      const s = t.labels.length > 1 ? "s" : "";
      const urls = repo ? t.labels.map((l3) => `https://github.com/${repo}/issues?q=${encodeURIComponent(`is:issue label:"${l3}"`)}`) : [];
      const links = repo ? t.labels.map((l3, i) => `[${linkText(l3)}](${urls[i]})`) : t.labels.map(code);
      out3.push({ line: `GitHub label${s} ${orList(links)}${repo ? "" : " in this repo"}`, words: `the GitHub label${s} ${orList(t.labels)}`, needs: repo ? urls : t.labels });
    } else if (t.kind === "monday" && t.group && t.account && t.board !== null) {
      const url = `https://${t.account}.monday.com/boards/${t.board}`;
      out3.push({ line: `monday.com group ${code(t.group)} on [board ${t.board}](${url})`, words: `the monday.com group ${t.group}`, needs: [t.group, url] });
    }
  }
  return out3;
}
function environmentsSection(config) {
  const envs = config.environments;
  const name = (b) => `\`${b}\``;
  const role = (e) => [
    e.protected ? "protected: changes arrive only by promotion" : "",
    e.default ? "day-to-day work" : "",
    e.promotesTo.length ? `promotes to ${e.promotesTo.map(name).join(" or ")}` : ""
  ].filter(Boolean).join("; ") || "\u2013";
  const rows = envs.map((e) => `| ${e.name} | ${name(e.branch)} | ${e.org ?? "\u2013"} | ${e.type === "none" ? "branch" : e.type.replace("_", " ")} | ${role(e)} |`);
  const paths = promotionPaths(envs);
  const places = readmePlaces(config);
  return [
    README_START,
    "## Environments",
    "",
    "Each environment has its own branch, named after it.",
    "",
    "| Environment | Branch | Org | Type | Role |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    ...paths.length ? ["**How changes move:** " + paths.map((p) => p.map(name).join(" \u2192 ")).join(", or ") + ". Each step is a pull request (`acc promote`), and a deploy after it merges (`acc deploy`).", ""] : [],
    ...places.length ? [`**Its tickets come from** ${places.map((p) => p.line).join(", and ")}.`, ""] : [],
    ...config.environmentSpecific ? [`**Environment-specific files,** listed in \`${config.environmentSpecific}\`, differ in every org by design. They're never promoted, deployed, or changed as part of a task.`, ""] : [],
    `_This section is kept by \`acc setup readme\`; edit the environments in \`.acc/config.json\`._`,
    README_END
  ].join("\n");
}
function writeReadme(paths, config, steps2 = NO_STEPS) {
  return steps2.step("readme", "Write the environments section", () => writeReadmeNow(paths, config));
}
function writeReadmeNow(paths, config) {
  const file = join33(paths.root, "README.md");
  const section = environmentsSection(config);
  if (!existsSync24(file)) {
    writeFileSync30(file, `# ${config.project}

${section}
`);
    return { file, created: true, replaced: false };
  }
  const text = readFileSync32(file, "utf8");
  const a2 = text.indexOf(README_START);
  const b = text.indexOf(README_END);
  if (a2 >= 0 && b > a2) {
    writeFileSync30(file, `${text.slice(0, a2)}${section}${text.slice(b + README_END.length)}`);
    return { file, created: false, replaced: true };
  }
  writeFileSync30(file, `${text.replace(/\s*$/, "")}

${section}
`);
  return { file, created: false, replaced: false };
}

// packages/core/src/source-tracking.ts
var usesSourceTracking = (config) => config.sourceTracking !== false;
var NO_TRACKING_REASON = "This project doesn't use source tracking, so there's nothing to check. To change that, turn on Source tracking under Limits and checks in the project's settings.";
function setSourceTracking(configFile, on) {
  const { config } = loadConfig(configFile);
  if (config.profile !== "salesforce") throw new AccError("refused", "Source tracking is a Salesforce setting: this project isn't a Salesforce project.");
  writeJsonKey(configFile, ["sourceTracking"], on ? void 0 : false);
}

// packages/core/src/sprints.ts
import { mkdirSync as mkdirSync32, readFileSync as readFileSync33 } from "node:fs";
import { join as join34 } from "node:path";
var sprintsFile = (paths) => join34(paths.stateDir, "sprints.json");
function isSprintSeen(x2) {
  return isObj(x2) && typeof x2.at === "string" && Array.isArray(x2.open) && x2.open.every((k2) => typeof k2 === "string") && Array.isArray(x2.sprints) && x2.sprints.every((s) => isObj(s) && Number.isSafeInteger(s.id) && typeof s.name === "string");
}
function readSprints(paths) {
  try {
    const r = JSON.parse(readFileSync33(sprintsFile(paths), "utf8"));
    return isObj(r) ? Object.fromEntries(Object.entries(r).filter(([, v]) => isSprintSeen(v))) : {};
  } catch {
    return {};
  }
}
function rememberSprint(paths, tracker, seen) {
  mkdirSync32(paths.stateDir, { recursive: true });
  writeAtomic(sprintsFile(paths), `${JSON.stringify({ ...readSprints(paths), [tracker]: seen }, null, 2)}
`);
}

// packages/core/src/tidy.ts
import { mkdirSync as mkdirSync33, readFileSync as readFileSync34 } from "node:fs";
import { join as join35 } from "node:path";
var TIDY_LABEL = "tidy-up";
var tidyFile = (paths) => join35(paths.stateDir, "tidy.json");
function readTidy(paths) {
  try {
    const r = JSON.parse(readFileSync34(tidyFile(paths), "utf8"));
    return r?.v === 1 && typeof r.at === "string" && (r.outcome === "added" || r.outcome === "skipped") && Array.isArray(r.covered) ? r : null;
  } catch {
    return null;
  }
}
function branchInEnvironment(run2, root, reviews) {
  return (t) => {
    const branch = t.run?.branch;
    const reviewed = reviews ? readVerdicts({ reviews }, t.id).map((v) => v.sha).reverse() : [];
    const tips = [...branch ? [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`] : [], ...reviewed];
    const inRef = (tip, ref) => run2("git", ["merge-base", "--is-ancestor", tip, ref], { cwd: root }).code === 0;
    return tips.some((tip) => inRef(tip, `refs/remotes/origin/${t.environment}`) || inRef(tip, `refs/heads/${t.environment}`));
  };
}
function mergedTask(t, inEnvironment) {
  if (t.state !== "done" || t.labels.includes(TIDY_LABEL)) return null;
  const viaPr = t.pr?.state === "merged";
  if (!viaPr && !inEnvironment(t)) return null;
  const done = [...t.history].reverse().find((h2) => h2.to === "done");
  const at2 = done?.at ?? t.pr?.syncedAt ?? t.updatedAt;
  return { id: t.id, title: t.title, at: at2, pr: t.pr?.number ?? null, mergeSha: viaPr ? t.pr?.mergeSha ?? null : null, branch: t.run?.branch ?? null };
}
function tidyDue(ledger, config, last, inEnvironment = () => false) {
  const every = tidyEvery(config);
  const merged = ledger.tasks.map((t) => mergedTask(t, inEnvironment)).filter((m) => !!m).sort((a2, b) => a2.at.localeCompare(b.at) || a2.id.localeCompare(b.id, void 0, { numeric: true }));
  const covered2 = new Set(last?.covered ?? []);
  const tasks = last ? merged.filter((m) => m.at > last.at && !covered2.has(m.id)) : every ? merged.slice(-every) : [];
  const open = ledger.tasks.find((t) => t.labels.includes(TIDY_LABEL) && t.state !== "done")?.id ?? null;
  return { every, tasks, count: tasks.length, due: every > 0 && !open && tasks.length >= every, open, last };
}
function tidyStatus(paths, config, ledger, run2 = run) {
  return tidyDue(ledger, config, readTidy(paths), branchInEnvironment(run2, paths.root, paths.reviews));
}
var git9 = (run2, root, args) => run2("git", args, { cwd: root });
var names2 = (out3) => out3.split("\0").filter(Boolean);
function branchRange(run2, root, tip, ref) {
  const head = git9(run2, root, ["rev-parse", `${ref}^{commit}`]).stdout.trim();
  const merges = git9(run2, root, ["rev-list", "--merges", "--first-parent", "--parents", tip]).stdout.split("\n");
  const merge = merges.map((l3) => l3.split(" ")).find(([, , ...others]) => others.includes(head))?.[0];
  if (merge) return [`${merge}^1`, merge];
  const base = git9(run2, root, ["merge-base", tip, ref]).stdout.trim();
  return base && base !== head ? [base, ref] : null;
}
function tidyScope(run2, root, config, tasks, env = process.env, reviews) {
  const branch = defaultEnvironment(config).branch;
  const hasOrigin = git9(run2, root, ["remote", "get-url", "origin"]).code === 0;
  const fetched = hasOrigin && fetchBranches(run2, root, [branch], { ...env, GIT_TERMINAL_PROMPT: "0" });
  const verify = (ref) => git9(run2, root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).code === 0;
  const tip = [`origin/${branch}`, branch].find(verify);
  if (!tip) throw new AccError("no-base", `There's no ${branch} or origin/${branch} branch here to read the files on.`);
  const changed = /* @__PURE__ */ new Set();
  const unknown2 = [];
  for (const t of tasks) {
    let files = null;
    let why = "";
    if (t.mergeSha && verify(t.mergeSha)) {
      const d = git9(run2, root, ["diff", "--name-only", "--no-renames", "-z", `${t.mergeSha}^1`, t.mergeSha]);
      if (d.code === 0) files = names2(d.stdout);
      else why = `git couldn't compare its merge commit ${t.mergeSha.slice(0, 7)} with its parent`;
    } else if (t.mergeSha) why = `its merge commit ${t.mergeSha.slice(0, 7)} isn't in this clone${hasOrigin && !fetched ? ", and fetching it failed" : ""}`;
    if (!files && !t.mergeSha) {
      const ref = t.branch ? [`origin/${t.branch}`, t.branch].find(verify) : void 0;
      const range = ref ? branchRange(run2, root, tip, ref) : null;
      const d = range ? git9(run2, root, ["diff", "--name-only", "--no-renames", "-z", ...range]) : null;
      if (d?.code === 0) files = names2(d.stdout);
      else why = t.branch ? `acc didn't record its merge commit, and its branch ${t.branch} is gone` : "acc didn't record its merge commit or its branch";
    }
    if (!files && !t.mergeSha && reviews) {
      const merge = readVerdicts({ reviews }, t.id).map((v) => v.sha).reverse().filter(verify).map((sha) => git9(run2, root, ["rev-list", "--merges", "--ancestry-path", "--reverse", `${sha}..${tip}`]).stdout.split("\n")[0]?.trim()).find((m) => !!m);
      const d = merge ? git9(run2, root, ["diff", "--name-only", "--no-renames", "-z", `${merge}^1`, merge]) : null;
      if (d?.code === 0) files = names2(d.stdout);
    }
    if (files) files.forEach((f) => changed.add(f));
    else unknown2.push({ task: t.id, why });
  }
  const there = new Set(names2(git9(run2, root, ["ls-tree", "-r", "--name-only", "-z", tip]).stdout));
  const skip3 = [...config.autopilot?.appendOnly ?? [], ...readList(root, config.environmentSpecific), ".acc"];
  const live = [...changed].filter((f) => there.has(f)).sort();
  return { branch, tip, fetched, files: live.filter((f) => !listed(f, skip3)), unknown: unknown2, leftOut: live.filter((f) => listed(f, skip3)) };
}
function draftTidy(status, scope) {
  const n = status.tasks.length;
  const ids = status.tasks.map((t) => t.id);
  const brief = [
    `${plural(n, "task")} merged in this repo since the last tidy-up. With many builders at once and nobody tidying, code collects copies of one helper, and comments that say the opposite of the code elsewhere. This task finds those in the files those tasks changed, and changes no behaviour.`,
    "",
    `## The tasks (${n})`,
    "",
    ...ids.map((id) => `- ${id}`),
    "",
    "## What to look for",
    "",
    "- **Duplicated helpers:** a function, or a few lines, that does what another one already does. Keep one, the exported one where there is one, and call it from where the copies were.",
    "- **Comments that contradict the code:** a comment or doc line that says the code does something it doesn't. Another kind says that nothing does a job, when other code does it. Make it say what the code does, or remove it.",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] Each duplicated helper found in these files is one helper now, called from where its copies were, and the note names each.",
    "- [ ] Each comment found contradicting the code says what the code does, or is gone.",
    "- [ ] It changes no behaviour: no test's expectations change, and every check passes as before.",
    "- [ ] It changes only the files below. It may call a helper that lives elsewhere. A duplicate whose copies are all elsewhere goes in the note's open lines.",
    "",
    `## The files (${scope.files.length})`,
    "",
    `What those tasks' merges changed that is still on \`${scope.branch}\`, without append-only, environment-specific and \`.acc/\` files:`,
    "",
    ...scope.files.length ? scope.files.map((f) => `- \`${f}\``) : ["- none"],
    ...scope.unknown.length ? ["", "## Tasks whose files aren't known", "", "Their changes aren't in the list above. Look at them by hand if they matter:", "", ...scope.unknown.map((u) => `- ${u.task}: ${u.why}.`)] : []
  ].join("\n");
  return { title: `Tidy up after ${plural(n, "merge")}`, brief, labels: [TIDY_LABEL], covered: ids, files: scope.files, unknown: scope.unknown };
}
function writeRecord(paths, r) {
  mkdirSync33(paths.stateDir, { recursive: true });
  writeAtomic(tidyFile(paths), JSON.stringify(r, null, 2) + "\n");
}
function addTidy(paths, config, draft, who) {
  if (!draft.covered.length) throw new AccError("refused", "Nothing has merged since the last tidy-up, so there's nothing to tidy.");
  if (!draft.files.length && !draft.unknown.length) throw new AccError("refused", "None of the files those tasks changed is left to tidy. acc tidy skip records that, so the count starts again.");
  return mutate(paths, who.now, (ledger, emit) => {
    const open = ledger.tasks.find((t) => t.labels.includes(TIDY_LABEL) && t.state !== "done");
    if (open) throw new AccError("refused", `${open.id} is a tidy-up that isn't done yet. Finish it, or remove it, before adding another.`);
    const res = upsertTasks(ledger, config, [{ source: { kind: "manual" }, title: draft.title, brief: draft.brief, labels: draft.labels }], "human", who.by, emit, who.now);
    const task = res.added[0];
    if (!task) throw new AccError("refused", `The tidy-up couldn't be added: ${res.errors.join(" ") || "acc doesn't know why"}`);
    const record2 = { v: 1, at: who.now().toISOString(), by: who.by, outcome: "added", task, covered: draft.covered };
    writeRecord(paths, record2);
    return { task, record: record2 };
  });
}
function skipTidy(paths, config, who) {
  return mutate(paths, who.now, (ledger) => {
    const status = tidyStatus(paths, config, ledger);
    if (!status.count) throw new AccError("refused", "Nothing has merged since the last tidy-up, so there's nothing to skip.");
    const record2 = { v: 1, at: who.now().toISOString(), by: who.by, outcome: "skipped", covered: status.tasks.map((t) => t.id) };
    writeRecord(paths, record2);
    return record2;
  });
}

// packages/core/src/onboarding/steps.ts
import { existsSync as existsSync25, opendirSync, readFileSync as readFileSync35 } from "node:fs";
import { homedir as homedir8, tmpdir as tmpdir7 } from "node:os";
import { dirname as dirname13, join as join36, sep as sep4 } from "node:path";

// packages/core/src/onboarding/cloud-steps.ts
var ROUTINE_PROMPT = [
  "You are a builder for Agent Command Center (acc). Each run's task is in the routine-fire-payload block below: acc fired this routine to build one task.",
  "Do exactly what the payload says, as the builder it names, on the branch it names, and nothing else. Push only that branch. Never push any other branch, force-push, merge or open a pull request, or deploy.",
  "If there is no payload, do nothing and stop."
].join(" ");
var ROUTINE_GUIDE = `At ${ROUTINES_URL}, make a routine for this repo: paste acc's routine prompt as its instructions (acc cloud shows it), pick the repo and the model, keep the Default environment (Trusted network access reaches npm and GitHub; no org), and add an API trigger. Save it and copy its trigger id (trig_\u2026): acc cloud enable --routine <id> records it. Then click Generate token and copy the token once: acc cloud token keeps it in the keychain, pasted when it asks.`;
var GITHUB_APP = "https://github.com/apps/claude";
function optedIn(ctx) {
  if (!ctx.paths) return skip2("Not inside a repo.");
  if (!ctx.config) return skip2("Needs a valid .acc/config.json first (step B0).");
  if (!ctx.config.github) return skip2("Cloud builders need the repo on GitHub.");
  if (!ctx.config.agents.cloud) return skip2("Cloud builders are off for this project: acc cloud enable opts in.");
  return null;
}
var CLOUD_STEPS = [
  {
    id: "B15.cloud-github-app",
    part: "project",
    group: "B15",
    title: "Claude can clone the repo from the cloud",
    why: "A cloud session clones the repo from GitHub and pushes its branch back, through the GitHub access connected to your claude.ai account: the Claude GitHub App on the repo, or /web-setup in a terminal (GH-69).",
    fix: { text: `Install the Claude GitHub App on the repo at ${GITHUB_APP}, or run /web-setup in a claude session, which sends gh's token to your claude.ai account. acc can see only the app.`, confirm: true, docs: "https://code.claude.com/docs/en/claude-code-on-the-web#github-authentication-options" },
    check(ctx) {
      const need = optedIn(ctx);
      if (need) return need;
      const repo = ctx.config.github.repo;
      const list = ctx.run("gh", ["api", "user/installations", "--jq", '.installations[] | select(.app_slug == "claude") | [.id, .repository_selection] | @tsv'], { env: ctx.env, timeoutMs: 3e4 });
      if (list.code !== 0) return unknown(`gh couldn't list the apps installed for you: ${(list.stderr || list.stdout).trim().split("\n")[0]}. If you connected with /web-setup, that's fine: tick this yourself.`);
      const installs = list.stdout.trim().split("\n").filter(Boolean).map((l3) => l3.split("	"));
      if (!installs.length) return unknown(`The Claude GitHub App isn't installed on any account you can see. Install it at ${GITHUB_APP}, or if you connected with /web-setup, tick this yourself.`);
      for (const [id, selection] of installs) {
        if (selection === "all") return pass2("The Claude GitHub App is installed, on every repo of its account.");
        const repos = ctx.run("gh", ["api", `user/installations/${id}/repositories?per_page=100`, "--jq", ".repositories[].full_name"], { env: ctx.env, timeoutMs: 3e4 });
        if (repos.code === 0 && repos.stdout.split("\n").map((l3) => l3.trim().toLowerCase()).includes(repo.toLowerCase())) return pass2(`The Claude GitHub App is installed on ${repo}.`);
      }
      return unknown(`The Claude GitHub App is installed, but not on ${repo} as far as gh can see. Add the repo to it at ${GITHUB_APP}, or if you connected with /web-setup, tick this yourself.`);
    }
  },
  {
    id: "B15.cloud-routine",
    part: "project",
    group: "B15",
    title: "A routine for the repo",
    why: "A script starts a cloud session only by firing a routine's API trigger (GH-69). The routine holds the repo, the model and the environment; acc sends each task in the fire's text.",
    fix: { text: ROUTINE_GUIDE, docs: "https://code.claude.com/docs/en/routines" },
    check(ctx) {
      const need = optedIn(ctx);
      if (need) return need;
      const routine = ctx.config.agents.cloud.routine;
      return routine ? pass2(`Routine ${routine}.`) : fail2("No routine id in .acc/config.json (agents.cloud.routine).");
    }
  },
  {
    id: "B15.cloud-token",
    part: "project",
    group: "B15",
    title: "The routine's token is in the keychain",
    why: "acc fires the routine with its bearer token, kept in this Mac's keychain and never in .acc/config.json or git (GH-69). The token is shown once, on the routine's page.",
    fix: { text: "On the routine's page, under its API trigger, click Generate token and copy it. Then, in a terminal, acc cloud token keeps it in the keychain under acc-cloud-routine, for this repo: paste the token when it asks.", docs: "https://code.claude.com/docs/en/routines#add-an-api-trigger" },
    check(ctx) {
      const need = optedIn(ctx);
      if (need) return need;
      return readCloudToken(ctx.run, ctx.config.github.repo, ctx.env) ? pass2("The routine's token is in the keychain.") : fail2(`No token for ${ctx.config.github.repo} in the keychain.`);
    }
  },
  {
    id: "B15.cloud-login",
    part: "project",
    group: "B15",
    title: "Claude Code is signed in to claude.ai",
    why: "Sending a cloud builder a message (claude -p --cloud) needs the CLI signed in to the claude.ai account the routine belongs to (GH-69).",
    fix: { command: "claude auth login", text: "Sign in with the claude.ai account that owns the routine. An API key isn't enough for cloud sessions." },
    check(ctx) {
      const need = optedIn(ctx);
      if (need) return need;
      const login = claudeLogin(ctx.run, ctx.env);
      return login.ok ? pass2(`Signed in to claude.ai${login.email ? ` as ${login.email}` : ""}.`) : fail2(login.why, "claude auth login");
    }
  },
  {
    id: "B15.cloud-guard",
    part: "project",
    group: "B15",
    title: "The push guard is committed",
    why: "A cloud session runs the repo's own .claude/settings.json hooks and not acc's plugin, so the guard that refuses a push to any branch but the task's, and the git pre-push hook it installs in the clone to check the push itself, are scripts the repo carries, and only what's committed reaches the cloud (GH-69).",
    fix: { command: "acc cloud enable", text: "acc cloud enable writes .claude/hooks/acc-push-guard.mjs, .claude/hooks/acc-pre-push beside it, and their hooks into .claude/settings.json. Commit all three, and merge them into every branch a cloud session starts from." },
    check(ctx) {
      const need = optedIn(ctx);
      if (need) return need;
      const committed = guardCommitted(ctx.run, ctx.paths.root, "HEAD");
      return committed.ok ? pass2("The push guard, its pre-push hook and their settings are committed on HEAD.") : fail2(committed.why ?? "The push guard isn't committed.", "acc cloud enable");
    }
  }
];

// packages/core/src/onboarding/tool-steps.ts
var TOOL_STEPS = [
  {
    id: "B13.tools",
    part: "project",
    group: "B13",
    title: "The tools the project's checks need",
    why: "Some projects' checks need a tool on this machine that npm install doesn't bring, such as a pinned browser to draw screenshots with. The project lists each in its config, with a command that checks for it and one that sets it up.",
    fix: { fromCheck: true },
    check(ctx) {
      if (!ctx.paths) return skip2("Not inside a repo.");
      if (!ctx.config) return skip2("Needs a valid .acc/config.json first (step B0).");
      const tools = ctx.config.tools ?? [];
      if (!tools.length) return skip2("The project lists no tools its checks need.");
      let root = ctx.paths.root;
      try {
        root = mainCheckout(ctx.run, ctx.paths.root);
      } catch {
      }
      for (const t of tools) {
        const r = ctx.run("sh", ["-c", t.check], { cwd: root, env: ctx.env });
        if (r.code !== 0) {
          const said2 = (r.stderr || r.stdout).trim().split("\n")[0];
          return fail2(`${t.title} isn't set up yet${said2 ? `: ${said2}` : "."} ${t.why}`, t.fix);
        }
      }
      return pass2(`Ready: ${tools.map((t) => t.title).join(", ")}.`);
    }
  }
];

// packages/core/src/onboarding/steps.ts
var DOCS = "docs/ONBOARDING.md";
var GH_SIGN_IN = `"Do it" opens VSCode's GitHub sign-in: pick this repo's account, or add it, and gh gets that login, with access to GitHub Projects for the board. gh's active account stays as it was. In a terminal: gh auth login.`;
var BACKSTOP = ["/*.csv", "/*.xls", "/*.xlsx", "/*.eml"];
function needsProject(ctx) {
  if (!ctx.paths) return skip2("Not inside a repo.");
  if (!ctx.config) return skip2("Needs a valid .acc/config.json first (step B0).");
  return null;
}
var NEARBY_LIMIT = 200;
function nearbyRepo(cwd) {
  const isRepo = (d) => existsSync25(join36(d, ".git"));
  const parent = dirname13(cwd);
  if (samePath(parent, tmpdir7())) return null;
  const candidates = [...nearbyFolders(parent).filter((d) => d !== cwd), parent].filter(isRepo);
  return candidates.find((d) => existsSync25(join36(d, ".acc", "config.json"))) ?? candidates.find((d) => existsSync25(join36(d, "sfdx-project.json"))) ?? null;
}
function nearbyFolders(parent) {
  const folders = [];
  let dir;
  try {
    dir = opendirSync(parent);
    for (let read2 = 0; read2 < NEARBY_LIMIT; read2++) {
      const e = dir.readSync();
      if (!e) break;
      if (e.isDirectory() && !e.name.startsWith(".")) folders.push(join36(parent, e.name));
    }
  } catch {
    return [];
  } finally {
    dir?.closeSync();
  }
  return folders;
}
function filesOnEnvironmentBranches(ctx) {
  return cached(ctx, "env-branch-files", () => {
    const files = /* @__PURE__ */ new Set();
    for (const env of ctx.config.environments) {
      for (const ref of [`origin/${env.branch}`, env.branch]) {
        const r = ctx.run("git", ["ls-tree", "-r", "--name-only", ref], { cwd: ctx.paths.root });
        if (r.code === 0) {
          for (const f of r.stdout.split("\n")) if (f) files.add(f);
        }
      }
    }
    return files;
  });
}
var sfEnvs = (ctx) => (ctx.config?.environments ?? []).filter((e) => e.type !== "none");
var devEnvs = (ctx) => sfEnvs(ctx).filter((e) => (e.type === "developer" || e.type === "developer_pro") && e.org);
var API_KEY_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
var CLOUD_VARS = ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"];
var isTrue = (v) => ["1", "true", "yes", "on"].includes(String(v ?? "").trim().toLowerCase());
function billingVars(vars) {
  return [...API_KEY_VARS.filter((v) => String(vars[v] ?? "") !== ""), ...CLOUD_VARS.filter((v) => isTrue(vars[v]))];
}
function claudeSettingsFiles(ctx) {
  const home = ctx.env.HOME || homedir8();
  const tilde = (f) => f.startsWith(home + sep4) ? `~${f.slice(home.length)}` : f;
  const user = ctx.env.CLAUDE_CONFIG_DIR ? join36(ctx.env.CLAUDE_CONFIG_DIR, "settings.json") : join36(home, ".claude", "settings.json");
  const files = [{ file: user, label: tilde(user) }];
  if (!ctx.paths) return files;
  let main2 = ctx.paths.root;
  try {
    main2 = mainCheckout(ctx.run, ctx.paths.root);
  } catch {
  }
  for (const root of /* @__PURE__ */ new Set([ctx.paths.root, main2])) {
    for (const rel of [".claude/settings.json", ".claude/settings.local.json"]) {
      files.push({ file: join36(root, rel), label: root === ctx.paths.root ? rel : tilde(join36(root, rel)) });
    }
  }
  return files;
}
function billingSettings(file) {
  let text;
  try {
    text = readFileSync35(file, "utf8");
  } catch {
    return [];
  }
  let s;
  try {
    s = JSON.parse(text) ?? {};
  } catch {
    return null;
  }
  const found = s.apiKeyHelper ? ["apiKeyHelper"] : [];
  if (s.env && typeof s.env === "object") found.push(...billingVars(s.env).map((v) => `${v} under env`));
  return found;
}
var PLUGIN = { marketplace: "agent-command-center", name: "acc", repo: "https://github.com/jack-huffman/agent-command-center" };
var PLUGIN_ID = `${PLUGIN.name}@${PLUGIN.marketplace}`;
var MARKETPLACE_ADD = `claude plugin marketplace add ${PLUGIN.repo}`;
var PLUGIN_INSTALL = `claude plugin install ${PLUGIN_ID} --scope user`;
var PLUGIN_UPDATE = `claude plugin marketplace update ${PLUGIN.marketplace} && claude plugin update ${PLUGIN_ID} --scope user`;
function userPlugin(list) {
  const user = list.find((p) => p.id === PLUGIN_ID && p.scope === "user");
  return user ? { version: typeof user.version === "string" ? user.version : null, enabled: user.enabled === true } : null;
}
var PLUGIN_LIST_ARGS = ["plugin", "list", "--json"];
function parseClaudeList(r, args) {
  const what = `claude ${args.slice(0, 2).join(" ")}`;
  if (r.code === 127) return { ok: false, missing: true, error: "claude isn't installed." };
  if (r.code !== 0) return { ok: false, missing: false, error: `${what} didn't run: ${(r.stderr || r.stdout).trim().split("\n")[0] || `exit ${r.code}`}` };
  try {
    const list = parseJsonOutput(r.stdout);
    if (Array.isArray(list) && list.every((x2) => x2 && typeof x2 === "object")) return { ok: true, list };
  } catch {
  }
  return { ok: false, missing: false, error: `${what} printed something other than a list.` };
}
var claudeList = (ctx, args) => parseClaudeList(ctx.run("claude", args, { env: ctx.env }), args);
function versionStep(id, title, why, cmd, args, min, fix, profiles) {
  return {
    id,
    part: "machine",
    group: "A1",
    title,
    why,
    profiles,
    fix: { command: fix },
    check(ctx) {
      const r = ctx.run(cmd, args, { env: ctx.env });
      if (r.code === 127) return fail2(`${cmd} isn't installed.`);
      if (r.code !== 0) return fail2(`${cmd} didn't run: ${(r.stderr || r.stdout).trim().split("\n")[0]}`);
      const v = firstVersion(r.stdout + r.stderr);
      if (min && (!v || !versionAtLeast(v, min))) return fail2(`${cmd} ${v ?? "(unknown version)"} is older than ${min}.`);
      return pass2(`${cmd} ${v ?? ""}`.trim());
    }
  };
}
var STEPS = [
  // ------------------------------------------------------------ Part A: this machine
  versionStep("A1.git", "git 2.40 or later", "Worktrees and the shared git directory need a recent git.", "git", ["--version"], "2.40", "brew install git"),
  // acc itself needs no Node: its launcher falls back to VSCode's runtime (D-077).
  versionStep("A1.node", "Node 20 or later", "The Salesforce CLI and its plugins run on Node, and npm installs them. acc itself doesn't need it.", "node", ["--version"], "20", "brew install node", ["salesforce"]),
  versionStep("A1.gh", "GitHub CLI", "Pull requests, issues and the per-repo account all go through gh.", "gh", ["--version"], null, "brew install gh"),
  {
    id: "A1.claude",
    part: "machine",
    group: "A1",
    title: "Claude Code CLI with background sessions",
    why: "Builders run as `claude --bg` sessions (D-009). The VSCode extension ships its own copy, so the terminal CLI can fall far behind.",
    fix: { command: "claude update" },
    check(ctx) {
      const v = ctx.run("claude", ["--version"], { env: ctx.env });
      if (v.code === 127) return fail2("claude isn't installed.", "brew install --cask claude-code");
      const h2 = ctx.run("claude", ["--help"], { env: ctx.env });
      if (!/--bg\b/.test(h2.stdout)) return fail2(`claude ${firstVersion(v.stdout) ?? ""} has no --bg. Update it.`);
      return pass2(`claude ${firstVersion(v.stdout) ?? ""}`.trim());
    }
  },
  {
    id: "A1.claude-billing",
    part: "machine",
    group: "A1",
    title: "Agents bill your Claude subscription",
    why: "On your Claude subscription, agents' work counts toward the plan you already pay for; with an API key, or through Bedrock or Vertex, every token they use is billed on top, and nothing else tells you.",
    fix: {
      text: 'Remove each setting the check names: take the variable out of your shell profile (such as ~/.zshrc) and open a new terminal, or delete apiKeyHelper, or the variable under "env", from the settings file it names. If Claude Code then asks you to sign in, use /login with your Claude account. Keeping one on purpose, such as a key you mean to bill per token, is fine: mark this done.'
    },
    check(ctx) {
      const found = billingVars(ctx.env).map((v) => `${v} in the environment`);
      const unreadable = [];
      for (const { file, label } of claudeSettingsFiles(ctx)) {
        const names3 = billingSettings(file);
        if (names3) found.push(...names3.map((n) => `${n} in ${label}`));
        else unreadable.push(label);
      }
      const note = unreadable.length ? `Not valid JSON, so not checked: ${unreadable.join(", ")}.` : "";
      if (found.length) return fail2(`Agents would bill per token, not your Claude subscription: ${found.join(", ")}.${note && ` ${note}`}`);
      if (unreadable.length) return unknown(note);
      return pass2("Agents use your Claude subscription.");
    }
  },
  versionStep("A1.sf", "Salesforce CLI", "Validation, retrieves and org checks use sf.", "sf", ["--version"], null, "npm install -g @salesforce/cli", ["salesforce"]),
  {
    id: "A1.code-analyzer",
    part: "machine",
    group: "A1",
    title: "Salesforce Code Analyzer",
    profiles: ["salesforce"],
    why: "The `static` check runs `sf code-analyzer`.",
    fix: { command: "sf plugins install code-analyzer" },
    check(ctx) {
      const r = ctx.run("sf", ["plugins"], { env: { ...ctx.env, SF_NO_UPDATE_NOTIFIER: "true" } });
      if (r.code === 127) return fail2("sf isn't installed.");
      return /code-analyzer/.test(r.stdout) ? pass2("code-analyzer plugin installed") : fail2("The code-analyzer plugin isn't installed.");
    }
  },
  {
    id: "A2.gh-login",
    part: "machine",
    group: "A2",
    title: "Logged in to GitHub",
    why: "Each repo uses its own GitHub account, asked for by name each time. The account gh has active is never switched, because that changes every session.",
    fix: { vscode: "acc.github.signIn", text: GH_SIGN_IN },
    check(ctx) {
      const r = ctx.run("gh", ["auth", "status"], { env: ctx.env });
      if (r.code === 127) return fail2("gh isn't installed.");
      const accounts = [...(r.stdout + r.stderr).matchAll(/account (\S+)/g)].map((m) => m[1]);
      if (!accounts.length) return fail2("gh isn't logged in to any account.");
      const want = ctx.config?.github?.account;
      if (want && !accounts.includes(want)) return fail2(`gh isn't logged in as ${want}. Logged in: ${accounts.join(", ")}.`, `gh auth login   # as ${want}`);
      return pass2(`Logged in as ${accounts.join(", ")}`);
    }
  },
  {
    id: "A4.plugin",
    part: "machine",
    group: "A4",
    title: "The acc plugin in Claude Code",
    why: "Its hooks keep each builder inside its own worktree and away from pushes, merges and deploys, and send it back to the finish line if it stops early. It also gives agents acc's skills and the reviewer. It's installed once, for every Claude Code session, and does nothing in a repo without .acc/config.json.",
    fix: {
      command: `${MARKETPLACE_ADD} && ${PLUGIN_INSTALL}`,
      text: "Claude Code clones this private repo with your own git credentials, so accept the invitation to it first. Sessions already running don't load the plugin: start a new one."
    },
    check(ctx) {
      const read2 = claudeList(ctx, PLUGIN_LIST_ARGS);
      if (!read2.ok && read2.missing) return fail2(`${read2.error} Do A1.claude first.`, "brew install --cask claude-code");
      if (!read2.ok) return unknown(`Couldn't read Claude Code's plugins: ${read2.error}`);
      const list = read2.list;
      const mine = list.filter((p) => p.id === PLUGIN_ID);
      const user = userPlugin(list);
      const version = user?.version ?? "(unknown version)";
      if (user?.enabled) {
        if (pluginBehind(user.version, ctx.version)) {
          return fail2(`acc ${version} is installed, older than this acc (${ctx.version}).`, PLUGIN_UPDATE);
        }
        return pass2(`acc ${version}, for every Claude Code session.`);
      }
      if (user) return fail2(`acc ${version} is installed but disabled.`, `claude plugin enable ${PLUGIN_ID} --scope user`);
      const scopes = [...new Set(mine.map((p) => String(p.scope)))];
      const only = scopes.length ? ` It's installed for one project only (${scopes.join(", ")} scope), not for every session.` : "";
      const markets = claudeList(ctx, ["plugin", "marketplace", "list", "--json"]);
      if (markets.ok && markets.list.some((m) => m.name === PLUGIN.marketplace)) return fail2(`acc isn't installed in Claude Code.${only}`, PLUGIN_INSTALL);
      return fail2(`acc isn't installed in Claude Code, and its marketplace isn't added.${only}`, `${MARKETPLACE_ADD} && ${PLUGIN_INSTALL}`);
    }
  },
  // ------------------------------------------------------------ Part B: this project
  {
    id: "B0.repo",
    part: "project",
    group: "B0",
    title: "Inside the project's repo",
    why: "Everything per-project hangs off the repo: config, branches, and the ledger in the git directory (D-008).",
    fix: { fromCheck: true, docs: `${DOCS}#b1-decide-where-everything-lives` },
    check(ctx) {
      if (ctx.paths) return pass2(`Repo at ${ctx.paths.root}`);
      const near = nearbyRepo(ctx.cwd);
      if (near) return { status: "fail", detail: `This folder isn't a git repo. The project's repo looks like ${near}. Open that folder instead.`, open: near };
      const sfdx = existsSync25(join36(ctx.cwd, "sfdx-project.json"));
      return fail2(sfdx ? "This Salesforce folder isn't a git repo yet. Onboarding starts with the client's repo (guide steps B1 and B2)." : "This folder isn't a git repo. Open the project's repo folder.");
    }
  },
  {
    id: "B0.config",
    part: "project",
    group: "B0",
    title: "Project config",
    why: "`.acc/config.json` names the environments, GitHub account and checks.",
    fix: { command: "acc init" },
    check(ctx) {
      if (!ctx.paths) return skip2("Not inside a repo.");
      if (ctx.config) {
        const n = ctx.config.environments.length;
        return pass2(`${ctx.config.project}: ${ctx.config.profile}, ${n} environment${n === 1 ? "" : "s"}`);
      }
      if (!existsSync25(ctx.paths.config)) return fail2("There's no .acc/config.json yet.");
      return fail2(`.acc/config.json has problems: ${ctx.configErrors.join(" ")}`);
    }
  },
  {
    id: "B0.template",
    part: "project",
    group: "B0",
    title: "The team template is current",
    why: "A project started from a team template records which one. This says when the team has changed it since, and where this project now differs. It never changes .acc/config.json: applying a change is yours to do.",
    fix: { fromCheck: true, docs: `${DOCS}#b0-open-the-repo-and-give-it-a-config` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const config = ctx.config;
      const rec = config.template;
      if (!rec) return skip2("Not started from a team template.");
      const root = ctx.paths.root;
      const home = ctx.env.HOME || homedir8();
      let local = null;
      try {
        const src = parseSource(rec.source, root, home);
        if (src.kind === "file") local = src.path;
      } catch (e) {
        return unknown(`The template's recorded source, ${rec.source}, can't be read: ${e.message}`);
      }
      if (local && !existsSync25(local)) return skip2(`${rec.name} is a file, ${rec.source}, that isn't on this machine.`);
      let read2;
      try {
        read2 = readTemplate(ctx.run, rec.source, { account: config.github?.account ?? null, env: ctx.env, base: root, home, timeoutMs: 2e4 });
      } catch (e) {
        return unknown(`Couldn't read ${rec.name} from ${rec.source}: ${e.message}`);
      }
      if (read2.digest === rec.digest) return pass2(`${rec.name}, unchanged since this project was made from it.`);
      if (!read2.template) return unknown(`${rec.name} has changed since this project was made from it, and now has problems: ${read2.errors.join(" ")}`);
      const diffs = templateDifferences(read2.template, config, { root, home });
      if (!diffs.length) return pass2(`${rec.name} has changed since this project was made from it, and this project already agrees with it.`);
      const preview = previewCommand(read2.template, rec, config);
      return { status: "unknown", detail: `${rec.name} has changed since this project was made from it, and this project differs on ${diffs.join(", ")}. The fix previews what it would write, and changes nothing.`, fix: preview };
    }
  },
  {
    id: "B0.rules",
    part: "project",
    group: "B0",
    title: "Copied-in rules are current",
    why: "A team's shared rules are copied into .acc/rules/, each with where it came from (GH-108), and agents read only those copies. This says when a source has changed since its copy. It never copies one in again: that is yours to choose.",
    fix: { fromCheck: true, docs: `${DOCS}#b0-open-the-repo-and-give-it-a-config` },
    offer: { vscode: "acc.importRules", label: "Import rules\u2026", icon: "cloud-download" },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const root = ctx.paths.root;
      const copies = rulesStatus(ctx.run, root, { account: ctx.config.github?.account ?? null, env: ctx.env, home: ctx.env.HOME || homedir8(), timeoutMs: 2e4 });
      const sourced = copies.filter((c) => c.state !== "local");
      const names3 = (cs) => cs.length < 2 ? cs.map((c) => c.file).join("") : `${cs.slice(0, -1).map((c) => c.file).join(", ")} and ${cs.at(-1).file}`;
      if (!sourced.length) return skip2(copies.length ? `${names3(copies)} ${copies.length === 1 ? "has" : "have"} no source to compare with.` : "No rules are copied in. Import rules\u2026 copies a team's rules file into .acc/rules/.");
      const changed = copies.filter((c) => c.state === "changed");
      const open = copies.filter((c) => c.state === "unreachable" || c.state === "unchecked" || c.state === "bad-header");
      if (changed.length || open.length) {
        const detail = [
          ...changed.length ? [`${names3(changed)} ${changed.length === 1 ? "has" : "have"} changed at the source since ${changed.length === 1 ? "it was" : "they were"} copied in. The fix shows the difference and changes nothing; copying one in again is yours to choose.`] : [],
          ...open.map((c) => `${c.file}: ${c.reason}`)
        ].join(" ");
        return { status: "unknown", detail, ...changed.length ? { fix: `acc rules diff${changed.length === 1 ? ` ${changed[0].name}` : ""}` } : {} };
      }
      const same2 = copies.filter((c) => c.state === "unchanged");
      const away = copies.filter((c) => c.state === "not-here");
      if (!same2.length) return skip2(`${names3(away)} came from ${away.length === 1 ? "a file that isn't" : "files that aren't"} on this machine.`);
      const edited = same2.filter((c) => c.edited);
      return pass2([
        `${names3(same2)}: unchanged at ${same2.length === 1 ? "its source" : "their sources"}.`,
        ...edited.length ? [`${names3(edited)} ${edited.length === 1 ? "was" : "were"} edited here, as a copy may be.`] : [],
        ...away.length ? [`${names3(away)} came from ${away.length === 1 ? "a file that isn't" : "files that aren't"} on this machine.`] : []
      ].join(" "));
    }
  },
  {
    id: "B1.orgs",
    part: "project",
    group: "B1",
    title: "Every org is listed",
    profiles: ["salesforce"],
    why: "Pipelines differ by client, so the config lists every sandbox Production has, with its type (D-018).",
    fix: { command: "acc init --force" },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const prod = ctx.config.environments.find((e) => e.type === "production");
      if (!prod) return fail2("There's no Production environment.");
      if (!prod.org) return fail2("Production has no org alias.");
      const q2 = sfJson(ctx, ["data", "query", "--use-tooling-api", "-q", "SELECT SandboxName, LicenseType FROM SandboxInfo", "-o", prod.org]);
      if (q2.status !== 0) return unknown(`Couldn't read Production's sandbox list: ${q2.message ?? "sf failed"}`);
      const records = q2.result?.records ?? [];
      const problems = [];
      const listed2 = [];
      for (const r of records) {
        const env = ctx.config.environments.find((e) => e.branch === branchFor(r.SandboxName));
        const type = LICENSE_TO_TYPE[r.LicenseType] ?? r.LicenseType.toLowerCase();
        if (!env) problems.push(`${r.SandboxName} (${type}) isn't in the config.`);
        else if (env.type !== type) problems.push(`${env.name} is ${type} in Salesforce but "${env.type}" in the config.`);
        else listed2.push(`${env.branch} (${type})`);
      }
      const known = new Set(records.map((r) => branchFor(r.SandboxName)));
      for (const e of ctx.config.environments) {
        if (e.type !== "production" && e.type !== "none" && !known.has(e.branch)) problems.push(`${e.name} is in the config but not in Production's sandbox list.`);
      }
      return problems.length ? fail2(problems.join(" ")) : pass2(`All ${records.length} sandboxes are listed: ${listed2.join(", ")}`);
    }
  },
  {
    id: "B2.identity",
    part: "project",
    group: "B2",
    title: "Commit identity",
    why: "Commits in this repo carry its own name and email, set in the repo only.",
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const want = ctx.config.commitIdentity;
      if (!want) return skip2("No commitIdentity in the config.");
      const get = (k2) => ctx.run("git", ["config", "--local", "--get", k2], { cwd: ctx.paths.root }).stdout.trim();
      const name = get("user.name");
      const email = get("user.email");
      if (name === want.name && email === want.email) return pass2(`${name} <${email}>`);
      return fail2(
        `Commits would be ${name || "(no name)"} <${email || "no email"}>, not ${want.name} <${want.email}>.`,
        `git config user.name "${want.name}" && git config user.email "${want.email}"`
      );
    }
  },
  {
    id: "B2.account",
    part: "project",
    group: "B2",
    title: "The repo's GitHub account is logged in",
    why: "acc runs every gh call for this repo as its own account (D-007).",
    fix: { vscode: "acc.github.signIn", text: GH_SIGN_IN },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const account = ctx.config.github?.account;
      if (!account) return skip2("No GitHub account in the config.");
      return ghEnv2(ctx) ? pass2(`gh can act as ${account}`) : fail2(`gh isn't logged in as ${account}.`, `gh auth login   # as ${account}`);
    }
  },
  {
    id: "B2.credentials",
    part: "project",
    group: "B2",
    title: "git pushes as the right account",
    why: "gh's own credential helper ignores the username and uses the active account, so a repo can silently push as the wrong one.",
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const account = ctx.config.github?.account;
      if (!account) return skip2("No GitHub account in the config.");
      const helper = `git config credential.helper '' && git config --add credential.helper '${credentialHelper(ctx.config.github.account)}'`;
      const fill = ctx.run("git", ["credential", "fill"], {
        cwd: ctx.paths.root,
        input: "protocol=https\nhost=github.com\n\n",
        env: { ...ctx.env, GIT_TERMINAL_PROMPT: "0" }
      });
      const token = /^password=(.*)$/m.exec(fill.stdout)?.[1];
      if (fill.code !== 0 || !token) return fail2("git has no GitHub credential for this repo.", helper);
      const who = ctx.run("gh", ["api", "user", "--jq", ".login"], { env: { ...ctx.env, GH_TOKEN: token } });
      const login = who.stdout.trim();
      if (who.code !== 0) return unknown("git returned a credential, but GitHub didn't accept it.");
      return login === account ? pass2(`git pushes as ${login}`) : fail2(`git would push as ${login}, not ${account}.`, helper);
    }
  },
  {
    id: "B3.gitignore",
    part: "project",
    group: "B3",
    title: "Client data blocked at the repo root",
    profiles: ["salesforce"],
    why: "A backstop. The real safeguard is keeping client data in the Working Files folder.",
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const lines = new Set((readText(ctx.paths.root, ".gitignore") ?? "").split("\n").map((l3) => l3.trim()));
      const missing = BACKSTOP.filter((p) => !lines.has(p));
      return missing.length ? fail2(`.gitignore is missing ${missing.join(", ")}.`, `printf '${missing.join("\\n")}\\n' >> .gitignore`) : pass2("CSV, XLS, XLSX and EML are blocked at the root.");
    }
  },
  {
    id: "B3.data-files",
    part: "project",
    group: "B3",
    title: "No client data files in git",
    profiles: ["salesforce"],
    why: "Contact imports and workbooks belong in the Working Files folder, outside the repo.",
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const files = ctx.run("git", ["ls-files"], { cwd: ctx.paths.root }).stdout.split("\n").filter((f) => f && !f.includes("/") && DATA_EXT.test(f));
      return files.length ? fail2(`Tracked data files: ${files.join(", ")}.`, `git rm --cached ${files.map((f) => JSON.stringify(f)).join(" ")}`) : pass2("No data files at the repo root.");
    }
  },
  {
    id: "B3.secrets",
    part: "project",
    group: "B3",
    title: "No credentials in tracked files",
    why: "Org auth URLs, tokens and private keys must never be committed.",
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const scan = ctx.config.secretScan;
      const spec = [...scan.paths, ...scan.exclude.map((x2) => `:(exclude)${x2}`)];
      const r = ctx.run("git", ["grep", "-I", "-l", "-E", SECRET_PATTERN, "--", ...spec], { cwd: ctx.paths.root });
      if (r.code === 1) return pass2(`No credentials found (scanned: ${scan.paths.join(", ")})`);
      if (r.code === 0) return fail2(`Possible credentials in: ${r.stdout.trim().split("\n").join(", ")}.`, "Remove them, rotate the credential, and rewrite history if it was pushed.");
      return unknown(`The scan didn't run: ${r.stderr.trim().split("\n")[0]}`);
    }
  },
  {
    id: "B4.skeleton",
    part: "project",
    group: "B4",
    title: "Salesforce project skeleton",
    profiles: ["salesforce"],
    why: "sfdx-project.json defines the source folders, and local tool state must stay out of git.",
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const sfdx = readText(ctx.paths.root, "sfdx-project.json");
      if (!sfdx) return fail2("There's no sfdx-project.json.");
      const local = ctx.run("git", ["ls-files", ".sf", ".sfdx", ".claude/settings.local.json"], { cwd: ctx.paths.root }).stdout.trim();
      if (local) return fail2(`Local tool state is tracked: ${local.split("\n").join(", ")}.`, "git rm -r --cached .sf .sfdx");
      try {
        const dirs = (JSON.parse(sfdx).packageDirectories ?? []).map((d) => d.path);
        return pass2(`Source in ${dirs.join(", ") || "(none listed)"}`);
      } catch {
        return fail2("sfdx-project.json isn't valid JSON.");
      }
    }
  },
  {
    id: "B5.baseline",
    part: "project",
    group: "B5",
    title: "Baseline manifest",
    profiles: ["salesforce"],
    why: "Every branch is retrieved with the same component list, so a diff between branches is real drift.",
    fix: { command: "acc setup baseline", text: '"Do it" lists the components on every environment branch with sf, and writes the union to manifest/baseline-package.xml. Commit it on each branch.', docs: `${DOCS}#b5-make-one-baseline-manifest-for-every-environment` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const xml = readText(ctx.paths.root, "manifest/baseline-package.xml");
      if (!xml) return fail2("There's no manifest/baseline-package.xml.");
      const members = (xml.match(/<members>/g) ?? []).length;
      return members ? pass2(`${members} components`) : fail2("manifest/baseline-package.xml lists no components.");
    }
  },
  {
    id: "B6.branches",
    part: "project",
    group: "B6",
    title: "A branch for every environment",
    why: "Each environment has its own branch, named after it (D-015).",
    fix: { command: "acc setup branches", text: `"Do it" makes each missing branch: production's from this checkout, then each sandbox's from it, each retrieved from its own org (read only). Nothing is pushed until you push it.`, docs: `${DOCS}#b6-create-a-branch-per-environment-named-after-it-and-seed-each-from-its-org` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const has = (ref) => ctx.run("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: ctx.paths.root }).code === 0;
      const missing = ctx.config.environments.filter((e) => !has(`refs/heads/${e.branch}`) && !has(`refs/remotes/origin/${e.branch}`)).map((e) => e.branch);
      return missing.length ? fail2(`No branch for ${missing.join(", ")}.`) : pass2(ctx.config.environments.map((e) => e.branch).join(", "));
    }
  },
  {
    id: "B6.org-match",
    part: "project",
    group: "B6",
    title: "Each branch points at the right org",
    profiles: ["salesforce"],
    why: "A sandbox's name is in its URL, so the tool can prove a branch deploys where its name says (D-015).",
    fix: { vscode: "acc.sf.login", text: `"Do it" checks each environment's org, lists the ones that need a login first, and opens Salesforce's login for the one you pick, at the URL its name implies. Nothing to type: you sign in in the browser.` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const problems = [];
      const ok = [];
      for (const e of sfEnvs(ctx)) {
        if (!e.org) {
          problems.push(`${e.name} has no org alias.`);
          continue;
        }
        const d = sfJson(ctx, ["org", "display", "-o", e.org]);
        if (d.status !== 0) {
          problems.push(`"${e.org}" isn't logged in (${d.message ?? "sf failed"}).`);
          continue;
        }
        const url = parseOrgUrl(String(d.result?.instanceUrl ?? ""));
        if (e.type === "production") {
          if (url.kind !== "production") problems.push(`"${e.org}" isn't a Production org.`);
          else ok.push(`${e.branch} \u2192 ${url.domain}`);
        } else if (url.kind !== "sandbox") problems.push(`"${e.org}" isn't a sandbox.`);
        else if (url.sandbox !== e.branch) problems.push(`"${e.org}" is the "${url.sandbox}" sandbox, but its branch is "${e.branch}".`);
        else ok.push(`${e.branch} \u2192 ${url.domain}--${url.sandbox}`);
      }
      return problems.length ? fail2(problems.join(" "), 'sf org login web --alias "<alias>" --instance-url <My Domain URL>') : pass2(ok.join(", "));
    }
  },
  {
    id: "B8.tracking",
    part: "project",
    group: "B8",
    title: "Developer sandboxes are source tracked",
    profiles: ["salesforce"],
    why: "A Developer sandbox is tracked only if tracking was on when it was created, or switched on inside it afterwards.",
    fix: {
      text: "Log in to the sandbox: Setup \u2192 Sandbox Settings \u2192 Enable Source Tracking in This Sandbox.",
      setupPath: "/lightning/setup/SetupOneHome/home",
      docs: "https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-setup-enable-source-tracking-sandboxes.html"
    },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      if (!usesSourceTracking(ctx.config)) return skip2(NO_TRACKING_REASON);
      const envs = devEnvs(ctx);
      if (!envs.length) return skip2("No Developer sandboxes in this project.");
      const off = envs.filter((e) => sfJson(ctx, ["data", "query", "--use-tooling-api", "-q", "SELECT COUNT() FROM SourceMember", "-o", e.org]).status !== 0);
      return off.length ? fail2(`Not tracked: ${off.map((e) => e.name).join(", ")}.`) : pass2(`Tracked: ${envs.map((e) => e.name).join(", ")}`);
    }
  },
  {
    id: "B8.cli-tracking",
    part: "project",
    group: "B8",
    title: "The CLI knows they're tracked",
    profiles: ["salesforce"],
    why: "An org logged in before tracking was switched on is remembered as untracked.",
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      if (!usesSourceTracking(ctx.config)) return skip2(NO_TRACKING_REASON);
      const envs = devEnvs(ctx);
      if (!envs.length) return skip2("No Developer sandboxes in this project.");
      const list = sfJson(ctx, ["org", "list"]);
      if (list.status !== 0) return unknown(`Couldn't list orgs: ${list.message ?? "sf failed"}`);
      const all = Object.values(list.result ?? {}).filter(Array.isArray).flat();
      const off = envs.filter((e) => !all.some((o) => o.alias === e.org && o.tracksSource === true));
      return off.length ? fail2(`The CLI treats ${off.map((e) => `"${e.org}"`).join(", ")} as untracked.`, off.map((e) => `sf org enable tracking -o "${e.org}"`).join(" && ")) : pass2("The CLI tracks source for every Developer sandbox.");
    }
  },
  {
    id: "B9.lists",
    part: "project",
    group: "B9",
    title: "Environment-specific and known-drift lists",
    profiles: ["salesforce"],
    why: "Environment config is never promoted or deployed (D-016), and drift checks need to know what differs by design.",
    fix: { command: "acc setup lists", text: `"Do it" drafts both lists from how each sandbox's branch differs from production's, and names the differences neither explains. It never overwrites a list you have.`, docs: `${DOCS}#b9-sort-out-the-environment-specific-differences` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const problems = [];
      const counts = [];
      for (const [label, rel] of [["environment-specific", ctx.config.environmentSpecific], ["known-drift", ctx.config.knownDrift]]) {
        if (!rel) {
          problems.push(`No ${label} list in the config.`);
          continue;
        }
        const text = readText(ctx.paths.root, rel);
        if (text === null) {
          problems.push(`${rel} doesn't exist.`);
          continue;
        }
        const lines = text.replace(/\n$/, "").split("\n");
        if (lines.some((l3) => l3.trim() === "")) problems.push(`${rel} has a blank line. As a grep pattern, that matches everything.`);
        const paths = lines.filter((l3) => l3.trim() && !l3.startsWith("#"));
        const here = paths.filter((p) => !existsSync25(join36(ctx.paths.root, p)));
        const elsewhere = here.length ? filesOnEnvironmentBranches(ctx) : /* @__PURE__ */ new Set();
        const gone = here.filter((p) => !elsewhere.has(p));
        if (gone.length) problems.push(`${rel} lists files that don't exist: ${gone.slice(0, 3).join(", ")}${gone.length > 3 ? " \u2026" : ""}.`);
        counts.push(`${paths.length} ${label}`);
      }
      return problems.length ? fail2(problems.join(" ")) : pass2(counts.join(", "));
    }
  },
  {
    id: "B10.default-branch",
    part: "project",
    group: "B10",
    title: "GitHub's default branch is the day-to-day one",
    why: "New pull requests then target day-to-day work, not a protected environment.",
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const gh = ctx.config.github;
      if (!gh) return skip2("No GitHub repo in the config.");
      const env = ghEnv2(ctx);
      if (!env) return unknown(`gh isn't logged in as ${gh.account}.`);
      const want = ctx.config.environments.find((e) => e.default).branch;
      const r = ctx.run("gh", ["api", `repos/${gh.repo}`, "--jq", ".default_branch"], { env });
      if (r.code !== 0) return unknown(`Couldn't read ${gh.repo}: ${r.stderr.trim().split("\n")[0]}`);
      const got = r.stdout.trim();
      return got === want ? pass2(`${gh.repo} defaults to ${got}`) : fail2(`${gh.repo} defaults to ${got}, not ${want}.`, `gh repo edit ${gh.repo} --default-branch ${want}`);
    }
  },
  {
    id: "B10.default-org",
    part: "project",
    group: "B10",
    title: "The local default org is the day-to-day one",
    profiles: ["salesforce"],
    why: "A deploy without --target-org then can't reach Production.",
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const want = ctx.config.environments.find((e) => e.default).org;
      if (!want) return fail2("The default environment has no org alias.");
      let got;
      try {
        got = JSON.parse(readText(ctx.paths.root, ".sf/config.json") ?? "{}")["target-org"];
      } catch {
        got = void 0;
      }
      return got === want ? pass2(`Default org: ${got}`) : fail2(`The default org is ${got ? `"${got}"` : "not set"}, not "${want}".`, `sf config set target-org "${want}"`);
    }
  },
  {
    id: "B10.ignore-worktrees",
    part: "project",
    group: "B10",
    title: "Task worktrees are git-ignored",
    why: "Task worktrees live in .claude/worktrees/ inside the repo (D-022). Ignoring it keeps them out of your main checkout's changes and out of VSCode search.",
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const r = ctx.run("git", ["check-ignore", "-q", ".claude/worktrees/probe"], { cwd: ctx.paths.root });
      return r.code === 0 ? pass2(".claude/worktrees/ is ignored.") : fail2(".claude/worktrees/ isn't in .gitignore.", "printf '.claude/worktrees/\\n' >> .gitignore");
    }
  },
  {
    id: "B10.readme",
    part: "project",
    group: "B10",
    title: "README names every environment",
    why: "Anyone opening the repo sees which branch is which org, and how changes flow.",
    fix: { command: "acc setup readme", text: '"Do it" writes the environments table and promotion flow between markers in README.md, leaving the rest as it is. Run it again after changing the environments.' },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const places = readmePlaces(ctx.config);
      const map = ctx.config.environments.length >= 2;
      if (!map && !places.length) return skip2("Only one environment, so there's no map to document.");
      const text = readText(ctx.paths.root, "README.md");
      if (!text) return fail2("There's no README.md.");
      const missing = map ? ctx.config.environments.filter((e) => !text.includes(`\`${e.branch}\``)).map((e) => e.branch) : [];
      if (missing.length) return fail2(`README.md doesn't mention ${missing.join(", ")}.`);
      const unnamed = places.filter((p) => !p.needs.every((n) => text.includes(n)));
      if (unnamed.length) return fail2(`README.md doesn't link ${orList(unnamed.map((p) => p.words))}, where this repo's tickets come from.`);
      return pass2(map ? `Every environment is in the README${places.length ? ", and where its tickets come from" : ""}.` : "The README says where this repo's tickets come from.");
    }
  },
  {
    id: "B12.trust",
    part: "project",
    group: "B12",
    title: "Claude Code trusts the repo for background agents",
    why: "Background agents start in the main checkout, and Claude Code only starts one in a folder you've trusted. VSCode's own Claude sessions don't record this, so it takes one run of claude in a terminal.",
    fix: { command: "claude", text: 'In the terminal that opens, accept the "trust this folder" prompt, then type /exit.' },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      let main2 = ctx.paths.root;
      try {
        main2 = mainCheckout(ctx.run, ctx.paths.root);
      } catch {
      }
      return isTrusted(main2, ctx.env) ? pass2(`Trusted: ${main2}`) : fail2(`Claude Code hasn't been trusted in ${main2} yet.`, "claude   # then accept the trust prompt and type /exit");
    }
  },
  {
    id: "B13.gate-tools",
    part: "project",
    group: "B13",
    title: "The required checks can run",
    why: "acc done waits for every required check to pass, and a check whose tool is missing can only report an error.",
    fix: { fromCheck: true, docs: `${DOCS}#b13-make-sure-the-checks-can-run` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const config = ctx.config;
      const required = fullGates(config);
      if (!required.length) return skip2('No checks are required ("gates.required" is empty, and "strayFiles.required" is false).');
      const defined = gatesFor(config).map((g) => g.name);
      const undefinedGates = required.filter((n) => !defined.includes(n));
      if (undefinedGates.length) return fail2(`Required, but with no command: ${undefinedGates.join(", ")}. Give each one under "gates.commands", or "gates.ratchets" for a number that may only get better, in .acc/config.json.`);
      const builderOnly = (config.gates.builder ?? []).filter((n) => !defined.includes(n));
      if (builderOnly.length) return fail2(`Listed for builders, but with no command: ${builderOnly.join(", ")}. Give each one under "gates.commands", or "gates.ratchets" for a number that may only get better, in .acc/config.json.`);
      let main2 = ctx.paths.root;
      try {
        main2 = mainCheckout(ctx.run, ctx.paths.root);
      } catch {
      }
      const TOOLS = { format: "prettier", lint: "eslint", "lwc-tests": "sfdx-lwc-jest" };
      const absent = config.profile !== "salesforce" ? [] : required.filter((n) => TOOLS[n] && !config.gates.commands[n] && !existsSync25(join36(main2, "node_modules", ".bin", TOOLS[n]))).map((n) => TOOLS[n]);
      if (absent.length) return fail2(`Not installed in ${main2}: ${absent.join(", ")}.`, `cd "${main2}" && npm install`);
      return pass2(`Ready: ${required.join(", ")}.`);
    }
  },
  // The tools the project's own checks need (T-68): in their own file, registered here.
  ...TOOL_STEPS,
  {
    id: "B14.tickets",
    part: "project",
    group: "B14",
    title: "The repo's ticket source",
    why: "The Tasks board shows this repo's own tickets: a Jira project, an Azure DevOps board, a monday.com board or GitHub Issues, signed in on this machine for this repo, or for every project on the same site. If this repo keeps its tasks in acc alone, mark this done.",
    fix: {
      vscode: "acc.trackers.add",
      confirm: true,
      text: `"Do it" opens the Connect page in the Command Center: pick Jira, GitHub Issues, Azure DevOps or monday.com, sign in and test the connection, then pick the project or board, which of its tickets are this repo's (an epic, labels, an area path or a group, or the whole of it) and the board's columns. Save writes them to this repo's .acc/config.json.`,
      docs: `${DOCS}#b14-connect-the-ticket-source`
    },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const list = ctx.config.trackers;
      if (!list.length) return unknown("No ticket source yet, so tasks come from acc alone. Add one, or mark this done if that's how this repo works.");
      const names3 = list.map((t) => t.kind === "github" ? `GitHub Issues${t.repo ? ` (${t.repo})` : ""}${t.labels.length ? ` labelled ${orList(t.labels)}` : ""}` : t.kind === "jira" ? `Jira ${t.project} on ${t.site}${t.epic ? `, epic ${t.epic}` : ""}` : t.kind === "monday" ? `monday.com board ${t.board} in ${t.account}${t.group ? `, group ${t.group}` : ""}` : `Azure DevOps ${t.project} in ${t.organization}${t.areaPath ? `, area ${t.areaPath}` : ""}`);
      return pass2(`Tickets come from ${names3.join(" and ")}.`);
    }
  },
  // Cloud builders (GH-69), only where the project opted in: in their own file, registered here.
  ...CLOUD_STEPS,
  {
    id: "B11.drift",
    part: "project",
    group: "B11",
    title: "The day-to-day org matches its branch",
    profiles: ["salesforce"],
    why: "A change made straight in an org is lost the next time its branch is deployed there. A drift check finds it first.",
    fix: { fromCheck: true, docs: `${DOCS}#b11-drift-check-any-time` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const env = ctx.config.environments.find((e) => e.default);
      if (!env.org) return skip2(`${env.name} has no org.`);
      const cmd = `acc drift ${env.branch}`;
      let report = null;
      try {
        report = JSON.parse(readFileSync35(driftReportPath(ctx.paths, env.branch), "utf8"));
      } catch {
        report = null;
      }
      if (!report) return { status: "unknown", detail: `${env.org} hasn't been compared with ${env.branch} yet. It takes a few minutes and only reads the org.`, fix: cmd };
      const days = Math.floor((Date.now() - Date.parse(report.checkedAt)) / 864e5);
      const when2 = days < 1 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
      const found = report.changed.length + report.added.length + (report.missing?.length ?? 0);
      if (found) return fail2(`${env.org} had ${found} difference${found === 1 ? "" : "s"} from ${env.branch} when checked ${when2}. Look with: ${cmd} --keep`, cmd);
      if (days > 14) return { status: "unknown", detail: `${env.org} matched ${env.branch} ${when2}. Check again; orgs change.`, fix: cmd };
      return pass2(`${env.org} matched ${env.branch} ${when2}${report.ignored ? `, apart from ${report.ignored} expected differences` : ""}.`);
    }
  }
];
function applies(step, ctx) {
  if (!step.profiles) return true;
  if (!ctx.config) return step.part === "machine";
  return step.profiles.includes(ctx.config.profile);
}
function runSteps(ctx, part, only) {
  return STEPS.filter((s) => (!part || s.part === part) && (!only?.length || only.includes(s.id)) && applies(s, ctx)).map((step) => {
    try {
      return { step, result: step.check(ctx) };
    } catch (e) {
      return { step, result: unknown(`The check failed to run: ${e.message}`) };
    }
  });
}

// packages/cli/src/format.ts
var useColor = () => !process.env.NO_COLOR && !!process.stdout.isTTY;
var TONES = { orange: "\x1B[38;5;208m", blue: "\x1B[38;5;33m", neutral: "", dim: "\x1B[2m" };
function tone(text, t) {
  if (!useColor() || !TONES[t]) return text;
  return `${TONES[t]}${text}\x1B[0m`;
}
function stateLabel(s) {
  const d = DISPLAY[s];
  return tone(`${d.glyph} ${d.label}`, d.tone);
}
var CHECK = {
  pass: { glyph: "\u2713", label: "pass", tone: "blue" },
  fail: { glyph: "\u2717", label: "fail", tone: "orange" },
  unknown: { glyph: "?", label: "check by hand", tone: "orange" },
  skip: { glyph: "\u2013", label: "skip", tone: "dim" }
};
var LABEL_WIDTH = Math.max(...Object.values(CHECK).map((c) => c.label.length)) + 2;
function checkLabel(s) {
  const c = CHECK[s];
  return tone(`${c.glyph} ${c.label}`.padEnd(LABEL_WIDTH), c.tone);
}
function table(rows) {
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const widths = rows[0]?.map((_2, i) => Math.max(...rows.map((r) => strip(r[i] ?? "").length))) ?? [];
  return rows.map((r) => r.map((c, i) => i === r.length - 1 ? c : c + " ".repeat((widths[i] ?? 0) - strip(c).length)).join("  ")).join("\n");
}
var GATE = {
  pass: { glyph: "\u2713", label: "pass", tone: "blue" },
  fail: { glyph: "\u2717", label: "fail", tone: "orange" },
  error: { glyph: "!", label: "error", tone: "orange" },
  skip: { glyph: "\u2013", label: "skip", tone: "dim" },
  // It ran, but ran no tests or skipped more than before: a person decides (GH-100).
  hold: { glyph: "?", label: "needs a person", tone: "orange" }
};
var GATE_WIDTH = Math.max(...Object.values(GATE).map((c) => `${c.glyph} ${c.label}`.length)) + 2;
function gateLabel(s) {
  const c = GATE[s];
  return tone(`${c.glyph} ${c.label}`.padEnd(GATE_WIDTH), c.tone);
}

// packages/cli/src/shared.ts
import { readFileSync as readFileSync36, realpathSync as realpathSync6 } from "node:fs";
import { dirname as dirname14 } from "node:path";

// package.json
var package_default = { version: "0.42.0" };

// packages/cli/src/shared.ts
var VERSION = package_default.version;
var now = () => /* @__PURE__ */ new Date();
var current = NO_STEPS;
var steps = () => current;
function openSteps(env = process.env) {
  current = stepsFrom(env);
  delete env[STEPS_VAR];
  return current;
}
var READ_ERRORS = {
  ENOENT: "there's no such file",
  EISDIR: "it's a folder",
  EACCES: "it isn't readable",
  ENAMETOOLONG: "the name is too long",
  ENOTDIR: "part of the path isn't a folder"
};
function readFileArg(file) {
  try {
    return readFileSync36(file, "utf8");
  } catch (e) {
    const code2 = e.code ?? "";
    const why = READ_ERRORS[code2] ?? e.message;
    const name = file === 0 ? "stdin" : file.length > 120 ? `${file.slice(0, 119)}\u2026` : file;
    throw new AccError("usage", `Can't read ${name}: ${why}.`);
  }
}
function out(o, human, data) {
  if (o.json) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else process.stdout.write(human() + "\n");
}
function project(cwd) {
  const paths = repoPaths(cwd, run);
  const { config: loaded, warnings } = loadConfig(paths.config);
  for (const w of warnings) process.stderr.write(`warning: ${w}
`);
  return { paths, config: withCloneAgents(withCloneAccount(loaded, paths.root, run), paths.root, run) };
}
function followingCards(paths, config, fn2) {
  const before = closesIssues(config) ? new Map(readLedger(paths.ledger).tasks.map((t) => [t.id, t.history.length])) : null;
  const result = fn2();
  if (!before) return result;
  try {
    const moved = readLedger(paths.ledger).tasks.filter((t) => before.has(t.id) && t.history.length > before.get(t.id)).map((t) => t.id);
    for (const r of followCards(paths, config, moved, { run, now, env: process.env })) {
      if (r.outcome === "failed") process.stderr.write(tone(`! ${cardWords(r)}`, "orange") + "\n");
    }
  } catch (e) {
    process.stderr.write(tone(`! Couldn't move the cards of the tasks this moved on their GitHub Project: ${e.message}`, "orange") + "\n");
  }
  return result;
}
function actorFrom(o) {
  const role = o.as || process.env.ACC_ROLE || "human";
  if (!ACTORS.includes(role)) throw new AccError("usage", `--as must be one of ${ACTORS.join(", ")}.`);
  const by = o.by ?? (role === "builder" && process.env.ACC_TASK ? `builder:${process.env.ACC_TASK}` : `${role}:${process.env.USER ?? "unknown"}`);
  return { actor: role, by };
}
function taskIdFrom(arg) {
  const id = arg ?? process.env.ACC_TASK;
  if (!id) throw new AccError("usage", "Name the task, for example: acc done GH-12. Builders get it from ACC_TASK.");
  return id;
}
var accBinDir = () => {
  try {
    return dirname14(realpathSync6(process.argv[1]));
  } catch {
    return dirname14(process.argv[1] ?? ".");
  }
};
var shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
var accCommand = () => {
  let script = process.argv[1] ?? "";
  try {
    script = realpathSync6(script);
  } catch {
  }
  return `${process.versions.electron ? "ELECTRON_RUN_AS_NODE=1 " : ""}${shellQuote(process.execPath)} ${shellQuote(script)}`;
};
var STEP_WORD = { review: "review", land: "land", dispatch: "re-dispatch", refresh: "update", resume: "resume", checks: "send back", merge: "merge", start: "start", queue: "take" };
var stepWords = (step, sha) => {
  if (step === "checks") return `send ${sha.slice(0, 7) || "it"} back for its failing checks`;
  if (step === "queue") return `take ${sha.slice(0, 7) || "it"} through the merge queue`;
  if (step === "start") return "start it";
  const what = [STEP_WORD[step], sha.slice(0, 7)].filter(Boolean).join(" ");
  return step === "refresh" ? `${what} from its base` : what;
};
function personOnly(o, what) {
  const role = process.env.ACC_ROLE;
  if (role === "builder" || role === "reviewer") throw new AccError("refused", `A ${role} can't ${what}. A person does that.`);
  const { actor, by } = actorFrom(o);
  if (actor !== "human") throw new AccError("refused", `Only a person can ${what}.`);
  return by;
}
function noAgent(o, what) {
  const role = process.env.ACC_ROLE;
  if (role === "builder" || role === "reviewer" || role === "analyst") throw new AccError("refused", `${role === "analyst" ? "An" : "A"} ${role} can't ${what}. A person does that.`);
  return personOnly(o, what);
}

// packages/cli/src/commands/tasks.ts
function readInput(file) {
  const text = readFileArg(file ?? 0);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new AccError("usage", `The input isn't valid JSON: ${e.message}`);
  }
}
var upsertLines = (res) => [
  res.added.length ? `Added ${res.added.join(", ")}` : "",
  res.updated.length ? `Updated ${res.updated.join(", ")}` : "",
  res.unchanged.length ? `Unchanged ${res.unchanged.join(", ")}` : "",
  ...res.errors.map((e) => tone(`\u2717 ${e}`, "orange"))
];
function upsert(o, inputs, own = false) {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const held = own ? ownTickets(config, inputs) : { inputs, refused: [] };
  const res = mutate(paths, now, (ledger, emit) => upsertTasks(ledger, config, held.inputs, actor, by, emit, now));
  res.errors.push(...held.refused);
  out(o, () => upsertLines(res).filter(Boolean).join("\n") || "Nothing to do.", res);
  return res.errors.length ? 1 : 0;
}
function ownTickets(config, inputs) {
  if (!config.trackers.length) return { inputs, refused: [] };
  const refused = [];
  const kept = inputs.filter((i) => {
    const kind = i?.source?.kind;
    const key = i?.source?.key;
    if (!isSignedInKind(kind) || typeof key !== "string") return true;
    const at2 = trackerForKey(config.trackers, key);
    if (at2 !== null && config.trackers[at2].kind === kind) return true;
    refused.push(`${key.toUpperCase()}: no ${trackerName(kind)} tracker in .acc/config.json owns it, so it isn't one of this repo's tickets.`);
    return false;
  });
  return { inputs: kept, refused };
}
var intakeLines = (res) => {
  const skipped = res.removed.filter((id) => !res.left.includes(id));
  return [
    res.closed.length ? `Done ${res.closed.join(", ")}: closed on GitHub before work started` : "",
    skipped.length ? `Removed ${skipped.join(", ")}: their issues have a label in skipLabels` : "",
    res.left.length ? `Removed ${res.left.join(", ")}: their tickets left this repo's place before work started` : "",
    ...res.leftAlone.map((l3) => tone(`! ${l3.note}`, "orange"))
  ];
};
function cmdIntakeGithub(o) {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const res = followingCards(paths, config, () => intakeGithub(paths, config, { run, now, env: process.env }, { label: o.label?.at(-1), actor, by }));
  out(o, () => [...upsertLines(res), ...intakeLines(res)].filter(Boolean).join("\n") || "Nothing to do.", res);
  return res.errors.length ? 1 : 0;
}
var SIGNED_IN_KINDS = TRACKER_KINDS.filter((k2) => k2 !== "github");
var isSignedInKind = (k2) => SIGNED_IN_KINDS.includes(k2);
function cmdIntakeOutside(o, kind) {
  const file = o.file;
  if (!file) throw new AccError("usage", `acc intake ${kind} --file <report.json>, with { "outside": [{ "key": "ACME-7", "why": "it isn't in epic ACME-3" }] }. The Command Center writes it after a board loads.`);
  const data = readInput(file);
  const list = data?.outside;
  if (!Array.isArray(list) || !list.every((x2) => typeof x2?.key === "string" && typeof x2?.why === "string")) {
    throw new AccError("usage", `${file} must hold { "outside": [{ "key": "<ticket key>", "why": "<why it's outside>" }] }.`);
  }
  const sprint = data.sprint;
  if (sprint !== void 0 && (kind !== "jira" || typeof sprint?.tracker !== "string" || !isSprintSeen(sprint.seen))) {
    throw new AccError("usage", `${file}'s "sprint" must be { "tracker": "<which>", "seen": { "sprints": [{ "id", "name" }], "open": ["<key>"], "at": "<time>" } }, and only for Jira.`);
  }
  const { paths } = project(process.cwd());
  const res = intakeOutside(paths, kind, list, now);
  if (sprint) rememberSprint(paths, sprint.tracker, sprint.seen);
  out(o, () => intakeLines(res).filter(Boolean).join("\n") || "Nothing to do.", res);
  return 0;
}
function cmdList(o, onlyReady) {
  const { paths, config } = project(process.cwd());
  const ledger = readLedger(paths.ledger);
  const want = o.state;
  const tasks = ledger.tasks.filter((t) => onlyReady ? isReady(ledger, t) : !want || t.state === want || displayState(ledger, t, void 0, config) === want);
  out(o, () => {
    if (!tasks.length) return onlyReady ? "Nothing is ready." : "No tasks.";
    return table([["Id", "State", "Env", "Title", "Waiting on"], ...tasks.map((t) => [
      t.id,
      stateLabel(displayState(ledger, t, void 0, config)),
      t.environment,
      t.title,
      t.deps.filter((d) => ledger.tasks.find((x2) => x2.id === d)?.state !== "done").join(", ")
    ])]);
  }, tasks.map((t) => ({ ...t, display: displayState(ledger, t, void 0, config), ready: isReady(ledger, t) })));
  return 0;
}
function cmdStatus(o) {
  const { paths, config } = project(process.cwd());
  const ledger = readLedger(paths.ledger);
  const counts = { running: 0, "needs-you": 0, review: 0, rework: 0, blocked: 0, ready: 0, todo: 0, done: 0 };
  for (const t of ledger.tasks) counts[displayState(ledger, t, void 0, config)]++;
  out(o, () => {
    const parts = Object.keys(counts).filter((s) => s !== "done" && counts[s] > 0).map((s) => tone(`${counts[s]} ${DISPLAY[s].label.toLowerCase()}`, DISPLAY[s].tone));
    return parts.length ? parts.join(" \xB7 ") : "Nothing in play.";
  }, { counts });
  return 0;
}
function fileLines(paths, config, ledger, t) {
  const analysis = readAnalysis(paths, t.id);
  const planned = plannedFiles(analysis, paths.root);
  const look2 = planned ? startLook(paths, config, ledger, run, t.id, { files: planned }) : { shares: [], first: [] };
  const held = t.held;
  const lines = [];
  if (held?.failed) lines.push(tone(`! Its start failed: ${held.failed.reason} Dispatch it again, or stop it waiting: acc dispatch ${t.id} --stop-waiting`, "orange"));
  else if (held && waits(look2)) lines.push(tone(`${holdWords(look2)}. It starts on its own once they're free, or: acc dispatch ${t.id} --anyway`, "blue"));
  else if (held) lines.push(tone(`It waited for ${filesOf(held.waitsFor)}, and may start now: the Command Center or autopilot starts it, or: acc dispatch --held`, "blue"));
  else if (!planned) lines.push(tone(`Its files aren't known: ${analysis ? "its analysis names no files" : "it has no analysis"}, so it never waits for another task's.`, "dim"));
  else if (look2.shares.length) lines.push(tone(`${sharesWords(look2.shares)}.`, "dim"));
  return { lines, data: { known: !!planned, planned: planned ?? [], ...look2 } };
}
function noteShown(t) {
  const { note, fromLast, missing } = shownNote(t);
  if (!note) return missing ? [tone(fromLast ? "Its last run left no note." : "Its builder left no note.", "orange"), ""] : [];
  const parts = ["landed", "moved", "open"].flatMap((k2) => [`  ${NOTE_LABELS[k2]}:`, ...note[k2].length ? note[k2].map((l3) => `    - ${l3}`) : ["    none"]]);
  return [`Builder's note${fromLast ? ", from its last run" : ""} (${note.by}, ${note.ended === "blocked" ? "blocked" : "to review"} ${note.at}):`, ...parts, ""];
}
function cmdShow(o, id) {
  const { paths, config } = project(process.cwd());
  const ledger = readLedger(paths.ledger);
  const t = ledger.tasks.find((x2) => x2.id === id.toUpperCase());
  if (!t) throw new AccError("no-task", `No task ${id}.`);
  const failed = autopilotFailure(t);
  const closed = closedPr(t);
  const card = cardFailure(t)?.replace(/[.\s]+$/, "");
  const checks = failedChecks(t);
  const place2 = queuePlaces(ledger, config).find((p) => p.id === t.id);
  const stopped = t.state === "running" && builderStopped(t, listSessions(run, paths.root), { resuming: !!resuming(paths, t.id), now: now() });
  const said2 = stopped && t.run?.sessionId ? lastSaid(claudeProjectsDir(), t.run.sessionId, [t.run.worktree, paths.root]) : null;
  const quote = said2 ? clipSaid(said2, 600) : null;
  const files = t.state === "todo" ? fileLines(paths, config, ledger, t) : { lines: [], data: null };
  const flying = new Set(inFlight(ledger).map((x2) => x2.id));
  const shared = (t.run?.shares ?? []).filter((s) => flying.has(s.task));
  const cloud = t.run?.where === "cloud" ? t.run.cloud ?? null : null;
  const waiting = cloudWait(t, config, now());
  const wording = readAnalysis(paths, t.id)?.wording ?? [];
  out(o, () => [
    `${t.id}  ${stateLabel(displayState(ledger, t, { stopped, quiet: !!waiting }, config))}  ${t.title}`,
    `Environment: ${t.environment}   Source: ${t.source.kind}${t.source.url ? ` ${t.source.url}` : ""}`,
    t.run?.name ? `Agent: ${t.run.name}${t.run.where ? ` \xB7 runs on ${BUILDER_PLACE_LOOK[t.run.where].label}` : ""}` : "",
    cloud ? `Cloud session: ${cloud.url}${t.state === "running" ? ` (branch last moved ${cloud.lastPushAt}${cloud.finished ? ", finished" : ""})` : ""}` : "",
    waiting ? tone(`! ${waiting.charAt(0).toUpperCase()}${waiting.slice(1)}. Open the session, or: acc collect ${t.id}`, "orange") : "",
    t.deps.length ? `Depends on: ${t.deps.join(", ")}` : "",
    t.blocker ? `Blocked: ${t.blocker}` : "",
    failed ? tone(`! Autopilot couldn't ${stepWords(failed.step, failed.sha || "it")}: ${failed.reason}`, "orange") : "",
    checks ? tone(`! Checks failed on GitHub: ${checks.join(", ")}`, "orange") : "",
    place2 ? tone(`In the merge queue: ${place2.ahead ? `${ordinal(place2.place)} of ${place2.of}, behind ${place2.ahead}` : place2.phase === "held" ? `first of ${place2.of}, waiting: ${phaseWords(place2.phase, t.environment, place2.why)}` : `first of ${place2.of}: ${phaseWords(place2.phase, t.environment).toLowerCase()}`}.`, "blue") : "",
    card ? tone(`! Its card couldn't move on its GitHub Project: ${card}.`, "orange") : "",
    closed ? tone(`! Pull request #${closed.number} was closed without merging. Reopen it on GitHub and land to update it, or land to open a new one.`, "orange") : "",
    stopped ? tone(`! Its agent stopped: ${quote ?? "its turn ended before acc done or acc block."}${quote && !/[.!?…]$/.test(quote) ? "." : ""} Resume it with acc resume ${t.id}.`, "orange") : "",
    ...files.lines,
    ...wording.length ? [tone(`! ${wordingWords(wording.length)} in its analysis's requirements. They're advice: they never hold a dispatch.`, "orange"), ...wording.flatMap((f) => [`  ${wordingPlace(f)}: ${f.message}${wordingMatch(f) ? ` [${f.match}]` : ""}`, tone(`    ${f.text}`, "dim")])] : [],
    shared.length ? tone(`${sharesWords(shared)}.`, "dim") : "",
    t.brief ? `
${t.brief}
` : "",
    t.notes ? `Notes for the builder:
${t.notes}
` : "",
    ...noteShown(t),
    "History:",
    // Its moves and a person's edits (T-74), in time order.
    ...[
      ...t.history.map((h2) => ({ at: h2.at, line: `  ${h2.at}  ${h2.from ?? "\u2013"} \u2192 ${h2.to}  by ${h2.by}${h2.reason ? `: ${h2.reason}` : ""}${h2.override ? " (override)" : ""}` })),
      ...(t.edits ?? []).map((e) => ({ at: e.at, line: `  ${e.at}  edited its ${editedWords(e.fields)}  by ${e.by}` }))
    ].sort((a2, b) => a2.at.localeCompare(b.at)).map((x2) => x2.line)
  ].filter(Boolean).join("\n"), { ...t, stopped: stopped ? { said: said2 } : null, files: files.data, cloudWait: waiting, wording });
  return 0;
}
function editFrom(o) {
  const list = (v) => v.flatMap((x2) => x2.split(",")).map((x2) => x2.trim()).filter(Boolean);
  return {
    ...o.title !== void 0 ? { title: o.title } : {},
    ...o.brief !== void 0 ? { brief: o.brief } : {},
    ...o.dep !== void 0 ? { deps: list(o.dep) } : {},
    ...o.env !== void 0 ? { environment: o.env } : {},
    ...o.label !== void 0 ? { labels: list(o.label) } : {},
    ...o.notes !== void 0 ? { notes: o.notes } : {}
  };
}
function cmdEdit(o, id) {
  const edit = editFrom(o);
  if (!Object.keys(edit).length) throw new AccError("usage", "acc edit <id> needs a field to change: --title, --brief, --dep, --env, --label or --notes.");
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const { task, changed } = mutate(paths, now, (ledger, emit) => editTask(ledger, config, id.toUpperCase(), edit, actor, by, emit, now));
  out(o, () => changed.length ? `${task.id}: changed its ${editedWords(changed)}.` : `${task.id}: nothing to change, every field was already so.`, { task, changed });
  return 0;
}
function cmdSet(o, id, to, note = null) {
  const client = typeof o.client === "string" ? o.client.trim() : void 0;
  if (o.client !== void 0 && to !== "blocked") throw new AccError("usage", '--client goes with blocking: acc block --client "<question>".');
  if (o.client !== void 0 && !client) throw new AccError("usage", 'acc block --client "<the question, for the client>"');
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const { task, entry } = followingCards(paths, config, () => moveTask(paths, config, id.toUpperCase(), {
    to,
    actor,
    by,
    reason: o.reason ?? (client ? `Waiting on the client: ${client}` : null),
    force: o.force === true,
    note
  }, receiptHooks(paths, config, run), now));
  const update = client ? draftUpdate(paths, task, { event: "blocked", context: { question: client } }, by, now) : null;
  out(o, () => [
    `${task.id}: ${entry.from} \u2192 ${stateLabel(displayState(readLedger(paths.ledger), task, void 0, config))}${entry.override ? " (override recorded)" : ""}`,
    task.run?.note && note ? "  Your note is kept with the run: the reviewer, the next builder and the pull request read it." : "",
    update ? `  Drafted an update for ${update.key} (${update.id}) with your question. A person reads it before it's posted.` : "",
    client && !update ? `  ${task.id} has no ticket to post a question on: a person passes it on.` : ""
  ].filter(Boolean).join("\n"), { task, entry, ...client ? { update } : {} });
  return 0;
}
var area = {
  help: {
    section: "Tasks",
    order: 20,
    lines: `  acc add "<title>"|--title <text> [--brief <text>] [--dep <id>]... [--env <branch>] [--label <l>]... [--key <T-n>]
  acc edit <id> [--title <text>] [--brief <text>] [--dep <id>]... [--env <branch>] [--label <l>]... [--notes <text>]
                                        Change a task's fields, with add's checks. A field left out stays; --dep ""
                                        or --label "" clears the list. Refused while a builder runs or once it's
                                        done. A tracker's ticket owns its title, brief, deps and labels; acc keeps
                                        its environment and its notes for the builder, which intake never changes
  acc import [--file <tasks.json>]      Add or refresh tasks from JSON (stdin by default). A Jira, Azure DevOps or
                                        monday.com key that no tracker in .acc/config.json owns is refused
  acc intake github [--label <l>]       Add or refresh tasks from the open GitHub issues in the repo's place: its
                                        tracker's repo, and its labels if it names some. A task not started yet
                                        leaves the board when its issue closes, has a skipLabels label, or leaves
                                        the place
  acc intake jira|azure|monday|slack --file <report.json>
                                        Follow tickets the Command Center found outside the repo's place, from
                                        { "outside": [{ "key", "why" }] }: a task not started yet leaves the board.
                                        A Jira board in a sprint adds "sprint", which acc keeps as its last
  acc status                            One line: how many tasks are in each state
  acc list [--state <state>]
  acc ready
  acc show <id>
  acc set <id> <state> [--reason <text>] [--force] [--as <actor>] [--by <name>]`
  },
  options: {
    brief: { type: "string" },
    dep: { type: "string", multiple: true },
    env: { type: "string" },
    key: { type: "string" },
    file: { type: "string" },
    state: { type: "string" },
    reason: { type: "string" },
    force: { type: "boolean", default: false },
    label: { type: "string", multiple: true },
    title: { type: "string" },
    notes: { type: "string" },
    client: { type: "string" }
  },
  subcommands: { intake: ["github", ...SIGNED_IN_KINDS] },
  commands: {
    add: (o, rest) => {
      const title = (o.title ?? rest.join(" ")).trim();
      if (!title) throw new AccError("usage", 'acc add "<title>"');
      const labels = (o.label ?? []).map((l3) => l3.trim()).filter(Boolean);
      return upsert(o, [{ source: { kind: "manual", key: o.key ?? null }, title, brief: o.brief, deps: o.dep ?? [], environment: o.env, labels }]);
    },
    edit: (o, rest) => {
      if (!rest[0]) throw new AccError("usage", "acc edit <id> [--title <text>] [--brief <text>] [--dep <id>]... [--env <branch>] [--label <l>]... [--notes <text>]");
      return cmdEdit(o, rest[0]);
    },
    import: (o) => {
      const data = readInput(o.file);
      if (!Array.isArray(data)) throw new AccError("usage", "acc import expects a JSON list of tasks.");
      return upsert(o, data, true);
    },
    intake: (o, rest) => {
      if (rest[0] === "github") return cmdIntakeGithub(o);
      if (isSignedInKind(rest[0])) return cmdIntakeOutside(o, rest[0]);
      throw new AccError("usage", "acc intake github [--label <label>], or acc intake jira|azure|monday|slack --file <report.json>. Jira, Azure DevOps and monday.com tickets come in through the Command Center's Track in acc; Jira and Azure DevOps ones also through the plugin's skill.");
    },
    status: (o) => cmdStatus(o),
    list: (o) => cmdList(o, false),
    ready: (o) => cmdList(o, true),
    show: (o, rest) => {
      if (!rest[0]) throw new AccError("usage", "acc show <id>");
      return cmdShow(o, rest[0]);
    },
    set: (o, rest) => {
      if (!rest[0] || !rest[1]) throw new AccError("usage", "acc set <id> <state> [--reason <text>]");
      return cmdSet(o, rest[0], rest[1]);
    }
  }
};

// packages/cli/src/commands/agents.ts
var buildersOf = (n) => `${n} builder${n === 1 ? "" : "s"}`;
function cmdMachine(o, sub, value) {
  if (sub === "agents") return cmdMachineAgents(o, value);
  if (sub !== "heavy-slots") throw new AccError("usage", "acc machine heavy-slots [<n>] | acc machine agents [<n>|--none]");
  if (value === void 0) {
    const n2 = heavySlots();
    out(o, () => `${n2} heavy check${n2 === 1 ? "" : "s"} at once on this machine${process.env.ACC_HEAVY_SLOTS ? " (from ACC_HEAVY_SLOTS)" : ""}.`, { heavySlots: n2 });
    return 0;
  }
  noAgent(o, "change how many heavy checks this machine runs");
  const n = setHeavySlots(Number(value));
  out(o, () => `This machine now runs ${n} heavy check${n === 1 ? "" : "s"} at once, for every repo on it. Set in ${machineJson()}.`, { heavySlots: n });
  return 0;
}
function cmdMachineAgents(o, value) {
  const show = (max, set) => {
    const repos = machineRepos(process.env, { prune: true }).filter((r) => r.running > 0);
    const running = repos.reduce((n2, r) => n2 + r.running, 0);
    const now2 = `${buildersOf(running)} running now${repos.length > 1 ? `, in ${repos.length} repos` : repos.length ? ` in ${repos[0].project}` : ""}.`;
    out(o, () => [
      max === null ? `${set ? "This machine has no total now" : "No total on this machine"}: each project's cap (agents.max) is the only limit.` : `${set ? "This machine now runs" : "This machine runs"} at most ${buildersOf(max)} at once, across every repo on it.`,
      now2,
      set ? `Set in ${machineJson()}.` : ""
    ].filter(Boolean).join(" "), { agents: max, running, repos });
  };
  if (value === void 0 && o.none !== true) {
    show(machineAgents(), false);
    return 0;
  }
  if (value !== void 0 && o.none === true) throw new AccError("usage", "acc machine agents <n>, or acc machine agents --none: not both.");
  noAgent(o, "change how many builders this machine runs");
  const n = o.none === true ? null : /^\d+$/.test(value) ? Number(value) : NaN;
  show(setMachineAgents(n), true);
  return 0;
}
function cmdAgentsMax(o, configFile, ledgerFile, value) {
  const show = (set) => {
    const { config } = loadConfig(configFile);
    const named = agentsMaxSet(configFile);
    const running = builders(readLedger(ledgerFile), "");
    out(o, () => [
      `${set ? "This project now runs" : "This project runs"} at most ${buildersOf(config.agents.max)} at once (agents.max${named ? ", .acc/config.json" : `, acc's default: .acc/config.json sets none`}).`,
      `${buildersOf(running)} running now.`,
      set ? "Set in .acc/config.json: commit it to share it." : ""
    ].filter(Boolean).join(" "), { max: config.agents.max, from: named ? "project" : "acc", running });
  };
  if (value === void 0) {
    show(false);
    return 0;
  }
  noAgent(o, "change how many builders this project runs");
  setAgentsMax(configFile, /^\d+$/.test(value) ? Number(value) : NaN);
  show(true);
  return 0;
}
function cmdAgents(o, sub, roleArg) {
  const { paths } = project(process.cwd());
  const { config: projectConfig } = loadConfig(paths.config);
  const views = () => Object.fromEntries(AGENT_ROLES.map((r) => [r, profileView(projectConfig, run, paths.root, r)]));
  if (sub === "autonomy") return cmdAutonomy(o, paths.config, roleArg);
  if (sub === "auto-merge") return cmdAutoMerge(o, paths.config, roleArg);
  if (sub === "max") return cmdAgentsMax(o, paths.config, paths.ledger, roleArg);
  if (!sub || sub === "show") {
    const v = views();
    const from = { clone: " (this clone)", project: " (project)", acc: " (acc's default)", default: "" };
    out(o, () => AGENT_ROLES.map((r) => {
      const p = v[r];
      return `${r.padEnd(9)} model ${p.model}${from[p.from.model]}, effort ${p.effort ?? "default"}${from[p.from.effort]}${p.fallbackModel ? `, falls back to ${p.fallbackModel}${from[p.from.fallbackModel]}` : ""}`;
    }).join("\n"), v);
    return 0;
  }
  if (sub !== "set" || !roleArg || !AGENT_ROLES.includes(roleArg)) throw new AccError("usage", "acc agents set <builder|reviewer> [--model <m>] [--effort <e>] [--fallback-model <m>] [--clear <field>] [--project] | acc agents autonomy [manual|review] | acc agents auto-merge [on|off] | acc agents max [<n>]");
  noAgent(o, "change what agents run with");
  const change2 = {};
  if (o.model !== void 0) change2.model = o.model;
  if (o.effort !== void 0) change2.effort = o.effort;
  if (o["fallback-model"] !== void 0) change2.fallbackModel = o["fallback-model"];
  for (const f of o.clear ?? []) {
    const key = f === "model" ? "model" : f === "effort" ? "effort" : f === "fallback-model" ? "fallbackModel" : null;
    if (!key) throw new AccError("usage", "--clear takes model, effort or fallback-model.");
    change2[key] = null;
  }
  if (!Object.keys(change2).length) throw new AccError("usage", "Say what to change: --model, --effort, --fallback-model or --clear.");
  setProfile(run, paths.root, paths.config, roleArg, change2, o.project ? "project" : "clone");
  const after = profileView(loadConfig(paths.config).config, run, paths.root, roleArg);
  out(o, () => `${roleArg}: model ${after.model}${after.from.model === "acc" ? " (acc's default)" : ""}, effort ${after.effort ?? "default"}${after.fallbackModel ? `, falls back to ${after.fallbackModel}` : ""}. ${o.project ? "Set in .acc/config.json: commit it to share it." : "Set for this clone only."} The next ${roleArg} uses it.`, after);
  return 0;
}
var autonomyWords = (config) => ({
  manual: "nothing happens on its own.",
  review: `autopilot ${autopilotDoes(autoMergeOn(config))}`,
  dispatch: "as review, and it also starts Ready tasks. Not built yet: autopilot refuses.",
  full: "read as dispatch. Not built yet: autopilot refuses."
})[config.autonomy] ?? "";
function cmdAutonomy(o, configFile, value) {
  if (value === void 0) {
    const { config: config2 } = loadConfig(configFile);
    out(o, () => `autonomy ${config2.autonomy} (project): ${autonomyWords(config2)}`.trim(), { autonomy: config2.autonomy });
    return 0;
  }
  const role = process.env.ACC_ROLE;
  if (role === "builder" || role === "reviewer" || role === "analyst") throw new AccError("refused", `${role === "analyst" ? "An" : "A"} ${role} can't change what autopilot may do. A person does that.`);
  personOnly(o, "change what autopilot may do");
  setAutonomy(configFile, value);
  const { config } = loadConfig(configFile);
  out(o, () => `autonomy ${config.autonomy}: ${autonomyWords(config)} Set in .acc/config.json: commit it to share it.`, { autonomy: config.autonomy });
  return 0;
}
function autoMergeLines(config) {
  if (!autoMergeOn(config)) {
    return config.profile === "salesforce" ? "auto-merge off (project): a Salesforce project never auto-merges. A person merges every pull request." : "auto-merge off (project): autopilot never merges a pull request. A person merges each one.";
  }
  const covered2 = config.environments.filter((e) => !e.protected).map((e) => e.branch);
  const kept = config.environments.filter((e) => e.protected).map((e) => e.branch);
  return [
    `auto-merge on (project): a pull request into ${covered2.join(", ") || "no environment"} whose review and checks passed, with nothing waiting on a person and nothing changed under .acc/, joins the repo's merge queue, and they merge in turn: at its turn its base is merged in, the full check runs once, and it merges once GitHub says it can.`,
    config.gates.builder?.length ? `Builders run ${withStrayFiles(config, config.gates.builder).join(", ")}; the full check (${fullGates(config).join(", ") || "none"}) runs in the queue.` : "",
    kept.length ? `Never into ${kept.join(", ")}: protected, so a person merges.` : "",
    config.autonomy === "review" ? "It merges while autopilot is on." : `autonomy is "${config.autonomy}", so autopilot doesn't run and nothing merges on its own.`
  ].filter(Boolean).join(" ");
}
function cmdAutoMerge(o, configFile, value) {
  const data = (config2) => ({ autoMerge: autoMergeOn(config2), environments: config2.environments.filter((e) => autoMergeOn(config2) && !e.protected).map((e) => e.branch), autonomy: config2.autonomy });
  if (value === void 0) {
    const { config: config2 } = loadConfig(configFile);
    out(o, () => autoMergeLines(config2), data(config2));
    return 0;
  }
  if (value !== "on" && value !== "off") throw new AccError("usage", "acc agents auto-merge [on|off]");
  const role = process.env.ACC_ROLE;
  if (role === "builder" || role === "reviewer" || role === "analyst") throw new AccError("refused", `${role === "analyst" ? "An" : "A"} ${role} can't change whether autopilot merges. A person does that.`);
  personOnly(o, "change whether autopilot merges");
  setAutoMerge(configFile, value === "on");
  const { config } = loadConfig(configFile);
  out(o, () => `${autoMergeLines(config)} Set in .acc/config.json: commit it to share it.`, data(config));
  return 0;
}
function cmdDispatch(o, id) {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const deps = { run, now, accBinDir: accBinDir(), accCommand: accCommand(), env: process.env };
  if (o.held) {
    if (id) throw new AccError("usage", "acc dispatch --held starts every waiting task that may go: give it no id.");
    const r2 = followingCards(paths, config, () => startHeld(paths, config, deps, { actor, by }));
    out(o, () => heldLines(r2).join("\n"), r2);
    return 0;
  }
  if (!id) throw new AccError("usage", "acc dispatch <id> [--cloud | --local] [--foreground] [--without-analysis] [--anyway] [--model <m>] [--effort <level|default>], acc dispatch --held, or acc dispatch <id> --stop-waiting");
  if (o.cloud === true && o.local === true) throw new AccError("usage", "Give --cloud or --local, not both.");
  const where = o.cloud === true ? "cloud" : o.local === true ? "local" : void 0;
  if (o["stop-waiting"]) {
    const t = stopWaiting(paths, now, id.toUpperCase(), actor, by);
    out(o, () => `${t.id} stopped waiting. It stays to do, and nothing starts it on its own.`, t);
    return 0;
  }
  if (o.foreground && !o.json) process.stdout.write(`Starting ${id.toUpperCase()} in this terminal. Leave the session when it's done.
`);
  const model = typeof o.model === "string" ? o.model : void 0;
  const effort = typeof o.effort === "string" ? o.effort : void 0;
  const r = followingCards(paths, config, () => dispatch(paths, config, id.toUpperCase(), { ...deps, steps: steps() }, { actor, by, foreground: o.foreground === true, withoutAnalysis: o["without-analysis"] === true, anyway: o.anyway === true, model, effort, where }));
  const dropped = r.effortDropped ? tone(`  ${effortDroppedWords(r.effortDropped, model ?? "")}`, "orange") : "";
  if (r.held) {
    const blockers = r.waitsFor.map((w) => w.task);
    steps().result(true, `${r.task.id} waits for ${taskList(blockers)}, and starts on its own once they merge.`);
    out(o, () => [
      tone(`${r.task.id} waits for ${filesOf(r.waitsFor)}.`, "blue"),
      dropped,
      `  ${taskList(r.first)} ${r.first.length === 1 ? "shares" : "share"} no files with work in flight, so ${r.first.length === 1 ? "it goes" : "they go"} first.`,
      `  ${r.task.id} starts on its own once ${taskList(blockers)} ${blockers.length === 1 ? "merges" : "merge"}, or once nothing else is ready to start: the Command Center or autopilot starts it.`,
      `  Start it now: acc dispatch ${r.task.id} --anyway`
    ].filter(Boolean).join("\n"), r);
    return 0;
  }
  out(o, () => [
    `${r.task.id} \u2192 ${stateLabel("running")}`,
    `  worktree: ${r.worktree}${r.reused ? " (reused)" : ""}`,
    `  branch:   ${r.branch}`,
    `  name:     ${r.name}`,
    `  model:    ${r.task.run?.model ?? ""}${r.task.run?.modelPicked ? " (picked for this task)" : ""}`,
    `  effort:   ${r.task.run?.effort ?? "the model's default"}${r.task.run?.effortPicked ? " (picked for this task)" : ""}${r.where === "cloud" ? " (the routine's own model and effort apply in the cloud: a pick here is kept for a re-dispatch on this Mac)" : ""}`,
    dropped,
    `  where:    ${BUILDER_PLACE_LOOK[r.where].label}${r.cloud ? `, session ${r.cloud.sessionId}. Watch it at ${r.cloud.url}` : ""}`,
    `  agent:    ${r.cloud ? "a cloud session, started by the routine; acc sync follows its branch on GitHub and collects it once its last commit says Acc-Done" : r.bgId ? `background session ${r.bgId}. Watch it with: claude attach ${r.bgId}` : o.foreground ? "ran in this terminal" : "started; it will appear in claude agents shortly"}`,
    `  packet:   ${r.packetPath}`,
    r.shares.length ? tone(`  ${sharesWords(r.shares)}. The second pull request to merge may conflict there.`, "dim") : "",
    // GitHub's rules behind the guard (GH-69): a warning, never a refusal, where it enforces none.
    ...(r.warnings ?? []).map((w) => tone(`  ! ${w}`, "orange"))
  ].filter(Boolean).join("\n"), r);
  steps().result(true, `${r.task.id} is running ${r.where === "cloud" ? "in the cloud" : o.foreground ? "in this terminal" : "in the background"}.`);
  return 0;
}
function heldLines(r) {
  const lines = [
    ...r.started.map((s) => tone(`\u2713 ${s.task}  ${startedWords(s)}.${s.bgId ? ` Watch it with: claude attach ${s.bgId}` : ""}`, "blue")),
    ...r.failed.flatMap((f) => [tone(`! ${f.task}  Couldn't start it: ${f.reason}`, "orange"), tone(`    It isn't tried again until a person dispatches it, or stops it waiting: acc dispatch ${f.task} --stop-waiting`, "dim")]),
    ...r.waiting.map((w) => tone(`\u2026 ${w.task}  Waiting: ${w.reason}`, "dim"))
  ];
  return lines.length ? lines : ["No task waits for another's files."];
}
function cmdCleanup(o, id) {
  const { paths, config } = project(process.cwd());
  const r = cleanup(paths, config, id.toUpperCase(), run, now);
  out(o, () => r.removed ? `Removed ${r.worktree}.` : `Kept ${r.worktree ?? "the worktree"}:
- ${r.reasons.join("\n- ")}`, r);
  return r.removed ? 0 : 1;
}
function cmdResume(o, id) {
  const role = process.env.ACC_ROLE;
  if (role === "builder" || role === "reviewer" || role === "analyst") throw new AccError("refused", `${role === "analyst" ? "An" : "A"} ${role} can't resume a builder. A person does that, or autopilot.`);
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const r = resume(paths, config, id.toUpperCase(), { run, now, env: process.env, accBinDir: accBinDir(), accCommand: accCommand() }, {
    actor,
    by,
    message: o.message
  });
  out(o, () => [
    tone(`${r.task.id} resumed: its builder carries on in ${r.folder}.`, "blue"),
    r.stopped ? `  Stopped its idle background session ${r.stopped} first, so the conversation runs in one place.` : "",
    r.said ? `  It last said: ${clipSaid(r.said, 600)}` : "",
    `  Its output: ${r.log}`,
    tone(`  It finishes with acc done, or blocks. Session ${r.sessionId}, pid ${r.pid}.`, "dim")
  ].filter(Boolean).join("\n"), r);
  return 0;
}
function noteFrom(o) {
  const n = noteInput({ landed: o.landed, moved: o.moved, open: o.open });
  return noteGiven(n) ? n : null;
}
var area2 = {
  help: {
    section: "Agents",
    order: 30,
    lines: `  acc dispatch <id> [--cloud | --local] [--foreground] [--without-analysis] [--anyway] [--model <m>]
                [--effort <low|medium|high|xhigh|max|default>]
                                        Worktree, setup, instructions, and a background builder session. --cloud
                                        starts it as a cloud session instead, where the project opted in (acc
                                        cloud), pushing its branch first; --local keeps it on this Mac. Neither:
                                        the project's agents.cloud.default, else this Mac. A task
                                        whose analysis shares files with work in flight waits while another
                                        Ready task shares none; --anyway starts it now. --model and --effort
                                        pick the builder's model and effort for this task: a re-dispatch and a
                                        resume keep them. Without them, the builder's own (acc agents);
                                        --effort default drops the task's. A level the model doesn't take is
                                        refused before anything starts, and a model picked drops an effort
                                        picked before that it doesn't take
  acc dispatch --held                   Start the tasks that wait for others' files and may go now
  acc dispatch <id> --stop-waiting      It stops waiting, and stays to do
  acc done [<id>] --landed "<line>"... --moved "<line>"... --open "<line>"...
                                        A builder's finish line: moves its task to review, with a note for
                                        whoever comes next: what landed, which numbers moved (tests, checks,
                                        ratchets), and what's still open. A builder must give all three. A
                                        flag again adds a line; --moved none or --open none says there was
                                        nothing
  acc block [<id>] "<reason>" [--landed \u2026] [--moved \u2026] [--open \u2026]
                                        A builder's way out when stuck, with a note if it has one
  acc block [<id>] --client "<question>"
                                        Stuck on something only the client can answer: blocks, and drafts an
                                        update for the ticket that a person reviews before posting
  acc resume <id> [--message "<text>"]  Carry on a running task whose builder stopped before acc done or acc
                                        block, as when the Mac slept: its own session, in its worktree, with the
                                        rules it was dispatched with. It's told it was cut off, or --message
  acc cleanup <id>                      Remove a finished task's worktree, only if nothing would be lost
  acc agents                            The model and effort builders and reviewers run with, and where each is
                                        set. A model nobody set is acc's default, claude-opus-5-5
  acc agents set <builder|reviewer> [--model <m>] [--effort <low|medium|high|xhigh|max>] [--fallback-model <m>]
                [--clear <model|effort|fallback-model>]... [--project]
                                        Change them for this clone, or with --project in .acc/config.json
  acc agents autonomy [manual|review]   What autopilot may do on its own, or change it in .acc/config.json
  acc agents auto-merge [on|off]        Whether autopilot merges a reviewed pull request whose checks passed, into
                                        an environment that isn't protected, or change it in .acc/config.json
  acc agents max [<n>]                  How many builders this project runs at once, and how many run now; with
                                        <n>, set it (1 to 16) in .acc/config.json, for everyone on the repo
  acc machine heavy-slots [<n>]         How many heavy checks (builds, tests, validations) this machine runs at once,
                                        for every repo on it; with <n>, set it (1 to 8) in ~/.acc/machine.json
  acc machine agents [<n>|--none]       How many builders this machine runs at once across every repo, and how many
                                        run now; with <n>, set a total (1 to 64) in ~/.acc/machine.json, or with
                                        --none take it out, so each project's cap is the only limit`
  },
  options: {
    foreground: { type: "boolean", default: false },
    cloud: { type: "boolean", default: false },
    local: { type: "boolean", default: false },
    "without-analysis": { type: "boolean", default: false },
    anyway: { type: "boolean", default: false },
    held: { type: "boolean", default: false },
    "stop-waiting": { type: "boolean", default: false },
    model: { type: "string" },
    effort: { type: "string" },
    "fallback-model": { type: "string" },
    clear: { type: "string", multiple: true },
    project: { type: "string" },
    client: { type: "string" },
    reason: { type: "string" },
    message: { type: "string" },
    none: { type: "boolean", default: false },
    // A builder's handoff note (D-106), a line each time a flag is given.
    landed: { type: "string", multiple: true },
    moved: { type: "string", multiple: true },
    open: { type: "string", multiple: true }
  },
  // --project names the project for acc init, and is a plain switch for acc agents set: give the switch a
  // value, so the Command Center's "for the project" works (D-036).
  argv: { agents: (argv) => argv.map((x2) => x2 === "--project" ? "--project=yes" : x2) },
  subcommands: { agents: ["show", "set", "autonomy", "auto-merge", "max"], machine: ["heavy-slots", "agents"] },
  commands: {
    agents: (o, rest) => cmdAgents(o, rest[0], rest[1]),
    machine: (o, rest) => cmdMachine(o, rest[0], rest[1]),
    dispatch: (o, rest) => cmdDispatch(o, rest[0]),
    done: (o, rest) => cmdSet(o, taskIdFrom(rest[0]), "review", noteFrom(o)),
    block: (o, rest) => {
      const [first, ...more] = rest;
      const looksLikeId = !!first && /^[A-Z][A-Z0-9_]*-\d+$/i.test(first) && (more.length > 0 || typeof o.client === "string");
      const id = taskIdFrom(looksLikeId ? first : void 0);
      const client = typeof o.client === "string" ? o.client.trim() : "";
      const reason = o.reason ?? ((looksLikeId ? more : rest).join(" ").trim() || (client ? `Waiting on the client: ${client}` : ""));
      if (!reason) throw new AccError("usage", 'acc block "<what you need>", or acc block --client "<question>" when only the client can answer');
      return cmdSet({ ...o, reason }, id, "blocked", noteFrom(o));
    },
    resume: (o, rest) => {
      if (!rest[0]) throw new AccError("usage", 'acc resume <id> [--message "<text>"]');
      return cmdResume(o, rest[0]);
    },
    cleanup: (o, rest) => {
      if (!rest[0]) throw new AccError("usage", "acc cleanup <id>");
      return cmdCleanup(o, rest[0]);
    }
  }
};

// packages/cli/src/commands/checks.ts
import { existsSync as existsSync26, realpathSync as realpathSync7 } from "node:fs";
import { join as join37 } from "node:path";
function currentBranch(root) {
  const r = run("git", ["branch", "--show-current"], { cwd: root });
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}
function apexTests(o) {
  return (o.test ?? []).map((t) => {
    const [name, ...why] = t.split("=");
    if (!name?.trim() || !/^[A-Za-z_][\w.]*$/.test(name.trim())) throw new AccError("usage", `--test takes an Apex test class and why it covers the change: --test AccountServiceTest="covers the new discount rule". Got "${t}".`);
    return { name: name.trim(), reason: why.join("=").trim() };
  });
}
function checkTarget(o) {
  const { paths, config } = project(process.cwd());
  const ledger = readLedger(paths.ledger);
  const branch = currentBranch(paths.root);
  const { env, task } = gateTarget(config, ledger, branch, { env: o.env, task: o.task ?? process.env.ACC_TASK ?? void 0 });
  return { paths, config, env, task, branch };
}
function raisesHere(root, config, branch, task) {
  if (!branch || !task?.run?.branch || branch !== task.run.branch) return false;
  if (config.environments.some((e) => e.branch === branch)) return false;
  try {
    return realpathSync7(mainCheckout(run, root)) !== realpathSync7(root);
  } catch {
    return false;
  }
}
function cmdGateRun(o, names3) {
  const { paths, config, env, branch, task } = checkTarget(o);
  const say = (line) => {
    if (!o.json) process.stderr.write(line + "\n");
  };
  pruneRelaxes(paths);
  const r = runGates(paths, config, env, names3, apexTests(o), {
    run,
    now,
    ...task ? { task: task.id } : {},
    raise: raisesHere(paths.root, config, branch, task),
    onStart: (g) => say(tone(`  \u2026 ${g.name}${g.heavy ? " (heavy)" : ""}`, "dim")),
    onWait: (g) => say(tone(`  \u2026 ${g.name} is waiting for another heavy check on this machine to finish`, "dim"))
  });
  const bad = r.results.filter((x2) => !satisfies(x2) && !ratchetOf(x2)?.raised);
  const raised = r.raised.map((x2) => `${x2.label} ${x2.from === null ? `${num(x2.to)}, its first floor` : `${num(x2.from)} \u2192 ${num(x2.to)}`}`);
  const held = bad.filter((x2) => x2.status === "hold");
  const fix = bad.filter((x2) => x2.status !== "hold");
  out(o, () => [
    `${branch ?? "HEAD"} at ${r.sha.slice(0, 7)}, against ${r.env.name}${r.env.org ? ` (${r.env.org})` : ""}`,
    ...r.results.flatMap((x2) => [
      `  ${gateLabel(x2.status)}${x2.gate.padEnd(11)} ${x2.summary}${testsText(x2) ? tone(` \xB7 tests: ${testsText(x2)}`, "dim") : ""}`,
      ...x2.countsNote ? [tone(`      ${x2.countsNote}`, "dim")] : []
    ]),
    r.dirty ? tone("Not recorded: there are uncommitted changes, so these results can't vouch for a commit. Commit, then run acc gate run again.", "orange") : "",
    fix.length ? `${fix.length} to fix: ${fix.map((x2) => x2.gate).join(", ")}.` : "",
    held.length ? `${held.length} ${held.length === 1 ? "needs" : "need"} a person: ${held.map((x2) => x2.gate).join(", ")}. Add the tests, or un-skip them. If the task asks for the skip, say so with acc block "<why>": only a person can waive it.` : "",
    raised.length ? tone(`Raised in ${FLOORS_FILE}: ${raised.join(", ")}. Commit that file, then run acc gate run again: acc done takes the commit that records it.`, "orange") : "",
    bad.length || raised.length || r.dirty ? "" : "All recorded. acc done will accept this commit."
  ].filter(Boolean).join("\n"), r);
  return bad.length || raised.length ? 1 : 0;
}
function cmdGateWaive(o, names3) {
  if (process.env.ACC_ROLE === "builder") throw new AccError("refused", `A builder can't waive its own checks. If one can't pass, say why with acc block "<why>", and a person decides.`);
  const { actor, by } = actorFrom(o);
  if (actor !== "human") throw new AccError("refused", "Only a person can waive a check.");
  const { paths, config, env, task } = checkTarget(o);
  const branch = o.task ? task?.run?.branch : void 0;
  if (o.task && !branch) throw new AccError("usage", `${task?.id ?? o.task} has no branch yet, so there's no commit to waive checks on.`);
  const sha = run("git", ["rev-parse", "--verify", "--quiet", branch ? `refs/heads/${branch}` : "HEAD"], { cwd: paths.root }).stdout.trim();
  if (!sha) throw new AccError("git", branch ? `The branch ${branch} isn't in this clone.` : "This checkout has no commit yet.");
  const waived = waiveGates(paths, config, { sha, env, gates: names3, reason: o.reason ?? "", by, now });
  out(o, () => [
    `${branch ?? "HEAD"} at ${sha.slice(0, 7)}, against ${env.name}`,
    ...waived.map((r) => `  ${gateLabel("skip")}${r.gate.padEnd(11)} waived${r.waived?.was ? ` (it was ${r.waived.was})` : ""}: ${r.waived?.reason}`),
    tone("Waived for this commit only. A new commit needs its checks again.", "dim")
  ].join("\n"), { sha, env: env.branch, waived });
  return 0;
}
function pruneRelaxes(paths) {
  if (existsSync26(paths.relaxed)) mutate(paths, now, (l3) => pruneRelaxed(paths.relaxed, l3));
}
function cmdGateRelax(o, names3) {
  if (process.env.ACC_ROLE === "builder") throw new AccError("refused", `A builder can't relax a floor. If this change has to make a number worse, say why with acc block "<why>", and a person decides.`);
  const { actor, by } = actorFrom(o);
  if (actor !== "human") throw new AccError("refused", "Only a person can relax a floor.");
  const [name, ...extra] = names3;
  if (!name || extra.length) throw new AccError("usage", 'acc gate relax <ratchet> --to <n> --reason "<why>" [--task <id>]');
  const to = typeof o.to === "string" && o.to.trim() ? Number(o.to) : NaN;
  if (!Number.isFinite(to)) throw new AccError("usage", `--to takes the new floor, a number: acc gate relax ${name} --to <n> --reason "<why>".`);
  const { paths, config, task } = checkTarget(o);
  if (!task) throw new AccError("usage", `A relax is for one task, and this checkout isn't a task's. Name it: acc gate relax ${name} --to <n> --reason "<why>" --task <id>.`);
  if (task.state === "done") throw new AccError("refused", `${task.id} is done, and a relax counts only while its task is open.`);
  const where = task.run?.worktree;
  if (!where || !existsSync26(where)) throw new AccError("usage", `${task.id} has no worktree on disk, so there's no floors file to relax.`);
  const record2 = mutate(paths, now, (l3, emit) => {
    pruneRelaxed(paths.relaxed, l3);
    const r = relaxFloor(paths.relaxed, join37(where, FLOORS_FILE), where, config, { ratchet: name, to, reason: o.reason ?? "", by, now, task: task.id });
    const t = l3.tasks.find((x2) => x2.id === task.id);
    if (t) {
      t.updatedAt = now().toISOString();
      emit({ type: "task.updated", task: task.id, actor, by, data: { relaxed: { ratchet: r.ratchet, limit: r.limit, to: r.to, was: r.was, reason: r.reason } } });
    }
    return r;
  });
  out(o, () => [
    `Relaxed ${name}'s ${record2.limit} for ${task.id}, from ${record2.was === null ? "nothing" : num(record2.was)} to ${num(record2.to)}, in ${join37(where, FLOORS_FILE)}: ${record2.reason}`,
    // As DESIGN §9 has it: for this task alone, a worse floor passes at the number relaxed to or a better one, from the floor relaxed.
    tone(`Commit that file with ${task.id}'s change. The relax is for ${task.id} alone: ${record2.was === null ? `where its branch began with no ${record2.limit}, it passes at ${num(record2.to)} or a better number` : `where its branch began at ${record2.limit} ${num(record2.was)}, it passes with its ${record2.limit} at ${num(record2.to)} or a better one`}, on that branch and in the merge queue's merge of it, until ${task.id} is done. Another task's branch isn't backed by it, even one that began at the same ${record2.limit}.`, "dim")
  ].join("\n"), record2);
  return 0;
}
function cmdGateList(o) {
  const { paths, config, env, branch: here, task } = checkTarget(o);
  const branch = o.task && task?.run?.branch ? task.run.branch : here;
  const head = run("git", ["rev-parse", "--verify", "--quiet", o.task && task?.run?.branch ? `refs/heads/${task.run.branch}` : "HEAD"], { cwd: paths.root }).stdout.trim();
  const receipts = head ? receiptsAt(paths, head) : {};
  const lighter = builderGatesFor(config, env.branch);
  const builder = requiredGates(config, env.branch, "builder");
  let floors = {};
  try {
    floors = readFloors(paths.floors);
  } catch {
  }
  const floorOf = (name) => {
    const spec = config.gates.ratchets?.[name];
    if (!spec) return "";
    const v = valueOf(floors[name], spec.limit);
    return v === null ? `; no ${spec.limit} yet` : `; ${spec.limit} ${num(v)}`;
  };
  const full = fullGates(config);
  const gates = gatesFor(config).map((g) => ({ name: g.name, about: g.about + floorOf(g.name), required: full.includes(g.name), builder: builder.includes(g.name), heavy: g.heavy, receipt: receipts[g.name] ?? null }));
  const counted = gates.some((g) => g.receipt && testsText(g.receipt));
  out(o, () => gates.length ? [`${branch ?? "HEAD"} at ${head.slice(0, 7)}, against ${env.name}`, "", table([["Gate", "Required", ...lighter ? ["Builder"] : [], "Heavy", "This commit", ...counted ? ["Tests"] : [], "Checks"], ...gates.map((g) => [
    g.name,
    g.required ? "yes" : "",
    ...lighter ? [g.builder ? "yes" : ""] : [],
    g.heavy ? "yes" : "",
    g.receipt ? gateLabel(g.receipt.status).trimEnd() : tone("not run", "dim"),
    ...counted ? [g.receipt ? testsText(g.receipt) : ""] : [],
    g.about
  ])]), ...lighter ? ["", tone(`Builders run ${builder.join(", ")}, and acc done takes them. The required ones run once, in the merge queue, before the merge.`, "dim")] : []].join("\n") : 'No gates. List commands under "gates.commands" (or numbers that may only get better under "gates.ratchets") in .acc/config.json, and the required ones under "gates.required".', { sha: head, env: env.branch, gates });
  return 0;
}
var queueEnvs = (config) => config.environments.filter((e) => autoMergeFor(config, e.branch)).map((e) => e.branch);
function cmdGateRequired(o, names3) {
  const { paths } = project(process.cwd());
  const show = (set) => {
    const { config } = loadConfig(paths.config);
    const queue = queueEnvs(config);
    const required = fullGates(config);
    out(o, () => [
      required.length ? `${set ? "Required checks are now" : "Required checks"}: ${required.join(", ")}.` : "No required checks: acc done takes any commit.",
      queue.length && required.length ? `Where the merge queue runs (${queue.join(", ")}), they run once in it, before each merge${config.gates.builder?.length ? `, and builders run ${config.gates.builder.join(", ")}` : ""}.` : "",
      set ? "Set in .acc/config.json: commit it to share it." : ""
    ].filter(Boolean).join(" "), { required, gates: gatesFor(config).map((g) => g.name).filter((g) => g !== STRAY_FILES), queue });
  };
  if (!names3.length) {
    show(false);
    return 0;
  }
  noAgent(o, "change the checks a task must pass");
  setRequiredGates(paths.config, names3);
  show(true);
  return 0;
}
function cmdGateBuilder(o, names3) {
  const { paths } = project(process.cwd());
  const show = (set) => {
    const { config } = loadConfig(paths.config);
    const queue = queueEnvs(config);
    const builder = config.gates.builder?.length ? config.gates.builder : null;
    const full = fullGates(config);
    const required = full.join(", ") || "none";
    out(o, () => [
      !builder ? `${set ? "Builders now run" : "Builders run"} the required checks (${required}): no lighter ones are named.` : queue.length ? `${set ? "Builders now run" : "Builders run"} ${builder.join(", ")} where the merge queue runs (${queue.join(", ")}), and the required checks (${required}) run once in it, before each merge.` : `gates.builder names ${builder.join(", ")}${set ? " now" : ""}, but no environment's pull requests go through the merge queue (auto-merge, under autonomy review), so builders run the required checks (${required}).`,
      set ? "Set in .acc/config.json: commit it to share it." : ""
    ].filter(Boolean).join(" "), { builder, required: full, queue, gates: gatesFor(config).map((g) => g.name).filter((g) => g !== STRAY_FILES) });
  };
  if (!names3.length && o.none !== true) {
    show(false);
    return 0;
  }
  if (names3.length && o.none === true) throw new AccError("usage", "acc gate builder <name>\u2026, or acc gate builder --none: not both.");
  noAgent(o, "change the checks builders run");
  setBuilderGates(paths.config, o.none === true ? null : names3);
  show(true);
  return 0;
}
function cmdDrift(o, envName) {
  const { paths, config } = project(process.cwd());
  const onRetrieve = (env) => {
    if (!o.json) process.stderr.write(tone(`Retrieving the baseline from ${env.name}. This only reads the org.
`, "dim"));
  };
  const r = drift(paths, config, envName, { run, now, onRetrieve, onWait: () => {
    if (!o.json) process.stderr.write(tone("Waiting for another heavy check on this machine to finish\u2026\n", "dim"));
  } }, { manifest: o.manifest, keep: o.keep === true });
  const found = r.changed.length + r.added.length + r.missing.length;
  if (o.json) {
    out(o, () => "", r);
    return found ? 1 : 0;
  }
  if (r.unretrievable.length) process.stderr.write([tone(`Not drift, but the retrieve couldn't fetch these; check the baseline manifest (${r.unretrievable.length}):`, "dim"), ...r.unretrievable.map((f) => tone(`  ${f}`, "dim"))].join("\n") + "\n");
  if (found || r.kept) {
    process.stdout.write([
      found ? `${r.org} differs from ${r.env} at ${r.base.slice(0, 7)}${r.ignored ? ` (${r.ignored} expected differences left out)` : ""}:` : "",
      ...r.changed.length ? ["", `Changed in the org (${r.changed.length}):`, ...r.changed.map((f) => `  ${f}`)] : [],
      ...r.added.length ? ["", `Only in the org (${r.added.length}):`, ...r.added.map((f) => `  ${f}`)] : [],
      ...r.missing.length ? ["", `In the branch but not the org (${r.missing.length}):`, ...r.missing.map((f) => `  ${f}`)] : [],
      r.kept ? `
Kept the retrieved copy at ${r.kept}. Remove it with: git worktree remove --force "${r.kept}"` : ""
    ].filter((l3) => l3 !== "").join("\n") + "\n");
  }
  return found ? 1 : 0;
}
var area3 = {
  help: {
    section: "Checks",
    order: 70,
    lines: `  acc gate run [<gate>...] [--test <ApexTest>=<why>]... [--env <name>] [--task <id>]
                                        Run the required checks (or the ones named) on this commit
  acc gate list [--env <name>] [--task <id>]
                                        The project's checks, and their results on this commit
  acc gate waive <gate>... --reason "<why>" [--task <id>]
                                        A person sets checks aside on this commit (or the task's), with a reason
  acc gate relax <ratchet> --to <n> --reason "<why>" [--task <id>]
                                        A person relaxes a ratchet's floor for one task, in its worktree, with a reason
  acc gate required [<gate>...]         The checks every task must pass; with names, set them in .acc/config.json.
                                        Where the merge queue runs, they run once in it, before each merge
  acc gate builder [<gate>...|--none]   Builders' lighter checks where the merge queue runs the required ones; with
                                        names, set them in .acc/config.json, or with --none take them out
  acc drift <environment> [--manifest <path>] [--keep]
                                        What changed in an org since its branch; prints nothing if none`
  },
  options: {
    test: { type: "string", multiple: true },
    env: { type: "string" },
    task: { type: "string" },
    reason: { type: "string" },
    to: { type: "string" },
    manifest: { type: "string" },
    keep: { type: "boolean", default: false },
    none: { type: "boolean", default: false }
  },
  subcommands: { gate: ["run", "list", "waive", "relax", "required", "builder"] },
  commands: {
    gate: (o, rest) => {
      const [sub, ...names3] = rest;
      if (sub === "run") return cmdGateRun(o, names3);
      if (sub === "list") return cmdGateList(o);
      if (sub === "waive") return cmdGateWaive(o, names3);
      if (sub === "relax") return cmdGateRelax(o, names3);
      if (sub === "required") return cmdGateRequired(o, names3);
      if (sub === "builder") return cmdGateBuilder(o, names3);
      throw new AccError("usage", 'acc gate run [<gate>...] | acc gate list | acc gate waive <gate>... --reason "<why>" | acc gate relax <ratchet> --to <n> --reason "<why>" | acc gate required [<gate>...] | acc gate builder [<gate>...|--none]');
    },
    drift: (o, rest) => {
      if (!rest[0]) throw new AccError("usage", "acc drift <environment>");
      return cmdDrift(o, rest[0]);
    }
  }
};

// packages/cli/src/commands/cloud.ts
function needLines(needs) {
  return needs.map((n) => n.ok ? tone(`\u2713 ${n.label}`, "blue") : [tone(`! ${n.label}`, "orange"), tone(`    ${n.fix}`, "dim")].join("\n"));
}
function cmdStatus2(o) {
  const { paths, config } = project(process.cwd());
  const needs = cloudNeeds(config, run, process.env);
  const cloud = config.agents.cloud;
  const ledger = readLedger(paths.ledger);
  const running = ledger.tasks.filter((t) => t.state === "running" && t.run?.where === "cloud");
  const reason = cloudReason(needs);
  const guard = guardCommitted(run, paths.root, "HEAD");
  const protection = cloud && config.github ? environmentProtection(run, config.github.repo, config.github.account, config.environments.map((e) => e.branch), process.env) : [];
  out(o, () => [
    cloud ? `Cloud builders: on for this project. Default ${BUILDER_PLACE_LOOK[cloud.default].label}${cloud.default === "cloud" ? " (acc dispatch --local keeps a task on this Mac)" : " (acc dispatch --cloud sends a task to the cloud)"}; up to ${cloud.max} at once; a task needs you after ${cloud.quietMinutes} minutes with no push.` : "Cloud builders: off for this project. A local builder is the default everywhere: acc cloud enable opts in.",
    reason ? tone(`  ${reason}.`, "orange") : tone("  Everything the cloud needs is there.", "blue"),
    guard.ok ? tone("  The push guard is committed on HEAD, in .claude/hooks/ and .claude/settings.json.", "dim") : cloud ? tone(`  ! ${guard.why}`, "orange") : "",
    ...needLines(needs),
    ...protection.map((p) => p.state === "enforced" ? tone(`  \u2713 ${p.why}`, "blue") : tone(`  ! ${p.why}${p.state === "unknown" ? " Whether a push the guard didn't catch would be prevented isn't known." : ""}`, "orange")),
    ...running.map((t) => tone(`  ${t.id} runs in the cloud: ${t.run?.cloud?.url ?? ""}${cloudWait(t, config, now()) ? ` (${cloudWait(t, config, now())})` : ""}`, "blue"))
  ].filter(Boolean).join("\n"), { cloud, needs, reason, guard: guard.ok, guardWhy: guard.why, protection, running: running.map((t) => ({ id: t.id, url: t.run?.cloud?.url ?? null, wait: cloudWait(t, config, now()) })) });
  return 0;
}
function cmdEnable(o) {
  noAgent(o, "opt a project in to cloud builders");
  const { paths, config } = project(process.cwd());
  if (!config.github) throw new AccError("refused", 'Cloud builders need the repo on GitHub: a cloud session clones it from there and pushes its branch back. Add the "github" section to .acc/config.json first.');
  const num3 = (k2) => o[k2] === void 0 ? void 0 : /^\d+$/.test(String(o[k2])) ? Number(o[k2]) : NaN;
  enableCloud(paths.config, {
    ...typeof o.routine === "string" ? { routine: o.routine.trim() } : {},
    ...typeof o["default-place"] === "string" ? { default: o["default-place"] } : {},
    ...num3("quiet-minutes") !== void 0 ? { quietMinutes: num3("quiet-minutes") } : {},
    ...num3("max") !== void 0 ? { max: num3("max") } : {}
  }, config.agents.cloud);
  const guard = installGuard(paths.root);
  const after = loadConfig(paths.config).config;
  const needs = cloudNeeds(after, run, process.env);
  out(o, () => [
    `Cloud builders are on for ${config.project}: acc dispatch <id> --cloud sends a task to the cloud${after.agents.cloud?.default === "cloud" ? ", and so does a plain dispatch now" : ", and a plain dispatch stays on this Mac"}.`,
    guard.written.length ? `  Wrote ${guard.written.join(" and ")}: the push guard a cloud session runs. Commit them with .acc/config.json.` : "  The push guard is already committed.",
    ...needLines(needs)
  ].join("\n"), { cloud: after.agents.cloud, guard: guard.written, needs });
  return 0;
}
function cmdDisable(o) {
  noAgent(o, "turn cloud builders off");
  const { paths, config } = project(process.cwd());
  disableCloud(paths.config);
  out(o, () => `Cloud builders are off for ${config.project}. Every dispatch goes to this Mac. The routine's token stays in the keychain: acc cloud token --forget takes it out.`, { cloud: null });
  return 0;
}
function cmdToken(o) {
  noAgent(o, "keep the routine's token");
  const { config } = project(process.cwd());
  if (!config.github) throw new AccError("refused", 'Cloud builders need the repo on GitHub. Add the "github" section to .acc/config.json first.');
  const repo = config.github.repo;
  if (o.forget === true) {
    const gone = deleteCloudToken(run, repo, process.env);
    out(o, () => gone ? `Took the routine's token for ${repo} out of the keychain.` : `There was no token for ${repo} in the keychain.`, { forgotten: gone });
    return 0;
  }
  const token = (o["from-env"] === true ? process.env.ACC_CLOUD_TOKEN_NEW ?? "" : readFileArg(0)).trim();
  if (!token) throw new AccError("usage", 'Paste the token on stdin: acc cloud token < token.txt, or echo "$TOKEN" | acc cloud token. It never goes on the command line.');
  writeCloudToken(run, repo, token, process.env);
  out(o, () => `Kept the routine's token for ${repo} in this Mac's keychain (${repo}, service acc-cloud-routine). It's never written to .acc/config.json or git.`, { kept: true });
  return 0;
}
function cmdCollect(o, id) {
  if (!id) throw new AccError("usage", "acc collect <id>");
  noAgent(o, "collect a cloud builder's work");
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const r = followingCards(paths, config, () => collect(paths, config, id.toUpperCase(), { run, now, env: process.env }, { actor, by }));
  out(o, () => [
    `${r.task.id} \u2192 ${stateLabel("review")}`,
    `  ${r.reason}`,
    ...r.checks.map((c) => `  ${c.status === "pass" || c.status === "skip" ? "\u2713" : "!"} ${c.gate}: ${c.summary}`)
  ].join("\n"), r);
  return 0;
}
var area4 = {
  help: {
    section: "Agents",
    order: 32,
    lines: `  acc cloud                             Whether this project's builders may run in the cloud, what that still
                                        needs, and each task running there
  acc cloud enable [--routine <trig_id>] [--default-place local|cloud] [--max <n>] [--quiet-minutes <n>]
                                        Opt the project in: "agents.cloud" in .acc/config.json, and the push guard
                                        in .claude/settings.json, both to commit. Needs the repo on GitHub, a
                                        routine for it (claude.ai/code/routines), its token (acc cloud token), and
                                        claude auth login. Local stays the default unless --default-place cloud
  acc cloud disable                     Turn cloud builders off for the project
  acc cloud token [--forget]            Keep the routine's API token in this Mac's keychain, read from stdin, never
                                        from the command line; --forget takes it out
  acc collect <id>                      Bring a cloud builder's branch into its worktree, run the required checks
                                        here, and move the task to review: what acc sync does on its own once the
                                        builder's last commit carries Acc-Done: <id>`
  },
  options: {
    routine: { type: "string" },
    "default-place": { type: "string" },
    max: { type: "string" },
    "quiet-minutes": { type: "string" },
    forget: { type: "boolean", default: false },
    "from-env": { type: "boolean", default: false }
  },
  subcommands: { cloud: ["status", "enable", "disable", "token"] },
  commands: {
    cloud: (o, rest) => {
      const sub = rest[0] ?? "status";
      if (sub === "status") return cmdStatus2(o);
      if (sub === "enable") return cmdEnable(o);
      if (sub === "disable") return cmdDisable(o);
      if (sub === "token") return cmdToken(o);
      throw new AccError("usage", "acc cloud [status|enable|disable|token]");
    },
    collect: (o, rest) => cmdCollect(o, rest[0])
  }
};

// packages/cli/src/commands/environments.ts
function cmdPromote(o, from) {
  const by = personOnly(o, "promote");
  const { paths, config } = project(process.cwd());
  const say = (line) => {
    if (!o.json) process.stderr.write(tone(line, "dim") + "\n");
  };
  const show = (p) => [
    `${p.from.name} (${p.from.branch} at ${p.fromSha.slice(0, 7)}) \u2192 ${p.to.name} (${p.to.branch} at ${p.toSha.slice(0, 7)})`,
    ...skipWarning(p).map((l3) => tone(`  ! ${l3}`, "orange")),
    `  ${p.files.length} to bring over${p.deleted.length ? tone(`, ${p.deleted.length} to delete`, "orange") : ""}${p.leftOut.length ? `, ${p.leftOut.length} environment-specific left out` : ""}`,
    ...p.files.slice(0, 20).map((f) => `    ${f}`),
    ...p.files.length > 20 ? [`    \u2026and ${p.files.length - 20} more`] : [],
    ...p.deleted.map((f) => tone(`    deletes ${f}`, "orange"))
  ];
  if (o.plan) {
    const p = planPromotion(paths, config, from, o.to, { run });
    out(o, () => show(p).join("\n"), p);
    return 0;
  }
  const r = promote(paths, config, from, o.to, { run, now, env: process.env, onStep: say, steps: steps() }, { allowDeletions: o["allow-deletions"] === true, validate: o["skip-validate"] !== true, by });
  out(o, () => [
    ...show(r.plan),
    "",
    r.pr ? `Opened pull request #${r.pr.number}  ${r.pr.url}` : r.stopped ?? "",
    r.pr ? tone("It merges only when a person merges it. Deploy after that with acc deploy.", "dim") : "",
    r.warning ? tone(`! ${r.warning}`, "orange") : "",
    ...r.updates.map((u) => `  Drafted an update for ${u.key} (${u.id}).`),
    r.updates.length ? tone("Nothing is posted until a person posts it: acc updates.", "dim") : ""
  ].filter(Boolean).join("\n"), r);
  const code2 = r.pr || !r.stopped?.startsWith("Validation") ? 0 : 1;
  steps().result(code2 === 0, r.pr ? `Opened pull request #${r.pr.number} into ${r.plan.to.name}.` : r.stopped ?? "It finished.");
  return code2;
}
function cmdDeploy(o, envName) {
  const by = personOnly(o, "deploy");
  const { paths, config } = project(process.cwd());
  const show = (p) => [
    `${p.env.name} (${p.org}): ${p.env.branch} from ${p.base.slice(0, 7)} to ${p.head.slice(0, 7)}${p.confirm ? tone("  protected: needs --confirm-production", "orange") : ""}`,
    `  ${p.files.length} to deploy, tests: ${p.testLevel}${p.leftOut.length ? `, ${p.leftOut.length} environment-specific left out` : ""}${p.deleted.length ? tone(`, ${p.deleted.length} deleted (not deployed by acc)`, "orange") : ""}`,
    ...p.files.slice(0, 20).map((f) => `    ${f}`),
    ...p.files.length > 20 ? [`    \u2026and ${p.files.length - 20} more`] : []
  ];
  if (o.plan) {
    const p = planDeploy(paths, config, envName, { run }, { since: o.since, noTests: o["no-tests"] === true });
    out(o, () => show(p).join("\n"), { ...p, last: lastDeploy(paths, p.env.branch) });
    return 0;
  }
  const r = deploy(paths, config, envName, { run, now, steps: steps(), onWait: () => {
    if (!o.json) process.stderr.write(tone("Waiting for another heavy check or deploy on this machine to finish\u2026\n", "dim"));
  } }, { since: o.since, confirmed: o["confirm-production"] === true, noTests: o["no-tests"] === true, by });
  out(o, () => [
    ...show(r.plan),
    "",
    r.deployed ? tone(`\u2713 ${r.summary}`, "blue") : r.summary,
    ...r.updates.map((u) => `  Drafted an update for ${u.key} (${u.id}).`),
    r.updates.length ? tone("Nothing is posted until a person posts it: acc updates.", "dim") : ""
  ].filter(Boolean).join("\n"), r);
  const code2 = r.deployed || !r.plan.files.length ? 0 : 1;
  steps().result(code2 === 0, r.summary);
  return code2;
}
var area5 = {
  help: {
    section: "Environments",
    order: 50,
    lines: `  acc promote <env> [--to <env>] [--plan] [--allow-deletions] [--skip-validate]
                                        A pull request taking <env>'s merged changes to the next environment
  acc deploy <env> [--plan] [--since <commit>] [--confirm-production] [--no-tests]
                                        Deploy what changed on <env>'s branch since its last deploy to its org`
  },
  options: {
    to: { type: "string" },
    plan: { type: "boolean", default: false },
    "allow-deletions": { type: "boolean", default: false },
    "skip-validate": { type: "boolean", default: false },
    since: { type: "string" },
    "confirm-production": { type: "boolean", default: false },
    "no-tests": { type: "boolean", default: false }
  },
  commands: {
    promote: (o, rest) => {
      if (!rest[0]) throw new AccError("usage", "acc promote <env> [--to <env>]");
      return cmdPromote(o, rest[0]);
    },
    deploy: (o, rest) => {
      if (!rest[0]) throw new AccError("usage", "acc deploy <env> [--since <commit>] [--confirm-production]");
      return cmdDeploy(o, rest[0]);
    }
  }
};

// packages/cli/src/commands/github.ts
function renderIdentity(id) {
  const scopes = id.accounts?.find((a2) => a2.login.toLowerCase() === id.account.toLowerCase())?.scopes ?? [];
  return [
    `${id.repo} works as ${id.account}${id.from === "clone" ? ` (this clone's choice; the project's is ${id.projectAccount})` : " (the project's account)"}`,
    `  gh:      ${id.signedIn ? `${tone("\u2713", "blue")} logged in${scopes.length ? `, ${scopes.join(", ")}` : ""}` : tone(`\u2717 not logged in as ${id.account}`, "orange")}`,
    `  push:    ${id.pushesAs ? id.pushesAs.toLowerCase() === id.account.toLowerCase() ? `${tone("\u2713", "blue")} as ${id.pushesAs}` : tone(`\u2717 as ${id.pushesAs}`, "orange") : tone("? not set up by acc", "orange")}`,
    `  commits: ${id.commit.name || id.commit.email ? `${id.commit.name ?? "?"} <${id.commit.email ?? "?"}>` : tone("no identity set for this repo", "orange")}`,
    id.accounts && id.accounts.length > 1 ? `  others:  ${id.accounts.filter((a2) => a2.login !== id.account).map((a2) => a2.login).join(", ")}` : ""
  ].filter(Boolean).join("\n");
}
function cmdGithub(o, sub, arg) {
  const paths = repoPaths(process.cwd(), run);
  const { config } = loadConfig(paths.config);
  if (sub === "status" || !sub) {
    const id = githubIdentity(config, paths.root, run);
    if (!id) throw new AccError("no-github", 'This project has no "github" section in .acc/config.json.');
    out(o, () => renderIdentity(id), id);
    return id.signedIn && id.pushesAs?.toLowerCase() === id.account.toLowerCase() ? 0 : 1;
  }
  if (sub === "use") {
    noAgent(o, "switch the GitHub account this clone works as");
    if (!arg && !o.default) throw new AccError("usage", "acc github use <account>, or --default for the project's account");
    const id = useGithubAccount(config, paths.root, run, o.default ? null : arg);
    out(o, () => renderIdentity(id), id);
    return 0;
  }
  throw new AccError("usage", "acc github status | acc github use <account> | acc github use --default");
}
var area6 = {
  help: {
    section: "GitHub",
    order: 60,
    lines: `  acc github status                     Which account this repo works as, and whether gh and git push agree
  acc github use <account> | --default  Work as another logged-in account in this clone only; nothing committed changes`
  },
  options: {
    default: { type: "boolean", default: false }
  },
  subcommands: { github: ["status", "use"] },
  commands: {
    github: (o, rest) => cmdGithub(o, rest[0], rest[1])
  }
};

// packages/cli/src/commands/hooks.ts
async function readStdin(limit = 4 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of process.stdin) {
    size += c.length;
    if (size > limit) break;
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function cmdHookEvent(event) {
  try {
    const input = parseEventInput(await readStdin());
    if (!input) return 0;
    const ctx = { cwd: input.cwd || process.cwd(), env: process.env, run, now };
    const out3 = event === "session-start" ? sessionStartHook(input, ctx) : event === "pre-tool-use" ? preToolUseHook(input, ctx) : stopHook(input, ctx);
    if (out3) process.stdout.write(JSON.stringify(out3));
  } catch (e) {
    process.stderr.write(`acc hook ${event}: ${e.message}
`);
  }
  return 0;
}
async function cmdHookPermission() {
  const stop2 = new AbortController();
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.once(sig, () => stop2.abort());
  try {
    const input = parseHookInput(await readStdin());
    if (!input) return 0;
    const r = await ask(input, { signal: stop2.signal });
    const output = r ? hookOutput(r.question, r.answer) : null;
    if (output) process.stdout.write(JSON.stringify(output));
  } catch (e) {
    process.stderr.write(`acc hook permission: ${e.message}
`);
  }
  return 0;
}
var area7 = {
  help: {
    section: "Environments",
    order: 51,
    lines: `  acc hook permission                   Claude Code's PermissionRequest hook: puts an agent's prompt in the
                                        Command Center, when one is open, and waits for the answer`
  },
  subcommands: { hook: ["permission", "session-start", "pre-tool-use", "stop"] },
  commands: {
    hook: (_o, rest) => {
      if (rest[0] === "permission") return cmdHookPermission();
      if (rest[0] === "session-start" || rest[0] === "pre-tool-use" || rest[0] === "stop") return cmdHookEvent(rest[0]);
      process.stderr.write("acc hook takes permission, session-start, pre-tool-use or stop.\n");
      return 1;
    }
  }
};

// packages/cli/src/commands/updates.ts
import { mkdtempSync as mkdtempSync7, rmSync as rmSync20, writeFileSync as writeFileSync31 } from "node:fs";
import { tmpdir as tmpdir8 } from "node:os";
import { join as join38 } from "node:path";
function personOnlyUpdate(o, what) {
  if (process.env.ACC_ROLE === "analyst") throw new AccError("refused", `An analyst can't ${what}. A person does that.`);
  return personOnly(o, what);
}
function updateLines(u) {
  const state = u.state === "posting" ? stalePosting(u, now()) ? tone("may have posted", "orange") : "posting" : u.state === "draft" ? tone("draft", "orange") : u.state;
  const when2 = u.posted ? `posted by ${u.posted.by.replace(/^human:/, "")} ${u.posted.at}` : u.discarded ? `discarded by ${u.discarded.by.replace(/^human:/, "")} ${u.discarded.at}` : `drafted by ${u.by.replace(/^human:/, "")} ${u.createdAt}`;
  return [
    `${u.id.padEnd(12)} ${state}  ${trackerName(u.tracker)} ${u.key}: ${EVENT_WORDS[u.event]}${u.env ? ` (${u.env})` : ""}  ${tone(when2, "dim")}`,
    ...u.failed && u.state === "draft" ? [tone(`    ! The last try didn't post: ${u.failed.reason}`, "orange")] : [],
    ...(u.posted?.text ?? u.text).split("\n").map((l3) => `    ${l3}`)
  ];
}
function cmdUpdates(o) {
  personOnlyUpdate(o, "read the ticket updates");
  const { paths } = project(process.cwd());
  const task = o.task?.toUpperCase();
  const list = listUpdates(paths).filter((u) => (o.all || isOpenUpdate(u)) && (!task || u.task === task));
  out(o, () => list.length ? [...list.flatMap((u) => [...updateLines(u), ""]), tone("Post one from the Command Center, or a GitHub issue's with acc update post <id>. acc update discard <id> sets one aside.", "dim")].join("\n") : o.all ? "No ticket updates yet." : "No drafts waiting. acc updates --all shows the posted and discarded too.", list);
  return 0;
}
function postText(o, u) {
  const file = o["text-file"];
  const text = (file ? readFileArg(file) : u.text).trim();
  if (!text) throw new AccError("usage", "There's nothing to post: the text is empty.");
  if (text.length > UPDATE_TEXT_MAX) throw new AccError("usage", `The text is ${text.length} characters, more than a post takes (${UPDATE_TEXT_MAX}).`);
  return text;
}
var updateOrThrow = (paths, id) => {
  const u = readUpdate(paths, id.toUpperCase());
  if (!u) throw new AccError("no-update", `No update ${id}. acc updates lists them.`);
  return u;
};
function cmdUpdatePost(o, id) {
  const by = personOnlyUpdate(o, "post a ticket's update");
  const { paths, config } = project(process.cwd());
  const u = updateOrThrow(paths, id);
  if (u.tracker !== "github") throw new AccError("refused", `${u.id} is for ${trackerName(u.tracker)} ticket ${u.key}. acc posts only on GitHub: post it from the Command Center, which posts as you through this repo's ${trackerName(u.tracker)} sign-in.`);
  const text = postText(o, u);
  const gh = config.github;
  if (!gh) throw new AccError("no-github", `This project has no "github" section in .acc/config.json, so acc can't post as its account.`);
  const issue = githubIssue(u, gh.repo);
  if (!issue) throw new AccError("refused", `${u.id}'s ticket ${u.key} isn't a GitHub issue acc can find.`);
  const env = { ...process.env, GH_TOKEN: ghToken(run, gh.account) };
  const repo = config.trackers.find((t) => t.kind === "github")?.repo ?? gh.repo;
  const seen = run("gh", ["issue", "view", issue.number, "-R", issue.repo, "--json", "url"], { cwd: paths.root, env, timeoutMs: GH_TIMEOUT_MS2 });
  let lives = null;
  try {
    lives = seen.code === 0 ? issueRepo(JSON.parse(seen.stdout).url) : null;
  } catch {
    lives = null;
  }
  if (lives && lives.toLowerCase() !== repo.toLowerCase()) {
    throw new AccError("refused", `${u.key} is in ${lives} now, not this repo's ${repo}, so ${u.id} isn't posted. Discard it if it no longer applies: acc update discard ${u.id}`);
  }
  claimUpdate(paths, u.id, by, now, { again: o.again === true });
  const dir = mkdtempSync7(join38(tmpdir8(), "acc-update-"));
  try {
    const file = join38(dir, "body.md");
    writeFileSync31(file, text + "\n");
    const r = run("gh", ["issue", "comment", issue.number, "-R", issue.repo, "--body-file", file], { cwd: paths.root, env, timeoutMs: GH_TIMEOUT_MS2 });
    if (r.code !== 0) {
      const why = (r.stderr || r.stdout).trim().split("\n")[0] || `gh exited with ${r.code}.`;
      if (r.timedOut) throw new AccError("unconfirmed", `${u.id} may have posted on ${u.key}: ${why} Look at the issue before you post it again with --again.`);
      releaseUpdate(paths, u.id, why, now);
      throw new AccError("post", `Couldn't post ${u.id} on ${u.key}: ${why}`);
    }
    const url = r.stdout.split("\n").map((l3) => l3.trim()).find((l3) => /^https:\/\/github\.com\//.test(l3));
    const posted = markPosted(paths, u.id, { by, text, ...url ? { url } : {} }, now);
    out(o, () => tone(`\u2713 Posted ${u.id} on ${u.key} as ${gh.account}${url ? `: ${url}` : "."}`, "blue"), posted);
    return 0;
  } finally {
    rmSync20(dir, { recursive: true, force: true });
  }
}
function cmdUpdateStep(o, step, id) {
  const by = personOnlyUpdate(o, "post a ticket's update");
  const { paths } = project(process.cwd());
  const u = updateOrThrow(paths, id);
  const r = step === "posting" ? claimUpdate(paths, u.id, by, now, { again: o.again === true }) : step === "posted" ? markPosted(paths, u.id, { by, text: postText(o, u), ...typeof o.url === "string" && /^https?:\/\//.test(o.url) ? { url: o.url } : {} }, now) : releaseUpdate(paths, u.id, o.reason ?? "", now);
  out(o, () => step === "posting" ? `${u.id} is being posted by ${by.replace(/^human:/, "")}.` : step === "posted" ? tone(`\u2713 ${u.id} is recorded as posted on ${u.key}.`, "blue") : `${u.id} is a draft again.`, r);
  return 0;
}
function cmdUpdateDiscard(o, id) {
  const by = personOnlyUpdate(o, "discard a ticket's update");
  const { paths } = project(process.cwd());
  const u = discardUpdate(paths, updateOrThrow(paths, id).id, by, now);
  out(o, () => `Discarded ${u.id}. It's kept, and never posted.`, u);
  return 0;
}
function cmdUpdateAsk(o, id, q2) {
  const by = personOnlyUpdate(o, "draft a question for the client");
  const { paths } = project(process.cwd());
  const taskId = id.toUpperCase();
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === taskId);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  const a2 = readAnalysis(paths, taskId);
  if (!a2) throw new AccError("no-analysis", `${taskId} hasn't been analyzed yet: acc analyze ${taskId}.`);
  const question = a2.questions.find((x2) => x2.id === q2.toLowerCase() || x2.id === `q${q2}`);
  if (!question) throw new AccError("usage", `${taskId}'s analysis has no question ${q2}. It has: ${a2.questions.map((x2) => x2.id).join(", ") || "none"}.`);
  const u = draftUpdate(paths, task, { event: "question", question: question.id, text: updateText("question", { question: question.question }) }, by, now);
  if (!u) throw new AccError("refused", `${taskId} has no ticket to post a question on: it's a task acc alone keeps.`);
  out(o, () => `Drafted ${question.id} for ${u.key} (${u.id}). Read and edit it before you post it.
${u.text.split("\n").map((l3) => `    ${l3}`).join("\n")}`, u);
  return 0;
}
function cmdUpdate(o, sub, args) {
  const usage = "acc update post <id> [--text-file <f>] [--again] | acc update discard <id> | acc update ask <task> <q>";
  if (sub === "ask") {
    if (!args[0] || !args[1]) throw new AccError("usage", "acc update ask <task> <q>");
    return cmdUpdateAsk(o, args[0], args[1]);
  }
  if (!args[0]) throw new AccError("usage", usage);
  if (sub === "post") return cmdUpdatePost(o, args[0]);
  if (sub === "discard") return cmdUpdateDiscard(o, args[0]);
  if (sub === "posting" || sub === "posted" || sub === "release") return cmdUpdateStep(o, sub, args[0]);
  throw new AccError("usage", usage);
}
var area8 = {
  help: {
    section: "Ticket updates (acc drafts them; only a person posts)",
    order: 40,
    lines: `  acc updates [--all] [--task <id>]     The drafts waiting for a person; --all adds the posted and discarded
  acc update post <id> [--text-file <f>] [--again]
                                        Post a draft on its GitHub issue as the repo's account, with the text
                                        in <f> if you edited it. Jira and Azure DevOps post from the Command Center
  acc update discard <id>               Set a draft aside: it's kept, and never posted
  acc update ask <id> <q>               Draft one of the task's analysis's questions for the client`
  },
  options: {
    all: { type: "boolean", default: false },
    task: { type: "string" },
    reason: { type: "string" },
    "text-file": { type: "string" },
    again: { type: "boolean", default: false },
    url: { type: "string" }
  },
  subcommands: { update: ["post", "discard", "ask", "posting", "posted", "release"] },
  commands: {
    updates: (o) => cmdUpdates(o),
    update: (o, rest) => cmdUpdate(o, rest[0], rest.slice(1))
  }
};

// packages/cli/src/commands/pipeline.ts
function cmdReview(o, id) {
  const { paths, config } = project(process.cwd());
  const { by } = actorFrom(o);
  const say = (line) => {
    if (!o.json) process.stderr.write(line + "\n");
  };
  const r = followingCards(paths, config, () => review(paths, config, id.toUpperCase(), {
    run,
    now,
    env: process.env,
    onStart: (session, sha, name) => say(tone(`Reviewing ${id.toUpperCase()} at ${sha.slice(0, 7)}. The reviewer reads and changes nothing. Session ${session}, named ${name}.`, "dim"))
  }, { by: `reviewer:${id.toUpperCase()} for ${by}` }));
  const v = r.verdict;
  const where = (f) => f.file ? `${f.file}${f.line ? `:${f.line}` : ""}  ` : "";
  out(o, () => [
    v.verdict === "pass" ? tone(`\u2713 Review passed: ${v.summary}`, "blue") : tone(`\u21BA Changes asked for: ${v.summary}`, "orange"),
    ...v.criteria.length ? ["", "Acceptance criteria", ...v.criteria.map((c) => `  ${c.met ? "\u2713" : "\u2717"} ${c.text}${c.evidence ? tone(`  ${c.evidence}`, "dim") : ""}`)] : [],
    ...v.findings.length ? ["", "Findings", ...v.findings.map((f) => `  ${f.must ? "!" : "\xB7"} ${where(f)}${f.message}`)] : [],
    "",
    r.moved === "rework" ? `${id.toUpperCase()} \u2192 ${stateLabel("rework")}. Re-dispatch it, and the builder gets these findings.` : `${id.toUpperCase()} stays in review, ready to land.`
  ].join("\n"), r);
  return v.verdict === "pass" ? 0 : 1;
}
function analysisLines(a2) {
  const head = a2.verdict === "ready" ? tone(`\u2713 Ready to build: ${a2.summary}`, "blue") : a2.verdict === "split" ? tone(`! Too big for one task: ${a2.summary}`, "orange") : tone(`? ${openQuestions(a2).length} question${openQuestions(a2).length === 1 ? "" : "s"} for you: ${a2.summary}`, "orange");
  const list = (title, xs) => xs.length ? ["", title, ...xs.map((x2) => `  - ${x2}`)] : [];
  return [
    head,
    ...a2.questions.length ? ["", "Questions", ...a2.questions.map((q2) => `  ${q2.id}. ${q2.question}${q2.answer ? tone(`  \u2192 ${q2.answer.text}`, "blue") : tone(`  (suggested: ${q2.suggested})`, "dim")}`)] : [],
    ...list("Acceptance criteria", a2.requirements.criteria),
    // The wording check on its requirements (T-12): advice, never a hold.
    ...a2.wording?.length ? ["", tone(`! ${wordingWords(a2.wording.length)}`, "orange"), ...a2.wording.map((f) => `  - ${wordingPlace(f)}: ${f.message} [${f.match}]`)] : [],
    ...list("What is there now", a2.findings.map((f) => `${f.area}: ${f.detail}${f.source ? tone(`  ${f.source}`, "dim") : ""}`)),
    ...list("Approach", a2.approach.plan),
    ...list("Refactors first", a2.approach.refactors.map((r) => `${r.what}: ${r.why}`)),
    ...list("Risks", a2.approach.risks),
    ...list("Tests", a2.approach.tests),
    ...a2.split.length ? list("Split into", a2.split) : [],
    "",
    tone(`Size ${a2.approach.size}. ${a2.orgs.length ? `Read ${a2.orgs.join(", ")}. ` : ""}Session ${a2.sessionId}.`, "dim")
  ];
}
function cmdAnalyze(o, id) {
  const by = personOnly(o, "analyze a task");
  const { paths, config } = project(process.cwd());
  const say = (line) => {
    if (!o.json) process.stderr.write(line + "\n");
  };
  const a2 = analyze(paths, config, id.toUpperCase(), {
    run,
    now,
    env: process.env,
    accCommand: accCommand(),
    steps: steps(),
    onStart: (session, name) => say(tone(`Analyzing ${id.toUpperCase()}. The analyst reads the ticket${config.profile === "salesforce" ? ", the code and the orgs" : " and the code"}, and changes nothing. Session ${session}, named ${name}.`, "dim"))
  }, { by: `analyst:${id.toUpperCase()} for ${by}` });
  out(o, () => analysisLines(a2).join("\n"), a2);
  const asks = openQuestions(a2).length;
  steps().result(true, a2.verdict === "ready" ? `${a2.task} is ready to build.` : a2.verdict === "split" ? `${a2.task} is too big for one task.` : `${a2.task}'s analysis has ${asks} question${asks === 1 ? "" : "s"} for you.`);
  return a2.verdict === "ready" ? 0 : 1;
}
function cmdShowAnalysis(o, id) {
  const { paths } = project(process.cwd());
  const a2 = readAnalysis(paths, id.toUpperCase());
  if (!a2) throw new AccError("no-analysis", `${id.toUpperCase()} hasn't been analyzed yet: acc analyze ${id.toUpperCase()}.`);
  out(o, () => analysisLines(a2).join("\n"), a2);
  return 0;
}
function cmdAnswerAnalysis(o, id, q2, text) {
  const by = personOnly(o, "answer an analysis's questions");
  const { paths } = project(process.cwd());
  const a2 = answerAnalysis(paths, id.toUpperCase(), q2, text, by, now);
  const open = openQuestions(a2);
  out(o, () => open.length ? `Answered. ${open.length} to go: ${open.map((x2) => x2.id).join(", ")}.` : tone(`Answered. ${a2.task} is ready to build: acc dispatch ${a2.task}.`, "blue"), a2);
  return 0;
}
function cmdLand(o, id) {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  if (actor === "builder") throw new AccError("refused", "A builder never lands its own work. A person does, once it's reviewed.");
  const r = followingCards(paths, config, () => land(paths, config, id.toUpperCase(), { run, now, env: process.env, steps: steps() }, { actor, by }));
  steps().result(true, `${r.opened ? "Opened" : "Updated"} pull request #${r.pr.number} for ${r.task.id}.`);
  out(o, () => [
    `${r.task.id}: ${r.opened ? "opened" : "updated"} pull request #${r.pr.number}  ${r.pr.url}`,
    r.update ? `  Drafted an update for ${r.update.key} (${r.update.id}). Nothing is posted until a person posts it: acc updates.` : "",
    r.updateError ? tone(`! No update was drafted for ${r.task.id}'s ticket: ${r.updateError}`, "orange") : "",
    r.pr.conflicts?.length ? tone(`! Pull request #${r.pr.number} conflicts with ${r.task.environment} in ${r.pr.conflicts.join(", ")}. GitHub can't merge it until that's resolved.`, "orange") : "",
    tone(autoMergeFor(config, r.task.environment) ? mergesWords(true) : "It merges only when a person merges it on GitHub.", "dim")
  ].filter(Boolean).join("\n"), r);
  return 0;
}
function autopilotLines(r) {
  const lines = [];
  for (const s of r.steps) {
    if (s.outcome === "done") lines.push(`${tone(`\u2713 ${s.task}  ${s.reason}`, "blue")}${s.pr ? `  ${s.pr.url}` : ""}`);
    else if (s.outcome === "failed") lines.push(tone(`! ${s.task}  Couldn't ${stepWords(s.step, s.sha ?? "")}: ${s.reason}`, "orange"), tone(s.step === "start" ? `    It isn't tried again until a person dispatches it, or stops it waiting: acc dispatch ${s.task} --stop-waiting` : "    It isn't tried again on this commit. Do it by hand, or a new commit lets autopilot try again.", "dim"));
    else if (s.outcome === "waiting") lines.push(tone(`\u2026 ${s.task}  Waiting: ${s.reason}`, "dim"));
  }
  for (const u of r.updates) lines.push(`  Drafted an update for ${u.key} (${u.id}): acc updates`);
  const idle = r.steps.filter((s) => s.outcome === "skipped").length;
  if (!lines.length) lines.push("Nothing for autopilot to do.");
  else if (idle) lines.push(tone(`${idle} other task${idle === 1 ? "" : "s"}: nothing to do.`, "dim"));
  return lines;
}
function cmdAutopilot(o) {
  const role = process.env.ACC_ROLE;
  if (role === "builder" || role === "reviewer" || role === "analyst") throw new AccError("refused", `A ${role} can't run autopilot. A person starts it.`);
  if (o.once && o.every !== void 0) throw new AccError("usage", "--once is one pass and --every repeats them: give one or the other.");
  const every = o.every === void 0 ? 0 : Number(o.every);
  if (o.every !== void 0 && (!Number.isInteger(every) || every < AUTOPILOT_MIN_EVERY_S)) {
    throw new AccError("usage", `--every takes whole seconds, at least ${AUTOPILOT_MIN_EVERY_S}: the gap between one pass ending and the next starting.`);
  }
  const start = project(process.cwd());
  const { paths } = start;
  const mode = autopilotMode(start.config);
  for (const w of mode.warnings) process.stderr.write(`warning: ${w}
`);
  if (mode.refusal) throw new AccError("refused", mode.refusal);
  if (!mode.on) {
    out(
      o,
      () => `autonomy is "manual" in .acc/config.json, so autopilot does nothing. Set it to "review" for autopilot to act: it then ${autopilotDoes(autoMergeOn(start.config))}`,
      { autonomy: mode.autonomy, warnings: mode.warnings, steps: [], updates: [] }
    );
    return 0;
  }
  if (!start.config.github) throw new AccError("no-github", 'Autopilot lands reviewed work as pull requests on GitHub, and this project has no "github" section in .acc/config.json.');
  const say = (line) => {
    if (!o.json) process.stderr.write(tone(line, "dim") + "\n");
  };
  const doing = { review: "Reviewing", land: "Landing", dispatch: "Re-dispatching", refresh: "Updating", resume: "Resuming", checks: "Sending back", merge: "Merging", start: "Starting", queue: "Taking" };
  const after = { review: ". The reviewer reads and changes nothing.", land: "", dispatch: "", refresh: " from its base, then running its checks.", resume: ": its builder stopped before acc done or acc block.", checks: " to its builder: its checks failed on GitHub. Reading their logs.", merge: ": its review and checks passed. GitHub is asked again first.", start: ": a person dispatched it, and it waited for another task's files.", queue: " through the merge queue: its base is merged in if it moved on, the full check runs once, then it's pushed, or merged." };
  const parent = Number(process.env.ACC_AUTOPILOT_PARENT);
  const orphaned = () => Number.isInteger(parent) && parent > 0 && !alive(parent);
  const closed = "The Command Center that started autopilot closed, so it stops.";
  const wait = (seconds) => {
    for (let left = seconds * 1e3; left > 0 && !orphaned(); left -= 1e3) sleep(Math.min(1e3, left));
    return !orphaned();
  };
  return holdAutopilot(paths, () => {
    let config = start.config;
    for (; ; ) {
      if (orphaned()) {
        say(closed);
        return 0;
      }
      const r = followingCards(paths, config, () => autopilotPass(paths, config, {
        run,
        now,
        env: process.env,
        accBinDir: accBinDir(),
        accCommand: accCommand(),
        stop: orphaned,
        onStep: (task, step, sha) => say(`\u2026 ${doing[step]} ${task}${sha ? ` at ${sha.slice(0, 7)}` : ""}${after[step]}`)
      }));
      const data = { autonomy: mode.autonomy, warnings: mode.warnings, steps: r.steps, updates: r.updates };
      if (!every) {
        out(o, () => autopilotLines(r).join("\n"), data);
        return r.steps.some((s) => s.outcome === "failed") ? 1 : 0;
      }
      if (o.json) process.stdout.write(JSON.stringify({ at: now().toISOString(), ...data }) + "\n");
      else process.stdout.write([tone(`Autopilot pass at ${now().toLocaleTimeString()}`, "dim"), ...autopilotLines(r)].join("\n") + "\n");
      if (!wait(every)) {
        say(closed);
        return 0;
      }
      config = project(process.cwd()).config;
      if (!autopilotMode(config).on) {
        say(`autonomy is "${config.autonomy}" now, so autopilot stops.`);
        return 0;
      }
    }
  });
}
function cmdSync(o) {
  const closeDone = o["close-done"] === true;
  const plan = o.plan === true;
  if (plan && !closeDone) throw new AccError("usage", "--plan goes with --close-done: acc sync --close-done --plan");
  const by = closeDone ? personOnlyUpdate(o, "close the issues of tasks already done") : null;
  const { paths, config } = project(process.cwd());
  if (o["branches-seen"] === true) {
    personOnlyUpdate(o, "clear a branch's move");
    const cleared = clearBranchMoves(paths);
    out(o, () => cleared.length ? `Cleared the move${cleared.length === 1 ? "" : "s"} on ${cleared.join(", ")}. The next sync starts from where each branch stands now.` : "No environment branch has a move waiting for a person.", { cleared });
    return 0;
  }
  const r = closeDone && plan ? { checked: 0, changes: [], cloud: [], branches: [] } : followingCards(paths, config, () => sync(paths, config, { run, now, env: process.env }));
  const lines = [
    ...r.checked ? [`Checked ${r.checked} open pull request${r.checked === 1 ? "" : "s"}.`] : [],
    ...r.changes.map((c) => `  ${c.task}: ${c.note}${c.moved ? ` \u2192 ${stateLabel(c.moved.to)}` : ""}${c.update ? `. Drafted an update for ${c.update.key} (${c.update.id})` : ""}`),
    // Each cloud builder's branch (GH-69), and each environment branch that moved by anything but acc's merges.
    ...r.cloud.filter((c) => c.outcome !== "unchanged").map((c) => tone(`  ${c.task} (cloud): ${c.note}`, c.outcome === "collect-failed" || c.outcome === "unreachable" ? "orange" : "blue")),
    // Every move still waiting for a person, each run, until acc sync --branches-seen (GH-69).
    ...r.branches.map((m) => tone(`! ${moveWords(m)}${config.github ? ` ${moveUrl(config.github.repo, m)}` : ""} Once you have: acc sync --branches-seen`, "orange"))
  ];
  if (!by) {
    out(o, () => lines.length ? lines.join("\n") : "No open pull requests, cloud builders or branch moves to follow.", r);
    return 0;
  }
  if (!closesIssues(config)) {
    out(o, () => [...lines, 'No GitHub tracker here says "edits": true, so acc closes no issues.'].join("\n"), { ...r, closeDone: [] });
    return 0;
  }
  const env = { ...process.env, GH_TOKEN: ghToken(run, config.github.account) };
  const closes = settleCloses(paths, config, { run, now, env }, { tidy: true, plan, actor: "human", by });
  out(o, () => [
    ...lines,
    !closes.length ? "No done task's issue is waiting to close." : plan ? "The done tasks whose issues the tidy would close (nothing is changed). A sync may also close those of tasks merged since it last ran:" : "The issues of tasks already done:",
    ...closes.map((c) => `  ${c.task} (pull request #${c.pr}): ${closeWords(c, plan)}`),
    plan && closes.some((c) => c.outcome === "to close") ? tone("Close them with acc sync --close-done.", "dim") : ""
  ].filter(Boolean).join("\n"), { ...r, closeDone: closes, ...plan ? { plan: true } : {} });
  return 0;
}
var area9 = {
  help: {
    section: "Agents",
    order: 31,
    lines: `  acc analyze <id>                      Before the build: a read-only analyst works out the requirements, what's
                                        there now (the code, and on Salesforce the orgs), the approach, and questions
  acc analysis <id>                     What the task's analysis found
  acc analysis answer <id> <q> "<text>" Answer one of its questions; when the last is answered, it's ready to build
  acc review <id>                       A read-only reviewer agent judges the task's latest commit:
                                        pass, or changes (back to rework, with its findings)
  acc land <id>                         Push a reviewed task's branch and open its pull request; it never merges it
  acc autopilot [--once | --every <seconds>]
                                        With "autonomy": "review", take each task's next step on its own: review it,
                                        land it, re-dispatch a rework once, resume a stopped builder once, or merge
                                        the base into a pull request that conflicts with it. It merges a pull request
                                        only where auto-merge is on: reviewed, its checks passed, nothing waiting on
                                        a person, in turn through the repo's merge queue. One pass, or one every
                                        <seconds> (at least 30) until stopped; --json then prints a line a pass
  acc sync                              Follow open pull requests: merged \u2192 done, closed \u2192 blocked, failing checks or conflicts \u2192 needs you.
                                        Where the GitHub tracker says "edits": true, a task's issue closes when it
                                        merges to done, with a comment naming the pull request
  acc sync --branches-seen              Clear the notice of an environment branch that moved by anything but acc's
                                        own merges, once a person has looked
  acc sync --close-done [--plan]        A person's one-off tidy: close the issues of tasks done before acc closed
                                        them, under the same rule, listing each. --plan lists them, changing nothing`
  },
  options: {
    once: { type: "boolean", default: false },
    every: { type: "string" },
    plan: { type: "boolean", default: false },
    "close-done": { type: "boolean", default: false },
    "branches-seen": { type: "boolean", default: false }
  },
  subcommands: { analysis: ["answer"] },
  commands: {
    analyze: (o, rest) => {
      if (!rest[0]) throw new AccError("usage", "acc analyze <id>");
      return cmdAnalyze(o, rest[0]);
    },
    analysis: (o, rest) => {
      if (rest[0] === "answer") {
        if (!rest[1] || !rest[2] || !rest[3]) throw new AccError("usage", 'acc analysis answer <id> <q> "<answer>"');
        return cmdAnswerAnalysis(o, rest[1], rest[2], rest.slice(3).join(" "));
      }
      if (!rest[0]) throw new AccError("usage", "acc analysis <id>");
      return cmdShowAnalysis(o, rest[0]);
    },
    review: (o, rest) => {
      if (!rest[0]) throw new AccError("usage", "acc review <id>");
      return cmdReview(o, rest[0]);
    },
    land: (o, rest) => {
      if (!rest[0]) throw new AccError("usage", "acc land <id>");
      return cmdLand(o, rest[0]);
    },
    autopilot: (o) => cmdAutopilot(o),
    sync: (o) => cmdSync(o)
  }
};

// packages/cli/src/commands/rules.ts
var STATE = {
  unchanged: { words: "\u2713 unchanged at its source", look: "blue" },
  changed: { words: "\u21BB changed at its source", look: "orange" },
  unreachable: { words: "? its source couldn't be read", look: "orange" },
  "not-here": { words: "\u2013 its source isn't on this machine", look: "dim" },
  unchecked: { words: "? not checked in time", look: "orange" },
  "bad-header": { words: "? its header can't be read", look: "orange" },
  local: { words: "\u2013 kept here, with no source", look: "dim" }
};
var short6 = (sha) => sha ? sha.slice(0, 7) : null;
var when = (c) => [short6(c.commit) ? `commit ${short6(c.commit)}` : "", c.copied ? `copied ${c.copied}` : ""].filter(Boolean).join(", ");
function accountFor(o, root, sources) {
  const github = sources.some((s) => {
    try {
      return !!s && parseSource(s, root, void 0, "rules").kind === "github";
    } catch {
      return false;
    }
  });
  return github ? templateAccount(run, root, o["github-account"]) : null;
}
function cmdImport(o, source) {
  if (!source) throw new AccError("usage", "acc rules import <path | GitHub file URL | git-url#path> [--name <name>] [--force] [--dry-run]");
  const dryRun = o["dry-run"] === true;
  if (!dryRun) personOnly(o, "copy rules into the repo");
  const { root } = repoPaths(process.cwd(), run);
  const r = importRules(run, root, source, {
    name: o.name,
    force: o.force === true,
    dryRun,
    account: accountFor(o, root, [source]),
    base: process.cwd(),
    now
  });
  const lines = r.text.replace(/\n$/, "").split("\n");
  const at2 = r.header.commit ? `at commit ${short6(r.header.commit)}` : `on ${r.header.copied}`;
  const replaced = r.replaces ? `${r.written ? "It replaced" : "It would replace"} the copy${r.replaces.source ? ` from ${r.replaces.source}` : ""}${r.replaces.copied ? `, copied on ${r.replaces.copied}` : ""}${r.replaces.edited ? ", and the edits made to it here" : ""}.` : null;
  out(o, () => [
    r.written ? `Copied ${source.trim()} into ${r.file}, ${at2}.` : `Would copy ${source.trim()} into ${r.file}, ${at2}: ${lines.length} lines. Nothing was written.`,
    ...replaced ? [replaced] : [],
    ...r.replaces && !r.written && !o.force ? [tone(`${r.file} is already here: add --force to replace it, or --name to keep both.`, "orange")] : [],
    ...r.written ? [`Review it, then commit it. Builders and reviewers read it once it's on an environment's branch, and acc never updates it on its own: Setup says when ${r.header.source} changes.`] : []
  ].join("\n"), {
    written: r.written,
    name: r.name,
    file: r.file,
    source: r.header.source,
    commit: r.header.commit,
    copied: r.header.copied,
    sha256: r.header.sha256,
    bytes: Buffer.byteLength(r.text),
    lines: lines.length,
    exists: !!r.replaces,
    replaces: r.replaces,
    preview: lines.slice(0, 15)
  });
  return 0;
}
var sourcesIn = (root) => importedRules(root).map((c) => c.header?.source ?? null);
function statusOf2(o, root) {
  return rulesStatus(run, root, { account: accountFor(o, root, sourcesIn(root)), base: root });
}
function cmdList2(o) {
  const { root } = repoPaths(process.cwd(), run);
  const all = statusOf2(o, root);
  out(o, () => {
    if (!all.length) return "No rules are copied in. acc rules import <source> copies one into .acc/rules/.";
    const rows = [["Copy", "Source", "When", "Now"], ...all.map((c) => [
      c.file,
      c.source ?? "\u2013",
      when(c) || "\u2013",
      tone(`${STATE[c.state].words}${c.edited ? ", edited here" : ""}`, STATE[c.state].look)
    ])];
    const changed = all.filter((c) => c.state === "changed");
    return [
      table(rows),
      ...all.filter((c) => c.reason && c.state !== "not-here").map((c) => `note: ${c.file}: ${c.reason}`),
      ...changed.length ? ["", `See what changed: acc rules diff${changed.length === 1 ? ` ${changed[0].name}` : ""}`] : []
    ].join("\n");
  }, all.map(({ body: _body, now: _now, ...c }) => c));
  return 0;
}
function cmdDiff(o, name) {
  const { root } = repoPaths(process.cwd(), run);
  const diffs = rulesDiff(run, root, name, { account: accountFor(o, root, sourcesIn(root)), base: root });
  out(o, () => {
    if (!diffs.length) return "No rules are copied in. acc rules import <source> copies one into .acc/rules/.";
    return diffs.map((d) => {
      const head = `${d.file}${d.source ? `, from ${d.source}` : ""}: ${STATE[d.state].words.replace(/^\S+ /, "")}${d.edited ? ", and edited here" : ""}.`;
      return [
        tone(head, STATE[d.state].look),
        ...d.reason && d.state !== "unchanged" ? [`  ${d.reason}`] : [],
        ...d.diff ? [d.diff] : [],
        ...d.diff && d.edited ? ["This copy was edited in this repo: copying it in again replaces those edits."] : [],
        ...d.diff ? [`To copy it in again, replacing this copy: ${reimportCommand(d)}`] : []
      ].join("\n");
    }).join("\n\n");
  }, diffs);
  return 0;
}
function personOnlyRule(o, what) {
  if (process.env.ACC_ROLE === "analyst") throw new AccError("refused", `An analyst can't ${what}. A person does that.`);
  return personOnly(o, what);
}
var isHidden = (s) => "hidden" in s;
function suggestionLines(s) {
  const look2 = s.kind === "check" ? tone("Check suggested", "blue") : tone("Rule suggested", "blue");
  const counts = `${s.findings} findings across ${s.tasks} tasks${s.must ? ` (${s.must} must)` : ""}`;
  const hidden = isHidden(s) ? `${s.hidden.outcome} by ${s.hidden.by.replace(/^human:/, "")} ${s.hidden.at.slice(0, 10)}: back after ${s.hidden.more} more` : "";
  return [
    `${s.id}  ${look2}  ${counts}${hidden ? `  ${tone(hidden, "dim")}` : ""}`,
    ...s.kind === "check" ? [`    ${s.written ? `Already a rule (${s.written}).` : "Accepted as a rule before."} It keeps coming back: add a check.`] : [],
    `    ${s.line}`,
    ...s.sources.map((x2) => tone(`      ${x2.task}  ${x2.sha.slice(0, 7)}  ${x2.at.slice(0, 10)}  ${x2.file ? `${x2.file}${x2.line ? `:${x2.line}` : ""}` : "\u2013"}${x2.must ? "  must" : ""}${x2.counted ? "" : "  (said again, not counted)"}`, "dim"))
  ];
}
function cmdSuggested(o) {
  const { paths } = project(process.cwd());
  const list = suggestRules(paths, { all: o.all === true });
  out(o, () => list.length ? [...list.flatMap((s) => [...suggestionLines(s), ""]), tone("Accept one from the Command Center, or with acc rules accept <id>: it drafts a task a person confirms. acc rules dismiss <id> sets one aside.", "dim")].join("\n") : "No review finding keeps coming back: a rule is suggested at 3 findings across 2 tasks.", list);
  return 0;
}
function suggestionId(id, usage) {
  const x2 = (id ?? "").toLowerCase();
  if (!SUGGESTION_ID.test(x2)) throw new AccError("usage", usage);
  return x2;
}
function cmdAccept(o, raw) {
  const id = suggestionId(raw, "acc rules accept <id> [--line <text>] [--title <text>] [--check lint|test|gate|any|none] [--note <text>]");
  const by = personOnlyRule(o, "accept a suggested rule");
  const check2 = o.check;
  if (check2 !== void 0 && !CHECK_ASKS.includes(check2)) throw new AccError("usage", `--check is ${CHECK_ASKS.join(", ")}, not "${check2}".`);
  const { paths, config } = project(process.cwd());
  const r = acceptSuggestion(paths, config, id, {
    ...typeof o.line === "string" ? { line: o.line } : {},
    ...typeof o.title === "string" ? { title: o.title } : {},
    ...check2 ? { check: check2 } : {},
    ...typeof o.note === "string" ? { note: o.note } : {}
  }, "human", by, now);
  out(o, () => [
    tone(`\u2713 Added ${r.task}: ${r.input.title}`, "blue"),
    `  It's in To do. Its brief holds the rule${r.input.brief?.includes("- [ ] A ") ? ", the check it asks for," : ""} and the ${r.record.findings.length} findings it came from.`,
    "  acc never writes .acc/rules.md: the task does, and a person merges its pull request."
  ].join("\n"), { task: r.task, title: r.input.title, brief: r.input.brief, record: r.record });
  return 0;
}
function cmdDismiss(o, raw) {
  const id = suggestionId(raw, "acc rules dismiss <id>");
  const by = personOnlyRule(o, "dismiss a suggested rule");
  const { paths } = project(process.cwd());
  const r = dismissSuggestion(paths, id, by, now);
  out(o, () => `Dismissed ${id}. It stays hidden until its finding comes back 3 more times.`, r);
  return 0;
}
var area10 = {
  help: {
    section: "Setup",
    order: 15,
    lines: `  acc rules import <source> [--name <name>] [--force] [--dry-run] [--github-account <a>]
                                        Copy a team's rules file into .acc/rules/, with where it came from:
                                        a path, a GitHub file URL, or <git-url>#<path>. You review and commit it
  acc rules list                        Each copy, where it came from, and whether its source has changed
  acc rules diff [<name>]               How each copy differs from its source now. It changes nothing
  acc rules suggested [--all]           Review findings that keep coming back (3 across 2 tasks), each offered as
                                        a rule for .acc/rules.md, or as a check where it's already a rule. --all
                                        adds the ones a person accepted or dismissed
  acc rules accept <id> [--line <text>] [--title <text>] [--check lint|test|gate|any|none] [--note <text>]
                                        Add the drafted task that adds the rule, or its check. Only a person
  acc rules dismiss <id>                Set a suggestion aside until its finding comes back 3 more times`
  },
  options: {
    name: { type: "string" },
    "github-account": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    line: { type: "string" },
    title: { type: "string" },
    check: { type: "string" },
    note: { type: "string" }
  },
  subcommands: { rules: ["import", "list", "diff", "suggested", "accept", "dismiss"] },
  commands: {
    rules: (o, rest) => {
      if (rest[0] === "import") return cmdImport(o, rest[1]);
      if (rest[0] === "list") return cmdList2(o);
      if (rest[0] === "diff") return cmdDiff(o, rest[1]);
      if (rest[0] === "suggested") return cmdSuggested(o);
      if (rest[0] === "accept") return cmdAccept(o, rest[1]);
      if (rest[0] === "dismiss") return cmdDismiss(o, rest[1]);
      throw new AccError("usage", "acc rules import <source> [--name <name>] [--force] [--dry-run] | list | diff [<name>] | suggested [--all] | accept <id> | dismiss <id>");
    }
  }
};

// packages/cli/src/commands/setup.ts
import { existsSync as existsSync27 } from "node:fs";
import { join as join39 } from "node:path";
function renderSteps(results, guided) {
  const lines = [];
  let part = "";
  for (const { step, result } of results) {
    if (step.part !== part) {
      part = step.part;
      lines.push("", part === "machine" ? "This machine" : "This project");
    }
    lines.push(`  ${checkLabel(result.status)}  ${step.id.padEnd(18)} ${step.title}`);
    if (result.status !== "pass" && result.status !== "skip") lines.push(`      ${result.detail}`);
    else if (!guided) lines.push(tone(`      ${result.detail}`, "dim"));
    if (result.status === "fail" || result.status === "unknown") {
      const fix = result.fix ?? step.fix?.command ?? step.fix?.text;
      if (fix) lines.push(`      fix: ${fix}`);
      if (result.open) lines.push(`      open: ${result.open}`);
      if (step.fix?.docs) lines.push(`      docs: ${step.fix.docs}`);
    }
  }
  const failing = results.filter((r) => r.result.status === "fail");
  const byHand = results.filter((r) => r.result.status === "unknown");
  const passed = results.filter((r) => r.result.status === "pass").length;
  lines.push("", `${passed} passed, ${failing.length} failing, ${byHand.length} to check by hand.`);
  if (guided && failing[0]) {
    const { step, result } = failing[0];
    lines.push("", tone(`Next: ${step.id}, ${step.title}`, "orange"), `  Why: ${step.why}`, `  Do:  ${result.fix ?? step.fix?.command ?? step.fix?.text ?? `see ${step.fix?.docs ?? "docs/ONBOARDING.md"}`}`);
  }
  return lines.join("\n").replace(/^\n/, "");
}
function cmdDoctor(o, guided) {
  const ctx = makeContext(process.cwd(), run, process.env, VERSION);
  const part = o.part;
  if (part && part !== "machine" && part !== "project") throw new AccError("usage", "--part must be machine or project.");
  const only = o.step ?? [];
  const unknownIds = only.filter((id) => !STEPS.some((s) => s.id === id));
  if (unknownIds.length) throw new AccError("usage", `No step ${unknownIds.join(", ")}. Run acc doctor to see them all.`);
  const results = runSteps(ctx, part, only);
  out(o, () => renderSteps(results, guided), results.map(({ step, result }) => ({
    id: step.id,
    part: step.part,
    group: step.group,
    title: step.title,
    why: step.why,
    status: result.status,
    detail: result.detail,
    fix: result.fix ?? null,
    howTo: step.fix ?? null,
    open: result.open ?? null
  })));
  return results.some((r) => r.result.status === "fail") ? 1 : 0;
}
function trackerFlag(json) {
  let t;
  try {
    t = JSON.parse(json);
  } catch {
    t = null;
  }
  if (!t || typeof t !== "object" || Array.isArray(t)) throw new AccError("usage", '--tracker must be one tracker as JSON, such as {"kind":"jira","site":"acme.atlassian.net","project":"ACME","epic":"ACME-3"}.');
  return t;
}
function cmdInit(o) {
  const paths = repoPaths(process.cwd(), run);
  const profile = o.profile;
  if (profile !== void 0 && profile !== "generic" && profile !== "salesforce") throw new AccError("usage", "--profile must be generic or salesforce.");
  if (existsSync27(paths.config) && !o.force && !o["dry-run"]) throw new AccError("exists", `${paths.config} already exists. Use --force to replace it.`);
  const tracker = o.tracker === void 0 ? void 0 : trackerFlag(o.tracker);
  const plan = planInit(run, {
    root: paths.root,
    profile,
    from: o.from,
    cwd: process.cwd(),
    project: o.project,
    productionOrg: o["production-org"],
    githubRepo: o["github-repo"],
    githubAccount: o["github-account"],
    commitName: o["commit-name"],
    commitEmail: o["commit-email"],
    jiraSite: o["jira-site"],
    jiraProject: o["jira-project"],
    tracker
  });
  const rules = plan.rules.map((source) => ({ source, name: rulesName(source) }));
  const here = rules.filter((r) => existsSync27(join39(paths.root, RULES_DIR, `${r.name}.md`)));
  const fresh = rules.filter((r) => !here.includes(r)).map((r) => r.source);
  const copies = o["dry-run"] ? [] : prepareImports(run, paths.root, fresh, { account: plan.readAs, base: process.cwd(), now });
  const kept = o["dry-run"] ? [] : here.map((r) => ({ name: r.name, file: `${RULES_DIR}/${r.name}.md` }));
  if (!o["dry-run"]) {
    writeConfig(paths.config, plan.config);
    for (const c of copies) if (!c.replaces) writeImport(c);
    rememberRepo(paths.root);
    if (o["configure-git"] && plan.config.github) configureRepoAccess(run, paths.root, plan.config.github.account, plan.config.commitIdentity);
  }
  const ruleRows = rules.map((r) => {
    const c = copies.find((x2) => x2.name === r.name);
    return { source: r.source, file: `.acc/rules/${r.name}.md`, written: !!c && !c.replaces, commit: c?.header.commit ?? null };
  });
  out(o, () => {
    const c = plan.config;
    const rows = [["Environment", "Branch", "Type", "Org alias", "Promotes to"], ...c.environments.map((e) => [
      e.name + (e.default ? " (default)" : "") + (e.protected ? " (protected)" : ""),
      e.branch,
      e.type,
      e.org ?? "(not logged in)",
      e.promotesTo.join(", ") || "\u2013"
    ])];
    const commands = Object.entries(plan.templateCommands);
    return [
      `${o["dry-run"] ? "Would write" : "Wrote"} ${paths.config}`,
      "",
      table(rows),
      "",
      `GitHub: ${c.github ? `${c.github.repo} as ${c.github.account}` : "(none)"}   Commits: ${c.commitIdentity ? `${c.commitIdentity.name} <${c.commitIdentity.email}>` : "(not set)"}`,
      ...c.template ? [
        `From the template ${c.template.name}: ${plan.fromTemplate.join(", ") || "nothing"}`,
        `Discovered: ${plan.discovered.join(", ")}`
      ] : [],
      ...commands.length ? ["", "Check commands from the template, which run on this machine:", ...commands.map(([gate, cmd]) => `  ${gate}: ${cmd}`)] : [],
      ...ruleRows.length ? [
        "",
        `Rules from the template, ${o["dry-run"] ? "which it would copy" : "copied"} into .acc/rules/ for you to review and commit:`,
        ...ruleRows.map((r) => `  ${r.file}: ${r.source}${r.written || o["dry-run"] ? "" : " (already here, so it's kept)"}`)
      ] : [],
      ...kept.map((c2) => `note: ${c2.file} is already here, so it's kept. acc rules import <source> --name ${c2.name} --force replaces it.`),
      ...plan.notes.map((n) => `note: ${n}`),
      "",
      "Next: acc doctor"
    ].join("\n");
  }, {
    written: !o["dry-run"],
    path: paths.config,
    config: plan.config,
    notes: plan.notes,
    template: plan.config.template ?? null,
    fromTemplate: plan.fromTemplate,
    discovered: plan.discovered,
    templateCommands: plan.templateCommands,
    rules: ruleRows
  });
  return 0;
}
function cmdTemplate(o, sub, source) {
  if (sub !== "show" || !source) throw new AccError("usage", "acc template show <path | GitHub file URL | git-url#path> [--json]");
  let account = null;
  if (parseSource(source).kind === "github") {
    let root = null;
    try {
      root = repoPaths(process.cwd(), run).root;
    } catch {
      root = null;
    }
    account = templateAccount(run, root, o["github-account"]);
  }
  const r = readTemplate(run, source, { account, base: process.cwd() });
  const t = r.template;
  if (!t) {
    out(o, () => [tone(`\u2717 ${source} isn't a team template acc can use:`, "orange"), ...r.errors.map((e) => `  - ${e}`)].join("\n"), { source, ok: false, errors: r.errors });
    return 1;
  }
  const commands = Object.entries(t.gates?.commands ?? {});
  const sets = describeTemplate(t);
  out(o, () => [
    t.name,
    ...t.description ? [t.description] : [],
    "",
    ...sets.length ? sets : ["It sets nothing: acc init would use what it discovers."],
    ...commands.length ? ["", "Check commands, which run on each machine that uses it:", ...commands.map(([gate, cmd]) => `  ${gate}: ${cmd}`)] : [],
    "",
    `Start a project from it: acc init --from '${source.replace(/'/g, `'\\''`)}'${t.profile === "salesforce" ? " --production-org <alias>" : ""}`
  ].join("\n"), { source, ok: true, errors: [], name: t.name, description: t.description, profile: t.profile, digest: r.digest, sets, commands: t.gates?.commands ?? {}, rules: t.rules ?? [], template: t });
  return 0;
}
function cmdSetup(o, what) {
  const { paths, config } = project(process.cwd());
  const say = (line) => {
    if (!o.json) process.stderr.write(tone(line, "dim") + "\n");
  };
  const deps = { run, now, onStep: say, steps: steps() };
  if (what === "baseline") {
    const r = buildBaseline(paths, config, deps);
    out(o, () => `Wrote ${r.file}: ${r.members} components of ${r.types} types, from ${r.from.join(", ")}.
Commit it on every environment's branch, so each is retrieved with the same list.`, r);
    steps().result(true, `Wrote the baseline: ${r.members} components of ${r.types} types.`);
    return 0;
  }
  if (what === "branches") {
    personOnly(o, "make environment branches");
    const r = seedBranches(paths, config, deps, { push: o.push === true });
    out(o, () => r.length ? r.map((b) => `  ${b.status === "made" ? "\u2713" : "\u2717"} ${b.branch.padEnd(16)} ${b.note}${b.differs !== null ? `; ${b.differs} files differ from production` : ""}`).join("\n") : "Every environment already has its branch.", r);
    const failed = r.filter((b) => b.status === "failed");
    steps().result(!failed.length, failed.length ? `${failed.map((b) => b.branch).join(", ")} couldn't be made.` : r.length ? `Made ${r.map((b) => b.branch).join(", ")}.` : "Every environment already has its branch.");
    return failed.length ? 1 : 0;
  }
  if (what === "lists") {
    const r = draftLists(paths, config, deps);
    const show = (label, d) => `${d.written ? "Wrote" : "Kept"} ${d.file}${d.written ? ` with ${d.entries.length} ${label}` : d.entries.length ? `; consider adding ${d.entries.length}: ${d.entries.slice(0, 5).join(", ")}${d.entries.length > 5 ? ", \u2026" : ""}` : ""}.`;
    out(o, () => [
      show("environment-specific paths", r.environmentSpecific),
      show("known-drift paths", r.knownDrift),
      ...r.unexplained.map((u) => `  ${u.branch}: ${u.files.length} other difference${u.files.length === 1 ? "" : "s"} from production that neither list explains: real drift, or work in progress. ${u.files.slice(0, 5).join(", ")}${u.files.length > 5 ? ", \u2026" : ""}`),
      "Read both lists before committing them: each line keeps a file out of promotions (environment-specific) or out of drift checks (known drift)."
    ].join("\n"), r);
    steps().result(true, "Drafted both lists. Read them before committing them.");
    return 0;
  }
  if (what === "readme") {
    const r = writeReadme(paths, config, steps());
    out(o, () => `${r.created ? "Wrote" : r.replaced ? "Updated the environments section of" : "Added an environments section to"} ${r.file}. Keep it the same on every non-production branch.`, r);
    steps().result(true, "Wrote the README's environments section.");
    return 0;
  }
  throw new AccError("usage", "acc setup baseline | branches [--push] | lists | readme");
}
var area11 = {
  help: {
    section: "Setup",
    order: 10,
    lines: `  acc doctor [--part machine|project] [--step <id>]...
                                        Check the onboarding steps and print the fixes
  acc onboard                           The same checks as a guided list, with the next step to do
  acc setup baseline                    B5: one manifest of every component on every environment branch
  acc setup branches [--push]           B6: make each missing environment branch, seeded from its org
  acc setup lists                       B9: draft the environment-specific and known-drift lists
  acc setup readme                      B10: write the README's environments table
  acc init --profile salesforce --production-org <alias> [--project <name>] [--github-repo <o/r>]
           [--github-account <a>] [--commit-name <n> --commit-email <e>] [--configure-git]
           [--jira-site <site> --jira-project <key>] [--dry-run] [--force]
  acc init --profile generic [...]
  acc init --from <template> [--production-org <alias>] [...]
                                        Start from a team template: a path, a GitHub file URL, or <git-url>#<path>.
                                        It wins where it speaks, and discovery fills the rest; flags win over both
  acc init ... --tracker <json>         One tracker, as the Connect page picks it: a Jira epic, an Azure area path or
                                        GitHub labels. It replaces the template's tracker and --jira-*
  acc template show <template>          What a team template sets, and its check commands, before using it`
  },
  options: {
    part: { type: "string" },
    step: { type: "string", multiple: true },
    profile: { type: "string" },
    project: { type: "string" },
    "production-org": { type: "string" },
    "github-repo": { type: "string" },
    "github-account": { type: "string" },
    "commit-name": { type: "string" },
    "commit-email": { type: "string" },
    "configure-git": { type: "boolean", default: false },
    "jira-site": { type: "string" },
    "jira-project": { type: "string" },
    tracker: { type: "string" },
    from: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    push: { type: "boolean", default: false }
  },
  subcommands: { template: ["show"], setup: ["baseline", "branches", "lists", "readme"] },
  commands: {
    doctor: (o) => cmdDoctor(o, false),
    onboard: (o) => cmdDoctor(o, true),
    init: (o) => cmdInit(o),
    template: (o, rest) => cmdTemplate(o, rest[0], rest[1]),
    setup: (o, rest) => cmdSetup(o, rest[0])
  }
};

// packages/cli/src/commands/ste.ts
function cmdCheck(o, files) {
  const checked = files.length ? files.map((f) => ({ file: f, ...steLint(readFileArg(f), f) })) : [{ file: "<stdin>", ...steLint(readFileArg(0)) }];
  const findings = checked.flatMap((c) => c.findings);
  const words4 = checked.reduce((n, c) => n + c.words, 0);
  const hard = findings.filter((f) => f.level === "hard").length;
  out(o, () => [
    ...findings.map((f) => tone(steLine(f), f.level === "hard" ? "orange" : "dim")),
    ...findings.length ? [""] : [],
    `${findings.length} finding${findings.length === 1 ? "" : "s"} (${hard} hard, ${findings.length - hard} advisory) in ${words4} word${words4 === 1 ? "" : "s"}.`,
    tone("Hedges (may, might, could) are never flagged: confidence is content.", "dim")
  ].join("\n"), { findings, count: findings.length, hard, words: words4 });
  return hard ? 1 : 0;
}
var area12 = {
  help: {
    section: "Checks",
    order: 71,
    lines: `  acc ste check [<file>...]             Check the wording of each file, or of stdin, against the structural rules
                                        of Simplified Technical English. Exit 1 on a hard finding; passive voice
                                        and compound tenses are advice only`
  },
  subcommands: { ste: ["check"] },
  commands: {
    ste: (o, rest) => {
      if (rest[0] === "check") return cmdCheck(o, rest.slice(1));
      throw new AccError("usage", "acc ste check [<file>...]");
    }
  }
};

// packages/cli/src/commands/tidy.ts
function current2() {
  const { paths, config } = project(process.cwd());
  const status = tidyStatus(paths, config, readLedger(paths.ledger));
  const scope = status.count ? tidyScope(run, paths.root, config, status.tasks, process.env, paths.reviews) : null;
  const draft = scope ? draftTidy(status, scope) : null;
  return { paths, config, status, scope, draft };
}
function cmdTidy(o) {
  const { status, scope, draft } = current2();
  const last = status.last ? `The last tidy-up was ${status.last.outcome} by ${status.last.by.replace(/^human:/, "")} ${status.last.at}.` : "No tidy-up is on record yet, so only the newest merges count.";
  const human = () => [
    !status.every ? "Tidy-ups are off: tidy.every is 0 in .acc/config.json." : `${status.count} task${status.count === 1 ? "" : "s"} merged since the last tidy-up; one is offered every ${status.every}. ${status.open ? `${status.open}, a tidy-up, isn't done yet.` : status.due ? tone("A tidy-up is due.", "blue") : "Not due yet."}`,
    tone(last, "dim"),
    ...draft && scope ? [
      "",
      `${draft.title}: ${draft.files.length} file${draft.files.length === 1 ? "" : "s"} on ${scope.tip}, covering ${draft.covered.join(", ")}.`,
      ...draft.files.map((f) => `  ${f}`),
      ...draft.unknown.map((u) => tone(`  ! ${u.task}'s files aren't known: ${u.why}.`, "orange")),
      ...scope.fetched ? [] : [tone(`  ! ${scope.tip} wasn't fetched just now, so it may be behind.`, "orange")],
      "",
      tone("acc tidy add adds it as a task; acc tidy skip sets it aside. Either starts the count again.", "dim")
    ] : []
  ].join("\n");
  out(o, human, { every: status.every, count: status.count, due: status.due, open: status.open, last: status.last, tasks: status.tasks, scope, draft });
  return 0;
}
function cmdAdd(o) {
  const by = personOnlyUpdate(o, "add a tidy-up");
  const { paths, config, status, draft } = current2();
  if (status.open) throw new AccError("refused", `${status.open} is a tidy-up that isn't done yet. Finish it, or remove it, before adding another.`);
  if (!draft) throw new AccError("refused", "Nothing has merged since the last tidy-up, so there's nothing to tidy.");
  const r = addTidy(paths, config, draft, { by, now });
  out(o, () => tone(`\u2713 Added ${r.task}: ${draft.title}, over ${draft.files.length} file${draft.files.length === 1 ? "" : "s"}. Dispatch it when you're ready.`, "blue"), { ...r, draft });
  return 0;
}
function cmdSkip(o) {
  const by = personOnlyUpdate(o, "skip a tidy-up");
  const { paths, config } = project(process.cwd());
  const r = skipTidy(paths, config, { by, now });
  out(o, () => `Skipped the tidy-up of ${r.covered.length} merge${r.covered.length === 1 ? "" : "s"}. The next is offered once ${tidyEvery(config)} more tasks merge.`, r);
  return 0;
}
var area13 = {
  help: {
    section: "Tasks",
    order: 21,
    lines: `  acc tidy                              How many tasks merged since the last tidy-up, and the tidy-up acc
                                        would draft: the files they changed, to find duplicated helpers and
                                        comments that contradict the code. It changes nothing
  acc tidy add                          Add that tidy-up as a task, labelled tidy-up. A person's choice
  acc tidy skip                         Set it aside. Either starts the count again`
  },
  subcommands: { tidy: ["add", "skip"] },
  commands: {
    tidy: (o, rest) => {
      if (!rest.length) return cmdTidy(o);
      if (rest[0] === "add" && rest.length === 1) return cmdAdd(o);
      if (rest[0] === "skip" && rest.length === 1) return cmdSkip(o);
      throw new AccError("usage", "acc tidy [add | skip]");
    }
  }
};

// packages/cli/src/commands/trackers.ts
import { readFileSync as readFileSync37 } from "node:fs";
function cmdSet2(o) {
  const file = o.file;
  if (!file) throw new AccError("usage", "acc trackers set --file <tracker.json> [--index <n>]");
  const index = o.index === void 0 ? null : Number(o.index);
  if (index !== null && !(Number.isInteger(index) && index >= 0 && /^\d+$/.test(String(o.index)))) throw new AccError("usage", "--index is the tracker's place in the list, from 0.");
  let record2;
  try {
    record2 = JSON.parse(readFileSync37(file, "utf8"));
  } catch (e) {
    throw new AccError("usage", `Couldn't read the tracker from ${file}: ${e.message}`);
  }
  personOnly(o, "connect or change a tracker");
  const paths = repoPaths(process.cwd(), run);
  const saved = saveTracker(paths.config, index, record2);
  for (const w of saved.warnings) process.stderr.write(`warning: ${w}
`);
  const { config } = loadConfig(paths.config);
  const t = config.trackers[saved.index];
  const place2 = placeText({ ...t, repo: t.repo ?? config.github?.repo ?? null });
  out(
    o,
    () => `${index === null ? "Connected" : "Changed"} ${trackerName(t.kind)} in .acc/config.json: its tickets come from ${place2}. Commit it to share it.`,
    { index: saved.index, added: index === null, tracker: t, place: place2, warnings: saved.warnings }
  );
  return 0;
}
var area14 = {
  help: {
    section: "Setup",
    order: 16,
    lines: `  acc trackers set --file <tracker.json> [--index <n>]
                                        Connect a tracker, or change the one at that place in the list, in
                                        .acc/config.json, as the Command Center's Connect page does. You commit it`
  },
  options: {
    file: { type: "string" },
    index: { type: "string" }
  },
  subcommands: { trackers: ["set"] },
  commands: {
    trackers: (o, rest) => {
      if (rest[0] === "set") return cmdSet2(o);
      throw new AccError("usage", "acc trackers set --file <tracker.json> [--index <n>]");
    }
  }
};

// packages/cli/src/commands/tracking.ts
function trackingLines(config) {
  if (config.profile !== "salesforce") return "Source tracking is a Salesforce setting: this project isn't a Salesforce project.";
  return usesSourceTracking(config) ? "source tracking on (project): Setup checks that each Developer sandbox is source tracked, and that the Salesforce CLI knows it." : "source tracking off (project): this project doesn't use source tracking, so Setup skips its source-tracking checks. Retrieves use manifests and deploys use source folders, as always.";
}
function cmdTracking(o, value) {
  const { paths } = project(process.cwd());
  const data = (config2) => ({ salesforce: config2.profile === "salesforce", sourceTracking: config2.profile === "salesforce" ? usesSourceTracking(config2) : null });
  if (value === void 0) {
    const { config: config2 } = loadConfig(paths.config);
    out(o, () => trackingLines(config2), data(config2));
    return 0;
  }
  if (value !== "on" && value !== "off") throw new AccError("usage", "acc tracking [on|off]");
  noAgent(o, "change whether the project uses source tracking");
  setSourceTracking(paths.config, value === "on");
  const { config } = loadConfig(paths.config);
  out(o, () => `${trackingLines(config)} Set in .acc/config.json: commit it to share it.`, data(config));
  return 0;
}
var area15 = {
  help: {
    section: "Setup",
    order: 12,
    lines: `  acc tracking [on|off]                 Whether this Salesforce project uses source tracking. Off, Setup skips
                                        its source-tracking checks (B8). A person's choice`
  },
  commands: {
    tracking: (o, rest) => {
      if (rest.length > 1) throw new AccError("usage", "acc tracking [on|off]");
      return cmdTracking(o, rest[0]);
    }
  }
};

// packages/cli/src/commands/index.ts
var AREAS = [area2, area3, area4, area5, area6, area7, area9, area10, area11, area12, area, area13, area14, area15, area8];

// packages/cli/src/main.ts
var GLOBAL = {
  json: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
  version: { type: "boolean", default: false },
  as: { type: "string" },
  by: { type: "string" }
};
function optionsOf(areas) {
  const all = { ...GLOBAL };
  for (const a2 of areas) {
    for (const [name, o] of Object.entries(a2.options ?? {})) {
      if (Object.hasOwn(all, name) && !isDeepStrictEqual(all[name], o)) throw new Error(`--${name} is declared two different ways.`);
      all[name] = o;
    }
  }
  return all;
}
function commandsOf2(areas) {
  const all = /* @__PURE__ */ new Map();
  for (const a2 of areas) {
    for (const [name, run2] of Object.entries(a2.commands)) {
      if (all.has(name)) throw new Error(`acc ${name} is in two groups.`);
      all.set(name, { run: run2, ...a2.argv && Object.hasOwn(a2.argv, name) ? { argv: a2.argv[name] } : {} });
    }
  }
  return all;
}
function entryPointsOf(areas) {
  const all = [];
  for (const a2 of areas) {
    for (const [name, subs] of Object.entries(a2.subcommands ?? {})) {
      if (!Object.hasOwn(a2.commands, name)) throw new Error(`acc ${name} has subcommands but isn't a command of its group.`);
      if (new Set(subs).size !== subs.length) throw new Error(`acc ${name} lists a subcommand twice.`);
    }
    for (const name of Object.keys(a2.commands)) all.push([name], ...(a2.subcommands?.[name] ?? []).map((s) => [name, s]));
  }
  return all;
}
function helpOf(areas) {
  const sections = /* @__PURE__ */ new Map();
  for (const a2 of [...areas].sort((x2, y2) => x2.help.order - y2.help.order)) sections.set(a2.help.section, [...sections.get(a2.help.section) ?? [], a2.help]);
  return [
    `acc ${VERSION}: Agent Command Center`,
    ...[...sections].map(([title, parts]) => [title, ...parts.map((p) => p.lines)].join("\n")),
    "Every command takes --json. Docs: docs/ONBOARDING.md, docs/DESIGN.md."
  ].join("\n\n");
}
var WORD_MAX = 200;
var LONG_WORD = new RegExp(`\\S{${WORD_MAX + 1},}`, "g");
var MESSAGE_MAX = 1e3;
var cut2 = (s, max) => s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
function failureLine(message2) {
  return cut2(message2.trim().replace(LONG_WORD, (w) => cut2(w, WORD_MAX)), MESSAGE_MAX);
}
var OPTIONS = optionsOf(AREAS);
var COMMANDS = commandsOf2(AREAS);
async function main(argv) {
  const args = (argv[0] !== void 0 ? COMMANDS.get(argv[0])?.argv?.(argv) : void 0) ?? argv;
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: OPTIONS });
  const o = values;
  const [cmd, ...rest] = positionals;
  if (values.version) {
    process.stdout.write(`${VERSION}
`);
    return 0;
  }
  if (!cmd || values.help || cmd === "help") {
    process.stdout.write(helpOf(AREAS) + "\n");
    return cmd ? 0 : values.help ? 0 : 2;
  }
  const command = COMMANDS.get(cmd);
  if (!command) throw new AccError("usage", `Unknown command "${cmd}". Run acc help.`);
  const steps2 = openSteps();
  let code2;
  try {
    code2 = await command.run(o, rest);
  } catch (e) {
    if (steps2.used) steps2.result(false, failureLine(String(e?.message ?? e)));
    throw e;
  }
  if (steps2.used && !steps2.ended) steps2.result(code2 === 0, code2 === 0 ? "It finished." : "It ended with an error.");
  return code2;
}
var isEntry = (() => {
  try {
    return !!process.argv[1] && realpathSync8(fileURLToPath(import.meta.url)) === realpathSync8(resolve5(process.argv[1]));
  } catch {
    return false;
  }
})();
function exitAfterOutput(code2) {
  let open = 2;
  const drained = () => {
    if (--open === 0) process.exit(code2);
  };
  process.stdout.write("", drained);
  process.stderr.write("", drained);
}
if (isEntry) {
  main(process.argv.slice(2)).then(
    (code2) => exitAfterOutput(code2),
    (e) => {
      const err = e;
      const message2 = failureLine(String(err?.message ?? e));
      const json = process.argv.includes("--json");
      if (json) process.stdout.write(JSON.stringify({ error: err?.code ?? "error", message: message2 }) + "\n");
      else process.stderr.write(tone(`\u2717 ${message2}`, "orange") + "\n");
      const usage = err?.code === "usage" || String(err?.code ?? "").startsWith("ERR_PARSE_ARGS");
      exitAfterOutput(usage ? 2 : err instanceof AccError ? 1 : 3);
    }
  );
}
export {
  MESSAGE_MAX,
  WORD_MAX,
  commandsOf2 as commandsOf,
  entryPointsOf,
  failureLine,
  helpOf,
  main,
  optionsOf
};
