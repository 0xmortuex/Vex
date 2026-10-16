# Game Control Center to Vex bridge (contract, version 1)

Game Control Center (GCC) tells Vex what it is doing by writing ONE small JSON
file. Vex only reads it. Vex never writes to GCC's folder and never starts GCC
from this feature. GCC needs no change to Vex; it only has to write this file.

Vex side: `src/main/gcc-bridge.js` (parser and validator), `src/renderer/js/gcc-bridge.js`
(follows it). It is off until the person turns on Settings, "Game Control Center link".

## Where

`%APPDATA%\game-control-center\vex-bridge.json`

Vex reads exactly this path. The window cannot name another one.

## How to write it

Write a temporary file beside it, then rename it over the real one (atomic), at
most once a second, and whenever something below changes. Maximum size 64 KB.

## Shape

```json
{
  "version": 1,
  "updatedAt": "2026-10-16T18:03:11Z",
  "game": { "name": "Marvel Rivals", "exe": "Marvel-Win64-Shipping.exe", "running": true },
  "profile": "Competitive",
  "streamer": false,
  "capture": false,
  "clipsDir": "C:\\Users\\me\\Videos\\GCC",
  "recentClips": [
    { "file": "clip1.mp4", "game": "Marvel Rivals", "session": "ranked night", "at": "2026-10-16T18:20:00Z" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `version` | Must be `1`. Any other value is shown to the person as an error, not guessed at. |
| `updatedAt` | ISO time of this write. A file older than 2 minutes means "GCC is not running": `game.running`, `streamer` and `capture` are then treated as false, so a crash can never leave Game mode on. |
| `game` | The game GCC is handling, or `null`. `running` true starts Game mode (subject to the person's own Game mode answer: on, ask or off). `exe` is the program name. |
| `profile` | GCC's active profile name, shown in Settings and offered to Focus profiles as the game. Optional. |
| `streamer` | GCC says the screen is being shared. Vex turns Streamer mode on, and puts it back to what it was when this becomes false. Optional. |
| `capture` | GCC is recording. Shown only. Optional. |
| `clipsDir` | Absolute path of the folder GCC saves clips in. It appears in the clips inbox as "Game Control Center", read-only. Optional. |
| `recentClips` | Up to 50 entries, newest last, describing clips in `clipsDir`. `file` is a name, not a path. The game and session are shown under the clip. Optional. |

A missing file is normal (GCC not installed or not running). A file that is
present but invalid is reported to the person with the reason and is not "fixed".
