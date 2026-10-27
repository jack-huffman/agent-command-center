/**
 * Report a problem (T-118), as the screenshot run draws it: the draft as it opens, after a failed run in the
 * sample project, scrubbed by the real scrub; the same draft filled in; and after Post, where GitHub's account
 * can't reach the Command Center's repo, and where it's posted.
 */
import { scrub, scrubbedLine, scrubContext } from '../../src/logic/scrub.ts';
import { RELEASES_REPO } from '../../src/model/about.ts';
import { attachedText, type ReportFacts, type ReportModel, reportModel, type ReportState } from '../../src/model/report.ts';
import { ROOT } from './shared.ts';

/** The sample machine's home folder, which holds the sample project. */
const HOME = '/Users/me';

/** What the draft attaches in the sample: a Salesforce project with a failed check, its error full of the project's details. */
export const SAMPLE_REPORT_FACTS: ReportFacts = {
  extension: '0.42.0', acc: { ok: true, value: '0.42.0' }, plugin: { ok: true, value: { version: '0.42.0', enabled: true } }, os: 'macOS 15.1', vscode: '1.105.1', profile: 'salesforce',
  setup: [{ id: 'A1.git', status: 'pass' }, { id: 'A1.gh', status: 'pass' }, { id: 'A2.gh-login', status: 'pass' }, { id: 'A4.plugin', status: 'pass' }, { id: 'B1.orgs', status: 'pass' }, { id: 'B6.org-match', status: 'fail' }, { id: 'B8.tracking', status: 'skip' }],
  step: null,
  lastError: `Run the checks stopped with code 1.\nDeploying to acme-dev as dev.user@acme.com.dev\nERROR ACME-19: ${ROOT}/force-app/main/default/classes/WelcomeEmailService.cls: INVALID_SESSION_ID at https://acme--dev.sandbox.my.salesforce.com/services/data`,
};

/** The sample project's settings, as the scrub reads them. */
const PROJECT = {
  root: ROOT,
  config: {
    project: 'Acme Service', github: { repo: 'acme/acme-service', account: 'acme-dev-bot' }, commitIdentity: { name: 'Sam Lee', email: 'sam@acme.com' },
    environments: [
      { name: 'Dev', branch: 'dev', type: 'sandbox', org: 'acme-dev', default: true, protected: false, promotesTo: [] },
      { name: 'QA', branch: 'qa', type: 'sandbox', org: 'dev.user@acme.com.dev', default: false, protected: false, promotesTo: [] },
    ],
    trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME' }],
  } as never,
};

/** The draft's tab at a state: as it opens, filled in, not posted for want of access, or posted. */
export function sampleReport(kind: 'report' | 'report-filled' | 'report-no-access' | 'report-posted'): ReportModel {
  const done = scrub(attachedText(SAMPLE_REPORT_FACTS), scrubContext(HOME, 'me', [PROJECT]));
  const state: ReportState = kind === 'report-no-access' ? { kind: 'not-posted', result: { ok: false, why: 'no-access', said: 'Could not resolve to a Repository' } }
    : kind === 'report-posted' ? { kind: 'posted', url: `https://github.com/${RELEASES_REPO}/issues/42` } : { kind: 'draft' };
  return reportModel({ draft: 1, attached: done.text, scrubbed: scrubbedLine(done.replaced), happened: '', state });
}

/** What's typed in the filled draft, and in the drafts after Post, as the page keeps it. */
export const REPORT_TYPED: Record<string, string> = {
  'report:1:title': 'Run the checks stops on the org check',
  'report:1:what-happened': 'I clicked Run the checks on a task. It stopped after a minute, and the output panel said the session was invalid.',
  'report:1:expected': 'The checks to run against the task\'s org, as they did last week.',
};
