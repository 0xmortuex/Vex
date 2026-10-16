# Vex Sync Protocol (v2.35.2, wire protocol unchanged through the release after v2.37.0; §8 source list as of the release after v2.36.4; level-2 markers, clean-up and the history window from the release after v14.72.3; key proof, protocol version 1 of §2.7, from the release after v14.72.3)

> **Release after v18.59.3 — an email after an erase (server and client change, §2.9).** After `POST /sync/reset` or `DELETE /sync/all` the worker emails the account's address in plain text: what was erased, when (UTC), from which device, and what to do if it was not them. The worker keeps no address, so the client sends `email` in those two requests' JSON bodies (`DELETE /sync/all` now has a body); it is used only if its HMAC is the account, and is never stored. Both replies gain `notice` (§2.9). Older clients keep working; they get no email. **The worker must be redeployed for this.**

> **Release after v14.72.3 — key proof (server and client change, §2.7, §2.8).** Up to now one sign-in email code was enough to overwrite or erase an account without its sync key (push with `baseRevision: 0`, read the revision from the 409, push again; or `DELETE /sync/all`). A worker from this release keeps, per account, a key check derived from the sync key, and from then on refuses a push or wipe that does not prove the key with an HMAC over a one-time nonce (`GET /sync/challenge`, header `X-Vex-Proof`). New: `GET /sync/challenge`, `POST /sync/prove`, `POST /sync/reset`; status **403** with a `code` field on refusals; `keyCheck` in the pull and challenge replies; `keyCheckSet` in the push reply. An account without a key check (every account until a current client syncs) works exactly as before, so **older clients keep working until the first current client locks the account**; after that they can still pull (and list devices), but their pushes and wipes get 403 (§2.7.5). A current client talking to an older worker sees `/sync/challenge` answer 404 (or 403 "This device has not synced yet") and syncs without proofs.

> **Release after v14.72.3 — document contents only, no server change.** Each desktop sends its own open tabs as `sync:tabs:<deviceId>` and no longer writes or applies the shared `storage:tabs`, `storage:groups` and `storage:stacks` (§4.8). The desktop writes its marker as `{"level":2,"revision":<int>}` (§4.6), clears deleted records and retired sources out of the document once every device is at level 2 (§4.7), and sends only its newest 1,000 history visits from the last 90 days (§8.1). Older clients keep working; a client that wants the clean-up to run follows §4.7 and writes level 2.

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
- **Request body cap: 4 MiB** (`boundedJson`, 4·1024·1024 bytes). The cap is checked against `Content-Length` first and then while streaming. Over the cap the server returns **413** `{"error":"Request too large"}`. (The desktop says "Your synced data is too big for the sync server (over 4 MB), so nothing was uploaded…" from the release after v14.72.3.) The worker's own `encryptedBlob.length > 5 MB → 413 "Blob too large (max 5 MB)"` check can never fire, because the 4 MiB body cap is reached first. **The effective limit for a push is the entire JSON body ≤ 4 MiB**, and base64 adds about 33%, so the plaintext document must stay under roughly 3 MiB.
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
Request: `{ "email": string, "code": string|number, "deviceName"?: string }`. The server compares `String(code)`, so a number works. `deviceName` defaults to `"Unknown device"` and is **not validated**. A client SHOULD send a short human-readable string; desktop sends the name the user typed at sign-in (by default e.g. `Windows-7K2Q`). A later rename travels only in the device's marker (§4.6).

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

From the release after v14.72.3 both 200 replies also carry `"keyCheck":{"setAt":"<ISO>"}` when the account is locked to its sync key (§2.7); the field is absent otherwise, and absent on older workers.

A pull by a pending session **registers the device** in the device list. This happens even if the client then fails to decrypt the blob (§2.3). On an account locked to its sync key it does **not** (from the release after v14.72.3): the device is registered by its first proof (§2.7.4).

#### `POST /sync/push`  (Bearer; key proof, §2.7)
Request: `{ "encryptedBlob": string, "updatedAt"?: string (ISO), "baseRevision": int }`, plus the headers `X-Vex-Proof` (and, on the first proof, `X-Vex-Auth-Key`) from §2.7.

| Status | Body |
|---|---|
| 200 | `{"ok":true,"savedAt":"<ISO>","revision":int}`. The new revision is `baseRevision + 1`. With `"keyCheckSet":true` when this proof locked the account (§2.7.3). |
| 400 | `{"error":"Missing encryptedBlob"}`; or a malformed proof (§2.7.6) |
| 403 | a refused proof: `{"error":"<sentence for the user>","code":"key-required"|"key-mismatch"|"proof-stale"}` (§2.7.6). The proof is checked **before** the revision, so a refused push learns no revision. |
| 409 | `{"error":"Sync conflict: pull and merge before pushing","revision":int}` (plus `"keyCheckSet":true` as for 200). `baseRevision` is missing, is not a safe integer, or does not equal the server's current revision. **An omitted `baseRevision` always gets 409.** |
| 413 | `{"error":"Request too large"}` |
| 401 | see §2.6 |

A successful push replaces the account's blob **entirely**, and it registers a pending device (on a locked account, through its proof). `updatedAt` is stored and returned by pull, but no client reads it.

#### `GET /sync/devices`  (Bearer, registered devices only)
200: `{"ok":true,"devices":[{"deviceId","deviceName","createdAt","lastSeenAt"}...],"currentDeviceId":"<yours>"}`. A pending session gets **403** `{"error":"This device has not synced yet"}`. Every authenticated non-pending request updates the caller's `lastSeenAt`.

#### `DELETE /sync/devices/:id`  (Bearer)
- `:id` must match `^[a-f0-9]+$` (lowercase hex), or the request falls through to 404.
- A registered device may remove **any** device, itself included. The server deletes the target from the list and deletes every session of the target. It returns 200 `{"ok":true}` even when the id is unknown.
- A **pending** session may remove **only itself** (`/sync/devices/<its own deviceId>`), which deletes its session. Anything else gets 403.

#### `DELETE /sync/all`  (Bearer, registered; key proof, §2.7)
Deletes the blob (the revision goes back to 0), the device list, the handoff mailbox, the key check (§2.7), and **every session of the account, including the caller's**. Returns 200 `{"ok":true}` (from the release after v18.59.3: `{"ok":true,"notice":…}`, §2.9). The caller's next request gets 401. On a locked account it needs a proof for the action `wipe` (403 as for push without one); a pending session may wipe only with a valid proof.

From the release after v18.59.3 the request MAY carry a JSON body `{"email":"<the address signed in with>"}` (with `Content-Type: application/json`), for the email of §2.9. The body is not part of the proof. A request without a body is still accepted.

#### `GET /sync/challenge`, `POST /sync/prove`, `POST /sync/reset`  (Bearer; from the release after v14.72.3)
See §2.7 and §2.8. Older workers answer 404 (or 403 "This device has not synced yet" to a pending session).

#### `POST /sync/drop`, `GET /sync/drop`  (Bearer, registered)
The "Send to My Devices" mailbox. See §7.

### 1.5 CORS: will a browser or PWA client work?

