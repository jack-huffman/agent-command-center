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
        { id: 'q1', question: 'Should every converted contact get a role on the new opportunity, or only the lead\'s primary contact?', why: 'Every contact means more role records, and the pipeline report counts them.', suggested: 'Only the primary contact, as Decision Maker.', askOf: 'you' },
        // Only the ticket's author can answer this one (T-97): it's asked on the ticket.
        { id: 'q2', question: 'Does the sales team report on Decision Maker or on Economic Buyer?', why: 'Sets the role the primary contact gets.', suggested: 'Decision Maker', askOf: 'author' },
        { id: 'q3', question: 'Which role does a secondary contact get?', why: 'Sets the default for the picklist.', suggested: 'Influencer', askOf: 'you', answer: { text: 'Influencer', by: 'jordan', at: at(10) } },
      ],
      // Two design choices (T-97): the first chosen, the second still to make.
      decisions: [
        {
          id: 'd1', title: 'Where the contact roles are made', why: 'Decides what runs on conversion, and where its tests live.', recommended: 'a', because: 'The handler already runs on every conversion, so one more insert there adds no automation to Lead.',
          options: [
            { id: 'a', name: 'In LeadConversionHandler', means: 'The handler inserts the roles after it makes the opportunity.', pros: ['One place runs on conversion', 'Its test class is already there'], cons: ['The handler grows', 'A flow-only admin can\'t change it'], effort: 'S', risks: ['Its loop must stay bulk-safe at 200 leads'], touches: ['classes/LeadConversionHandler.cls', 'classes/LeadConversionHandlerTest.cls'] },
            { id: 'b', name: 'A record-triggered flow', means: 'An after-save flow on Opportunity adds a role when a converted lead made it.', pros: ['An admin can change it without a deploy'], cons: ['A third piece of automation on conversion', 'Flows are harder to test in bulk'], effort: 'M', risks: ['Runs after the handler, so the order matters'], touches: ['flows/Opportunity_Contact_Role.flow-meta.xml'] },
          ],
          choice: { option: 'a', by: 'jordan', at: at(12) },
        },
        {
          id: 'd2', title: 'Which converted leads get roles', why: 'A backfill touches about 3,400 opportunities in production and needs its own deploy window.', recommended: 'a', because: 'The ticket asks about conversions from now on, and a backfill can be its own task.',
          options: [
            { id: 'a', name: 'From now on', means: 'Only leads converted after the deploy get roles.', pros: ['No data change in production'], cons: ['The 3,400 older opportunities stay without roles'], effort: 'S', risks: [], touches: [] },
            { id: 'b', name: 'Backfill too', means: 'A one-off batch adds roles to the opportunities converted before.', pros: ['Every report counts the same way'], cons: ['Its own deploy window', 'A batch class to keep'], effort: 'L', risks: ['Writes to 3,400 records at once'], touches: ['classes/ContactRoleBackfill.cls'] },
            { id: 'c', name: 'Open deals only', means: 'The batch adds roles only to opportunities still open.', pros: ['About 600 records, not 3,400'], cons: ['Closed deals still differ in reports'], effort: 'M', risks: [], touches: ['classes/ContactRoleBackfill.cls'] },
          ],
        },
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
    // Ready to build: a person approved its plan (T-97).
    'ACME-16': make('ACME-16', 'ready', 55, {
      approval: { version: 1, by: 'jordan', at: at(50) },
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

/**
 * ACME-21's plan later on (T-97): approved, its second version with both choices made and every question
 * for you answered; or changed since, a third version that drops a choice made in v2 and adds one, so it
 * needs choosing and approving again. Each keeps the versions before it.
 */
export function samplePlan(now: number, which: 'approved' | 'changed' | 'shapes'): Analysis {
  const at = (ago: number) => new Date(now - ago * MIN).toISOString();
  const base = sampleAnalyses(now)['ACME-21']!;
  const answered = base.questions.map((q) => (q.askOf === 'you' && !q.answer ? { ...q, answer: { text: q.suggested, by: 'jordan', at: at(9) } } : q));
  const [d1, d2] = base.decisions!;
  const v1: Analysis = { ...base, version: 1, at: at(3 * 60) };
  const approval = { version: 2, by: 'jordan', at: at(30) };
  const v2: Analysis = {
    ...base, version: 2, at: at(60), questions: answered, decisions: [d1!, { ...d2!, choice: { option: 'a', by: 'jordan', at: at(35) } }],
    changes: ['New question: Does the sales team report on Decision Maker or on Economic Buyer?', 'Which converted leads get roles: now recommends From now on, not Backfill too'], approval,
  };
  if (which === 'approved') return { ...v2, earlier: [v1] };
  // The approved plan with the split it suggests (T-104): the role record's shape is what ACME-23 and ACME-24 build on.
  if (which === 'shapes') {
    return {
      ...v2, earlier: [v1],
      sharedShapes: [{ name: 'The contact role record', kind: 'schema', why: 'ACME-23 and ACME-24 read and write it.', files: ['force-app/main/default/objects/Role_Source__c/Role_Source__c.object-meta.xml', 'force-app/main/default/classes/ContactRoleSource.cls'], users: ['ACME-23', 'ACME-24'] }],
      shapeSplit: { why: 'Both tasks need only the record, not the flow that fills it. A small first task lets them start within minutes.', first: { title: 'The contact role record and its tests', brief: 'Add the record, its fields and their tests. Nothing is drawn.' }, rest: { title: 'Add contact roles when a lead converts', brief: 'The flow, the page and the backfill, built on the record.' } },
    };
  }
  return {
    ...base, version: 3, at: at(5), questions: answered, lapsed: approval, earlier: [v1, v2],
    // The person's own option carries over; the dropped choice's doesn't, and a new one waits.
    decisions: [
      { ...d1!, choice: { option: null, text: 'In LeadConversionHandler, and only for leads from the web form', by: 'jordan', at: at(40) } },
      {
        id: 'd2', title: 'Where a role\'s contact comes from', why: 'A lead converted into an existing account may match several contacts.', recommended: 'a', because: 'It is the contact the rep chose at conversion.',
        options: [
          { id: 'a', name: 'The converted contact', means: 'The contact the conversion made or picked.', pros: ['Always one contact'], cons: ['Ignores the account\'s other contacts'], effort: 'S', risks: [], touches: [] },
          { id: 'b', name: 'Every matching contact', means: 'Each contact on the account with the lead\'s email domain.', pros: ['Reports see the whole buying group'], cons: ['More roles than the ticket asks for'], effort: 'M', risks: ['Guesses from an email domain'], touches: [] },
        ],
      },
    ],
    changes: ['New choice: Where a role\'s contact comes from', 'No longer a choice: Which converted leads get roles', 'The approach changed'],
  };
}
