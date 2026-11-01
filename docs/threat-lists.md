# Lists of dangerous sites: sources and licences

Vex warns before opening a site that is on a public list of reported phishing and malware sites
(`src/main/threat-list.js`). This page says which lists it may download and why. A list is used only if
its own published terms allow it; the table of sources in `src/main/threat-list-sources.js` refuses to
load a source without a licence name, the address of the licence text and the date it was checked.

Checked on 2026-11-01, by reading each project's own licence text or terms page from its published
address (not from a summary).

## Used

| List | File | Licence | Where the licence is |
|------|------|---------|----------------------|
| Phishing.Database, active phishing domains | `phishing-domains-ACTIVE.txt` (about 11 MB, about 390,000 domains) | MIT, copyright Mitchell Krog, Nissar Chababy and contributors | https://github.com/Phishing-Database/Phishing.Database/blob/master/LICENSE |

What this does and does not establish:

- The MIT text grants use, copying and distribution to anyone. Vex does not bundle the list: each
  computer downloads it for itself, and only a one-way set of hashes is kept (no names, so the list
  cannot be read back out of the saved file).
- The repository's README names the licence for the project as MIT. It does **not** state a separate
  licence for the data files. If the owner wants this settled beyond doubt, ask the maintainer to say
  in the README that the lists are MIT as well; until then the repository licence is the only published
  term.
- The file is fetched from `raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/`.
  It carries no cookies, none of the person's addresses, and is recorded in "What left this computer"
  as "Safety list".

## Looked at and not used

| List | Why not |
|------|---------|
| OpenPhish community feed | Its Terms of Use say "You agree not to use any part of the Services for any commercial purposes" and "you agree not to license, sell, rent, lease, transfer, assign, distribute". The Community feed page only links to those terms. Not safe to use or to redistribute. |
| URLhaus (abuse.ch) | Free "under the fair use principles", but every dataset download needs a personal `Auth-Key` from the abuse.ch portal (the page says so), so Vex cannot fetch it for a person who has not signed up. Its data licence (CC0 is often quoted) was **not** found on the pages read, so it is not claimed here. |
| hagezi dns-blocklists | GNU GPL v3 (the licence text was read). A DNS ad and tracker list, not a phishing list; copyleft terms are heavier than needed. |
| StevenBlack hosts | MIT (the licence text was read) but it is an ad, tracker and malware hosts list. Using it would call ordinary ad servers "dangerous sites". |

## What is never blocked, whatever a list says

- This computer, the local network and private addresses (`localhost`, `192.168.x.x`, `*.local`, ...).
- A name with no dot.
- Shared platforms where anyone makes a sub-site (`pages.dev`, `github.io`, `sites.google.com`,
  `weebly.com`, ...). A list line that is such a platform is dropped; a single sub-site of it is still
  matched when the list names it (`evil.pages.dev`).
- The registered domains of the brands in `src/main/web-safety-brands.js` (a list line `sites.google.com`
  would otherwise block every Google Site).
- Sites the person chose to trust ("Never warn me about this site").

## How often, how big

Downloaded at most once a day (and at most once an hour after a failure), never before the privacy
policy is agreed. The download is capped at 32 MB. If it fails, is empty or has fewer than 10,000 usable
entries, the last good list is kept and the error is shown in Settings. The set is a sorted array of
53-bit hashes: 8 bytes an entry, about 3 MB for 390,000 entries.

## Adding a list

Add an entry to `SOURCES` with `licence`, `licenceUrl` (the licence text itself) and `licenceVerified`
(the date), and write the findings in this file. `validateSource` throws at start-up for an entry that
lacks any of them.
