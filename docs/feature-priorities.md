# Feature priorities: what the owner's own use says matters less

Source: section 11 of the master list (VEX-IDEAS.md), built from seven weeks of one real profile.
One person is not a market, so this changes the ORDER of merging and the DEFAULTS FOR NEW PROFILES.
It removes no code. A saved choice on an existing profile is never changed by anything listed here.

## "Merge last" flag

An item marked **merge last** is merged after everything else in a batch, one at a time, with its own
full CI run. Nothing is deleted; a later release may promote it if the usage counters change.

| Item | Why the data says it matters less | What to keep | Flag |
|---|---|---|---|
| Evening tab cleanup, dedupe tabs, Tab Tetris, tab personalities | Tab count is steady at 14-17; hoarding is not the problem | Only the dry-run and undo flow | merge last |
| Notes-based capture (clip to note, highlights to notes, screenshot to note, journal, weekly note) | The Notes panel is 307 bytes and hidden | Everything lands in the one inbox (js/inbox.js), which now has a filter for each | merge after the inbox |
| Medals, levels, Vex Pet, mood themes, sound packs, seasonal worlds, mini games, jingle composer, fortune, daily word, co-op focus timer, friend card | Theme changed 3 times; no source shows cosmetics drive retention; they spend the attention budget | All of them, behind the Playfulness level (js/vex-playfulness.js MODULES) | merge last; no sound on by default |
| Year in Vex, achievement badges | Same | The discovery log (it feeds "New for you") | badges deferred |
| Vex Agent runner as a headline | 2 agent runs in 7 weeks | The safety layer first | merge after agent safety; not promoted on the New Tab |
| Shopping comparison, recipe/travel/docs modes, price/stock tracker | Only one trading site shows in the data | Fix the tracker first | keep behind Discover |
| Work-framed Morning Brief | 69 percent of visits are after 16:00; the 08:30 digest is off | The brief is offered by the first open after being away (js/first-open.js), not by a clock hour | done |
| Extra workspaces (Dev, School, CUSA) | Empty or one tab | Archive after 30 idle days (Tier 3) | later |
| Clock stack: timer, stopwatch | 2 timers in 7 weeks | Reminders (a load-bearing main-process path) | hidden for new profiles |
| Bookmarks, Highlights, Feeds panels; site dark mode; site boosts | Empty or last used in September | All of them, one click away | hidden for new profiles |

## What is hidden on a new profile, and how it comes back

Only a profile with nothing saved yet starts quiet (js/quiet-defaults.js). A profile that already has data
sees exactly what it saw. Each hidden part comes back when the person opens it on purpose, with the Show
button in Settings > Hidden until needed, or when Vex offers it once through the Attention Inbox (at most
one a week). The "New for you" scheduler may call `VexQuietDefaults.reveal(id)`.

## Rules these priorities follow

- A new default reaches only new profiles; an existing profile's saved choice is never rewritten.
- A new or beta feature is held OFF on a profile that already has data, and offered at most three a week.
- Anything playful asks `VexPlayfulness.allowed(kind)`; Simple mode and Minimal Vex lower the level to Off.
  No sound is on by default. `tests/renderer/playfulQuarantine.test.js` fails if a new fun module has no gate.
