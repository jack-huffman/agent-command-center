// Report a problem's other half (T-118): what the draft attaches, gathered and scrubbed when it opens, and the
// post, run only when the page's Post is clicked. Nothing leaves the machine before then: opening the draft reads
// versions and Setup's results here, and the page only shows them. The post runs gh as its active account (D-088),
// the body on stdin. No vscode import: report-panel.ts hands it VSCode's parts, so a test drives it with stand-ins.

import { inProcessWords } from './logic/processes.ts';
import { type ScrubContext, scrub, scrubbedLine } from './logic/scrub.ts';
import type { RunInput } from './model/runs.ts';
import { attachedText, issueArgs, parsePost, REPORT_COMMAND, type ReportFacts, type ReportModel, reportModel, type ReportState } from './model/report.ts';
import type { RunResult } from './run.ts';

/** What the draft needs from the rest of the extension. */
export interface ReportDeps {
  /** What's attached, read now: the step a failed Setup step passed, when it passed one. */
  facts(step: string | null): Promise<ReportFacts>;
  /** This machine's home and user, and every open project's root and settings, read now. */
  scrubContext(): ScrubContext;
  /** gh, as its active account, with what to write to its stdin. */
  gh(args: string[], input: string): Promise<RunResult>;
  copy(text: string): Promise<void>;
  /** The draft's tab: opened or brought forward, with this model. */
  show(model: ReportModel): void;
  /** The tab redraws with this model, when it's open. */
  redraw(model: ReportModel): void;
  /** A line for the person, when a command can't run now. */
  say(text: string): void;
}

/** The last lines of a failed run the draft attaches: enough to see the error, not its whole output. */
export const ERROR_LINES = 12;

/** A run that failed, as the draft's last error: its label, how it stopped, and its last lines, in process words (D-132). */
export function runError(r: Pick<RunInput, 'label' | 'code' | 'ok' | 'stopped' | 'lines' | 'endedAt'>): string | null {
  if (r.endedAt === null || r.stopped || (r.ok ?? r.code === 0)) return null;
  const last = r.lines.filter((l) => l.trim()).slice(-ERROR_LINES);
  return inProcessWords([`${r.label} stopped with code ${r.code ?? 'none'}.`, ...last].join('\n'));
}

/** A command's argument as a Setup step's id: a step's row passes its id, or a ref with it. */
export const stepArg = (a: unknown): string | null => {
  const id = typeof a === 'string' ? a : a && typeof a === 'object' && typeof (a as { step?: unknown }).step === 'string' ? (a as { step: string }).step : null;
  return id && /^[A-Z]\d+\.[\w-]+$/.test(id) ? id : null;
};

export class Reports {
  private draft = 0;
  private state: ReportState = { kind: 'draft' };
  private attached = '';
  private scrubbed: string | null = null;
  private happened = '';
  /** The last error the person saw, kept as it came, scrubbed when a draft attaches it. */
  lastError: string | null = null;
  private readonly d: ReportDeps;

  constructor(d: ReportDeps) {
    this.d = d;
  }

  get posting(): boolean {
    return this.state.kind === 'posting';
  }

  model(): ReportModel {
    return reportModel({ draft: this.draft, attached: this.attached, scrubbed: this.scrubbed, happened: this.happened, state: this.state });
  }

  /** A failed run is the last error the person saw. */
  heard(r: RunInput): void {
    const e = runError(r);
    if (e) this.lastError = e;
  }

  /**
   * Report a problem: a new draft, its attached block read and scrubbed before the tab shows it. While one is
   * posting, its tab comes forward instead, so the post's answer isn't lost.
   */
  async open(arg?: unknown): Promise<void> {
    const can = REPORT_COMMAND.enabled({ posting: this.posting });
    if (!can.ok) {
      this.d.say(can.why);
      this.d.show(this.model());
      return;
    }
    const step = stepArg(arg);
    const facts = await this.d.facts(step);
    const cleaned = scrub(attachedText(facts), this.d.scrubContext());
    this.draft++;
    this.attached = cleaned.text;
    this.scrubbed = scrubbedLine(cleaned.replaced);
    this.happened = facts.step ? scrub(`Setup's step ${facts.step.id} (${facts.step.title}) failed.`, this.d.scrubContext()).text : '';
    this.state = { kind: 'draft' };
    this.d.show(this.model());
  }

  /** Post, clicked: the title and body as the page showed them, once at a time. */
  async post(title: string, body: string): Promise<void> {
    if (this.posting || this.state.kind === 'posted') return;
    this.state = { kind: 'posting' };
    this.d.redraw(this.model());
    let r: RunResult;
    try {
      r = await this.d.gh(issueArgs(title.trim()), body);
    } catch (e) {
      r = { code: 1, stdout: '', stderr: (e as Error).message };
    }
    const p = parsePost(r);
    this.state = p.ok ? { kind: 'posted', url: p.url } : { kind: 'not-posted', result: { ...p, said: inProcessWords(scrub(p.said, this.d.scrubContext()).text) } };
    this.d.redraw(this.model());
  }

  /** Copy the issue text: the title and body as the page showed them. */
  async copy(text: string): Promise<void> {
    await this.d.copy(text);
    this.d.say('Copied the issue text.');
  }
}
