/** Settings' About (GH-114): the versions and the latest release, as the extension reads them. */
import type { AboutFacts } from '../../src/model/about.ts';
import { MIN } from './shared.ts';

const URL = 'https://github.com/jack-huffman/agent-command-center/releases/tag/v';

/** All up to date: acc, the extension and the plugin at 0.37.0, and 0.37.0 the latest release, looked for 12 minutes ago. */
export function sampleAbout(now: number): AboutFacts {
  return {
    extension: '0.37.0', acc: { ok: true, value: '0.37.0' }, plugin: { ok: true, value: { version: '0.37.0', enabled: true } },
    release: { ok: true, value: { version: '0.37.0', tag: 'v0.37.0', name: 'v0.37.0', url: `${URL}0.37.0` } },
    reading: false, checking: false, checkedAt: now - 12 * MIN, auto: true,
  };
}

/** Behind: 0.38.0 is out, with its notes, and the plugin is 0.36.0, older than the extension, so A4's fix is offered. */
export function sampleAboutBehind(now: number): AboutFacts {
  return {
    ...sampleAbout(now),
    plugin: { ok: true, value: { version: '0.36.0', enabled: true } },
    release: { ok: true, value: { version: '0.38.0', tag: 'v0.38.0', name: 'v0.38.0', url: `${URL}0.38.0` } },
    checkedAt: now - 20_000,
  };
}

/** A look that failed, which reads neutral, while the versions are read again. */
export function sampleAboutFailed(now: number): AboutFacts {
  return {
    ...sampleAbout(now),
    acc: null, plugin: null, reading: true,
    release: { ok: false, error: 'error connecting to api.github.com' },
    checkedAt: now - 3 * 60 * MIN,
  };
}
