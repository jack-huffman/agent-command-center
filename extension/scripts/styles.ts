// The page's styles (GH-95): webview/styles.css, what every area shares, first, then each area's own .css,
// named for its module, by file name. npm run build writes them into dist/webview/styles.css as one file,
// and the tests read them from here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEBVIEW = join(dirname(fileURLToPath(import.meta.url)), '..', 'webview');

/** The page's stylesheet files, in the order the build joins them. One no module of the page is named for is an error. */
export function styleFiles(dir = WEBVIEW): string[] {
  const areas = readdirSync(dir).filter((f) => f.endsWith('.css') && f !== 'styles.css').sort();
  const strays = areas.filter((f) => !existsSync(join(dir, f.replace(/\.css$/, '.ts'))));
  if (strays.length) throw new Error(`No module of the page is named for ${strays.join(', ')}. An area's styles are named for its module; what two areas share goes in styles.css.`);
  return ['styles.css', ...areas];
}

/** The page's stylesheet, as the build writes it. */
export const pageStyles = (dir = WEBVIEW): string => styleFiles(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