What the worker sends, exactly (constant `CORS_HEADERS`). These are on **every** JSON response and on the `OPTIONS` reply:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Vex-Proof, X-Vex-Auth-Key
Access-Control-Max-Age: 86400
```
(`X-Vex-Proof` and `X-Vex-Auth-Key` from the release after v14.72.3, §2.7. Up to then: `Content-Type, Authorization`.)

`OPTIONS` (on any path) returns **204** with those headers. It is answered before the secret check and before the Durable Object, so preflight works even on a misconfigured worker. Verified:

```
OPTIONS /sync/push  (Origin: https://pwa.example, ACR-Method: POST, ACR-Headers: authorization,content-type)
→ 204, access-control-allow-origin: *, access-control-allow-methods: GET, POST, DELETE, OPTIONS,
       access-control-allow-headers: Content-Type, Authorization, access-control-max-age: 86400
```

**Conclusion: a browser-based or PWA client works without any worker change.**
- The token goes in the `Authorization` header and no cookies are used, so the request is not a "credentialed" CORS request in the cookie sense, and `Allow-Origin: *` is accepted. Do **not** set `credentials: 'include'`. With credentials, `*` would be rejected.
- The client only reads JSON bodies, so no `Access-Control-Expose-Headers` is needed.
- Every method used (GET, POST, DELETE) and every request header used (Content-Type, Authorization, and the §2.7 proof headers) is allowed.

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
  - from the release after v14.72.3: `GET /sync/challenge`, `POST /sync/prove`, `POST /sync/reset`, and `DELETE /sync/all` with a valid proof (§2.7, §2.8)
  
  Anything else gets **403** `{"error":"This device has not synced yet"}`. That includes `/sync/devices` and `/sync/drop`, and `/sync/all` without a proof.
- The **first successful pull or push** adds `{deviceId, deviceName, createdAt, lastSeenAt}` to the list and clears `pending`. A pull registers the device **before** the client has decrypted anything. A sign-in that then fails (wrong recovery code) therefore leaves a registered device behind, which the client MUST delete (§2.5).

### 2.4 Creating an account versus joining one
The desktop uses `hasEncryptedData` like this (`sync-engine.js` `verifyCode` / `enrollWithRecoveryCode`):

- **Create** (`verifyCode`): only when `hasEncryptedData === false`. If it is anything else, the desktop keeps the new session in memory and asks for the recovery code in place; with it, it joins (below) **using that session**, without a second `verify-code` (the email code is single-use). If the user leaves that sign-in (another address, a new code, or ten minutes), the desktop calls `DELETE /sync/devices/<deviceId>` with the new token. (Up to v2.38.x the desktop deleted the session at once and refused with "This account already has encrypted data … Enroll with your recovery code.")
  
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

### 2.7 Proof of the sync key (key proof version 1, from the release after v14.72.3)

The email code says who you are; it says nothing about whether you hold the sync key. Up to v14.72.3 a session made from one email code could replace the account's blob (push with `baseRevision: 0`, take the `revision` from the 409, push again) or erase it (`DELETE /sync/all`), without ever having the key. It could not read anything, but it could destroy everything. From this release a worker locks each account to its sync key and asks for a proof before it changes the account.

#### 2.7.1 The auth key
```
authKey = HKDF-SHA256(ikm = the 32 raw sync-key bytes (§3.1), salt = empty (zero bytes), info = UTF-8 "vex-sync auth key v1", length = 32 bytes)
```
Written as 64 lowercase hex characters. HKDF is one-way: the auth key does not decrypt anything and does not give the sync key back, so the server may keep it. **The sync key itself is never sent.** (Desktop: `SyncCrypto.authKeyHex`.)

#### 2.7.2 A proof
1. `GET /sync/challenge` (Bearer; any session, pending included) → `200 {"ok":true,"nonce":"<32 hex>","expiresIn":300,"keyCheck":{"setAt":"<ISO>"}|null}`. The nonce belongs to the caller's device, is good for **5 minutes** and **one** request, accepted or not. The server keeps at most 20 unused nonces per account (the oldest go first).
2. Compute
   ```
   message = "vex-sync-proof/1\n" + nonce + "\n" + deviceId + "\n" + action + "\n" + details
   mac     = hex( HMAC-SHA256(key = authKey bytes, message = UTF-8(message)) )
   ```
   `deviceId` is the caller's own (§2.3). `action` and `details`:

   | Request | `action` | `details` |
   |---|---|---|
   | `POST /sync/push` | `push` | `<baseRevision as sent, decimal>` + `"\n"` + `hex(SHA-256(UTF-8(encryptedBlob)))` |
   | `DELETE /sync/all` | `wipe` | empty string |
   | `POST /sync/prove` | `prove` | empty string |
3. Send header `X-Vex-Proof: <nonce>.<mac>`. When the challenge said `"keyCheck": null` (the account is not locked yet), also send `X-Vex-Auth-Key: <authKey hex>` (§2.7.3).

A proof covers one action on one body by one device, once. It cannot be replayed (the nonce is spent), moved to another session (the nonce is the device's), or reused for another blob, revision or action (they are in the MAC).

Vector (sync key of §3.6, `000102…1f`; nonce `00112233445566778899aabbccddeeff`; device `0123456789abcdef0123456789abcdef`; checked with WebCrypto and with Node's `crypto.hkdfSync`/`createHmac`):
```
authKey                 : 189392652584556749599e10df7683b887f593b65e96d70400072158154c72cc
push, baseRevision 41, encryptedBlob "oKGio6Sl"
  SHA-256(blob)         : b771b6fcbe1fb3c659f047d2417a51272b02932fec1faaf011567117ac7e5479
  mac                   : 7212737d795bd6b54ded5b01ce84eb570e6e1efddd98a017d911b26ec49baae5
wipe  mac               : 3b37c704c266d8bc3fb2a8e9229844c0e3d72a4c5edef19c16522a14be928c72
prove mac               : b0cf29d8d2ca3be6bd099bd947e0494b8b9a107a038275ceb14231dec3efda38
```

#### 2.7.3 Locking an account (trust on first use)
The account's **key check** is `{key: <authKey hex>, setAt, setBy: <deviceId>}`, kept in the account's storage. A new account gets it from its first push. **An account from before this release has none**; the first valid proof that carries `X-Vex-Auth-Key` sets it, and the reply says `"keyCheckSet": true`. From then on every proof is checked against it, and `X-Vex-Auth-Key` is ignored. A key check is removed only with the account (`DELETE /sync/all`, `POST /sync/reset`).

**The window that stays open:** until a current client has proved the key once, the account is as open as before: whoever has an email code can replace or erase it, and could even lock it to a key of their own (the real devices' proofs then fail with `key-mismatch`, and the user has to start over, §2.8). The window closes the first time a current desktop pushes (it pushes within seconds of a change and at least every two minutes while open). The desktop says in Settings › Vex Sync whether the account is locked (`keyCheck` in pull and challenge), and shows "Your sync account is now locked to your sync key …" once, on the device that locked it.

#### 2.7.4 What a session may do on a locked account
A session that has not made a valid proof (a new sign-in, or a device on an older client) may only: `GET /sync/pull`, `GET /sync/challenge`, `POST /sync/prove`, `GET /sync/devices` (if it is already listed), `DELETE /sync/devices/<own id>`, and push or wipe **with** a proof. It is not registered by a pull; its first valid proof (a push, or `POST /sync/prove` for a client that only reads) registers it and marks the session proven. Anything else gets **403** `{"error":"<KEY_REQUIRED sentence>","code":"key-required"}`, including `/sync/drop` and removing another device.

`POST /sync/prove` (Bearer, `X-Vex-Proof` for the action `prove`) → `200 {"ok":true}` (`"keyCheckSet":true` if it locked the account).

#### 2.7.5 Older clients
- **Before the account is locked:** nothing changes. Pushes and wipes without `X-Vex-Proof` are accepted as before.
- **After:** an older client can still sign in, pull and decrypt (it has the key), and list devices if it was already listed. Its pushes and wipes get **403** with `code: "key-required"` and the sentence "This sync account is locked to its sync key, and this device did not prove it has the key. Update Vex on this device, or sign in again with your recovery code." Desktops up to v14.72.3 do not read that body: they show "Push returned 403" (Settings › Vex Sync: "Not syncing — the last sync failed"), keep pulling, and keep their own unsent changes locally until they are updated; nothing is lost and nothing is signed out. A new sign-in by an older desktop joins and pulls, but is never registered.
- Why refuse rather than keep older devices writing: letting every session that existed before the lock keep writing without a proof would keep the hole open for any session an attacker had made before it, for a year (the session lifetime). Old devices lose uploads, not data, until they are updated.

#### 2.7.6 Refusals

| Status | `code` | When |
|---|---|---|
| 403 | `key-required` | The account is locked and the request has no `X-Vex-Proof`, or the session has not proved the key and asked for something else (§2.7.4). |
| 403 | `key-mismatch` | The MAC does not verify with the account's key check: this device's key is not the account's, or the MAC covers another action, body or revision. |
| 403 | `proof-stale` | The nonce is unknown, already used, older than 5 minutes, or was asked for by another device. Ask for a new one. |
| 400 | `proof-malformed` | `X-Vex-Proof` is not `<32 hex>.<64 hex>` (or `/sync/prove` without it). |
| 400 | `auth-key-missing` | The account is not locked and the first proof has no valid `X-Vex-Auth-Key`. |

A client SHOULD show `error` to the user as it is. On `key-mismatch` it MUST NOT retry with another key or "repair" anything (§6 rule 12 applies in spirit): sign out, and join again with a recovery code that works (§5.4), or start over (§2.8).

#### 2.7.7 Talking to an older worker
A worker from before this release answers `GET /sync/challenge` with 404 (a registered session) or 403 "This device has not synced yet" (a pending one). A client then sends its requests without proof headers, and SHOULD tell the user the account is not protected until the worker is redeployed. The desktop does both (Settings › Vex Sync).

### 2.8 Starting over without the key (from the release after v14.72.3)
A user who has lost the recovery code on every device cannot read the account, and with §2.7 cannot erase it with a proof either. `POST /sync/reset` erases it on purpose:

- Request: `{"confirm":"erase my synced data"}` exactly, else **400** `code: "confirm-required"`. From the release after v18.59.3 the body SHOULD also carry `"email"`, the address the sign-in used, for the email of §2.9; the reply is then `{"ok":true,"notice":…}`.
- Only from a **pending** session made **at most 10 minutes ago**, i.e. straight after a fresh email code; anything else gets **403** `code: "fresh-sign-in-required"`.
- It deletes what `DELETE /sync/all` deletes (blob, devices, mailbox, key check, sessions), except the caller's own session, which stays pending. Every other device's next request gets 401 and it signs out with "… the cloud data was wiped". **Data on the devices is not touched.**
- The caller then creates a new account as in §2.4 (new key, push with `baseRevision: 0`), which locks it to the new key.

The desktop offers this only on the sign-in that just found the account has data ("I lost my recovery code: start over"), after a confirmation that says what is erased; it then shows the new recovery code. It cannot replace the account's data unseen: the old data is erased (not overwritten with something the other devices would try to decrypt), and every other device is signed out with a message. **What stays possible:** someone who can read the user's email can still erase the synced copy this way (never read it, never change it while keeping it). The devices keep their data and can sign in again.

### 2.9 The email after an erase (from the release after v18.59.3)
So that an erase the owner did not do (§2.8: someone who can read the email; or a device with the sync key) does not go unnoticed, the worker writes to the account's address after `POST /sync/reset` and after `DELETE /sync/all`.

- **The address.** Accounts are an HMAC of the address (§2.2), so the worker has none to write to. The client sends `email` in the request body. The worker uses it only if `HMAC(email.trim().toLowerCase())` is the account the session belongs to, sends to it, and does not store it anywhere. Any other address, or none (older clients), sends nothing.
- **How it is sent.** The same way as the sign-in code (Resend, `RESEND_API_KEY`, from `RESEND_FROM`), no new provider or secret. Without `RESEND_API_KEY` (a development worker) nothing is sent.
- **Limit.** Like the sign-in codes: at most 3 per address per 15 minutes. Past that the erase still happens; the email does not.
- **What it says.** Plain text, subject `Your Vex Sync data was erased`: that the synced data was erased (and, for `/sync/reset`, the account started over with a new recovery code), the time in UTC to the minute, and the device, as `a device named "<deviceName>"` (control and line-break characters folded to spaces, at most 60 characters) or `a device` when it has no name. Then what to do if it was not them: secure the email account; on one of their own devices open Vex, Settings › Vex Sync, and sign in again with the address (after a reset Vex finds an account they have no recovery code for, and "I lost my recovery code: start over" erases it and uploads that device's data under a new recovery code; after a wipe Vex starts a new account); join the other devices with the new recovery code. **It never contains synced data, keys, codes, tokens or device ids.**
- **The reply.** The erase is done before the email is tried, and a failed email does not undo it. The reply says what happened to the email in `notice`: `"sent"`, `"no-address"` (no or wrong address), `"not-configured"` (no `RESEND_API_KEY`), `"rate-limited"`, or `"failed"` (Resend refused or did not answer; also in the worker log). A client MAY show it; the desktop does not.

---

## 3. Encryption

### 3.1 Recovery code = the raw key
There is **no key derivation**: no PBKDF2, no salt, no iterations, and the email is not involved. The AES key *is* the recovery code. (The only derived key is the auth key of §2.7.1, used for proofs, never for encryption.)

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
- Encrypted twice: saved passwords and authenticator accounts, when a desktop syncs them (§4.9). Each one is sealed on its own inside the document, so the desktop's own copy of the document holds none of them in readable form either.
- Not encrypted (the server can see it): the email (at request time), `deviceName`, device timestamps, `updatedAt`, revision numbers, blob sizes, the sender of each handoff item and when it was sent.
- The server also keeps each account's auth key (§2.7.1), derived one-way from the sync key. It decrypts nothing; anyone who could read the server's storage could forge proofs with it, but could already rewrite that storage directly.

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
- `sync:tabs:<deviceId>`, that device's open tabs (§4.8), from the release after v14.72.3.
- `secret:passwords` and `secret:authenticator`, saved passwords and authenticator (2FA) accounts as sealed items (§4.9), from the release after v18.59.3, and `secret:passkeys`, passkeys as sealed items (§4.9.1).

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
- `deleted: true` marks a tombstone, and its `value` is `null`. Up to v14.72.3 tombstones were kept forever. From the release after it, they are cleared out once every device on the account has synced past them (§4.7).
- `at` is `Date.now()` on the device that made the edit. It decides concurrent edits (§5.2).
- `conflicts` holds the variants kept from a concurrent merge, each `{deleted, value, at}`. A new local edit clears it to `[]`.
- A record produced by **merge** has field order `{deleted, value, at, clock, conflicts}` (`{...winner, clock, conflicts}`). Field order is not semantic, but see rule 9 in §6.

### 4.5 List sources versus whole-value sources
`flatten` turns **every** JSON array into item records, whatever its source. The lists that matter are:

- **`LIST_PREFERENCES`** (`sync-engine.js`). The desktop always sends these as arrays, and refuses with "Invalid <name> data" when the local value is not an array:
  `vex.bookmarks, vex.sessions, vex.history, vex.notes, vex.tools, vex.schedules, vex.personas, vex.reminders, vex.forceDarkHosts, vex.neverSleepHosts, vex.translateAlwaysHosts, vex.customThemes, vex.pwNever`
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
Every current client writes a scalar source `sync:device:<its deviceId>`. That is two records:
```
["sync:device:<id>","type"]  → "scalar"
["sync:device:<id>","value"] → {"level":2,"revision":41}
```
Levels:

| Level | Value | Promises | Desktop |
|---|---|---|---|
| 1 | `{"level":1}` | understands shortcut tiles and the New Tab grid | Vex 2.34.3 to v14.72.3 |
| 2 | `{"level":2,"revision":<int>}` | level 1, plus §6 rule 1 (copies every record it does not own verbatim), §4.7 (drops a tombstone the account no longer holds; never writes a retired source), and `revision` = the account revision of the document this push was built from | the release after v14.72.3 |

A marker MAY carry `"name": <string ≤ 60, no control characters>`, the name the user gave the device (desktop: Settings › Vex Sync, at sign-in or with Rename, from the release after v14.72.3). The desktop shows it in place of the server's `deviceName`, which is only the name sent at sign-in; unlike that one, it is encrypted. A level-2 marker's `revision` only has to be at most the revision the device last merged; it may lag. The desktop rewrites it along with any other change, and on its own at most once a day (when the marker record's `at` is a day old), so two idle desktops do not keep pushing each other's revision back and forth. Other fields MAY be added to a marker later; a client MUST ignore fields it does not know and copy other devices' markers verbatim.

Tile gating needs level ≥ 1 (`TILES_LEVEL`). Before writing tiles, each desktop runs `checkTileGate`:
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

### 4.7 Clearing out deleted records and retired sources (from the release after v14.72.3)
Tombstones used to be kept forever, so the document only grew: history alone turns over thousands of visits, each leaving a tombstone, toward the 30 000-record and 4 MiB limits. The desktop now clears them out, and only while **every** listed device (`GET /sync/devices`, the caller excluded) has a level-2 marker with an integer `revision`. One level-1 device, an older desktop or the phone, stops all clean-up for the account.

- **Seen revision.** A device notes, for each tombstone, the first account revision it saw it in: the revision of a pulled document that held it, or of its own push that created it. This is local state, not on the wire.
- **Floor.** `floor = min(own revision, every other listed device's marker revision)`.
- **Clean-up.** When building a push, a tombstone whose seen revision is ≤ `floor` is left out of the document (not copied, not re-tombstoned). Every device on the account has merged a document holding it, so each already applied the deletion.
- **Retired sources** (§8.1 "No longer synced": `storage:history`, `storage:tabs`, `storage:groups`, `storage:stacks`, `preference:vex.autosleep`, `preference:vex.autosleepMinutes`, `preference:vex.autosleepExcludePinned`, `preference:vex.customCommands`, `preference:vex.settings`, `preference:vex-theme`): every record of these is left out under the same condition.
- **Drop on absence (MUST at level 2).** When a pull's document no longer holds a tombstone this device has seen in an earlier document, another device cleared it away: drop it from your own document before merging. Otherwise `merge` keeps the left-only record and your next push brings it back. A tombstone you made yourself and have not pushed yet is not "seen", and stays.
- A client that never caches records outside the pulled document (the §9 "rebase" client) drops nothing by construction; it only has to keep its marker at level 2 with a `revision`.

### 4.8 Open tabs per device (from the release after v14.72.3)
Up to v14.72.3 the desktops shared one open-tab list, `storage:tabs` (with `storage:groups` and `storage:stacks`), merged across all of them and applied **to the open tabs** on every pull: a tab another computer had navigated or closed was navigated or closed under the user, typed text and all. Now:

- Each desktop owns a scalar source `sync:tabs:<its deviceId>` = `{"tabs":[{"url":<http(s) URL>,"title":<string ≤ 300>}, ...]}`: its open, persistable tabs (no private, Tor or off-the-record tab; web addresses only), at most 100, in tab order. Two records, like a marker: `["sync:tabs:<id>","type"] → "scalar"` and `["sync:tabs:<id>","value"] → {...}`.
- Other devices' `sync:tabs:*` are copied verbatim (§6 rule 1). The desktop shows them under History › Tabs from other devices, named after the device, and opens one as a new tab when clicked. A device no longer in `GET /sync/devices` is not shown. Nothing on a pull changes an open tab.
- `storage:tabs`, `storage:groups` and `storage:stacks` are retired (§4.7): no longer written or applied, copied verbatim while an older desktop is on the account, and cleared out once every device is at level 2.
- A phone or other client MAY write its own `sync:tabs:<deviceId>` the same way, so the desktops list its tabs. It MUST NOT write another device's.

### 4.9 Saved passwords and authenticator accounts (from the release after v18.59.3)
A desktop syncs its saved passwords and its authenticator (TOTP) accounts only when the person turns each on, on that device (Settings › Vex Sync › Choose what to sync, **off by default**; turning one on asks for the Vex PIN, or for a confirmation when no PIN is set). A device that has them off copies their records verbatim (§6 rule 1).

Two list sources, item records only (§4.3), each item a **sealed item**:
```
["secret:passwords","type"]            → "array"
["secret:passwords","item","<id>"]     → {"index":0,"item":{"id":"<id>","t":<ms int>,"s":"<base64>"}}
["secret:authenticator","type"]        → "array"
["secret:authenticator","item","<id>"] → {"index":0,"item":{"id":"<id>","t":<ms int>,"s":"<base64>"}}
```
- Keys, from the 32-byte sync key (§3.1) with HKDF-SHA-256, empty salt, 32-byte output: `enc` with info `vex-sync secrets v1 enc`, `iv` with info `vex-sync secrets v1 iv`, `idk` with info `vex-sync secrets v1 id`.
- Payload: a login is `{"host","username","password","note"?,"updatedAt"?}` (`host` as the vault keys it: lower case, no `www.`; `updatedAt` an ISO time). An authenticator account is `{"id","label","issuer","secret","algorithm","digits","period","created"?}` (`secret` base32, `algorithm` one of `sha1`, `sha256`, `sha512`, `id` that device's own name for it). Fields in exactly this order, optional ones left out when absent.
- `id` = the first 32 lowercase hex characters of HMAC-SHA-256(`idk`, `<kind>\n<identity>`), where `<kind>` is `passwords` or `authenticator` and `<identity>` is `host\nusername` for a login, `issuer\nlabel\nSECRET` for an account (`SECRET` upper-cased, without spaces or `=`). The same login on two devices is the same record; the id says nothing about the site to anyone without the key.
- `s` = base64( `iv(12)` ‖ AES-256-GCM(`enc`, payload JSON) ‖ `tag(16)` ), with AAD `vex-secret/1\n<kind>\n<id>` and `iv` = the first 12 bytes of HMAC-SHA-256(`iv`, `<kind>\n<id>\n` ‖ payload JSON). The IV comes from the payload, so an unchanged item seals to the same text and is never seen as an edit; two equal payloads give equal text, which only a holder of the key can compare.
- `t` = `updatedAt` (login) or `created` (account) in ms, else 0. A desktop sets the record's `at` (§4.4) to `t` when it writes the item, so between two concurrent edits of one login (§5.2) the later change of the login wins. The other version stays in `conflicts` and is listed under Sync conflicts by the site and username only.
- `index` is always 0: the items are kept in id order, so adding one never re-indexes the others (§5.5).
- A desktop opens an item only in its main process, checks that it decrypts, is a valid login or account, and that its `id` is the HMAC of its own identity (else the pull fails, §6 rule 11). It changes only the logins the merge changed since it read them, never one saved on the device during the round.
- **Joining** (a recovery code, or the kind just turned on): a login both sides hold is merged as in §5.2 (newer change wins, the other kept as a conflict), not replaced by the account's copy, and a login this device holds that the account has deleted is kept and sent again: a join never removes a saved password.
- **Locked:** while Vex is locked, a desktop that syncs either kind neither pulls nor pushes; it syncs as soon as it is unlocked.
- Carried with them: `preference:vex.pwNever` (sites never offered a save, a list of host names like `vex.forceDarkHosts`) with passwords, and `preference:vex.totpSites` (sites an authenticator code is or is not filled on, a JSON object as a string) with the authenticator.
- A phone or other client MUST copy these records verbatim (§6 rule 1) unless it implements this section exactly.

#### 4.9.1 Passkeys (`secret:passkeys`)
A third sealed kind, sealed exactly as above (same keys, same `s` layout, AAD `vex-secret/1\npasskeys\n<id>`), **off by default** on each device, turned on under Choose what to sync as `passkeys` (the same Vex PIN or confirmation first).
```
["secret:passkeys","type"]            → "array"
["secret:passkeys","item","<id>"]     → {"index":0,"item":{"id":"<id>","t":<ms int>,"s":"<base64>"}}
```
- Payload, in exactly this order: `{"credentialId","rpId","rpName","userHandle","userName","userDisplayName","nickname"?,"privateKeyPkcs8","publicKeySpki","createdAt","updatedAt"?}`. `credentialId`, `userHandle`, `privateKeyPkcs8` (PKCS#8 DER of an ECDSA P-256 key) and `publicKeySpki` (SPKI DER) are base64url without padding; `createdAt` / `updatedAt` are ISO times. Where a passkey was last used and its signature counter are **not** part of it (a synced passkey reports a counter of 0), so using one is never a sync change.
- `<identity>` for the id is `credentialId`; `t` is `updatedAt`, else `createdAt`, in ms.
- A desktop opens an item only in its main process and additionally checks that the private key is the private half of `publicKeySpki` (else the pull fails, §6 rule 11). A deletion is a tombstone like any other item; renaming (`nickname`) is an edit.
- Only passkeys **made while sync was on** (those that told the site they are backup eligible, the BE flag, which cannot change afterwards) are sealed; the others stay on the device that made them.
- A phone or other client MUST copy these records verbatim (§6 rule 1) unless it implements this section exactly.

### 4.10 One browser across devices (from the release after v22.24.6)

Everything here is **additive**: no schema, level, endpoint or encryption changes, and a client that knows none of it keeps working (§4.10.6).

#### 4.10.1 The device snapshot (`sync:tabs:<deviceId>`, version 2)
Version 1 (§4.8) is `{"tabs":[{"url","title"}]}`. Version 2 is a **superset** of it, written only by a desktop that turned on **Live tabs** (Settings › Vex Sync › Choose what to sync, `liveTabs`, off by default; it has no records of its own). A reader that understands only version 1 reads `tabs[].url` and `tabs[].title` and ignores the rest.

```json
{ "v": 2, "hlc": "<HLC>", "seen": 1767225600000, "la": 1767225590000, "active": "t3", "cut": 0,
  "tabs":   [ { "id": "t3", "url": "https://a.test/x", "title": "X", "h": "<HLC>",
                "fav": "https://a.test/f.ico", "g": "Work", "p": 1, "s": 1500, "a": 1767225590000 } ],
  "closed": [ { "id": "t2", "h": "<HLC>" } ] }
```
- `tabs[]` (at most 100): `id` the device's own tab id (`[\w-]{1,40}`); `url` http(s), at most 2048; `title` at most 300; `h` the HLC of the tab's last change (address, title, group, pinned); optional `fav` (an http(s) icon address, at most 512), `g` group name (at most 60), `p` 1 when pinned, `s` scroll hint in px rounded to 500, `a` last used (ms, the device's clock).
- `closed[]` tombstones for tabs that were open and are not: `id` and the HLC `h` they closed at; at most 50, none older than 7 days.
- `seen` when the device last wrote the snapshot, refreshed at most once a day while nothing changes; `la` the newest `a`; `active` the id of the tab in front; `cut` how many tabs were left out to fit the size cap.
- **Size cap: 24 KB of JSON per device.** Over it, the device drops icons, then shortens titles to 100, then drops tombstones, then drops the tabs used longest ago (pinned ones last) and sets `cut`.
- Every address obeys §4.10.4. A reader MUST ignore a tab whose address it would not have sent itself.

#### 4.10.2 Clocks and freshness
- **HLC string**: `<wall ms, base 36, 9 digits>.<counter, base 36, 4 digits>.<node, 1-16 of [0-9a-z]>`, compared as plain strings. A new local event takes `max(previous.wall, now)` with the counter reset, or incremented when the wall did not move. A received HLC is believed at most **1 hour** ahead of the receiver's own clock, so one wrong clock cannot drag the others.
- The record's own version vector (§4.4) still decides which write of the record wins; HLCs order the *tabs inside* a snapshot, so two copies of one device's snapshot (a cached one and one that just arrived) merge per tab: the newer `h` wins, a tombstone newer than a tab removes it, a tab newer than its tombstone stands. The merge is commutative, associative and idempotent (`js/live-session.js mergeSnapshots`).
- **Last seen** of a device is the server's `lastSeenAt` (§1.4 `GET /sync/devices`), the clock everyone shares; a snapshot's `seen` is used only for a device the server does not list, and never later than now. A device not seen for 14 days is shown as stale.
- Last-writer-wins for the shared lists (bookmarks, workspaces, reading queue) is the existing record merge (§5.2) and its conflict viewer (Settings › Vex Sync › Sync conflicts); nothing new is added there.

#### 4.10.3 Reading queue (`preference:vex.readLater`)
A list preference (§4.5), items `{id, url, title, at, read, ownSession?, minutes?, ...}` as `js/readlater.js` writes them, off by default (`readingQueue`). Items with `ownSession: true` (saved from a tab with a session of its own) and items whose address §4.10.4 would refuse are **not** sent, and a pull never removes them from the device that holds them. A client MUST carry unknown item fields through (§6 rule 13) and copy the records verbatim when it does not own the source (§6 rule 1).

#### 4.10.4 What never leaves a device
Whatever the person turned on: tabs of a private window, a private, Off-the-Record or Tor tab, a tab on a route (`persist:route-*`, `persist:container-tor-*`, or a container with a Tor or proxy route), a tab with `ownSession`; addresses that are not http(s), carry a user name or password, carry a query parameter named like a secret (`token`, `code`, `session`, `key`, `password`, `otp`, `jwt`, `state`, ...), or have a host that is `localhost`, an IP literal, a single label, `*.local`, `*.internal` and the like; and hosts of money, identity, mail or health (banks, payment providers, password managers, webmail, `accounts.`/`login.`/`sso.` hosts, tax authorities), plus any hosts the person lists in `localStorage['vex.liveSensitiveHosts']`. The same rules apply to the version 1 list. The list is `js/live-session.js`.

#### 4.10.5 Addressed handoff (§7)
The mailbox has no addressing. An item's encrypted payload MAY carry, besides `url` and `title`, `to` (a 32-hex device id) and `hop` (integer, default 0). A device that fetches an item whose `to` is another device puts it back (§7 `POST /sync/drop`) with `hop + 1`, and drops it after **4** hand-ons; the device it names opens it. A device that does not know `to` (an older desktop, or an app that ignores unknown fields) opens it as before, which is the unaddressed behaviour. Cost of this design: a few extra mailbox writes while the intended device is offline; an addressed item for a device that never returns is dropped after four hops, not kept.

#### 4.10.6 Compatibility
| Reader | What it sees |
|---|---|
| a desktop before this release | version 2 values: `tabs[].url`/`title` work; other fields ignored; unknown source `preference:vex.readLater` copied verbatim (§6 rule 1), as on any level-2 desktop. A level-1 device of v2.34.3 to v2.35.1 still tombstones sources it does not know (§6 rule 1), so the reading queue should not be turned on while one is on the account |
| a client reading only §8.2 | `sync:tabs:<id>` as in §4.8 |
| a mailbox reader that ignores `to` and `hop` | opens every item, as before |

The marker level stays 2. Nothing in this section changes how a document is validated (§4.1) or encrypted (§3).

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
- Delete on device A plus an edit of the same item on device B: the **delete wins**. The edit remains in `conflicts`. From the release after v14.72.3 the desktop lists such records under Settings › Vex Sync › Sync conflicts; putting a version back is an ordinary local edit (its own clock entry + 1, `conflicts: []`), which wins on every device.
- Two concurrent edits: the newer `at` wins. Clock skew between devices therefore matters, and the device with the faster clock wins ties it should not.
- Removing an item on A while B adds a different item: both stand (tested).
- Inserting at the front re-indexes later items. If two devices do that concurrently, every shifted item becomes a "conflict" (same item, different `index`) and the desktop toasts "N sync conflicts retained in recovery data". The data is fine. A mobile client SHOULD append new list items **at the end** to keep this churn small. The desktop shows bookmarks grouped by folder and in stored order; notes and history are sorted by their timestamps, so the position barely matters there.

### 5.6 Timing (desktop)
- Push every 2 minutes, pull every 5 minutes, pull 1.5 s after start, and "Sync Now" (pull, then push). One push or pull runs at a time; one asked while another runs waits its turn.
- From the release after v14.72.3 the desktop also pushes about **5 s after a synced setting or list changes** (several changes in a row make one push), and once more while its window closes (given at most 4 s). Expect more frequent revisions, and so more 409s, than before.
- A timed push is sent only when the document differs from the one the server holds at the desktop's revision (the one it last pushed or pulled). Up to v2.38.1 the desktop pushed on its timer even when nothing changed, so the revision rose by about 1 every 2 minutes per running desktop; such desktops are still about, so expect 409s.
- A pull that returns the revision the desktop already has is not applied again. Nothing on the wire changes: the pull is still made and returns the whole blob.
- Handoff polling: on window focus, every 2 minutes, and 8 s after launch.

---

## 6. Compatibility rules for a new client

**Preserving other devices' data**

1. A client **MUST NOT tombstone, drop or rewrite any record whose source it does not own.** Build the push document like this: take the last merged document, run `capture` only over the sources you own plus your marker, and copy **every other record verbatim** from that document. That includes tombstones, `conflicts`, `clock` and field order. In practice: build `values` as `values(before)` minus your owned sources, plus `flatten(ownedSources)`, run `capture`, and then put back every non-owned record from `before` untouched.

   **What the desktop owns** (from v2.35.2, `sync-engine.js` `ownsRecord`): the record kinds `type`, `value` and `item` of `preference:<key>` for each preference in §8.1, `storage:<key>` for each storage key in §8.1, its own `sync:device:<id>`, and the two tile lists while the tile gate is open (§4.6). Every other record (another device's marker, a source a newer Vex or another client added, a record kind it does not know, tiles while the gate is shut) is copied verbatim from the document it pulled, tombstones included, and is not read, applied or validated. Deletions of what it owns still work: an item or key that is gone locally becomes a tombstone. From the release after v14.72.3 the user can leave kinds of data out on a desktop (Settings › Vex Sync › Choose what to sync); that desktop then owns none of their sources and copies them verbatim like any other. When a kind is turned back on, its first pull joins it as a new device does (§5.4): the account's records win, local-only records are added, nothing is tombstoned.

   **Older desktops:** Vex 2.34.3 to 2.35.1 pass through only other devices' markers and the tiles; every other source they do not know is tombstoned on their next push, and then removed everywhere. Their markers say level 1 just like v2.35.2's, so a client cannot tell them apart. A client SHOULD therefore write only sources listed in §8.1, never a source of its own invention.

   Doing otherwise is exactly the bug in which Vex ≤ 2.34.2 wiped other devices' shortcut tiles. Verified with the real code: a naive `capture(cloud, flatten({bookmarks}), phone)` tombstones notes, settings, tiles, every scalar preference and the desktop's marker. After that each desktop **deletes those from its own storage** on its next pull.
2. A client MUST own only the sources it fully understands and holds **completely**. Owning a source means pushing its full current list, because any item left out becomes a tombstone. Do not own `preference:vex.history` unless the full history is held locally.
3. A client MUST always push a document derived from the latest document it pulled. Never push one built from scratch, from a stale cache or from an empty document, except when the account is empty. That is either a brand-new account (`hasEncryptedData: false`, pushed with `baseRevision: 0`), or a pull that returned `{"blob": null}` (pushed with that pull's revision, i.e. 0). In both cases the push MUST be built from an **empty** document plus the client's own data and marker, never from a document the client stored before (§5.3 pull step 2).
4. A client MUST send `baseRevision` as an integer on every push. It MUST store the revision only after the matching merged document is safely persisted.

**Device markers**

5. A client MUST write its own marker `sync:device:<deviceId>` in **every** document it pushes, using the server-issued `deviceId`: `{"level":1}`, or `{"level":2,"revision":<the revision the push is based on, or lower>}` once it follows everything level 2 promises (§4.6, §4.7). It MUST NOT write a higher level than the ones this spec defines: a higher level would promise it understands future features. It MUST copy other devices' markers verbatim.
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

19. A client MUST NOT write `storage:tabs`, `storage:groups` or `storage:stacks`. Desktops up to v14.72.3 apply them live to their open tabs (`TabManager.applySyncedState`), so writing them opens and closes tabs on the user's computers. Newer desktops neither write nor apply them (§4.8).
20. A client MUST NOT write tile sources (`preference:vex.shortcuts`, `preference:vex.startTiles`) while the tile gate is shut. That is, unless every listed device, the client included, has a marker with level ≥ 1. When writing tiles, it MUST give them the §4.6 ids and must not keep those ids in its local copy.
21. A client SHOULD keep its document well under the size limit (§1.2). The desktop sends at most 1,000 history visits (§8.1), and clears out tombstones while every device is at level 2 (§4.7).

**Key proof**

22. From the release after v14.72.3 a client MUST prove the key (§2.7) on every push and wipe when the worker offers `/sync/challenge`, with a fresh nonce for each request (a 409 or a refusal spends it). On **403** with a `code`, it shows `error` and stops; it never retries a `key-mismatch` with anything but the user's recovery code.

---

## 7. Send to My Devices (handoff, "drop")

A small per-account mailbox, separate from the record document.

- **Send**: `POST /sync/drop {"encryptedBlob": string}` (Bearer, registered device).
  - The payload is `SyncCrypto.encrypt({url, title}, key)`: the same AES-GCM format and the same account key as the document (§3.2).
  - The desktop only sends `http:`/`https:` URLs, `url` truncated to 2048 characters and `title` to 300 (`String(title||'')`).
  - The payload MAY also carry `note`, a string of at most 1000 characters: the text a phone's share sheet sent along with the link ([PHONE_SHARE.md](PHONE_SHARE.md)). A receiver that does not know `note` ignores it; the desktop keeps it with the item and files it in the Clips inbox together with the link. It is not forwarded with an addressed hand-on.
  - The server requires a non-empty string of **≤ 16 384 characters**, else **400** `{"error":"Encrypted handoff required (max 16 KB)"}`.
  - It stores `{id: <16 hex>, encryptedBlob, fromDeviceId, fromDeviceName, at: <ISO>}`, keeps only the **newest 20** items, and refreshes the whole mailbox's TTL to **7 days** on each send.
  - Returns 200 `{"ok":true}`.
- **Fetch**: `GET /sync/drop` returns 200 `{"ok":true,"items":[{id, encryptedBlob, fromDeviceId, fromDeviceName, at}, ...]}`. That is every item **not** sent by the caller.
  - Fetching **consumes** those items: they are deleted from the server. The caller's own items stay.
  - There is no addressing. Whichever other device fetches first gets the tab, whether that is the phone or one of several desktops.
- **Receiving**: decrypt each item on its own and skip any that fail, because one bad item must not lose the others. Accept the item only if `payload.url` is a string with an `http:` or `https:` scheme, and use `String(payload.title || '')`. Because the fetch has already consumed the items, a client SHOULD keep what it accepted until the user acts on it (the wire format is unchanged). The desktop (from the release after v2.37.0, `js/handoff.js`) keeps each one on that computer, shows it as a card "From <fromDeviceName>: <title>" on the New Tab page with Open and Dismiss, and shows one desktop notification per check; a card goes when it is opened or dismissed. Earlier desktops opened each one as a background tab and toasted "Tab from <fromDeviceName>: <title>". A desktop never sends from a private, Off-the-Record or Tor tab or from a private window, and a private window never fetches.
- **Open tabs per device**: from the release after v14.72.3 each device's open tabs are `sync:tabs:<deviceId>` in the document (§4.8). Before that the only open-tab list was `storage:tabs`, shared by the desktops, which a phone MUST NOT write (§6 rule 19).
- Pending sessions get 403 on both endpoints.

---

## 8. Synced sources: what a mobile client can use

### 8.1 Complete list (from `SYNC_KEYS`, `preferenceKeys()`, `STORE_KEYS` and `TILE_LISTS`)
- **List preferences** (arrays): `vex.bookmarks`, `vex.sessions`, `vex.history`, `vex.notes`, `vex.tools`, `vex.schedules`, `vex.personas`, `vex.reminders`, `vex.forceDarkHosts`, `vex.neverSleepHosts`, `vex.translateAlwaysHosts`, `vex.customThemes`, and from the release after v18.59.3 `vex.pwNever` (with passwords, §4.9), and from the release after v22.24.6 `vex.readLater` (the reading queue, off until chosen, §4.10.3).
- **Scalar preferences** (raw localStorage strings): `vex.historyClearedAt`, `vex.workspaces`, `vex.agentMode`, `vex.aiIndexingEnabled`, `vex.zooms`, `vex.forceDarkSites`, `vex.autoSleepPrefs`, `vex.aiRouting`, `vex.preferLocalAI`, `vex.forceCloudAI`, `vex.activePersona`, `vex.aiMemory`, `vex.autoGroupSuggest`, `vex.autoAddToGroups`, `vex.groupPatterns`, `vex.userShortcuts`, `vex.tabLayout`, `vex.themeAuto`, `vex.whatsNewCard`, and from the release after v14.72.3 `vex.guiStyle`, `vex.guiColors`, `vex.skinPattern`, `vex.skinShape`, `vex.skinGlow`, `vex.skinStrength`, `vex.font`, `vex.fontMono`, `vex.a11y` (the browser look, skin, fonts and reading aids; the interface size and spacing stay per device), and from the release after v18.59.3 `vex.totpSites` (with the authenticator, §4.9). All are prefixed `preference:`.
- **History window** (from the release after v14.72.3): the desktop owns `preference:vex.history` but sends only its newest **1,000** visits, and none whose `visitedAt` is more than **90 days** old. A visit that falls out of that window becomes a tombstone once (and is cleared out later, §4.7); every desktop keeps its own older visits locally and does not delete them when they are missing from, or tombstoned in, the account. `vex.historyClearedAt` (an ISO time, written by History › Clear History) is how a clear reaches those older visits: a desktop removes every visit with `visitedAt` at or before it.
- **No longer synced** (removed after v2.36.4): `vex.autosleep`, `vex.autosleepMinutes`, `vex.autosleepExcludePinned` (never written by anything; auto-sleep travels as `vex.autoSleepPrefs`), `vex.customCommands`, `vex.settings` and `vex-theme`. A newer desktop no longer owns these, so records an older desktop still sends under them are copied verbatim (§6 rule 1) and never applied. Once every device is at level 2 they are cleared out of the document (§4.7).
- **Tile lists** (gated): `preference:vex.shortcuts`, `preference:vex.startTiles`.
- **Storage**: `storage:settings`, `storage:shortcuts`, `storage:theme`. The desktop always sends these, possibly as `null`. `storage:tabs`, `storage:groups` and `storage:stacks` are no longer sent or applied from the release after v14.72.3 (§4.8): records an older desktop sends under them are copied verbatim. `storage:history` (a second, 500-visit copy of history) is no longer sent after v2.38.1: it was folded into `preference:vex.history` (`main/history-fold.js`). A newer desktop no longer owns it, so records an older desktop still sends under it are copied verbatim (§6 rule 1) and never applied.
- **Markers**: `sync:device:<id>`.
- **Open tabs**: `sync:tabs:<id>`, one per device, written only by that device (§4.8).
- **Sealed secrets** (only on a desktop that turned them on, §4.9): `secret:passwords`, `secret:authenticator`, `secret:passkeys` (§4.9.1).

`vex.theme` and `vex.shortcuts` are in `SYNC_KEYS` but are **not** sent as `preference:`: their names collide with `STORE_KEYS`. The theme travels as `storage:theme`, the shortcuts as a tile list. (`vex.tabs` and `vex.groups` were in the same position until the shared tab list was retired, §4.8.)

### 8.2 Sources a phone can sensibly read and write

| Source | Read | Write | Item schema and notes |
|---|---|---|---|
| `preference:vex.bookmarks` | yes | **yes (recommended owned source)** | `{ "id": string, "url": http(s) string, "title": string, "folder": string ("" = Unsorted), "at": ms int, "ownSession"?: true }`. `id` matches `^[\w.:-]{1,160}$`. The desktop makes ids like `bm` + base36 time + base36 counter + 5 random base36, e.g. `bmmg5k2x01a3f9q`; any unique id matching the regex is fine. The desktop adds new bookmarks at the **front** and treats the URL as the identity for its star button. |
| `preference:vex.notes` | yes | yes | `{ "id": string, "title": string, "content": markdown string, "pinned": bool, "tags": string[], "sourceUrl": string, "sourceTitle": string, "createdAt": ISO string, "updatedAt": ISO string }`. Desktop id format: `note_<ms>_<5 base36>`. Every field is optional on read (`NotesPanel.normalize`). Set `updatedAt` on every edit. Data-contracts does not validate notes beyond §8.4's generic rules. |
| `preference:vex.history` | yes | SHOULD NOT (read-only) | `{ "id": "h_<ms>_<5 base36>", "url": http(s), "title": string, "favicon": http(s) URL or "", "visitedAt": ISO, "indexed": bool, "ownSession"?: true, "summary"?, "tags"?, "contentType"? }`. Up to 5000 entries on a desktop, newest first; the account holds only the newest 1,000 from the last 90 days (§8.1). Owning it means holding and pushing that complete window (rule 2), and never deleting a local visit because it is outside the window. |
| `preference:vex.forceDarkHosts` | yes | MAY | A list of host-name **strings**, e.g. `"example.com"`. The item id is the JSON string with quotes (§4.3). |
| `preference:vex.customThemes` | yes | MAY | Your own colour themes: `{ "id": ^user-[a-z]{4,24}$, "name": string (1-40 chars), "colors": { background, surface, text, muted, primary, success, warning, danger, border: "#rrggbb" each, all nine }, "base"?: built-in theme id, "updated"?: ms int }`. No other fields: the desktop drops a record with any other field or a colour that is not `#rrggbb` (`theme-custom.js validateRecord`). Background images are **not** synced (they stay on each device). The colours, and the `.vextheme` file a theme is shared as, are described in [THEME_FORMAT.md](THEME_FORMAT.md). |
| `preference:vex.reminders` | yes | add only, with care | A mirror of the desktop main process's reminders: `{ id: ^[A-Za-z0-9_-]{1,64}$, message: string (≤2000 used), at: ms|null, site: host|null, repeat: "daily"/"weekdays"/"weekly"/[0..6 ints]|null, time: "HH:MM"|null, url: http(s)|null, urgent: bool, kind: "reminder"/"alarm"/"timer"/"review", sound: bool, job, owner, ackedAt, createdAt, firedAt, lastFiredAt }`. Desktops **import** new ones (`reminders.js importList`): not `kind:"review"`, not `firedAt`, not older than 7 days. They fire while Vex is open, and only the `owner` machine wakes Windows. **A phone cannot delete a reminder:** the desktop rewrites the mirror from its own list every 5 minutes and after each sync, so a deletion comes straight back. A reminder the desktop refuses to import disappears from the account on that desktop's next push. |
| `preference:vex.shortcuts` | yes | only with the gate open (rule 20) | Glass shortcut bar tiles: `{ "name": string, "url": string (http/https/about/file/vex) }`, plus account-only `id` (§4.6). A missing source means "show defaults"; `[]` means "no shortcuts". |
| `preference:vex.startTiles` | yes | only with the gate open (rule 20) | New Tab grid: `{ "name": string, "url": string, ... }`. At most 500 (`webview.js _startTilesValid`), plus account-only `id`. **UNSURE:** which other fields the New Tab page stores on a tile. `_startTilesValid` only requires `name` and `url` to be strings. Carry unknown fields through. (`src/renderer/js/webview.js` `saveStartTiles`, and the start page itself.) |
| `sync:tabs:<deviceId>` | yes (a "tabs on my computers" view) | only its own | `{ "tabs": [{ "url": http(s), "title": string }] }`, at most 100 (§4.8). |
| `storage:tabs` | only from desktops up to v14.72.3 | **MUST NOT** | `{ id, partition, url, title, favicon, pinned, groupId, stackId, sleeping, originalUrl, scrollPosition, keepAwakeUntil, memBeforeSleep }`. The open-tab set those desktops shared, **merged across all of them**. Retired (§4.8). |

### 8.3 Desktop-only sources (copy verbatim, never write)
`preference:vex.sessions`, `vex.workspaces`, `vex.tools` (`{id,name,url,desc,svg}`), `vex.schedules` (agent tasks, `v:2`), `vex.personas`, `vex.activePersona`, `vex.aiMemory`, `vex.agentMode`, `vex.aiRouting`, `vex.preferLocalAI`, `vex.forceCloudAI`, `vex.aiIndexingEnabled`, `vex.zooms`, `vex.forceDarkSites`, `vex.autoSleepPrefs`, `vex.autoGroupSuggest`, `vex.autoAddToGroups`, `vex.groupPatterns`, `vex.userShortcuts`, `vex.tabLayout`, `vex.themeAuto` (Light and dark: `{mode, light, dark, ...}`), `vex.whatsNewCard`, the look keys (`vex.guiStyle`, `vex.guiColors`, `vex.skin*`, `vex.font`, `vex.fontMono`, `vex.a11y`), `vex.historyClearedAt`, `vex.neverSleepHosts` and `vex.translateAlwaysHosts` (lists of host-name strings, like `vex.forceDarkHosts`), `storage:groups`, `storage:stacks`, `storage:history` (`{url,title,time}` rows from the file store, ≤ 500), `storage:settings`, `storage:shortcuts`, `storage:theme`, every other device's `sync:device:*`, and `secret:passwords`, `secret:authenticator`, `secret:passkeys`, `vex.pwNever` and `vex.totpSites` (§4.9).

### 8.4 Validation every merged source must pass (`data-contracts.js` `sources()`)
The desktop runs these checks on the **sources it owns** in the merged result (§6 rule 1; tile lists only while the gate is open). A failure aborts the pull. Sources it does not own are not checked (from v2.35.2; up to v2.35.1 the desktop checked the whole merged result, and any failure aborted the pull).

- **Every value, recursively:** nesting depth ≤ 40; no non-finite numbers; strings ≤ 12 MiB; objects/arrays ≤ 30 000 keys; no property named `__proto__`, `constructor` or `prototype`.
- **List preferences** (`LIST_PREFERENCES`): after `JSON.parse` if the value is a string, the value MUST be an array, else "Invalid synced list".
- **Tile lists** (with the gate open): MUST be arrays.
- **`preference:vex.bookmarks`, `preference:vex.history`** (and `storage:history` on v2.38.1 and older): an array of ≤ 10 000 items.
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
3. Encrypt `next` with a fresh IV. Ask for a nonce (`GET /sync/challenge`) and compute the proof for `push` over `41` and the blob's SHA-256 (§2.7.2); add `X-Vex-Auth-Key` if the challenge said `"keyCheck": null`. Then push:
```http
POST /sync/push
Authorization: Bearer ab69c147…72bf8
Content-Type: application/json
X-Vex-Proof: <nonce>.<mac>

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
| 403 + `code` | key proof refused or needed (§2.7.6), or `/sync/reset` from a sign-in that is not fresh (§2.8) | show `error`; `proof-stale`: ask for a new nonce |
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
3. **Recovering conflict variants** (settled in the release after v14.72.3): the desktop lists records of sources it owns whose `conflicts` hold more than one version (`sync-engine.js` `conflicts`), and puts a chosen one back as a new local edit (`resolveConflict`). A client need not expose them, but MUST keep them on records it does not change.
4. **`vex.reminders` items written by a non-desktop `owner`**: `reminders.js` `importList` accepts them, but sets `owner` to the value sent or `'unknown'`. What the desktop shows for a reminder whose `owner` is not a known machine was not checked (`src/main/reminders.js`).
5. **Document growth** (settled in the release after v14.72.3): a 5,000-visit history was measured at about 3.8 MB of request body, and a busy week of browsing leaves about 1,000 tombstones. History is now limited to 1,000 visits (§8.1) and tombstones are cleared out while every device is at level 2 (§4.7). While a level-1 device stays on the account, tombstones still accumulate.
