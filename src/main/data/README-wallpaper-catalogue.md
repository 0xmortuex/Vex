# Wallpaper catalogue (data)

`wallpaper-catalogue.json` is the list behind the Wallpaper Store (schema 1, see `src/main/wallpaper-catalogue.js`).
No picture is bundled with Vex: the list holds addresses, and a picture is downloaded from its public host only when someone picks it
(thumbnails load lazily while the store is looked at).

Files in this folder, all written by `node scripts/build-wallpaper-catalogue.js`:

| File | What it is |
| --- | --- |
| `wallpaper-catalogue.json` | the list, one entry per line |
| `wallpaper-catalogue-categories.json` | `[{ id, title, blurb }]` in English, for the store's category list |
| `wallpaper-catalogue-hosts.json` | the only hosts Vex may download a picture from (`thumbUrl`, `fullUrl`) |

Refresh: `node scripts/build-wallpaper-catalogue.js` (API answers are cached in `scripts/.wallpaper-catalogue-cache/`, which is gitignored;
`--refresh` ignores the cache, `--quick` is a short pipeline test, `--sources met,cma,nasa,wiki` picks sources). Ids come from the source's own
object id, so a re-run keeps them.

## Sources, the exact API, and the terms

| Source | API used | Terms | Licence field |
| --- | --- | --- | --- |
| Metropolitan Museum of Art | `https://collectionapi.metmuseum.org/public/collection/v1.1/search` (isPublicDomain=true, hasImages=true) and `/public/collection/v1/objects/{id}`. No key. | Open Access: images and data of public-domain works are CC0 (https://www.metmuseum.org/policies/open-access). Only objects the API flags `isPublicDomain`. | CC0-1.0 |
| Cleveland Museum of Art | `https://openaccess-api.clevelandart.org/api/artworks/?cc0=1&has_image=1`. No key. | Open Access: works flagged `share_license_status: CC0` (https://www.clevelandart.org/open-access). | CC0-1.0 |
| NASA Image and Video Library | `https://images-api.nasa.gov/search?media_type=image`. No key. | NASA media usage guidelines (https://www.nasa.gov/nasa-brand-center/images-and-media/): NASA-created content is generally not copyrighted. Third-party items are excluded: the credit must name NASA and the text must not mention a copyright or (c). | PDM-1.0, credit "NASA" plus the secondary creator when given (for example "NASA/JPL-Caltech") |
| Wikimedia Commons | `https://commons.wikimedia.org/w/api.php`, `generator=search` in namespace 6 with `haswbstatement:P6216=Q19652` (copyright status: public domain) or `deepcategory:"Photographs by Carol M. Highsmith"`, then `prop=imageinfo&iiprop=url|size|mime|extmetadata`. | Per file. Kept only when `extmetadata.LicenseShortName` matches Public domain, CC0, PD-USGov\*, PD-old\*, PD-art\*, PD-US\* or PD-ineligible\*. CC-BY, CC-BY-SA, GFDL, "Attribution" and anything else are rejected. The Carol M. Highsmith archive is dedicated to the public domain by the photographer (Library of Congress). | CC0-1.0 for CC0, otherwise PDM-1.0 |

Not used, and why:

* **Art Institute of Chicago** (`https://api.artic.edu/api/v1/artworks/search`, CC0 for public-domain works): the API works, but the picture server
  `www.artic.edu/iiif/` answers every non-browser request with HTTP 403 (bot protection), so no picture could be checked. The code for it is still
  in the script (`--sources aic`) but it is off by default; do not enable it until its pictures answer to Vex's own downloader.
* **Smithsonian Open Access**: its API sits behind api.data.gov and needs a key. No key is stored in the repository.
* **Rijksmuseum**: the new open data is Linked Art without a simple size filter; skipped rather than guess at licences.

## What is checked for every entry

* thumbnail and picture fetched: status 200/206, `content-type: image/*`, picture at most 12 MB, real pixel size read from the file;
* at least 2560 px wide; aspect 1.45 to 3.0 (1.3 to 3.0 for `art-patterns`, where a near-square textile still fills a screen when cropped);
* duplicates (same artwork from two ids or two sources) dropped with a small perceptual hash;
* titles with nude/violent/text-document words dropped (a word list, not a human look);
* `dominant` computed from the thumbnail (most frequent 4-bit colour bucket, averaged).

## Known limits

* The word list cannot see inside a picture: a title that does not say "battle" can still show one. Look through the store before a release.
* The Met serves no size parameter, so its thumbnails are its "web-large" size (about 1000 px), not 640 px.
* NASA pictures are the original upload (`~orig.jpg`); some NASA items credit partner agencies (ESA, CSA, STScI). Only items whose credit names NASA are kept.
* Wikimedia pictures are Commons thumbnails at 3840 px (a standard thumbnail step) from `upload.wikimedia.org` or `thumb.wikimedia.org`.
