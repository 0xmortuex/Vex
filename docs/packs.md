# Vex Packs

A Vex Pack is a single JSON file (`.vexpack`) that carries ready-made, purely
declarative items for Vex: themes, command chains, page actions, readability
presets, brief sections, stickers, medal frames, command shortcuts and
quote / fortune lists.

**A pack cannot run code.** There is no item type that holds a script, no field
that is ever evaluated, and no network path to fetch a pack. Everything a pack
contains is data that a fixed, existing piece of Vex already knows how to
interpret.

Source: `src/main/packs.js` (format, validator, signatures),
`src/main/packs-store.js` (disk, trust, log), `src/renderer/js/packs-ui.js`
(manager and confirm). Tests: `tests/main/packs.test.js` (including the hostile
corpus), `tests/main/packsWiring.test.js`, `tests/renderer/packsUi.test.js`.

## Format (version 1)

```json
{
  "format": "vex-pack",
  "version": 1,
  "id": "night-owl",
  "name": "Night owl",
  "author": "Ada",
  "description": "A dark theme and a reading chain.",
  "items": [
    { "type": "theme", "id": "night", "name": "Night owl",
      "colors": { "background": "#101820", "surface": "#1b2733", "text": "#e8eef4", "primary": "#4ea1ff" } },
    { "type": "chain", "id": "read", "name": "Read it", "steps": ["reading-mode", "read-aloud"] }
  ],
  "permissions": ["runs:commands"],
  "hash": "<sha-256 of the canonical content, hex>",
  "signature": { "alg": "ed25519", "key": "<32-byte public key, base64>", "sig": "<64-byte signature, base64>" }
}
```

* `signature` is optional. `hash` is required, signed or not.
* **Canonical content** is the object made of `format, version, id, name,
  author, description, items, permissions`, serialised as JSON with object keys
  sorted at every level and no whitespace. `hash` is its SHA-256. The signature
  is Ed25519 over the UTF-8 bytes of `"vexpack-v1\n" + canonical content`.
* No other top-level field is allowed. An unknown field anywhere is an error.
* Limits: file at most 256 KB, at most 200 items, JSON nested at most 8 deep,
  at most 20 000 values, pack and item ids as below, name 80 characters,
  description 600.
* Ids: pack `^[a-z0-9][a-z0-9._-]{2,63}$` (no `..`, no trailing dot, no Windows
  device names); item `^[a-z0-9][a-z0-9_-]{0,47}$`; unique per type within a pack.

### Item types (exactly nine)

| type | fields | what Vex does with it | needs |
| --- | --- | --- | --- |
| `theme` | `name`, `colors` (background, surface, text, primary required; muted, success, warning, danger, border optional; `#rgb` or `#rrggbb`) | offered in the manager; copied to My themes only when the person presses the button | none |
| `chain` | `name`, `steps` (1-20 command ids) | a Ctrl+K command that runs the existing chain runner | `runs:commands` |
| `page-action` | `name`, `origin` (exactly `https://host[:port]`), `source` (the page-action step language, 40 steps, 4000 characters) | read by the page-action feature, bound to that one origin, run only on request by the fixed interpreter | `runs-on:origin` |
| `brief-section` | `title`, `blocks` (1-20 of `text`, `link` (https), `url-template` (https, fixed host, placeholders `{query}` `{tab-url}` `{tab-host}`)) | data for the brief | `opens:links` (+ `reads:tabs` when a tab placeholder is used) |
| `readability-preset` | `name`, `host`, `font` 70-250, `contrast` 100-200, `width` 0 or 400-1600 (whole numbers) | numbers fed to the per-site readability CSS builder | `styles:pages` |
| `sticker` | `name`, `svg` | art, shown only as an image | none |
| `medal-frame` | `name`, `svg` | art, shown only as an image | none |
| `aliases` | `name`, `entries` (1-50 of `word`, `command`) | command bar shortcut words | `runs:commands` |
| `quotes` | `name`, `kind` (`quote` or `fortune`), `entries` (1-100 of `text`, optional `by`) | text lists | none |

### Permissions (exactly five)

A pack must declare exactly the permissions its items need. A missing one and an
unused one are both refused, so the list a person reads is the truth.

| permission | plain-language meaning shown in the confirm |
| --- | --- |
| `runs-on:origin` | Act on the websites named in its page actions: click, scroll, hide and fill in fields there as if you had done it yourself. Only when you run an action. |
| `runs:commands` | Run Vex commands one after another when you pick one of its chains or type one of its command shortcuts. |
| `styles:pages` | Change the text size, contrast and width of the websites it names. |
| `opens:links` | Show links that open web pages when you click them. |
| `reads:tabs` | Read the address or the site of the page you are on, to fill in a link it builds. |

## Strings and SVG

