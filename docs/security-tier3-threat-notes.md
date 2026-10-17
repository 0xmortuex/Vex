# Tier 3 security helpers: what was built, and what was not

All eight are opt-in (off in every tier, maturity "new"), local only, and use no new network path.

## T3-116 Guest session
Built: a private window (in-memory session, no history, saved passwords, autofill, sync, recall; extensions closed by the IPC policy) opened as `guest=true`, with a permanent "Guest session" label and a receipt (tabs, sites) before "Forget this session" closes it.
Not built: a new storage engine (the private window already keeps nothing); clearing the OS DNS cache or Windows records; erasing files the person downloads or saves; hiding the user from the network or the computer's owner; a guest *workspace* inside the main window (partition persistence inside a persisting window could not be verified).

## T3-120 Extension update diff and pause
Built: a read-only "what changed" view (powers, reach, hosts, version, plus the held-update words the updater already writes) against a stored baseline; "pause extensions on this site" using the existing `extensions:set-enabled`, remembering exactly what it paused so only those are restored; a quiet suggestion on bank/mail hosts.
Wave 6 (checked, not built): only the NAMED extensions are paused, never a global switch. Pausing one extension on one PAGE is not possible: Electron's session extensions API is four calls (get all, get one, load, remove) for a whole session and loadExtension takes no host or tab restriction, so a paused extension is off in every tab until it is put back (tests/main/electronExtensionsApi.test.js fails the day Electron adds such a control). The only way to keep an extension off one site without touching the others would be to open that site in a separate partition that does not load it, which would also separate the site's cookies and logins; that is a decision for the owner, not something done silently.
Not built: a file-level diff (Vex does not keep the old package); automatic pausing.

## T3-121 Paste-and-run tripwire
Built: a main-world shim (preload-webview.js) that reports clipboard writes made with no user activation; the window classifies shell one-liners and warns, offering "Clear" (only if the clipboard still holds exactly that text) or "Keep". Never blocks, never clears by itself, never stores the command.
Not built: catching ClickFix pages that copy inside the click on their fake "verify" button (indistinguishable from a docs Copy button; the owner copies PowerShell from docs, so those are deliberately untouched); blocking the write; reading the clipboard continuously.

## T3-122 Startup check
Built: read-only listing of Run/RunOnce keys (fixed `reg query` argument lists), both Startup folders (fs), and non-Microsoft scheduled-task names (`schtasks /query /fo csv /nh`), Vex's own entries marked, "new since last review" flagged.
Wave 5 added the unsigned flag: a button (never automatic) asks Windows for the signature of each program a registry value or Startup-folder entry points to (the same read-only Get-AuthenticodeSignature call the download check uses, path passed in an environment variable), bounded to 40 programs; Wave 6: a shortcut is resolved with Electron's read-only shell.readShortcutLink and a scheduled task's program is read from the Task To Run column of one more fixed-argument `schtasks /query /fo csv /v /nh`; the program they lead to is checked like the rest and the line says which way it was found. A COM handler, several actions, a shortcut to a folder or a web address, or anything unreadable is still reported as not checked, with the reason.
Not built: any write, removal or disable; service, WMI, IFEO or AppInit inspection; Microsoft tasks (counted only).

## T3-123 Secure lock options
Built: scrypt-hashed PIN or 8-128 character passphrase made in main (old PBKDF2 PINs still work); main-side wrong-try counting as before; lock on minimize (main event); a report of which secret files are encrypted by Windows and what is not; an explicit forgot-it reset on the lock screen (type ERASE SECURE DATA: erases the secret files, then drops the lock record, then restarts).
Threat model: this is a privacy screen enforced by main, not encryption. Secret files are protected by Windows DPAPI for the Windows account whether or not Vex is locked. It protects against someone briefly at an unlocked Vex window. It does NOT protect notes, history, bookmarks, tabs or site logins from anyone who can use the Windows account or read the profile folder, nor against malware running as the user. The reset lets someone at the keyboard get past the screen to browsing data (not to passwords), which is why it is off unless the owner enables the options.
Not built: whole-profile or whole-disk encryption; encrypting notes, clips or history; any custom cryptography; a recovery-code export; Windows Hello.

## T3-092 Appointment slot watcher
Built: public booking pages as ordinary page watches (>= 15 min, default 30), open-words and optional "nothing" words, one notification through the Attention gate plus a button that opens the page.
Not built: logins, cookies, clicking, filling, captcha, booking; the opening-time countdown and pre-opening the tab; any check of a site's terms (the owner decides per page).

## T3-105 Photo preparer
Built: pick one image, resize/crop/convert/shrink to a preset in a canvas (EXIF is dropped by redrawing, orientation applied), save as a new file through a save dialog. No network code.
Not built: PDF/document shrinking or image-to-PDF; face or compliance checks; expiry reminders; requirements-page checklists.

## T3-109 Form assistant
Built: reads the kind of each visible box (never values), proposes from the Form Fill profile, fills one box per click, https only, only empty boxes, only the same box, never submits or clicks, nothing sent anywhere.
Not built: passwords, cards, OTP, national IDs, IBANs (listed as "type it yourself", never stored); fill-all; submitting; any AI use of form content; a TC-number store.
