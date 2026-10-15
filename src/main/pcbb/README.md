# PC Black Box library

One append-only, local event timeline that **Game Control Center (GCC)** and **Vex** both write to,
so higher-level features (coach, regression finder, diary, patch radar, tab-cost attribution)
become queries over one store.

This is a **file format plus a tiny library**, not a service. There is no daemon, nothing runs in
the background, and nothing leaves the PC.

## The format

- Folder: `%LOCALAPPDATA%\PCBlackBox\` (override with the environment variable `PCBB_DIR`, used by tests).
- One file per **UTC day**: `events-YYYY-MM-DD.ndjson`. Newline-delimited JSON, one event per line.
- Line shape (version 1):

```json
{"v":1,"id":"01KC8...","t":"2026-10-14T18:03:11.402Z","src":"gcc","kind":"game.stop",
 "game":"Arc Raiders","sessionId":"s-abc","data":{"durationMs":3600000,"endReason":"game-exited","restore":"clean"},
 "ref":{"file":"sessions.json","id":"s-abc"}}
```

| field | meaning |
| --- | --- |
| `v` | format version (1). A reader keeps lines of a higher version it does not understand. |
| `id` | ULID-like, sorts by time, unique across processes |
| `t` | ISO 8601 UTC with milliseconds |
| `src` | `gcc` or `vex` |
| `kind` | the closed vocabulary below; **unknown kinds are preserved when reading** |
| `game`, `sessionId` | optional context (a display name, never a path) |
| `data` | small object, schema per kind |
| `ref` | optional `{file, id}` pointer into the store that **owns** the facts |

### Single source of truth

When another store already owns an event type, the Black Box row carries a **pointer** (`ref`) and
the few numbers a query needs, never a copy of the owner's payload:

| kind | owner of the facts | what the line holds |
| --- | --- | --- |
| `game.start`, `game.stop` | GCC `sessions.json` | session id, duration, end reason, restore state |
| `boost.apply`, `boost.restore` | GCC `journal.json` (change journal) | entry id, source, one-line label |
| `note` | GCC `notifications.json` | notice id, title |
| `net.verdict` | nobody (`netq.json` holds settings only) | the verdict itself |
| `health.change` | GCC `health.json` keeps the daily trend | the item, its group, the verdict before and after and one reading |
| `system.update`, `perf.*`, `download.finish`, `tab.sleep` | nobody | the event itself |

### Vocabulary (version 1)

`game.start`, `game.stop`, `boost.apply`, `boost.restore`, `net.verdict`, `perf.hitch`,
`perf.throttle`, `perf.tabcost` (Vex), `system.update`, `download.finish` (Vex), `tab.sleep` (Vex),
`health.change` (GCC), `note`.

`perf.tabcost` (Vex, opt-in): which site's tab was using the processor, averaged over the last few
minutes. Host names only; a private or Tor row has no name. Written at most once a minute, and only
while a game runs or a site stands out. GCC uses it as a possible cause of a lag incident whose time
overlaps it ("a browser tab on example.com was using about 30% of a core"), never as proof. Vex never
creates the folder: it writes only when GCC (or something else) already made it. Vex cannot read GCC's
Black Box on/off switch (it lives in GCC's own data folder), so deleting the folder is how to stop it.

Each kind has a zod schema in `registry.ts`. On write, fields the schema does not list are
**stripped**, text is shortened to its limit, **URLs become `<url>` and paths are reduced to a file
name**. Add a kind by adding it to `EVENT_KINDS` and `registry.ts`; old readers keep it as unknown.

## Append atomicity and its limits

A write is: open the day file for appending, **one write call** with one line (< 4 KB), close.
There is no lock. On a local NTFS volume the file system places each append at the current end of
file atomically, so two processes appending short lines do not interleave or overwrite each other
(the test suite runs two processes with 5,000 lines each and checks the count and every line).

Not promised: network shares (SMB), cloud "online-only" folders, FAT volumes, or a write the OS
completes only partly (disk full, process killed inside the call). That produces a **torn line**:

- readers skip any line that is not a complete JSON event (and count it);
- the next writer checks that the file ends with a newline and starts a fresh row if not.

A failed append never throws into the host app: it is reported once per run through `onProblem`.

## Retention

Default: 90 days or 200 MB, whichever comes first; the **oldest day files are deleted first** (the
newest file is never removed by the size rule). It runs at the writer's first emit of a run and of
each new UTC day, and at app start; there is no timer.

## Use from Vex (Node / Electron main process, CommonJS)

1. In the GCC repo run `node scripts/export-pcbb.mjs <somewhere>`; it emits `pcbb.cjs`,
   `pcbb.d.ts` and this README. Copy those three files into Vex, for example `src/main/pcbb/`.
   No npm dependency is needed (zod is bundled into `pcbb.cjs`).
2. Write events:

```js
const pcbb = require('./pcbb/pcbb.cjs')
const writer = pcbb.createWriter({
  dir: pcbb.resolveDir(),            // %PCBB_DIR% or %LOCALAPPDATA%\PCBlackBox
  src: 'vex',
  enabled: () => settings.blackBox !== false,
  onProblem: (m) => log.warn(m),     // called once per run
  retention: () => ({ maxDays: 90, maxBytes: 200 * 1024 * 1024 })
})
writer.emit({ kind: 'download.finish', data: { file: 'setup.exe', bytes: 52428800 } })
writer.emit({ kind: 'tab.sleep', data: { site: 'example.com', count: 4 } })
// emit() never throws; it returns { ok: true, id } or { ok: false, reason }
```

3. Read / query (all streamed; nothing is loaded whole):

```js
pcbb.queryEvents(dir, { from: '2026-10-01T00:00:00Z', kinds: ['game.stop'], game: 'Arc Raiders', newestFirst: true, limit: 50 })
pcbb.eventsAround(dir, '2026-10-14T18:03:11Z', 60_000)   // closest first
pcbb.aggregateByGame(dir, { from: '2026-10-01T00:00:00Z' })
for (const e of pcbb.iterateEvents(dir, { kinds: ['perf.hitch'] })) { /* ... */ }
```

4. Detect a changed OS build / GPU driver / app version once at start:

```js
pcbb.checkSystemUpdate({ dir, src: 'vex', writer, current: { osBuild: os.release(), gpuDriver: null, appVersion: app.getVersion() } })
```

Keep the library file **unchanged** in Vex so both apps agree on the format; send format changes
back to GCC's `src/shared/pcbb`, bump `PCBB_VERSION` only for incompatible changes.

## Privacy

Local only: no network, no screen or keystroke capture, no page content, no URLs, no paths beyond
file names. The owner can delete the folder at any time (or use "Clear the Black Box" in GCC).
In GCC's own backup only `blackbox.json` (the on/off switch and retention) is included; the events
are never part of a backup or a diagnostics file (diagnostics carry counts and the latest kinds).
