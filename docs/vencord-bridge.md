# Vencord bridge contract (T3-005)

Status: the Vex side (receiver) is built. The Vencord plugin side is NOT built and
lives in the owner's own Vencord repository (`0xmortuex/Vencord`). This file is the
contract between them. Vex does not read Discord, and the plugin work is listed at the end.

## Idea

The owner's own Vencord plugin may write one small JSON file into a folder the owner
chooses. Vex reads that file, read-only, and shows:

- a digest of **mentions** of the owner,
- **replies** to the owner's own messages,
- a **channel catch-up** (counts, open questions, lines that read like decisions, links;
  optionally a summary by the LOCAL model only).

Vex never writes to the folder, never lists it, never follows a link in it, and never
sends the content anywhere. Nothing is polled: the file is read when the owner opens the
screen, presses Refresh, or builds the Morning Brief with the (opt-in) section on.

## File

- Name: `vex-bridge.json` (exactly; no other name is read).
- Location: the folder the owner picked in Vex (Settings, Community and chat tools,
  Vencord bridge, "Choose the folder"). Vex stores that one path and reads only that one file.
- Size: at most 1 MB. A bigger file is refused.
- Encoding: UTF-8 JSON.
- Must be a regular file (not a link or a folder).
- Write it atomically (write `vex-bridge.json.tmp`, then rename) so Vex never reads half a file.

## Schema `vex-bridge/1`

```json
{
  "schema": "vex-bridge/1",
  "generatedAt": 1760000000000,
  "account": { "name": "mortuex" },
  "mentions": [
    {
      "id": "1234567890123456789",
      "author": "Sam",
      "text": "@mortuex can you look at this?",
      "ts": 1760000000000,
      "channelId": "1111111111111",
      "channelName": "dev",
      "guildName": "My Server",
      "url": "https://discord.com/channels/222222222222/1111111111111/1234567890123456789"
    }
  ],
  "replies": [
    { "id": "...", "author": "Alex", "text": "...", "ts": 1760000000000, "channelId": "...", "channelName": "general", "guildName": "My Server", "url": "https://discord.com/channels/..." }
  ],
  "channels": [
    {
      "channelId": "1111111111111",
      "name": "dev",
      "guildName": "My Server",
      "messages": [
        { "id": "...", "author": "Sam", "text": "...", "ts": 1760000000000 }
      ]
    }
  ]
}
```

Fields:

| Field | Type | Notes |
|---|---|---|
| `schema` | string | Must be `"vex-bridge/1"`. Anything else is refused. |
| `generatedAt` | number or ISO string | When the plugin wrote the file. Vex warns if it is over a day old. |
| `account.name` | string | The owner's display name, used only to spot mentions inside channel text. |
| `mentions[]`, `replies[]` | message | At most 200 each (extra are counted as skipped). |
| `channels[]` | channel | At most 20, each with at most 100 `messages`. |
| message `id` | string | Unique per message. Vex remembers the ids it showed, so "new" means new. |
| message `text` | string | Required, at most 2000 characters (cut, single line). |
| message `ts` | number or ISO string | Required. |
| message `url` | string | Optional. Only `https://discord.com/channels/...` addresses are accepted; any other address makes Vex drop that entry. |

Vex trims every text, drops any entry that is missing `id`, `text` or `ts`, and reports
the count of dropped entries on screen ("skipped"). Unknown fields are ignored.

## What the plugin may and may not do

- Write only what the owner can already see in his own client, for himself.
- Keep it to what the schema lists. No tokens, no attachments' contents, no direct-message
  text unless the owner opts in inside the plugin.
- Do not automate anything in Discord (no sending, reacting, status changes) as part of this bridge.
- Respect Discord's terms: a client mod is a gray area and the owner accepts that for his own account.

## Security on the Vex side

- The folder is chosen with a system dialog (`comms:bridge-pick`); the path is kept in
  `comms-bridge.json` in the profile and nothing else about the folder is.
- `comms:bridge-read` takes no arguments. Main reads the fixed file name, checks it is a plain
  file under 1 MB, parses it, validates it and hands the window cleaned data (`src/main/comms-tools.js`).
- The window keeps the messages in memory for the session. On disk (localStorage `vex.vencordBridge`)
  there are only the ids of items already seen.
- "Stop using the bridge" forgets the folder and the seen ids. The file itself is never touched.
- The optional summary (`Summarize with the local AI`) sends the channel text to the LOCAL model
  only (`AIRouter.callOn('local', ...)`), never to a cloud model.

## The plugin side: source in tools/vencord-bridge (BLOCKED-EXTERNAL: build and publish in the owner's Vencord repository)

1. The plugin itself: collect mentions, replies and the last N messages of chosen channels from
   the client's stores, and write `vex-bridge.json` atomically, e.g. on mention and every few minutes.
2. A plugin setting for which channels go into `channels[]` and N.
3. Optional later fields (not in `vex-bridge/1`): join/leave counts per server (would enable a
   join-spike alert in the moderator kit) and an outgoing-promise list (T3-006 follow-up ledger).
   Adding them means `vex-bridge/2` and a change in `sanitizeBridge`.
