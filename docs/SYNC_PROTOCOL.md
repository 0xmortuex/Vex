# Vex Sync Protocol (v2.35.2, wire protocol unchanged through the release after v2.37.0; §8 source list as of the release after v2.36.4)

> **Release after v2.37.0 — server-internal change only.** The worker keeps each account in its own Durable Object instead of one shared object (§1.2). Every endpoint, request, response, status code and token format in this document is unchanged; no client change is needed.

This is the wire and data contract between Vex clients and a self-hosted Vex Sync worker. A third-party or mobile client can follow it and sync with desktop Vex without losing or corrupting another device's data.

Everything here comes from the code at Vex v2.35.2, and was checked by running it. The first version of this document shipped with v2.35.1; v2.35.2 changed the desktop to follow §5.3, §5.4 and §6 where it did not yet (each change says "from v2.35.2"):

| Area | Source of truth |
|---|---|
| Server | `workers/vex-sync-worker/worker.js`, `workers/shared/security.js`, `workers/vex-sync-worker/wrangler.toml` |
| Client engine | `src/renderer/js/sync-engine.js` |
| Record document (CRDT-ish) | `src/renderer/js/sync-records.js` |
| Encryption | `src/renderer/js/sync-crypto.js` |
| Validation the desktop applies to the sources it reads from a pull | `src/renderer/js/data-contracts.js` |
| Worker URL setting | `src/renderer/js/vex-config.js` |
| Behaviour pinned by tests | `tests/renderer/syncRecords.test.js`, `sweep-fin5-sync.test.js`, `sweep-r2-sync-lists.test.js`, `sweep-r4-sync-tiles.test.js`, `sync-protocol-compat.test.js`, `tests/workers/syncAuth.test.js`, `durableSecurity.test.js`, `syncAccountIsolation.test.js` |

The test vector (§3.6) came from running the real `sync-crypto.js` and `sync-records.js` under Node's WebCrypto, and Node's own `crypto` module was used to check it. The HTTP examples (§1, §2, §9) are real responses from the real worker code, run through a local Node stand-in for its Durable Object.

The words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119. **UNSURE** marks something the code does not settle. Each one names the code it depends on.

---

## 0. The model in one paragraph

The server holds one **opaque encrypted blob per account**, a **revision counter**, a **device list** and a small **handoff mailbox**. It never sees plaintext, so all merging happens on clients. The blob decrypts (AES-256-GCM, with a key the user carries as a "recovery code") to a JSON **record document**: `{ "schema": 2, "records": { <recordKey>: <record> } }`. Each record has a **version vector** (`clock`), a `deleted` flag (tombstones) and an edit time `at`. Each synced source (for example `preference:vex.bookmarks`) is flattened into records. A list becomes one record per item, and anything else becomes one whole value.

A sync round is **pull → merge → push**. A push carries `baseRevision`. The server refuses it with **409** unless that matches the current revision, so a client must always push a document derived from the latest one it pulled.

**The one rule that matters most:** a client that pushes a document in which records it does not understand are missing *as tombstones* deletes them on every other device. §6 lists everything a client must do to avoid this.

---

## 1. Transport

### 1.1 Base URL

- Each user deploys their own worker (see `SELF_HOSTING.md`). The URL is not built into the app.
- On desktop the URL is in `localStorage['vex.syncWorkerUrl']`. It is trimmed, and **all trailing slashes are stripped** (`VexConfig.syncWorkerUrl()`). A trailing slash would produce `//auth/...` and a 404.
- Paths are appended directly: `${base}/auth/request-code`.
- When no URL is configured, desktop sync is entirely off: no requests and no timers. A mobile client SHOULD ask the user for the same URL they entered in desktop Settings › Sync.

### 1.2 General

- Every request and response body is JSON (`Content-Type: application/json`). Every response, errors included, is `application/json` with a body like `{"error": "<message>"}` or `{"ok": true, ...}`. The only exception is `OPTIONS`, which returns 204 with no body.
- Authenticated endpoints (`/sync/*`) need `Authorization: Bearer <sessionToken>`. The server strips the prefix with `/^Bearer\s+/`.
- **Request body cap: 4 MiB** (`boundedJson`, 4·1024·1024 bytes). The cap is checked against `Content-Length` first and then while streaming. Over the cap the server returns **413** `{"error":"Request too large"}`. The worker's own `encryptedBlob.length > 5 MB → 413 "Blob too large (max 5 MB)"` check can never fire, because the 4 MiB body cap is reached first. **The effective limit for a push is the entire JSON body ≤ 4 MiB**, and base64 adds about 33%, so the plaintext document must stay under roughly 3 MiB.
- If the request body is not read within 10 s, the server returns **408** `{"error":"Body read timed out"}`.
- A body that is not JSON gets **400** `{"error":"Invalid JSON"}`. A missing body gets **400** `{"error":"JSON body required"}`.
- Unknown paths get **404** `{"error":"Not found"}`. An unexpected server exception gets **500** `{"error":"Sync request failed"}`.
- Each account lives in its own Durable Object (`VEX_ACCOUNTS`, `idFromName(<account key>)`), and every request for it runs inside that object's `blockConcurrencyWhile`. **Requests for one account are serialised, so the revision check on push is atomic.** Requests for different accounts run in different objects. (Server-internal, from the release after v2.37.0: a shared object, `VEX_STATE`, keeps login codes, rate limits and which account each session token belongs to. Up to v2.37.0 everything was in that one object; the server copies each account out of it on the account's first request. Clients see no difference.)
- The desktop client limits responses to 32 MiB and times out after 30 s (`network.js` `createBoundedFetch`).

### 1.3 Server-wide error states

| Status | Body `error` | When |
|---|---|---|
| 503 | `Sync server is misconfigured: EMAIL_HASH_SECRET is not set` | `EMAIL_HASH_SECRET` is missing or shorter than 32 characters. **Every** non-OPTIONS request gets this. |
| 503 | `Email delivery is not configured` | `/auth/*` only, when `RESEND_API_KEY` is unset and the worker is not in dev mode. Dev mode needs `DEVELOPMENT_MODE === 'true'` **and** a request host of `localhost`, `127.0.0.1` or `[::1]`. |
| 503 | `Durable state is not configured` | The `VEX_STATE` or `VEX_ACCOUNTS` binding is missing. |

A client SHOULD show 503 as "the sync server is not set up" and MUST NOT treat it as signed-out.

### 1.4 Endpoints

#### `POST /auth/request-code`
Request: `{ "email": string }`. The address must contain `@`.

| Status | Body |
|---|---|
| 200 | `{"ok":true,"message":"Code sent to email"}` |
| 200 (dev mode only, no Resend key) | `{"ok":true,"message":"No email configured — use this code","devCode":"668921"}` |
| 400 | `{"error":"Invalid email"}` |
| 429 | `{"error":"Too many requests — try again in a few minutes"}`. The limits are 3 codes per email and 10 per IP, each per fixed 15-minute window. |
| 502 | `{"error":"Could not deliver verification email"}`. Resend failed. |

Each new code replaces the previous one and resets the wrong-guess counter. A code is valid for 10 minutes and is 6 decimal digits, zero-padded.

#### `POST /auth/verify-code`
Request: `{ "email": string, "code": string|number, "deviceName"?: string }`. The server compares `String(code)`, so a number works. `deviceName` defaults to `"Unknown device"` and is **not validated**. A client SHOULD send a short human-readable string; desktop sends e.g. `Windows-7K2Q`.

| Status | Body |
|---|---|
| 200 | `{"ok":true,"sessionToken":"<64 hex>","deviceId":"<32 hex>","emailHash":"<64 hex>","hasEncryptedData":boolean}` |
| 400 | `{"error":"Missing email or code"}` |
| 401 | `{"error":"Invalid or expired code"}` |
| 429 | `{"error":"Too many attempts — try again later"}` (30 verifies per IP per 10 min), or `{"error":"Too many incorrect attempts — request a new code"}` (after 5 wrong guesses the code is burned) |

`hasEncryptedData` is `true` when the account already has a blob. The new session is **pending** (§2.3).

#### `GET /sync/pull`  (Bearer)
| Status | Body |
|---|---|
| 200, account empty | `{"ok":true,"blob":null}`. There is **no** `revision` field: treat it as 0. Note the field name is `blob`, not `encryptedBlob`. |
| 200, account has data | `{"ok":true,"revision":int,"encryptedBlob":string,"updatedAt":string,"pushedBy":"<deviceId>","pushedAt":"<ISO>"}` |
| 401 | see §2.6 |

A pull by a pending session **registers the device** in the device list. This happens even if the client then fails to decrypt the blob (§2.3).

