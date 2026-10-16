// History a page at a time (D-???): the page asks for a filter's next page, or the pages up to an entry, and
// gets them from every entry History holds now.
import type { ExtensionArea } from './area.ts';
import { historyItems } from './model/history.ts';
import { historyReply } from './model/history-pages.ts';

export const area: ExtensionArea = {
  register({ hub, runs, panels, receive }) {
    receive('history-more', (m) => panels.reply({ ...historyReply(historyItems(hub, runs.views()), m) }));
  },
};
