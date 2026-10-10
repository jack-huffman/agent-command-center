// The Environments area's VS Code commands (D-099).
import * as vscode from 'vscode';
import { skippedOn } from '../../packages/core/src/promote.ts';
import type { Project } from './hub.ts';
import { githubBranchUrl } from './logic/environments.ts';
import { inProcessWords } from './logic/processes.ts';
import type { EnvNode } from './nodes.ts';
import type { ExtensionArea } from './area.ts';
import { Sidebar } from './sidebar.ts';

/** The Environments area's commands: an environment's org, branch, promotion and deploy. */
class EnvironmentCommands extends Sidebar {
  constructor(from: Sidebar) {
    super(from.hub, from.acc, from.log, from.openTicket, from.helpers, from.terminals);
  }

  register(reg: (id: string, fn: (...args: any[]) => unknown) => void): void {
    reg('acc.env.openOrg', (n: EnvNode) => n?.kind === 'env' && n.env.org && this.output(n.project.root, `sf org open -o "${n.env.org}"`, `Open ${n.env.name}`));
    reg('acc.env.openGithub', (n: EnvNode) => n?.kind === 'env' && n.project.config.github && vscode.env.openExternal(vscode.Uri.parse(githubBranchUrl(n.project.config.github.repo, n.env.branch))));
    reg('acc.env.compare', (n: EnvNode) => this.compare(n));
    reg('acc.env.copyBranch', (n: EnvNode) => n?.kind === 'env' && vscode.env.clipboard.writeText(n.env.branch));
    reg('acc.env.promote', (n: EnvNode) => this.promoteEnv(n));
    reg('acc.env.deploy', (n: EnvNode) => this.deployEnv(n));
  }

  // ------------------------------------------------------------ environments: promote and deploy (D-034)

