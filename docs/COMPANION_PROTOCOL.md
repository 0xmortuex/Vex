# Vex Companion protocol (read-only Devices view for a phone browser)

For a phone that has no Vex app: a static page (`companion/`) shows every
device on the account with its open tabs, and opens links. It cannot change
anything. The Vex Android app (`0xmortuex/vex-mobile`) does not need this: it
should read the same data from the sync account itself (§5).

Files: desktop `src/main/companion.js`, relay `workers/companion/` (source
only, the owner deploys it), page `companion/`, view model
`src/renderer/js/live-session.js` (`devicesView`).

## 1. Trust model

- The relay stores **ciphertext**. The key is derived from the pairing code,
  which is shown on the desktop and typed on the phone; it never reaches the
  relay. The sync key and the sync session are never involved, so a phone that
  pairs can read only what the Devices view shows.
- Nothing is sent to a relay until the owner has deployed one, typed its address
  into Vex, and started a pairing. Tests use a local Node server only.
- What the view holds is what `js/live-session.js` lets leave the device
  (SYNC_PROTOCOL.md §4.10.4), checked again in the main process before sealing.
- A pairing code works **once**, within **5 minutes**. The read session lasts
  the `readTtl` the desktop asked for (5 minutes to 24 hours, default 1 hour).
  The desktop can end it at any time.

## 2. Keys

```
code    12 characters of Crockford base32 (0-9 A-H J K M N P-T V-Z), 60 bits,
        shown as XXXX-XXXX-XXXX; I, L, O are read as 1, 1, 0; case and dashes ignored
master  PBKDF2-HMAC-SHA256(password = normalized code (UTF-8), salt = "vex-companion/1",
        iterations = 100000, 32 bytes)
lookup  HKDF-SHA256(ikm = master, salt = empty, info = "vex-companion lookup", 32 bytes) -> 64 hex
key     HKDF-SHA256(ikm = master, salt = empty, info = "vex-companion key",    32 bytes)
blob    base64( iv(12) | AES-256-GCM(key, JSON) | tag(16) ), AAD = "vex-companion/1"
```
The container is the one of SYNC_PROTOCOL.md §3.2, with an AAD that binds it to
this protocol (a sync blob does not decrypt here, nor the reverse).

## 3. Relay API (all JSON, `Access-Control-Allow-Origin: *`, no cookies)

| Call | Who | Auth | Body | Reply |
|---|---|---|---|---|
| `POST /companion/v1/pair` | desktop | none (rate limited) | `{lookup, publishHash, blob, readTtl?}` `publishHash` = SHA-256 hex of a random 32-byte publish token | `200 {ok, pairExpires}`; `409` if open; `400`; `429` |
| `POST /companion/v1/redeem` | phone | the code (via `lookup`) | `{lookup}` | `200 {ok, readToken, blob, updatedAt, expiresAt}`; `404 {"error":"Unknown or expired code"}` for unknown, expired and used alike; `429` |
| `GET /companion/v1/snapshot` | phone | `Authorization: Bearer <readToken>` | none | `200 {ok, blob, updatedAt, expiresAt}`; `401` |
| `PUT /companion/v1/snapshot` | desktop | `X-Vex-Publish: <token>` | `{lookup, blob}` | `200 {ok, updatedAt}`; `401`; `400` |
| `DELETE /companion/v1/pair` | desktop | `X-Vex-Publish: <token>` | `{lookup}` | `200 {ok}`; `401` |

Limits: blob at most 96 KiB base64 (the desktop seals at most 48 KiB of JSON),
body at most 128 KiB; per client per 15 minutes: 10 pairings, 20 redeems, 240
publishes, 600 reads. The relay keeps no log and no address (README in
`workers/companion/`).

## 4. The snapshot (the Devices-view contract)

The decrypted JSON. This is also what the Vex app can build from the sync
document (§5), so it is the contract for any reader.

```json
{
  "v": 1,
  "generatedAt": 1767225600000,
  "devices": [
    {
      "deviceId": "0123456789abcdef0123456789abcdef",
      "name": "Desk PC",
      "kind": "computer",            // "computer" | "phone"
      "self": true,                  // the computer that published it
      "lastSeen": 1767225590000,     // server clock, ms, or null
      "lastActive": 1767225500000,   // ms, never later than generatedAt
      "tabCount": 2,
      "tabs": [
        { "url": "https://a.test/x", "title": "X", "favicon": "https://a.test/f.ico",
          "group": "Work", "pinned": true, "lastActive": 1767225500000 }
      ]
    }
  ],
  "readingQueue": [ { "url": "https://r.test/a", "title": "Read me" } ]
}
```
A reader MUST show only `http:` and `https:` addresses as links (`rel="noopener noreferrer"`),
MUST ignore unknown fields, and MUST NOT assume `favicon`, `group` or `readingQueue` exist.
At most 20 devices, 100 tabs per device, 100 reading-queue items.

## 5. The Vex app (vex-mobile): what it would change

vex-mobile as read on 2026-10-16 (`www/app.js`, `Sync`) talks to the sync worker
only for sign-in and handoff, and does so in a way the current worker refuses:

- `POST /sync/drop` with `{url, title}` in plain text; the worker requires
  `{encryptedBlob}` (SYNC_PROTOCOL.md §7, 16 KB cap, HTTP 400 otherwise);
- it keeps no sync key, so it cannot decrypt a drop or the document, and it does
  not pull, push, prove the key (§2.7) or write a device marker (§4.6);
- the worker source in `0xmortuex/vex-sync-worker` is the older one without
  the mailbox, proofs, or per-account objects; the desktop's source of truth is
  `workers/vex-sync-worker/`.

To consume the Devices view and addressed handoff, vex-mobile would implement
SYNC_PROTOCOL.md §9 (the rebase client) and then:

| File | Change |
|---|---|
| `www/app.js` (`Sync`) | recovery code entry and key import (§3); `GET /sync/pull` + decrypt; `GET /sync/challenge` + `X-Vex-Proof` on push (§2.7); marker `sync:device:<id>` (§4.6); `drop` payload encrypted with the account key (§7) and unaddressed items opened, items with `to` equal to its own device id opened, others handed on with `hop + 1` (§4.10.5) |
| `www/app.js` (new) | write its own `sync:tabs:<deviceId>` (§4.8, version 1 is enough; version 2 fields are optional), read the other devices' with `LiveSession.devicesView` equivalent: `parseSnapshot` rules of §4.10.1 and the redaction of §4.10.4 |
| `www/index.html`, `www/styles.css` | a Devices sheet: device list, tab rows, "Open here" and "Send to" |
| `android-plugin/` | none for the data layer; the native WebView needs no change |
| Endpoints used | `/auth/request-code`, `/auth/verify-code`, `/sync/pull`, `/sync/push`, `/sync/challenge`, `/sync/devices`, `/sync/drop` (current sync worker); none of the companion endpoints |

The companion page is therefore a fallback for a browser without the app, not
a second sync client.
