# Requests for the desktop session

The phone can't do these alone. Each one needs a change in `src/`, `workers/` or `docs/SYNC_PROTOCOL.md`, and the mobile session doesn't edit those files. What the phone already does without help:

- It shows the computer's open tabs under their group names and colours, read from `storage:tabs` and `storage:groups`.
- It shows the computer's history as read-only, from `preference:vex.history`.

Everything below is the part that needs the desktop. Once a request lands, the phone side follows on `claude/mobile-browser-version-00t60f`.

## 0. One gate for all of it: marker level 2

New sources are only safe once no desktop at v2.35.1 or older is left on the account. Those desktops tombstone sources they don't know (§6 rule 1). So the proposal is one rule:

- Define marker level 2 as meaning "understands §R1–§R4 below".
- A desktop that ships them writes `{"level":2}`.
- The phone writes a new source only when every device listed by `GET /sync/devices` has a marker at level 2 or higher. This works like the tile gate in §4.6.
- §6 rule 5 must then allow level 2.

## R1. Reading list (new, both sides own it)

- **Source:** `preference:vex.readingList`, a list preference. Add it to `SYNC_KEYS` and `LIST_PREFERENCES`, and to §8.1 and §8.2.
- **Item:**

  ```
  { "id": "rl_<ms>_<5 base36>", "url": http(s), "title": string, "at": ms int, "read": bool, "readAt"?: ms int }
  ```

  The list is newest first, with at most 2000 items.
- **Validation (§8.4):** the same item rules as `vex.bookmarks`.
- **Desktop UI:**
  - "Add to reading list" in the page context menu and the star menu;
  - a Reading list tab in the Library or History panel, with unread items first;
  - marking an item read when its page is opened from the list.
- Both sides own the source and push the full list (rule 2).

## R2. Each device's open tabs and groups (per device, the owner writes)

`storage:tabs` is merged across desktops and the phone must never write it (rule 19). So the proposal is a per-device whole-value source that nothing applies live:

- **Source:** `sync:tabs:<deviceId>`, a whole value written only by that device:

  ```
  { "at": ms, "name": deviceName,
    "tabs": [ { "url", "title", "pinned": bool, "groupId": string|null, "active": bool } ],   // ≤ 500
    "groups": [ { "id", "name", "color" } ] }                                                // ≤ 200
  ```

  Private tabs are never included.
- **Desktop:**
  - writes its own source on each push;
  - shows "Tabs on your other devices" (phone included) with group headers, where a tap opens the tab locally;
  - must **not** feed this source into `TabManager.applySyncedState`.
- **Owner rule (§6):** a device owns only its own `sync:tabs:<id>`. When `DELETE /sync/devices/:id` runs, that device's source is tombstoned.

## R3. Each device's history and recently closed tabs

The phone can't own `preference:vex.history` (rule 2), so the proposal is per-device sources:

- **`sync:history:<deviceId>`:** a list of at most 1000 items, `{ "url", "title", "at": ms }`, newest first, with no private tabs.
  - The desktop shows it under a "From your phone" filter in History, and in omnibox suggestions marked as from the phone.
  - The desktop does not need to write one of its own, since it already writes `preference:vex.history`.
- **`sync:closed:<deviceId>`:** a list of at most 25 items, `{ "url", "title", "closedAt": ms, "groupName"?: string }`.
  - The desktop already keeps this shape in `localStorage['vex.recentlyClosed']` (`tabs.js`, `MAX_RECENTLY_CLOSED = 25`). Write it here as well.
  - Show the phone's list in the History panel's "Recently closed".
  - "Clear history" on a device clears its own two sources.
- **Validation:** the bookmark item rules from §8.4 apply.

## R4. Remote control of the desktop from the phone

**Goal:** while Vex is open on the PC, the phone can see its tabs live and act on them, for example from the couch.

### Transport

The drop mailbox (§7) can't carry this: it has no addressing, whichever device fetches first consumes it, and polling it is slow. The sync worker already has Durable Objects, so the proposal is one per account:

- `GET /remote/socket?device=<targetId>` (Bearer, registered) upgrades to a WebSocket.
  - The desktop connects only while "Allow remote control" is on.
  - The phone connects only while its remote screen is open.
  - The DO relays frames between the controller and that target only.
- **Frames:** `{ "id": seq, "blob": SyncCrypto.encrypt(payload, key) }`, encrypted with the account key (§3.2). The worker never sees a command.
- **Without WebSockets:** `POST /remote/cmd {to, blob}` and `GET /remote/cmd?wait=25`, using long-poll with addressing and a 60 s TTL.

### Commands (phone → desktop)

The payload is `{ "op", ...args, "at": ms }`. The desktop rejects any payload older than 30 s, and any `id` it has already seen.

| op | args | desktop does |
|---|---|---|
| `state` | — | replies with the tab list (as in R2, plus `id`, `audible`, `muted`, `loading`) and `{activeId, zoom, canBack, canForward}` |
| `activate` / `close` | `tabId` | switches to or closes the tab |
| `open` | `url` (http/https only), `background`? | opens a new tab |
| `back` / `forward` / `reload` | `tabId`? | acts on that tab, or the active one if none is given |
| `scroll` | `dy` (px), or `page: up/down`, or `top/bottom` | scrolls the active tab |
| `media` | `play` / `pause` / `toggle` / `seek: ±s` / `volume: 0–1` / `mute` | acts on the first `<video>`/`<audio>` in the tab; YouTube is covered |
| `zoom` | `in` / `out` / `reset` | sets the active tab's zoom |
| `fullscreen` | — | toggles the video player's fullscreen |
| `type` | `text` (≤ 500), `submit`? | types into the focused editable element only |
| `group` | `groupId`, `collapsed` | collapses or expands a group |

- **Replies (desktop → phone):** `{ "re": id, "ok": bool, "error"?, "state"? }`. The desktop also pushes `state` unasked, at most 2/s, whenever tabs, the active tab or media state change.

### Safety

These are the desktop's job:

- **Off by default.** Turning it on happens on the PC, in Settings → Sync → "Let my phone control this computer", and is per device.
- A visible indicator shows while a controller is connected, such as a title-bar pill "Controlled from <phone name>" with a Stop button. Revoking the device or signing out disconnects it at once.
- **Commands it never runs:**
  - JavaScript;
  - `file:`, `vex:`, `about:` or `javascript:` URLs;
  - anything in a private window;
  - anything on the Vault or Settings pages;
  - downloads and installs.
- `type` refuses password fields.
- A per-connection rate limit of 20 commands/s.

### Spec

Add §7.1 "Remote control" to `docs/SYNC_PROTOCOL.md`, with the endpoint, frame format, ops, replies, rejections and test vectors. Use the same style as §7.

## What the phone will build once these land

- **R1:** Reading list panel, "Add to reading list" in the page menu, and a swipe action to mark an item read.
- **R2 and R3:** it writes its own tabs, groups, history and closed tabs, with no private tabs. History and Recently closed gain an "On your computer" view.
- **R4:** a Remote screen showing live PC tabs in groups. Tapping a tab activates it; swiping closes it. It has a trackpad-style scroll strip, media controls (play/pause, seek ±10 s, volume using the phone's volume keys), zoom, back/forward/reload, "Open this phone tab on the PC", and type-to-PC.
