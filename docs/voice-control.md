# Voice control (design note)

Owner-approved 2026-11-06. Say a Ctrl+K command or dictate into a field, in Turkish or English, with the speech recognised **on this
computer**. Nothing you say is sent anywhere.

## What it does

- **Command**: hold the key (default **Ctrl+Alt+Shift+V**), or press the toolbar microphone, or Ctrl+K > *Voice control*, and say what you
  want: "open downloads", "yeni sekme", "sekmeleri düzenle", "GitHub'u aç", "organize my tabs".
- **Dictate**: with the cursor in a text field, the same key dictates. The words appear in a box to correct and are typed into the field only
  when you press Insert (Ctrl+Enter). Never into a password, one-time-code or card field.
- Ctrl+Alt+V, the key first asked for, is already *Next project space*; every Ctrl+Alt letter is taken, so the default uses three modifiers (like
  *Search the web for the selection*). It is rebindable in Settings > Keyboard shortcuts.

## Engine: whisper.cpp, the plain command-line program

| Option | Verdict |
| --- | --- |
| Web Speech API (`webkitSpeechRecognition`) | **Rejected.** In Chromium it streams the audio to Google. |
| Cloud STT (OpenAI, Azure, Google, Deepgram) | **Rejected.** Sends audio away. |
| Windows speech recognition (SAPI / `System.Speech`) | Local, but needs an installed Turkish recognizer pack, poor on free-form speech, and dictation quality is far behind Whisper. |
| Vosk / Kaldi | Local and small, but Turkish models are weak and need a separate model per language. |
| transformers.js in the renderer (what *Dictate*, Ctrl+Alt+D, already does) | Works, but downloads from Hugging Face with **no checksum**, runs inside the renderer, and has no process boundary to kill. Left as it is. |
| **whisper.cpp `whisper-cli.exe` + a quantised multilingual ggml model** | **Chosen.** One 9 MB program, local, multilingual (Turkish and English in one model), checksummed files, a separate process that can be killed. |

Model sizes (all `q5_1`, multilingual, measured 2026-11-06 on this machine, CPU only, 4 threads, a 2-5 second clip):

| Model | Size | Time per short clip | English WER | Turkish WER (Windows TTS voice) |
| --- | --- | --- | --- | --- |
| Base | 59.7 MB | 1.2-1.9 s | 0.00 | 0.30 (slips such as "sikme" for "sekme") |
| Small | 190.1 MB | 4.3-5.1 s | 0.00 | 0.10 |

Base is the default (fast, and the command matcher forgives its Turkish slips); Small is clearly better for Turkish and for dictation. A
Tiny model was not offered: it is not usable for Turkish.

## Where the files come from (pinned, verified)

Both are downloaded only when the person presses *Download* in Settings > Voice control, after a box that names the size and the host. Each file
is checked against a SHA-256 written in `src/main/voice-model.js` **before** it is used; a wrong size or hash is deleted and the download fails
out loud. There is no fallback host. The final host after redirects must be in the file's pinned host list.

| File | URL | Size | SHA-256 |
| --- | --- | --- | --- |
| Engine | `https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip` | 8,928,640 | `6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb` |
| Base | `https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q5_1.bin` | 59,707,625 | `422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898` |
| Small | `https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small-q5_1.bin` | 190,085,487 | `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb` |

How the values were obtained: each file was downloaded and hashed locally. The engine's hash equals the `digest` GitHub publishes for the
release asset; the two model hashes equal Hugging Face's `X-Linked-ETag` (the LFS SHA-256) for that commit. The model URLs name a commit, not a
branch, so the bytes cannot change. To move to a newer engine or model: download it, hash it, update the three fields together.

Stored in `<profile>/voice/engine/` (only `whisper-cli.exe`, `whisper.dll`, `ggml*.dll` are taken out of the zip; the other 30 programs in it
are never written) and `<profile>/voice/models/`. *Delete voice model* removes all of it. The installer stays 143 MB.

