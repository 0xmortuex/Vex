# Page automations

Record a job on a website once, then have Vex repeat it: when you ask, from Ctrl+K, or on a schedule ("check my grades every morning", "download this week's report", "copy the price from this page into a note").

It is off until you switch it on in Settings > Page automations. It is a different feature from the page watcher (which only notices that a page changed) and from the older single-page recorder in page actions (which replays inside the tab that is open).

## How to use it

1. Open the site in a tab and press Ctrl+K, then choose **Record an automation on this page** (or use **Record on the current tab** in Settings > Page automations).
2. Name it, then do the job once. A recorder bar shows the steps as they are written. It has Pause, Read a value (click a value on the page), Add wait, Add pause, **Stop and review** and Cancel.
3. In the review window, rename, reorder or delete steps, set a step to *Run* or *Ask first*, choose how it runs (hidden or visible window), a schedule, whether a missed run happens once on wake or is skipped, and where results go (the Inbox, and optionally a note).
4. Run it with **Run now**, from Ctrl+K (**Run automation: name**), or let the schedule do it.

## What it will never do

- **Secrets.** A password, one-time code, card number, or any field a password manager or the browser filled is never recorded, typed, or read. That step becomes *ask me*: the run opens the page in a window and waits for you to fill it in yourself. The test is by field type, autocomplete attribute, the field's name and label (English and Turkish), a password-manager attribute, and by how the value got there (a value nobody typed is treated as filled). A typed value that looks like a card number or a 6-8 digit code is dropped too.
- **Consequential steps.** A step that looks like submit, buy, pay, send, post, share, delete, cancel, transfer or confirm (button text, aria-label, title, `type=submit`, a POST form, a form or link going to a payment, order, delete or cancel address; Turkish too: Gonder, Satin al, Sil, Ode, Onayla...) always pauses with a prompt (and a notification when Vex is in the background) until you approve it. For payment, delete, transfer, send and confirm steps this cannot be switched off. Plain form submits and saves are asked by default and can be set to *Run*. The page is looked at again right before the click: a control that became consequential since the recording asks.
- **Guess.** A step finds its control by role and name, then text, then the label next to a field, then the recorded selector (only if the name still agrees), and last by a very close spelling of the name (never for a consequential step). If nothing matches, two things match, or the control is hidden or disabled, the run stops, says which step and why, keeps a screenshot, and offers **Fix this step**. It never clicks something else.
- **Get past a CAPTCHA.** If one appears the run stops and asks you.
- **Download or install files**, open pages on this computer or the home network, or run in a private, Tor, proxy-routed or non-container session.
- **Send anything anywhere.** There is no network call of its own. The only way a value leaves is the optional **AI summary** step, which you add yourself and which is always last.

## Limits

| Limit | Value |
| --- | --- |
| Steps in a recording | 60 |
| Pages (open steps) in a recording | 12 |
| Longest run (time spent waiting for you does not count) | 1 to 15 minutes, 5 by default |
| Runs per hour | 6 for each automation, 20 overall |
| Runs at once | 1 |
| Loops | none; each step runs at most once, in order |
| A prompt nobody answers | ends the run as *needs approval* after 15 minutes; nothing is done for that step |

A global **kill switch** (Settings > Page automations, Ctrl+K "Stop all automations") ends the run in progress, answers every open prompt "stop", removes the Windows wake-ups and holds everything until you press Re-arm. While a run is going an "Automation running" pill with a Stop button is shown.

Not handled: a click that submits a form from script, file choosers, pop-ups, and frames from other sites.

## Where things are kept

- Recordings, run logs and failure screenshots are one encrypted file, `automations.enc`, in your profile folder (Windows DPAPI, the same mechanism as saved passwords). It is not in localStorage and not in Vex Sync.
- The Inbox row for a run says what happened but never carries a value that was read (the Inbox list is kept in plain storage); open the run to see the values.
- **Export** writes a JSON file without any typed value, session, schedule or id. **Import** arrives switched off, in your main session, unscheduled, with every acting step set to ask.
- A schedule uses the same Windows Task Scheduler wake-up as reminders (one task per automation, named `auto-<id>`), so a run happens even when Vex is closed; if the PC was asleep, the missed run happens once on wake or is skipped, as you chose.

## For developers

Pure rules: `src/renderer/js/automations-model.js` (shared by main and the window). In-page finder and recorder: `src/renderer/js/automations-guest.js`. Runner: `src/main/automations-run.js`. Service (storage, schedule, prompts, kill switch): `src/main/automations.js`. Electron window and IPC: `src/main/automations-wire.js`. Interface: `src/renderer/js/page-automations.js`. Tests: `tests/main/automations*.test.js`.

`VEX_AUTOMATIONS_ALLOW_LOCAL=1` lets a run open pages on this computer. It exists only for the real-window checks against a local test site and is never set in normal use.
