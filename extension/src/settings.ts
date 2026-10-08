// The Settings section's VS Code side (GH-109): the Command Center's theme, kept on this machine, and
// Settings' Refresh. Its own preferences (GH-113): the section it opens on and Agents' Where view, kept for
// this window, and the refresh pace, kept on this machine.
import type { ExtensionArea } from './area.ts';
import { type Pace, PACE_SETTING, PACE_WORDS, paceChoice, PACES } from './logic/polls.ts';
import { WHERE_VIEWS, type WhereView } from './model/agents.ts';
import { OPENS_ON_CHOICES, type OpensOn, opensOnWords, THEME_CHOICES, THEME_SETTING, themeChoice, THEMES, WHERE_WORDS } from './model/settings.ts';

export const area: ExtensionArea = {
  register({ vscode, reg, subscribe, hub, identity, panels, tickets, pages }) {
    const setting = () => vscode.workspace.getConfiguration(THEME_SETTING.section);
    /**
     * Sets the theme: the one given, or the one picked. It's a VSCode setting of machine scope, so it stays
     * on this machine and every window hears of it. Anything but the three choices changes nothing.
     */
    reg('acc.settings.theme', async (arg?: unknown) => {
      const now = themeChoice(setting().get(THEME_SETTING.key));
      const pick = arg !== undefined ? arg : (await vscode.window.showQuickPick(
        THEME_CHOICES.map((t) => ({ label: `$(${THEMES[t].icon}) ${THEMES[t].label}`, description: t === now ? 'Now' : undefined, detail: THEMES[t].meaning, value: t })),
        { title: 'The Command Center\'s theme' }))?.value;
      if (pick === undefined) return;
      if (!(THEME_CHOICES as readonly unknown[]).includes(pick)) {
        void vscode.window.showWarningMessage(`The Command Center's theme is ${THEME_CHOICES.map((t) => THEMES[t].label).join(', ')}: not ${String(pick)}.`);
        return;
      }
      if (pick === now) return;
      try {
        await setting().update(THEME_SETTING.key, pick, vscode.ConfigurationTarget.Global);
      } catch (e) {
        void vscode.window.showWarningMessage(`Couldn't keep the Command Center's theme: ${(e as Error).message}`);
      }
    });
    /**
     * Picks one of a preference's choices: the one given, or the one picked from a list. Anything else is
     * refused in words, and nothing changes.
     */
    async function choose<T extends string>(arg: unknown, choices: readonly T[], words: (c: T) => { label: string; icon: string; meaning?: string }, now: T, what: string): Promise<T | undefined> {
      const pick = arg !== undefined ? arg : (await vscode.window.showQuickPick(
        choices.map((c) => ({ label: `$(${words(c).icon}) ${words(c).label}`, description: c === now ? 'Now' : undefined, detail: words(c).meaning, value: c })),
        { title: what }))?.value;
      if (pick === undefined) return undefined;
      if (!(choices as readonly unknown[]).includes(pick)) {
        void vscode.window.showWarningMessage(`${what} is ${choices.map((c) => words(c).label).join(', ')}: not ${String(pick)}.`);
        return undefined;
      }
      return pick === now ? undefined : (pick as T);
    }
    // The section the Command Center opens on, for this window: kept in its workspaceState, as the section is.
    reg('acc.settings.opensOn', async (arg?: unknown) => {
      const pick = await choose<OpensOn>(arg, OPENS_ON_CHOICES, opensOnWords, panels.opensOn(), 'The section the Command Center opens on');
      if (pick) await panels.setOpensOn(pick);
    });
    // Agents' Where view (D-090), for this window: the same choice as the toggle above Agents' table.
    reg('acc.settings.where', async (arg?: unknown) => {
      const pick = await choose<WhereView>(arg, WHERE_VIEWS, (w) => WHERE_WORDS[w], panels.where(), 'What Agents\' Where shows');
      if (pick) await panels.setWhere(pick);
    });
    // The refresh pace: a VSCode setting of machine scope, as the theme is, so every window takes it.
    reg('acc.settings.pace', async (arg?: unknown) => {
      const config = () => vscode.workspace.getConfiguration(PACE_SETTING.section);
      const pick = await choose<Pace>(arg, PACES, (p) => PACE_WORDS[p], paceChoice(config().get(PACE_SETTING.key)), 'How often the Command Center refreshes');
      if (!pick) return;
      try {
        await config().update(PACE_SETTING.key, pick, vscode.ConfigurationTarget.Global);
      } catch (e) {
        void vscode.window.showWarningMessage(`Couldn't keep the refresh pace: ${(e as Error).message}`);
      }
    });
    // Settings' Refresh: the projects, and who each repo is on GitHub, read again.
    reg('acc.settings.refresh', async () => {
      await hub.loadProjects();
      await identity.refresh();
    });
    // Every Command Center, task page and agent page in every window follows the theme, without reloading.
    // A new pace is shown in Settings; extension.ts polls by it.
    subscribe(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${PACE_SETTING.section}.${PACE_SETTING.key}`)) panels.post();
      if (!e.affectsConfiguration(`${THEME_SETTING.section}.${THEME_SETTING.key}`)) return;
      const theme = themeChoice(setting().get(THEME_SETTING.key));
      panels.retheme(theme);
      tickets.retheme(theme);
      pages.retheme(theme);
    }));
  },
};
