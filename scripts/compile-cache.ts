// The tests' compile cache (D-165): npm test loads this before node --test. Most of the suite's time is
// processes starting, and each acc a test starts compiles the same source again. Node keeps what it
// compiled in NODE_COMPILE_CACHE, keyed by each file's contents and Node's version, so an edited file
// compiles fresh. The variable is set here, before node --test starts its files, so every test file and
// every process a test starts inherits it. A cache already named in the environment is kept.
// The folder is kept across runs on purpose, the one exception to GH-174's rule that a test run leaves
// nothing in the system temp directory: a cache that went with each run would save nothing.
import { enableCompileCache } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Where the tests' compile cache lives when the environment names none: one folder for this machine. */
export const CACHE_DIR = join(tmpdir(), 'acc-test-compile-cache');

process.env.NODE_COMPILE_CACHE ||= CACHE_DIR;
enableCompileCache(process.env.NODE_COMPILE_CACHE);
