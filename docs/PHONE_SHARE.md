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
2. Take the first `http:` or `https:` address out of `EXTRA_TEXT`. If there is none,
   tell the person that Vex can only receive links from the share sheet and stop.
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

Do not send `to` unless the share is meant for one particular desktop.

## What the desktop does with it

* Within about two minutes (or when Vex gets focus) the item is fetched and kept on
  the computer, as before. It shows as a New Tab card and in
  Ctrl+K, "Shared from my phone", where it can be opened, saved to Clips or dismissed.
* With Settings, "Shared from my phone", "File links my phone shares straight into Clips"
  turned on (it is off by default), the item goes into the text Clips inbox as one clip
  (title, link, note) instead of a card, with a Ledger line and an Undo.
* A private window never fetches the mailbox.

## What this cannot do, and what it would take

* **Images and files.** The mailbox holds 16 KB and needs an http(s) address. Sharing a
  screenshot from the phone needs a new, size-bounded, encrypted attachment endpoint on
  the sync worker. That is a server change and was not made.
* **Text with no link.** Same reason: the receive rule drops an item without an
  http(s) `url`. A `kind: "text"` payload would need a protocol bump (level) and a
  matching change in `SyncEngine.dropFetch`.
* **iOS.** A share extension can do the same as step 1 to 4; nothing here is Android specific.
