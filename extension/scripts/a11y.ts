/**
 * The screenshot run's accessibility check (T-55). Each measured page loads axe-core (MIT, a dev dependency
 * read from node_modules, not a copy) inline, before the harness's own scripts, and runs it on the whole
 * document with the rules for WCAG 2.1 AA once the page has settled. What axe found goes into the page's
 * geometry dump as its `a11y` part; judgeA11y() decides, with no browser, so its rules are unit-tested.
 *
 * Each violation's node is a finding, unless an exception in A11Y_EXCEPTIONS names its rule and its selector,
 * its text or, for a contrast finding, its colours. An incomplete result, which axe couldn't decide, is counted by rule and is no finding. A drawing
 * where axe examined no node fails: a page that ran no rule can't pass.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/** axe's tags for the rules of WCAG 2.1 at levels A and AA: the rules the check runs. */
export const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

/** The most of a node's text the dump carries. */
export const A11Y_TEXT = 80;

/**
 * One node a violation names: axe's selector for it, and its text, cut to A11Y_TEXT. A contrast finding also
 * carries its colours: the text's colour on the background's, the ratio, and each --vscode-* variable whose
 * colour the text's is, or "no theme colour". A selector can't say which theme colour a node draws in.
 */
export interface A11yNode { selector: string; text: string; colour?: string }
/** One rule axe found broken: its id, how much it matters, a short description, and each node. */
export interface A11yViolation { rule: string; impact: string | null; help: string; nodes: A11yNode[] }
/**
 * What axe found on one drawing: each violation; how many nodes it examined, in its passes, violations and
 * incomplete results; and each incomplete result's rule, with its count of nodes. error is why axe didn't
 * run, if it didn't.
 */
export interface GeoA11y { violations: A11yViolation[]; examined: number; incomplete: { rule: string; nodes: number }[]; error?: string }

/** An exception: the rule it excuses, on a node whose selector, text or colours the pattern matches, and why. */
export interface A11yException { name: string; rule: string; what: RegExp; reason: string }

/** Why a contrast exception for a theme colour stands: Light and Dark keep VSCode's own colours (GH-109). */
const THEMED = 'The page draws it in the theme\'s colour, and Light and Dark keep VSCode\'s Dark and Light Modern colours (theme.css, GH-109), so the page can\'t change it and still match VSCode.';

/**
 * What the accessibility check allows, each with why. A fix that needs a file another task changes now is a
 * follow-up, and so is one outside the page's shared parts (main.ts and dom.ts), which T-55 fixed. A run of
 * every page fails on an exception that excused nothing, so the list only shrinks;
 * `extension/test/a11y.test.ts` pins how far each reaches. The first match excuses a node, so the theme's
 * colours come first.
 */
