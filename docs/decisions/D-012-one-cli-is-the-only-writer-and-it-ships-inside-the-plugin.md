## D-012 One CLI is the only writer, and it ships inside the plugin (2026-10-01)

Skills, hooks, the extension and agents all change state through `acc`. Rules
then live in one place. The plugin's `bin/` puts `acc` on every agent's PATH
with no separate install. The extension calls the same bundled file.
