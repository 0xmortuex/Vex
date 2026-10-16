# Ctrl+K commands, prefixes and shortcuts: the rules

These are enforced by `tests/renderer/commandGrammar.test.js` (it reads the real
source) using the functions in `src/renderer/js/command-grammar.js`. A new command
or key that breaks one fails that test, so the clash is found when it is written.

## A command

Registered in `src/renderer/js/command.js`, or by a module with
`VexExtras.registerCommand({ id, label, hint, icon, action })`.

| Part | Rule |
|---|---|
| `id` | Lowercase words joined by dashes (`release-check`), at most 40 characters, **unique across every command**. It is what a shortcut (`cmd:`), an alias and the feature manifest (`commands: [...]`) name, so it never changes once shipped. |
| `label` | What the person reads and types to find it. 60 characters at most, starts with a capital letter or a digit, no stray spaces, no emoji, no markup, does not end with `.` or `!` (an ellipsis `...` is fine for a command that asks something first). **Unique, ignoring case.** Prefer a verb first (`Find installed games`, `Check this page`); a question is fine when the command answers it (`Why was I signed out?`). |
| `hint` | One sentence of at most 220 characters saying what it does, calm, no emoji. Say "changes nothing" when that is true. |
| `icon` | A `VexIcons` name. Never an emoji. |

A module registering a command whose id is already taken is ignored (`registerCommand`
returns `false`); the test makes that a failure at build time instead of a missing command.

## A prefix

A character at the start of a Ctrl+K line that changes how the line is read.
The list is `CommandGrammar.PREFIXES`:

| Prefix | Meaning |
|---|---|
| `>` | run a command only (js/command.js) |
| `@` | search a site or a tab (js/search-shortcuts.js) |

A new prefix is added to that list and to this table first. It is one symbol (not a
letter, digit or space) and no two share a character.

## A shortcut

The table is `DEFAULT_SHORTCUTS` in `src/renderer/js/shortcuts-registry.js`.

| Rule | Why |
|---|---|
| Written `Ctrl+Alt+Shift+Key` in that order (`Super` last); the key is one letter or digit, `F1`-`F12`, `PageUp`, `PageDown`, `Delete`, `Tab`, `Home`, `End`, `Insert`, `Space`, `Enter` or `Escape`. | One spelling, so two spellings of the same key cannot both exist. |
| No key is on two actions. | The first match wins; the second would silently never fire. |
| A key a page gets **first** (`PAGE_FIRST` in `src/main/guest-shortcuts.js`: Ctrl+B/H/M/D/P/U and Ctrl+Shift+O/S/Z/A/M/L/H/N/P) must be `system: true`, a fixed key. | A page-first key does not follow a rebind, so moving it would leave the old key working in every page. |
| An entry with `cmd` names a Ctrl+K command id that exists. | The registry runs that command itself. |
| Every entry has a `label`. | The shortcuts sheet and the editor are generated from the table. |

Ctrl and Ctrl+Shift letters are mostly spoken for by Chromium and by Vex; Ctrl+Alt is
where there is room.