#### `POST /sync/push`  (Bearer)
Request: `{ "encryptedBlob": string, "updatedAt"?: string (ISO), "baseRevision": int }`.

| Status | Body |
|---|---|
| 200 | `{"ok":true,"savedAt":"<ISO>","revision":int}`. The new revision is `baseRevision + 1`. |
| 400 | `{"error":"Missing encryptedBlob"}` |
| 409 | `{"error":"Sync conflict: pull and merge before pushing","revision":int}`. `baseRevision` is missing, is not a safe integer, or does not equal the server's current revision. **An omitted `baseRevision` always gets 409.** |
| 413 | `{"error":"Request too large"}` |
| 401 | see §2.6 |

A successful push replaces the account's blob **entirely**, and it registers a pending device. `updatedAt` is stored and returned by pull, but no client reads it.

#### `GET /sync/devices`  (Bearer, registered devices only)
200: `{"ok":true,"devices":[{"deviceId","deviceName","createdAt","lastSeenAt"}...],"currentDeviceId":"<yours>"}`. A pending session gets **403** `{"error":"This device has not synced yet"}`. Every authenticated non-pending request updates the caller's `lastSeenAt`.

#### `DELETE /sync/devices/:id`  (Bearer)
- `:id` must match `^[a-f0-9]+$` (lowercase hex), or the request falls through to 404.
- A registered device may remove **any** device, itself included. The server deletes the target from the list and deletes every session of the target. It returns 200 `{"ok":true}` even when the id is unknown.
- A **pending** session may remove **only itself** (`/sync/devices/<its own deviceId>`), which deletes its session. Anything else gets 403.

#### `DELETE /sync/all`  (Bearer, registered)
Deletes the blob (the revision goes back to 0), the device list, the handoff mailbox, and **every session of the account, including the caller's**. Returns 200 `{"ok":true}`. The caller's next request gets 401.

#### `POST /sync/drop`, `GET /sync/drop`  (Bearer, registered)
The "Send to My Devices" mailbox. See §7.

### 1.5 CORS: will a browser or PWA client work?