Every string is **rejected, never repaired**, if it contains a control
character, a bidirectional override or isolate, a zero-width or other invisible
character, a private-use character, a lone surrogate, a language tag, or a line
separator; one-line fields also reject leading / trailing spaces and newlines.
Because nothing is rewritten, what is stored is exactly what was signed.

SVG art is parsed by an allow-list tokenizer, not a browser. Allowed elements:
`svg g path rect circle ellipse line polyline polygon defs linearGradient
radialGradient stop`. Allowed attributes are a fixed list of geometry and paint
attributes; values may only use letters, digits and `. , # ( ) % + - _ space`,
plus `url(#id)` in `fill` / `stroke` pointing at an `id` defined in the same
file. Rejected outright: comments, doctype, entities, CDATA, processing
instructions, text content, `script`, `style`, `use`, `image`, `foreignObject`,
`a`, animation elements, `style` and `class` attributes, every `on*` handler,
any `href`, any namespace other than SVG, `javascript` / `data:` in any value,
more than 400 elements, nesting deeper than 12, more than 16 KB. The art that
leaves main is rebuilt from the parsed tree, and is shown only inside an
`<img>`, which can run nothing and load nothing.

## Trust model

Three states, computed in the main process:

* **Not signed**: nobody vouches for the file. Install needs a confirm that
  lists every item and every permission in plain language, in the danger style.
* **Signed, key not trusted**: the signature is valid, so the file is unchanged
  and was made by whoever holds that key; Vex does not know who that is. Same
  full confirm, with the key fingerprint.
* **Trusted key**: the key is in the person's trusted keys (they pressed
  "Trust this key" on a pack of theirs, or it is their own signing key). Shorter
  confirm: counts per item type and the permissions.

Further rules:

* An invalid signature, a hash that does not match, or a signature over
  different content is a **refusal**, not a downgrade to "unsigned".
* A pack signed by one key can only be replaced by a pack signed by the same
  key. A signed pack is never replaced by an unsigned one. (Remove it first.)
* Trusting a key is a separate, explicit act, never a side effect of install.
  Untrusting demotes every installed pack from that key.
* The author's private key lives in `<userData>/packs/author.json`, sealed with
  the operating system's encryption (Electron `safeStorage`). If that is not
  available no key is created; there is no plain-text fallback.

### Why there is no "install from a URL" and no store

