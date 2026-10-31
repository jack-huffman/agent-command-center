// Settings' Pipeline section's VS Code side (T-157): the development environment and where an environment goes
// next, each changed through acc in the project's settings, for the person to commit. The switch is the Agents
// area's acc.agents.autoMerge, which the section's Change… runs too.
import * as vscode from 'vscode';
import { developmentEnvironment } from '../../packages/core/src/pipeline.ts';
import type { ExtensionArea } from './area.ts';
import type { Project } from './hub.ts';
import { developmentChoices, nextStepChoices } from './model/pipeline.ts';
import { Sidebar } from './sidebar.ts';

/** The pick's last item: the person's own words (D-205), an environment named by typing. */
const OWN_WORDS = 'Another environment…';
const OWN = '\0own';

/** The environment a person typed, by name or branch, whatever the case; undefined when none has that name. */
const environmentNamed = (project: Project, typed: string): Project['config']['environments'][number] | undefined => {
  const want = typed.trim().toLowerCase();
  return want ? project.config.environments.find((e) => e.name.toLowerCase() === want || e.branch === want) : undefined;
};

/** `<root>|<branch>` as the section's buttons send it, or a root alone. */
function parseRef(arg: unknown): { root: string; branch: string | null } | null {
  if (typeof arg !== 'string' || !arg) return null;
  const at = arg.indexOf('|');
  return at < 0 ? { root: arg, branch: null } : { root: arg.slice(0, at), branch: arg.slice(at + 1) || null };
}

class PipelineCommands extends Sidebar {
  constructor(from: Sidebar) {
    super(from.hub, from.acc, from.log, from.openTicket, from.helpers, from.terminals);
  }

  register(reg: (id: string, fn: (...args: any[]) => unknown) => void): void {
    reg('acc.pipeline.development', (arg?: unknown) => this.changeDevelopment(arg));
    reg('acc.pipeline.next', (arg?: unknown) => this.changeNext(arg));
  }

  private async projectOf(arg: unknown): Promise<{ project: Project; branch: string | null } | null> {
    const ref = parseRef(arg);
    const project = ref ? this.hub.project(ref.root) : await this.pickProject();
    return project ? { project, branch: ref?.branch ?? null } : null;
  }

  /**
   * Makes an environment the development environment: the one the button names, or one picked from those that
   * can be (a sandbox that isn't protected). The pick is a single choice (D-205): at most three, in path order,
   * and the person's own words, the environment's name typed, which reaches any other. acc refuses Production
   * and a protected environment.
   */
  private async changeDevelopment(arg: unknown): Promise<void> {
    const got = await this.projectOf(arg);
    if (!got) return;
    const { project } = got;
    const now = developmentEnvironment(project.config);
    let branch = got.branch;
    if (!branch) {
      const { offered, more } = developmentChoices(project.config, now?.branch ?? null);
      if (!offered.length) return void vscode.window.showInformationMessage(`${project.name} has no other environment that can be the development environment: a sandbox that isn't protected.`);
      const title = `${project.name}: which environment is the development environment?${now ? ` Now ${now.name}.` : ''}`;
      const pick = await vscode.window.showQuickPick([
        ...offered.map((e) => ({ label: `$(beaker) ${e.name}`, description: e.org ?? 'no org', detail: `Reviewed work would merge into ${e.branch} on its own.`, value: e.branch })),
        { label: `$(edit) ${OWN_WORDS}`, description: more ? `${more} more can be it` : 'Type its name', detail: 'An environment by its name, as the project\'s settings list it.', value: OWN },
      ], { title });
      if (!pick) return;
      if (pick.value === OWN) {
        const typed = await vscode.window.showInputBox({ title, prompt: 'The environment\'s name, as the project\'s settings list it. Production and a protected environment are refused.', validateInput: (v) => (environmentNamed(project, v) ? undefined : 'No environment has that name.') });
        if (!typed) return;
        branch = environmentNamed(project, typed)?.branch ?? typed.trim().toLowerCase();
      } else {
        branch = pick.value;
      }
    }
    const env = project.config.environments.find((e) => e.branch === branch);
    if (!env) return void vscode.window.showWarningMessage(`${project.name} has no environment on ${branch}.`);
    if (env.branch === now?.branch) return void vscode.window.showInformationMessage(`${env.name} is the development environment already.`);
    const ok = await this.runAcc(project, ['environments', 'development', env.name], () => undefined);
    if (!ok) return;
    await this.hub.loadProjects();
    void vscode.window.showInformationMessage(`${env.name} is the development environment. Changed in the project's settings: commit the change to share it.`);
  }

  /** Where an environment's work goes next: ticks the other environments, usual step first in the order ticked. */
  private async changeNext(arg: unknown): Promise<void> {
    const got = await this.projectOf(arg);
    if (!got) return;
    const { project } = got;
    let env = got.branch ? project.config.environments.find((e) => e.branch === got.branch) : undefined;
    if (!got.branch) {
      // A single choice (D-205): three in path order and the person's own words, an environment's name typed.
      const title = `${project.name}: which environment's next steps?`;
      const { offered, more } = nextStepChoices(project.config);
      const pick = await vscode.window.showQuickPick([
        ...offered.map((e) => ({ label: e.name, description: e.promotesTo.join(', ') || 'nowhere further', value: e.branch })),
        { label: `$(edit) ${OWN_WORDS}`, description: more ? `${more} more` : 'Type its name', detail: 'An environment by its name, as the project\'s settings list it.', value: OWN },
      ], { title });
      if (!pick) return;
      if (pick.value === OWN) {
        const typed = await vscode.window.showInputBox({ title, prompt: 'The environment\'s name, as the project\'s settings list it.', validateInput: (v) => (environmentNamed(project, v) ? undefined : 'No environment has that name.') });
        if (!typed) return;
        env = environmentNamed(project, typed);
      } else {
        env = project.config.environments.find((e) => e.branch === pick.value);
      }
    }
    if (!env) return;
    const others = project.config.environments.filter((e) => e.branch !== env.branch);
    if (!others.length) return void vscode.window.showInformationMessage(`${project.name} has no other environment for ${env.name} to go to.`);
    const picks = await vscode.window.showQuickPick(others.map((e) => ({ label: e.name, description: e.org ?? e.branch, picked: env.promotesTo.includes(e.branch), value: e.name })), { title: `${project.name}: where does ${env.name}'s work go next? Tick each, usual step first.`, canPickMany: true });
    if (!picks) return;
    const names = picks.map((p) => p.value);
    const ok = await this.runAcc(project, ['environments', 'next', env.name, ...names], () => undefined);
    if (!ok) return;
    await this.hub.loadProjects();
    void vscode.window.showInformationMessage(`${env.name} goes to ${names.join(', ') || 'nowhere further'}. Changed in the project's settings: commit the change to share it.`);
  }
}

export const area: ExtensionArea = {
  register(x) {
    new PipelineCommands(x.sidebar).register(x.reg);
  },
};
