// npm run set-version -- <x.y.z> (D-079): the one way the version changes. It writes it to the root
// package.json, package-lock.json, the extension, the plugin and its marketplace entry, and nothing else.
import { ROOT, setVersion } from './packaging.ts';

const version = process.argv[2];
if (!version) {
  console.error('Usage: npm run set-version -- <x.y.z>');
  process.exit(2);
}
try {
  const changed = setVersion(ROOT, version);
  console.log(changed.length ? `Set ${version} in ${changed.join(', ')}. Add a "## ${version}" entry to CHANGELOG.md.` : `Everything already says ${version}.`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