v1 has **no central store and no network fetch**. A URL install would mean Vex
fetches attacker-chosen bytes on a click (SSRF to local addresses, redirects,
TOCTOU between the page the person looked at and the file fetched, "this link
is from a friend" phishing) and would need a hosted index to be useful, which
is a trust root Vex does not have. A local file or a drag-and-drop means the
person already has the exact bytes, can inspect them, and the same bytes are
what get hashed, previewed and installed. A "from URL" path is explicitly out of
scope; adding one later would still have to go through the same preview and
confirm, and must fetch in main with the public-address rules the playground
uses.

## Installing, switching off, removing

* Install: Ctrl+K > Vex Packs > Open a pack file, or drop a `.vexpack` on the
  window. Main previews the file (validation, trust) and hands back a one-use
  token; the window can install only that token, never content of its own.
* Pack items are an **overlay**. They are never merged into the person's own
  themes, chains or aliases, so a pack's kill switch and "Remove" take away
  exactly what it added. (A theme the person copies to My themes with the button
  is remembered and removed with the pack.)
* Per-pack switch, a master "Packs are on" switch, trusted keys list, and an
  install log (install, replace, enable, disable, uninstall, trust, untrust,
  key creation, export, every refusal with its code).
* Every write is atomic (temp file then rename). An install, replace or
  uninstall whose log entry cannot be written is rolled back to the exact
  previous bytes and the error is shown.
* On startup every installed file is validated again. A damaged or tampered
  file is listed as damaged and applies nothing.
* Not available in private windows (all `packs:` channels are closed there).

## Authoring

Vex Packs > "Export my items as a pack" takes your own themes, chains or command
shortcuts, runs them through the same validator (so a chain that would run a
command a pack may not is refused with the reason), signs with your signing key
if you have made one (Keys > Create my signing key), and saves a `.vexpack`
through a normal Save dialog. Unsigned exports are possible; recipients get the
"not signed" warning.

## Threat model

Assets: the person's browsing, their saved logins and data, their trust in what
they see in Vex's own interface.

Attacker: someone who gets a pack in front of the person (a download, a chat
attachment), or who can alter a pack file on disk.

What a pack can do at most (everything listed in the confirm):

* change colours and readability on named sites;
* add Ctrl+K entries that run existing, non-destructive commands in order;
* run click / scroll / hide / type steps, from the fixed interpreter, on one
  named https origin, only when the person chooses the action (page-action
  consumers must refuse private / Tor / routed tabs, as the feature itself does);
* show text, links (https only) and pictures.

Mitigations: no code item type; no evaluation of pack content anywhere
(`tests/main/packsWiring.test.js` fails if the pack files gain `eval`,
`Function`, dynamic import, script injection, a network module or `innerHTML`
with pack text); strict JSON parser with depth / size / duplicate-key /
forbidden-key limits; whole-pack validation before anything is stored;
dangerous-command deny list for chains and aliases; main-process judgement with
one-use install tokens; IPC schemas; UI-only and private-window-closed
channels; signature binding to content.

### What is deliberately NOT supported

* Any executable item: JavaScript, userscripts, extensions, CSS text, HTML,
  WebAssembly, shell commands, URLs to load code from.
* Install from a URL, a store, an index, an update feed, or auto-update.
* Packs that touch passwords, the vault, cookies, history, sync or settings
  outside the item types above.
* Chains or shortcuts that run commands matching the deny list (clear, delete,
  remove, wipe, reset, install, uninstall, quit, restart, vault, password,
  passkey, totp, secret, export, import, sync, send, sign out, erase, forget,
  format, purge, revoke, update, download, pack).
* Silent trust: a key is never trusted by installing, and a signature alone
  never skips the warning for an unknown key.
* Per-item enable switches, pack dependencies, versions / upgrades with
  migration (a pack replaces a pack with the same id and key).
* CSS or SVG features beyond the allow-list.

### Residual risks

* A social-engineering pack: a signed or unsigned pack can still contain a
  convincing chain or page action. The confirm lists the steps; a person who
  approves a page action on their bank's origin has granted it.
* The command deny list is name-based; a new destructive command with an
  innocent id would be allowed until the list is extended.
* A trusted key that is later compromised signs packs that install with the
  short confirm. Untrust removes the shortcut.
* Page actions and the other consumers that live in other Vex features must
  enforce their own bindings (origin match, private / Tor refusal). This
  foundation hands them validated data and a list of permissions; it does not
  reach into those features.
* The window shows pack text; a hostile but valid pack can still display
  misleading words (without hidden or direction-changing characters).

## Security review checklist: every place pack data is consumed

When adding a consumer, add it to this list and to `tests/main/packsWiring.test.js`
if it needs a static guard.

1. `src/main/packs.js` `parseStrictJson`: the only parser of pack text (never
   `JSON.parse` on untrusted pack text for acceptance).
2. `src/main/packs.js` `validatePack` path (`parsePack`, `validateItem`,
   `ITEM_TYPES[*].build`, `sanitizeSvg`, `parseActionSource`): everything is
   rebuilt from known fields.
3. `src/main/packs-store.js` `preview` / `install` / `load`: the only writers of
   `<userData>/packs/installed/<id>.json`; `fileFor` validates the id and checks
   the resolved path stays inside the folder. `load` re-validates every file.
4. `src/main/packs-store.js` `enabledItems`: the only source consumers get items
   from; honours the master switch and the per-pack switch; rebuilds SVG.
5. `src/main.js` `packs:*` handlers: pick-file reads one file chosen in the
   native dialog, at most 256 KB; export writes only to the path the person
   chose in the Save dialog.
6. `src/main/ipc-schemas.js`, `ipc-policy.js` (`UI_ONLY_CHANNELS`,
   `PRIVATE_DISABLED`), `src/preload.js` (`vex.packs`): no channel takes a URL,
   a path or code.
7. `src/renderer/js/packs-ui.js`:
   * manager and confirm: pack strings via `textContent` only;
   * `_register`: pack chains become Ctrl+K commands run by `CommandChains.run`;
   * `addThemeToMine`: through `CustomThemes.validateRecord`;
   * `_collect` / `exportMine`: the person's own items out, validated again in main.
8. `src/renderer/js/packs-consumers.js` hands each installed, switched-on item to
   the feature that reads it, through an in-memory setter on that feature (never
   written to the feature's own storage; gone with the pack). Each keeps its own
   guards:
   * `aliases` -> `VexAliases.setPackEntries` (the person's own word wins);
   * `readability-preset` -> `SiteReadability.setPackPresets` (numbers only; not
     applied in private windows or Tor / routed tabs);
   * `page-action` -> `PageActions.setPackScripts` (master switch and its warning,
     exact origin, chosen by the person, never automatic, never private / Tor /
     routed tabs);
   * `brief-section` -> `BriefIntegration.setPackSections` (text, https links;
     page-bound templates only from a normal tab; a template with {query} is not
     offered);
   * `quotes` -> `VexFortune.setPackLines` and `VexWidgets.setPackQuotes`
     (`textContent`);
   * `sticker` -> `StickerSheet.setPackStickers`, `medal-frame` ->
     `VexCosmetics.setPackFrames` (drawn as an image: a data: SVG in an `<img>`
     or an SVG `<image>`, never inline);
   * `theme` and `chain` are read by packs-ui.js itself.
   A type whose consumer is not in a build stays inert; `VexPackConsumers.status()`
   lists it.
