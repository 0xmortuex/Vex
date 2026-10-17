# Meeting transcript from my voice

Part of the meeting copilot (Ctrl+K > Meeting Copilot). Opt-in: Settings > Meeting transcript. Owner-approved
2026-10-17 with these limits.

## What it does

While a meeting-notes session is running, "Listen to my voice" opens your MICROPHONE, cuts what you say into
pieces of up to 30 seconds, turns each piece into text on this PC with a speech program you installed, and files
the text in the session. When you end the meeting the transcript is part of the saved note (and the local model
reads it with your typed lines for the summary).

## What it will not do

- It never captures the call's sound, the other people or the screen: only the microphone.
- It never starts by itself. Every session asks in Vex's box, then in a box owned by the main process that shows
  the exact command that will run. A red bar at the top of Vex stays up the whole time the microphone is open.
- Nothing is uploaded. There is no network use in the pipeline.
- The audio is deleted as soon as it has been read, unless you tick "Keep the audio" (then it is kept in
  `<profile>/meeting-audio/<session>/`).
- It does not run while a game is running, and the work waits for a quiet moment (`VexJobs.heavy`, kind `audio`).
  A part the gate refuses, or an engine that cannot keep up, is counted and shown on the bar; it is not hidden.

## Setting it up (the engine is yours to install: BLOCKED-EXTERNAL)

1. Install whisper.cpp (a `whisper-cli.exe` build) and download a ggml model, for example `ggml-base.bin`.
2. Settings > Meeting transcript: switch it on, choose the program and the model in the file dialogs, set the
   language (`auto`, or a code such as `en` or `tr`).
3. For an engine that is a script run by an interpreter (for example `python.exe` with a wrapper), choose the
   interpreter as the program and the script as "Script it runs first". Paths and program names are only taken
   from these dialogs; a window can never name one.

Vex runs, for each piece, with no shell and an argument list:

    <program> [<script>] -m <model> -f <piece.wav> -l <language> -nt -np

and reads the text the program prints. One program runs at a time; a piece that takes more than 3 minutes is
stopped; the printed text is capped.

## Speech timer hook

When the speech timer (Ctrl+K > Speech timer) has a speaker up, each piece is labelled "during <name>'s turn",
and moving to the next speaker ends the current piece. The label says whose turn it was, not who spoke: only your
own microphone is heard.

## Tested with a fake engine

`tests/fixtures/fake-whisper.js` stands in for whisper.cpp (real child processes, real temp files): the argument
list, the consent boxes, deletion of the audio, keeping it, a failing engine, a hanging one, one that prints without
end, a deep queue. The real engine and a real microphone were not driven in this pass.
