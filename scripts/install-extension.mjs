// Installs the packaged extension into VSCode. Reload the VSCode window afterwards.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'extension', 'package.json'), 'utf8'));
const vsix = join(root, 'dist', `agent-command-center-${version}.vsix`);
if (!existsSync(vsix)) throw new Error(`No ${vsix}. Run npm run package first.`);
const candidates = ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code', 'code'];
const code = candidates.find((c) => c === 'code' || existsSync(c));
execFileSync(code, ['--install-extension', vsix, '--force'], { stdio: 'inherit' });
console.log('Installed. In VSCode, run "Developer: Reload Window".');
