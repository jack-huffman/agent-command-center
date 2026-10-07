/** An agent's page: its activity, from its transcript. */
import { agentModel, type AgentModel } from '../../src/model/agent-page.ts';
import type { Entry } from '../../src/transcript.ts';
import { sampleHub } from './hub.ts';
import { MIN } from './shared.ts';

/** ACME-14's activity: its instructions, what it said, the tools it used, and the prompt it's waiting on. */
export function sampleAgent(now = Date.now()): AgentModel {
  const at = (ago: number) => new Date(now - ago * MIN).toISOString();
  const cwd = '/Users/me/code/acme-service/.claude/worktrees/ACME-14';
  const tool = (id: string, ago: number, toolName: string, icon: string, title: string, code: string | null, status: 'running' | 'done' | 'error', result: string | null = null, more = 0): Entry =>
    ({ k: 'tool', id, at: at(ago), tool: toolName, icon, title, code, status, result, more });
  const entries: Entry[] = [
    { k: 'prompt', id: 'p1', at: at(27), instructions: true, text: `# ACME-14: Route web-to-case submissions by product line\n\nYou are a builder. Work in \`${cwd}\` on branch \`task/ACME-14-route-web-to-case\`.\n\n## Done when\n\n- Web-to-case submissions get the product line's queue.\n- The routing tests pass in the Dev org.\n\n${'Keep commits small. '.repeat(30)}` },
    { k: 'say', id: 's1', at: at(26), text: 'I\'ll start with the current assignment rules and the **web-to-case** form fields, then add a routing step keyed on `Product_Line__c`.' },
    tool('t1', 26, 'Bash', 'terminal', 'Check the branch and recent commits', 'git status && git log --oneline -3', 'done', 'On branch task/ACME-14-route-web-to-case\nnothing to commit, working tree clean\n9f1c2ab Case: add Product_Line__c\n41d0e77 Queues for each product line\n0b6a1f3 Initial'),
    tool('t2', 25, 'Read', 'file', 'Read force-app/main/default/classes/CaseRouting.cls', null, 'done'),
    tool('t3', 24, 'Grep', 'search', 'Searched for Product_Line__c in force-app', null, 'done', 'force-app/main/default/objects/Case/fields/Product_Line__c.field-meta.xml\nforce-app/main/default/classes/CaseRouting.cls'),
    tool('t4', 20, 'Edit', 'edit', 'Edited force-app/main/default/classes/CaseRouting.cls', null, 'done'),
    tool('t5', 18, 'Write', 'new-file', 'Wrote force-app/main/default/classes/CaseRoutingTest.cls', null, 'done'),
    tool('t6', 12, 'Bash', 'terminal', 'Format the changed Apex', 'npx prettier --write force-app/main/default/classes/CaseRouting.cls force-app/main/default/classes/CaseRoutingTest.cls', 'done', 'force-app/main/default/classes/CaseRouting.cls 182ms\nforce-app/main/default/classes/CaseRoutingTest.cls 64ms'),
    tool('t7', 9, 'Bash', 'terminal', 'Run the static checks', 'acc gate run static', 'error', '✗ static: 2 violations at severity 2 or worse\n  CaseRouting.cls:41  ApexCRUDViolation  Validate CRUD permission before SOQL/DML operation\n  CaseRouting.cls:57  ApexCRUDViolation  Validate CRUD permission before SOQL/DML operation'),
    { k: 'say', id: 's2', at: at(8), text: 'Two CRUD warnings, both on the queue lookup. I\'ll query `WITH USER_MODE` instead of checking by hand.' },
    tool('t8', 6, 'Edit', 'edit', 'Edited force-app/main/default/classes/CaseRouting.cls', null, 'done'),
    tool('t9', 5, 'Bash', 'terminal', 'Run the static checks', 'acc gate run static', 'done', '✓ static: no violations at severity 2 or worse'),
    { k: 'say', id: 's3', at: at(4), text: 'The static checks pass. Next, the routing tests in the Dev org.' },
    tool('t10', 3, 'Bash', 'terminal', 'Run the routing tests in the Dev org', 'sf apex run test --class-names CaseRoutingTest --target-org "Acme Dev" --wait 20', 'running'),
  ];
  return agentModel({ hub: sampleHub(now), key: 's-acme-14', seen: null, entries, readable: true, lastAt: at(3), model: 'claude-opus-5-5' });
}
