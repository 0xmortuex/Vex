# Vex theme file (`.vextheme`), version 1

A colour theme made in Vex (Settings › Appearance › Your themes, or "Customise
this theme" in the theme picker) is shared as one small JSON file. The same
colours travel through Sync as `preference:vex.customThemes` (see
[SYNC_PROTOCOL.md](SYNC_PROTOCOL.md) §8.2). This page is what another app, such
as the Vex phone app, needs to read and write both.

The reference code is `src/renderer/js/theme-custom.js` (`parseFile`, `toFile`,
`derive`, `checks`, `fixContrast`). Where this page and the code disagree, the
code is right and this page is a bug.

## The file

UTF-8 JSON, one object, at most **2 MiB** (2,097,152 characters). File name
ending `.vextheme` (Vex also accepts `.json` on import).

```json
{
  "format": "vex-theme",
  "version": 1,
  "name": "Harbour at night",
  "colors": {
    "background": "#0f1720",
    "surface": "#18222e",
    "text": "#e6edf3",
    "muted": "#9fb0c0",
    "primary": "#4cc2ff",
    "success": "#3ccf8e",
    "warning": "#f2c14e",
    "danger": "#ff7b72",
    "border": "#2a3846"
  },
  "image": "data:image/jpeg;base64,/9j/4AAQ..."
}
```

| Field | Required | Rule |
|---|---|---|
| `format` | yes | exactly `"vex-theme"` |
| `version` | yes | integer. `1` is this page. A higher number is refused with "made by a newer Vex" |
| `name` | yes | string; control characters are removed and runs of spaces become one; 1 to 40 characters after that |
| `colors` | yes | object, see below |
| `image` | no | the New Tab background picture, a `data:` URL: `data:image/png;base64,…`, `data:image/jpeg;base64,…` or `data:image/webp;base64,…` only (no SVG, no GIF, no other URL), at most **1,500,000 characters**. It must decode as a picture no larger than 16000 × 16000 |

**No other fields.** A file with any other top-level key, or any other key in
`colors`, is refused as a whole. Nothing in the file is ever used as CSS text:
the colours are parsed, and the CSS is written from the parsed values.

### Colours

Each value is `#rgb` or `#rrggbb`, any letter case. Vex stores and writes
`#rrggbb` in lower case. Nothing else is accepted (no names, no `rgb()`, no
alpha).

| Key | Required | What it colours |
|---|---|---|
| `background` | yes | the page behind everything; also decides light or dark (below) |
| `surface` | yes | panels, cards, menus, the toolbar |
| `text` | yes | body text |
| `primary` | yes | the accent: buttons, links, the active tab, the New Tab wordmark |
| `muted` | no | secondary and hint text |
| `success` | no | "it worked" |
| `warning` | no | "careful" |
| `danger` | no | errors and delete buttons |
| `border` | no | lines between things |

A missing optional colour is derived (`complete()`):

- `muted` = 35% of the way from `text` to `background` (sRGB mix)
- `border` = 18% (light theme) or 16% (dark theme) of the way from `background` to `text`
- `success` / `warning` / `danger` = `#0e700e` / `#8a5300` / `#c42b1c` on a light theme, `#34d399` / `#fbbf24` / `#f87171` on a dark one

`toFile` always writes all nine.

### Light or dark

A theme is **light** when the WCAG relative luminance of `background` is above
**0.4**, otherwise dark. Vex's Light and dark feature (a light theme by day, a
dark one at night) sorts themes by this, so a theme of your own can fill either
slot.

## Every other token

Vex's CSS uses about forty tokens; all of them come from the nine colours
(`derive()`). `mix(a, b, t)` is `t` of `b` over `a` per sRGB channel, rounded.

| Token | Light theme | Dark theme |
|---|---|---|
| deep (side panels, inactive tabs) | mix(background, text, 0.04) | mix(background, surface, 0.45) |
| active tab | mix(surface, #ffffff, 0.6) | mix(surface, text, 0.08) |
| tab hover | mix(background, text, 0.06) | surface |
| input fields | mix(surface, #ffffff, 0.6) | background |
| accent hover / accent text | mix(primary, #000000, 0.18) | mix(primary, #ffffff, 0.25) |
| danger hover | mix(danger, #000000, 0.18) | mix(danger, #ffffff, 0.25) |
| secondary text | mix(text, muted, 0.5) | same |
| subtle / strong border | mix(border, background, 0.35) / mix(border, text, 0.35) | same |
| accent dim / glow | primary + alpha `26` / `1f` | primary + alpha `38` / `2e` |

**Text on the accent** (`--on-primary`): `#ffffff` if it reaches 4.5:1 on both
`primary` and the accent hover colour; otherwise whichever of `background`,
`#ffffff` and `#000000` has the best worst-case contrast on those two.

## Contrast

Vex shows a warning while you edit when any of these is below **4.5:1** (WCAG
contrast ratio, the same bar its tests hold every built-in theme to). Each is
measured against every surface listed and the worst one counts:

| Check | Colour | Against |
|---|---|---|
| Text | text | background, surface, deep, active tab, New Tab glow* |
| Muted text | muted | background, surface, deep, New Tab glow* |
| Accent as text (links) | primary | background, surface, deep |
| Text on the accent | on-primary | primary, accent hover |
| Success / Warning / Danger | each | background, surface, deep |

\* the New Tab's accent glow at its strongest: `mix(background, primary, glowAlpha / 255)`.

**Fix contrast** moves only the failing colours (for "Text on the accent", the
accent), changing their HSL lightness in steps of 0.005 in whichever direction
reaches 4.5:1 with the smaller change, keeping hue and saturation. The
background, surface and border are never moved. A file may be imported with
low contrast; the warnings appear when it is edited.

## Synced form

`preference:vex.customThemes` is a list synced item by item; the item id is the
theme's `id`:

```json
{ "id": "user-qkzmwhabte", "name": "Harbour at night",
  "colors": { "background": "#0f1720", "surface": "#18222e", "text": "#e6edf3", "muted": "#9fb0c0",
              "primary": "#4cc2ff", "success": "#3ccf8e", "warning": "#f2c14e", "danger": "#ff7b72", "border": "#2a3846" },
  "base": "nord", "updated": 1791500000000 }
```

- `id`: `user-` followed by 4 to 24 lower-case letters a-z (Vex makes 10 random ones). Unique.
- `colors`: all nine, `#rrggbb` lower case.
- `base` (optional): the built-in theme it was made from (letters and hyphens, at most 40), used to pick a theme to fall back to when it is deleted.
- `updated` (optional): milliseconds since 1970.
- No other fields; Vex leaves out (and does not apply) a record that breaks a rule.
- The background picture is **not** in the synced record. It stays on the device that has it; a `.vextheme` file carries it.
- The theme in use syncs as `storage:theme` (its id); a device without that theme falls back to Oxford.

## Importing on the desktop

Settings › Appearance › Your themes › **Import…**, or drop the file anywhere on
Settings. An imported theme gets a new id (so importing the same file twice
gives two themes; the second name gets " 2"), and Vex switches to it.
