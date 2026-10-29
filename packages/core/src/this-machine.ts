/**
 * What a person calls the machine acc runs on (T-150): a Mac on macOS, a PC on Windows, a computer on any
 * other system (D-209). Every message about this machine names it from here, so the CLI, the Command
 * Center's pages and the agents' prompts say the same, and Windows never hears "Mac". Words about a Mac
 * only (its keychain, Homebrew, caffeinate) name a Mac on their own. scripts/test/this-machine.test.ts
 * fails on a message that says "this Mac" without this.
 */

/** The noun for this machine. */
export type MachineNoun = 'Mac' | 'PC' | 'computer';

/** The noun for a platform (process.platform): Mac on darwin, PC on win32, computer on any other. */
export function machineNoun(platform: string = process.platform): MachineNoun {
  if (platform === 'darwin') return 'Mac';
  if (platform === 'win32') return 'PC';
  return 'computer';
}

/** "this Mac", "this PC" or "this computer", as a sentence names it after its first word. */
export const thisMachine = (platform: string = process.platform): string => `this ${machineNoun(platform)}`;

/** "This Mac", "This PC" or "This computer", as a label or a sentence's first word names it. */
export const thisMachineLabel = (platform: string = process.platform): string => `This ${machineNoun(platform)}`;
