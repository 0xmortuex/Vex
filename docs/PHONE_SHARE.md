# Phone share-sheet capture: what vex-mobile has to send

The desktop side is built (`src/renderer/js/phone-share.js`, a small hook in
`js/handoff.js` and `js/sync-engine.js`). It uses the Vex Sync mailbox that
already exists ([SYNC_PROTOCOL.md](SYNC_PROTOCOL.md) section 7). **There is no new
server, no new endpoint and no new key.** The phone side is not in this repository.

## What the phone app does

1. Register an Android share target: an intent filter for `ACTION_SEND` with
   `text/plain` (and, if wanted, `ACTION_SEND` of a web page from a browser, which also
   arrives as `text/plain` with the address in `EXTRA_TEXT` and the page title in
   `EXTRA_SUBJECT`).
2. Take the first `http:` or `https:` address out of `EXTRA_TEXT`. If there is one, send a link
   as in step 3. If there is none, send the text itself (step 3b); an image share is step 3c.
3. Build the payload, exactly as the desktop does for "Send to my devices":

   ```json
   { "url": "https://example.com/article", "title": "<EXTRA_SUBJECT or the page title, 300 chars at most>", "note": "<the rest of EXTRA_TEXT with the address removed, 1000 chars at most, optional>" }
   ```

   `url` is cut to 2048 characters, `title` to 300, `note` to 1000. `note` is the only
   new field; a desktop that does not know it ignores it (the same rule as `to` and `hop`).
4. Encrypt it with the account key (SYNC_PROTOCOL.md 3.2) and `POST /sync/drop`
   `{"encryptedBlob": "..."}` with the phone's Bearer token. The server still keeps the
   newest 20 items for 7 days and 16 KB per item.
5. Name the device so it looks like a phone ("Pixel 8", "Galaxy S24", "my phone"):
   the desktop recognises a phone by its device name (`Handoff.looksLikePhone`) and
   only lists items from such a device under "Shared from my phone".

3b. **Text with no link** (Wave 5): `{ "kind": "text", "text": "<EXTRA_TEXT, 4000 characters at most>", "title": "<EXTRA_SUBJECT, 300 at most, optional>" }`
    (no `url`). Encrypt and `POST /sync/drop` exactly as in step 4.

3c. **A picture** (Wave 5): `{ "kind": "image", "image": { "mime": "image/jpeg", "data": "<base64>" }, "title": "<optional>" }`.
    `mime` is one of `image/png`, `image/jpeg`, `image/gif`, `image/webp`. `data` is at most 9000 base64 characters
    (about 6.5 KB of picture) because the whole encrypted item must fit the server's 16 384-character limit. So the app
    scales the picture down first (for example the longest side 160 px as JPEG at quality 60, repeating at lower
    quality until it fits) and tells the person it is sending a small copy. If it cannot be made to fit, say so and stop.

Do not send `to` unless the share is meant for one particular desktop.

## What the desktop does with it

* Within about two minutes (or when Vex gets focus) the item is fetched and kept on
  the computer, as before. It shows as a New Tab card and in
  Ctrl+K, "Shared from my phone", where it can be opened, saved to Clips or dismissed.
* With Settings, "Shared from my phone", "File links my phone shares straight into Clips"
  turned on (it is off by default), the item goes into the text Clips inbox as one clip
  (title, link, note) instead of a card, with a Ledger line and an Undo.
* Text and small pictures (Wave 5) wait in the same "Shared from my phone" list (20 items, 14 days): text can be
  copied or saved to Clips (or filed automatically with the same switch, with an Undo), a picture can be copied.
  A picture is never filed automatically because the Clips inbox holds text. The desktop checks a picture's first
  bytes against its `mime` and drops anything that does not match.
* A private window never fetches the mailbox.

## What this cannot do, and what it would take

* **Full-size images and files.** The mailbox holds 16 KB, so only a thumbnail fits (step 3c). Sharing a
  screenshot or a photo at its real size needs a new, size-bounded, encrypted attachment endpoint on
  the sync worker. That is a server change and was not made.
* **Text and thumbnails need the Wave 5 desktop.** An older desktop skips an item with no `url`
  ("not a web address") and the mailbox has already let go of it, so the phone should send these only
  to a signed-in account whose desktop is up to date.
* **iOS.** A share extension can do the same as step 1 to 4; nothing here is Android specific.
