# Encrypted profile lock (T3-123)

Opt-in encryption at rest for the files that hold your personal data. Settings > Encrypted profile
lock (switch the options on, then "Encrypt my profile..."). Off for every existing profile until
switched on. Engine: `src/main/profile-crypt.js`. Owner-approved on 2026-10-17 with the design below.

## What it encrypts

- `vex-persist.json` and `vex-persist-volatile.json`, with their `.bak`, rolling `.gen1-3`, `.corrupt-*`
  and `.pre-split` / `.rolled-back` copies. These hold the notes, clips, clipboard history, browsing
  history, journal, ledger, bookmarks and every other `vex.*` value (the renderer mirrors its storage
  there).
- In `vex-storage/`: `tabs`, `groups`, `stacks`, `shortcuts`, `writeLikeMe`, `sync-records`,
  `sync-tombstones`, `sync-known-devices` (and their `.bak`). Not `theme`, `gui-style` or `settings`:
  other code reads those files directly.

## What it does not encrypt

- The pages' own cookies, logins and cache (Chromium).
- The secret files (passwords, authenticator, passkeys, tokens): Windows already encrypts those for your
  account.
- Settings backups made around updates (`backups/`, `settings-backups/`): these are plaintext copies. Vex
  makes no new one while the profile is encrypted, and Settings says how many are on disk. Delete them
  yourself if they matter.
- Small helper stores that have their own JsonStore (reminders, quiet hours, tab snapshots), Recall and
  knowledge-base indexes, downloads, extension storage.
- Old plaintext Windows may leave in free disk space after a file is replaced (the `.pc-bak` and snapshot
  copies are deleted, not wiped). BitLocker is the answer for that.
- While Vex is unlocked and running, the data key is in its memory.
- The Memory Saver switch is read from the settings file before the app is ready; while the profile is
  encrypted that early read finds nothing, so Memory Saver is not applied (a startup flag only).

## Keys

One random 256-bit data key encrypts the files (AES-256-GCM, file format `"VEXPC1\0\0" + iv + tag +
ciphertext`). It is stored twice in `profile-lock.json`, each copy wrapped (AES-256-GCM) by a key made with
scrypt (N=65536, r=8, p=1, bounded on read) from (a) the passphrase and (b) the recovery code. The recovery
code is 160 random bits, 8 groups of 4 characters, shown once and never stored. Either opens the profile.
Changing the passphrase or making a new recovery code re-wraps the key; no data file is rewritten.

## Never locked out

`enable()`: checks that the passphrase and the code both unwrap the key; takes a snapshot of every file in
`profile-lock-snapshot/` and verifies it by hash; writes a `migrating` header; per file: encrypts to a temp
file, decrypts that temp file and compares it with the original, copies the original to `<file>.pc-bak`,
renames the temp file over the file (atomic). Only when every file decrypts to its snapshot hash and a
second engine reading only the disk opens the profile with the passphrase and with the recovery code is
the header set to `encrypted` and the plaintext copies deleted. Any failure puts every file back.

A crash in the middle leaves a `migrating` header; the next start undoes it with no key (`recover()`),
from the `.pc-bak` copies or the snapshot. A header that cannot be read, or is missing while its `.bak` is
there, is an error box and exit, never a start as if the profile were plain.

Switching back (`disable()`): each file is decrypted to a temp file, compared, the encrypted bytes are kept
as `<file>.pc-enc`, the temp is renamed over the file; the header goes last. A failure restores the
encrypted files. Running it again after a crash finishes the job.

## Starting Vex

The settings file cannot be read before the passphrase is known, so Vex opens a small window of its own
(`src/main/profile-unlock.js`, `src/renderer/profile-unlock.html`) before anything else: passphrase, or the
recovery code. Five wrong tries cost 30 s, then 1 min, 2 min ... up to an hour (in that process; the cost
of one try, scrypt at 64 MB, is what limits someone who copied the folder). Choose a long passphrase.

## The way out without Vex

```
set VEX_PROFILE_PASSPHRASE=your passphrase        (or VEX_PROFILE_RECOVERY=your recovery code)
node scripts/profile-decrypt.js --profile "%APPDATA%\vex"
```

Close Vex first. `--status` prints the state. If the lock is `migrating` it undoes the encryption.

## Not verified live

The engine, the stores, the Settings channels and the unlock gate are tested against fixture profiles in
temp folders (interrupted migration, wrong passphrase, recovery-code unlock, corrupt file, corrupt header,
failure part way in both directions). The unlock window itself and the start order in `main.js` could not be
driven in Electron in this pass: try it on a copy of a profile first.
