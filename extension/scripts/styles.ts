// The page's styles (GH-95): webview/styles.css, what every area shares, first, then each area's own .css,
// named for its module, by file name. npm run build writes them into dist/webview/styles.css as one file,
// and the tests read them from here. So do the Light and Dark palettes in webview/theme.css (GH-109).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const WEBVIEW = join(SCRIPTS, '..', 'webview');

/**
 * From the file names in the webview's folder: the page's stylesheets, in the order the build joins them,
 * and the strays, a .css no module of the page is named for. styleFiles reads the folder on disk; the
 * screenshots gate reads it at the commit the branch began from.
 */
export function styleNames(files: string[]): { styles: string[]; strays: string[] } {
  const areas = files.filter((f) => f.endsWith('.css') && f !== 'styles.css').sort();
  const strays = areas.filter((f) => !files.includes(f.replace(/\.css$/, '.ts')));
  return { styles: ['styles.css', ...areas.filter((f) => !strays.includes(f))], strays };
}

/** The page's stylesheet files, in the order the build joins them. One no module of the page is named for is an error. */
export function styleFiles(dir = WEBVIEW): string[] {
  const { styles, strays } = styleNames(readdirSync(dir));
  if (strays.length) throw new Error(`No module of the page is named for ${strays.join(', ')}. An area's styles are named for its module; what two areas share goes in styles.css.`);
  return styles;
}

/** The page's stylesheet, as the build writes it. */
export const pageStyles = (dir = WEBVIEW): string => styleFiles(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');

/** One stylesheet file of the page, by name. */
export const styleFile = (name: string, dir = WEBVIEW): string => readFileSync(join(dir, name), 'utf8');

/** VSCode's own stylesheet for every webview, as copied in beside this script (GH-109). */
export const vscodeDefaults = (): string => readFileSync(join(SCRIPTS, 'vscode-webview-defaults.css'), 'utf8');

/** The --vscode-* variables a stylesheet reads, without the prefix. */
export const readsVars = (css: string): Set<string> => new Set([...css.matchAll(/var\(\s*--vscode-([\w-]+)/g)].map((m) => m[1]!));

export interface CssRule {
  selector: string;
  declarations: { name: string; value: string; important: boolean }[];
}

/** A stylesheet's rules, comments out. At-rule wrappers are dropped, so the rules inside them count too. */
export function cssRules(css: string): CssRule[] {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@(media|layer|supports)[^{]*\{/g, '');
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim(),
    declarations: m[2]!.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(':');
      const raw = d.slice(i + 1).trim();
      return { name: d.slice(0, i).trim(), value: raw.replace(/\s*!important$/, ''), important: /!important$/.test(raw) };
    }),
  }));
}

export const PALETTE_THEMES = ['dark', 'light'] as const;
export type PaletteTheme = (typeof PALETTE_THEMES)[number];

/**
 * Light's and Dark's colours from theme.css (GH-109): each --vscode-* variable its palette sets, by name
 * without the prefix. The screenshot script injects one as VSCode would, and the tests check them.
 */
export function palettes(css = styleFile('theme.css')): Record<PaletteTheme, Record<string, string>> {
  const out: Record<PaletteTheme, Record<string, string>> = { dark: {}, light: {} };
  for (const r of cssRules(css)) {
    const theme = /^html\[data-theme="(dark|light)"\]$/.exec(r.selector)?.[1] as PaletteTheme | undefined;
    if (!theme) continue;
    for (const d of r.declarations) if (d.name.startsWith('--vscode-')) out[theme][d.name.slice('--vscode-'.length)] = d.value;
  }
  return out;
}
