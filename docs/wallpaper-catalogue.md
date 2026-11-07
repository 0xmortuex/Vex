# The wallpaper list (`wallpaper-catalogue.json`)

The Wallpaper Store has 74 wallpapers that Vex draws itself (nothing is downloaded for those). It also
ships a list of **2000 free pictures** (`src/main/data/wallpaper-catalogue.json`, built by
`scripts/build-wallpaper-catalogue.js`), and it can show a second list that you host. Set that list's
address in the **Photo list address** field in the Wallpaper Store's settings; the default is empty.

## What Vex contacts, and when

Vex ships **no picture files**: the built-in list holds addresses, not images. But the built-in list
**is** used, and the store **does** contact the picture hosts while it is open:

* **Only when the Wallpaper Store is open** (and "Show online wallpapers" is on, which it is by default;
  turn off "Show online wallpapers" in the Wallpaper Store and Vex makes no wallpaper request to any host at all):
  a small preview is requested when a card scrolls into view, and the full picture is requested only when
  someone applies that wallpaper. Applied pictures are kept in Vex's own folder (at most 80 MB, least
  recently used go first), so applying one again later needs no request.
* **Nothing at start-up and nothing in the background.** Closing the store stops the requests.
* **What is sent** is the image request itself: the address of that one picture, which any browser sends
  (the connection's IP address, a User-Agent). No cookies (`credentials: 'omit'`), nothing about the
  person, no list of what they looked at. Each request is recorded in "What left this computer" as
  *Wallpaper store*.
* **Which hosts**: only the hosts in `wallpaper-catalogue-hosts.json`. A picture address on any other host
  is refused, on every redirect too. In use today: `thumb.wikimedia.org`, `upload.wikimedia.org`
  (Wikimedia Commons), `openaccess-cdn.clevelandart.org` (Cleveland Museum of Art),
  `images.metmuseum.org` (The Metropolitan Museum of Art) and `images-assets.nasa.gov` (NASA).
  The list also allows `www.artic.edu`, but no entry uses it today (its picture server refuses
  non-browser requests).
* The credit link of a picture (`sourceUrl`: commons.wikimedia.org, clevelandart.org, www.metmuseum.org,
  images.nasa.gov) is **not** fetched by Vex. It opens in the person's own browser, only if they click it.
* A list you host yourself is read with one GET (see below), only when the store is opened with an
  address set.

The same facts are in PRIVACY.md (section 5, "Wallpaper store"); a test keeps every picture host listed there.

## What is in the built-in list

2000 entries, each with `title`, `author`, `licence`, `sourceUrl`, `thumbUrl`, `fullUrl`, category and size.
Counts, from the data file (a test keeps these numbers in step with it):

| Full picture host | Licence recorded | Entries |
| --- | --- | --- |
| thumb.wikimedia.org | PDM-1.0 | 809 |
| upload.wikimedia.org | PDM-1.0 | 215 |
| thumb.wikimedia.org | CC0-1.0 | 1 |
| openaccess-cdn.clevelandart.org | CC0-1.0 | 445 |
| images.metmuseum.org | CC0-1.0 | 397 |
| images-assets.nasa.gov | PDM-1.0 | 133 |

That is 1157 entries marked `PDM-1.0` (public domain mark) and 843 marked `CC0-1.0`. The previews
(`thumbUrl`) come from the same host as the full picture, except for the 215 Wikimedia entries whose full
picture is on `upload.wikimedia.org` and whose preview is on `thumb.wikimedia.org`.

### What the licence field does and does not prove

* The licence is a **coarse code written by the build script** from what each source said at build time
  (Met and Cleveland: their Open Access CC0 flag; NASA: NASA's media guidelines; Wikimedia Commons: the
  file's `LicenseShortName` had to be public domain, CC0, PD-USGov, PD-old, PD-art, PD-US or
  PD-ineligible, otherwise the file was left out). It is not re-checked when the store runs, and the
  exact Commons licence tag (for example `PD-USGov-NPS` as opposed to `CC0`) is **not** kept in the entry.
* **1025 entries are hosted on Wikimedia** (`commons.wikimedia.org` is their credit page). Commons holds
  files under many licences, and some licences that are free to use (CC-BY, CC-BY-SA) **carry a duty to
  credit the author, and for CC-BY-SA to share adaptations alike**. The build script rejects those, so no
  CC-BY or CC-BY-SA file should be here, but this was **not re-verified against Commons** for this
  document (no network was used), and a file's licence can change on Commons after the build. If a
  Wikimedia entry were wrongly recorded as `PDM-1.0` or `CC0-1.0`, the record would hide an attribution
  duty. Treat the Wikimedia entries as the ones to re-check; the credit page is one click away in the
  store.
* **Credit is shown.** Every one of the 2000 entries has a non-empty `author`, and the store shows it under
  the picture as "Photo by <author> . <licence name>" (or "Artwork by" for the art categories). For
  Wikimedia entries the author is the Commons "Artist" text (often an agency or a Commons user name,
  for example "GlacierNPS" or "Carol M. Highsmith"), cleaned up by the script, not a verified legal name.
* Applying a wallpaper uses it on this computer only; Vex does not republish it.

A list that you host yourself uses the format below.

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