What the worker sends, exactly (constant `CORS_HEADERS`). These are on **every** JSON response and on the `OPTIONS` reply:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Max-Age: 86400
```

`OPTIONS` (on any path) returns **204** with those headers. It is answered before the secret check and before the Durable Object, so preflight works even on a misconfigured worker. Verified:

```
OPTIONS /sync/push  (Origin: https://pwa.example, ACR-Method: POST, ACR-Headers: authorization,content-type)
→ 204, access-control-allow-origin: *, access-control-allow-methods: GET, POST, DELETE, OPTIONS,
       access-control-allow-headers: Content-Type, Authorization, access-control-max-age: 86400
```

**Conclusion: a browser-based or PWA client works without any worker change.**
- The token goes in the `Authorization` header and no cookies are used, so the request is not a "credentialed" CORS request in the cookie sense, and `Allow-Origin: *` is accepted. Do **not** set `credentials: 'include'`. With credentials, `*` would be rejected.
- The client only reads JSON bodies, so no `Access-Control-Expose-Headers` is needed.
- Every method used (GET, POST, DELETE) and every request header used (Content-Type, Authorization) is allowed.

Caveats (not worker bugs):
1. A PWA served over HTTPS needs an `https://` worker URL, or the browser blocks it as mixed content. `*.workers.dev` is HTTPS.
2. **UNSURE:** errors produced by the Cloudflare platform itself, not by `worker.js` (for example an uncaught exception page or a platform rate limit), carry no CORS headers. A browser shows these as an opaque network failure. Treat a network failure as "server unreachable", never as "signed out". This comes from general Cloudflare behaviour, not from code in this repo.
3. A browser client has to keep the 32-byte key somewhere. It SHOULD keep it as a **non-extractable** `CryptoKey` in IndexedDB, and keep the recovery code itself only long enough to show it once.

If a deployment ever needs to restrict origins, the change would be in `worker.js` `CORS_HEADERS`: reflect an allow-listed `Origin` and add `Vary: Origin`. That change is **not** made here and is not needed.

---

## 2. Account and sign-in

### 2.1 Email code flow
1. `POST /auth/request-code {email}` sends a 6-digit code by email. In dev mode the code comes back in the response as `devCode`.
2. `POST /auth/verify-code {email, code, deviceName}` returns `{sessionToken, deviceId, emailHash, hasEncryptedData}`.

The email is trimmed and lower-cased before hashing on the server, so `Me@Example.com` and `me@example.com` are the same account (verified).

### 2.2 Email hash (server side only)
Accounts are keyed by `hex(HMAC-SHA256(key = UTF-8(EMAIL_HASH_SECRET), msg = UTF-8(email.trim().toLowerCase())))`. **The client sends the plaintext email** (over TLS) to both auth endpoints. The worker gets it back as `emailHash` in the verify response, and the desktop stores it but never uses it. A client MUST NOT try to compute or send the hash. Accounts from before the HMAC (keyed by an unsalted SHA-256) are moved server-side on the next sign-in, and this is invisible to clients.

### 2.3 Sessions, devices and the pending state
- `sessionToken`: 64 lowercase hex characters (32 random bytes). It lives for **1 year from creation** and is never extended. After that every call returns 401, and the user signs in again.
- `deviceId`: 32 lowercase hex characters (16 random bytes), issued by the server on every verify. **A client MUST use this exact string** as its clock id in records (§4.4) and in its device marker (§4.6).
- After verify the session is **pending**: the device is **not** in the device list yet. A pending session may only:
  - `GET /sync/pull`
  - `POST /sync/push`
  - `DELETE /sync/devices/<own deviceId>` (to abandon the sign-in)
  
  Anything else gets **403** `{"error":"This device has not synced yet"}`. That includes `/sync/devices`, `/sync/drop` and `/sync/all`.
- The **first successful pull or push** adds `{deviceId, deviceName, createdAt, lastSeenAt}` to the list and clears `pending`. A pull registers the device **before** the client has decrypted anything. A sign-in that then fails (wrong recovery code) therefore leaves a registered device behind, which the client MUST delete (§2.5).

### 2.4 Creating an account versus joining one
The desktop uses `hasEncryptedData` like this (`sync-engine.js` `verifyCode` / `enrollWithRecoveryCode`):

- **Create** (`verifyCode`): only when `hasEncryptedData === false`. If it is anything else, the desktop calls `DELETE /sync/devices/<deviceId>` with the new token and refuses with "This account already has encrypted data … Enroll with your recovery code."
  
  Otherwise the client generates a random 256-bit AES key, saves it, and immediately **pushes with `baseRevision: 0`** a document built from its local data plus its device marker. It shows the recovery code (§3.1) once. If that first push fails, it signs out with server removal.
- **Join** (`enrollWithRecoveryCode`): the user enters email, code **and recovery code**. The recovery code is parsed and imported *before* verify. After verify the client pulls in **restore mode** (§5.4).
  - On a decrypt failure (wrong key) it signs out with server removal and shows "This recovery code doesn't unlock this account's data".
  - On any other pull failure it signs out with server removal.
  - On success it pushes, so this device's local-only data reaches the account.

  Joining an *empty* account with a recovery code also works: the pull is empty, and the push creates the account under that key.
- Two devices creating the same account at the same moment: the second push gets 409, pulls, and fails to decrypt (its key is different). It then signs out. No data is overwritten.

### 2.5 Leaving
- **Sign out** (desktop: Settings › Sync › Sign out → `signOut(true)`): `DELETE /sync/devices/<own deviceId>`, then drop all local sync state (token, key, record document, revision). Local app data (bookmarks and so on) is **kept**.
- **Abandoned sign-in** (wrong recovery code, failed first push): the client MUST call `DELETE /sync/devices/<own deviceId>` so no ghost device stays listed. A ghost device without a marker also blocks tile sync for everyone (§4.6).
- **Remove another device**: `DELETE /sync/devices/<theirId>`. That device's next call gets 401.
- **Wipe** (`DELETE /sync/all`): afterwards the caller is signed out too (401). The desktop resets `revision = 0`, drops its record document and signs out locally.

### 2.6 Signed out by the server (401)
On any `/sync/*` call:
- `{"error":"Unauthorized"}`: no token was sent.
- `{"error":"Invalid session"}`: the token is unknown. It expired, the device was removed, or the account was wiped.
- `{"error":"Device revoked"}`: the session exists but the device is no longer listed. The server deletes the session in this case.

The desktop treats every 401 from push, pull or the device list the same way: it signs out locally **without** a server call and shows "This device was signed out of Vex Sync — the server no longer recognises it … Sign in again". A client MUST NOT retry with the same token, MUST NOT delete local user data, and SHOULD discard its record document and revision. The next sign-in is a join (§5.4).

---

## 3. Encryption

### 3.1 Recovery code = the raw key
There is **no key derivation**: no PBKDF2, no salt, no iterations, and the email is not involved. The AES key *is* the recovery code.

- Key: 32 random bytes (`crypto.subtle.generateKey({name:'AES-GCM', length:256})`, exported raw).
- Canonical form: 64 lowercase hex characters (`keyToHex`).
- Display form (`formatRecoveryCode`): upper-case, in groups of 8 joined by `-`. That gives 8 groups of 8 characters, 71 characters in all:
  `00010203-04050607-08090A0B-0C0D0E0F-10111213-14151617-18191A1B-1C1D1E1F`
- Parsing (`parseRecoveryCode`): remove every character that is not `[0-9a-fA-F]`, then lower-case. The result must match `^[0-9a-f]{64}$`, or the client fails with "Invalid recovery code — must be 64 hex chars". The parser is lenient, so spaces, dashes and newlines are all fine.

### 3.2 Cipher
- AES-256-GCM, 96-bit (12-byte) random IV, 128-bit tag (WebCrypto default), **no AAD**.
- Plaintext: `UTF-8( JSON.stringify(document) )`. The **whole** record document is one ciphertext. There is no per-record encryption.
- Blob = `base64( IV(12) ‖ ciphertext ‖ tag(16) )`. WebCrypto appends the tag to the ciphertext. The encoding is standard base64 (`btoa`) with padding, not URL-safe.
- Decryption: base64-decode, take bytes 0–11 as the IV and the rest (ciphertext ‖ tag) as GCM input, then `JSON.parse(UTF-8 decode)`.
- A fresh random IV MUST be used for every encryption. The fixed IV in §3.6 exists only to make a test vector.

### 3.3 Wrong key detection
GCM tag verification fails, and WebCrypto rejects with `DOMException` name **`OperationError`** ("The operation failed for an operation-specific reason"). The desktop maps exactly that to a `badKey` result. Other platforms report the same condition differently: `AEADBadTagException` on Android/JCE, `CryptoKitError.authenticationFailure` in Swift, `SecretBoxAuthenticationError` in Dart `cryptography`, and so on.

**Any tag failure means "wrong recovery code"**. The client MUST then stop: no apply and no push (§6, rule 12).

### 3.4 What is encrypted, and what is not
- Encrypted: the record document (`encryptedBlob` on push and pull) and each handoff item (§7).
- Not encrypted (the server can see it): the email (at request time), `deviceName`, device timestamps, `updatedAt`, revision numbers, blob sizes, the sender of each handoff item and when it was sent.

### 3.5 Key storage
The desktop keeps the key hex through `window.vex.syncSaveKey` in the main process, and the session metadata (`email, sessionToken, deviceId, emailHash, lastPushAt, lastPullAt, revision`) through `syncSaveMeta`. A mobile client SHOULD use the platform keystore (Keychain or Android Keystore) for the key and the token.

### 3.6 Test vector (generated by the real code)
Generated by `sync-crypto.js` with `crypto.getRandomValues` fixed to return the IV below, and checked independently with Node `crypto.createCipheriv('aes-256-gcm')`, which produced identical bytes. The document is the output of the real `VexSyncRecords.capture(empty(), flatten(sources), deviceId)` with `Date.now()` fixed at `1767225600000`.

```
Recovery code (display) : 00010203-04050607-08090A0B-0C0D0E0F-10111213-14151617-18191A1B-1C1D1E1F
Key (hex)               : 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
IV  (hex)               : a0a1a2a3a4a5a6a7a8a9aaab
Device id               : 0123456789abcdef0123456789abcdef
Plaintext length        : 808 bytes (UTF-8)
Blob length             : 836 bytes before base64 (12 IV + 808 ciphertext + 16 tag)
Tag (hex)               : cd449705d23588dceb36f06f9d4beb40
```

Source values that were flattened:
```json
{
  "preference:vex.bookmarks": [{ "id": "bm1", "url": "https://example.com/", "title": "Example", "folder": "", "at": 1767225600000 }],
  "sync:device:0123456789abcdef0123456789abcdef": { "level": 1 }
}
```

Exact plaintext. It is one line, there is no trailing newline, and these are the bytes that were encrypted:
```
{"schema":2,"records":{"[\"preference:vex.bookmarks\",\"type\"]":{"clock":{"0123456789abcdef0123456789abcdef":1},"deleted":false,"value":"array","at":1767225600000,"conflicts":[]},"[\"preference:vex.bookmarks\",\"item\",\"bm1\"]":{"clock":{"0123456789abcdef0123456789abcdef":1},"deleted":false,"value":{"index":0,"item":{"id":"bm1","url":"https://example.com/","title":"Example","folder":"","at":1767225600000}},"at":1767225600000,"conflicts":[]},"[\"sync:device:0123456789abcdef0123456789abcdef\",\"type\"]":{"clock":{"0123456789abcdef0123456789abcdef":1},"deleted":false,"value":"scalar","at":1767225600000,"conflicts":[]},"[\"sync:device:0123456789abcdef0123456789abcdef\",\"value\"]":{"clock":{"0123456789abcdef0123456789abcdef":1},"deleted":false,"value":{"level":1},"at":1767225600000,"conflicts":[]}}}
```

Exact blob (base64, as sent in `encryptedBlob`):
```
oKGio6SlpqeoqaqrnToPTi2ub95AX7X/JQilvR/ePWOwjTlOx1IE9g3OE2SgEymcyhglWCeyZqdmEe6YNXA1FED8Rlw1J3s7+FLYko7HpwxcyoeL1tiEOr///on5Pp2T/fj4GI0RW/yBq3+nu7EdnDuX7vn9v2M2p7LcVQhyBcuyUO9ZS+3kwtU5gSjpM8YevzflNQ17n/lgK+j0pPvMH5zqy7vL+o/HmvEEG/YoL52UCS945GZCQRuhlNsse4C0ID3yHPLwE1858Ho5V1N2vwWplY+cMiuiKFZZxg7LyLQdCqzdgJ16yQHkuApZDRB8m1eiHaPQLTwpKXoEKY3zDbpmRbFclZQLB1BM93EP+LXc+JfWUZtu5AVYCLZeMzBhxpbhTp0Lc66H1KYX/Skq0UUuX7uEATtJ0ZX9fLF5ujBzRPmTXoIE2fDglzmu/Hq03E8Xdf7pSSW1cabLWfmkeeI6R4NiMLuvEFupPS12jDO5XAd61uN39QfPduz3zksp5FByrMEmYTK7iL+NT7mDANdguiEZLIZSGpqe/C3VKa7hC7VLGpPb5E4ABgG9cHd+eYXAvxVJE87/b6RIbtSg5xvUtASQZb/goQ8Ihw/ylJ+FtPbeuPOoJYpVOOv47dp3BiK3TxX8hkKjON7BZ8q6YK4zJbi0XR0l3BcfZyfw6poF4K1uvmVJwsKkM28tWLanEm5kP4VA1rTboe0kLNz76e7yDOQjnk2RrrfTe1IO2de7g8o7X6WyIO9iovBR+Ib3HZJDd8ZHbiUS4c7WYMLStP0S2fn2fJFpBuBvOZ8vPg0W0Y2P72m+vH0mH2pu596mUh3DcIyJe8Dh6HGCcDIYtKa0IwSVRDZhMshMZ3X9nz5tQ+orfc1U6PpoRK5azzW0Twzvk4ehO1VIgT30WMuoET9Ld0qg7lECYoF6QlYSjg3wibJSwbqyGJefzpbz8aqXBPh+ofkfmQ66Iy+JVeyKwzyYtAL3RmlcvwP8XB+XUC5V38VAmlSZUuW7C20ewpRX7h1LxtN2u4rQLgnws7SOEuzmmRT0ws0R9XxUDipvBXjy9wM/+HXiMeZsT/5RbJSmAzdy3c1ElwXSNYjc6zbwb51L60A=
```

Handoff vector (§7), same key and same IV. Plaintext `{"url":"https://example.com/","title":"Example"}` gives:
```
oKGio6SlpqeoqaqrnToJXynpOJ0KEfOjdEDv8RXUOH3i2ydC/2FLqV2HV3W7AiuajRhxeCf9abhlH6GEPQdxr/1P2LZzERl0S7rSuA==
```

Decrypting the first blob with key `ff…ff` (32 × `0xff`) MUST fail with an authentication error (WebCrypto: `OperationError`).

How to use the vector:
1. Decrypt the blob with the key, and check that the result equals the plaintext byte for byte.
2. Encrypt the plaintext with the key and the fixed IV, and check that the blob matches byte for byte.
3. Parse the plaintext, re-flatten the source values with your own `flatten` and `capture` (fix `at` = 1767225600000), and compare the record keys and values with the plaintext.

---

## 4. Document and record format

### 4.1 Document
```json
{ "schema": 2, "records": { "<recordKey>": <record>, ... } }
```
`VexSyncRecords.valid` rejects a document unless **all** of these hold:
- `schema === 2`, and `records` is a plain object with **≤ 30 000** records.
- For each record key:
  - it is not `__proto__`, `constructor` or `prototype`;
  - its length is ≤ 4096;
  - its record is a plain object;
  - `clock` is a plain object with ≤ 100 entries, each key matching `^[a-zA-Z0-9_-]{1,80}$` and each value a safe integer ≥ 0;
  - `deleted` is a **boolean**. It is required.
  - `at`, if present, is a safe integer ≥ 0;
  - `conflicts`, if present, is an array of ≤ 100 plain objects, each with boolean `deleted`.

A document that fails validation makes the desktop's pull fail. While that failure lasts the desktop cannot push either (`pullBlocked`), so one bad push breaks sync for every desktop until it is repaired.

**Legacy documents** (written by very old Vex, before records existed) have no `schema` field. They are a flat object `{ "vex.bookmarks": "<raw string>", "vex.tabs": ..., ... }`. The desktop converts them on pull (`applySyncData`):
- each preference key's value goes to `preference:<key>`; list keys (§4.5) that hold a string are `JSON.parse`d;
- each `vex.<storeKey>` goes to `storage:<storeKey>`, `JSON.parse`d if possible;
- the result is `capture(empty(), flatten(sources), 'legacy')`.

A document with any other `schema` value makes the desktop throw "Unsupported sync schema". A mobile client MAY convert legacy documents the same way, or MAY refuse them. Either way it MUST NOT push over a document it could not read.

### 4.2 Sources
A **source** is one named value of app state:
- `preference:<localStorage key>`, for example `preference:vex.bookmarks`. Lists are JSON arrays; all other preferences are carried as the **raw localStorage string**.
- `storage:<file-store key>`, for example `storage:tabs`, `storage:settings`. These are JSON values, possibly `null`.
- `sync:device:<deviceId>`, the device marker (§4.6).

### 4.3 Record keys (flatten)
A record key is the exact output of JavaScript `JSON.stringify` on an array:

| Kind | Key | Record `value` |
|---|---|---|
| type | `["<source>","type"]` | `"array"` if the source value is a JSON array, otherwise `"scalar"` |
| whole value (non-array) | `["<source>","value"]` | the value itself (string, object, number, boolean, null) |
| list item (array) | `["<source>","item","<itemId>"]` | `{"index": <position in list>, "item": <the item>}` |

How `flatten` derives the item id (`sync-records.js`):
```
itemId = String( item?.id ?? ( item?.url ? item.url + ':' + (item.time || '') : JSON.stringify(item) ) )
```
- An item with `id` uses it: `bm1`, `note_1767225600000_ab12c`.
- An item with no `id` but a `url` gets `url + ':' + (time || '')`. For example `storage:history` rows `{url,title,time}` get `https://a.test/:5`, and an item with no `time` gets `https://a.test/:`.
- Anything else uses its JSON text. A plain string item such as a force-dark host `"example.com"` gets the id `"example.com"` **including the quotes**, so its key is `["preference:vex.forceDarkHosts","item","\"example.com\""]` (verified).
- Two items in one list with the same id collapse into one record, and the later one wins. **Item ids MUST be unique within their list.**

Key bytes MUST match JavaScript `JSON.stringify` exactly: no whitespace, `/` **not** escaped, non-ASCII characters written literally, `"` and `\` escaped, and control characters written as `\b \f \n \r \t` or `\u00xx` with lowercase hex. One example of how this goes wrong: Swift's `JSONEncoder` escapes `/` as `\/`, so `["…","item","https:\/\/a.test\/:5"]` would be a **different record** from the desktop's. That creates a duplicate and leaves a ghost that the other side tombstones. The safest approach is to **reuse existing keys verbatim**, and only build new keys for brand-new items.

### 4.4 Records
A record written by `capture` has exactly this field order:
```json
{ "clock": { "<deviceId>": <int>, ... }, "deleted": false, "value": <any>, "at": <ms epoch int>, "conflicts": [] }
```
- `clock` is a version vector. Each device increments **its own** entry every time it changes the record. The entry key is the server-issued `deviceId`; the desktop's legacy conversion uses `legacy`.
- `deleted: true` marks a tombstone, and its `value` is `null`. Tombstones are kept forever. Nothing garbage-collects them.
- `at` is `Date.now()` on the device that made the edit. It decides concurrent edits (§5.2).
- `conflicts` holds the variants kept from a concurrent merge, each `{deleted, value, at}`. A new local edit clears it to `[]`.
- A record produced by **merge** has field order `{deleted, value, at, clock, conflicts}` (`{...winner, clock, conflicts}`). Field order is not semantic, but see rule 9 in §6.

### 4.5 List sources versus whole-value sources
`flatten` turns **every** JSON array into item records, whatever its source. The lists that matter are:

- **`LIST_PREFERENCES`** (`sync-engine.js`). The desktop always sends these as arrays, and refuses with "Invalid <name> data" when the local value is not an array:
  `vex.bookmarks, vex.sessions, vex.history, vex.notes, vex.tools, vex.schedules, vex.personas, vex.reminders, vex.forceDarkHosts`
- **`TILE_LISTS`**: `vex.shortcuts`, `vex.startTiles`. These are item lists gated by device markers (§4.6).
- **`storage:` arrays**: `storage:tabs`, `storage:groups`, `storage:stacks`, `storage:history` are arrays, so they are itemised too.

Every other preference is a **scalar**: its value is the raw localStorage string. Examples are `"auto"`, `"true"`, and `"[...]"` for `vex.workspaces`, which is stored as a JSON **string**. `storage:settings`, `storage:theme` and `storage:shortcuts` are scalars as well (an object or `null`).

`unflatten` rules (`sync-records.js`), applied to the *values* of non-deleted records:
- A `type` of `"array"` starts the source as `[]` and fills it with its item rows, sorted by `index` ascending. Ties are broken by record key, comparing as JS strings (UTF-16 code-unit order).
- A `type` of anything else, plus a `value` record, gives the source that value.
- **Mixed shapes:** an older Vex may still send a list source whole (type `scalar`, value is a JSON *string*) while newer devices write item rows. When both are present, **the whole value wins** and the item rows are ignored. During a restore-mode join (§5.4), the cloud's whole value also wins over local item rows.
- Item rows whose `type` record is deleted or missing still become a list.
- A source whose records are all deleted is **absent**. When a source the desktop owns (§6 rule 1) is absent after a merge, the desktop **removes that localStorage key**, which deletes that data on the desktop.
- The value of an item record must be an object with a safe-integer `index ≥ 0`, or the desktop throws "Invalid sync array item".

`index` is just the position in the list at capture time. Inserting at the front (the desktop's bookmark add uses `unshift`) changes `index` on every later item, and each of those counts as an edit of that item's record. See §5.5.

### 4.6 Device markers and tile gating
Every current client writes a scalar source `sync:device:<its deviceId>` with value `{"level": 1}`. That is two records:
```
["sync:device:<id>","type"]  → "scalar"
["sync:device:<id>","value"] → {"level":1}
```
`SYNC_LEVEL = 1` means "understands shortcut tiles and the New Tab grid" (Vex 2.34.3+). Before writing tiles, each desktop runs `checkTileGate`:
1. `GET /sync/devices`.
2. For every listed device other than itself, it checks the cloud document for a non-deleted marker with `value.level >= 1`.
3. If any listed device lacks one, the **gate is shut**. The desktop then leaves `preference:vex.shortcuts` and `preference:vex.startTiles` records exactly as it found them, and keeps its tiles local. A failed device-list call (or 403) also shuts the gate.

The reason: Vex ≤ 2.34.2 tombstoned every record it did not know on each push, which wiped other devices' tiles. (Vex 2.34.3 to 2.35.1 still tombstoned every source they did not know other than tiles and markers; see §6 rule 1. A level-1 marker does not tell those versions apart from v2.35.2.) When an older device joins, the gate shuts again; when it leaves, the gate reopens and each device merges its tiles back in ("join").

Consequences for a new client:
- A client that registers (pull or push) but never writes its marker **shuts tile sync for every device on the account**.
- An older desktop that pushes tombstones the markers. A current desktop that pulls and finds **its own** marker missing or deleted pushes again right away (`markerMissing`). A mobile client MUST do the same.
- Other devices' markers MUST be copied verbatim, including when they are tombstones.

Tile ids exist only in the account. The desktop adds them before flattening and strips them before saving tiles locally (`withTileIds` / `withoutTileIds`):
```
hash = 0x811c9dc5
for each Unicode CODE POINT cp of String(tile.url):      // JS for..of + codePointAt — NOT UTF-8 bytes
    hash = (Math.imul(hash ^ cp, 0x01000193)) >>> 0       // 32-bit FNV-1a-style multiply, unsigned
base = "tile-" + hash.toString(16).padStart(8,'0')        // lowercase hex
the n-th tile (n ≥ 2) in the list with the same base gets base + "-" + n
```
Vectors (from running the real `withTileIds`):

| url (in list order) | id |
|---|---|
| `https://a.test` | `tile-c03203f1` |
| `https://www.google.com` | `tile-8739bc55` |
| `https://a.test` (2nd) | `tile-c03203f1-2` |
| `https://a.test` (3rd) | `tile-c03203f1-3` |
| `https://例え.jp/ü` | `tile-65074de8` |
| `https://x.test/😀` | `tile-4c794857` |

Because it hashes code points rather than UTF-8 bytes, this is **not** standard FNV-1a for non-ASCII URLs. Implement it exactly as written.

---

## 5. Merge algorithm

### 5.1 capture(before, values, deviceId) → document
`values` is a **flat** map of recordKey → value: the output of `flatten(sources)` for every source the device has. For every key in `before.records ∪ values`:
- `deleted = !(key in values)`, and `value = deleted ? null : values[key]`.
- If `before` has the record with the same `deleted` and a `value` whose `JSON.stringify` is identical, it is **unchanged**: keep it as is, conflicts included.
- Otherwise write `{clock: {...previous.clock, [deviceId]: (previous.clock[deviceId]||0)+1}, deleted, value, at: Date.now(), conflicts: []}`.

**Any record key present in `before` but missing from `values` becomes a tombstone.** This is how deletion works, and it is also how a careless client destroys data (§6).

### 5.2 merge(left, right) → document
For each key in `right` (keys only in `left` are kept as they are):
- Absent on the left: take the right-hand record.
- `dominates(a,b)` means every `b.clock[k] <= a.clock[k]`, with missing entries counting as 0.
- If both dominate and the records are JSON-equal: keep. If only left dominates: keep left. If only right dominates: take right.
- Otherwise, a **concurrent** edit:
  - Collect the variants: `a.conflicts ++ b.conflicts ++ [{deleted:a.deleted,value:a.value,at:a.at}, {deleted:b.deleted,value:b.value,at:b.at}]`.
  - Deduplicate by `JSON.stringify({deleted, value})`. For duplicates, keep the variant with the larger `at` (missing counts as 0).
  - Sort the unique variants by that JSON string, ascending (JS `<` on strings, which is UTF-16 code-unit order).
  - Winner: the **first deleted variant**, if any (a deletion wins a concurrent edit). Otherwise the variant with the strictly greatest `at`; on a tie, the **last** variant in sorted order.
  - The result is `{...winner, clock: pointwise-max(a.clock, b.clock), conflicts: uniqueSortedVariants}`.
- Merge is commutative: `merge(a,b)` and `merge(b,a)` give the same values (tested).
- **A record missing from one side never deletes anything.** Only tombstones delete.

### 5.3 A normal round (desktop: `pullNow` + `pushNow`)
State a client persists: `recordDocument` (the last merged document), `revision` (int), the key, the token and the deviceId.

**Pull:**
1. `GET /sync/pull`. A 401 means signed out (§2.6).
2. If the response has no `encryptedBlob`, the account is empty (new, or its blob was lost while sessions survived). Replace `recordDocument` with an empty document and persist it, **then** set `revision = response.revision || 0`, and stop. The next push is then built from the empty document plus this device's own data (rule 3). The stored copy of the earlier document MUST NOT be pushed: it would bring back records nobody holds any more, other clients' included. (Desktop from v2.35.2; earlier desktops pushed their stored copy.)
3. Decrypt. On a tag failure, stop: report "wrong key", do not change anything, and **block pushes** until a pull succeeds.
4. Validate the document (§4.1), converting it first if it is legacy.
5. `local = capture(recordDocument, flatten(currentLocalSources), deviceId)`. This records local edits made since the last round.
6. `merged = merge(local, cloud)`.
7. `sources = unflatten(values(merged))`, taking only the records of sources this device owns (rule 1). Validate them with data-contracts (§8.4). A failure throws: nothing is applied, and pushes stay blocked. Records of sources it does not own are neither read nor validated; they stay in `merged` as they came.
8. Apply the sources to app state. A source it owns that is now **absent** has its local copy removed.
9. Persist `recordDocument = merged`, **then** `revision = response.revision`. Order matters: a revision must never be acknowledged without the merged document it belongs to.
10. If this device's own marker is missing or deleted in the cloud document, push right away.

**Push:**
1. If pushes are blocked by a failed pull, refuse.
2. `doc = capture(recordDocument, flatten(currentLocalSources ∪ ownMarker), deviceId)`, with the rule-1 preservation from §6 applied: every record this device does not own is then put back exactly as it is in `recordDocument`, in the same place.
3. Encrypt and `POST /sync/push {encryptedBlob, updatedAt: nowISO, baseRevision: revision}`.
4. 200: set `revision = response.revision` and persist `recordDocument = doc`.
5. 409: run **Pull**, which merges, then push **once more**. The desktop gives up after the second 409 ("Another device synced at the same moment — try again"). A mobile client SHOULD allow a few retries, because desktops push often (§5.6).
6. 401: signed out (§2.6).

A push never merges with the server. Its correctness depends on `baseRevision`: because of it, a push can only replace the blob that the client last merged.

### 5.4 Restore mode: joining with a recovery code
On the join pull (`restore: true`), the desktop does **not** call `merge`. Instead:
- Start from the cloud records: `merged.records = {...cloud.records}`. The **cloud wins every record it has**, tombstones included.
- Add each local record whose key is not in the cloud and which is **not deleted**. Skip a local record when the cloud has a non-deleted `type` record for that source whose value differs from the local `type` value. In that case the cloud's shape wins whole (for example an older Vex holding notes as one string).
- **Bookmarks with an address the account already has** (from v2.35.2): skip a local `preference:vex.bookmarks` item whose `item.url` is the exact same string as the `url` of a **non-deleted** bookmark item in the cloud, when their ids differ. The account's copy is kept, and the local one disappears from this device when the merged list is applied. The comparison is plain string equality, with no normalisation, as the desktop's star button uses (`bookmarks.js` `has()`). A tombstoned cloud bookmark does not count, so a local bookmark of an address the account deleted is kept. Local bookmarks whose address the account does not have are added as before.
- No other list is deduplicated. Notes, history visits, sessions, tools, scheduled tasks, personas and reminders have no natural key that would make two of them the same thing (two history visits of one URL are two visits, two notes may share a title). Force-dark hosts and tiles already use the natural key as their id (§4.3, §4.6), so a duplicate is the same record.
- Tiles get their own handling if the gate is open (`collectSyncData` with `gate.join`): the account's tiles are united with the local ones by tile id, and then merged.
- No conflict toast is shown. Afterwards the client pushes, so its local-only records reach the account.

A device with no local data can just adopt the cloud document.

### 5.5 Deletes, concurrent edits and indexes
- Delete on device A plus an edit of the same item on device B: the **delete wins**. The edit remains in `conflicts`, but no UI offers to recover it.
- Two concurrent edits: the newer `at` wins. Clock skew between devices therefore matters, and the device with the faster clock wins ties it should not.
- Removing an item on A while B adds a different item: both stand (tested).
- Inserting at the front re-indexes later items. If two devices do that concurrently, every shifted item becomes a "conflict" (same item, different `index`) and the desktop toasts "N sync conflicts retained in recovery data". The data is fine. A mobile client SHOULD append new list items **at the end** to keep this churn small. The desktop shows bookmarks grouped by folder and in stored order; notes and history are sorted by their timestamps, so the position barely matters there.

### 5.6 Timing (desktop)
- Push every 2 minutes, pull every 5 minutes, pull 1.5 s after start, and "Sync Now" (pull, then push).
- **The desktop pushes on its timer even when nothing changed**, so the revision rises by about 1 every 2 minutes per running desktop. Expect frequent 409s.
- Handoff polling: on window focus, every 2 minutes, and 8 s after launch.

---

## 6. Compatibility rules for a new client

**Preserving other devices' data**

1. A client **MUST NOT tombstone, drop or rewrite any record whose source it does not own.** Build the push document like this: take the last merged document, run `capture` only over the sources you own plus your marker, and copy **every other record verbatim** from that document. That includes tombstones, `conflicts`, `clock` and field order. In practice: build `values` as `values(before)` minus your owned sources, plus `flatten(ownedSources)`, run `capture`, and then put back every non-owned record from `before` untouched.

   **What the desktop owns** (from v2.35.2, `sync-engine.js` `ownsRecord`): the record kinds `type`, `value` and `item` of `preference:<key>` for each preference in §8.1, `storage:<key>` for each storage key in §8.1, its own `sync:device:<id>`, and the two tile lists while the tile gate is open (§4.6). Every other record (another device's marker, a source a newer Vex or another client added, a record kind it does not know, tiles while the gate is shut) is copied verbatim from the document it pulled, tombstones included, and is not read, applied or validated. Deletions of what it owns still work: an item or key that is gone locally becomes a tombstone.

   **Older desktops:** Vex 2.34.3 to 2.35.1 pass through only other devices' markers and the tiles; every other source they do not know is tombstoned on their next push, and then removed everywhere. Their markers say level 1 just like v2.35.2's, so a client cannot tell them apart. A client SHOULD therefore write only sources listed in §8.1, never a source of its own invention.

   Doing otherwise is exactly the bug in which Vex ≤ 2.34.2 wiped other devices' shortcut tiles. Verified with the real code: a naive `capture(cloud, flatten({bookmarks}), phone)` tombstones notes, settings, tiles, every scalar preference and the desktop's marker. After that each desktop **deletes those from its own storage** on its next pull.
2. A client MUST own only the sources it fully understands and holds **completely**. Owning a source means pushing its full current list, because any item left out becomes a tombstone. Do not own `preference:vex.history` unless the full history is held locally.
3. A client MUST always push a document derived from the latest document it pulled. Never push one built from scratch, from a stale cache or from an empty document, except when the account is empty. That is either a brand-new account (`hasEncryptedData: false`, pushed with `baseRevision: 0`), or a pull that returned `{"blob": null}` (pushed with that pull's revision, i.e. 0). In both cases the push MUST be built from an **empty** document plus the client's own data and marker, never from a document the client stored before (§5.3 pull step 2).
4. A client MUST send `baseRevision` as an integer on every push. It MUST store the revision only after the matching merged document is safely persisted.

**Device markers**

5. A client MUST write its own marker `sync:device:<deviceId>` = `{"level":1}` in **every** document it pushes, using the server-issued `deviceId`. It MUST NOT write a level higher than 1 until this spec says so: a higher level would promise it understands future features. It MUST copy other devices' markers verbatim.
6. After any pull in which its own marker is absent or deleted, a client MUST push soon, on the next round at the latest. The desktop pushes immediately.
7. A client SHOULD push its first document right after its first successful pull or verify. Until its marker is in the account, tile sync is shut for everyone.

**Format and encoding**

8. Clock ids, record keys and markers MUST use the server-issued `deviceId` (32 lowercase hex). Clock key regex: `^[a-zA-Z0-9_-]{1,80}$`.
9. A client MUST keep **JSON object key order** and **number representation** for every record and value it does not change.
   - `capture` and `merge` compare with `JSON.stringify`. A reordered but otherwise identical record looks like an edit to `capture` and like a conflict to `merge`, which leads to conflict toasts and clock churn.
   - Use an order-preserving JSON model: JS objects, Dart `jsonDecode` (LinkedHashMap), kotlinx.serialization `JsonObject`, Swift with an ordered JSON type or raw JSON passthrough. Do **not** use Swift `JSONSerialization`/`[String: Any]` or `org.json.JSONObject`.
   - Integers such as `at` and `index` MUST stay integers (no `1.767e12`, no `.0`).
10. Record keys MUST be byte-identical to JS `JSON.stringify([...])` (§4.3). Reuse existing keys. When re-flattening a list you own, check that every unchanged item maps back to the key it already had.
11. Every record a client writes MUST include `clock` (object), `deleted` (boolean), `value` (`null` when deleted), `at` (integer ms) and `conflicts` (array). The full document MUST pass §4.1. **Every source value a client writes MUST pass the desktop's data-contracts (§8.4)**: one invalid value in a source the desktops read (for example a bookmark with a `javascript:` URL) makes every desktop's pull fail, and with it every desktop's push, until the value is repaired. A client validates what **it** writes. It MUST NOT refuse to pull or push because a record of a source it does not own fails its checks: it carries that record verbatim (rule 1), as the desktop does from v2.35.2 (§5.3 pull step 7). Desktops up to v2.35.1 validated every source in the merged document, owned or not, so a value no desktop owns must still pass §8.4 while any of them is on the account.
12. On an authentication-tag failure, a client MUST NOT push, apply or "reset" anything. A wrong key followed by a push would overwrite the account with data nobody else can read.
13. A client MUST ignore unknown fields inside items it edits and **carry them through unchanged**. Bookmarks, for example, may have `ownSession: true`. It MUST ignore unknown sources and record kinds by copying them verbatim (rule 1). It MUST refuse documents with an unknown `schema`.

**Server status codes**

14. On **409**: pull, merge (or re-apply the pending local operations to the fresh document), and push again with the new revision. Never re-send the same body with a guessed revision.
15. On **401**: stop using the token, sign out locally, keep the user's data, and do not call DELETE (the session is already gone). Prompt the user to sign in again.
16. On **403** "This device has not synced yet": the session is pending. Pull or push first, after which device list and handoff calls work.
17. On **503**: the server is misconfigured. Show that, and keep the session.
18. A client MUST `DELETE /sync/devices/<own id>` when it abandons a sign-in, including after a failed decrypt, because the pull already registered the device. It SHOULD also do this on user sign-out.

**Sources the phone must not write**

19. A client MUST NOT write `storage:tabs`, `storage:groups` or `storage:stacks`. The desktop applies them live to its open tabs (`TabManager.applySyncedState`), so writing them opens and closes tabs on the user's computers.
20. A client MUST NOT write tile sources (`preference:vex.shortcuts`, `preference:vex.startTiles`) while the tile gate is shut. That is, unless every listed device, the client included, has a marker with level ≥ 1. When writing tiles, it MUST give them the §4.6 ids and must not keep those ids in its local copy.
21. A client SHOULD keep its document well under the size limit (§1.2). The desktop's history alone can be thousands of records.

---

## 7. Send to My Devices (handoff, "drop")

A small per-account mailbox, separate from the record document.

- **Send**: `POST /sync/drop {"encryptedBlob": string}` (Bearer, registered device).
  - The payload is `SyncCrypto.encrypt({url, title}, key)`: the same AES-GCM format and the same account key as the document (§3.2).
  - The desktop only sends `http:`/`https:` URLs, `url` truncated to 2048 characters and `title` to 300 (`String(title||'')`).
  - The server requires a non-empty string of **≤ 16 384 characters**, else **400** `{"error":"Encrypted handoff required (max 16 KB)"}`.
  - It stores `{id: <16 hex>, encryptedBlob, fromDeviceId, fromDeviceName, at: <ISO>}`, keeps only the **newest 20** items, and refreshes the whole mailbox's TTL to **7 days** on each send.
  - Returns 200 `{"ok":true}`.
- **Fetch**: `GET /sync/drop` returns 200 `{"ok":true,"items":[{id, encryptedBlob, fromDeviceId, fromDeviceName, at}, ...]}`. That is every item **not** sent by the caller.
  - Fetching **consumes** those items: they are deleted from the server. The caller's own items stay.
  - There is no addressing. Whichever other device fetches first gets the tab, whether that is the phone or one of several desktops.
- **Receiving**: decrypt each item on its own and skip any that fail, because one bad item must not lose the others. Accept the item only if `payload.url` is a string with an `http:` or `https:` scheme, and use `String(payload.title || '')`. Because the fetch has already consumed the items, a client SHOULD keep what it accepted until the user acts on it (the wire format is unchanged). The desktop (from the release after v2.37.0, `js/handoff.js`) keeps each one on that computer, shows it as a card "From <fromDeviceName>: <title>" on the New Tab page with Open and Dismiss, and shows one desktop notification per check; a card goes when it is opened or dismissed. Earlier desktops opened each one as a background tab and toasted "Tab from <fromDeviceName>: <title>". A desktop never sends from a private, Off-the-Record or Tor tab or from a private window, and a private window never fetches.
- **No device list of open tabs**: the protocol carries no per-device list of open tabs. `storage:tabs` is the open-tab set shared by desktops (§8.2), which a phone MUST NOT write (§6 rule 19), so a desktop cannot show "tabs open on your phone".
- Pending sessions get 403 on both endpoints.

---

## 8. Synced sources: what a mobile client can use

### 8.1 Complete list (from `SYNC_KEYS`, `preferenceKeys()`, `STORE_KEYS` and `TILE_LISTS`)
- **List preferences** (arrays): `vex.bookmarks`, `vex.sessions`, `vex.history`, `vex.notes`, `vex.tools`, `vex.schedules`, `vex.personas`, `vex.reminders`, `vex.forceDarkHosts`.
- **Scalar preferences** (raw localStorage strings): `vex.workspaces`, `vex.agentMode`, `vex.aiIndexingEnabled`, `vex.zooms`, `vex.forceDarkSites`, `vex.autoSleepPrefs`, `vex.aiRouting`, `vex.preferLocalAI`, `vex.forceCloudAI`, `vex.activePersona`, `vex.aiMemory`, `vex.autoGroupSuggest`, `vex.autoAddToGroups`, `vex.groupPatterns`, `vex.userShortcuts`, `vex.tabLayout`. All are prefixed `preference:`.
- **No longer synced** (removed after v2.36.4): `vex.autosleep`, `vex.autosleepMinutes`, `vex.autosleepExcludePinned` (never written by anything; auto-sleep travels as `vex.autoSleepPrefs`), `vex.customCommands`, `vex.settings` and `vex-theme`. A newer desktop no longer owns these, so records an older desktop still sends under them are copied verbatim (§6 rule 1) and never applied.
- **Tile lists** (gated): `preference:vex.shortcuts`, `preference:vex.startTiles`.
- **Storage**: `storage:tabs`, `storage:groups`, `storage:stacks`, `storage:history`, `storage:settings`, `storage:shortcuts`, `storage:theme`. The desktop always sends these, possibly as `null`.
- **Markers**: `sync:device:<id>`.

`vex.tabs`, `vex.theme`, `vex.groups` and `vex.shortcuts` are in `SYNC_KEYS` but are **not** sent as `preference:`: their names collide with `STORE_KEYS`. They travel as `storage:*`, or for shortcuts as a tile list.

### 8.2 Sources a phone can sensibly read and write

| Source | Read | Write | Item schema and notes |
|---|---|---|---|
| `preference:vex.bookmarks` | yes | **yes (recommended owned source)** | `{ "id": string, "url": http(s) string, "title": string, "folder": string ("" = Unsorted), "at": ms int, "ownSession"?: true }`. `id` matches `^[\w.:-]{1,160}$`. The desktop makes ids like `bm` + base36 time + base36 counter + 5 random base36, e.g. `bmmg5k2x01a3f9q`; any unique id matching the regex is fine. The desktop adds new bookmarks at the **front** and treats the URL as the identity for its star button. |
| `preference:vex.notes` | yes | yes | `{ "id": string, "title": string, "content": markdown string, "pinned": bool, "tags": string[], "sourceUrl": string, "sourceTitle": string, "createdAt": ISO string, "updatedAt": ISO string }`. Desktop id format: `note_<ms>_<5 base36>`. Every field is optional on read (`NotesPanel.normalize`). Set `updatedAt` on every edit. Data-contracts does not validate notes beyond §8.4's generic rules. |
| `preference:vex.history` | yes | SHOULD NOT (read-only) | `{ "id": "h_<ms>_<5 base36>", "url": http(s), "title": string, "favicon": http(s) URL or "", "visitedAt": ISO, "indexed": bool, "ownSession"?: true, "summary"?, "tags"?, "contentType"? }`. Up to 5000 entries, newest first. Owning it means holding and pushing the complete list (rule 2). |
| `preference:vex.forceDarkHosts` | yes | MAY | A list of host-name **strings**, e.g. `"example.com"`. The item id is the JSON string with quotes (§4.3). |
| `preference:vex.reminders` | yes | add only, with care | A mirror of the desktop main process's reminders: `{ id: ^[A-Za-z0-9_-]{1,64}$, message: string (≤2000 used), at: ms|null, site: host|null, repeat: "daily"/"weekdays"/"weekly"/[0..6 ints]|null, time: "HH:MM"|null, url: http(s)|null, urgent: bool, kind: "reminder"/"alarm"/"timer"/"review", sound: bool, job, owner, ackedAt, createdAt, firedAt, lastFiredAt }`. Desktops **import** new ones (`reminders.js importList`): not `kind:"review"`, not `firedAt`, not older than 7 days. They fire while Vex is open, and only the `owner` machine wakes Windows. **A phone cannot delete a reminder:** the desktop rewrites the mirror from its own list every 5 minutes and after each sync, so a deletion comes straight back. A reminder the desktop refuses to import disappears from the account on that desktop's next push. |
| `preference:vex.shortcuts` | yes | only with the gate open (rule 20) | Glass shortcut bar tiles: `{ "name": string, "url": string (http/https/about/file/vex) }`, plus account-only `id` (§4.6). A missing source means "show defaults"; `[]` means "no shortcuts". |
| `preference:vex.startTiles` | yes | only with the gate open (rule 20) | New Tab grid: `{ "name": string, "url": string, ... }`. At most 500 (`webview.js _startTilesValid`), plus account-only `id`. **UNSURE:** which other fields the New Tab page stores on a tile. `_startTilesValid` only requires `name` and `url` to be strings. Carry unknown fields through. (`src/renderer/js/webview.js` `saveStartTiles`, and the start page itself.) |
| `storage:tabs` | yes (e.g. a "tabs on my computers" view) | **MUST NOT** | `{ id, partition, url, title, favicon, pinned, groupId, stackId, sleeping, originalUrl, scrollPosition, keepAwakeUntil, memBeforeSleep }`. This is the open-tab set shared by desktops and **merged across all desktops**, not per device. |

### 8.3 Desktop-only sources (copy verbatim, never write)
`preference:vex.sessions`, `vex.workspaces`, `vex.tools` (`{id,name,url,desc,svg}`), `vex.schedules` (agent tasks, `v:2`), `vex.personas`, `vex.activePersona`, `vex.aiMemory`, `vex.agentMode`, `vex.aiRouting`, `vex.preferLocalAI`, `vex.forceCloudAI`, `vex.aiIndexingEnabled`, `vex.zooms`, `vex.forceDarkSites`, `vex.autoSleepPrefs`, `vex.autoGroupSuggest`, `vex.autoAddToGroups`, `vex.groupPatterns`, `vex.userShortcuts`, `vex.tabLayout`, `storage:groups`, `storage:stacks`, `storage:history` (`{url,title,time}` rows from the file store, ≤ 500), `storage:settings`, `storage:shortcuts`, `storage:theme`, and every other device's `sync:device:*`.

### 8.4 Validation every merged source must pass (`data-contracts.js` `sources()`)
The desktop runs these checks on the **sources it owns** in the merged result (§6 rule 1; tile lists only while the gate is open). A failure aborts the pull. Sources it does not own are not checked (from v2.35.2; up to v2.35.1 the desktop checked the whole merged result, and any failure aborted the pull).

- **Every value, recursively:** nesting depth ≤ 40; no non-finite numbers; strings ≤ 12 MiB; objects/arrays ≤ 30 000 keys; no property named `__proto__`, `constructor` or `prototype`.
- **List preferences** (`LIST_PREFERENCES`): after `JSON.parse` if the value is a string, the value MUST be an array, else "Invalid synced list".
- **Tile lists** (with the gate open): MUST be arrays.
- **`preference:vex.bookmarks`, `preference:vex.history`** (and `storage:history`): an array of ≤ 10 000 items.
  - Each item is a plain object.
  - `id`, `groupId`, `stackId`, when not null, match `^[\w.:-]+$`, are ≤ 160 characters, and are not one of the three unsafe names.
  - `title`, `name`, `label`, when not null, are strings ≤ 4096.
  - `color`, when not null, matches `^(#[a-f0-9]{3,8}|[a-z]{1,24}|var\(--[\w-]+\))$` (case-insensitive).
  - `url` is a string ≤ 8192 with no control characters (`\x00-\x1f`), which `new URL()` parses with protocol **`http:` or `https:`**.
- **`preference:vex.shortcuts`, `preference:vex.startTiles`**: the same item rules, but `url` may also be `about:`, `file:` or `vex:`. A tile with any other scheme (e.g. `mailto:`) stays local on the desktop and never enters the account.
- **`preference:vex.sessions`**: ≤ 1000 items; each is a record with `tabs` (required) passing the tab rules; `groups` is optional.
- **`preference:vex.workspaces`** (a JSON string): parses to an object whose `workspaces` is an array of ≤ 1000 records, each with optional tabs and groups.
- **`storage:tabs`** (tab rules): an array ≤ 10 000; each item a record.
  - `url` with protocol http/https/about/file/vex;
  - `partition`, if set, a string ≤ 160 with no control characters;
  - `pinned`, if set, a boolean;
  - `favicon`, if set, a string ≤ 1 MiB starting `http:`, `https:`, `data:image/`, `file:` or `vex:`.
- **`storage:groups`, `storage:stacks`**: ≤ 1000 records.
- **`storage:theme`**: if it is a string, it matches `^[\w-]{1,80}$`.

Plus §4.1 (document validity) and the `unflatten` rule that item values are `{index: safe int ≥ 0, item}`.

---

## 9. A minimal mobile client, step by step

This flow uses the simplest safe strategy, **"rebase"**: keep a queue of pending local operations, and on every sync pull the latest document, replay the operations onto it, and push. If the client never holds offline edits outside that queue, it never needs `merge`. A full client with offline-first local state should instead implement `capture` and `merge` exactly as in §5.

The phone owns one source, `preference:vex.bookmarks`, plus its marker. The base URL is `https://vex-sync.example.workers.dev`. The responses below are real responses from the worker code, with tokens shortened.

### 9.1 Sign in
```http
POST /auth/request-code
Content-Type: application/json

{"email":"me@example.com"}
```
```json
200 {"ok":true,"message":"Code sent to email"}
```
```http
POST /auth/verify-code
Content-Type: application/json

{"email":"me@example.com","code":"668921","deviceName":"Pixel 9"}
```
```json
200 {"ok":true,"sessionToken":"ab69c147…72bf8","deviceId":"d1827e52646814b25bc00ba176f7999f",
     "emailHash":"42868c27…8fe77","hasEncryptedData":true}
```
Store `sessionToken` and `deviceId`. The session is pending: `GET /sync/devices` now returns `403 {"error":"This device has not synced yet"}`.

### 9.2 Enter the recovery code (`hasEncryptedData: true`)
The user types `00010203-04050607-…-1C1D1E1F`. Strip it to 64 hex characters and import it as an AES-GCM key.
- If the user has no code and `hasEncryptedData` is true, the client cannot join: `DELETE /sync/devices/<deviceId>` and stop. Never create a new key for an account that already has data.
- If `hasEncryptedData` is false (a new account), generate 32 random bytes, show the formatted code once, and in 9.3 push a document with `baseRevision: 0` instead of pulling. Start from an empty document plus the phone's bookmarks and marker.

### 9.3 Pull
```http
GET /sync/pull
Authorization: Bearer ab69c147…72bf8
```
```json
200 {"ok":true,"revision":41,"encryptedBlob":"NRvAhqK94w2SwTAdSeh9Yc1G…","updatedAt":"2026-10-01T20:51:12.745Z",
     "pushedBy":"5c0f…","pushedAt":"2026-10-01T20:51:12.746Z"}
```
This first pull has now registered the device.
1. Decrypt. On a tag failure: `DELETE /sync/devices/d1827e52…` and tell the user the recovery code is wrong. Stop.
2. Check `schema === 2` and validate the document (§4.1).
3. Save `doc` and `revision = 41`, in that order.

### 9.4 Show bookmarks
`sources = unflatten(values(doc))`, then `bookmarks = sources["preference:vex.bookmarks"] ?? []`. If the value is a string (an old desktop sent it whole), `JSON.parse` it. Display the `title`, `url` and `folder` fields.

### 9.5 Add a bookmark, then push (first push: also writes the marker)
1. Queue the operation `add {id:"bmphone1k9x2", url:"https://m.test/", title:"From phone", folder:"", at:<now>}`.
2. Build the next document:
   - `mine = bookmarks + [newBookmark]`, appended at the end (§5.5), with every existing item kept byte-for-byte;
   - `owned = { "preference:vex.bookmarks": mine, "sync:device:d1827e52646814b25bc00ba176f7999f": {"level":1} }`;
   - `values = values(doc)` with every key of the owned sources removed, then `+ flatten(owned)`;
   - `next = capture(doc, values, deviceId)`;
   - for every record key whose source is not owned, set `next.records[key] = doc.records[key]` (rule 1);
   - validate `next` (§4.1) and `unflatten(values(next))` (§8.4).

   Done this way, the only records that change are the new bookmark's item record and the marker's two records. This was verified with the real code.
3. Encrypt `next` with a fresh IV, then push:
```http
POST /sync/push
Authorization: Bearer ab69c147…72bf8
Content-Type: application/json

{"encryptedBlob":"<base64>","updatedAt":"2026-10-01T20:52:00.000Z","baseRevision":41}
```
```json
200 {"ok":true,"savedAt":"2026-10-01T20:52:00.120Z","revision":42}
```
Save `doc = next` and `revision = 42`, then clear the operation from the queue.

If a desktop pushed in the meantime:
```json
409 {"error":"Sync conflict: pull and merge before pushing","revision":43}
```
Go back to 9.3: pull revision 43, replay the queued operation onto the new document, and push with `baseRevision: 43`. Retry a few times.

### 9.6 Afterwards
- Now that the device is registered, `GET /sync/devices` works and lists `{"deviceId":"d1827e…","deviceName":"Pixel 9",…}` alongside the desktops.
- Desktops pick up the bookmark on their next pull (within 5 minutes, or straight away with "Sync Now").
- Deleting a bookmark: record the deletion **explicitly**. Queue `delete <item id>` when the user deletes it, and when replaying the queue onto the latest pulled document, leave that one item out of the list you capture: its record becomes a tombstone (`deleted: true`, `value: null`, your clock entry + 1), and the desktops remove it. Only items the user deleted become tombstones. Never infer a deletion from an item being missing from the phone's local copy: an item that is in the account but not on the phone (added by another device since the last pull, or lost from local storage) is **restored** to the phone's list, not deleted. Rebuilding the list from the pulled document and then applying only the queued operations gives exactly this.
- Handoff: `GET /sync/drop` on app foreground, and `POST /sync/drop` to send the current page (§7).
- Sign out: `DELETE /sync/devices/d1827e52646814b25bc00ba176f7999f`, then forget the token, key, document and revision.

---

## Appendix A: Status code cheat sheet

| Code | Meaning | Client action |
|---|---|---|
| 200 | OK | — |
| 204 | CORS preflight | — |
| 400 | bad body or missing field; handoff too large | fix the request; do not retry unchanged |
| 401 | wrong or expired code (auth); invalid, expired or revoked session (sync) | auth: re-enter the code; sync: sign out locally (§2.6) |
| 403 | pending session used for anything other than pull, push or delete-self | pull or push first |
| 404 | unknown path, or a non-hex device id in DELETE | — |
| 408 | body not received within 10 s | retry |
| 409 | `baseRevision` missing or stale (`revision` in the body) | pull, merge or rebase, push again |
| 413 | body > 4 MiB | shrink the document; owning less history helps |
| 429 | rate-limited, or code burned after 5 wrong guesses | wait; request a new code |
| 500 | unexpected server error | retry later |
| 502 | email delivery failed | retry later |
| 503 | `EMAIL_HASH_SECRET` missing, email not configured, or DO binding missing | tell the user the server is misconfigured; keep the session |

## Appendix B: UNSURE points
1. **Cloudflare platform errors and CORS** (§1.5): responses generated outside `worker.js` probably lack CORS headers. This is general Cloudflare behaviour and cannot be checked in this repo.
2. **Extra fields on New Tab tiles** (`preference:vex.startTiles`): `src/renderer/js/webview.js` `_startTilesValid` only checks `name` and `url`. What the start page actually stores beyond those was not traced. Carry unknown fields through.
3. **Recovering conflict variants**: the desktop keeps them in `conflicts` and toasts about them, but no UI was found that lets the user restore a losing variant (`sync-engine.js` `applySyncData` only counts them). A client need not expose them, but MUST keep them on records it does not change.
4. **`vex.reminders` items written by a non-desktop `owner`**: `reminders.js` `importList` accepts them, but sets `owner` to the value sent or `'unknown'`. What the desktop shows for a reminder whose `owner` is not a known machine was not checked (`src/main/reminders.js`).
5. **Document growth**: tombstones are never removed and history can reach thousands of items. When an account would hit the 4 MiB body or 30 000 record limits was not measured. No compaction exists in the code.