  /** Runs `acc … --json` and reads its answer, or says what it refused. */
  private async accJson<T>(project: Project, args: string[], title: string, expected?: RegExp): Promise<T | { refused: string } | null> {
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, () => this.acc([...args, '--json'], project.root));
    try {
      const out = JSON.parse(r.stdout) as T & { error?: string; message?: string };
      if (r.code === 0 && !out.error) return out;
      const message = (out.message ?? (r.stderr || r.stdout).trim()).replace(/^✗ /, '');
      // A refusal the caller handles itself, such as a first deploy needing its starting point.
      if (expected?.test(message)) return { refused: message };
      void vscode.window.showWarningMessage(inProcessWords(message));
    } catch {
      void vscode.window.showWarningMessage(inProcessWords((r.stderr || r.stdout).trim().split('\n')[0] ?? '') || 'acc didn\'t answer.');
    }
    return null;
  }

  private async promoteEnv(n: EnvNode): Promise<void> {
    if (n?.kind !== 'env') return;
    const { project, env } = n;
    const envs = project.config.environments;
    const name = (b: string) => envs.find((e) => e.branch === b)?.name ?? b;
    const to = env.promotesTo.length === 1 ? env.promotesTo[0] : (await vscode.window.showQuickPick(env.promotesTo.map((b, i) => {
      const skips = skippedOn(project.config, env, envs.find((e) => e.branch === b)!);
      return { label: name(b), description: b, detail: i === 0 ? 'The usual next step' : skips.length ? `Skips ${skips.map((e) => e.name).join(' and ')}: the change won't have been validated there` : undefined, b };
    }), { title: `Promote ${env.name} to…` }))?.b;
    if (!to) return;
    type Plan = { files: string[]; deleted: string[]; leftOut: string[]; skipped: { name: string; branch: string }[]; fromSha: string };
    const got = await this.accJson<Plan>(project, ['promote', env.branch, '--to', to, '--plan'], `Working out what ${env.name} has for ${name(to)}`);
    if (!got || 'refused' in got) return;
    const plan = got;
    if (!plan.files.length && !plan.deleted.length) return void vscode.window.showInformationMessage(`${name(to)} already has everything from ${env.name}.`);
    const sf = project.config.profile === 'salesforce' && envs.find((e) => e.branch === to)?.org;
    const lines = [
      `${plan.files.length} file${plan.files.length === 1 ? '' : 's'} to bring over${plan.leftOut.length ? `, ${plan.leftOut.length} environment-specific left out` : ''}.`,
      ...plan.skipped.map((e) => `⚠ Skips ${e.name}: this change hasn't been validated there.`),
      ...(plan.deleted.length ? [`⚠ Deletes ${plan.deleted.length} file${plan.deleted.length === 1 ? '' : 's'} in ${name(to)}, which usually means the branches have drifted apart: ${plan.deleted.slice(0, 4).join(', ')}${plan.deleted.length > 4 ? ', …' : ''}`] : []),
      '',
      `${sf ? `First, a check-only deploy to ${name(to)}'s org, which saves nothing. If it passes, acc` : 'acc'} pushes a promotion branch and opens a pull request into ${to}. Nothing merges or deploys until a person does.`,
    ];
    const go = plan.deleted.length ? 'Promote, with the deletions' : 'Promote';
    const ok = await vscode.window.showWarningMessage(`Promote ${env.name} to ${name(to)}?`, { modal: true, detail: lines.join('\n') }, go);
    if (ok !== go) return;
    const acc = this.helpers.accCommand ?? 'acc';
    const command = `${acc} promote ${env.branch} --to ${to}${plan.deleted.length ? ' --allow-deletions' : ''}`;
    if (this.helpers.run) this.helpers.run(command, project.root, `Promote ${env.name} → ${name(to)}`);
    else this.send(project.root, command);
  }

  private async deployEnv(n: EnvNode): Promise<void> {
    if (n?.kind !== 'env' || !n.env.org) return;
    const { project, env } = n;
    type Plan = { files: string[]; deleted: string[]; leftOut: string[]; base: string; head: string; testLevel: string; confirm: boolean };
    const base = ['deploy', env.branch, '--plan'];
    let since: string | undefined;
    const first = await this.accJson<Plan>(project, base, `Working out what ${env.name} needs`, /hasn't been deployed by acc before/);
    if (!first) return;
    let plan: Plan;
    if (!('refused' in first)) plan = first;
    else {
      // A first deploy needs a starting point: the commit the org already matches.
      since = (await vscode.window.showInputBox({
        title: `${env.name}: where does the org's deploy start?`,
        prompt: `acc hasn't deployed ${env.name} before. Give the commit or tag ${env.org} already has, and acc deploys what changed on ${env.branch} after it.`,
        placeHolder: 'a commit sha, tag or branch', ignoreFocusOut: true,
        validateInput: (v) => (/^[\w./-]+$/.test(v.trim()) ? undefined : 'A commit, tag or branch name'),
      }))?.trim();
      if (!since) return;
      const again = await this.accJson<Plan>(project, [...base, '--since', since], `Working out what ${env.name} needs`);
      if (!again || 'refused' in again) return;
      plan = again;
    }
    if (!plan.files.length) return void vscode.window.showInformationMessage(plan.deleted.length ? `Only deletions changed on ${env.branch}; acc doesn't deploy those.` : `${env.name} already has ${env.branch} at ${plan.head.slice(0, 7)}.`);
    if (plan.deleted.length) return void vscode.window.showWarningMessage(`${plan.deleted.length} file(s) were deleted on ${env.branch} since the last deploy. acc doesn't deploy deletions: remove them from the org by hand first.`);
    const detail = [
      `Deploys ${plan.files.length} file${plan.files.length === 1 ? '' : 's'} from ${env.branch} (${plan.base.slice(0, 7)} → ${plan.head.slice(0, 7)}) to ${env.org}, with ${plan.testLevel === 'RunLocalTests' ? 'the org\'s local tests' : 'no tests'}.`,
      plan.leftOut.length ? `${plan.leftOut.length} environment-specific file(s) are left out.` : '',
      'This changes the org. It runs one deploy at a time on this machine.',
    ].filter(Boolean).join('\n');
    if (plan.confirm) {
      // A protected org: the person types its name, so it can't be a stray click.
      const typed = await vscode.window.showInputBox({ title: `Deploy to ${env.name}?`, prompt: `${detail}\n\n${env.name} is protected. Type ${env.name} to deploy.`, ignoreFocusOut: true, validateInput: (v) => (v.trim() === env.name ? undefined : `Type ${env.name} exactly`) });
      if (typed?.trim() !== env.name) return;
    } else {
      const ok = await vscode.window.showWarningMessage(`Deploy to ${env.name}?`, { modal: true, detail }, 'Deploy');
      if (ok !== 'Deploy') return;
    }
    const acc = this.helpers.accCommand ?? 'acc';
    const command = `${acc} deploy ${env.branch}${since ? ` --since ${since}` : ''}${plan.confirm ? ' --confirm-production' : ''}`;
    if (this.helpers.run) this.helpers.run(command, project.root, `Deploy ${env.name}`);
    else this.send(project.root, command);
  }

  private compare(n: EnvNode): void {
    if (n?.kind !== 'env') return;
    const prod = n.project.config.environments.find((e) => e.type === 'production' || e.protected);
    const base = prod && prod.branch !== n.env.branch ? prod.branch : n.project.config.environments.find((e) => e.default && e.branch !== n.env.branch)?.branch;
    if (!base) return void vscode.window.showInformationMessage('There\'s no other environment to compare with.');
    this.output(n.project.root, `git diff --no-renames --stat ${base}...${n.env.branch}`, `Compare ${n.env.branch} with ${base}`);
  }
}

export const area: ExtensionArea = {
  register(x) {
    new EnvironmentCommands(x.sidebar).register(x.regNode);
  },
};
