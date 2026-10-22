/** A task's analysis (D-052), as acc analyze leaves it, for its row, its page and the Overview. */
import type { Analysis } from '../../../packages/core/src/analyze.ts';
import { requirementWording } from '../../../packages/core/src/ste.ts';
import { MIN } from './shared.ts';

/**
 * Analyses as acc analyze leaves them (D-052): one ready to build from, one with two questions for you
 * (and one answered) and two wording findings on its requirements (T-12), one too big for one task, and the
 * one ACME-12 was built from. acc records the wording as it reads each, so the samples do too.
 */
export function sampleAnalyses(now = Date.now()): Record<string, Analysis> {
  const at = (ago: number) => new Date(now - ago * MIN).toISOString();
  const make = (task: string, verdict: Analysis['verdict'], ago: number, more: Partial<Analysis>): Analysis => {
    const requirements = more.requirements ?? { goal: '', criteria: [], assumptions: [], outOfScope: [] };
    return {
      v: 1, task, env: 'dev', base: 'a1b2c3d', verdict, summary: '', requirements,
      questions: [], findings: [], approach: { plan: [], files: [], refactors: [], risks: [], tests: [], size: 'M' }, split: [], orgs: ['Acme Dev'],
      sessionId: `an-${task.toLowerCase()}`, at: at(ago), durationMs: 6 * MIN, costUsd: null, wording: requirementWording(requirements), ...more,
    };
  };
  return {
    'ACME-21': make('ACME-21', 'questions', 18, {
      summary: 'Converting a lead drops its contact roles: the conversion handler creates the opportunity but never an OpportunityContactRole. The fix belongs in the existing LeadConversionHandler, with a test for each role, and stays bulk-safe at 200 leads.',
      requirements: {
        goal: 'A lead converted with an opportunity keeps its contacts\' roles on that opportunity.',
        criteria: ['A converted lead\'s primary contact has a contact role on the new opportunity', 'Converting 200 leads at once stays within limits; no flow fails', 'Leads converted without an opportunity are unchanged'],
        assumptions: ['Every conversion runs through LeadConversionHandler and', 'The role picklist keeps its standard values'],
        outOfScope: ['Changing the lead conversion page layout'],
      },
      questions: [
        { id: 'q1', question: 'Should every converted contact get a role on the new opportunity, or only the lead\'s primary contact?', why: 'Every contact means more role records, and the pipeline report counts them.', suggested: 'Only the primary contact, as Decision Maker.' },
        { id: 'q2', question: 'Fix the leads converted before this change too?', why: 'A one-off backfill touches about 3,400 opportunities in production and needs its own deploy window.', suggested: 'No: only leads converted from now on. A backfill can be its own task.' },
        { id: 'q3', question: 'Which role does a secondary contact get?', why: 'Sets the default for the picklist.', suggested: 'Influencer', answer: { text: 'Influencer', by: 'jordan', at: at(10) } },
      ],
      findings: [
        { area: 'LeadConversionHandler', detail: 'An after-update handler creates the opportunity but no OpportunityContactRole.', source: 'force-app/main/default/classes/LeadConversionHandler.cls' },
        { area: 'Automation on Lead', detail: 'One before-save flow (Lead_Defaults) and this trigger; no validation rule fires on conversion.', source: 'Acme Dev: FlowDefinitionView, ApexTrigger' },
        { area: 'Tests', detail: 'LeadConversionHandlerTest covers conversion without an opportunity only (71% coverage).', source: 'Acme Dev: ApexCodeCoverageAggregate' },
      ],
      approach: {
        plan: ['Collect the converted leads that created an opportunity', 'Insert one OpportunityContactRole each for the primary contact, in bulk', 'Add tests for one lead, 200 leads, and a conversion without an opportunity'],
        files: [
          { path: 'force-app/main/default/classes/LeadConversionHandler.cls', change: 'update', why: 'Insert the roles after conversion' },
          { path: 'force-app/main/default/classes/LeadConversionHandlerTest.cls', change: 'update', why: 'Cover roles, bulk and no-opportunity conversions' },
        ],
        refactors: [{ what: 'Move the SOQL in the conversion loop out of the loop', why: 'At 200 leads it hits the query limit before the new insert runs' }],
        risks: ['A duplicate role if a flow adds one too: none does today', 'Sharing: integration users convert leads without access to every contact'],
        tests: ['LeadConversionHandlerTest: one lead, 200 leads, no opportunity', 'Run the Lead and Opportunity tests in Acme Dev'],
        size: 'M',
      },
    }),
    'ACME-23': make('ACME-23', 'split', 40, {
      summary: 'Rebuilding the partner portal touches the site, its sharing, two record types and the deal registration flow: several weeks of work. Split it so each part is built and reviewed on its own.',
      requirements: { goal: 'Partners use an Experience Cloud site instead of the old portal pages.', criteria: ['Partners sign in to the new site', 'Partners see only their own accounts and deals', 'Deal registration works from the site'], assumptions: ['Partner Community licences are already bought'], outOfScope: ['Single sign-on with partners\' own directories'] },
      findings: [
        { area: 'Old portal', detail: '14 Visualforce pages and 3 controllers, last changed two years ago.', source: 'force-app/main/default/pages' },
        { area: 'Sharing', detail: 'Account and Opportunity are private; no sharing sets exist yet.', source: 'Acme Dev: sf sobject describe Account' },
      ],
      approach: {
        plan: ['Stand up the site', 'Sharing for partner users', 'Deal registration flow', 'Retire the old pages'],
        files: [{ path: 'force-app/main/default/experiences/Partners1', change: 'create', why: 'The new site' }, { path: 'force-app/main/default/pages/PartnerHome.page', change: 'delete', why: 'Replaced by the site' }],
        refactors: [], risks: ['Partners lose access during the switch-over unless both run side by side for a while'], tests: ['Sign in as a partner user in Acme QA and register a deal'], size: 'XL',
      },
      split: ['Set up the Experience Cloud site and its partner profiles', 'Share accounts and opportunities with partner users', 'Move deal registration onto a screen flow', 'Retire the old portal pages once partners have moved'],
    }),
    'ACME-16': make('ACME-16', 'ready', 55, {
      summary: 'Turn on field history for Opportunity Stage, then add a report type and a report on it. Nothing tracks Stage history today, and the history limit has room.',
      requirements: { goal: 'Sales managers see how deals moved between stages.', criteria: ['Stage changes are tracked from the deploy on', 'A report lists each stage change with who made it and when'], assumptions: ['History before the deploy isn\'t needed'], outOfScope: [] },
      findings: [{ area: 'Opportunity history', detail: '12 of 20 tracked fields are used; Stage isn\'t one of them.', source: 'Acme Dev: sf sobject describe Opportunity' }],
      approach: {
        plan: ['Turn on field history for StageName', 'Add the Opportunity Stage History report', 'Put it in the Sales Managers folder'],
        files: [{ path: 'force-app/main/default/objects/Opportunity/fields/StageName.field-meta.xml', change: 'update', why: 'trackHistory' }, { path: 'force-app/main/default/reports/SalesManagers/Opportunity_Stage_History.report-meta.xml', change: 'create', why: 'The report' }],
        refactors: [], risks: [], tests: ['Change a stage in Acme Dev and run the report'], size: 'S',
      },
    }),
    'ACME-12': make('ACME-12', 'ready', 4 * 24 * 60, {
      summary: 'Add an escalation rule for premium High-priority cases on the Premium Support schedule, and notify the account owner. Standard-tier cases keep today\'s rule.',
      requirements: { goal: 'Premium cases reach Tier 2 before they breach their SLA.', criteria: ['High premium cases escalate after 2 business hours', 'The account owner is notified', 'No change for Standard-tier cases'], assumptions: [], outOfScope: [] },
      questions: [{ id: 'q1', question: 'Which queue gets premium cases?', why: 'Decides the rule\'s assignee.', suggested: 'Tier 2', answer: { text: 'Premium Support', by: 'jordan', at: at(4 * 24 * 60 - 20) } }],
      findings: [{ area: 'Escalation rules', detail: 'One active rule with three entries, none for the premium tier.', source: 'force-app/main/default/escalationRules/Case.escalationRules-meta.xml' }],
      approach: { plan: ['Add the premium rule entry to `Case.escalationRules-meta.xml`', 'Notify the owner with an email alert'], files: [{ path: 'force-app/main/default/escalationRules/Case.escalationRules-meta.xml', change: 'update', why: 'The premium entry' }], refactors: [], risks: [], tests: ['`CaseRoutingTest.premiumEscalates` passes in **Acme Dev**'], size: 'S' },
    }),
  };
}