export const A11Y_EXCEPTIONS: A11yException[] = [
  { name: 'contrast: --vscode-charts-blue', rule: 'color-contrast', what: /--vscode-charts-blue\b/, reason: `Blue states (.tone-blue, a pill, a chip) are --vscode-charts-blue, 3.2 to 4.5:1 on the page's raised and hovered surfaces. ${THEMED}` },
  { name: 'contrast: --vscode-charts-orange', rule: 'color-contrast', what: /--vscode-charts-orange\b/, reason: `Orange states (.tone-orange, the rail's attention counts) are --vscode-charts-orange, 2.4 to 4.1:1. ${THEMED}` },
  { name: 'contrast: --vscode-descriptionForeground', rule: 'color-contrast', what: /--vscode-descriptionForeground\b/, reason: `Muted text is --vscode-descriptionForeground, 4.1 to 4.5:1 on a raised or hovered surface. ${THEMED}` },
  { name: 'contrast: --vscode-textLink-foreground', rule: 'color-contrast', what: /--vscode-textLink-foreground\b/, reason: `Avatars, mentions, counts and the chosen part of a segmented control are --vscode-textLink-foreground on a tint of itself, 3.6 to 4.5:1. ${THEMED}` },
  { name: 'contrast: Setup\'s done steps', rule: 'color-contrast', what: /(?:^|> )\.done(?::nth-child\(\d+\))? > (?:\.strong|\.step-line|\.status)\b/, reason: 'follow-up: setup.css fades a done step with opacity, to 2.4 to 3.5:1; how a done step reads is a choice for Setup\'s own task.' },
  { name: 'contrast: faded task cards', rule: 'color-contrast', what: /(?:^|> )\.done(?::nth-child\(\d+\))? > \.card-|^article\[data-key="[^"]+"\] > \.tcard-(?:top|acc) > |^button\[title="Clean up"\]$/, reason: 'follow-up: boards.css fades a done or closed card with opacity, to 3.1 to 4.2:1, and T-52 to T-54 change the boards now.' },
  { name: 'name: the rail\'s tabs', rule: 'label-content-name-mismatch', what: /^(?:Overview|Tasks|Agents|Worktrees|Environments|Setup|Settings) \d+$/, reason: 'follow-up: rail.ts names a tab "Tasks: 14 need you" while it shows "Tasks 14"; the name must hold the shown count, and T-52 to T-54 change rail.ts now.' },
  { name: 'name: task cards', rule: 'label-content-name-mismatch', what: /^article\[data-key="[^"]+"\]$|^\.acc-hover$/, reason: 'follow-up: a tracker card\'s aria-label (boards.ts) leaves out the labels, people and state it shows, and T-52 to T-54 change boards.ts and tasks.ts now.' },
  { name: 'name: the Overview\'s rows and cards', rule: 'label-content-name-mismatch', what: /^button\[data-overview-card="[a-z-]+"\]$|^(?:ol\[[^\]]+\] > )?(?:li|\.openable|\.tone-row-(?:blue|orange|neutral))(?:[.:[]\S*)?$/, reason: 'follow-up: landing.ts names a row or card by its state and title, and leaves out the facts and counts it shows; what a row is called is a choice for the Overview\'s own task.' },
  { name: 'name: Settings\' action buttons', rule: 'label-content-name-mismatch', what: /\.settings-tracker-actions\.actions > \.btn(?::nth-child\(\d+\))?$|^div\[data-about="plugin"\] > \.primary\.btn$/, reason: 'follow-up: settings.ts and about.ts name a button "Change where Jira · ACME, in Acme Service gets its tickets, and its board" while it shows "Change place…"; the name must hold what it shows.' },
  { name: 'list: the Overview\'s lists', rule: 'list', what: /^ol(?:\[[^\]]+\])?$/, reason: 'follow-up: landing.ts gives a row that opens (an li) the role link, so its ol holds links, not list items.' },
  { name: 'progressbar: Setup\'s progress', rule: 'aria-progressbar-name', what: /^\.progress$/, reason: 'follow-up: setup.ts draws its progress bar with a role and values but no name, such as "Steps done".' },
];

/** The exception excuses this node of a violation of rule: it names the rule, and its pattern matches the node's selector, text or colours. */
export const excuses = (e: A11yException, rule: string, n: A11yNode): boolean => e.rule === rule && (e.what.test(n.selector) || e.what.test(n.text) || (n.colour !== undefined && e.what.test(n.colour)));

/** One drawing's accessibility, judged. */
export interface A11yJudged {
  /** Each node of a violation no exception excuses: where it is, and the rule, impact and text. */
  findings: { what: string; detail: string }[];
  /** How many nodes axe examined; none fails. */
  examined: number;
  /** How many nodes each exception excused, by its name. */
  excused: Record<string, number>;
  /** How many nodes axe left incomplete, by rule. */
  incomplete: Record<string, number>;
}

/**
 * Judges what axe found on one drawing. Each violation's node is a finding that names the rule, its impact,
 * the selector and the text, and a contrast finding its colours, unless an exception for that rule matches
 * its selector, text or colours. A part that
 * is missing, or where axe examined nothing, is a finding of its own.
 */
export function judgeA11y(a: GeoA11y | undefined, exceptions = A11Y_EXCEPTIONS): A11yJudged {
  const findings: A11yJudged['findings'] = [];
  const excused: Record<string, number> = Object.fromEntries(exceptions.map((e) => [e.name, 0]));
  const incomplete: Record<string, number> = {};
  for (const i of a?.incomplete ?? []) incomplete[i.rule] = (incomplete[i.rule] ?? 0) + i.nodes;
  for (const v of a?.violations ?? []) {
    for (const n of v.nodes) {
      const e = exceptions.find((x) => excuses(x, v.rule, n));
      if (e) { excused[e.name]!++; continue; }
      findings.push({ what: n.selector, detail: `${v.rule} (${v.impact ?? 'no impact given'}): ${v.help}${n.text ? `: "${n.text}"` : ''}${n.colour ? ` (${n.colour})` : ''}` });
    }
  }
  const examined = a?.examined ?? 0;
  if (!examined) findings.push({ what: 'the page', detail: `axe examined no node${a?.error ? `: ${a.error}` : a ? '' : ', and the page wrote no a11y part'}` });
  return { findings, examined, excused, incomplete };
}

/** How many incomplete results a run had, by rule, most first: "color-contrast 12, aria-valid-attr-value 2". */
export function incompleteSummary(counts: Record<string, number>[]): string {
  const total: Record<string, number> = {};
  for (const c of counts) for (const [rule, n] of Object.entries(c)) total[rule] = (total[rule] ?? 0) + n;
  const rows = Object.entries(total).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1));
  return rows.length ? rows.map(([rule, n]) => `${rule} ${n}`).join(', ') : 'none';
}

