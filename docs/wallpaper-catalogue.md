# The wallpaper list (`wallpaper-catalogue.json`)

The Wallpaper Store has 74 wallpapers that Vex draws itself. It can also show free photos from a
list that you host. Set the list's address in **Settings > Wallpapers > Photo list address**. The default is empty,
and while it is empty Vex never contacts anything for wallpapers. Nothing is fetched until a person
opens the store with an address set.

Vex ships **no photographs**. The list that comes with the repository is empty on purpose:
no photo's licence has been checked by hand, and Vex does not include a picture whose licence it
cannot name.

## Format

```json
{
  "schema": 1,
  "name": "My wallpapers",
  "updated": "2026-10-31",
  "entries": [
    {
      "id": "mist-valley",
      "title": "Mist in the valley",
      "author": "Jane Example",
      "licence": "CC0-1.0",
      "sourceUrl": "https://example.com/photos/mist-valley",
      "thumbUrl": "https://example.com/thumbs/mist-valley.jpg",
      "fullUrl": "https://example.com/full/mist-valley.jpg",
      "tags": ["mist", "green"],
      "category": "nature",
      "dominant": "#4a6b5c",
      "width": 3840,
      "height": 2160
    }
  ]
}
```

| Field | Rule |
| --- | --- |
| `id` | 3 to 48 characters: `a-z`, `0-9`, `-`. Unique in the list. |
| `title`, `author` | Text, up to 80 characters. The author is always shown as the credit. |
| `licence` | `CC0-1.0`, `PDM-1.0` (public domain mark), `Pexels`, `Unsplash` or `Own` (your own photo). Anything else is skipped. |
| `sourceUrl` | https page where the licence can be checked. |
| `thumbUrl` | https, a small preview (PNG, JPEG or WebP; 640 px wide is plenty). |
| `fullUrl` | https, the picture (PNG, JPEG or WebP, at most 12 MB). Vex shrinks it to at most 2560 px wide before keeping it. |
| `category` | `a-z` and dashes; each category becomes a filter. |
| `dominant` | `#rrggbb`, the picture's main colour (shown while the preview loads). |
| `tags` | Optional, up to 12 short words; searched. |
| `width`, `height` | Optional whole numbers. |

Only photos that anyone may use without asking belong here (CC0, public domain, the Pexels or
Unsplash licences, or your own). Do not list a picture you cannot name the licence of.

## What Vex does with it

* Reads the file with one GET (at most 1 MB), through the public-only fetch: https, no cookies, every redirect checked,
  no private addresses. Once a day at most; the last good copy is kept, so the store still works offline.
* Checks every entry; one that fails is skipped (and listed in the console), never half used.
* Downloads a preview when its card scrolls into view, and the full picture only when someone applies it. Only addresses
  that are in the list can be downloaded.
* Keeps at most 80 MB of downloaded photos (least recently used go first) in Vex's own folder.

## Check a file before you host it

```
node scripts/validate-wallpaper-catalogue.js path\to\wallpaper-catalogue.json
```

Exits 1 and prints a reason for each entry that would be skipped.

## For other parts of Vex

`window.VexWallpapers` (`js/wallpaper-store.js`): `apply(id)`, `current()`, `list()`, `onChange(cb)`.
Built-in ids look like `aurora-borealis`; listed photos are `photo-<id>`; a person's own pictures are `my-<12 hex>`.
`apply(null)` removes the wallpaper. The API loads shortly after start-up: wait for the document event
`vex-wallpapers-ready` (or check `window.VexWallpapers`) before calling it from start-up code.
