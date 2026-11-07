# Graphics crashes and hardware acceleration

Chromium draws Vex's windows and pages with the graphics card ("hardware
acceleration"). When the graphics driver misbehaves, its GPU process crashes
over and over: the window flickers, freezes for a second, or goes black.

What Vex does (`src/main/gpu-ladder.js`):

1. Each GPU process crash that is a real crash (not Vex quitting, not Windows
   ending the session) is counted for the session.
2. The third one writes `gpu-fallback.json` in the profile folder. Nothing
   changes during that session: acceleration can only be switched off at start.
3. On the next start, before the app is ready, Vex calls
   `app.disableHardwareAcceleration()` and puts one line in the Attention Inbox.
4. `--safe-mode`, and the automatic safe mode after two failed starts, also start
   with acceleration off.
5. Settings › Tabs and navigation › Hardware acceleration turns it back on
   (setting `vex.gpuAccel`, read from `vex-persist.json` at start). "On" removes
   the flag file and keeps acceleration on; "Off" keeps it off by choice. It takes
   a restart.

## What you lose with acceleration off

- The glass look (`backdrop-filter` blur behind panels and the sidebar) is drawn
  by the processor. It still looks the same but scrolling and animations behind
  it are less smooth, most on large or high-refresh screens.
- Video decoding falls back to software: more processor use and battery drain,
  and a high-resolution stream may drop frames on a weak processor. Protected
  video (Widevine) still plays; it simply decodes in software.
- Page rendering (canvas, WebGL, games in a tab) is slower.

## What is not proven

The ladder logic and the "switch off before ready" call are tested; a real
failing graphics driver cannot be reproduced here, so the full path (three real
GPU crashes, restart, notice) has been simulated, not seen.