let source: string | null = null;
/**
 * axe-core's script, from node_modules, made safe to put inline in a script element: no `</script` in it
 * can close the element.
 */
export function axeScript(): string {
  source ??= readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8').replace(/<\/(script)/gi, '<\\/$1');
  return source;
}

/**
 * The page's side: runs axe on the whole document with A11Y_TAGS' rules, and resolves to the `a11y` part
 * of the dump. A node's text is the text it draws (its textContent where it draws none, as an SVG part has
 * no innerText), its spaces collapsed, cut to A11Y_TEXT. A contrast node's colours name the --vscode-*
 * variables on <html> whose colour its text's is, compared as the page computes both. When axe fails to run,
 * the part says why and examined nothing, which the check fails.
 */
export const COLLECT_A11Y = `
function collectA11y() {
  const words = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const selector = (t) => t.map((p) => (Array.isArray(p) ? p.join(' ') : String(p))).join(' ');
  const count = (rs) => rs.reduce((n, r) => n + r.nodes.length, 0);
  // Each colour the theme's variables hold, as the page computes it, and the variables that hold it.
  let themed = null;
  const probe = document.createElement('i');
  const rgb = (c) => { probe.style.color = ''; probe.style.color = c; return probe.style.color ? getComputedStyle(probe).color : null; };
  const colour = (n) => {
    const d = n.any?.[0]?.data;
    if (!d?.fgColor) return undefined;
    if (!themed) {
      themed = new Map();
      document.body.append(probe);
      const root = getComputedStyle(document.documentElement);
      for (const p of root) {
        if (!p.startsWith('--vscode-')) continue;
        const c = rgb(root.getPropertyValue(p).trim());
        if (c) themed.set(c, [...(themed.get(c) ?? []), p]);
      }
    }
    const vars = themed.get(rgb(d.fgColor)) ?? [];
    return d.fgColor + ' on ' + d.bgColor + ', ' + d.contrastRatio + ':1, ' + (vars.length ? vars.sort().join(' ') : 'no theme colour');
  };
  if (!window.axe) return Promise.resolve({ a11y: { violations: [], examined: 0, incomplete: [], error: 'axe is not on the page' } });
  return window.axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(A11Y_TAGS)} }, elementRef: true }).then((r) => ({ a11y: {
    violations: r.violations.map((v) => ({ rule: v.id, impact: v.impact ?? null, help: v.help, nodes: v.nodes.map((n) => ({ selector: selector(n.target), text: words(n.element?.innerText ?? n.element?.textContent).slice(0, ${A11Y_TEXT}), colour: colour(n) })) })),
    examined: count(r.passes) + count(r.violations) + count(r.incomplete),
    incomplete: r.incomplete.map((i) => ({ rule: i.id, nodes: i.nodes.length })),
  } }), (e) => ({ a11y: { violations: [], examined: 0, incomplete: [], error: String(e) } })).finally(() => probe.remove());
}`;
