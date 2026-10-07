// The Settings section's VS Code side (GH-109): the Command Center's theme, kept on this machine, and
// Settings' Refresh.
import type { ExtensionArea } from './area.ts';
import { THEME_CHOICES, THEME_SETTING, themeChoice, THEMES } from './model/settings.ts';

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
    // Settings' Refresh: the projects, and who each repo is on GitHub, read again.
    reg('acc.settings.refresh', async () => {
      await hub.loadProjects();
      await identity.refresh();
    });
    // Every Command Center, task page and agent page in every window follows the theme, without reloading.
    subscribe(vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(`${THEME_SETTING.section}.${THEME_SETTING.key}`)) return;
      const theme = themeChoice(setting().get(THEME_SETTING.key));
      panels.retheme(theme);
      tickets.retheme(theme);
      pages.retheme(theme);
    }));
  },
};
