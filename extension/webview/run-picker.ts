// The output panel's run picker, as plain data so a test can read it (T-44).

/** A run's name as the picker's list shows it: cut at 36 characters, a running one marked. The title holds the full name. */
export const pickerName = (label: string, running: boolean): string => `${running ? '● ' : ''}${label.length > 36 ? `${label.slice(0, 36)}…` : label}`;

/**
 * The output panel's picker once there is more than one run. Closed, it reads "1 of 4" (the panel's head already
 * names the run); open, its list names every run. Its title gives the selected run's full name.
 */
export function pickerOf(runs: { id: string; label: string; running: boolean }[], selected: string, listing: boolean): { options: { id: string; text: string; selected: boolean }[]; title: string } {
  const at = Math.max(0, runs.findIndex((r) => r.id === selected));
  return {
    options: runs.map((r, i) => ({ id: r.id, selected: i === at, text: listing ? pickerName(r.label, r.running) : `${i + 1} of ${runs.length}` })),
    title: runs[at]?.label ?? '',
  };
}
