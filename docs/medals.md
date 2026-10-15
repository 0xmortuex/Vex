# Medals

Medals are small colourful awards for things you really did in Vex. They live
on your local profile (Settings > Profile and medals, or "My Profile and
Medals" in the command bar). Nothing is shared, uploaded or compared.

Files: `js/vex-medals.js` (registry, award engine, art), `js/vex-medals-catalog.js`
(the catalogue and the signals), `js/vex-medals-profile.js` (profile page,
Settings group, command), `css/medals.css`.

## Rules

- Reward real use. Never time on screen, never loss or "you will miss it" wording,
  no penalties, nothing is ever taken away.
- No emoji. Art is an inline SVG made by `VexMedals.art()` with a VexIcons glyph
  (or a `g:` geometric glyph). Every medal has an accessible name.
- Medals are stored on this device only (`localStorage` `vex.medals`). They are
  NOT in sync-engine's `SYNC_KEYS`, so they do not travel with Vex Sync.

## Defining a medal

```js
VexMedals.define({
  id: 'first-bookmark',        // lowercase, unique
  title: 'First bookmark',
  desc: 'You saved a page you want to come back to.',
  hint: 'Bookmark a page.',    // shown on the locked silhouette
  tier: 'bronze',              // bronze | silver | gold | platinum | special
  cat: 'start',                // start | focus | organize | explore | privacy | mastery
  art: { glyph: 'bookmark', shape: 'circle', ribbon: 'blue' }, // shape: circle | shield | star | hex
  hidden: false,               // true: shown as "Hidden medal" until earned
  check: () => true,           // optional: true | false | { n, of }
});
```

`check` is evaluated from events the app already fires and every two minutes
(not while a game runs).

## Awarding

```js
VexMedals.award('first-bookmark');          // true when newly earned; idempotent
VexMedals.progress('bookmarks-10', 4, 10);  // earns it at n >= of
VexMedals.has('first-bookmark');            // really earned only
```

Events on `document`: `vex:medal-awarded` `{ id, title, tier }` and
`vex:medal-progress` `{ id, n, of }`.

### No import needed

Any feature can award by dispatching an event:

```js
document.dispatchEvent(new CustomEvent('vex:medal-signal', { detail: { id: 'wind-down-first' } }));
document.dispatchEvent(new CustomEvent('vex:medal-signal', { detail: { id: 'workflow-10', n: 3, of: 10 } }));
```

Unknown ids are ignored. Signals are idempotent.

### Signal-only medals reserved for other features

`brief-first`, `brief-action`, `wind-down-first`, `daily-tools-first`,
`workflow-first`, `workflow-10` (progress), `protect-first-scan`, `ai-badge-first`.

## Toasts

An award shows a toast through `window.showToast` (awards in the same moment
become one toast). While Game mode or a game runs, toasts are held and shown
when it ends.

## Unlock all medals

Settings > Profile and medals > "Unlock all medals" is a display switch, off by
default. It shows every medal with full art and counts level as if all were
earned. It never writes to the earned record, raises no award events and makes
one summary toast. The profile always keeps the line "N earned for real".
Switching it off restores exactly what was earned.