## The process, the pipe and why no file

One utterance = one short-lived `whisper-cli.exe` child of the main process: argument list, no shell, no window, working directory = the engine
folder, environment = `SystemRoot` and `PATH` only (no proxy variables). It exits when it has printed the text. A 60-second watchdog kills it;
Cancel, switching the feature off and quitting kill it at once. There is no always-running engine, so "kill on idle" is the normal exit.

**The audio never touches the disk.** whisper-cli can only read a file name. Measured on b5454: `-f -` (stdin) prints nothing on Windows
(text-mode stdin corrupts the WAV), and `whisper-server` would open a network port. A **named pipe** works: the main process serves
`\\.\pipe\vex-voice-<128 random bits>`, passes that as `-f`, writes the WAV image into it once, and closes the pipe after the one connection. No
temp file, no log line holds speech (a unit test spies on every file-writing function and on `console`).

"No network from the engine": the program has no network code (it is the plain CLI, not the server) and gets no proxy settings. Windows does not
let a program remove a child's network without a firewall rule, which needs administrator rights; Vex does not claim to have one.

## Microphone safety

- Opened only while holding the key or after the button/command, and closed at the instant the recording ends. A red panel with a pulsing dot,
  level meter, Stop and Cancel (Esc) stays on screen; Windows shows its own microphone indicator.
- Ends by itself: 1 / 1.5 / 2.5 s of silence after speech (setting), 6 s if nobody speaks, hard maximum 30 s. The engine also refuses > 60 s.
- Audio is Float32 blocks in this window's memory until the end, then one 16-bit copy goes to the main process over IPC, and both are dropped.
- Only Vex's own window may use the microphone for this (`ipc-policy.js` UI-only, closed in private windows). Web pages keep their own per-site
  permission prompt, which this feature neither uses nor loosens.
- No wake word in this version.

## Matching and safety of commands (`js/voice-match.js`)

Words are folded (case, diacritics), Turkish endings after an apostrophe are cut ("GitHub'u"), filler and verbs are dropped (please, lütfen,
open, aç), and each command is known by its label, its other-language twin from the i18n table ("Organize My Tabs" ~ "Sekmelerimi düzenle"),
the words of its id, and the shortcut words the person made. Two words are the same when equal, share a stem of 4+ letters that is most of the
longer word (Turkish endings through `turkish-lemma.js`), or are one slip apart (5+ letters). Confidence = how much of the name was heard x
square root of the share of spoken words it explains.

- >= 0.85 and no near-tie: the words heard and the command are shown for **one second with Cancel (Esc)**, then it runs.
- 0.45 to 0.85, or a tie: "Did you mean" with up to three buttons; nothing runs by itself.
- Destructive or outward (delete, remove, clear, wipe, reset, forget, sign/log out, quit/exit, uninstall, empty, send, share, publish, post,
  buy, pay, order, subscribe, upload, close all/others; Turkish sil, temizle, kaldır, sıfırla, çıkış, gönder, paylaş, satın al, öde, tümünü
  kapat ...): **always** asks, even at full confidence. "Run" by click, or *Answer by voice* (one more listening round the person starts;
  "yes/evet/tamam" runs it, anything else does not).
- Risk is also read from the spoken words: "delete my bookmarks" never runs the harmless "Bookmarks" it happens to match.
- The voice's own commands are never candidates.
- There is no real "undo" for a command that already ran (opening a tab, toggling a panel); the one-second Cancel is the undo window.

## Honest limits

- Hold-to-talk release is seen only while Vex's own window has the focus. With a web page focused, the key arrives from the main process as a
  key-down only, so it behaves as a toggle that ends on a pause (or the key again).
- CPU only. Small takes about 5 seconds per short clip.
- Windows 64-bit only (the engine zip is `whisper-bin-x64`); the Visual C++ runtime is needed (present on any machine that runs Vex).
- Turkish quality of Base is mediocre; the matcher and the correction box exist because of that.
