// acc board and acc ticket (T-141): the board and tickets the Command Center saved, for a session that has no sign-in
// to the tracker (D-027). Both read the repo's own state folder only, and never call a tracker.

import {
  AccError, boardTrackers, NOTHING_SAVED, readCachedBoards, readSavedTicket, savedBoards, type SavedBoardView, type SavedCard, savedTicketFile, savedWords, ticketWaiting,
} from '../../../core/src/index.ts';
import { tone } from '../format.ts';
import { type CommandArea, now, type Opts, out, project } from '../shared.ts';

/** Whether a card's ticket is saved, and current, in words. */
function cardState(c: SavedCard, at: Date): string {
  if (!c.saved) return 'not saved yet';
  return [savedWords(c.saved, at), ...(c.waiting ? ['changed since, waiting to be read again'] : []), ...(c.failed ? [`last read failed: ${c.failed}`] : [])].join('; ');
}

function boardLines(boards: SavedBoardView[], at: Date): string {
  return boards.map((b) => [
    `${b.title} · ${b.place}`,
    tone(`Loaded ${savedWords(b.at, at).replace(/^saved /, '')}.`, 'dim'),
    ...b.columns.flatMap((col) => [
      '',
      `${col.name} (${col.cards.length})`,
      ...col.cards.map((c) => `  ${c.key}  ${c.title}${c.assignees.length ? ` · ${c.assignees.join(', ')}` : ''}${c.priority ? ` · ${c.priority}` : ''}  ${tone(`(${cardState(c, at)})`, c.waiting ? 'orange' : 'dim')}`),
    ]),
  ].join('\n')).join('\n\n');
}

function cmdBoard(o: Opts): number {
  const { paths, config } = project(process.cwd());
  const at = now();
  const boards = savedBoards(paths, boardTrackers(config), at);
  if (!boards.length) throw new AccError('nothing-saved', NOTHING_SAVED);
  out(o, () => boardLines(boards, at), { boards });
  return 0;
}

function cmdTicket(o: Opts, raw: string): number {
  const { paths } = project(process.cwd());
  const key = raw.toUpperCase();
  const t = readSavedTicket(paths, key);
  if (!t) {
    throw new AccError('nothing-saved', readCachedBoards(paths).length
      ? `${key} isn't saved: no saved board shows it, or the Command Center hasn't read it yet. acc board lists what is saved.`
      : NOTHING_SAVED);
  }
  const at = now();
  const waiting = ticketWaiting(paths, t, at);
  const said = savedWords(t.saved, at);
  out(o, () => [
    `${t.key}  ${t.title}${t.url ? `\n${t.url}` : ''}`,
    tone(`${said[0]!.toUpperCase()}${said.slice(1)}${t.changed ? `, as it was at ${t.changed}` : ''}.${waiting ? ' The board\'s last load found it changed since: a newer read waits.' : ''}`, waiting ? 'orange' : 'dim'),
    ...(t.failed ? [tone(`Its last read failed (${t.failed.at}): ${t.failed.why} This is the last good copy.`, 'orange')] : []),
    '',
    t.markdown.trim() || '_No description._',
    ...(t.changes ? ['', `## ${t.changes.name}`, '', t.changes.markdown.trim()] : []),
    '',
    `## Comments (${t.comments.length}${t.omitted ? `, ${t.omitted} oldest left out` : ''})`,
    ...t.comments.flatMap((c) => ['', `### ${c.author}${c.created ? `, ${c.created.slice(0, 10)}` : ''}`, '', c.markdown.trim()]),
    ...(t.related.length ? ['', '## Related', ...t.related.map((r) => `- ${r.relation}: ${r.key} ${r.title}${r.state ? ` (${r.state})` : ''}`)] : []),
    '',
    tone(`Saved in ${savedTicketFile(paths, key)}: acc analyze and acc draft criteria take it with --ticket.`, 'dim'),
  ].join('\n'), { ...t, file: savedTicketFile(paths, key), waiting });
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Tasks',
    order: 25,
    lines: `  acc board                             The boards the Command Center saved: columns and cards, each with when
                                        its ticket was saved and whether a newer change waits. Reads no tracker
  acc ticket <key>                      One saved ticket: its description, changes field, comments and related
                                        tickets, when it was saved, and whether a newer change waits`,
  },
  commands: {
    board: (o, rest) => {
      if (rest.length) throw new AccError('usage', 'acc board');
      return cmdBoard(o);
    },
    ticket: (o, rest) => {
      if (rest.length !== 1) throw new AccError('usage', 'acc ticket <key>');
      return cmdTicket(o, rest[0]!);
    },
  },
};
