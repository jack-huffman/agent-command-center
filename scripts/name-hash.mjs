// Prints the SHA-256 of each name given, lower-cased, one per line as "<hash>  <name>". A person adds a name
// to the banned list in scripts/test/no-client-names.test.ts by pasting the hash, never the name (T-120).
// Usage: node scripts/name-hash.mjs <name> [<name>...]
import { createHash } from 'node:crypto';

const names = process.argv.slice(2);
if (names.length === 0) {
  console.error('Usage: node scripts/name-hash.mjs <name> [<name>...]');
  process.exit(1);
}
for (const name of names) console.log(`${createHash('sha256').update(name.toLowerCase()).digest('hex')}  ${name}`);
