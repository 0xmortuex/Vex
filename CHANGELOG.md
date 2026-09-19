# Changelog

## v2.32.49 (2026-09-20) — Search every chat, see what the AI remembers, peek at a source

### Changes
- **Search every chat.** A box above Recent chats searches the words in all of them at once, showing the line that matched. Chats belong to tabs, so a closed tab's chat was otherwise unreachable.
- **A line where the AI's memory of a chat begins.** Vex sends the last ten messages with a question, so anything above the line can't be referred to. An answer that seems to have forgotten something now has a visible reason.
- **Rest on a source an answer cites** and a small card shows that page's title and first words, so you can tell whether it's worth opening. Read once per address and kept for the session; a page that can't be read says so.

## v2.32.48 (2026-09-20) — An overlay window that floats over your game

### Changes
- **Open This Page as an Overlay** (Ctrl+K). The page you're on opens in a small window that floats over other apps — a guide, a map, a wiki or a chat beside a game.
  - It's a real page in your Vex session, so you stay signed in.
  - **Esc** closes it, **Ctrl+Up / Ctrl+Down** make it more or less see-through, **Ctrl+P** stops it floating. Those keys are handled before the page sees them, so a page that swallows keystrokes can't trap you in a window with no buttons of its own.
  - How see-through you left it is remembered for next time.
  - A game in exclusive fullscreen draws over everything, this included; it's for borderless windowed.
  - Checked live: the overlay opened in Vex's session, floating and see-through, and closed again.

## v2.32.47 (2026-09-20) — Your pull requests, issues and CI in the GitHub panel

### Changes
- **The GitHub panel shows your open pull requests and issues**, across every repository, newest first. Click one to open it.
- **A CI light on your repositories.** The five you changed most recently show how their last GitHub Actions run went: green passed, red failed, amber running.
- It reads only public data (Vex has no GitHub sign-in), so notifications and private repositories aren't shown. Everything is fetched at most every five minutes, to stay within GitHub's limit for unsigned requests. A username GitHub doesn't know, or GitHub asking to slow down, is said in the panel.
- Checked live with your account: four repositories with CI lights (Vex's own showing its run in progress) and your open pull requests.

## v2.32.46 (2026-09-20) — Lock Vex with a PIN, and a Stable update channel

### Changes
- **Lock Vex.** Set a PIN in Settings › Privacy & Security › Lock Vex, then lock it three ways:
  - Ctrl+Alt+L, which works inside a page too,
  - Ctrl+K › *Lock Vex*,
  - or automatically after 5, 15, 30 or 60 minutes with no keyboard or mouse input on the computer.

  How it behaves:
  - A PIN screen covers the whole window, and every page and panel underneath is hidden, not just blurred.
  - A wrong PIN is refused, and after five in a row it waits 30 seconds.
  - The PIN is kept only as a salted hash.
  - It's a privacy screen, not encryption: your profile on disk isn't locked.
  - Checked live in the Firefox look: Ctrl+Alt+L from inside a page, then the PIN to unlock.
- **Update channels.** Under *Check for Updates*, choose **Latest** (every release, as before) or **Stable**. Stable only tells you about an update once the newest release has been out two days, so a day of several releases is one prompt instead of several.

## v2.32.45 (2026-09-20) — Discord pictures load again, and YouTube sponsor skipping

### Fixes
- **Discord showed "Image failed to load" for posted GIFs and link previews.** "Lighter Discord" (v2.32.36) blocked every GIF and every link-preview picture, including ones people posted, which looked like Discord was broken. It now stops only the decorations from moving (avatars, emoji, stickers, server icons and banners), and anything someone posts or links always loads.

### Changes
- **Sponsor segments on YouTube are skipped**, using SponsorBlock's community data. When playback reaches a sponsor read, self-promotion or "like and subscribe" part, the video jumps past it and says so for a moment in the corner.
  - Only the video's id is sent.
  - Turn it off in Settings › Privacy & Security.
  - Checked live: seeking into a video's marked sponsor part jumped to its end.

## v2.32.44 (2026-09-19) — Switch to an open tab, and notes on tabs

### Changes
- **Already open? Switch to it.** When a page you type in the address bar is already open, its suggestion now reads *Switch to tab*. Choosing it goes to that tab, closing the blank new tab you typed in, instead of opening the page a second time.
- **A note on a tab.** Right-click a tab › *Add a note to this tab…* ("waiting on a reply").
  - It shows as a small mark on the tab with the note on hover, or under the title with tabs down the side.
  - It stays with the tab across restarts.
  - Checked live in the Firefox look, restart included.

## v2.32.43 (2026-09-19) — Research with highlights and references

### Changes
- **Highlights in research projects.** Select a passage on a page, then Ctrl+K › *Add the Selected Text to Project*. It's kept with the page it came from and what the page says about itself: authors, date, site and DOI, where the page publishes them. Pages added to a project now keep those details too.
- **Save with references.** A project saves as a document with:
  - the highlights as quotes,
  - the pages, notes and conversations,
  - and a numbered **References** list in APA, MLA, Harvard or Chicago.

  Each highlight and page is marked with its reference number, and a highlight shares one entry with the page it came from.

### Fixes
- MLA and Chicago citations doubled the full stop after an author whose name ends in an initial ("Smith, Jane Q..").

### Not done, and why
- **Picture-in-picture for any part of a page, with the site's own subtitles**, was built and tested, then taken out:
  - The version of Electron Vex runs on closes that kind of floating window the moment it opens.
  - YouTube's own player refuses to open in a small window of its own (errors 153 and 152).

  Ordinary picture-in-picture still works, without the site's subtitles.

## v2.32.42 (2026-09-19) — Your calendars in Vex, and recording a tab or a GIF

### Changes
- **Your Google, Outlook or Apple calendar, read-only.** In the Calendar (Ctrl+K › Calendar), *Add a calendar* and paste its iCal address. In Google Calendar that's Settings › your calendar › *Secret address in iCal format*. Its events show:
  - in the month and day views,
  - and in Today on the new tab page,
  - and in the morning brief.

  More detail:
  - Repeating events are expanded (daily, weekly on set days, monthly, yearly, with their end dates and skipped days), and so are moved occurrences.
  - Times in other time zones are converted, including across clock changes.
  - Rules Vex can't expand yet are shown once and noted in Memory › Health, not guessed.
  - It refreshes every 30 minutes. A calendar that can't be read says why, in the Calendar and in Today.
  - The address works like a password, so it's kept out of health reports.
  - Checked live with Google's public US holidays calendar.
- **Record This Tab** and **Record an Area** (Ctrl+K). They record just the page in front, or a box you drag over the window, with no picker, as a video. Checked live: the recording is cropped exactly to the tab.
- **Record a GIF** (Ctrl+K): drag a box, record up to 30 seconds, and it's saved as an animated GIF for a chat or an issue. Checked live: Chromium opens the GIF it makes, and the writer is tested against an independent decoder.

## v2.32.41 (2026-09-19) — A morning brief, pages as Markdown or e-books, text out of screenshots

### Changes
- **Your morning brief.** Ctrl+K › *Write my morning brief* turns today's reminders, scheduled tasks, changed pages, saved links and the last day's feed headlines into one short paragraph. It sits at the top of Today on the new tab page until the day ends.
  - The AI is asked only then, never on its own, so opening a new tab never loads a model.
  - It's told to use only those facts. On a day with nothing in them, it says so instead of asking the AI.
- **Save Page as Markdown** and **Save Page as an E-book** (.epub), in Ctrl+K. Both keep the article itself, not the menus, headers, footers, sidebars and forms around it.
  - Links stay links and tables stay tables.
  - The e-book says where it came from and when, and turns pictures into their descriptions, since an e-reader can't fetch them.
  - Checked live on a long Wikipedia article. The e-book file was checked with a separate zip reader, every part intact.
- **Copy text** on a screenshot reads the words in the picture and copies them. It runs on your computer (the first time downloads the reading engine). Checked live: "Invoice 4471 due Friday / Total: 312.50 EUR" read back exactly, in about a second.

## v2.32.40 (2026-09-19) — A clean window for sharing, split layouts saved, links one at a time

### Changes
- **Share this page in a clean window** (Ctrl+K). A private window with only that page in it:
  - no bookmarks bar, no sidebar of panels, no other tabs,
  - and streamer mode always on.

  For sharing your screen or recording without your own browser in the picture. It's private, so the page is signed out. Checked live in the Firefox look.
- **Split screen is saved with a workspace snapshot, and comes back.** Which tabs were side by side, in what order, and where the divider was. The snapshot list says "split 2 ways". Checked live: a 35/65 split saved, everything closed, restored as it was.
- **Read your saved links one at a time.** Ctrl+K › *Next from Read Later* (or *Read them one at a time* in the Library) opens the oldest unread link in the tab you're on, and says how many are left. Links saved from a page's right-click menu now keep their link text as a title.

### Fixes
- **Split screen showed the wrong address over the left pane.** Both small address bars sat on top of each other over the left half, so the left pane showed the right pane's address, and they ignored the divider. Each now sits over its own pane, including while you drag the divider.
- **Switching tabs while the address bar had the caret** (a new tab puts it there) left the bar blank over the page you switched to. It now shows that page's address.
- **Private windows opened in the Classic look**, whatever look you use. They now take the look of the window they're opened from.
- **Private windows showed the first-run setup wizard** every time. They no longer do.
- Saving a link to Read Later from the right-click menu showed two notices, and hid any failure. It shows one, and a failure is reported.

## v2.32.39 (2026-09-19) — Settings by asking, GitHub build alerts, and more from the agent

### Changes
- **Change a setting by asking.** In Ctrl+K, or ask the agent: *turn off mouse gestures*, *turn on streamer mode*, *set the search engine to DuckDuckGo*.
  - Vex finds the switch or dropdown in Settings by the words next to it, shows exactly what will change, and changes it only when you say yes.
  - It uses the setting's own control, so it's saved the way it always is.
  - Words that could mean two settings are named back to you instead of guessed. The agent's Undo puts a changed setting back.
  - Checked live in the Firefox look: typed in Ctrl+K, confirmed, and the setting changed.
- **"Tell me when this build finishes."** On a GitHub Actions run, Ctrl+K › *Tell me when this GitHub run finishes*, or type *tell me when it finishes*, or ask the agent. Vex asks GitHub every two minutes and puts a desktop notification up when the run passes or fails, then stops watching.
  - On a repository or its releases page, it tells you when there's a new release (checked every 30 minutes).
  - They're listed with your watched pages. Public repositories only, since Vex has no GitHub sign-in.
  - Checked live against GitHub: v2.32.38's CI run came back as "Verify Vex passed".
- **Downloads say they're done on the desktop** when Vex isn't the window in front, finished or failed.
- **An agent answer can become a calendar entry or an email.** Under the answer:
  - **Add to calendar** asks when ("tomorrow 3pm") and saves an .ics with the answer inside.
  - **Email draft** opens your own mail app with the answer as a new message, and you choose who it goes to. A very long answer is shortened to fit, and says so.
- **Compare all models** in Settings › AI runs the agent test on every installed model in turn and ranks them by turns passed, then speed.
  - Each model is unloaded after its test, so the graphics card isn't left holding them all.
  - It won't start while a game is running.
- **Timestamps in answers about a YouTube video are buttons**: press [2:05] and the video jumps there. On a video, the chat reads the video's captions in place of the page around the player, when YouTube hands them over.

### Known problem
- **YouTube now refuses captions to anything but its own player for many videos.** Tested this session, on several videos:
  - the caption download came back empty,
  - the transcript service answered "precondition check failed",
  - and its own transcript panel never loaded.

  So reading a video (the chat, and the agent's "read this video") falls back to the page text for most videos, and the error now says why. Another way in is being looked at.

## v2.32.38 (2026-09-19) — Sturdier: notes on disk, crash history, a way back from a bad update

### Changes
- **Notes, AI chats, history, agent runs, the clipboard, annotations and Read later are kept on disk, not in browser storage.** Browser storage is capped at about 5 MB, and those are the stores that grow without limit, so they were the ones that would fill it. Existing copies are moved out when Vex starts. Checked live: a note written, Vex restarted, and the note came back from disk and showed in the Notes panel.
  - Any other value that stops fitting is now read back as written. Before, a full store saved it to disk but went on reading the old copy until the next restart.
  - **A warning at 80% full**, once a day, pointing at Memory › Health, which names what fills it.
- **One timer for background work.** Twelve periodic jobs (badges, the Today card, counters in Settings, local-AI status, tab-group suggestions, page watches, tabs sent from your phone, snapshots and others) now share one timer.
  - Jobs that only matter on screen wait while Vex is minimised or a game is running.
  - Jobs that notify you, like page watches, wait only during a game.
  - Anything held runs once as soon as you're back. Health shows how many runs were held.
- **Startup, part by part**, in Memory › Health:
  - reading saved data,
  - restoring tabs,
  - the rest of the interface,
  - each extension that took a quarter of a second or more. Extensions load alongside the window, so they don't hold up the first page.
- **Crashes from earlier launches** are listed in Health too, with when they happened and under which version, for the last week. They're kept in a small file in your profile. Nothing is sent anywhere.
- **Save report…** in Memory › Processes writes processes, health and your settings to a text file for a bug report. Long values show only their size, and anything that could be personal (tokens, passwords, accounts, mail, sync) is left out by name.
- **Going back after a bad update.** If a new version fails to start twice, safe mode now says which update it began with, and offers **Go back to <version>**. That downloads the previous installer and pauses updates for a day, so the old version doesn't offer the broken one straight back.
- **Settings from before each update**, the last five, are listed in Settings › Data with a Restore button each. Before, they could only be restored from inside safe mode.
- **Start in safe mode** is on the taskbar: right-click Vex. If Vex is already running, it restarts into safe mode. (Holding Shift at launch, as first planned, would have meant a slow check on every start.)

### Fixes
- "Restart normally" after starting in safe mode from the command line restarted into safe mode again.

## v2.32.37 (2026-09-19) — Streamer mode only when you share, and a steadier agent

### Fixes
- **Streamer mode no longer turns on during a call.** Set to turn on by itself, it now does that only while you share your screen: in Discord (panel or tab), in a site's screen share, or while Vex records the screen. Joining a voice or video call, or turning the mic or camera on, leaves it alone. When the share stops, it turns back off. The setting now reads *While you share your screen (not during calls)*.

### Changes
- **A saved agent task that hits a changed page carries on.** Before, one step failing (a button that moved, a page that changed) stopped the whole macro. Now the agent picks the task up from there by itself, told what was done and what failed. It still stops if you pressed Stop or refused a step.
- **"Tell me when this changes" in plain words.** Ask the agent, or type in Ctrl+K: *tell me when the price drops under 300*, *watch this page for changes*, *tell me when it goes above 50*. It sets up a page watch on the tab you're on. The agent's Undo removes it.
- **What each agent step cost.** After each model call, the agent shows how long it took and, when the model reports it, how many tokens it used. "Agent finished" gives the total.
- **"Always on github.com".** When the agent asks before acting on a site you didn't name, there's now an *Always on <site>* button. That site is remembered for later runs. The list, with a Remove button for each, is in Settings › AI, under the agent settings.

## v2.32.36 (2026-09-19) — Discord that uses far less memory

### Notes
Everything asked for, from the list of ways to shrink Discord (it measured about 1.07 GB on your machine). All of it is in Settings › Performance:
- **Open Discord as a tab** (new choice: *panel* or *tab*). As a tab, Discord only runs while the tab is open, and uses nothing once it's closed.
  - The sidebar's Discord button stays: it opens the Discord tab, or switches to it if it's already open, so you never get two.
  - It uses the same session as the panel, so your login, your Vencord build and the Discord connection bypass all come with it.
  - The Discord hotkeys and the call badge follow the tab.
  - The cost: with the tab closed there are no Discord notifications, and closing it ends a call.
- **Discord goes to sleep when idle.** Hidden, and not in a call, for 15 minutes (or 30, 60, never), the panel sleeps and frees all its memory. It wakes when you open it. It's never put to sleep during a call, with the mic or camera on, or while it plays sound. While asleep there are no Discord notifications.
- **Refreshed sooner.** The "refresh Discord when it grows past" limit is now **1 GB**, down from 1.5 GB. A limit left at the old default was moved down once; choose any other value and it's kept.
- **Lighter Discord** (on): animated avatars, emoji and stickers, posted GIFs, the GIF picker's previews and the pictures in link previews are simply not fetched, while still avatars, emoji and posted pictures appear as normal. Checked live in a Discord tab: a GIF and an animated emoji were refused before any request went out, and a still emoji loaded.
- **Caches cleared when hidden.** 20 seconds after you hide Discord, its in-memory images and fonts are released, and they're decoded again when you look.
- **Turn off the heaviest Vencord plugins**, one button: MessageLoggerEnhanced, MessageLogger, ShowHiddenChannels, PlatformIndicators and WhoReacted, the biggest memory users in the plugin review. It uses Vencord's own settings, then reloads Discord. Nothing changes until you press it.
- **In Discord's own settings**, which Vex can't change for you, the section lists what helps:
  - Reduced motion, and no autoplaying GIFs, animated emoji or stickers,
  - no link or image previews,
  - and leaving large servers you don't read.

## v2.32.35 (2026-09-19) — Llama only when you ask, and gaming, Discord, streaming

### Changes
- **History indexing is now off by default, and switched off once on existing profiles.** It summarizes every page you visit so AI history search can find pages by meaning, and it does that with the local AI model. That's why llama kept loading while you browsed, including while you played, because game mode only notices *fullscreen* games and Roblox in a window doesn't count.
  - Now the model only runs when you ask the AI something.
  - AI history search still finds pages by their title and address.
  - To have summaries again, turn **AI History Indexing** on in Settings › AI. After this one-time switch-off, turning it on is kept.

### Notes
Four more ideas from the list, finished:
- **Gaming, panels too.** When a game starts, hidden panels now sleep along with background tabs. It's the same rule as "Free memory now": never a panel kept awake in Settings, playing sound, or on a call.
- **Gaming, tabs come back.** When the game ends, the tabs it put to sleep wake up one at a time, rather than all at once or only when you next click them. There's a switch for this in Settings › Gaming.
- **Gaming, Vex stays still.** While the game has the screen, Vex stops its own animations. Windows already slows a window a fullscreen game covers; this stops the rest. There's a switch for this too.
- **Your Discord call, on the Discord icon.** Without opening the panel, a small badge on the Discord icon shows you're in a call:
  - green while your microphone is live, red when muted or deafened,
  - a screen icon while you're sharing,
  - hover it for the words ("In a Discord call: muted, sharing your screen").
  - It reads Discord's own Mute, Deafen and Stop Streaming buttons. Mute and Deafen are the same buttons the Discord hotkeys already use. Sharing couldn't be tested without your Discord account.
- **Streamer mode, the gaps closed:**
  - an email address in a **tab title** (e.g. "Inbox – you@gmail.com") is blurred while streamer mode is on,
  - so are the addresses in **Mail** and "Signed in as" in Sync, and Vex's **form-fill** menu,
  - there's a **hotkey** to turn streamer mode on or off from inside a game (Settings › Hotkeys, off until you set it).
- Checked in the Firefox look: a Gmail-style tab title was blurred in the tab strip, and the gaming switches showed.

## v2.32.34 (2026-09-19) — Safer links, downloads and permissions

### Fixes
- **"Allow this visit" on a site's permission prompt didn't work** (since v2.31.95). The button sends "for this visit", and the safety check on the interface's calls expected only yes or no, so it refused the answer. The site's request then hung until it timed out and was denied, and only "Always allow" worked. Fixed and checked live: a page asked for the microphone, "Allow this visit" was clicked, and the page saw it granted.

### Notes
Four more ideas from the list, finished:
- **Allow for a day.** Site permission prompts now also offer **Allow for a day**. After 24 hours the site asks again. It shows in Settings › Site Permissions like any other answer and can be removed there.
- **Which sites used your microphone and camera.** Settings › Site Permissions has a **Recently used** list under "In use right now": for example, "meet.example.com: now; 2 times today, last at 20:02". It keeps 30 days, takes nothing from private or Tor tabs, and **Clear this history** empties it.
- **Where does this link go?** Right-click a link. Shortened links (bit.ly, t.co…) and redirects are followed to where they really end up:
  - It asks from an empty session with no cookies or logins, so the site learns nothing about you.
  - It shows the real address without its tracking tags, warns about lookalike domains and unencrypted pages, and offers **Open it** or **Copy the real address**.
  - It's not offered in private or Tor tabs, where following the link would contact the site from your real connection.
- **Check a download on VirusTotal.** The "Run this program?" prompt now has **Check on VirusTotal**. It opens VirusTotal's report for the file by its fingerprint (SHA-256), which shows what dozens of scanners said. The file itself is never uploaded.
- Checked live in the Firefox look: a short link that redirects twice showed its real destination, the Recently used list filled in after a tab used the microphone, and the prompt showed all four choices.

## v2.32.33 (2026-09-19) — More from the AI chat

### Notes
Five ideas from the list that were half there, finished:
- **Save any answer as a note.** Every answer has a **Save as note** button beside Copy, including comparison tables. The note is titled with the question that produced it.
- **Where to go next.** Under the latest answer:
  - **Dig deeper** asks for more detail, examples and caveats.
  - **Open the sources** opens the links the answer cited (up to five), in background tabs.
- **Pin, rename, and keep chats.** In the chat list (the clock button):
  - **Pin** keeps a chat at the top.
  - **Rename** gives it your own name.
  - **To note** saves the whole conversation as one note.
- **Paste or drop a picture into the AI box.** It's attached (shown above the box, with × to remove it) and goes with your question. Press Enter on its own for "What is in this image?". It uses the same route as right-click › Ask Vex about this image, so it needs a model that can see images.
- **Debug**, in the bar that appears when you select text: for an error message. It says what the error means, the likely cause, and the fix, as code when it's code.
- Checked in the Firefox look: the table answer with its buttons and chips, and a picture pasted into the box.

## v2.32.32 (2026-09-19) — Fixes you reported, in the Firefox look

### Fixes
- **"What's new" never appeared after an update**, and hadn't since 7 September. After updating, Vex asks for the running version's release notes by leaving the version out. A safety check added that day to everything the interface asks of the main program required the version to be given, so it refused the request. The refusal was then swallowed, and the popup silently didn't show. Opening "What's new" by hand still worked, which is why nobody noticed.
  - The version may now be left out, and a failure to read the notes is now recorded in Health, not silently dropped.
  - A new test checks **every** call from the interface against what the main program accepts. It found this one, and no others.
  - Reproduced before fixing: set the last-seen version to 2.31.97 and ran the startup code. Nothing showed; now it does.
- **Ctrl+K did nothing until you clicked the command-bar button.** Most of the time the focus is inside a page (the New Tab page is one too), and pages never passed Ctrl+K up to Vex.
  - It now opens the command bar from inside any page.
  - The exceptions are Discord and Slack, whose own Ctrl+K is their switcher. The button still opens Vex's there.
  - Tested by pressing it inside the New Tab page, in the Firefox look.
- **Starting or stopping a timer took 2–3 seconds.** The timer waited for Windows to register its wake-up task, which means starting PowerShell, before it appeared or disappeared.
  - It now shows and goes at once, and Windows is told afterwards.
  - A timer stopped while its registration was still in flight has the late wake-up removed, so it can't ring later.
- **The Work panel couldn't be scrolled** in the Firefox look, and the Clock panel had the same hidden bug. Opening a panel forced its layout to a plain block. That broke the two panels that lay themselves out as a column with their own scrolling area, and their content ran off the bottom. Panels now keep their own layout. Tested in the Firefox look and the default look: Work scrolls in both.
- **The Firefox look had no button to close and reopen the sidebar.** It now has Firefox's own **Sidebar** button in the toolbar, and **Ctrl+B** does the same:
  - it hides the whole sidebar (icon rail and any open panel) and brings it back,
  - the button is highlighted while the sidebar is shown,
  - the choice is remembered.
- **Ctrl+Alt+D inside a web page**, which v2.32.30 couldn't test, is now checked: it starts dictation from inside a page.

### Also finished (from the list of ideas)
- **"Local AI will be slow" now offers a way out.** The warning, which now also appears in chat and not only for the agent, has buttons:
  - **Use ‹a smaller model› instead**: the largest model you have installed that fits in the graphics memory that's free.
  - **Use the cloud**, when an AI Worker is set up.
  - The next answer uses the one you choose.
- **To-dos with a date can remind you.** A bell beside a dated to-do sets a reminder for 9:00 on its day (or the next hour, if that's today and 9:00 has gone), and the bell shows it's set.

## v2.32.31 (2026-09-19) — Mail (read-only)

### Notes
- **Mail** (`Ctrl+K`). The newest 50 messages from Gmail, Yahoo, iCloud or any IMAP account, with the unread count, and each message as text, in a two-pane window.
- **Read-only, on purpose.** The mailbox is opened read-only, and messages are fetched without touching their flags. Reading in Vex never marks mail read, moves it, or changes anything on the server. To answer, **Reply in Gmail** opens that exact message in the webmail. Yahoo and iCloud open their inbox.
- **Nothing reports that you opened it.** Messages are shown as text, so pictures and other remote content are never loaded, and a tracking pixel gets no request. HTML-only mail is turned into its words by the browser's parser, where no script can run. Links open in a new tab. Attachments are listed by name and size, to download from the webmail.
- **Signing in:**
  - It uses an **app password**, the kind Gmail, Yahoo and iCloud issue for mail programs, not your main password. The window says where each provider hides it.
  - Vex signs in once to check the password before keeping it. The addresses and passwords are kept in one file, **encrypted by Windows**, and a password is never shown again.
  - Other providers: enter the IMAP server. On port 993 the connection is encrypted from the start. On any other port, Vex insists on switching to encryption (STARTTLS) before sending the password. The only exception is a program on this computer, such as ProtonMail Bridge.
- **An honest limit:** **Outlook.com and Hotmail can't be read here.** Microsoft no longer lets mail programs sign in with a password and requires its own sign-in flow. Vex says so up front instead of failing at sign-in.
- **Tested live against a local test mail server:**
  - A wrong password was refused with the reason, and the right one signed in.
  - An HTML message with a tracking pixel was shown as text, and the pixel's server got **0 requests**.
  - The unread message was **still unread** on the server afterwards.
  - The saved accounts file is encrypted, with no password in plain text.
- Found in that test and fixed before release: the mail library's own text version of HTML mail listed every picture's address, the tracking pixel included, as a clickable link. Vex now makes the text itself, without them.

## v2.32.30 (2026-09-19) — Dictation

### Notes
- **Dictate** (**Ctrl+Alt+D**, or Ctrl+K › Dictate). Put the cursor in any text box, in a web page or in Vex, press Ctrl+Alt+D, speak, and press it again (or **Stop**). The words are typed where the cursor was. **Esc**, or the ×, throws the recording away.
- **Runs on this PC.** Electron has no speech recognition of its own; Chrome's sends your voice to Google. So Vex runs OpenAI's Whisper itself:
  - The model is downloaded once from Hugging Face, **only after you say yes**: Base is 73 MB; Small is 238 MB, slower but clearly better, especially for languages other than English.
  - After that it works offline, and nothing you say leaves the computer.
  - It records while the model downloads the first time, so you can start speaking straight away.
- **Kind to games and memory:**
  - It runs on the graphics card normally, but **on the processor while a game is running** (Vex's game detection), so it never costs a game frames.
  - The model is released from memory two minutes after you last dictated.
- **Dictation Settings** (Ctrl+K): the model, the language you speak (or let Whisper detect it), and **Remove downloaded models**.
- Vex's own window may now use the microphone without a prompt, and **only** the microphone, never the camera; that is what dictation uses. Web pages still ask, as before.
- **Tested live:** in a page's text box, a spoken sentence came out as *"Remind me to call the dentist tomorrow morning at 9."* That was on the processor, since a game was running on the test machine, and took about 6 seconds for 4 seconds of speech; the graphics card is faster. The in-page **Ctrl+Alt+D** key is covered by tests, but it couldn't be pressed for real in the automated test without typing into whatever window had focus, so try that first.

## v2.32.29 (2026-09-19) — Do it again

### Notes
You asked to be able to repeat actions you took before, in the Clock and elsewhere. Four places now remember:
- **Clock: timers.** Every timer you start is remembered by length and label (the last 8, no duplicates). Under the presets, **Again** chips such as "3:00 · Tea" or "25:00 · Focus" start one again in a click.
- **Clock: alarms.** Every alarm you set is remembered: time, days and label. Once it's no longer set (a one-off that rang, or one you removed), it appears under **Set again**, with the same days.
- **Reminders.** *Remind me* has a **Remind me again** list of past reminders. It includes those you set there and any that fired in the last week, however they were made (Calendar, the AI). **Again** fills in the text, the page it was about, the repeat and urgency, and puts you in the *When?* box, since the time is the one thing that changes.
- **Ctrl+K: Do That Again.** Re-runs the last command you used, and its hint says which one ("Again: Check This Page's Links"). It's also on **Ctrl+Alt+A**, rebindable in Settings. Like Vex's other Ctrl+Alt shortcuts, it works while the Vex window has focus, not while you're typing inside a web page; web pages keep their own keys.
- **Page checks.** The link check, speed check, accessibility check and site crawl each keep their numbers per page:
  - The next check of the same page opens with **what changed**, for example *Broken 2 → 1 · Working 0 → 1*, or *The same as last time*.
  - Every report has **Run again**. For the speed check it reloads the page first, because its timings describe a page load.
  - **Recent Page Checks** (`Ctrl+K`) lists them, to run any again. It opens the page first if another one is showing.
  - Only the counts are kept, never the page or the report, and nothing at all from a private or Tor tab.
- Tested live: after one of two broken links on a test page was fixed, Run again reported *Broken 2 → 1 · Working 0 → 1*. A timer, an alarm (Tue/Thu 06:15) and a weekly reminder with a link each came back correctly.

## v2.32.28 (2026-09-19) — Watched pages show up where they should

### Fixes
- **"Watched pages that changed" was always empty**, both on the **Today** card of the new tab page and in the Friday **Weekly Review**. Both read the list from a module called `WebMonitor` that was never written; the real one is *Tell me when this changes* (`PageWatch`). Because the read was guarded, it failed silently. Their tests mocked the same missing module, so they passed. Both now read the real watches: Today shows those that changed in the last 24 hours, and the review those from the last week. Checked live with a watched page that changed an hour ago; it appears in both.
- **A new check stops this happening again:** a test now fails if any guarded read names a module that nothing in Vex declares. Run against the old code, it names exactly this bug, and it finds no others.

### Notes
- Price alerts already exist, so nothing new was built for them. *Tell me when this changes* can watch a number on a page and tell you when it goes **below** (or above) a figure. Together with Price History (v2.32.27), that covers "tell me when it's cheaper".

## v2.32.27 (2026-09-19) — Price history

### Notes
- **Price History** (`Ctrl+K`). Price trackers are services that crawl shops for you, and in return they see every product you look at. Vex does the part that needs no one else:
  - Shops publish their price for search engines (schema.org Product/Offer data, or `product:price` tags). When you open a product page, Vex notes that price on this computer, one point per day.
  - On that page later, Price History shows what it cost each time you looked, **the lowest you've seen** and the highest, with a small chart.
  - Every other product you've looked at is listed with how far it's gone up or down since you first saw it.
- **Careful with what it records:**
  - A price that isn't a clean number is skipped, never guessed.
  - Tracking tags (`utm_…`, `gclid`, …) are ignored, so one product is one line.
  - If a shop switches currency, a new line starts rather than mixing pounds and euros.
  - Private and Tor tabs are never read. The "Note prices" switch in the sheet turns it off, and **Forget all** deletes the history.
- **An honest limit:** it only knows prices of pages you opened, from today on. It doesn't check shops by itself, and a page that doesn't publish its price isn't recorded.
- Tested live on a local test shop: the price was noted with the newsletter tag stripped, and the same kind of page opened in a real private tab was refused and never recorded.

### Internal
- v2.32.26's CI run failed. Three Calendar tests used `Intl.Locale.getWeekInfo()`, which Vex's Chromium 148 has but the Node 22 that CI tests on doesn't: it has the older `weekInfo` property from before the standard renamed it. Calendar now reads either, and says so plainly if neither exists. The whole suite now also runs locally under Node 22 before each release, as CI does.

## v2.32.26 (2026-09-19) — Calendar

### Notes
- **Calendar** (`Ctrl+K`). Vex already held dated things in two separate lists, reminders and to-dos with a date (`@2026-10-03`, `@tomorrow`), and neither showed a month. Now one does:
  - Reminders appear on their day. A **repeating reminder shows on every day it will repeat**: daily, weekdays, weekly, or set days.
  - Dated to-dos from your notes appear on their day and can be ticked right there.
  - Click any future day to **add a reminder** on it. It goes through the same reminders system as everything else, so it notifies even if Vex is closed.
  - The week starts where your locale starts it: Sunday in the US, Monday in most of Europe.
- Alarms and timers stay on the clock, since a daily alarm in every square says nothing. Vex's own weekly-review reminder is left off too.
- **An honest limit:** this isn't linked to Google or Outlook, which would need your account there. Any timed reminder can still be saved to them as a calendar file, as before.

## v2.32.25 (2026-09-19) — Parcels

### Notes
- **Parcels** (`Ctrl+K`). Paste a tracking number and Vex says whose it is while you type: UPS, USPS, FedEx, DHL, Royal Mail, Canada Post, Australia Post or Amazon. International post from other countries goes to 17TRACK, which is labelled as an independent service.
- **Check digits are verified** where the format has one: UPS `1Z…` and the international postal format `AB123456789GB`. A random string isn't taken for a parcel.
- All-digit numbers are shared between carriers (a FedEx number looks like any twelve digits), so those say **"Probably FedEx"** and the carrier can be picked.
- Keep a labelled list of what you're waiting for ("New shoes", "Book from the UK"). **Track** opens the carrier's page, **Copy** copies the number, and the bin removes it once it's arrived.
- **An honest limit:** Vex doesn't fetch the status itself. Every carrier's tracking API needs a business account and key, and the paid services that combine them would see every parcel you get. So nothing is sent anywhere until you press Track, and the status is on the carrier's own page.

## v2.32.24 (2026-09-19) — Expenses

### Notes
- **Expenses** (`Ctrl+K`). Log what you spent: an amount, a category, an optional note and the day. The month view shows the total, how it compares with last month, and a bar for each category. Step back through earlier months with the arrows. **Export CSV** hands the lot to a spreadsheet.
- **Exact totals.** Amounts are kept in whole cents, never as floating point, so thirty 0.10 entries make exactly 3.00.
- **Written the way people write money:** `12.50`, `12,50`, `1,234.56`, `1.234,56`, `£12`. Anything ambiguous or malformed is refused with a reason rather than guessed.
- **One currency, chosen at the top.** An amount written in a *different* currency (typing `£45` while keeping USD) is refused, not quietly relabelled as dollars.
- The CSV is safe to open in a spreadsheet: a note starting with `=`, `+`, `-` or `@` is exported as text, not run as a formula.
- Everything stays on this computer. If the saved log ever can't be read, Vex says so rather than starting an empty one that would be saved over it.
- Found in the live test before release: after logging something in an earlier month, the day box defaulted to the 1st of that month, so the next entries were silently back-dated. It now always starts at today.

## v2.32.23 (2026-09-19) — Crawl this site

### Notes
- **Crawl This Site** (`Ctrl+K`). *Check This Page's Links* answers for one page; this answers for the whole site. Starting from the page you're on, Vex follows links within the same site, up to 200 pages, and lists what to fix:
  - **broken pages, with the page that links to each one** ("Open linking page"), because a dead address can only be fixed where it's linked
  - server errors, and pages that need a sign-in
  - slow pages (over 3 seconds)
  - pages hidden from search by `noindex`, in the page or in the `X-Robots-Tag` header
  - missing titles, the same title on several pages, and missing descriptions
  - links that go through a redirect
  - **Copy report** has everything as plain text.
- **Polite by design:**
  - It stays on the same site and **obeys robots.txt**, including `Crawl-delay`, which means one page at a time with the wait.
  - Following RFC 9309, a site that fails to serve its robots.txt (a server error or no answer) is not crawled at all. A site with no robots.txt is fine.
  - It reads only HTML. Anything else, like a zip or a video, is only asked for its status and never downloaded.
  - It skips `nofollow` links and pages, and stops the moment you press **Stop** or close the sheet.
  - Requests come from an empty session with no cookies or logins, the same one the link checker uses. It never runs in private or Tor tabs.
- Tested live against a local test site with a planted broken link, redirect, slow page, duplicate title, noindex page, a robots.txt-blocked page and an outside link. All were reported, and the server's log shows the blocked page and the outside site were never contacted.

## v2.32.22 (2026-09-19) — Whiteboard

### Notes
- **Whiteboard** (`Ctrl+K`). A blank white page to sketch on, with the same pen, highlighter, box, arrow, text and undo as **Mark Up This Page**. Save it as a PNG or copy it.
- The pen starts dark instead of red, and there's no Redact button, because there's nothing on a blank page to hide.
- **Closing after you've drawn asks first.** A marked-up screenshot can be taken again, but a sketch can't. Closing an empty board doesn't ask.

### Internal
- Found in the live test, not the unit test: the command first reached the editor as `window.ScreenshotTool`, which doesn't exist (it's a top-level `const`), so Ctrl+K did nothing. It now uses the bare name like its neighbours; the existing guard test covers this pattern.

## v2.32.21 (2026-09-19) — Habits

### Notes
- **Habits** (`Ctrl+K`). Name something you want to do every day, and tick it off. Each habit shows the last seven days as tick boxes, the streak you're on and your best streak.
- **Forgiving on purpose.** Today and the six days before can be ticked, so a forgotten yesterday still counts. An unticked today doesn't break a streak until the day is over.
- Days are your local calendar dates, so something done at 23:50 counts for that day.
- If the saved habits can't be read, Vex says so rather than starting an empty list that would be saved over them.

## v2.32.20 (2026-09-19) — Task board

### Notes
- **Task Board** (`Ctrl+K`, or the **Board** button in the To-do list). Your note tasks in three columns: **To do**, **Doing** and **Done**. Drag a card to another column, or use its arrows.
- **No separate board to fall out of step.** A move is an edit to the task's own line in its note: Doing adds `@doing`, Done ticks the box, and To do clears both. You can also type `@doing` in a note yourself, and the task shows in Doing.
- Done shows the 20 most recent finished tasks, not every task ever ticked.
- Only Vex's own cards can be dropped on the board; dragging ordinary text onto it does nothing.

### Internal
- The CI failures reported on every commit since v2.31.96 are fixed (six lint errors, and adm-zip updated to 0.6.1 for a high-severity advisory). The "Verify Vex" run for the fix passed every step.

## v2.32.19 (2026-09-19) — Why is this page slow?

### Notes
- **Why Is This Page Slow?** (`Ctrl+K`). Chromium measures everything about how a page loaded and keeps it in the page, but nobody sees it without opening DevTools and knowing where to look. Vex now reads it and says it plainly:
  - **Four timings, each graded** against Google's Core Web Vitals thresholds: when the server answered, when the first thing was drawn, when the main content appeared (and what it was), and how much the layout jumped around.
  - **The culprits, in words:** scripts in the page head that hold up the first paint; pictures sent far bigger than they're shown; pages built from thousands of elements; heavy downloads; and requests to other companies' servers.
  - **The heaviest files**, and **Copy report** for plain text.
- **An honest limit, measured:** servers on other sites hide how big their files are unless they choose to reveal it, so every ad and tracker on a big news site reported 0 bytes. Download totals are therefore shown as **"at least"**, and Vex says how many files hid their size. The share from other companies is counted by **requests**, which can always be seen, not by bytes, which would understate it badly.
- Tested on example.com (Fast, nothing found) and on The Verge (Fast timings, but two scripts blocking the first paint and a 5,127-element page).

## v2.32.18 (2026-09-19) — Discord that doesn't grow all day

### Notes
- **Measured first.** On the reporting machine, the Discord panel's process held **2.15 GB** by itself, while the whole rest of Vex held about 1 GB. Discord is kept awake so its notifications arrive, which means it was never slept and never reloaded, and a Discord left running all day keeps growing.
- **Discord now has a memory limit** (Settings › Performance, **1.5 GB** by default, or Never / 700 MB / 1 GB / 2 GB). Past it, Vex swaps in a fresh Discord, but only when that costs you nothing:
  - it's **hidden**: not the panel you're looking at, and not the one beside it
  - you're **not in a call**: no microphone or camera, nothing playing, no Disconnect button on screen
  - at most **once every 30 minutes**
  - It stays signed in and keeps notifying; it just starts clean. Checked live: a new process came up while the panel stayed hidden, and opening it afterwards showed the fresh one.
- **A limit that's too low can't loop.** Three minutes after a refresh, Vex measures the fresh Discord. If a fresh one is already close to your limit, Vex raises the limit above it once and tells you, rather than refreshing again and again.
- The existing "Discord is using …" notice still appears while you have Discord open. A refresh clears it, because its number is out of date.

### What the plugin review found (for your own Vencord build)
- The code review ranked **MessageLoggerEnhanced** far above everything else: up to **2,000 messages per server** kept in memory, for every server and your DMs. With **MessageLogger** on as well, the work is done twice. Next come **AutoExport** (a full member-list request every 5 minutes), **ShowHiddenChannels**, **PlatformIndicators** and **WhoReacted**. Opening a whole-member-list window (RoleMembers, ServerMemberExporter, WhipCount, ServerInfo, PermissionsViewer) in a big server holds those members until Discord reloads, which is another thing the new limit clears.

### Internal
- Creating a web panel moved into its own function, so a panel can be rebuilt without being shown. Showing a panel works exactly as before (all 361 panel tests pass).
- Found by the tests before release: with nothing saved, the limit read as 0 ("Never"), so the feature would have shipped switched off for everyone.

## v2.32.17 (2026-09-19) — Record the screen

### Notes
- **Record the Screen** (`Ctrl+K`, run it again to stop). Showing someone how to do something, or what went wrong, is a video, and until now that meant installing a recorder. Pick a screen or a window in the same picker Discord screen share uses, with its sound if you want it. A red pill at the top shows the time and has **Stop** and **Discard**. When you stop, you choose where to save.
- **It's written to disk as it records**, a chunk every second, so a long recording never piles up in memory. Discard, or saying no to saving, deletes it; nothing is left hidden in a temp folder. Ending the share from Windows' own "Stop sharing" bar stops and saves the same way.
- **Why WebM and not MP4**, measured rather than assumed: this build *can* record MP4, but its MP4 recorder hands over nothing until you press Stop (a 36-byte header, then silence), so the whole recording would sit in memory for as long as it ran. WebM (VP9 video + Opus audio) arrives chunk by chunk. It plays in Windows' Media Player, Chrome, VLC and Discord.

### Fixes (found while building this)
- Vex's own window was refused screen capture, so the recorder failed with "Permission denied" before any picker appeared. Vex's own interface may now capture the screen, and only the screen (not your microphone or camera). You choose what in the picker, and that's the consent. Web pages still get the normal permission prompt.
- Vex's safety check on data passed between its parts counted every byte of binary data as a separate item. A single second of video tripped its 30,000-item limit, so every chunk was refused. Binary data is now checked as one block, with a size limit.
- Cancelling the picker and being refused before the picker ever opens both used to look like "you chose nothing". A refusal now says so.
- If a chunk failed to write, Discard could leave the temporary file behind. It no longer can.

## v2.32.16 (2026-09-19) — Mark up a page, and hide what's private

### Notes
- **Mark Up This Page** (`Ctrl+K`) captures what's on screen and opens it straight in the mark-up editor. It used to take three steps: screenshot, preview, then Annotate.
- **Redact.** Drag over an email address, a name, an order number or a balance, and it's pixelated into flat blocks you can't read. This is the tool for sharing a screenshot of your own account safely. Redaction **replaces the pixels** in the saved picture; it isn't a layer that can be peeled off or a black box someone can undo. Checked live: example.com's heading came out unreadable.
- **Highlighter** and **Text** join Pen, Box and Arrow. Text gets a dark outline so it stays readable on any background.
- Each tool now shows a one-line hint about what to do with it, and the toolbar uses proper icons instead of typed symbols.

### Fixes
- **Copy used to fail silently.** If Windows refused the picture, the editor closed and nothing was on your clipboard, with no word about it. Now it tells you, and keeps your work open so you can save it instead.

## v2.32.15 (2026-09-19) — Every to-do, from every note, in one list

### Notes
- **To-do List** (`Ctrl+K`). Notes already turned `- [ ] thing` into a real checkbox. They didn't show your checklists *together*, so a task written halfway down a note about a boiler quote only turned up again if you opened that note. Now one list gathers every open task from every note.
  - **Tick it in the list and it's ticked in its note.** Even when that note is open in the editor at the same moment, the tick can't be lost. Checked live against the real Notes editor, with the note open while it was ticked.
  - **Add a To-do** (`Ctrl+K`, or the box at the top of the list) puts the task in a pinned note called *To-do*, which is created the first time.
  - **Dates:** end a task with `@tomorrow`, `@today` or `@2026-10-03`. Dated tasks come first, overdue ones are marked in red, and the date tag is hidden in the list.
  - **Open note** takes you to where the task was written.
- This isn't a second to-do app beside Notes. Every task stays a line in the note you wrote it in, so there's one place your tasks actually live, and it syncs like the rest of your notes.

## v2.32.14 (2026-09-19) — Can everyone use this page?

### Notes
- **Check Accessibility of This Page** (`Ctrl+K`). Accessibility audits usually live in developer tools most people never open, and report in WCAG criterion numbers most people can't read. The problems themselves are plain, so Vex now checks the page in front of you for them and says them plainly:
  - **pictures with no description** (a screen reader reads out the file name, or skips the point the picture made)
  - **form boxes with no label** (a placeholder alone is flagged as worth a look, because it vanishes as soon as you type)
  - **buttons and links with no words** (usually an icon, which reads out as just "button")
  - **text too faint to read**, by WCAG's own contrast formula: 4.5:1 for normal text, 3:1 for large. Text over a background picture is left alone rather than guessed at.
  - **headings that skip a level**, or no main heading at all
  - **a missing page language or title**
- Each finding has **Show on page**, which outlines the element to fix. **Copy report** gives plain text for whoever owns the site. A finding that repeats is said once, with every element it applies to listed beneath.
- Tested against the W3C's own deliberately inaccessible demonstration site: **22 findings**, including 12 pictures with no description and 7 links with no words. The W3C's *fixed* version of the same site: **nothing found**, so no false alarms.
- It says plainly what it is: the common, certain failures, the kind a site owner can fix in an afternoon. It isn't a full WCAG audit, and a clean result says so.

## v2.32.13 (2026-09-19) — Vex gets out of your game's way

### Notes
- **First, the facts, measured on a 16 GB machine with an RTX 4060 (8 GB).** Ollama running with Vex costs you nothing while you game: **29 MB of RAM and no graphics memory** when idle. The real cost is an AI model you used recently. qwen3.5 holds about **5.5 GB of the card's 8 GB**, and Ollama keeps it there for **5 minutes** after the last reply. Start a game in that window and it fights the model for video memory. Background tabs cost RAM too.
- **When a full-screen game starts, Vex now does three things by itself** (Settings › Gaming, each its own switch, all on):
  - **Frees the graphics card.** Every loaded model is unloaded. If you ask the AI something mid-game you still get an answer, and the model leaves the card straight after.
  - **Sleeps background tabs.** Every tab except the one you were on, but **not** one playing music, one on a call, or one you've kept awake. They wake where you left them.
  - **Holds background AI.** Scheduled AI tasks wait until you're done and then catch up, and history indexing pauses. Nothing loads a model onto your card that you didn't ask for.
- Nothing pops up while you play; a notification over a game is the opposite of the point. When you come back, Vex tells you what it did, e.g. *"While you played Roblox, Vex freed 2.4 GB of graphics memory and slept 3 tabs."* That's the real message from a live test.
- **The AI model now unloads 1 minute after a reply**, not Ollama's 5. The only cost is a few seconds' reload for a question after a pause. You can choose 0, 1, 5 or 15 minutes in Settings › Gaming.
- **How it knows a game is running:** it uses the signal Windows itself uses to hold back notifications during games. That covers exclusive and borderless full screen, and nothing is read from the game. Vex going full screen for a video doesn't count. It picked up Roblox correctly in a live test.
  - The check runs in a tiny hidden helper that uses **16 MB**. It's compiled once with the C# compiler built into Windows. The first version was a PowerShell loop at **135 MB**, which defeated the point, so it was replaced before release. The helper never shows a window, and it closes itself when Vex does.
- Honest limit: a full-screen video in another program (VLC, for example) looks the same to Windows, so Vex would treat it as a game too. The only effect is that the GPU is freed and tabs sleep.

## v2.32.12 (2026-09-19) — Which links on this page are broken?

### Notes
- **Check This Page's Links** (`Ctrl+K`). A page full of links rots: an old post points at a moved article, a shop listing at a dead product, your own site at a page you deleted. Until now you found out by clicking them one at a time. Vex now checks every link on the page at once and sorts the answers by what you'd do about them:
  - **Broken**: the page is gone (404) or the site doesn't exist any more.
  - **Server error**: the site is failing right now; try later.
  - **Moved**: still works, but sends you somewhere else, and it shows where. A site just switching http to https, or adding `www`, doesn't count as moved.
  - **Needs sign-in**: a login or bot wall. That isn't a dead link, so it isn't reported as one.
  - **Show on page** scrolls to the link and outlines it in red, because what you fix is the paragraph, not a URL in a list. **Copy report** gives you plain text to send to whoever owns the page.
- It's polite: six requests at a time, a quick header-only check first so no page is downloaded, a 12-second limit per link, and at most 300 links.
- **It's private.** The checks go out from a separate, empty session: no cookies, no logins, nothing from your browsing. Forty sites contacted learn nothing about who's asking. The catch is that a page behind your login shows as *needs sign-in*. It never runs in a private or Tor tab. Checked live: nothing is sent at all.
- Found in testing: Electron's built-in fetch either hid where a redirect went or aborted on it, so a moved link looked untouched. It even missed example.com's own "Learn more" link, which moves to iana.org. The checker now follows redirects itself, one hop at a time.

### A correction
- In v2.32.5 I said a copy made in a private tab was *verified* not to reach clipboard history. That check was flawed. It faked "private" in a way Electron silently undoes, and the text it copied was already in the history, so it would have passed either way. It has now been checked properly, with a genuine off-the-record tab and a unique piece of text. The normal tab's copy was recorded; the off-the-record tab's was not. The feature was right; the earlier evidence wasn't.

## v2.32.11 (2026-09-19) — Watch the AI think

### Notes
- **Show thinking** (the brain button at the top of the AI panel, or `Ctrl+K` → *Show AI Thinking*). While the AI works on a reply, you can now see what it is thinking, the way Claude shows its thinking. A single faded line under *Thinking…* keeps changing to the model's latest thought. Click it to open the whole reasoning. Once the answer starts, the line goes away, and the reasoning is kept above the reply as *Thought for N words*, saved with the chat.
  - It works in the **agent** too: each step shows the model's thinking under "what I'm doing → which tool".
  - It's for **reasoning models** — qwen3.5, deepseek-r1 and the like. A model that doesn't reason has nothing to show, so you'll just see *Thinking…* as before.
- **It is off by default, and here's the honest reason.** Until now Vex told your local model *not* to think at all, because that's much faster. Measured on this machine's qwen3.5: about **3 seconds** a reply without thinking, and **16–39 seconds** with it (2,500–6,700 characters of reasoning before it answers). Switch it on for the hard question, off for the quick one. Off means exactly what it did before: no thinking is asked for and none is shown.
- Scheduled agent tasks never think, even with the switch on. Nobody is watching them, so there's no reason to make them slower.
- Thinking was switched off in the first place because qwen3.5 sometimes thought and then gave no answer. On the current Ollama (0.34) that didn't happen once in six tries. If it ever does, Vex says so and points you at the switch, rather than leaving you with an empty reply.
- For the record: Vex had been throwing away the thoughts Ollama sends in their own separate stream. It now reads them.

## v2.32.10 (2026-09-19) — The whole page in one screenshot

### Notes
- **Screenshot the Whole Page** (`Ctrl+K`). A screenshot of a web page has always been one screenful of it. For the receipt, the long thread, the article with its charts, that meant scroll, capture, scroll, capture, and stitch — or give up. Now Vex does the scrolling, capturing and stitching, and hands you one image top to bottom. It opens in the same preview as the normal screenshot, so you can copy it, save it or annotate it.
  - Pictures further down that haven't loaded yet are loaded first, so they don't come out as empty boxes.
  - A header pinned to the top of the screen shows up once, at the top, instead of on every screenful.
  - The page goes back to exactly where you were scrolled.
  - A very long page is scaled down to fit. Past about 30,000 pixels you get the top part and are told so, rather than a crashed tab.
- How it got right, for the record. Two faster one-pass methods both returned a correctly sized image showing the *first screenful repeated all the way down*: inside a Vex tab the page only ever draws one screen's worth. The next attempt waited on the window to repaint, which a window behind your other windows never does, and one run went past seven minutes. The version shipped takes each screenful on demand. On a long Wikipedia article: 10,949 pixels tall, all of it correct, in 7 seconds.
- If DevTools is open on that tab, Vex asks you to close it first rather than fighting it for the page.

## v2.32.9 (2026-09-19) — Getting things out of a page

### Notes
A browser is very good at showing you a page and oddly bad at letting you keep any of it. Five new `Ctrl+K` commands:
- **Save Page as PDF.** Straight to a file. The usual route is the print dialog, a preview that takes its time, and a destination menu. Backgrounds are kept.
- **Save Page as One File.** The whole page, with its text, pictures and styles, in a single `.mhtml` that opens offline in any Chromium browser. It's for the article that will be paywalled or deleted next month. Browsers usually have no menu for this at all. What is saved is exactly what you are looking at, signed-in state included, because nothing is downloaded again.
- **Open a List of Links.** Someone sends you twelve links and you open them one by one. Now you paste them in, in any form: one per line, a comma mess, or a chat message with links inside it. Each one opens in its own tab. If your clipboard already holds links, they are filled in for you. Vex asks before opening more than eight, and won't open more than fifty.
- **Images on This Page.** Every picture on the page, biggest first, at the largest size the page offers. Tracking pixels and icons are left out. Save one, or all of them (Vex asks first if there are more than ten). Downloads go through the tab itself, so images behind a login still come down.
- **Cite This Page.** APA 7, MLA 9, Harvard, Chicago or BibTeX, built from what the page publishes about itself: the scholarly `citation_*` tags Google Scholar reads, then Open Graph, then JSON-LD. A DOI takes priority over the page address. When the page names no author, the citation leaves the author out and tells you to check before you hand it in. Vex doesn't invent one. Your style choice is remembered.

### Fixes (found before release)
- A BibTeX "Accessed" date created after midnight would have said yesterday for anyone east of Greenwich. It was being written in UTC; it now uses your own date.

## v2.32.8 (2026-09-19) — Everything about one topic, in one place

### Notes
- **Research projects** (`Ctrl+K` → *Research Projects*). Looking into something takes days and touches everything: eleven tabs, four bookmarks you will never find again, a note, and two AI conversations each attached to a tab that no longer exists. A week later the question comes back and none of it is together.
  - A project is a folder for one topic. **Add This Page to Project** files whatever you are reading; notes go in beside it.
  - **Save This Chat to Project** keeps the AI conversation with the research it belongs to. That is the part every browser loses, because a chat belongs to a tab and tabs close.
  - One project is the one you are working on, so adding something is a single command rather than a decision.
  - **Open all** brings the whole thing back as tabs — and says how many first, because opening twenty tabs by accident is a bad afternoon.
  - **Copy as Markdown** exports the lot: pages as links, your notes, and every conversation written out. Research that cannot leave the tool it was done in is a trap.
- Private and Tor tabs are not collected, here as everywhere — neither the page nor a chat held in one.

## v2.32.7 (2026-09-19) — What colour is that?

### Notes
- **Eyedropper** (`Ctrl+K` → *Pick a Colour From the Screen*). You are looking at a colour and you want its hex. Until now that meant a screenshot, a paint program and a guess — or an extension you had to trust with every page you visit.
  - It samples any pixel on the **screen**, not just in the page: a video, a PDF, a design tool, another program entirely.
  - The hex goes straight to the clipboard, because that is what you were about to paste.
  - **Colours You Picked** keeps the last dozen, each in hex, rgb and hsl, click to copy.
- Chromium has had this built in since Chrome 95 and almost nothing uses it. The magnifier is drawn by Chromium itself, so no page is injected into and no page is told you used it.
- Cancelling with Escape is treated as cancelling, not as a failure. And because Chromium only opens the magnifier when you ask for it directly, a request that arrives any other way says so in words rather than passing on `EyeDropper::open() requires user gesture`.

## v2.32.6 (2026-09-19) — Stop retyping the same paragraph

### Notes
- **Snippets** (`Ctrl+K` → *Snippets*). Your address. The bank details for an invoice. The three-line reply you send to the same kind of email every week. Everyone retypes something, and the usual answer is a notes app you copy out of — two context switches for four words.
  - A snippet is an abbreviation and the text it becomes. Type `;addr` in any box on any page, press **Tab**, and it is your address.
  - **Tab, and only when the word right before the caret is one of yours.** Everywhere else Tab still moves to the next field, which is what it is for. Nothing expands while you type: an expander that fires inside a word you were halfway through is worse than retyping.
  - Works in ordinary boxes, in big message boxes, and in the rich editors that sites build themselves — verified in a running build against all three.
  - Multi-line snippets keep their lines in a message box. In a one-line field, where the browser would drop the newlines and weld "Street" onto "Manchester", they become spaces instead.
  - The longest match wins, so `;sig` and `;sig2` can both exist.
  - **Never in a password field.**
- The page is told only the abbreviations and their text — no names, no ids, nothing else about you — and only ever the list you made.

## v2.32.5 (2026-09-19) — The thing you copied before the thing you copied

### Notes
- **Clipboard history** (`Ctrl+K` → *Clipboard History*). You copy a tracking number, then copy the address to paste it somewhere, and the tracking number is gone. The clipboard holds one thing and the last copy wins.
  - **Type any word that was in it** to get it back — `Ctrl+K`, a word from the copy, Enter, and it is on the clipboard again.
  - Or browse the list, which shows what each copy was and which site it came from.
- **It watches one thing: copies made on web pages.** Every clipboard manager on Windows, including Win+V, works by watching the system clipboard — which means it also records what you copy out of your password manager, your banking app and your terminal. Vex sees none of that. Copies made in Vex's own interface are not recorded either.
  - A copy out of a **password field, or a one-time-code box, is never sent at all** — the page-side capture refuses it before anything leaves the tab. Verified against real password and OTP fields in a running build.
  - **Private and Tor tabs record nothing**, like everything else in them.
- **Nothing is kept after you close Vex unless you pin it.** The session list lives in memory and goes when Vex does. Pinning is what writes an entry to disk, so keeping something is a decision you make rather than one made for you. *Clear all* clears both.
- Turn the whole thing off in Settings → Browsing extras. Off means nothing is recorded — and what was already held is dropped, not just hidden.

### Fixes
- The download safety check added in v2.32.4 only guarded the downloads panel. The **Open** button on the toast that appears the moment a download finishes — which is where an installer is actually opened from — went straight past it. Both buttons now ask the same question.

## v2.32.4 (2026-09-19) — What an installer actually is, before you double-click it

### Notes
- **Vex now tells you what a downloaded program is before it runs.** An installer is the one thing a browser hands you that can do anything to the machine, and browsers say nothing about it. Windows asks "are you sure" and names the publisher — after the double-click, and only if the file is signed. Opening an `.exe`, `.msi`, `.bat` or an archive from the downloads list now says first:
  - **Who signed it** — read from the file itself, without running it. "Signed by Example Ltd", or plainly *Not signed — nobody has put their name to this file*. Unsigned is not an accusation; most small tools are unsigned. An unsigned installer claiming to be from a large company is the thing worth noticing.
  - **Where it came from** — the site you actually meant to trust, taken from the download, not from the file's own claims about itself.
  - **Its SHA-256** — so you can compare it with what the project publishes.
- Nothing is sent anywhere. The hash is computed on your machine and shown; whether to look it up online is your decision, not Vex's. Vex is not an antivirus and does not pretend to be one — it reports what can be known locally and lets you decide.
- A PDF, an image or a document opens exactly as it always did. An archive says plainly that what is inside it is not checked.
- **If the check itself fails, it gets out of the way.** A file that has moved, a signature that cannot be read, an older build with no such bridge: the file opens as before. A safety check that stops you opening your own downloads would be worse than no check.

## v2.32.3 (2026-09-19) — Save a task the agent did, and repeat it without the AI

### Notes
- **"Save as a task"** on any agent run in the AI history. A run that worked is a recipe — and doing it again through the model costs thirty seconds, a model load, and a slightly different answer each time, when what you wanted was the same six steps.
- **Ctrl+K → Repeat a task** runs those steps directly. No AI, no waiting, the same result: measured in the tests, the model is not called once.
- It is deliberately not clever. If a step fails — the page has moved on, a button is gone — it stops, says which step and why, and tells you to send the request as a task so the AI can work it out. A macro that half-works in silence would be worse than no macro.
- The same permission rules apply as to the agent itself: a recorded step that acts on a site you did not ask about is still confirmed first, and refusing it stops the run.

## v2.32.2 (2026-09-19) — Find a tab by what is on it, not just its title

### Notes
- **Ctrl+K now searches inside your open tabs.** It found tabs by title, which is fine until you have thirty and the one you want is called "Order confirmation" while the word you remember is "refund". Each page is skimmed once when it settles and its own words are searchable — a content match is listed under the title matches and marked *On this page*.
- It half-finishes a word for you: "refun" finds the page that says refund. Every word you type has to be there, so a second word narrows rather than widens.
- Nothing leaves the machine and nothing is written to disk: the words live in memory for as long as the tab is open, a private tab is never read, and a page that will not answer is simply left findable by title as before.

## v2.32.1 (2026-09-19) — Tell me when this page changes

### Notes
- **"Tell me when this page changes"** (Ctrl+K). Auto-refresh reloads a page on a timer, which is half the job — you still have to look at it. A watch reads the page quietly in the background, compares it with what was there before, and speaks only when it is different: a toast and a desktop notification, because the whole point is that you are somewhere else.
  - Watch the whole page, or one part of it by CSS selector — the difference between "the article changed" and "the advert rotated".
  - Watch a **number** instead: up, down, or past a figure. "Tell me when it is below 300" is what people actually mean, and it reads £1,299.99 and "4 of 12 left" the way a person would.
  - Every 5 minutes to once a day. The first look sets the baseline and says nothing.
  - A page that stops loading, or a selector that stops matching, is reported — after five failures, once, rather than every check. **Watched pages** lists what is being kept an eye on and what it last saw.
- Development: the search-performance test asserted absolute milliseconds and failed three runs in a row while a game was running, with the code untouched. Its ceilings now scale to how fast the machine is at that moment — a false failure teaches you to ignore the suite.

## v2.32.0 (2026-09-19) — Vex can see your dev servers, and switch a page between local, staging and live

### Notes
- **Running dev servers** (Ctrl+K). A dev server is started in a terminal and then hunted for — which port was it, is it still up? The browser is where you go to look and the one thing that could not tell you. Vex knocks on the usual thirty-odd ports and lists what answers, with a guess at what put it there (Vite, Next.js, a Cloudflare Worker, Ollama). It is a local connection and nothing more: no request is sent, so nothing that is listening is disturbed by being found.
- **Switch environment** (Ctrl+K). The same path on your local server, on staging, or live — everything after the host is kept exactly, which is the part worth not retyping. Tell Vex a site’s staging and local addresses once (**Set environments**) and it works in every direction; any dev server that is up is offered whether you wrote it down or not. A local address gets http, because insisting on https turns "switch to local" into a blank page.
- Caught by its own test before shipping: switching back from localhost:5173 produced shop.example:5173 — a real address that is not the site — because setting a host without a port keeps the old one.

## v2.31.99 (2026-09-19) — The update prompt stops nagging

### Notes
- **"Later" now means a day, not until the next launch.** Vex ships several times a day, so the update popup came back every single time it started — and a relentless popup is one that gets clicked away without being read. (The Discord memory notice had exactly this problem, fixed the same way in v2.31.82.)
- **"Skip this one"** never mentions that particular version again, while the next one still gets through.

## v2.31.98 (2026-09-19) — A box over everything, for the thought you would otherwise lose

### Notes
- **Quick capture.** A thought while you are gaming is gone by the time you have alt-tabbed, found Vex, found the panel and clicked. One hotkey now opens a small box over whatever you were doing — a game, a stream, another program — takes one line, and goes:
  - anything → a note, titled by its first few words;
  - **remind me to…**, **timer 20 min**, **alarm 7am** → the reminder or timer, exactly as Ctrl+K would;
  - **/** anything → a Vex command;
  - **ask …** → the AI panel, because an answer in a box that closes in a second is useless.
- It never drags the main window over your game, it appears on the screen your mouse is on, and Escape closes it. Set the hotkey in Settings › Privacy › Gaming and streaming, or open it from Ctrl+K → **Quick capture** — a feature reachable only by a hotkey you must first configure is nearly invisible.
- The box gets two channels and nothing else: submit a line and close. Vex’s IPC policy refuses it everything an untrusted sender should be refused, which it proved by refusing the first version of this feature outright.
- Fixed before it shipped: the box closed itself the moment it lost focus — which, opening over a fullscreen game that keeps focus, meant vanishing instantly. It now only closes on blur once it has actually been focused.

## v2.31.97 (2026-09-19) — Undo what the agent made, and let it read videos and PDFs

### Notes
- **Undo an agent run.** An agent that acts on its own needs a way back, and "which of these six notes did it write?" is not one. Every run now records what it MADE — notes, bookmarks, tab groups, timers, reminders — and **Undo** in the AI history removes them, newest first, after showing you the list. Only Vex’s own things: what it did on a web page is the page’s business and cannot be taken back from here, and it says so rather than pretending. Anything already gone is reported and the rest still goes.
- **A YouTube link is no longer a dead end.** The page is an app shell with no words in it, so the agent read it, found nothing and gave up. It now reads what was actually *said* — the caption track, with a timestamp every couple of minutes so an answer can point at a moment. No key and no third party; a video with no captions says so.
- **PDFs are read instead of refused.** Half of anything official lives in one, and "that address is a file, not a page" was the end of it. The plain-text parts are read; a file that keeps everything compressed says so and points at opening it in a tab, and a short read is flagged as partial rather than passed off as the whole document.

## v2.31.96 (2026-09-19) — Take any table as a spreadsheet, and set how fast a site plays video

### Notes
- **Copy tables as CSV** (Ctrl+K). Copying a table out of a page gives you run-together text: the columns are in the markup and no browser offers them to you. This reads the real cells — a cell spanning two columns leaves the next one empty, so the rows still line up — and writes proper CSV, quoting anything with a comma, a quote or a line break. **Save tables as a note** does the same as a Markdown table in your Notes.
- **Video speed, per site, remembered.** Sites that have a speed control bury it three menus deep, and sites that do not leave you at 1×. Set it once for a site and every video there plays at that speed, including one that appears later and one whose player tries to reset it.

## v2.31.95 (2026-09-19) — Allow a site for one visit, and see (and stop) whatever is using your microphone

### Notes
- **"Allow" no longer means for ever.** The prompt had two answers and a Remember box that was ticked by default, so agreeing to a microphone for one call agreed to it for good. Three answers now: **Block**, **Allow this visit**, **Always allow**. A visit-only answer lasts until Vex closes and is never written to disk — a "just this once" that survived a restart would be a lie.
- **Settings › Site Permissions shows what is using your microphone or camera right now**, tab by tab and panel by panel, and **Stop** ends it. Vex has always known this — it draws the recording badge on the tab — but there was nowhere to see it and no way to act: the page had to give the microphone up by itself. The list refreshes while the panel is open.

## v2.31.94 (2026-09-19) — Snooze a tab, see where a link really goes, and ask about any picture

### Notes
- **Snooze a tab.** A tab stays open because closing it loses it — so the strip fills with things that are not for today. Right-click one: *in an hour*, *this evening*, *tomorrow morning*, *this weekend*, *Monday morning*, *in a week*. It closes now and opens itself again when you said, and the snooze is written down, so a restart does not lose it.
- **Tabs you have not touched in a week are archived, not closed.** They leave the strip and go into a list, keeping the address and title; one click brings any of them back. Nothing is ever deleted — closing a tab you might still want is the thing this exists to avoid. Switch it off with `vex.autoArchive`.
- **Copying a link copies where it really goes, without the tracker.** A wrapped link (Google, Facebook, DuckDuckGo, Reddit, Steam, Bing, LinkedIn) is unwrapped to its real destination, and campaign tags — utm_*, fbclid, gclid and about sixty more — are dropped, so what you paste to someone does not carry a token tying them to you. Unwrapping is done locally; nothing is asked and nobody is told you looked. *Copy Link Exactly* is there when you want it untouched.
- **An address pretending to be a familiar one is called out.** paypa1.com, secure-paypal.net, github-support.co, and the ones written in another alphabet entirely. A bar says what it is and offers to go back; it never blocks, because a browser that cries wolf is one whose warnings are clicked away. Real subdomains — docs.github.com — are never flagged.
- **Right-click any image → "Ask Vex about this image".** The model can see (since v2.31.86), so this is a question about the picture. The image is fetched through Vex, shrunk, and handed to a model with vision.
- **One-time codes now leave the clipboard.** Copying a password already cleared after 30 seconds; copying a 2FA code did not, and it sat there for the next thing you pasted into. Both go through one implementation now, and neither overwrites something you copied since.
- Vex's own image fetching answers honestly: it sends a proper User-Agent, and an HTTP error is reported as one instead of "that address is not an image". Measured: some sites (Wikimedia) refuse whatever is sent — that is their policy, and Vex now says so rather than guessing.

## v2.31.93 (2026-09-18) — Mute Discord from inside a game, blur your codes while streaming, and split your sound between devices

### Notes
- **Discord hotkeys that work from inside a fullscreen game.** Muting yourself meant alt-tabbing out, finding Vex, finding the panel and clicking — by which time the moment had gone. Vex now takes system-wide hotkeys for *mute*, *deafen* and *leave the call*, and presses Discord's own buttons in the panel. Set them in Settings › Privacy › Gaming and streaming by pressing the keys you want. Each is off until you set it, because a global hotkey takes that combination away from every other program — including the game — and one that another program already holds is reported rather than silently dead. No push-to-talk: that needs the key *release*, which Electron's global shortcuts do not report, and a half-working one is worse than none.
- **Streamer mode.** Vex holds your one-time codes, your saved passwords and notifications that quote messages — and it sits on the same screen you share. While something is being captured, those are blurred; hover one to read it, and copying still copies the real value. It says so when it turns on, so a blurred code is never a mystery. *While something is being captured* by default, or always on, or off.
- **Send one site to your headphones and another to the speakers.** Windows gives a whole program one output device, so a browser plays everything through the same place: a Discord call and a music tab could not be split without moving the whole browser, which moves the game's sound with it. Shift-click a tab's sound icon to choose where that site plays. The choice is remembered per site, applies to every open tab at once without a reload, and follows panels too. Windows will not name your outputs until something has had microphone permission once — Vex asks only if you press *Show my devices*, and opens and closes the microphone in the same moment.

## v2.31.92 (2026-09-18) — The agent can read your own notes, stays on the site you pointed it at, and checks its own work

### Notes
- **It can read what you already kept.** The agent could *write* a note and never read one, so "what did I note about the monitors?" or "add this to my shopping list" simply failed. New: search your notes, read one in full, add lines to one that exists, search your bookmarks, and list the reminders that have not fired. All read-only except the append, all inside Vex — nothing here touches a page or the network. Measured live: it found the note, quoted both monitors and the decision, then added a line to it.
- **It stays on the site you pointed it at.** A page can say anything, and an agent that follows a link into a site you never mentioned and starts typing is the real risk with agents — until now Vex relied on the model behaving. The sites you named, and the page the run started on, are fair game; anything else is asked about before it clicks or types, in *every* permission mode, and approving a site approves it for the rest of the run. Reading is never scoped, only acting.
- **It hands the page back at a sign-in, a payment or a captcha.** A new *Your turn* card: the agent explains what it needs, waits, and carries on from wherever you leave it. It is told plainly never to type a password, a card number or a one-time code, and never to work around a "prove you are human" wall.
- **It checks its own work.** A local model has claimed success for a call that failed. Saving a note, bookmarking a page, making a tab group and starting a timer are now read back before it says done — "Saved **and verified** the note", "0:45 left" — and a write that did not happen is reported as a failure.
- Searching your own things now matches across a plural: it searched for "monitors", the note said "Monitor", and it found nothing and repeated itself. Seen live, fixed, and covered.

## v2.31.91 (2026-09-18) — The AI says when it will be slow, why it failed, and gives your graphics card back

### Notes
- **"The AI is broken" usually means the graphics card is full.** A local model lives in video memory. Measured here: a game and OBS had an 8 GB card at 7.7 GB and 92% busy, so the model was pushed onto the processor and the same agent task that took 30 seconds ran past the two-minute limit and returned nothing — twice, with nothing on screen to explain it. Vex now reads the card and says so before the request: *"qwen3.5 is running on the processor, not the graphics card — expect answers to take minutes."*
- **"Why did that fail?" on every AI error.** One button checks the lot — Worker URL, internet, Ollama, whether the model is installed, whether it is loaded and *where* it is loaded, and how full the card is — and answers in a sentence, with the checks listed underneath so you can argue with it.
- **You can watch the agent think.** A local model takes tens of seconds, and "Thinking…" for a minute is indistinguishable from a hang. Its reply now appears as it is written — the thought, then the tool it is reaching for. Measured live: 46 updates in a 17-second step.
- **A model manager, in Settings › AI.** What is installed, what is loaded right now and whether it is on the card or the processor, how much each one needs, and whether it fits yours — plus install, use, unload and delete, with no terminal. An 8 GB card holds one 9 GB model badly and two comfortably at 4 GB each, and until now nothing said so.
- **Vex gives the card back while you game.** *Free the graphics card* unloads the model on demand (measured: 5.2 GB back), *Free memory now* does it too, and Vex does it on its own after five minutes hidden when something else needs the card — never in the middle of an answer. The next request loads the model again in a few seconds.

## v2.31.90 (2026-09-18) — Vex stops failing quietly: a problems log, a way back in, and an installer that is started before it ships

### Notes
- **Things that fail quietly now say so.** 907 places in Vex catch an error and say nothing. That is usually right — a favicon that will not load is not worth a toast — but it is how this week's two worst bugs stayed hidden: the Discord screen share was *refused* and the refusal was thrown away, and an agent run was never saved with the chat while nothing said so. Anything that fails quietly now writes one line into **Memory panel › Health**, with a count for repeats and a button to clear it. It also catches what nothing caught before — an uncaught error or an unhandled promise in the interface, which until now reached only the DevTools console. Nothing is sent anywhere; it is there so you can see it, and paste it to me.
- **A way back in when Vex will not start.** Two launches that never finish starting put the third into **safe mode**: no extensions, no panels, no session restore, and a banner saying why — with *Restore earlier settings* and *Restart normally*. Until now an extension that broke the browser could not be removed, because removing it meant opening the browser. `--safe-mode` asks for it outright. Measured: two starts cut short, the third came up stripped with the banner, and the launch after a good one was normal again.
- **Your settings are kept before each new version.** The first launch of a new version copies your settings aside first, so an update that breaks something can be undone — five are kept, and restoring is itself undoable.
- **The installer is started before it is uploaded.** `npm run publish` built an installer and shipped it to everyone without ever running it: the tests cover the source, and nothing covered the packaged app, where the failures are of a different kind (a file left out of the build, a runtime dependency that is missing only once packed). The publish is now build → **start the built app** → create the release → upload, so nothing reaches you that has not started on this machine first. A build that does not come up stops the publish and leaves no release behind.
- **When browser storage fills, nothing is lost any more.** Vex keeps 60 kinds of thing there, and a write past the cap *throws* — at sixty call sites that each swallowed it, so notes and chats could fail to save in silence. Now it is recorded, said once, and the value still goes to disk, which has no such cap. Health shows how full it is and what is filling it.
- Development: the smoke test waits for Vex to exit before removing its throwaway profile (it lost that race every time, leaving 85 folders behind), and a test run leaves nothing in Temp.

## v2.31.89 (2026-09-18) — Permission prompts say what is being asked, and "Remember" covers only that

### Notes
- **Fixed: allowing a site's microphone also pre-approved its camera and its screen shares.** Chromium reports the microphone, the camera, both together and a *screen share* to Vex as one permission, told apart only by a detail Vex ignored. So every one of those prompts said "wants to access your camera and microphone" — even a screen share, even microphone-only — and **Remember** filed the answer under a single key: allow the mic on a site once, and its camera and screen-share requests were granted without asking; block a screen share, and the mic was blocked with it. Measured in a running Vex. Each request is now asked about, and remembered, as what it is: *use your microphone*, *use your camera*, *use your camera and microphone*, or *share your screen* (you still pick the screen or window afterwards).
- Answers you saved before this version keep working for the camera and the microphone — that is what their prompt said — and never count for a screen share. Settings › Site Permissions shows them as "camera and microphone".
- Prompts read properly: "wants to send you notifications", "wants to know your location" (they used to say "wants to access send notifications").
- Development: a test run now gets its own temp folder, deleted when the run ends — test runs had left 4,761 folders (8.5 GB) in Temp over two weeks. The smoke and UI-check scripts retry deleting their throwaway profile instead of giving up silently, and no longer register Windows scheduled tasks.

## v2.31.88 (2026-09-18) — Discord screen sharing works with "Share audio" off

### Notes
- **Fixed: in Discord you picked a screen, the picker closed, and nothing was shared.** Discord always asks for audio with a screen share, and Chromium refuses a pick that leaves out audio the page asked for ("Invalid capture constraints"). Vex's picker has a *Share audio* box and remembers it — so after unticking it once, every share died the moment you picked a screen, without a word. Reproduced on discord.com in the panel: ticked worked, unticked failed. The pick now always carries the audio that was asked for, and with the box unticked Vex removes the audio track before Discord ever receives the stream — so it shares silently, as the box says. Measured both ways after the fix: 1080p live, with and without audio.
- **A share Vex cannot start now says why.** The picker used to throw away the answer it got back, so a refused or expired share looked like nothing happening at all.

## v2.31.87 (2026-09-18) — Send decides, chats stop vanishing, Vex starts Ollama itself, and the memory guard stops nagging

### Notes
- **One Send button.** The robot button is gone. Send now decides: a task ("start a 20 minute timer", "open…", "bookmark this", "group my tabs", "remind me…") or a question a chat model could only guess at ("latest…", "weather today", "price of…") runs as the agent; anything about the page, writing or explaining is answered as chat. `/agent …` or `/chat …` forces one. The permission menu still asks the first time, before anything runs.
- **Fixed: an AI chat vanished when you closed and reopened the panel, and was not in Recent chats.** An agent run — your request, every step, the answer — only ever existed on screen; it was never stored with the tab's conversation, so reopening the panel redrew from an empty one. It is now part of the chat: the request is saved the moment you send it, the answer when it ends, with *Show what the agent did* to bring the steps back. Reopening the panel while the agent is still working no longer wipes its steps either.
- **Vex starts Ollama for you.** After a reboot Ollama is not running, and with no AI Worker set every request failed as "Cloud AI is not configured" until you opened Ollama by hand. When the local model is wanted and does not answer, Vex now starts `ollama serve` in the background — no window — and carries on; it also does this at launch if your setup relies on the local model. *Refresh Ollama Status* starts it too. Switch: Settings › AI › *Start Ollama when it is needed*. Background indexing never starts it; a remote Ollama address is left alone.
- **Fixed: "High memory — slept N idle tabs" kept popping up, and tabs were slept seconds after you left them.** The guard compared *all* of Vex with the ceiling — but most of a heavy session is not in tabs (the Discord panel alone is about 1 GB), so with the default 1.2 GB ceiling it was over for good: every tab was slept within 45 s of being left, with a toast each time, and none of it could bring the total down. Now a tab left under five minutes ago is not idle yet; what the idle tabs really hold is measured, and if that is too little to matter nothing is slept; only as many tabs as it takes are slept; and the toast comes at most once in 30 minutes, saying how much was freed. The Memory panel still records every sweep.
- Development: a Vex started with `VEX_NO_OS_SCHEDULE=1` registers no Windows scheduled tasks, so test profiles stop leaving wake-up tasks behind.

## v2.31.86 (2026-09-18) — The agent uses Vex's own features, can see the page, stops when told, and keeps its work

### Notes
- **Fixed: asked for a 20 minute timer, the agent opened a timer *website* and left it unstarted.** It had no timer tool, and nothing told it Vex has a clock. It now starts a real Vex timer (the one in the toolbar, which rings), and can list and cancel timers.
- **The agent knows what Vex can do.** Every request now carries the feature catalogue Discover shows — 12 categories, 100+ features — and two new tools: *look up a Vex feature* and *run a Vex command*, which does whatever you could type into Ctrl+K: "alarm 7am weekdays", "stopwatch", "what time is it in Tokyo", "free memory", or any command by name. It is told to check Vex before reaching for a website. A command that clears, resets or signs out is asked about even in Auto-approve. It is also told today's date — a model's own idea of "today" is its training cutoff.
- **It can see the page.** The *screenshot* tool used to capture the page and throw the picture away. The model is now shown it (downscaled, once) — for charts, canvases, images and layouts the page text does not explain. Works on local models with vision (qwen3.5 has it; a model without is told so instead of guessing). Tested: it described a page's colours and layout correctly from a 12 KB image.
- **Stop means stop.** It used to set a flag while the model call already running carried on — 10 to 20 seconds on a local model. Stop now cancels the call in flight: measured 0.8 s from click to stopped. A stopped call is not retried on another backend.
- **Runs are kept.** The last 30 agent runs — goal, steps, answer, time, model — are listed in the AI panel's history and open again on a click. Every final answer has **Save as note** and **Copy**.
- **Scheduled tasks can research.** An unattended run may now search the web, read pages and save a note ("every morning, look up X and note it"), and works around one failed read instead of dying on it. It still cannot click, type, or touch your other tabs.
- **Settings › AI › Test this model as an agent.** Four canned questions (nothing is executed, nothing leaves the machine) tell you whether a local model picks the right tools, how fast, whether it can see screenshots, and whether the context size is enough. New setting: *Agent context size* (8K–64K).
- For the cloud agent to see screenshots the AI Worker needs redeploying with the updated `worker.js`; until then it is told it cannot see and reads the text instead.
- Releases: `npm run publish` now ends by checking the release really has its installer, block map and `latest.yml` (and is not a draft) before moving the website's badge — and refuses loudly otherwise.

## v2.31.85 (2026-09-18) — An agent that can research and act, runs on your local model, and asks the way you choose

### Notes
- **Research.** The agent has *web search* and *read a page* tools that need no tab: it searches (DuckDuckGo, Bing as a fallback), reads the best results, and answers in formatted Markdown with a Sources list. Before, "research X" meant driving a search engine's page one click at a time. It will not read addresses on this machine or your local network.
- **Acting on pages actually works on modern sites.** Typing used to write the field's value directly — React and Vue inputs never noticed — and "press Enter" pressed nothing. Typing now goes through the real input path, and `submit` presses Enter or submits the form. Clicks send the whole pointer sequence (menus that open on mouse-down now open). New: *click by visible text* (no selector needed), *press a key*, dropdowns chosen by the text you see, and reading another open tab without switching to it.
- **Vex's own features are tools now:** save a note, set a reminder ("tomorrow 9am"), add a bookmark, search your history, put tabs in a group, rename groups — on top of tabs. "Research X, save it as a note and bookmark the source" is one request.
- **Runs on your local model.** The agent was cloud-only: with no AI Worker URL it said "Cloud AI is not configured" even with Ollama running. It now uses the local model in that case, with a context window large enough that the instructions are not pushed out. Tested end to end on qwen3.5: research with sources in about 30 s.
- **Agent permission, named.** The *Ask / Plan / Auto* pills did not say what they governed (and two could light at once). Now one pill — *Agent: Approve manually ▾* — opens a menu that explains each choice: **Approve manually**, **Plan first**, **Auto-approve**. The robot button opens it the first time, before anything runs. *Plan first* is now a real plan: numbered steps, approved once. In every mode it asks before buying, paying, sending, posting or deleting — judged by Vex, not by what the model claims.
- **Sturdier runs.** One malformed reply used to end the task; it is now told what was wrong and asked again. Old tool results are shortened in the conversation so a long research run does not outgrow the model's memory. Up to 40 steps instead of 15.
- An honest limit: a small local model reads carelessly sometimes (it once called a version "latest" while listing a newer one). The cloud model is sharper; the plumbing is the same for both.

## v2.31.84 (2026-09-18) — The AI agent no longer hangs at "Agent started", and can rename tab groups

### Notes
- **Fixed: the agent sat at "Agent started: …" for ever — no step, no error, only Stop.** Its first act is to read the page in front, and on a tab with no page loaded that read never finished: a tab whose only navigation turned into a download (a `…/download/Vex-Setup.exe` link) or any empty response has no document, and Electron holds a script call until one loads. Nothing was thrown, so nothing was reported. Reproduced and measured: both page reads hung past 8 s; they now answer in about 1 ms with "This tab has no page loaded", and the agent carries on without page context.
- **Every page read and page action in the AI paths has a deadline now** (ten calls: the two page readers and the agent's click, type, select, scroll, extract, wait and search). A page that stops answering is reported after 8 s instead of freezing the agent.
- **The agent can work with tab groups.** "Rename my tab groups" was impossible before — all of its tools acted on the page in front, and groups are Vex's own. New tools: *list tab groups* (runs without asking) and *rename tab group* (asks first in Ask mode, like a click). They work with no page open. The group menu's Rename uses the same code.
- The agent still runs on the cloud backend only; without an AI Worker URL it says so rather than hanging.

## v2.31.83 (2026-09-17) — Organize Tabs with AI works on local reasoning models

### Notes
- **Fixed: Ctrl+Shift+G said "AI returned malformed response".** With a local reasoning model (qwen3, deepseek-r1…) Ollama puts the model's thoughts in a separate field, and asked for JSON the model spent its whole turn there and returned an *empty* answer — measured on qwen3.5: 1,700 characters of thinking, none of reply. Every local AI feature asks for JSON, so all of them were affected, not only tab grouping. JSON requests now tell the model not to think first; models without a thinking mode ignore the flag.
- **An empty reply is now an error that says so** — "qwen3.5 only produced reasoning and no answer" — instead of an empty string mis-read three layers up.
- **Tab grouping reads more replies and explains the rest.** It accepts JSON in a code fence, after a `<think>` block, or with a sentence either side, and otherwise says whether the reply was empty, not JSON, or cut off before it finished.
- **Faster on a local model:** tabs are sent as `t1…tn` instead of their long internal ids (each one ~20 tokens, repeated in the reply) and mapped back afterwards; an id the model invents is dropped. The same eight-tab grouping went from 21–25 s to 14 s here.

## v2.31.82 (2026-09-14) — The Discord memory notice stops coming back, and moves off the message box

### Notes
- **Fixed: the Discord memory notice returned every minute after Later.** Later only silenced the toast; the strip itself was rebuilt on the next check. Later now means four hours of quiet, and a new *Don't show again* turns memory notices off.
- **Fixed: it sat over Discord's message box.** Both notices — Discord's and a heavy tab's — are now a slim strip at the *top* of the panel or page, under the panel's nav strip in the Classic look.
- **Memory notices are a setting.** Settings › Performance › *Memory notices*: Default (tabs 800 MB, Discord 1 GB), Off, or a ceiling of your own. One setting covers both.
- **Publishing:** the GitHub release is now created before the installer and its block map upload into it, so the two uploads cannot race to create it (that race left v2.31.81 without `latest.yml` until it was patched by hand). This is the first release that arrives as a delta download for anyone already on v2.31.81.

## v2.31.81 (2026-09-14) — Delta updates, keep-awake per panel, heavy-tab notice, Health, faster launch

### Notes
- **Updates download only what changed.** Every update so far pulled the whole 98 MB installer; delta packages are now published, so from the release after this one the updater fetches a few MB of changed blocks instead. (This update itself is still a full download: the first delta needs a previous version with a block map.)
- **Keep awake, per panel.** Settings › Performance lists every web panel with a *Keep awake* switch. Discord and WhatsApp are on by default — a sleeping panel cannot show a new-message notification, which panel sleep did not say before.
- **Heavy-tab notice.** A tab past 800 MB shows a one-line notice with *Reload* while it is in front, like the Discord panel's — never automatic, never while it is recording or playing; *Later* is half an hour of quiet for that tab.
- **Health, in the Memory panel:** uptime and startup timings (app ready, window shown, interface loaded, first page), page crashes and hangs and helper processes lost since launch, extensions that failed to load, the updater's last word, reminders scheduled in Windows. Included in *Copy report*.
- **Faster launch.** The Toolbox's packs and reference tables — about 800 KB, 325 tools — load on first use (opening the Toolbox or Ctrl+K) instead of being parsed on every launch. Measured on this machine: app ready 0.2 s, window 0.6 s, interface 1.3 s, first page 2.0 s.
- **Free memory from anywhere:** Ctrl+K → "free memory", or Ctrl+Alt+M (rebindable under Settings › Shortcuts).

## v2.31.80 (2026-09-14) — Discord rests, mic and camera badges, a memory trend and one button to free it

### Notes
- **Discord rests when hidden and not in a call.** Its panel runs with background throttling off so it reconnects instantly — and left that way it burned ~35% of a core all day (3,763 s of CPU in three hours, measured). Two minutes out of sight with no call — no microphone in use, not audible, no Disconnect button in its page — and it is throttled; opening it, or a call starting, wakes it at once. Settings › Performance › *Rest Discord when hidden and not in a call*.
- **Mic and camera badges.** A tab or panel using the microphone or camera shows a red badge (the guest reports it the moment a track starts and stops). Such a tab or panel is never put to sleep, and the Memory panel names it on the Video Capture and Audio rows — the "who holds the capture services?" question answers itself.
- **Memory trend since launch** at the top of the Memory panel: total memory sampled every 30 seconds from launch, a dot for everything Vex did about it (slept tabs, slept a panel, Discord reloaded), and the change over the session.
- **Free memory now**, one button: sleep idle tabs (pinned ones idle over 30 minutes too), sleep hidden panels, unload extensions from sessions with no page open.
- **A note on uBlock Origin** in Settings › Extensions: Electron gives extensions no request blocking, and Vex blocks ad and tracker requests itself, so in Vex uBlock can only hide page elements — at ~85 MB for its background page. Nothing removed; the card says so.
- **Measured, not changed:** the interface renderer idles at 0.2% CPU with no growth across 15 open/close cycles of panels and menus; the 7% seen earlier was the Memory panel redrawing its process table every 3 s — now every 10 s. The start page's 111 MB is Chromium's per-renderer baseline (38 MB private); removing all fifteen blur filters changed nothing, so they stay.

## v2.31.79 (2026-09-14) — Idle memory: one uBlock, containers on demand, pinned tabs can sleep

### Notes
From a Memory panel report after 2.31.78: 15 processes, 1.98 GB — five copies of uBlock Origin (426 MB), three of them for container sessions with no tab open, and two pinned claude.ai tabs (550 MB) the memory guard was not allowed to touch.
- **Container sessions get extensions only while a tab is open in them**, and give them back a minute after the last one closes; the default session likewise. At startup that is one uBlock Origin background page instead of five (it was eleven two releases ago). Regular tabs and the app panels are unchanged — those load eagerly so a content script never misses the first page.
- **The memory guard may now sleep pinned tabs.** Past the memory ceiling it still sleeps unpinned idle tabs first; if that is not enough, a pinned tab not looked at for half an hour goes too. The pin keeps its place and the tab wakes on a click. (Two pinned claude.ai tabs also kept Chromium's capture and audio services alive — 236 MB — through their microphone access; they go when the tabs sleep.)
- **The process list explains the utilities**: what Video Capture, Audio, Network and the DRM service are each for, and when they end.

## v2.31.78 (2026-09-14) — Less memory: extensions only where they apply, panels that sleep, and a process list you can read

### Notes
Measured on a real machine before this release: 27 processes, 3 GB resident. A third of it was the Discord panel; ~390 MB was eleven idle copies of uBlock Origin; every sidebar panel ever opened stayed resident.
- **Extensions load only where they apply.** Browsing sessions get every extension. A sidebar panel's session (Discord, WhatsApp, Claude, Spotify, Prime, Roblox) gets an extension only when its content scripts name that site — Vencord goes to Discord, RoSuite to Roblox, a generic one such as uBlock Origin (Manifest v2, a persistent background page) to browsing only: 5 copies instead of 11, six processes fewer. Settings › Extensions shows *Runs in: browsing tabs + Discord* per extension, with a switch to run it everywhere; the change applies live.
- **Hidden panels sleep.** Claude, Spotify, GitHub… give their process back after the same idle time as tabs (10 minutes under Memory Saver), never while playing audio, and come back fresh on the next open. Discord is kept awake by default (voice, notifications); both are switches under Settings › Performance. Right-click a panel's icon → *Sleep panel*.
- **Discord memory notice.** Past 1 GB the Discord panel shows a one-line notice with a Reload button (and a toast, at most every half hour). Never automatic — a reload drops a voice call.
- **The Memory panel shows everything now.** A *Panels* section with real MB per panel (Sleep / Reload / Open), and a *Processes* section naming every process Vex runs — *Panel: Discord*, *Tab: Hacker News*, *uBlock Origin — background · persist:main*, *GPU process*, service workers — with resident and private memory and CPU, totals per kind, and a *Copy report* button that gives a plain-text table you can paste anywhere.
- **Fixed:** the Today snapshot read "today" from a second clock and drifted across midnight; a sleeping row in the Memory panel showed a stray `U0001f4a4`.

## v2.31.77 (2026-09-13) — Two panels: a + in the header, a divider to drag, swap sides

### Notes
- **The Chrome, Safari and IE looks can do it too.** Those looks have no icon rail to Shift+click or right-click, so the panel header now has a **+** that lists the other panels to open beside this one (and *Swap sides* once there are two), and a chip — *+ Claude AI ×* — that names the second panel and closes it.
- **Drag the divider** between the two panels to change the share (20–80%); Vex remembers it. Double-click the divider, or use *Swap sides* in the menus, to exchange them.
- **Fixed:** in the Classic look, Discord beside Claude — two web panels — would have stacked one below the other instead of side by side.
- **Fixed:** hiding a sidebar button in Settings › Sidebar, or unpinning a site, while it was the second panel left it on screen.
- **Fixed:** the Start button could be opened beside another panel, showing an empty half.
- Settings › Sidebar explains the three ways in.

## v2.31.76 (2026-09-13) — Two panels at once, panels open full size, readable suggestions

### Notes
- **Claude beside Discord — both usable at once.** Shift+click a sidebar icon, or right-click it and choose *Open beside Discord*, and the panel opens next to the one already open, half the area each. Vex remembers the pair: open either later and the other comes with it, until you click the second panel's icon again (or right-click → *Close beside*), which forgets it. Settings never shares.
- **Panels open maximized in the browser looks.** Discord, Claude, Prime, Roblox are whole apps; in the Chrome, Safari, Firefox and Glass looks a panel now opens taking the whole page area. Press Restore in the panel header to put it back in the sidebar, and it stays that way until you press Maximize again.
- **Fixed: the first search suggestion could not be read in the Chrome-style looks.** The row under the pointer — the first one, right below the address bar — was blue text on a blue bar, because those looks map both the row's fill and its text to the same accent colour. It is now a light tint with ordinary text, as in a real omnibox. (Nothing is pre-selected; it was the pointer resting there.)

## v2.31.75 (2026-09-13) — DevTools open again from everywhere

### Notes
- **Fixed: the developer dashboard's Open DevTools said "not exposed in this build".** It called a bridge method that did not exist. It now opens the interface's own inspector, docked at the bottom, and closes it on a second press.
- **Fixed: Open DevTools on a sidebar panel could silently do nothing.** A panel whose page had only just attached reports its id as -1; that was rejected before the code that finds the page by its address could run, and the only report was a line in the console. Both gates now let the address lookup happen (with the same ownership check), and if it still cannot open, a message says so.
- The DevTools window is brought to the front when it opens.

## v2.31.74 (2026-09-13) — The setup wizard asks about the settings that matter

### Notes
- **Three new steps on first run.** *How the browser behaves* — where tabs sit, mouse gestures, cookie banners, sites that block copying, session auto-save, tab-group suggestions. *What Vex may read* — AI history indexing and email-code autofill, explained in plain words before they are on. *Notifications* — a test button that says whether Windows showed it, and where to look if not. Each step shows the current value and applies through the same code as Settings.
- **The performance step now really offers the nine it promised.** It listed seven: pinned-tab exemption and the memory guard were missing.
- **Fixed:** the Look and Performance steps were shown as unset every time the wizard was reopened, because two steps recorded "done" one way and the check read it another.
- 22 steps in all; everything is still skippable, and everything lives in Settings afterwards.

## v2.31.73 (2026-09-13) — Sentences in Ctrl+K, snooze on the toast, a weekly review, reminders that follow you

### Notes
- **Plain sentences in the command bar.** Type "remind me to call Dana tomorrow 9am", "timer 25 min tea", "alarm 7am weekdays", "what time is it in Tokyo" or "stopwatch" into Ctrl+K and press Enter. No panel.
- **Snooze from the notification.** A reminder's Windows toast now has Snooze 9 min and Open buttons. Each launches a vex:// link that Vex reads — it works even after the toast has sat in Action Center.
- **A weekly review.** Every Friday at five a reminder opens one honest card: what fired, what got snoozed, what you saved and never read, which watched pages changed, which tools you used. Also under Ctrl+K → Weekly review and in the Work panel.
- **Reminders follow you.** With Vex Sync on, a reminder set on one machine rings on the others while they are open. Only the machine that set it wakes Windows for it, and one that fired anywhere never fires twice. Nothing is deleted by a sync.
- **Alarm tone and volume**, with a preview: four tones, a slider, and insistent or gentle (once, then every thirty seconds).
- **Work, apart from the rest.** Reminders and alarms carry the job they were set under; Today marks them and the Work panel lists what is set for this job.
- **The new tab's Recent list shows real visits.** It had been a placeholder since it was added.
- `scripts/verify-reminders.js --exe <path>` drives an installed Vex.exe. Ran it against the installed 2.31.72 with Vex closed: Windows launched Vex.exe and the toast was delivered at 17:47:00.9 — the packaged path, confirmed.

## v2.31.72 (2026-09-13) — A Clock: alarms, timers, stopwatch, world clock

### Notes
- **A Clock panel in the sidebar** (and Ctrl+K → Clock) with four tabs.
- **Alarms ring.** Time, days of the week, a label — and an audible alarm that keeps sounding until you press Dismiss or Snooze (9 minutes). An alarm is a reminder underneath, so it gets the Windows wake-up: it rings even if Vex was closed. Repeating alarms roll to the next chosen day and ring again until dismissed again.
- **Timers.** "25 min", "1h 30", "90s" or 10:00, several at once, with presets. The nearest one ticks in the top bar; click it to open the Clock. A timer of a minute or more keeps counting through a reload and ends with a desktop notification as well as the alarm.
- **A stopwatch** with laps.
- **A world clock** for the cities you pick — live times, day or night, the offset from you — and a slider for "what time is it there when it is 3pm here". Any IANA zone works too. The cities also appear on the new tab page.
- **Reminders in another city's time.** "9am New York time" or "tomorrow 17:00 in Tokyo" lands at that moment, read back in both clocks before it saves.
- Verified live: an alarm set for 15:46 rang at 15:46 with the sound loop running, Dismiss recorded it and rolled it to the next Sunday.

## v2.31.71 (2026-09-13) — Reminders that repeat, follow pages and sites; Today on the new tab

### Notes
- **Reminders can repeat** — every day, weekdays or every week, at the same time. Each occurrence gets its own Windows wake-up task, so "weekdays 9am" still arrives with Vex closed.
- **Remind me about this page.** The dialog offers the page you are on; the reminder's notification opens it in Vex with an Open page button. "Come back to this" now brings you back.
- **Next time I open this site.** Type "when I open github.com" instead of a time and the reminder fires the moment a tab lands there. A one-click chip offers the current site.
- **Right-click any selection** — a Discord message, a paragraph, a task — for *Remind me about this*, *Save as a note for this page*, or *Ask Vex AI about this*. Works inside the sidebar panels too.
- **Today, on the new tab page:** reminders due today, scheduled tasks about to run, watched pages that changed, and pages you saved recently, together.
- **Focus holds your reminders.** During a focus session they wait and arrive as a batch when it ends, marked with the time they were due — unless you ticked Urgent.
- **Every tool keeps its last ten results** (loaded back with one click) and the Toolbox shows the tools you opened most recently beside your favourites.
- **Any timed reminder can be saved as a calendar entry** (.ics, repeat rule included) for Outlook or Google Calendar.
- Verified live in a real window: a site reminder fired on navigation, the urgent reminder fired mid-focus while the normal one waited, and the new tab page rendered the day's reminder.

## v2.31.70 (2026-09-13) — Website notifications, a test button, snooze

### Notes
- **Notifications from websites work now — Discord, WhatsApp, anything you allow.** They never had. The prompt granted them, then Vex refused them at display time: decisions were stored under the origin without a trailing slash, and the check Chromium runs before showing a notification was handed the origin with one, so an allowed site never matched its own decision. Measured live — navigator.permissions.query said "denied" seconds after Allow. Both spellings now agree. Sites you allowed in the past are honoured without asking again.
- **Settings › Site permissions has a "Send a test notification" button.** It says, in words, whether Windows showed it — and where to look if you did not see it. Notifications failed silently for the app's whole life because nothing ever checked.
- **Clicking a reminder's notification opens the reminder in Vex**, with the full text, when it was due, and Snooze 10 min / 1 hour / Tomorrow 9am. If the desktop notification was refused, the reminder opens in Vex by itself instead of being lost.
- **Reminders appear in the Schedules panel** alongside scheduled tasks, with a way to remove them and a "Remind me" button — one place to see everything that will happen.
- `scripts/verify-reminders.js` boots the real app and proves the whole path — the Windows task, the toast, the cleanup — and with `--closed` that Windows wakes a quit Vex. Gated behind VEX_SMOKE_REMINDERS=1 because it takes two and a half minutes and shows a real notification.

## v2.31.69 (2026-09-13) — Notifications that show, reminders that fire with Vex closed

### Notes
- **Desktop notifications work — for the first time.** Vex's interface is a file:// page, and Chromium refuses that origin the Notification API outright: the permission read "denied" before anything asked, and the one prompt that did appear said "null wants to send notifications". Every notification Vex had ever tried to send — scheduled reminders, page-change alerts — was silently dropped behind a check that could never pass. They are now sent by the main process, which Windows accepts, and which reports whether the toast actually showed. A refused toast is said in-app, with the reason, rather than lost.
- **Reminders fire even when Vex is closed.** A reminder now lives in the main process with its own timer, so a reload cannot lose it — and on Windows a matching one-shot task in Task Scheduler launches Vex at the minute if it is not running. Set one, quit Vex, and the notification still arrives; the task cleans itself up afterwards. Verified live in both states: a reminder set for 13:28 showed at 13:28:00.002 with Vex open, and one set for 13:31 showed at 13:31:00.5 from a Vex that Windows started.
- A reminder missed while the machine was off fires on the next start, marked with the time it was due. Nothing ever fires twice.
- The Remind me dialog lists what is set and lets you take one back. If Windows refuses to create the wake-up task, the dialog says so when you save, instead of you finding out on the day.
- A development run is headed "Vex" too, not "Electron". Windows names a toast after the Start Menu shortcut targeting the process; Electron writes one named after its own exe on the first toast, and that stale shortcut was winning. A source run now removes Electron's shortcut for this binary at startup and writes its own, carrying Vex's identity. The installed app was always headed "Vex".

## v2.31.68 (2026-09-13) — Remind me, and a restart button

### Notes
- **Paste a task, say when, and Vex tells you later.** Ctrl+K → **Remind me**. One box for what you have to do — pre-filled with any text you had selected — and one for when. It understands "in 2 hours", "in 45m", "tomorrow 9am", "friday 17:00", "tonight", "noon", "2026-09-20 14:00", and a bare time like "6pm" that means today if it is still ahead and tomorrow if it is not. Five one-click chips cover the usual ones.
- **It reads the time back before it saves anything.** The line under the box says "Tomorrow at 09:00 — 19 hours from now", so you can see Vex understood the same thing you meant. An unreadable phrase, an impossible hour, a date that does not exist or a moment already past each say what is wrong instead of quietly landing somewhere unexpected.
- Reminders are ordinary scheduled tasks, so they appear in the Schedules panel, survive a restart, and one missed because Vex was closed still arrives when you open it.
- **A Restart Vex button in the developer dashboard,** beside Reload the interface. Reloading re-runs the interface — js, css, index.html. It cannot pick up changes to the main process, the preload scripts or site tweaks, because those ran before the window existed; editing one and reloading looks exactly like the edit did nothing. Both buttons now say which changes they cover.

## v2.31.67 (2026-09-13) — A reference beside every tool

### Notes
- **Every tool now explains itself.** All 303 pack tools open with a written reference panel — roughly 30 000 words across 887 sections and over a thousand table rows. Not a restatement of the tool's name: the HTTP status codes people confuse, the chmod bits and what they mean on a directory, why a US gallon is a fifth smaller than an imperial one, when a fraction terminates, what a wet-bulb temperature of 35 °C means, why banker's rounding exists. Previously only BMI had one.
- **The reference says where a method breaks down.** The Luhn check proves a typo was not made and nothing else. A user-agent string has lied since the 1990s. BAC calculators must never decide whether you drive. CRC-32 catches accidents and is trivially forged. The tool gives you the number; the panel tells you what it is worth.
- **BMI goes from three fields to six.** Waist, age and the Asian threshold set join weight and height, and the answer now includes your band's range, the healthy weight range for your height, how far you are from it, BMI Prime, the Ponderal index, body surface area, waist-to-height ratio and an age-appropriate note. Two of its own worked examples were wrong and are corrected.
- **The Work panel is rebuilt.** It was twenty-seven inline styles and a cramped grid of icon-and-name tiles that told you nothing about what a tool did. Now the job identifies itself, "Ask Vex AI" is one prominent action that says honestly where your message would go, and your tools are a readable list with their descriptions.
- **Fixed:** an answer from Vex AI that mentioned several features could offer no shortcuts at all. The chip list was capped before checking whether a feature could actually be opened, so entries you work by hand crowded out the ones you cannot.
- Discover now covers the reference panel, the two tool sizes, favourites, developer mode and the developer dashboard.

## v2.31.66 (2026-09-13) — Favourites, a way back, and a developer mode

### Notes
- **Opening a tool no longer loses your place.** A tool opened from the Toolbox now has a back button that puts the launcher back exactly as you left it — same search, same filter, same scroll position. Before, closing a tool dropped you at the browser and finding the next one meant starting over.
- **Star the tools you use.** A star on every card, and a Favourites section at the top whenever you open the Toolbox.
- **A developer mode.** Turn it on from Ctrl+K and a dashboard appears — beside the Toolbox button and in the sidebar. It shows what Chromium is running, how many tabs and webviews are live, what is in storage and which values are largest, plus quick actions: reload the interface, open DevTools, copy diagnostics for a bug report, clear AI conversations, reset tool preferences, open five test tabs, replay the setup wizard, and reset Vex.
- It is a mode rather than a theme, so it works under every look. Reset Vex asks you to type the word first, and leaves anything that is not Vex's own data alone.

## v2.31.65 (2026-09-13) — Every tool on the workbench

### Notes
- **All 340 tools now open on the same workbench.** Settings column, live results as you type, remembered options, copy, swap, and the two sizes — compact, or full screen with a reference panel beside it. Previously eight tools had this and the other three hundred opened in a stack of labelled boxes.
- **The reference panel is built for every tool** from what it already knows: what it does, its family, its other names, and worked examples you can click to load.
- **The last seven hand-built tools are rebuilt.** Regex shows every match with its position and each capture group by name or number, and can replace or split. CSV parses properly — quoted commas, doubled quotes and newlines inside cells all survive — and converts to a table, JSON, Markdown or clean CSV. UUID does v4 and time-ordered v7, and reads one apart. Password reports real entropy and crack times. Colour does WCAG contrast with AA/AAA grades and a matching palette. Cron explains every field and lists the next real firing times. Markdown renders, strips to plain prose, or shows the heading outline.
- **22 new tools.** Punycode/IDN with a warning when a domain mixes scripts the way a lookalike does; a float inspector that shows why 0.1 + 0.2 is not 0.3; a subnet calculator; CRC-32; Shannon entropy; XOR and Vigenère; a User-Agent reader; px/rem/em conversion; a cubic-bezier evaluator; layered box-shadows; media query ranges; umask; .gitignore starters; Open Graph tags; JSON to YAML or TOML; HTTP status codes; line deduplication; slugs; placeholder text; a character inspector that names invisible characters; and a version-range explainer.
- Errors are shown rather than swallowed, and an empty input no longer greets you with the tool's own error message.

## v2.31.64 (2026-09-13) — Tools worth opening

### Notes
- **Tools now have two sizes.** The panel you get by default, and a full-screen mode that fills the window — and is not just bigger: a reference column appears alongside, explaining the formats, the rules, and worked examples you can click straight into the input. Each tool remembers which size you prefer.
- **A proper settings column, on every rebuilt tool.** Options, a Run button, live auto-update as you type, and Remember input — so a tool is something you configure, not one box and a guess.
- **Base64 does what Base64 actually needs to do.** It handled exactly one case before: standard, padded, UTF-8. It now decodes Base64URL (`-` and `_`), IMAP mailbox names, a custom alphabet you choose, and unpadded input — which is what a JWT gives you, and what used to come back as "Not valid Base64". It puts the missing padding back, copes with quotes and newlines from a paste, and reads or writes text, hex or raw bytes. When it cannot decode something it names the character that stopped it.
- **Seven more rebuilt the same way:** Hash (SHA-1 to SHA-512, HMAC, hex/Base64/Base64URL), URL encode (component or whole URI, form-style spaces, and breaking a URL into its parts), JSON (format, minify, sort keys, with the line and column of a syntax error), JWT (header, payload and real dates — and it says plainly that it does not verify the signature), Timestamp, Change case (13 forms at once) and Word count.
- Errors are shown, never swallowed: a tool that quietly produces nothing looks identical to a broken one.

## v2.31.63 (2026-09-13) — Vex AI writes as it thinks

### Notes
- **Answers appear as they are written.** A local model is slow, and Vex used to hold the whole reply back until it was finished — a long stare at a spinner. The text now arrives as it is generated, with the reasoning filling in first, so you can see it working instead of wondering whether it is stuck.
- **Anything the AI mentions, you can open.** When an answer names a Vex feature, a button to open it appears underneath. No hunting for the thing you were just told about.
- **Your chats no longer vanish with the tab.** Closing a tab used to delete its conversation — Recent chats would tell you your own chat could not be reopened. Chats are kept now and open in place, with a note saying which one you are looking at and a way back. Chats from private tabs are still never written to disk.
- **Filter the personas.** With 25 of them the list was a scroll; now it is a search.
- **Switching apps no longer closes the panel.** Clicking into a page still dismisses it, which is the point — but alt-tabbing away and back used to lose your place.
- **No emoji in replies.** Vex's interface is drawn icons throughout; a model does not know that and will open with a smiley. They are stripped from replies by default. It only strips — nothing is reworded, and copy still gives you exactly what the model said.

## v2.31.62 (2026-09-13) — Vex AI: thinking, and answers that know what Vex is

### Notes
- **See what the model was thinking.** Reasoning models (qwen3, deepseek-r1 and the like) work through a problem before answering. Vex was throwing that away — and worse, it was breaking the reply parser, which then had to scrape the answer back out of the raw text. The reasoning now appears as a "Thought for N words" dropdown above each answer, folded away until you want it, and it stays with the conversation.
- **The Thinking circle spins again.** It was frozen, not slow. Vex collapses animations when Windows is set to reduce motion — sensible for sliding and spinning, but it also froze the one thing whose whole job is to show that something is happening. The spinner now pulses instead of rotating: still obvious, still no motion.
- **Ask what Vex can do and get a real answer.** The AI only ever had the text off the page in front of it, so on a new tab it answered by reading the new tab and described the shortcut bar as though that were the browser. Questions about Vex now come with Vex's own list of its 137 features, and the model is told to say it is unsure rather than guess.

## v2.31.61 (2026-09-12) — Vex AI, rebuilt

### Notes
- **Two modes.** The panel you know on the right, and a new full-screen mode that takes the window and centres the conversation in a readable column. The button is in the panel header, or Ctrl+Shift+F, and Vex remembers which you prefer.
- **It closes when you click away.** Clicking elsewhere, pressing Escape, or clicking into the page now dismisses it. Before this it only closed from its own ✕, so it sat there until you went back and shut it.
- **The panel is mostly conversation now.** Six rows of controls used to sit between the header and the first message — persona, prompts, tabs, agent mode, quick actions — leaving the chat whatever height was left. They are one row in the composer, and the starters only appear on an empty chat.
- **It matches your theme.** Every colour comes from the same theme tokens as the rest of Vex, so it follows whichever look you are using instead of carrying its own.
- **25 personas, up from 5.** Summarizer, Devil's Advocate, Shopping, Security, Tutor, Translator, Data, Brainstorm, Reply, Fine Print, Debug, Query, Kitchen, Newsroom, Plain Language, Numbers, Travel, Paper, Product and Tab Wrangler — each written to change the answer, not just the label.
- **More to work with:** new chat, recent chats, export a conversation to a file, copy any message, retry an answer, and edit a question to ask it again.

## v2.31.60 (2026-09-12) — Your job's tools are back

### Notes
- **Every tool your job recommends is available again.** v2.31.58 shortened those lists to only the tools with a drawn icon, which cut some jobs down hard — Frontend Developer went from 11 tools to 1. That was the wrong fix for the wrong place: the tools that looked out of place were the loose buttons in the top bar, and those are gone as of the previous release. The lists are restored.
- **If you were on v2.31.58, your tools come back on their own.** Anything that version removed is put back the next time Vex starts, merged with whatever you have now, so a tool you added since is kept too.

## v2.31.59 (2026-09-12) — Everything in the Toolbox, and Vex AI beside it

### Notes
- **The loose tool buttons in the top bar are gone.** Setting a job put up to three individual tool buttons next to the Toolbox icon, and those rendered a typographic mark (".*", "{ }", "Aa") instead of a drawn icon — so they sat there looking nothing like the button beside them. Every tool now lives inside the Toolbox, which is one click away in the same place.
- **A Vex AI button, right next to the Toolbox button.** Opens the AI chat. If the panel ever cannot open it says so instead of doing nothing.

## v2.31.58 (2026-09-12) — Job tools: only the ones with real icons

### Notes
- **The tools without a proper icon are gone from your job.** 137 of the 318 tools are marked with a typographic sign (".*", "{ }", "Aa") rather than a drawn icon, and mixing the two kinds is what made the Work panel look inconsistent. A job now only recommends tools that draw a real icon, and a profile set up before this change has the others dropped from it once, automatically. Nothing is deleted — all 318 are still in the Toolbox, and a tool you add yourself from the picker's search stays put.
- Across the 420 job profiles this removes 28% of the recommended tool slots. No job is left with nothing, but 33 end up with only one or two — the technical jobs most of all, because dev tools are overwhelmingly the typographic-marked ones. Frontend Developer goes from 11 to 1.

## v2.31.57 (2026-09-12) — Work tools, and a leak that grew all day

### Notes
- **Your job's tools all look the same now.** 137 of the 318 tools are marked with a typographic sign (".*", "{ }", "Aa") rather than a drawn icon, and those were being dropped into the page as plain text — so in the Work panel they came out at a different size and alignment from the rest. Every tool icon now sits in the same box, whichever kind it is.
- **Ask Vex AI, from the Work panel.** A new button next to your tools opens the AI chat with your profession as context, so the first answer is about your work. It says where the AI will actually run — your local model by name when one is running, the cloud when it is not — and it says "checking" while it finds out rather than guessing.
- **Closing a tab now actually frees it.** Every tab left its page element and around 28 event listeners behind for as long as the window stayed open. Opening and closing 40 tabs left 38 of them still in memory; the browser got heavier all day and only a restart cleared it. Most of that is now released the moment a tab closes.

Some of the remaining growth is inside Electron's own webview implementation rather than Vex, so this reduces the problem substantially without ending it completely.

## v2.31.56 (2026-09-12) — Buttons that pretended to work

### Notes
Three things in the interface looked fine and did nothing at all when clicked. None of them reported an error, which is why they survived this long.

- **"All Sticky Notes" now opens.** The button meant to show every sticky note you have left on pages did nothing — not even the fallback list it was supposed to drop back to, because the code it called wrongly believed it had succeeded.
- **"Manage personas" now opens.** Same cause, same silence. If it ever cannot open, it now says so instead of looking like a dead button.
- **Discover can open Discord, Netflix and the authenticator.** All three are listed in Discover, but their Open button was missing because they are side panels rather than commands or settings.

A new test scans the whole interface for the mistake behind the first two — code reaching for a module through `window` when that module was never put there — so a button can no longer fail this way in silence.

## v2.31.55 (2026-09-12) — The parts that were never checked

### Notes
No change to how Vex behaves. This release closes the last gaps in the audit — the areas previously written off as needing a login, a backend, or a censored network.

- **The AI features were driven against a real backend.** A server speaking Ollama's protocol was stood up so chat, summarising, tab grouping, AI memory and Restyle all ran their genuine paths. They handle a well-behaved answer, an answer in the wrong format, a reply cut off half way, and a backend that returns an error — the last of which shows the problem and offers to retry, rather than an empty bubble.
- **The installed app was checked, not just the source.** The build users actually download was assembled and driven: every feature added this month is present in it, Discover lists all 137 features, all 318 tools load, protected video playback is ready, there is no emoji anywhere in it, and a hostile page title still cannot reach the interface.
- **The Roblox and Discord bypass now has tests**, including the case that broke it: Discord's auto-configure restarting the shared connection helper while Roblox was using it. Verified live as well — it starts, connects, and switches off cleanly.
- **Keeping one Vencord build** — the rule behind "installing my build does nothing", where a disabled folder with a newer date beat the working one — is now covered too.

## v2.31.54 (2026-09-12) — Nothing left unaudited

### Notes
No user-visible change in this one: it is the last of the auditing, and everything it checked turned out to be sound.

- **Your data really does come back.** Ten kinds of saved thing — bookmarks, read-later, notes, skills, your own tools, automations, AI memory, start-page shortcuts, history and watched pages — were written in a running browser, the browser was killed outright, and every one of them was still there on restart. Unit tests stand in for the storage layer, so only a real restart proves this; it is the check that caught history being erased a few releases ago.
- **The two remaining parts of the engine room now have tests.** The piece that decides which window owns which page — the gate every internal request is checked against — and the one that talks to the updater. Between them they pin that a page cannot be given more privileges than it should have, that one window cannot act on another's tabs, that only Vex's own interface counts as the interface, and that update progress is reported honestly.

## v2.31.53 (2026-09-12) — Deleting one thing no longer deletes two

### Fixed
- **Deleting a bookmark could delete a second one with it.** Every saved list — bookmarks, read-later, sessions, workspaces, automations, command chains, your own tools, AI memory, watched pages, skills, MCP servers, pinned sites — gave each entry an identity built from the clock alone. Two things saved in the same millisecond ended up sharing one, and since deleting works by matching that identity, removing either removed both. Nothing warned you; the second item simply stopped existing. All thirteen now get an identity that cannot collide, and a test refuses to let a new list do it the old way.

### Notes
- Six panels that had never been driven — bookmarks, library, feeds, highlights, authenticator and the queue — were exercised with real data in a running browser: all render, all survive being closed and reopened, and none of them turn a hostile title into markup. The feed reader was checked with a deliberately malicious RSS item title and showed it as plain text.

## v2.31.52 (2026-09-12) — A website's name can't reach into Vex

### Fixed
- **A website could put its own markup inside Vex's window, just by choosing its title.** Press <kbd>Ctrl</kbd>+<kbd>K</kbd> and look at your history — or search your open tabs — and each page's title was placed into Vex's own interface as markup rather than as text. A site titled `<img src=x onerror=…>` got that element created inside the browser's own window, which is the part that can reach your tabs, your settings and your saved passwords. Vex's content-security rules stopped the script itself from running, so this was one layer short of the worst case, but the injection was real: a crafted title could still make the browser fetch from the site's server the moment you opened your history. Titles are now placed as text, in one place, so no future result can reintroduce it.
- **Sixteen emoji were still hiding in the source** — the whole right-click menu, and the GitHub panel — written as escape codes rather than as characters, which is why the earlier sweep walked past them. The check that guards against this now decodes them too. The GitHub panel's stars and forks kept their meaning as drawn icons rather than losing it.
- **The AI was still being asked to invent an emoji for every tab group**, months after the groups stopped showing one. It was generated, paid for in tokens, and thrown away.

### Notes
- The password vault now has tests of its own — it had none, and it is the most sensitive thing Vex stores. They pin the parts that matter: passwords never travel on the channels meant for metadata, a vault that cannot be encrypted refuses to save rather than falling back to plaintext, a corrupt vault says so instead of looking empty, and a look-alike hostname gets nothing.
- Also checked and found sound: the permission gate on every internal channel (an unknown one is refused outright), and Recall's search snippets, which escape page text correctly.

## v2.31.51 (2026-09-12) — Websites can no longer read your clipboard

### Fixed
- **Any website could read whatever you last copied — silently.** Vex granted the clipboard-read permission automatically, so a page could call `navigator.clipboard.readText()` with no prompt, no button press, and no sign anything had happened. Proved against a real page in a running browser: it read the clipboard back word for word. This matters more in Vex than in most browsers, because Vex has a password vault with a Copy button and an authenticator that copies one-time codes — so "whatever you last copied" is regularly a password or a login code. A page now has to ask, exactly as it does in Chrome, and the request says in plain words what it wants: *"wants to read what you last copied"*. Writing to the clipboard is unchanged — that is an ordinary copy button and gives nothing away.

### Notes
Three sweeps behind this release. Two of them found nothing, which is worth saying out loud:

- **All 318 Toolbox tools** were opened in a running browser. Every one rendered a working screen — no crashes, no "NaN" or "undefined" in the output, nothing overflowing its box.
- **All 35 Settings categories**: every chip leads somewhere real, every section belongs to a category, and all 34 switches and dropdowns were toggled through every value without a single error.
- **The main process** was the one that turned something up. `permissions.js`, `session-security.js`, `updates.js` and `vault.js` had never had tests of their own; the permission policy now has one, pinning what Vex hands over without asking.

## v2.31.50 (2026-09-12) — Float the video, not the website

### Added
- **Picture-in-Picture floats the video itself.** When a site refuses native PiP, Vex used to reload the *entire site* in the little window — a second copy of the page, its own player, its own ads, while the tab carried on playing behind it. It now opens a bare player holding just the video, at the moment you were up to. Sites that stream in pieces (YouTube, Netflix) still can't be floated that way — their video only exists inside their own page — so those keep the whole-page fallback and Vex now tells you that is what happened, instead of leaving you to wonder.
- **Close the floating player and the tab picks up where the player got to.** Watch five minutes in the little window and the tab no longer sits where you left it.
- **"New to you" in Discover.** The first thing Discover now shows is everything you have no record of ever using, counted, with "Show me these" to walk through them. Vex remembers your last 60 commands, so it says that plainly rather than claiming you have never touched something.
- **The interface speaks Turkish, not just the setup wizard.** Choosing Turkish used to translate the wizard and the start page and leave every other label in English. The toolbar, the sidebar panels, the common buttons and the main Settings headings now follow — about 90 labels in a normal window. Tooltips keep their shortcut (*Geri (Alt+Left)*). It is not the whole interface yet, and anything without a translation stays in English rather than being guessed at.

### Notes
- Translation matches the English text rather than requiring every element to be tagged, which is the only way to cover UI built across dozens of files. It is therefore confined to the parts of the window Vex draws itself — never page content, never a tab title, never anything you typed.
- Two hunts came back empty this release, which is worth recording: **every one of the ~190 command-bar entries** was invoked in a running browser and none failed, and a scan for the "declared twice, dies silently" bug that had killed the GitHub activity widget found no other instance.

## v2.31.49 (2026-09-12) — The start page, audited

### Fixed
- **A shortcut could run code on your start page.** Shortcut names went into the page as markup rather than as text, so a shortcut called `<img src=x onerror=…>` executed its script. That matters because shortcut names are not only your own typing: they travel in the **shared setup codes** Vex invites you to send to other people, and in **Vex Sync** between your devices. Your own "My Tools" entries had the same hole, and so did **GitHub commit messages** — those come straight off the API, and anyone who lands a commit in a repo you push to can write one. All of them are escaped now, and a test fails the build if a new one appears.
- **"Recent GitHub Activity" had never worked, on any version.** A variable was declared twice, so the code threw before it ever reached GitHub — into a `catch` that had been written to say nothing at all. The panel just stayed empty for everyone who set a username. It works now, and it says so when it cannot load instead of sitting there silent.
- **The "Change location" button on the weather card had exactly the same fault as the setup wizard** — five matches, always in Turkish. Manchester and Springfield have about a hundred matches each, so the one you wanted usually was not among them. It now has the same country → city/district/postcode picker, showing each place in full (*Manchester · England · United Kingdom*), and a real message when a place exists but not in the country you chose.

### Notes
- The two location pickers were separate copies of the same code carrying the same bugs. They are one module now, so they cannot drift apart again.
- Every one of Vex's command-bar entries — about 190 of them, the way into nearly every feature — was invoked in a running browser as part of this sweep. None of them failed.
- 35 new tests, 2,764 in total.

## v2.31.48 (2026-09-12) — Picture-in-Picture, audited

### Fixed
- **You heard the video twice.** When a page refuses native Picture-in-Picture, Vex falls back to a pop-out window — which loads the same page again, so there were two players running side by side, drifting out of sync. The tab the video came from is now muted **and paused** while the pop-out is up, and given its sound back when the pop-out closes. A tab you had already muted yourself stays muted.
- **“Back to tab” did not go back to the tab.** It only brought the Vex window forward, leaving you on whatever tab you had wandered to since. It now switches to the tab the video came from, and says so if you have closed that tab in the meantime.
- **The PiP button on the video itself did nothing on pages that block Picture-in-Picture.** It logged to the console and gave up, while the toolbar button and `Ctrl+Shift+P` opened the pop-out. Same feature, two entry points, one of them silently dead — it now falls back the same way.
- **That button never appeared at all on some pages.** If the video had no element to anchor to, the button was built and then dropped on the floor. It is also no longer possible to stack duplicate hover handlers on a container holding several videos.
- **“Back to tab” on a sleeping or discarded tab** had nothing to return to, because the tab was only remembered when its page was live.

### Notes
- Picture-in-Picture moved out of `app.js` into its own module so it can be tested: the pop-out’s control bar lives in a closed shadow root, so nothing outside that window can click it, and the only way to check what its buttons do is to exercise the code directly. 13 new tests.
- The audit also confirmed what already worked: video detection and the toolbar button, the pop-out’s control bar surviving a page that rewrites the DOM, Escape and Ctrl+W closing it, the crash and unresponsive guards, remembered size and position, the pin toggle, refusal of `file:`/`javascript:` URLs, and the window never being left behind when Vex closes.

## v2.31.47 (2026-09-12) — Discover: every feature, introduced

### Added
- **Discover — everything Vex can do** (`Ctrl+K` → “Discover”). Until now the only complete list of what this browser does lived in the README on GitHub, which is no use to anyone actually using it. Discover is that list, in the app: **137 features in 12 categories**, searchable. Each one says in a sentence what it is *for*, and has two buttons — **Show me**, which spotlights the real control on your screen, and **Open**, which just runs it. Pick a category and “Tour this category” walks its features in turn.
- **A feature you switched off is still listed**, marked off, with **Turn on & show me** — a feature you cannot see is one you cannot discover, which was the whole problem.
- **The setup wizard offers every look**, not just Glass and Classic: Chrome, Chrome dark, Firefox, Firefox dark, Safari, Internet Explorer on XP and Netscape on 98, each applied instantly so the window behind the wizard is the preview. Choosing Classic also asks where you want your tabs.
- **A “Speed, memory & privacy” step** in the wizard. These settings decide how the browser actually behaves — whether tabs sleep is the difference between 800 MB and 4 GB — and every one of them used to be a silent default. Pick **Balanced**, **Save memory**, **Maximum privacy** or **Leave it all off**, each stating plainly what it does, or open the list and set all seven yourself. Everything is written through the same controls Settings uses, so the two can never disagree.

### Fixed
- **The weather step could not find your city.** It asked for the **five** best matches **in Turkish**, whatever language you had chosen. Manchester has about a hundred matches and Springfield the same, so the right one usually wasn’t among the five — and searching an English name against Turkish results often matched nothing at all. Now you choose your **country** first, then search a **city, district or postcode**, and pick the exact place from a list that shows its full hierarchy (*Ataşehir · Istanbul · Türkiye*), with postcodes where the place has them.
- **The weather step used to guess.** If you typed something and never picked a match, it quietly saved whichever place the geocoder ranked first — which is how you end up with the forecast for a town you have never been to. It no longer guesses.
- **The setup wizard accepted empty and invalid answers in silence.** Your name, GitHub username, AI worker URL, sync worker URL and weather all took a blank — or nonsense — and moved on as if you had set them, so people finished setup believing they had configured things they hadn’t. Every field is now checked: it tells you what is wrong (*“this is empty”*, *“that is not a GitHub username”*, *“use https://”*) and you either fix it or press **Skip** deliberately. Skip is always there and always works.
- **Discover’s catalogue cannot drift.** Where a feature already has a Ctrl+K command, the catalogue names the command instead of copying its label, and the tests fail if it stops existing — along with any entry pointing at a button, panel or setting that isn’t in the app.

### Notes
- The guide button now opens Discover; the original linear walkthrough is still there as “Guide / Tour”, and spotlighting one button from Discover no longer marks the whole tour as seen.
- 55 new tests (2,716 total).

## v2.31.46 (2026-09-12) — Real icons, and a very long bug hunt

### Changed
- **No more emoji anywhere in Vex.** Every emoji in the interface is now a drawn icon that takes its colour from the theme you are using, so icons finally match the browser looks instead of ignoring them. That covers Ctrl+K, Settings, the sidebar, tab badges, notes, history, sync, personas, skills, the toolbox, toasts and the first-run screen. The only emoji left are the ones you asked to keep: the party popper on the update card, and whatever you type on your own toolbar buttons. A check now runs with the tests, so they cannot creep back.
- **AI Skills pick a real icon.** The emoji box in the skill editor is now a small icon picker. Skills you already saved keep working — their emoji is swapped for the matching icon.
- **A persona chosen for one tab stays in that tab.** It used to also become the default for every tab that had not chosen one. "Use" in Settings still sets the default.

### Added
- **Extensions worth installing, inside the extensions manager.** Five suggestions, each with what it does, what actually happens under Vex, and a link to the publisher's own download page. The two Vex can only partly run are marked. The "what Vex can't do" list is generated from the same place, so it cannot drift out of date.
- **Sticky notes live in the Notes panel now.** A "Page notes" section lists every page you have left a note on: open the page, edit the note in place, show the card again, or turn a sticky into a real note that keeps a link back to where it came from. New buttons in the panel header make a sticky, clip the page, or start a note without hunting through menus.
- **Notes got a proper editor.** A formatting toolbar (bold, italic, heading, list, checklist, code, link, with Ctrl+B/I/E), a live preview whose checkboxes you can actually tick, tags with a filter, pinning, sorting, search across title, body, tags and source, a word and reading-time count, copy as Markdown, export, and duplicate.
- **Recall searches properly.** Whole words with stemming, so "throttled" finds "throttling"; phrases in quotes; "-word" to exclude; and `site:`, `after:` and `before:` filters. Results are ranked by relevance and recency with the matching words highlighted, and you can copy a result, forget one page, or never index a site again. A stat line says how many pages are indexed and how much space they take. Searching 3,000 pages takes about two milliseconds.
- **Scheduled tasks can do seven things, not one.** Run an AI task, open a set of pages, reload tabs matching an address, sleep background tabs, save a session snapshot, clear browsing data, or just remind you. Schedules can be every N minutes or hours, daily, on chosen weekdays, monthly (including the last day), once at a date and time, or a full cron expression — with a live preview of the next three runs, plain-English descriptions ("Every weekday at 08:30 — next: Mon at 08:30"), per-task run history with durations, run now, pause, duplicate, and a choice of catching up or skipping a run that was missed while Vex was closed.
- **Downloads can be paused, resumed, cancelled and retried,** from the panel while they run.
- **Your AI conversations are kept per tab** and survive a restart. They used to live only in memory.

### Fixed

#### Notes
- **Notes you were typing could be lost.** Unsaved text was thrown away when you switched notes, closed the panel or quit — there was a one-second delay and nothing that flushed it.
- **Typing in a note's title wiped your search.** The list reset to everything while the search box still showed what you had typed.
- **Clipping a page while a note was open sent your typing into a note that no longer existed.**
- A note missing a title or body left the list blank. Preview and Edit could swap places. Deleting had no confirmation. Dates could read "Invalid Date". Exporting a note could cancel its own download.
- **The notes list was unusable in the docked sidebar** — a fixed-width list left about 180px for the editor.
- **Sticky notes: reopening a card threw away what you had typed,** and "Open" went to an address that did not exist for anything but a plain website.

#### Recall
- **Short pages were never remembered.** Anything under 200 characters of body text was skipped, so `example.com` could not be found at all.
- **Almost two thirds of every page was thrown away** — the page was read to 16,000 characters and then stored at 6,000.
- **Searching matched inside words:** "cat" found "Concatenation" and "Deep packet inspection". It also could not find "throttling" when you searched "throttled", ranked long pages above relevant ones, ignored how recent a page was, and showed snippets that did not contain what you searched for.
- **Every page you visited rewrote the whole index to disk,** twice, growing with the index.

#### Scheduled tasks
- **Every run leaked a background tab,** and the leaked tabs came back on restart, so the leak compounded.
- **Tasks due in the same minute were dropped.** Three daily tasks at the same time meant one ran.
- **A one-off task for a time that had already passed saved happily and never ran** — there was no date field at all.
- **Monthly tasks on the 31st fell a month behind** every February. A brand-new daily task fired immediately.
- **Cron never really worked:** no ranges, no names, and a yearly expression returned nothing.

#### Tabs, workspaces and split screen
- **"Pin Tab" in the right-click menu did nothing you could see.**
- **Switching workspaces lost every stack,** left the previous workspace's pinned tabs on screen as dead buttons, and rendered restored groups empty.
- **With split screen on, switching workspaces gave you a completely blank window,** and clicking a tab changed nothing.
- **Closing a tab that was in a split pane left a dead half-screen** nothing could repair.
- **One bad favicon silently stopped Vex saving your tabs at all** — visiting an unreachable site was enough.
- **The speaker and sleep badges never updated** in the vertical sidebar until something else forced a redraw. A page that failed to load stayed titled "Loading…" forever. A tab preview could stick on screen permanently. A Peek that failed showed a blank white frame.

#### AI
- **Asking "how do I find the average of a list in python?" ran a history search** and sent up to 200 of your history entries to the AI. Any message containing "find", "remember" or "recall" did this.
- **Choosing Local AI without Ollama running produced "Cannot read properties of null".**
- **AI Restyle never worked at all** — it read a field the AI never returns.
- **Rewrite/Fix/Shorten pasted raw JSON into your page** on the local backend.
- **The agent could still act after you pressed Stop,** and "Show full plan, then execute" never showed a plan and approved everything.
- **Remembered facts quietly stopped being applied** once a conversation got long, and an on-device answer that failed was silently re-sent to the cloud.
- Conversations are now kept per tab across restarts.

#### Settings, downloads and privacy
- **A finished download could say "0 B".** Any server that does not announce a file size left the panel copying that zero over the bytes it actually received.
- **Downloads had no pause, resume or cancel** while a transfer was running, and a paused transfer still claimed to be downloading. A failed or cancelled download can now be retried.
- **Open and Show in folder appeared on downloads that had no file,** and did nothing when clicked.
- **A full download list evicted transfers that were still running.**
- **Choosing a vertical tab layout under Glass or a browser look put the top tab strip and the vertical rail on screen at once** — those layouts arrange the window themselves, and now say so instead of fighting your choice.
- **"Personalization" had no chip in the Settings navigation** — searching for it landed you in Personas, because its name contains that word.
- **The privacy dashboard claimed blocking was on even when it was not,** and kept polling for the rest of the session after you closed it.

#### Elsewhere
- **Reading mode ran a page's own `<title>` as markup.** A page titled with a `<script>` tag put a live tag into the reading view. Exiting reading mode from a background tab threw away the page you were actually looking at.
- **Turning a Boost off never removed it** from pages that were already open, and "reset this site" resurrected the boost you had just deleted the next time you edited one.
- **Turning off cookie-banner blocking undid itself** — clearing its rules woke its own watcher, which painted them straight back.
- **Emptying the focus blocklist turned blocking off for good,** while focus mode still promised to block. There is now a Restore defaults button and a line that says plainly when the list is empty.
- **The password leak warning stopped at the first address it had already warned about,** hiding every other leak on the page, and warned on *every* site if a saved login had no address.
- **Per-site dark mode never synced** — it was still listed under a setting name retired long ago.
- **What's New and the screen picker leaked a keyboard listener every time they opened.** So did the reading ruler.
- **A failed update download left the bar stuck at 0%** with nothing said; a release with no file opened an empty tab behind a "downloading" message.
- **Recording a keyboard shortcut kept listening after you closed the panel** — the next shortcut you pressed was swallowed and quietly reassigned.
- **Sync said "no devices" when it could not reach the server,** which looked identical to having none. Wiping sync data left the local copy in a state that failed every later sync and quietly signed you out.
- **Location set to "manual" with no coordinates silently fell back to asking a third-party service for your location by IP** — under a mode whose own description says nothing leaves your device. It now refuses the request and says why.
- **Reordering the sidebar left the Settings list showing the old order.**
- **The Roblox and Discord bypasses share one connection helper.** Running Discord's auto-configure while the Roblox bypass was on left Roblox pointing at a helper that no longer existed, so Roblox stopped connecting with nothing said. Roblox now follows the shared helper, and says so if it stops.

### Notes
- This release is the result of seven parallel audits of the whole browser — settings, extensions, notes, recall, scheduled tasks, tabs and workspaces, the AI features, downloads, privacy, sync and the odds and ends. Every bug listed was reproduced in the running app before it was fixed.
- The test suite went from 2,489 to 2,661 tests.
- One thing found and deliberately left alone: after a hard crash (not a normal quit), the tab list and the workspace list can disagree about which workspace is active, because they are saved in two different places. Fixing it properly means unifying the two, which is a bigger change than this release should carry.

## v2.31.45 (2026-09-12) — History that keeps your history

### Fixed
- **Your browsing history was being erased.** The History panel only loaded your saved history when you first opened the panel, so the first page you visited in a session overwrote everything before it. I proved it: three saved entries, one page visited, one entry left. Your history now survives, and so do the history suggestions in the address bar, which read the same list.
- **History entries said "Loading..." instead of the page's name.** A visit is recorded the moment a page starts loading, and the title was never corrected once the page said what it was.
- **Going back to a page no longer adds another identical row.** It moves that page to the top with a fresh time, the way Chrome does.
- **The History panel updates while it is open** and when you reopen it. It used to draw itself once and never look again, so anything visited meanwhile stayed invisible until a restart.
- **One history, not two.** The Ctrl+K quick view read a separate, smaller copy that could disagree with the panel.
- **The whole address bar is clickable.** The text field was 13–15px tall inside a 32px bar, so clicking above or below the text did nothing.
- **Icons that could not be seen.** The "+" on the shortcuts bar was near-white on white in the browser looks; shortcut letter chips put white letters on a colour that could be as weak as 2.8:1; the chosen sidebar icon vanished on light accents in Glass and the rail looks; and Glass's "Vex" wordmark and workspace button sat at 1.5:1 on the Oxford theme.
- **Chrome extensions: eleven faults.** Extensions loaded into only 3 of 11 sessions, so sidebar panels and container tabs had none at all. A failed install left a folder that retried on every start and could not be removed. Re-installing stacked duplicate copies. Localised extensions listed as `__MSG_extName__`. Errors said "check the console" instead of the reason. There was no way to disable an extension, and no way to open an extension's popup.

### Added
- **Every Toolbox tool in Ctrl+K.** Type "bmi", "subnet" or "loan" and open the tool itself.
- **Delete history by site or by day.** Right-click a row for "Delete every visit to …", or use "Clear day" on a date heading. Clearing everything used to be the only option.
- **Glass gets the docked sidebar too**, beside the page rather than covering it, keeping its rail.
- **The New Tab page wears the browser look**, not just its colours: Chrome's search pill and tiles, Firefox's cards, Safari's soft grid, XP's Tahoma and square edges, 98's raised bevels.
- **Enable or disable an extension**, and open its popup from the toolbar or the manager. The manager now shows icons and whether each extension actually loaded.
- **`npm run check:ui`** — a self-check that drives the real app and measures every GUI style and theme for overlapping controls, badges covering icons, targets too small to hit, unnamed icon buttons, clipping and contrast.
- **A sleeping tab keeps its "was 219 MB" figure across restarts.**

### Notes
- The UI self-check went from 156 findings to 48. All seven browser looks are now clean in their own colours. Of what remains, 32 are on the Solarized theme, whose palette is deliberately low-contrast — Classic shows the same on it.
- What extensions can and cannot do here, measured rather than assumed: Electron gives Vex no request blocking, so uBlock Origin loads and runs but **cannot block ads** (Vex's built-in blocker still does). Context menus, keyboard shortcuts, badges, `storage.sync` and `tabs.create` are missing, and extensions can never load in Private or Tor tabs — the manager now says so instead of leaving you guessing.

## v2.31.44 (2026-09-12) — 318 tools, 420 jobs

### Added
- **The Toolbox has 318 tools, up from 15.** The new ones are 79 unit converters, maths and science tools, 68 text, writing and generator tools, 86 money, business, date and health tools, and 70 developer, data, web, security and design tools. They all work inside Vex, with nothing sent anywhere. Each has worked examples that are checked automatically, so a wrong formula fails the build.
- **Search and categories in the Toolbox.** Type "loan", "bmi" or "json" to find a tool, or filter by category. Your job's tools come first.
- **420 jobs, up from 65,** across 24 categories. These include trades, hospitality, transport, retail, real estate, public service, agriculture, sports and personal ones like parent or retiree. Each job comes with the tools it really uses. Existing jobs keep their names and themes, but ten of them are now listed under the new categories, so Mechanical Engineer is under Engineering and Accountant is under Finance.

### Changed
- **Your own tools now live in the Toolbox.** The links you added used to sit on the sidebar as a separate row of icons. They now appear in the Toolbox under "Your links", and the sidebar keeps one Toolbox button. To put them back on the sidebar, tick "Show my links on the sidebar instead of here" in the Toolbox.
- **Choosing tools for a job works with hundreds of tools.** The job setup shows the tools you have switched on, with a search box to add more, instead of one long list of every tool.

### Fixed
- **Sleep in the Memory panel works.** The row redrew before the tab had actually gone to sleep, so it looked like nothing happened, and a tab set to stay awake ignored the button. Sleep now always works when you click it, and the row updates once the tab is asleep. "Sleep inactive tabs" likewise waits before updating.
- **The sleep moon is visible on every theme.** It was a thin outline drawn at about 44% strength, and disappeared on most themes. It is now a solid moon in the theme's main text colour at full strength; only the tab's title and icon fade. Every GUI style, colour mode and theme was checked, 560 combinations, and each is at least 3:1 contrast. The vertical tab list now shows the moon too.
- **Address-bar suggestions line up with the address bar.** In the browser looks the address bar runs the full width, but the suggestions were still centred in a 600px box, off to one side of what you were typing. They now match the bar edge to edge.

## v2.31.43 (2026-09-11) — Maximize sidebar apps, real memory numbers

### Added
- **Maximize a sidebar app.** In the browser looks, the sidebar now has a maximize button next to close. Discord, Roblox, Claude, Prime Video and every other panel can fill the whole page area, and the same button puts them back in the sidebar.
- **Get a look's original colours back from the theme picker.** Under a browser look, the first card in the theme picker is now "<look> — original colours", shown in that look's own palette. Picking a theme switches the look to that theme's colours, and this card switches it back.

### Fixed
- **Back, forward and reload no longer cover a site's own buttons.** On web panels these three buttons floated over the page's top-left corner, where sites keep their own controls. They sat on top of Claude's sidebar toggle, and covered Roblox's menu. In the browser looks they now sit in the sidebar's header; in Classic they get a strip of their own above the page.
- **The Memory panel shows real numbers only.** When it couldn't read a tab's memory, it showed a made-up 80 or 150 MB, sometimes without marking it as a guess. Every figure is now a real measurement, or the row says the tab is still starting.
- **Sleeping tabs show numbers too.** A sleeping tab now reads "0 MB · asleep (was 219 MB)": a sleeping tab really uses nothing, and Vex notes what it used just before it slept. Tabs restored but never opened read "0 MB · not loaded yet".
- **Tab Health's total no longer counts memory twice.** It added up each tab separately, so a process shared by several tabs of the same site was counted once per tab. It now shows Vex's true total, the same figure as the Memory panel.
- **Unread badges no longer hide their icon.** In the Firefox, Netscape and Glass sidebars a "99+" badge covered most of the icon. It now sits on the button's corner.
- **Opening the Privacy panel no longer squeezes the toolbar** in the browser looks, where its buttons overlapped the bookmarks bar.
- **Web panels in the browser looks no longer come out blank.** A web panel's page could end up zero pixels tall once its buttons moved into the header.
- **Netscape's small sidebar close and maximize boxes are easier to hit.**

### Notes
- Every button in all nine GUI styles was checked automatically for overlaps, badges covering icons, tiny targets, unnamed icons and clipping, including inside every panel in six of the looks. Nothing was left after these fixes.
- The "was" figure is not kept after a restart. A tab that slept before this update, or before the last restart, shows "0 MB · asleep" without it.

## v2.31.42 (2026-09-11) — Each browser look gets its own sidebar

### Added
- **The sidebar is back in the browser looks, shaped like that browser's own.** Your panels (Discord, Spotify, WhatsApp, Notes and the rest) now open beside the page instead of covering it, the way a real browser's sidebar does:
  - **Chrome:** a side-panel button on the toolbar opens the panel on the right, with a dropdown at the top to switch panels.
  - **Firefox:** the slim icon strip stays down the left, with the panel opening beside it.
  - **Safari:** a sidebar button at the far left of the toolbar opens it on the left.
  - **Internet Explorer on XP:** the Explorer bar on the left, opened from the toolbar.
  - **Netscape on 98:** a strip of grey buttons that press in when chosen, and a sidebar with its own small title bar and close box.
- **Drag the sidebar's inner edge to make it wider or narrower.** Vex remembers the width. Settings still opens over the whole page, because it doesn't fit in a sidebar.

### Fixed
- **Panels no longer pick up the wrong colours in XP and 98.** Parts of a panel, like the Notes list, took the blue of the XP or 98 title bar, and a few surfaces still took your colour theme's colours. They now match the look.
- **A new tab no longer flashes your colour theme first.** The New Tab page now applies the look's colours before it draws anything.

## v2.31.41 (2026-09-11) — The New Tab page matches the browser look

### Fixed
- **The New Tab page now matches the browser look.** With a look in its own colours, the New Tab page kept your colour theme, so Chrome's light frame sat on top of a dark green Matrix page. The page is a separate document and was never told about the look. It now takes the look's colours: white under Chrome, dark grey under Chrome dark, and so on for all seven. With "Match my colour theme" it follows the theme as before.
- **The looks keep their own fonts.** Colour themes force their font onto every button and field, which put Oxford's serif in XP's address bar instead of Tahoma. Each look now uses its own font whatever the theme.

### Notes
- With a look in its own colours, the Custom Image theme's photo is left off the New Tab page, because the look's dark text would sit on the darkened photo. It comes back with "Match my colour theme".

## v2.31.40 (2026-09-11) — Seven browser looks, in any colour theme

### Added
- **Seven new looks in Settings › GUI Style.** Vex can now look like another browser entirely: Chrome, Chrome dark, Firefox, Firefox dark, Safari, Internet Explorer on Windows XP, and Netscape on Windows 98. Each one moves the tabs, address bar and buttons to where that browser has them, and uses its shapes and fonts, down to XP's blue caption buttons and 98's raised grey edges. Your tabs, bookmarks and everything else stay as they are.
- **Every colour theme works with every look.** A look can keep its own colours or take them from your colour theme, so all 35 themes recolour all seven looks. Picking a theme while a look is on switches it to match, and a new "Browser look colours" setting under GUI Style switches it back. On XP and 98 the title bar takes your theme's accent colour, kept dark enough for its white writing to read.

### Notes
- To keep them looking like the real browsers, the looks hide Vex's side rail and a few toolbar buttons (workspaces, AI, notes, split view, Tor). All of them are still in the menu button at the right of the toolbar, or Ctrl+K. "Switch Workspace" there opens the workspace list under the toolbar.
- Every look was checked against every theme (245 pairs) for text, icon and address-bar contrast in the running app, and screenshotted under six very different themes. The one soft spot is Windows 98 on Solarized, which is low-contrast by design and is just as soft in Vex's normal look.

## v2.31.39 (2026-09-11) — F12 opens DevTools you can see, and Sheets links are copied

### Fixed
- **F12 and Ctrl+Shift+I open DevTools again.** They were opening it, just invisibly. They asked for DevTools docked to the bottom of the page, and a page inside Vex has no window of its own to dock into, so DevTools opened with nowhere to appear. Pressing the key again then closed that invisible copy, so the key seemed to do nothing at all. DevTools now opens in its own window, the way right-click Open DevTools already did.
- **Copying text from a Google Sheet keeps the links.** A cell that links somewhere is now copied as "text (link)". Before, only the words were kept, so a list of links to other sheets came out as titles you could no longer open. Google's tracking redirect is removed so you get the real address, and a link to another tab in the same file becomes one you can open on its own.
- **Workspace colours no longer fight your theme.** A workspace used to repaint every accent in Vex in its own colour — buttons, progress bars, and the outline round the address bar — so a red workspace on a green theme drew a red box inside a green address bar. Your theme now owns the colours everywhere, and the workspace colour marks the workspace switcher instead, so you can still tell at a glance which workspace you are in.
- **The Restart button has its own icon.** It was a circular arrow, easy to mistake for Reload a few buttons away. It is now a power symbol.

### Notes
- The DevTools fault was confirmed by listing the real windows on screen: before, pressing F12 left only the Vex window; now a DevTools window appears, and pressing it again closes it.

## v2.31.38 (2026-09-11) — Google Sheets: copy text and Ctrl+F

### Fixed
- **Copying text from a Google Sheet gets the actual cells.** It used to return the sheet's title, its tab name and the two scroll arrows, and nothing else, because the page it read is only a frame and the grid is fetched separately. It now reads every sheet in the file, one row per line with the cells separated by tabs, so it pastes cleanly into another spreadsheet. The text of linked cells is included.
- **Ctrl+F on a Google Sheet or Doc opens Google's own search.** Pressing it right after switching tabs opened the Vex find bar instead, and that bar can never find anything in Sheets or Docs because they draw their text as a picture rather than as text on the page, so a name in plain view on row 15 came back as 0 of 0. The key now always goes to the document.

### Notes
- Both were confirmed in the running app on a real Google Sheet: the copy returned all 31 rows, and Ctrl+F opened the sheet's own find box.

## v2.31.37 (2026-09-10) — Share Your Screen from a pop-out call

### Fixed
- **"Share Your Screen" works in a popped-out Discord call.** Every other button in the pop-out worked, but this one appeared to do nothing. It was doing something: the picker for choosing a screen or window opens in the main Vex window, and a pop-out call floats above everything by default, so the picker opened behind it where you could never see it. The picker now comes to the front, and the pop-out stops floating for as long as you are choosing.

### Notes
- Reproduced in the running app: the picker did open, listed every screen and window, and the window holding it stayed behind the call.

## v2.31.36 (2026-09-09) — F12 follows the panel you are looking at

### Fixed
- **F12 and Ctrl+Shift+I now open DevTools for an open sidebar panel.** A panel covers the content area, so it is what you are looking at - but the shortcut only ever looked for the active tab, and a panel is not a tab. Over Discord, Spotify or WhatsApp it opened DevTools for whichever hidden tab happened to be active, or found nothing at all and stayed silent. It now inspects the panel when one is open and falls back to the tab otherwise.

### Notes
- The panel-before-tab choice is covered by tests. The key itself could not be exercised automatically - neither injected keys nor synthetic OS keys reach the shortcut handler - so if F12 still does nothing, the key is not reaching Vex at all and the cause is elsewhere.

## v2.31.35 (2026-09-09) — Right-click menus that stay put

### Fixed
- **Right-click menu items work again over Discord, Netflix and the other panels.** Opening a panel means the page inside it takes keyboard focus back whenever it feels like it, and Vex read that as you leaving for another app, so it quietly closed the menu you were still reading. The click then landed on empty space and nothing happened at all. This is what was behind Refresh, "Switch to ..." and "Install my Vencord build" appearing to do nothing. The menu now stays until you pick something, click away, or press Escape; leaving for a genuinely different app still closes it.

- **A Restart button sits next to the setup wizard.** Restarting used to mean closing and reopening Vex by hand, which several fixes ask you to do. It asks first, since a restart closes every tab.

### Notes
- The menu fault was reproduced in the running app and then confirmed end to end: with the panel page holding focus, picking "Install my Vencord build" from the menu now actually installs, which it did not before.

## v2.31.34 (2026-09-08) — Sidebar panel service switching

### Fixed
- **"Switch to Netflix / Prime Video / Disney+ / Roku" works again in the sidebar panel.** The switch, "Change link" and "Reset to default" all drove a remembered reference to the panel's page, and that reference goes out of date whenever the panel is rebuilt - after which they quietly did nothing at all. The panel said "Updated" and stayed exactly where it was. They now always drive the panel that is actually on screen, and a navigation that fails is written to the log instead of being discarded.

### Notes
- Confirmed against the running app: with the remembered reference deliberately made stale, "Switch to Netflix" left the panel sitting on Prime Video before the fix and moves it to Netflix after it.

## v2.31.33 (2026-09-07) — Find in page

### Fixed
- **The find bar is readable again.** It was drawn as frosted glass, but a frosted panel has nothing to frost when it floats over a web page, so it came out see-through — and over a white page, such as a document, the box and the text you typed were almost invisible. It is now solid, in every theme.
- **Ctrl+F works in Google Docs, Sheets and Slides.** Those apps draw their text in a way the browser cannot search, so the find bar could never match anything in them, and Vex was taking the key before the app could use its own search. Ctrl+F now goes straight to the document, where it works. Everywhere else the Vex find bar opens exactly as before.

## v2.31.32 (2026-09-07) — Emailed sign-in codes, end to end

### Fixed
- **Emailed sign-in codes now fill on Spotify and other sites.** Two remaining faults are gone. Waiting for a code was limited to one page at a time across the whole browser, so a sign-in page left open elsewhere could silently block the page you were actually using. And the wait was abandoned outright if the page had not quite finished attaching at the moment it began — which is exactly when it begins — leaving no trace of the attempt at all. An attempt that is turned away is now recorded instead of vanishing.

### Notes
- Verified by driving the whole flow inside Vex against the real Spotify code screen, with the mailbox tab asleep in the background: both the case where the code is already waiting and the case where it arrives while you wait.

## v2.31.31 (2026-09-07) — Reading the code from a background mailbox

### Fixed
- **Emailed sign-in codes are read from your mailbox even when it is in the background.** Two things stopped this. A mail tab that had gone to sleep was never woken, so Vex reported that no mailbox was open even though it was. And a mail tab that was awake but sitting behind the sign-in page was frozen by the browser, so it never received the new mail: Vex kept re-reading the same older messages and never saw the code arrive. Your mailbox is now kept awake and running while Vex waits for a code, then put back exactly as it was.

## v2.31.30 (2026-09-07) — Emailed sign-in codes on Spotify

### Fixed
- **Emailed sign-in codes now fill on Spotify.** The previous release fixed two reasons this failed but not the one that mattered here: Vex began watching while the page still asked only for your email address, decided within about fifteen seconds that it was not a code page, and stopped — before the code box existed. Spotify then swaps in the code step without loading a new page, so nothing looked again. Vex now keeps watching for as long as the page still looks like a sign-in, and for long enough that the email has time to arrive. Ordinary pages are still dropped just as quickly as before.

## v2.31.29 (2026-09-07) — Autofill and sign-in prompt fixes

### Fixed
- **Authenticator codes now fill on Roblox and other sites.** A two-factor screen appears after the password step, and Roblox shows it without loading a new page, so Vex had already looked once, found no code box, and given up. It now waits for the box to appear for as long as you stay on the site. Sites whose name matches your authenticator entry ask once, showing you the site, then remember your answer.
- **Emailed sign-in codes now fill again.** Looking for your open mailbox could hit a tab that was still loading, which threw an error that silently abandoned the search — so with several tabs open the code was never fetched. Opening your mailbox itself also used to start a search that could never succeed and blocked the real one.
- **The Windows passkey and security-key dialog no longer interrupts password sign-ins.** Suppressing it had become opt-in per site with an empty default, so it returned everywhere. It is suppressed on all sites again, and Settings can still narrow or disable that.

## v2.31.28 (2026-09-07) — 2FA and email-code autofill

### Fixed
- **Authenticator codes now fill on Roblox.** Roblox labels its box simply "Enter 6-digit Code", which Vex did not recognise as a two-factor field, so nothing happened at all on the 2-Step Verification screen. A plain "code" box is now recognised when the page around it is clearly a two-factor screen, so promo and coupon boxes are still left alone.
- **Authenticator entries added by typing a secret now work.** Codes added by hand carry no service name, and services whose name has a suffix (for example "Roblox Corporation") were not recognised either. Vex now matches on the entry name, its label, or both.
- **Emailed sign-in codes now fill on Spotify.** Asking a site to email you a code moves the page to its code step, and Vex treated that as leaving the page and gave up — right at the moment the code box appeared. It now keeps watching for as long as you stay on the same site.

## v2.31.27 (2026-09-07) — Sign-in and autofill fixes

### Fixed
- **Signing in with Google could crash Vex.** Opening a Google sign-in popup showed a "A JavaScript error occurred in the main process" dialog instead of filling your saved login. Popup autofill was calling into code that had moved to another module without being wired up, and the failure escaped as an uncaught error instead of being handled.
- **Saved passwords stopped filling on Spotify.** Logins that rewrite the page address between the email and password steps — Spotify does this — stopped autofilling after the first step. Emailed sign-in codes were affected the same way.
- **Authenticator codes stopped filling on most sites.** Two-factor autofill recognised only eight services, so Roblox, Spotify, Steam and everything else never filled. Vex now also recognises a site whose name matches your authenticator entry: it asks once, showing you the site, then remembers your answer. It only asks when a two-factor field is actually on screen.

## v2.31.26 (2026-09-07) — Roblox panel back button

### Fixed
- **The Roblox panel looked like it had no back button.** Sidebar web panels have carried their own back/forward/reload bar since v2.31.17, but on Roblox you could not see it: the bar sits faintly in the panel's top-left corner, which is exactly where Roblox draws its own logo and header, so it blended into the page. It is now solid and always visible on the Roblox panel — the other panels keep the subtle look they already had.

### Changed
- **Vex now runs on a much newer browser engine** — Electron 42 / Chromium 148, up from Chromium 124. Pages that had started to complain about an outdated browser, or that relied on newer web features, should behave properly again. Widevine playback (Spotify, Netflix) is unaffected and still signed.

### Internal
- Removed `roblox-panel.js`, an unused "Roblox Hub" panel that nothing ever loaded.
- Build toolchain upgraded alongside Electron: electron-builder 26, refreshed dependencies, and a new icon-generation script.

## v2.31.25 (2026-09-05) — Picture-in-Picture fixes

### Fixed
- **The Picture-in-Picture pop-out could not be closed.** It had no title bar, no taskbar button, no keyboard shortcut and no buttons of its own, so once it appeared the only way to get rid of it was Task Manager. It now carries its own control bar — back to tab, keep-on-top and close — and Esc or Ctrl+W closes it.
- **Picture-in-Picture opened the pop-out even when it had worked normally.** Vex checked whether the video had gone into PiP by looking at the wrong page, which could never say yes, so every press also spawned the pop-out on top of the working PiP. That is why the un-closable window kept turning up.
- **The PiP button and Ctrl+Shift+P are now a real toggle** — pressing again leaves Picture-in-Picture instead of trying to start it a second time.
- **The pop-out no longer floats above fullscreen apps** or traps Alt+Tab behind it, and Ctrl+Shift+P inside it toggles keep-on-top.
- **The pop-out remembers its size, position and keep-on-top setting**, and refuses to reopen off-screen if you unplug the monitor it was on.
- **The pop-out can no longer be left behind.** It closes with Vex instead of lingering as a floating window with nothing left to close it from, it is torn down if its page crashes or hangs, and a page can no longer refuse to let it close.
- **Picture-in-Picture now tells you when it cannot run** on the current page, instead of silently doing nothing.

## v2.31.24 (2026-09-04) — Fix clicks silently doing nothing

### Fixed
- **Buttons and menu items could stop responding entirely** (refresh on a sidebar panel, “Install my Vencord build”, and others) with no error message. A right-click menu leaves an invisible full-window layer behind to catch your next click; if that menu vanished without cleaning up, the layer stayed and swallowed every click in the app. Vex now clears a stray layer as soon as you move the mouse — before your next click.

## v2.31.23 (2026-09-04) — Discord voice reconnect fix

### Fixed
- **Discord voice kept reconnecting every few seconds** while the DPI bypass was on. The bypass was also being applied to Discord’s voice connection, and its anti-blocking trickery breaks that kind of long-lived connection. Voice now connects directly while chat and login stay on the bypass.

## v2.31.22 (2026-09-04) — Fix Vencord vanishing + DRM volume note

### Fixed
- **Vencord and its plugins could disappear after an update.** The routine that keeps a single Vencord build could keep a stale/disabled copy and delete the working one. It now ignores un-loadable copies and always keeps the real, newest build.

### Added
- **Master Volume** now explains itself on Netflix/Disney+/Prime and other DRM video: pushing past 100% there shows a note that the audio is DRM-protected (so it can’t be boosted in the browser) and suggests a Windows booster like Equalizer APO — instead of a slider that seems to do nothing.

## v2.31.21 (2026-09-03) — Master Volume boosts more sites

### Fixed
- **Master Volume boost above 100% now works on far more sites.** Boosting louder than the source needs Web Audio, which stays silent on cross-origin video/audio unless the media allows it — so those sites were stuck at 100%. Vex now makes media cross-origin-friendly and re-routes it so the boost applies, keeping playback going. (DRM video like Netflix/Disney+ still can’t be boosted past 100% — its audio is protected.)

## v2.31.20 (2026-09-03) — Vencord build self-heal + install log

### Fixed
- **“Install my Vencord build” could keep loading an OLD build** when a previous build’s files were still in use (e.g. the Discord panel was open), so two builds loaded at once and the older one won. Vex now keeps only the newest build — at startup (before the files are locked) and right after installing — so a fresh build actually takes over. A restart clears any stuck old build for good.

### Changed
- Installing a local Vencord build now writes a small log to `vencord-install.log` (in the app data folder) recording each step, to make any install problem diagnosable.

## v2.31.19 (2026-09-03) — Local Vencord install loads the latest build

### Fixed
- **“Install my Vencord build” could keep running your OLD build** (e.g. it still showed only the old plugin features after you rebuilt). Vex now always installs the most recently built `extension-chrome.zip`, and fully recreates the Discord panel afterward so the freshly-installed plugins actually load instead of a reload keeping the previous version.

## v2.31.18 (2026-09-03) — Clearer Vencord build install

### Fixed
- **“Install my Vencord build (custom plugins)” felt like it did nothing.** It was actually installing (and Vencord was loading into the Discord panel), but the only sign was a brief toast and a background reload. It now switches to the Discord panel and reloads it so you see the change, with a clear message — and if the build can’t be found it explains how to produce it (`pnpm buildWeb`).

## v2.31.17 (2026-09-02) — Panel nav, auto-refresh codes & Tor fix

### Added
- **Back / Forward / Reload on every sidebar app panel** (Spotify, Claude, pinned sites, …), not just Discord. Panels aren’t tabs, so the main toolbar couldn’t drive them — now each has its own slim bar, and the buttons always act on the panel’s current page.

### Fixed
- **Email-code autofill now refreshes your inbox for you.** It used to read whatever Gmail already had on screen, so a code often only appeared after you refreshed Gmail yourself. It now keeps prodding the inbox to fetch new mail (clicking Gmail’s own Refresh, harmlessly) for ~90s until the code arrives, then fills it.
- **Tor wouldn’t start — “tar module missing”** after the download hit 100%. The component that unpacks Tor wasn’t bundled into the app. It’s included now, so Tor extracts and launches. (If Tor Browser or the tor service is already running on your machine, Vex still uses that instead.)

## v2.31.16 (2026-09-02) — Sidebar Refresh fix

### Fixed
- **Right-click → Refresh on a sidebar app/site button** could silently do nothing. It reloaded a stored reference to the panel’s page that could go stale after switching the panel’s service, re-mounting, or hiding and re-showing it — reloading a detached page is a no-op. Refresh now finds the panel’s live page and reloads it, and if that fails it re-opens the panel’s URL, so it always does something.

## v2.31.15 (2026-09-01) — Site-compat tooling & per-site never-sleep

### Added
- **“Show This Site’s Browser Identity”** (Ctrl+K 🕵️) — shows what the current page sees about the browser (user-agent, Chrome brand, `window.chrome`, `navigator.webdriver`, WebGL) with a plain PASS/FAIL verdict on whether a site would flag Vex as “unsupported.” A Copy button exports the report.
- **“Never let this site sleep”** toggle in Site Settings (🌐) — keeps a chosen site loaded in the background across restarts, skipping Memory Saver, auto-sleep, and idle discard.

### Fixed
- **Strict-CSP sites** (Adobe and similar) also apply Vex’s geolocation and anti-fingerprinting patches now — they previously used an injection method those sites’ Content-Security-Policy blocked, so location and fingerprint protection silently didn’t run there. Both now use the same CSP-proof path as the v2.31.14 browser-identity fix.

## v2.31.14 (2026-09-01) — Adobe & strict-CSP sites

### Fixed
- **Adobe “unsupported browser” (Tarayıcı desteklenmiyor)** is fixed. Adobe’s sign-in and web-app pages send a strict Content-Security-Policy that blocked the way Vex injected its “real Chrome” identity, so on those pages `navigator.userAgentData` reported only “Chromium” and Adobe rejected the browser. Vex now applies those patches in a CSP-proof way, so the Chrome brand and `window.chrome` are present everywhere — not just on lax-CSP pages. This also hardens other strict-CSP sites against the same class of “unsupported browser” / verification failures.

## v2.31.13 (2026-09-01) — More tools & jobs

### Added
- **5 new Toolbox tools** (now 15): JWT Decoder, URL Encode/Decode, Case Convert (UPPER/lower/Title/camelCase/snake_case/kebab/CONSTANT), Password Generator, and live Markdown Preview.
- **22 more professions** in Job Setup (now 65) — SRE, ML/Cloud/Blockchain/API/IT/SysAdmin, Motion & 3D, Technical Writer, Blogger, Social Media, Consultant, HR, Recruiter, Operations, Statistician, Civil Engineer, Dentist, Vet, Podcaster, Streamer — each mapped to the tools they use.

### Changed
- **Work panel** polish — hover effects on tool cards and a category chip on the job header.
- **Clear This Site’s Data & Reload** command (`Ctrl+K`) — wipes a site’s cookies, storage, and cached responses and hard-reloads, fixing stale “unsupported browser” redirects, login glitches, and paywalls.

## v2.31.12 (2026-09-01) — PiP return, Work panel & site-compat

### Added
- **Work sidebar panel** — a briefcase icon opens a panel for your profession (from Job Setup): your enabled tools one click away, the current job + theme, quick actions, and a link to change job or manage tools.

### Fixed
- **Picture-in-Picture "Back to tab"** now actually returns you to the tab — it switches Vex to the video’s tab, brings the window forward, and scrolls the video back into view (before, it just closed the mini window).
- **"Unsupported browser" pages (e.g. Adobe)** — some sites checked `window.chrome` (which Electron leaves empty) to decide Vex wasn’t a real browser. Vex now presents the real-Chrome `window.chrome` fields, so these load normally.

## v2.31.11 (2026-09-01) — More reliable code autofill

### Fixed
- **Email-code autofill missing a code that was already in your inbox** (e.g. Spotify with Gmail open). It required the email to still show as unread *and* match verification wording — too strict when Gmail marks it read or the sender phrases it differently. It now recognizes more code phrasings and, as a last resort, fills a clear verification code that stays newest with nothing newer arriving, even if the unread flag is unreliable — while still preferring a genuinely newer code.

## v2.31.10 (2026-08-31) — Block the rest of the game ads

### Fixed
- **The remaining side-rail ad** on browser games (makeitmeme.com) is now blocked too. It was served by Fuse (`fuseplatform.net`) with creatives from RTB House (`creativecdn.com`); added both to the always-on block list so they're stopped even before the filter engine finishes loading at startup.

## v2.31.9 (2026-08-31) — Block game-site ads

### Fixed
- **Ads on browser games** (makeitmeme.com and similar) now blocked. Their display ads are served through `html-load.com` — a Playwire ad network that rotates subdomains to slip past EasyList. Added it and the rest of that ad stack to Vex's block list.

## v2.31.8 (2026-08-31) — Cloudflare Turnstile fix

### Fixed
- **Cloudflare Turnstile "Verification failed"** on sites like gartic.io. Vex presents itself as Google Chrome in its User‑Agent and request headers, but the browser's JavaScript client‑hints (`navigator.userAgentData`) still said "Chromium" — that mismatch tripped bot detection. Vex now reports "Google Chrome" consistently across all three, so challenges verify normally.

## v2.31.7 (2026-08-31) — A Vex built for your work

### Added
- **Job Profiles** — pick your profession (43 across Tech, Design, Writing, Business, Science, Health, Education, Legal, Creative) in the setup wizard or `Ctrl+K` → **Personalize for Your Job**. Vex applies a fitting theme, enables the built-in tools that job uses daily, and adds quick tool buttons next to the Tor button. You choose exactly which tools you want.
- **🧰 Toolbox** — 10 built‑in tools, all local (no external sites): Regex tester, JSON formatter, CSV viewer, Base64, Hash (SHA‑1/256/512), Unix timestamp, Cron explainer, UUID, Word count, and Color & contrast. Open from the Toolbox button or `Ctrl+K` → **Toolbox**.

## v2.31.6 (2026-08-31) — Everyday tools

### Added
- **Switch to an open tab from the command bar** — press `Ctrl+K`, type a tab's title or URL, and matching open tabs appear as "↪ Switch to tab".
- **📱 Send to Phone** — show a QR code of the current page (or a right-clicked link) to open it on your phone. Generated locally — nothing leaves your machine.
- **Paste & Go** — open the URL or search that's on your clipboard in one step.
- **Duplicate Tab** and **Copy All Tab URLs** — from the command bar (Duplicate is also on the right-click menu).
- **⟳ Auto-refresh** — reload a tab on an interval (30s / 1m / 5m / 15m) from the page right-click menu — for dashboards, live scores, and build logs.

## v2.31.5 (2026-08-31) — One-click restart

### Added
- **"⟳ Restart Vex to apply" button** — settings that only take effect at launch (like Memory Saver) now offer a one-click restart instead of just asking you to do it. The button appears under the setting when a restart is pending and relaunches Vex on click; your tabs come back.

## v2.31.4 (2026-08-31) — Pick-your-pane split, login tools & Memory Saver

### Changed
- **Split screen now lets you pick each pane.** Pressing split (or 3/4-pane) shows your open tabs to choose from — pane 2, then 3, then 4 — instead of grabbing whatever tab was next. Cancel keeps the panes you've chosen.

### Added
- **Email codes from more providers** — autofill now reads verification codes from Outlook, Proton, Yahoo and iCloud mail, in addition to Gmail.
- **Test autofill** — a self-check in Logins & Codes that reports whether it can reach and read your email (found a source? inbox readable? code visible?).
- **Auto-submit after filling a code** (opt-in) — presses the form's verify/submit button for you.
- **Password Health** (`Ctrl+K` → Password Health, or the hub) — finds reused, weak, or 2FA-less saved passwords. The analysis runs locally in the app; your passwords never leave your machine.
- **🧠 Memory Saver** (Settings → Performance) — one switch to lower RAM: sleeps tabs sooner (10 min), discards background tabs when Vex is minimized, caps renderer processes, and disables in-RAM page caching. Restart to fully apply.

### Performance
- **Email-code autofill no longer needs never-sleep on Gmail.** It wakes a sleeping Gmail only to read the code, then puts it straight back to sleep — so Gmail costs ~0 MB between codes instead of a permanent ~300–500 MB.
- **The hidden background Gmail reader frees itself** after a few minutes idle (it used to stay resident forever), and Chromium's always-warm **spare renderer** is disabled — both lower resting memory.

## v2.31.3 (2026-08-31) — Reliable code autofill & Custom Image

### Fixed
- **Email-code autofill now fills a code that was already in your inbox.** It snapshotted the newest code as a baseline and only filled a *different* one — so if the verification email was already there when the login page opened (Gmail woke a beat late, or the email landed as the page loaded), the code was skipped forever. It now fills an unread verification code that nothing newer supersedes, while still never filling an old, already-consumed code.
- **Custom Image theme wallpaper is reliable.** The image is now stored by the app itself (not only pushed into whatever Gmail-style start pages happened to be open), so it shows on the new-tab page whether or not one was open when you picked it, and survives restarts. Cancelling the picker no longer wipes your existing image.

### Added
- **Read email codes from a hidden Gmail** (Settings → Privacy → Autofill, or `Ctrl+K`) — fills verification codes with no Gmail tab open or awake, using your signed-in session.
- **"Fill code from email"** on demand — a `Ctrl+K` command and a right-click item on any input field.
- **Email-body fallback** — reads the code from the message body when it isn't in the inbox snippet.
- Autofill misses now say **why** (no Gmail open / still loading / no code arrived) — as a toast in the moment and in the Logins & Codes hub.

### Changed
- **"What's New" typography** — the release notes now use Vex's own fonts (Space Grotesk headings, Outfit body, JetBrains Mono for code).

## v2.31.2 (2026-08-31) — Browse every release

### Added
- **What's New version picker** — the release-notes modal now has a dropdown listing every version (newest-first, back to v1.0.0). Pick any release to read its notes; the "View on GitHub" link repoints to that tag. Read from the bundled changelog, so it works offline.

## v2.31.1 (2026-08-31) — Reopen "What's New"

### Added
- **"What's New" command** (`Ctrl+K → What's New`) — reopen this version's release notes any time. The update log used to appear only automatically after an update, with no way back to it.

## v2.31.0 (2026-08-31) — Eleven new tools

### Added
- **Ten features invented for Vex** (none exist in other browsers), each `Ctrl+K`: **🔥 Burner Identity** (throwaway OTR container + disposable email, optionally over Tor), **🕵️ Leak Canary** (warns when a saved email of yours is pre‑filled on the wrong site), **🧾 Tracker Receipts** (weekly narrative privacy report + trend), **⚙️ Automations** (if‑this‑then‑that: on a URL / at a time → open/panel/command), **🎯 Focus Flows** (composable work modes — tabs + persona + dim + block), **🎧 Read‑Later as Podcast** (auto‑advancing TTS of your saved articles), **🎨 AI Restyle** (AI writes CSS to restyle a site to a look you describe, saved as a Boost), **🧾 Universal Form Fill** (one profile fills signup/checkout forms), **📝 Sticky Notes per page**, and **🔗 Linked split‑scroll**.
- **Shortcuts & Gestures cheat‑sheet** (`Ctrl+K → Shortcuts & Gestures`) — a searchable reference of *every* keyboard shortcut (including the hidden ones — jump‑to‑tab `Ctrl+1‑9`, the `Ctrl+Alt+H` boss key, command‑chain slots, zoom/nav), all mouse gestures, and every right‑click action. Makes the hidden features findable.
- **More mouse gestures** — on top of back/forward/top/reload/close/reopen: **↑→ new tab**, **↑← duplicate tab**, **→↓ next tab**, **←↓ previous tab**.
- **Per‑tab AI persona switcher** (`Ctrl+K → Switch AI Persona (this tab)`) — Vex could already run a different persona per tab and switch with `@name`, but there was no quick picker; now there is one, showing which persona the tab uses.
- **Richer right‑click menu** — **🔊 Read aloud** a selection, **📚 Read Later** a link, and **🎯 Zap element** (hide anything on the site) now live on the page menu, alongside the existing Explain/Summarize/Translate/Highlight and Google Lens image search.
- **Screen‑share quality settings.** When a site asks to share your screen (Discord "Go Live", Meet, etc.), the source picker now also lets you set **resolution** (Source / 720p / 1080p / 1440p), **FPS** (15 / 30 / 60), **share system audio** on/off, and **show cursor** on/off — the choices Discord normally gates behind Nitro. Applied to the actual capture via a page‑world `getDisplayMedia` shim, and remembered for next time.
- **Tab Health dashboard** (`Ctrl+K → Tab Health`) — every tab grouped by its real state (active · kept-awake · awake · hibernated · sleeping · not-loaded) with live memory and one-click keep-awake / sleep / wake. Makes the sleep system visible instead of magic.
- **Logins & Codes hub** (`Ctrl+K → Logins & Codes`) — the three autofill systems (saved passwords, authenticator 2FA, and email-code) in one place, each with a per-kind success rate from a new local **autofill log**, plus a live "Gmail ready for codes?" status.
- **Site Settings** (`Ctrl+K → Site Settings`) — everything Vex remembers per website (zoom, forced dark mode, custom CSS/JS boosts) for the site you're on, plus a list of every site you've customized, with per-site reset.
- **Sidebar panel badges** — the unread count each app panel puts in its title (Discord, WhatsApp…) now shows as a badge on its sidebar icon, so the sidebar is a real dashboard.
- **Setup Gallery** (`Ctrl+K → Setup Gallery`) — save, name, share, and switch between whole Vex setups (panels, shortcuts, theme) as portable codes; keep a personal library.
- **Layout presets** — the layout editor gets one-click **Default / Essentials / Minimal** presets alongside the drag-to-rearrange controls.
- **Ask Vex to do something…** (`Ctrl+K`) — a plain-English command bar that understands common tab/window actions **locally, offline** ("close all youtube tabs", "sleep the others", "group my github tabs", "split screen", "keep this awake"), asking first before anything closes, and handing anything it can't parse to the AI tab manager.
- **Route through Tor / Proxy** (`Ctrl+K`) — send a whole container (or this session) through Tor or a custom SOCKS/HTTP proxy, persistently, or spin up a fresh Tor-routed container in one click.
- **Email codes without a Gmail tab** — opt-in: read verification codes from a hidden background Gmail using your already-signed-in session (no IMAP, no OAuth, no new credentials). Toggle it in the Logins & Codes hub.
- **Smoother local AI** — when Ollama isn't installed, on-device features (like history indexing) now skip quietly instead of failing on every page; verbose AI-routing logs are gated behind a debug flag. Much quieter console.

### Fixed
- **"Never sleep" tabs now really stay ready.** A tab you kept awake still came back from a restart as an unloaded stub — clicking it reloaded the page from scratch instead of showing it instantly, and background readers (like the email-code autofill) found nothing live to read. Now every kept-awake tab is brought fully back to life on launch, is materialized the moment you turn keep-awake on (even if it had never been opened), and opts out of background throttling so its page keeps running while it's not in front — so a kept-awake Gmail keeps receiving mail in the background and the code autofill reads a current inbox. This is a big part of why the autofill was hit-or-miss.
- **Ad blocker threw on early page loads.** The cosmetic (element-hiding) filter handlers were registered only after the filter engine finished loading in the background, so any page that loaded during that window threw "No handler registered" and got no element hiding. The handlers are now registered up front and simply wait for the engine — no error, and cosmetic filtering applies from the first page.
- **Discord stream pop-out trapped your screen.** Popping out a stream opened a near-fullscreen window pinned always-on-top, so it covered everything — Alt+Tab switched apps but you still couldn't see or reach them without minimizing the pop-out first. The always-on-top float now only applies while the pop-out is a small (picture-in-picture-sized) window: open or resize it large and it behaves like a normal window you can Alt+Tab freely; shrink it back down and it floats on top again.

## v2.30.1 (2026-08-29) — Fixes

### Fixed
- **Email-code autofill could fill a *stale* code from a previous attempt.** If a code had been emailed moments earlier (e.g. a retry), the autofill filled that older code right before the new one landed — so the login failed with "invalid code." It now snapshots whatever code is already in your inbox the moment the code screen opens, and only fills a code that's *different* — the one your current attempt actually triggers. (The previous timestamp check was too coarse: Gmail's row timestamps are minute-granular, so a retry within the same minute slipped through. Comparing the code value instead is exact.)

## v2.30.0 (2026-08-29) — A browser built for you: rearrange the UI

### Added
- **Edit Layout — rearrange your browser's own UI in place.** Vex's tagline is "a browser built for you," so now you can actually move it around. Open it from `Ctrl+K → "Edit Layout"` or **Settings → Appearance → Layout**, and the whole chrome becomes editable where it lives: **drag to reorder, ✕ to hide.** It covers *everything*, not just plain buttons — the Vex logo, the workspace switcher, the sync indicator, the address bar and its Copy-URL / Summarize buttons, Back/Forward/Reload, every top-bar button (Tor, Notes, Extensions, AI, Split, Command), every **sidebar icon**, and every **Glass shortcut chip** (Google, YouTube, Discord…). You can also drag a top-bar button **into a different cluster** — Tor over to the left, Back to the right, or a button dropped right into the address bar. And you can move **whole sections**: grab a section's grip handle to drag the entire left cluster, address bar, or right cluster into a new order (e.g. put the address bar on the far left). A bar at the bottom holds a **Hidden → click to restore** tray, plus **Reset toolbar** and **Done**. Your arrangement is saved and survives restarts. (Sidebar changes stay in sync with Settings → Sidebar; a shortcut's ✕ removes it — re-add with the + chip.)

## v2.29.10 (2026-08-29) — Auto-fill 2FA codes

### Fixed
- **Split screen broke after opening a sidebar panel.** Opening a panel (Discord, etc.) while split-screen was on left the content area stuck in a half-width grid when you came back — the split layout's forced grid was overriding the panel's hide. Opening a panel now cleanly exits split first.
- **Split screen showed a blank right pane.** Split-screen paired the active tab with the "next" tab — but almost every other tab is asleep with no live webview, so the right side came up empty. It now wakes/materializes both tabs before splitting, so both panes actually show their pages.

### Added
- **Auto-fill email verification codes from your Gmail.** When a site asks for a code it emailed you, and you have Gmail (web) open in a Vex tab, Vex reads the code from your inbox and fills it into the code field — no switching tabs, opening the email, and copying. Your Gmail tab doesn't even have to be in front: if it's in the background or asleep, Vex reads it in place without bringing it forward. Crucially, it fills only a code that *just arrived* (matched by the email's timestamp), so an older code still sitting in your inbox from a previous login is never used by mistake. It reads *only* a Gmail tab you already have open (no stored credentials, no email backend), fills only a real one-time-code field, and retries for a bit since the email usually lands a few seconds after you ask for it. Verified end-to-end on a real passwordless Spotify login. *(App-based 2FA still uses the Authenticator.)*
- **Split screen now does 3 and 4 panes.** Beyond the classic side-by-side, split into **3 equal columns** or a **2×2 quad** — open the command palette (Ctrl+K) and pick "Split into 3 panes" / "Split into 4 panes." The 2-pane split keeps its draggable divider.
- **Cloud AI setup now has a proper walkthrough in the setup wizard** — matching the Vex Sync step: what it is (Claude, on your own Cloudflare Worker + OpenRouter key) and 3 clear steps, instead of a bare "paste a URL" box.
- **Vex auto-fills your 2FA codes.** On a site's authenticator-app (TOTP) 2FA screen, Vex now fills the 6-digit code straight from its built-in Authenticator — no opening the panel, reading, and typing. It only fills a genuine one-time-code field (never a search or promo-code box), and — importantly — a code is only ever entered on the site it belongs to: the match is by the account's issuer against the site's real domain, so a look-alike/phishing host (e.g. `github.com.evil.com`) gets nothing. Add your accounts to the Authenticator (scan the QR or paste the key) and 2FA becomes one less thing to type. *(Note: this is for authenticator-app codes — it can't automate phone-approval prompts like GitHub Mobile, which require your phone by design.)*

## v2.29.9 (2026-08-29) — Tor with one click, no Tor Browser needed

### Added
- **The Tor button now launches Tor for you.** Before, you had to already have Tor Browser (or a tor service) running — otherwise the onion button just told you to go start one. Now Vex runs Tor itself: on first use it downloads the official Tor Expert Bundle (~15 MB, one time), starts `tor` in the background, and shows **live progress bars** — a download bar, then a "connecting to the Tor network" bar with each bootstrap stage — and opens your Tor tab automatically the moment it's fully connected (verified through check.torproject.org). If you *do* already have Tor Browser/service running, it uses that instead (instant). Tor shuts down when Vex closes.

## v2.29.8 (2026-08-29) — Privacy & sign-in polish: stronger ad blocker, smart autofill, no passkey nag

### Added
- **Privacy Dashboard** — a new 🛡️ sidebar panel showing, live, how much Vex is blocking for you: a running "requests blocked this session" total, the cross-site trackers that follow you across multiple sites, and a ranked top-offenders list. Read-only view over the blocking Vex already does — nothing new is sent anywhere.
- **HTTPS-Only mode** (Settings → Privacy, off by default). Always tries the encrypted https version of a site first. If a site genuinely has no https, Vex falls back to http for just that site (with a warning) so nothing breaks — and a site you asked for over https is never silently downgraded.
- **A stronger ad blocker.** Two upgrades: the built-in blocker now uses the *full* filter-list set (EasyList + EasyPrivacy plus Peter Lowe's, the uBlock Origin filters, badware/privacy/unbreak/quick-fixes, and annoyances) instead of just ads+tracking — so more ad and tracker requests are blocked at the network level. And Vex now does **cosmetic filtering** in-process: it hides the ad *slots and leftover placeholders* that network blocking alone leaves on the page (and first-party ad boxes it can't stop), on every site, following the ad-blocker on/off toggle.
- **Authenticator: add accounts by QR screenshot.** In the Add form, click/drag/paste a screenshot of a 2FA QR code and Vex reads it for you (decoded locally, no network) — no more hunting for the "enter a code manually" option. Manual entry is still there.
- **Notes button in the top toolbar** (beside the 🧅 Tor button), so it's one click away without opening the sidebar. The sidebar Notes button stays too (hide it in Settings → Sidebar if you want just the toolbar one).
- **Authenticator: click anywhere on a code to copy it.** No more hunting for the little copy button — click (or press Enter on) the whole row and the 2FA code is on your clipboard, with a quick flash to confirm.
- **Private tabs are now marked at a glance.** Tor and off-the-record tabs show a 🧅/🔒 badge and a subtle violet edge in both the tab sidebar and the horizontal/Glass strip, so you always know which tabs aren't being saved.
- **Autofill now works in sign-in popups.** "Sign in with Google/Discord/…" opens a small separate window; your saved login now fills there too (same phishing-safe, real-login-field-only logic as the main autofill).
- **Login-email pre-fill for passwordless sites.** Sites like Spotify log you in with an emailed code (no password to save), so full autofill never applied. Vex now remembers, per site, the email you type on a login page and pre-fills it next time — so you only enter the code. Email only, never a password, and only into a real login field (never a search box).
- **Claude sidebar auto-logs-in with Google.** When the Claude panel shows its logged-out screen, Vex auto-clicks "Continue with Google" for you (with a proper user-gesture, so the Google sign-in actually opens). Scoped to the Claude panel and throttled so a cancelled login can't loop.
- **No more "Windows Security" passkey prompt during sign-in.** That native "Sign in with a passkey / Insert your security key into the USB port" dialog pops up whenever a site (Google, etc.) asks for a passkey — a hassle if you don't use a security key. Vex now declines passkey requests so sign-in falls back to password/other methods and the dialog never appears. (Password autofill is unaffected. If you *do* want passkeys back, this can be turned off.)

### Changed
- **Removed the dead "Appearance" settings section.** The accent-color swatches fought the color themes (and did nothing useful once themes existed), and the "Show tabs sidebar" toggle duplicated the sidebar's own collapse button. The Appearance chip now jumps straight to the real look controls (GUI Style / Tab Layout).
- **The Tor tab now opens a search page you can use right away.** Clicking the onion used to land you on the Tor "check" page, which felt like a dead end. It now opens DuckDuckGo (which works cleanly over Tor — unlike Google, which drowns you in CAPTCHAs), so you can just start searching. The background check still confirms you're on Tor.

### Fixed
- **Tor tabs leaked into your saved session.** A tab opened over Tor was being persisted and, on the next launch, reopened as a *normal* tab — reloading a page you'd browsed privately over your real connection, and recording its URL. Tor (and off-the-record) tabs are now never saved — they vanish on close, as they should.
- **Tor now tells you if you're actually on Tor.** Finding Tor's port open doesn't mean Tor has finished connecting. Vex now verifies the tab really routes through Tor (via check.torproject.org) and shows a clear result — "🧅 Connected · exit IP …" on success, or a plain warning if the port's open but traffic isn't going through yet (still bootstrapping) or the proxy isn't Tor at all.
- **"Prevent from sleeping" was leaky.** A tab you'd kept awake could still get put to sleep by the background idle-hibernation sweep (which only spared the active/audible/pinned tabs, not kept-awake ones) — and the setting was dropped entirely when Vex restarted, because the restore code didn't carry the keep-awake flag back onto the tab. Both are fixed: the hibernation sweep now respects keep-awake, and the setting survives a restart (a timed "keep awake for N hours" resumes with its remaining time; "until reverted" stays until you turn it off). The **☕ badge** that marks a kept-awake tab was also broken — its style targeted the wrong CSS class and was only loaded after you opened the keep-awake menu, so after a restart a still-kept-awake tab showed no badge and *looked* disabled even though it wasn't. The badge now shows immediately on launch, in both the vertical and horizontal tab bars.
- **The keyboard-shortcut editor promised rebinds it couldn't deliver.** Twenty core shortcuts (New Tab, Find, Command Bar, History, Mute Tab, Toggle Sidebar, Fullscreen, …) are handled deep in the window layer, which fires them before the editor's binding is consulted — so "rebinding" them did nothing. They're now shown as fixed **system** shortcuts (the key still works, it just can't be reassigned), while the shortcuts that *can* be rebound still can. And the **Private Window** shortcut, which was a dead key (its Ctrl+Shift+N is taken by Notes, so it opened Notes), now lives on **Ctrl+Alt+N** and actually opens a private window.
- **Removed three persona-editor settings that did nothing** — "Preferred AI Backend", "Default tab context", and "Suggest follow-up questions" were saved but never read by anything (the AI router never received them; follow-ups come from the model's reply and the persona's own prompt). The misleading backend badge on each persona card is gone too. Temperature, Quick Prompts and the rest are untouched.

## v2.29.7 (2026-08-28) — Cleaner sidebar, theme-aware Glass, and a wave of fixes

### Added
- **Keyboard shortcuts now work while a web page has focus.** Previously, the moment you clicked into a site, the core browser shortcuts did nothing — only fullscreen/devtools/hard-reload reached the browser. Now **Ctrl+T** (new tab), **Ctrl+W** (close), **Ctrl+L** (address bar), **Ctrl+Tab / Ctrl+Shift+Tab** (switch tabs), **Ctrl+1–9** (jump to tab), **Ctrl +/−/0** (zoom), **Ctrl+F** (find) and **Ctrl+D** (bookmark) work everywhere. App shortcuts that web pages legitimately use (Ctrl+B bold, Ctrl+K quick-switcher) are deliberately left to the page.
- **The sidebar ships lean.** Only the browser core, your apps, Notes, Authenticator and GitHub stats show by default; the niche panels (Tab queue, RSS, Library, Annotations, Recall, AI memory, Schedules) are tucked away — one click to bring any back in **Settings → Sidebar**, or open them anytime with **Ctrl+K**.
- **Glass is now a first-class choice in the setup wizard**, and **the Glass look takes on your color theme** — pick Crimson and the frosted chrome glows red, Emerald green, and so on, instead of a fixed indigo.

### Fixed
- **Notes were unusable.** Selecting or creating a note threw an error and the editor never populated — the panel is fully working again.
- **Autofill typed your email into the wrong places.** In Discord, the "+ Add role" picker and "Find or start a conversation" search got your saved email. Autofill now only fills genuine login fields (never search/combobox boxes), while real logins — including 2-step email-first ones — still fill.
- **Right-click and popup menus wouldn't close when you clicked the web page.** The sidebar-button menu, tab menu, tools menu, extensions menu, media/volume/read-free popups and more now dismiss on the first click anywhere.
- **Menus were camouflaged over web pages.** The tab right-click menu and the URL-bar suggestions were semi-transparent and hard to read over a site; they're now solid.
- **Downloads silently overwrote same-name files.** A second `image.png` clobbered the first on disk — Vex now keeps both (`image (1).png`).
- **Sidebar buttons vanished when switching setup style** (Minimal ⇄ Full) and didn't come back; switching now restores every panel.
- **Picture-in-Picture toolbar button never worked right.** The page→browser "there's a video here" signal used a message channel that can't cross the `<webview>` boundary, so the toolbar PiP button's show/hide never fired and its click couldn't reach the video. Rewired over the correct webview IPC — the button now shows only when the active tab has a video and triggers native PiP. Also debounced the per-page video scan so it no longer churns CPU on busy sites like Discord.
- **"Save password?" could offer the wrong username** — anything typed into a 3+ character text field (a search box, a comment) was remembered as the login name. It now only remembers real username/email fields, scoped to the login form.
- **Restoring a saved session froze the browser.** Clearing the current tabs hit a loop where closing the last tab auto-created a new one, so the "close all" never finished. Restore now completes instantly.
- **The start page didn't match the theme in Glass mode.** With Glass on, the start page kept a fixed indigo/navy background regardless of the color theme, so themes like Ruby left it clashing with the themed chrome. It now derives its color from the theme, matching the rest of the window.
- **Scheduled tasks fired up to a minute early and could be skipped.** Daily/weekly/monthly tasks now fire *at* their time (not ~60s before), and a task missed while the computer was asleep runs when you're back (up to 6 hours late) instead of being silently skipped.
- **The AI chat could lock up.** An error in the wrong spot could leave the panel permanently refusing to send; it always recovers now.
- **PiP button now refreshes when you switch tabs** (it could show stale state from the previous tab).
- **Agent mode:** filling several fields on one page no longer aborts as "stuck," and the agent's type/select actions now report real success/failure instead of always "ok."
- **Reading Mode could trap a tab.** Entering Reading Mode and then restarting (or restoring the tab from a session) left the tab stuck on the article snapshot with no way back to the real page, and dumped a huge snapshot URL into your history. Reading Mode is now treated as the temporary view it is — the tab keeps its real page and history stays clean.
- **Restored tab stacks no longer vanish**, tab drag-reorder drops where you expect, and very large downloads (≥1 TB) show the right size unit.
- **No more favicon tracking.** Vex was fetching site icons from Google (`google.com/s2/favicons`) across the tab strip, history, bookmarks, Recall, Read-Later, the sidebar's pinned sites, the start-page speed dial, and more — which quietly told Google every domain in your tabs, history and bookmarks. Every one of those now uses the site's own first-party favicon. Nothing about your browsing goes to Google.
- **Smaller fixes:** URL-bar ArrowUp now reaches the last suggestion; the command palette no longer shows a duplicate "History"; dragging a tab onto a stack no longer misplaces it; open-tab full-text history indexing works again; the tab-sidebar toggle shows its pressed state; a benign navigation error no longer spams the console; and the Discord spellcheck replacement is more reliable.

## v2.29.6 (2026-08-27) — Safer DRM settings + build guardrail

### Fixed
- **Removed a "Reset DRM" button that appeared on a *healthy* DRM component.** Settings → About offered a reset even when Widevine was working; resetting a healthy component is destructive (it clears and re-downloads it, then restarts Vex) and was based on a misdiagnosis. The button now appears only when the DRM component has actually failed to load, labeled "Retry," with a confirmation first.

### Changed
- **Builds now verify the packaged app's Verified Media Path (VMP) signature and abort if it's invalid** — a fail-closed guard so a build can never again ship broken Spotify/Netflix/Prime DRM (the cause of the pre-2.29.5 breakage). Belt-and-suspenders on top of the 2.29.5 `afterSign` fix.

## v2.29.5 (2026-08-27) — DRM playback actually fixed (valid VMP signature)

### Fixed
- **Spotify, Netflix, Prime Video, Disney+ — all DRM playback failing (tracks skip / "can't play right now" / video won't start).** The real cause was a packaging bug, not app code. Vex's Widevine Verified Media Path (VMP) signing ran as electron-builder's `afterPack` hook, which fires *before* Authenticode code-signing — so a valid VMP signature was applied and then immediately invalidated when Authenticode re-wrote `Vex.exe`. Shipped builds carried a signature that castLabs' own verifier rejects (`InvalidSignature`), so streaming services' license servers refused the Widevine license (Spotify returned HTTP 403: audio downloaded but couldn't be decrypted, so each track auto-skipped to the next; Netflix/Prime/Disney+ failed the same way). Fixed by moving the signer to the `afterSign` hook, so VMP signing is the last step to touch the binary and the signature stays valid. This supersedes the 2.29.2 and 2.29.4 attempts — those treated symptoms of individual Spotify tracks, but the invalid signature was the root cause and it affected *all* protected playback, not a subset.

## v2.29.4 (2026-08-26) — Spotify playback: the real fix (hardware DRM)

### Fixed
- **"Spotify can't play this right now" on a subset of tracks — actually fixed this time.** The tracks that failed play fine in Chrome, so it was never a Spotify restriction: Chrome enables hardware-backed Widevine decryption by default and Electron does not, so Vex only offered the basic software robustness (SW_SECURE_CRYPTO) and the tracks that need more failed. Vex now enables `HardwareSecureDecryption`, which activates the MediaFoundation Widevine CDM — verified on a signed build to unlock SW_SECURE_DECODE and all hardware robustness levels. Falls back to software automatically on machines without hardware DRM, so it can't regress them. (The 2.29.2 robustness-retry was treating the symptom; this addresses the cause. As a bonus, Netflix/other DRM video can now use HD/hardware paths too.)

## v2.29.3 (2026-08-26) — Spellcheck fix sticks in Discord

### Fixed
- **Right-click "fix word" reverted in the Discord composer.** Clicking a spelling suggestion replaced the word, but as soon as you clicked next to it and typed, the misspelled word came back. Discord's editor (Slate.js) keeps its own model and reconciles the DOM to it — and because clicking Vex's menu takes focus off the Discord frame, the replacement never reached Slate's model. Vex now re-focuses the frame and re-selects the word before replacing, so the fix registers and sticks. Plain inputs and other editors (e.g. Claude) are unaffected.

## v2.29.2 (2026-08-26) — Claude notification error suppressed

### Fixed
- **Some Spotify tracks showed "Spotify can't play this right now."** Spotify requests a higher Widevine robustness (SW_SECURE_DECODE) for a subset of tracks than Electron's DRM provides (SW_SECURE_CRYPTO), so those specific tracks failed while the rest played. Vex now retries the failed DRM negotiation at the level it does support, so those tracks play. (Only kicks in when the original request fails; never weakens working playback.)
- **"An unknown error occurred while enabling push notifications" on the Claude panel** persisted even after 2.29.1 removed the Push API — claude.ai shows its notification toggle based on the Notification API and then attempts a push subscription that no Electron browser can service. Vex now reports notifications as unavailable on claude.ai, so it shows a normal "notifications blocked" state instead of an error. (Web Push is an inherent Electron limitation; foreground notifications from claude.ai are disabled as part of this.)

## v2.29.1 (2026-08-26) — Password saving, push-notification & first-run fixes

### Added
- **Password saving that actually catches modern logins.** Vex now offers to save your login on sites that submit with a button + JavaScript (Spotify, Google, most apps) and across multi-step email-then-password flows — not just old-style form submits. Saved logins autofill on return, and **clicking an empty login field brings the saved data back** (click-to-fill). Sidebar panels (Spotify, WhatsApp, Claude…) get save + autofill too, which they didn't before.

### Fixed
- **"An unknown error occurred while enabling push notifications" on the Claude panel (and other sites).** v2.29.0 shimmed the Push API to a rejecting object, but sites detect push by whether `pushManager` exists — so they still tried and errored. Vex now fully removes the Web Push surface, emulating a browser without push (like older Safari), which every major site handles gracefully by simply not offering push. Regular notifications are unaffected.
- **Two welcome screens on a fresh install.** The setup wizard and a legacy welcome card both appeared at once. The wizard is now the single first-run welcome, with "Take a tour" moved onto its final step.

### Changed
- **More Google sign-in hardening.** In addition to the userAgentData fix, Vex now presents a fully-populated `window.chrome` (runtime/app/csi/loadTimes) on Google pages so the browser fingerprint matches real Chrome more completely.

## v2.29.0 (2026-08-25) — Choose-your-Vex onboarding, tab drag-reorder & a stack of long-standing fixes

### Added
- **"Choose your starting point"** — a new wizard step right after Welcome. Pick **The Mortuex Setup** (everything on, exactly how Vex's creator runs it), **Minimal** (a clean browser — no app panels, empty shortcut bar), **Custom** (per-panel and per-shortcut checkboxes plus a Glass toggle), or **Use a shared setup** (paste a setup code). Each card has a visual preview; every choice is reversible in Settings → Sidebar.
- **Shareable setup codes** — export your whole setup (panels, shortcuts, theme, Glass/Classic) as a `VEXSETUP1.` code from the wizard; anyone can paste it into theirs and Vex arranges itself to match. Codes are validated live and sanitized on import.
- **Drag tabs to reorder** — hold and drag tabs on the top strip like any browser: an insertion line shows where the tab lands, dropping into a group joins it, dragging into the pinned zone pins it, and pulling a tab out of a stack keeps stack bookkeeping intact.
- **Declutter nudge** — two weeks after install, if several app panels were never opened, Vex offers (once, dismissible) to hide them.
- **Daily wisdom, your way** — the start-page daily verse is now a choice: Qur'an (Turkish or English), Bible, Tanakh, secular quotes from philosophers and writers, or off entirely. Bible/Tanakh/quotes rotate through curated local sets — no network needed.
- **Start page language** — English or Türkçe, covering the greeting, labels, search placeholder, and the daily verse (full interface translation is on the roadmap).
- **Right-click menus in editable fields now offer Cut / Copy / Paste / Select All**, with spellcheck suggestions on top.

### Fixed
- **Google sign-in rejected Vex** ("This browser or app may not be secure") — the page-visible `navigator.userAgentData` lacked the "Google Chrome" brand the spoofed UA claims; a scoped site tweak grafts it in, version-consistent with the real Chromium build.
- **Tabs shrank on every tab switch and stopped covering the strip** — the size classifier measured its own class-forced widths back (a one-way ratchet) and `very-narrow` tabs were hard-locked at 40px. Sizing is now computed from available width, tabs always fill the bar, and stale scroll offsets are clamped.
- **"An unknown error occurred while enabling push notifications"** — Electron cannot service Web Push, but advertised the API, so sites walked into an always-failing subscribe. The Push API is now hidden from feature detection, and direct `subscribe()` callers get a clean Chrome-like `NotAllowedError` instead of a crash. Regular notifications keep working, and Windows toasts now display in every run (AppUserModelID set at startup).
- **Right-click did nothing in the sidebar app panels** (Discord, Claude, Spotify, WhatsApp…) — the menu wiring guarded on a `window` property that never existed. Panels now get the full Vex context menu.
- **Spellcheck never actually worked** — no Hunspell dictionary was ever downloaded and sessions were never configured. Sessions now get explicit languages and the en-US dictionary is installed from the main process (immune to per-session proxies), so misspelled words get red squiggles and right-click suggestions everywhere, including the Discord panel.
- **Console spam `file:///C:/sync/...` on boot** when sync state existed without a configured worker URL — all sync endpoints now bail cleanly when unconfigured.
- **"What's New" showed "Couldn't load the release notes (offline?)" to online users** — release notes now come from the changelog bundled inside the app (no network, no rate limits); GitHub is only a last-resort fallback.

## v2.28.1 (2026-07-08) — Sidebar toggle: no more leftover strip

### Fixed
- **Closing the left sidebar (Ctrl+B) left an empty colored strip behind.** The toggle zeroed only the rail's width — its own margin, padding and border stayed, and the Glass GUI style's fixed 46px rail width overrode the collapse entirely. The rail now collapses to nothing in both Classic and Glass styles, and the page/webviews (including the sidebar site panels) reflow to use the full window width.

## v2.28.0 (2026-07-07) — Electron 42 (Chromium 148) + media-health hardening

### Changed
- **Electron upgraded 30.5.1 → 42.5.2 (castLabs, Widevine)** — Chromium jumps 124 → 148, picking up two years of security patches, codec/GPU fixes, and web-platform features. Verified: full test suite, smoke boot, Widevine CDM initialization (4.10.3050.0), and the site-tweak injections all pass on the new runtime.
- **Per-site page patches now live in one registry** (`src/site-tweaks.js`) instead of hand-rolled blocks in the webview preload. The Discord always-visible spoof and the HEVC mask are entries in a table (host pattern + main-world code + injection mechanism), unit-tested, and registered as their own preload — webview preloads are sandboxed, so the registry can't be `require`d from the main preload (verified: a local require silently never loads there).

### Added
- **Media decode failures are now surfaced.** Guest pages report media error events and the frozen-decode signature (playback time advancing, zero new decoded frames — exactly how the TikTok HEVC bug manifested, with no error event at all) to the host, which logs them against the page URL and shows a one-per-session toast. The next codec bug gets diagnosed from the console instead of from a vibe description.
- **HEVC mask extended to Instagram** — Reels serve H.265 the same way TikTok does, with the same frozen-frame failure mode on GPUs where hardware HEVC decode is broken; Instagram now falls back to H.264 too (verified live: HEVC probes denied, H.264 intact).
- **One-command releases** — `node scripts/release.js <version> "<title>"` verifies the CHANGELOG entry exists, bumps versions, commits only the release files, pushes, builds + publishes the GitHub release, and updates the website's version badge, so the repo, the release, and the website can no longer disagree.

## v2.27.23 (2026-07-07) — TikTok: videos no longer freeze on the first frame

### Fixed
- **TikTok videos showed a single frozen frame while the audio played on.** TikTok probes the browser for HEVC/H.265 support and serves its `bytevc1` (H.265) streams when the browser says yes — Electron's codec probes answer "yes" (the platform-HEVC path exists), but the actual hardware decode fails, so only the first keyframe ever rendered. Vex now hides HEVC from TikTok's codec probes (`MediaSource.isTypeSupported`, `canPlayType`, `mediaCapabilities.decodingInfo`), so TikTok falls back to H.264, which decodes everywhere. Scoped to tiktok.com; injected via `webFrame.executeJavaScript` because TikTok's CSP blocks inline-script injection.

## v2.27.22 (2026-07-04) — Discord panel: no more random reloads

### Fixed
- **The Discord panel randomly reconnected and dropped to the loading screen** when you switched to another tab and came back. Hiding the panel (`display:none`) flipped its Page Visibility to "hidden", so Discord tore down its gateway WebSocket and did a full reload when it couldn't resume. Vex now keeps the Discord guest reporting as always-visible (Page Visibility API spoofed, scoped to Discord only), so it stays connected across tab switches with no loading-screen flash.

## v2.27.21 (2026-06-19) — Feature drop: inline AI edits, link hints, smart recall & more

### Added
- **Inline AI text edits** — select text in any editable field and the selection bar now offers **✍️ Rewrite / ✓ Fix / ✂️ Shorten**, which transform the text and write it back in place (read-only Explain/Summarize/Translate still there for any selection).
- **Keyboard link hints** — press **`f`** on a page to overlay letter labels on every link/button; type the label to click. **Shift+F** opens a link in a new tab, **Esc** cancels. Toggle with the `vex.linkHints` setting (default on).
- **Tor tab** — a new 🧅 onion button in the top-right toolbar (and "New Tor Tab" in the command bar) opens a maximum-security private tab: a throwaway in-memory session routed entirely through a local Tor SOCKS5 proxy with remote DNS (no leak), **WebRTC disabled**, all site permissions denied, and fingerprint resistance. Requires Tor running locally (Tor Browser on port 9150 or a tor service on 9050); Vex guides you to start it if it isn't detected, and opens check.torproject.org to confirm.
- **New Identity tab** (command bar) — opens a throwaway, fully isolated session (cookies/storage vanish on close) with a freshly rotated, self-consistent Chrome fingerprint. Unlike the fixed containers, sites can't correlate it with your logins.
- **Smart Recall** — the Recall panel has a **✨ Smart search** toggle: the AI expands your natural-language query into related terms and merges the full-text results, so you can find a page by *meaning*. (Press Enter to run; no new dependency.)
- **Catch Me Up** (command bar) — an AI digest of your newest RSS items + unread Read Later, with the source articles listed to open directly.
- **Workspace Time-Travel** (command bar) — auto-snapshots each workspace's open tabs every 10 minutes (and on demand); restore any past tab set non-destructively as new tabs.

### Changed
- **Auto-reject cookie banners** — the consent blocker now actively clicks "Reject all" across the major CMPs (OneTrust, Cookiebot, Didomi, Usercentrics, Quantcast, Google FC…) instead of only hiding the banner, so the opt-out is actually recorded.

### Fixed
- **Discord stream pop-out** — now remembers its size/position and floats picture-in-picture style (**Ctrl+Shift+P** toggles the on-top pin). Crucially, always-on-top is **automatically dropped while the pop-out is fullscreen**, so **Alt+Tab works** (the earlier pin level trapped app-switching).

## v2.27.20 (2026-06-19) — Discord panel: no freeze on return + working stream pop-out

### Fixed
- **The Discord panel froze for a few seconds** when you closed it (clicked the Discord button again) or switched to another tab and came back. Hiding the panel sets the guest to `display:none`, and Electron's default background throttling let Chromium suspend the page — so on return the heavy Discord SPA had to reconnect its gateway and replay throttled timers before it could paint. The Discord panel's webview now runs with `backgroundThrottling=no`, so it stays live while hidden and re-shows instantly. (Scoped to Discord only; other panels keep default throttling to save battery.)
- **Discord "Pop Out" (watching a friend's screen-share / stream) opened in a cramped preview** where **Full Screen did nothing** and **"Open as tab" loaded a blank tab**. The pop-out is a scripted `window.open` from Discord, so it was being dressed as the Peek auth-popup card (which forces `fullscreenable: false` and bolts on a stream-breaking "Open as tab" bar). Discord pop-outs now open as a **normal resizable, fullscreenable window** pinned to the Discord session — fullscreen works and the broken chrome bar is gone.

## v2.27.19 (2026-06-19) — "Prevent from sleeping" per tab

### Added
- **Right-click a tab → ☕ Prevent from sleeping** — choose how long to keep it awake: **1 / 5 / 12 / 24 hours, Custom…, or Never (until reverted)**. Kept-awake tabs are skipped by auto-sleep + the memory-pressure guard, show a small ☕ marker, and the setting persists across restarts. Manual "Sleep Tab" still works (it overrides). Re-open the menu to change or "Allow sleeping again".

## v2.27.18 (2026-06-19) — Hotfix: Discord panel rendered blank

### Fixed
- **Discord panel showed only the top and went blank below** in v2.27.17 — the new back/forward bar restructured the panel into a flex column, but `showPanel` sets the panel's display inline, so the layout never applied and the webview collapsed. The nav buttons now **float over the panel** (the webview is never resized).

## v2.27.17 (2026-06-19) — Discord login in tabs + panel back/forward

### Added
- **Discord works in normal tabs through the bypass** — when the Discord bypass is on, `discord.com` / `discord.gg` / `discordapp.com` now route through it in regular tabs too (via a PAC script; everything else stays direct). Fixes the **OAuth "Login with Discord" authorize page** and "Open in Discord" links hanging on censored networks. (TCP only — voice still needs Zapret.)
- **Back / forward / reload bar on the Discord panel** — web Discord lacks the desktop app's history buttons, so the panel now has a slim nav bar (themed for Classic + Glass).

## v2.27.16 (2026-06-18) — "What's New" closes when you open the release

### Fixed
- The "What's New" modal now **closes automatically** when you click "View latest release on GitHub" (the release opens in your browser, so there's no reason to keep the modal up).

## v2.27.15 (2026-06-18) — "What's New" opens the latest release in your browser

### Fixed
- The **"View on GitHub"** link in the update-log modal now opens the **latest release** in your **system browser** (so GitHub renders properly), instead of an in-app window where its stylesheet could fail and show a bare navigation menu.

## v2.27.14 (2026-06-18) — Glass shortcuts bar (favicons + custom) & window-show fix

### Added
- **Glass shortcuts bar upgrade** — each shortcut now shows the site's **real favicon** (letter-chip fallback), an **＋ Add shortcut** button, and **right-click any shortcut → edit name / link / color, or delete**. Custom shortcuts persist.

### Fixed
- **Window sometimes opened in the taskbar but never surfaced** — the transparent/frameless window is now created hidden and shown only once it's painted (with a safety fallback), fixing the blank/unfocusable launch.

## v2.27.13 (2026-06-18) — Glass GUI, Discord voice/screen-share, Roblox panel, update logs

### Added
- **New "Glass" GUI Style** (Settings → GUI Style) — a whole-UI look you switch with one click: **tabs move on top**, a Chrome/Firefox-style **shortcuts bar** appears below the address bar, window controls move to the tab row, and the chrome + home page turn **frosted glass** with a soft glow. Self-contained palette (independent of your color themes); Classic stays the default.
- **Discord voice now captures your headset** — mic input *and* output/device selection work in the Discord panel (the media permission is auto-granted for the dedicated Discord session, which was previously blocked by a prompt that never surfaced).
- **Screen share / Go Live** — a proper "Choose what to share" picker (screens + windows, with thumbnails) for `getDisplayMedia`, including system-audio loopback.
- **Roblox as a sidebar panel** — opens `roblox.com` as a clean panel like Discord (replacing the old Roblox Hub), with a **🛡️ Block bypass** toggle that shares Discord's ByeDPI for censored networks.
- **Update logs ("What's New")** — after Vex auto-updates, a modal shows that release's notes pulled straight from the GitHub release. Re-openable anytime.

## v2.27.12 (2026-06-18) — The Roku Channel in the streaming switcher

### Added
- **The Roku Channel** (free, licensed) joins the streaming panel switcher — right-click the streaming icon → **📡 Switch to Roku Channel**, alongside Netflix / Prime Video / Disney+. Shares the same session and swaps the URL + icon.

## v2.27.11 (2026-06-18) — Discord bypass: one-click Auto-configure (now actually works)

### Added
- **🔧 Auto-configure bypass** (right-click Discord, and the auto "Discord looks blocked" popup) — sweeps every ByeDPI desync mode, **rigorously tests each against a real Discord handshake** (two requests must both pass, so a fluke doesn't win), shows a live "Testing mode X/N…" card, and keeps the first that genuinely works. Built-in light is only a last resort. Each mode's real result is logged to `userData/byedpi/sweep.log`.
- The bypass now **runs on startup** and, on success, **auto-reloads the Discord panel** so it just works with no blank flash.

### Fixed
- **ByeDPI presets that silently crashed** — `--md5sig` isn't supported by ByeDPI v0.17.3, so every preset using it exited immediately ("unknown option") and the sweep never reached a working mode. Presets reworked to valid flags only; the known-good `--fake -1 --ttl 8 --tlsrec 1+s` is tried first, plus `--fake-sni` (fake an allowed domain so the DPI whitelists the connection).
- The sweep no longer **short-circuits on the built-in light test** (which could pass without actually carrying the app) — ByeDPI desync modes are tried first.

### Changed
- Simplified the Discord right-click menu to **Auto-configure bypass** + **Turn bypass off (use Zapret)** — no more Light/Strong/preset/custom clutter.

## v2.27.10 (2026-06-18) — Stronger Discord bypass (ByeDPI, auto-tuning) [experimental]

### Added
- **Strong Discord bypass via ByeDPI** — right-click Discord → "Bypass: Strong (ByeDPI, auto-tune)". Vex downloads the official userspace ByeDPI (`ciadpi`) on demand and runs it as a local SOCKS5 desync proxy (split/disorder/fake-TTL/tlsrec) — the power of Zapret/GoodbyeDPI without admin. **Auto-tune** walks ~10 desync presets and keeps the first whose Discord TLS handshake actually completes; you can also force a specific preset or paste **custom ByeDPI flags**. ciadpi output is logged to `userData/byedpi/ciadpi.log`. Robust start (verifies it's listening, retries).
- Three bypass levels now: **Off** (use your own Zapret), **Light** (built-in DoH + SNI fragmentation), **Strong** (ByeDPI).

### Notes
- Experimental: desync effectiveness is ISP-specific and stateful, so it may be inconsistent; antivirus can flag `ciadpi.exe`. If none of the presets get through, run Zapret and set bypass to Off.

## v2.27.9 (2026-06-18) — Discord panel with block-bypass + Vencord support

### Added
- **Discord in the sidebar** — a Discord panel (its own `persist:discord` login), with a built-in **censorship bypass** for regions where Discord is blocked (e.g. Turkey): the session is routed through a local proxy that resolves over **DNS-over-HTTPS** and **fragments the TLS ClientHello inside the SNI** across two TCP segments (the GoodbyeDPI/ByeDPI/Zapret "split" technique). On by default, scoped to Discord only, fail-open; toggle via right-click → "Block bypass". Best-effort — a stubborn DPI may still need a dedicated tool.
- **One-click Vencord** — right-click the Discord icon → "Install / Update Vencord" downloads the official Vencord browser extension and loads it into the Discord panel (Vex now loads extensions into that session, and relaxes CSP there so Vencord can inject). Custom userplugins are supported by building Vencord's web extension (`pnpm buildWeb`) and loading it via Settings → Extensions.

## v2.27.8 (2026-06-17) — Search shortcuts, Master Volume, Netflix, image zoom

### Added
- **Search keywords & bangs in the address bar** — `yt cats` → YouTube, `gh vex` → GitHub, `w einstein` → Wikipedia, `a usb cable` → Amazon, etc., plus DuckDuckGo bangs anywhere (`!w einstein`, `einstein !yt`). Built-ins: `g · ddg · b · yt · gh · w/wiki · a/amazon · r/reddit · so · npm · mdn · maps · img · x/tw · imdb · tr`; add your own via `localStorage 'vex.searchKeywords'`.
- **Master Volume** — Quick Tools → "Master Volume": one slider (0–500%) for media across every tab and panel, in real time. Above 100% boosts via Web Audio (works on tabs/normal media); cross-origin and DRM media (Netflix/Disney+/Prime) are limited to 0–100% by design (their audio can't be amplified).
- **Netflix** — back as a sidebar panel (the "N", on its own `persist:netflix` session). **Right-click it to switch between Netflix / Prime Video / Disney+** — the icon changes to match and all three share one login jar.
- **Zoom image** — right-click any image → "Zoom image" opens a pan & zoom lightbox (scroll to zoom at the cursor, drag to pan, double-click to fit, Esc to close).

### Changed
- Relaxed the autoplay policy so AudioContexts start immediately — required for Master Volume's boost to engage.

## v2.27.7 (2026-06-17) — Power tools: selection AI, Read Free, Media Grabber, faster suggestions

### Added
- **Selection AI** — select text on any page and a floating **Explain / Summarize / Translate** bar appears above it (one gesture instead of right-click → menu). The right-click menu also gains **Summarize selection**, between Explain and Translate.
- **Read Free** — get past paywalls on the page you're reading (Quick Tools → 📰 Read Free, or Ctrl+K). Three tactics: **reset a metered paywall** (clears just that site's cookies + storage and reloads — resets "N free articles a month" counters), **open a free archived copy** on archive.today (for hard subscriber walls), or **reading mode**.
- **Media Grabber** — find and save video/audio playing on a page (Quick Tools → 🎬 Download Media, or Ctrl+K). Progressive files (mp4/webm/mp3/…) download in one click; HLS/DASH stream links can be copied/opened for VLC or yt-dlp. DRM/MSE video (YouTube, Netflix) can't be captured and isn't listed.

### Changed
- **Address-bar suggestions are much faster** — the Google-suggest debounce dropped from ~270 ms to ~80 ms, with a renderer-side cache (backspacing/re-typing is instant, no network) and a main-side LRU cache + request timeout. Feels like Chrome now.
- **Memory panel shows real numbers** — actual per-tab OS-process memory (was fixed 150/80/1 MB estimates), a true browser total, an "N asleep" count, and a `·shared` tag for same-site tabs that share a process.

### Fixed
- **Auto-sleep no longer silences audio** — auto-sleep, "Sleep inactive", and the memory-pressure guard now skip a tab that's actively playing audio (muted tabs are still fair game).

### Internal
- New `npm run smoke` — a real-Electron boot smoke test that asserts the renderer initializes (tab + webview render, core managers defined) in an isolated profile; catches "won't boot / renderer throws" regressions the unit tests can't.

## v2.27.6 (2026-06-17) — OAuth popups survive redirect-started flows + Peek-style login window

### Fixed
- **Discord/Ticket Tool login now actually completes.** v2.27.5 gated on the popup's *first* URL shape, but Ticket Tool opens its login popup at a non-OAuth-shaped bounce URL (`api.tickettool.xyz/api/auth/login`) that only *then* redirects into `discord.com/oauth2/authorize` → callback. `setWindowOpenHandler` never re-fires on in-window redirects, so the first-URL gate missed it and the popup still dead-ended in Peek. Vex now also keeps a popup real when it's a **scripted `window.open` popup** (disposition `new-window` *with* window features or a frame name) — a real opener-connected window in every browser, regardless of where it navigates next — so redirect-started OAuth flows survive. Bare shift+click (no features/name) still routes to Peek, unchanged.

### Changed
- **The login popup is dressed like the in-app Peek overlay again** — a compact, frameless rectangle centered over a dimmed Vex, with the Peek chrome bar (back · reload · URL · **Open as tab** · copy · close) overlaid on top. It stays a real `window.opener`-connected window (the Peek overlay itself can't host the opener, which is what broke the login), so the look is restored without breaking the handback. Drag the bar to move it; **Esc** or a backdrop click dismisses it; it auto-closes when the provider finishes.

### Notes
- This widens the opener-intact treatment from "OAuth-shaped URLs" to "any scripted `window.open` popup" — standard browser behavior; non-scripted navigations still route to tabs/Peek.
- `scripts/verify-oauth-popup-partition.js` gains **Scenario C** (bounce → OAuth redirect): proves the popup stays real with `window.opener` intact *through* the redirect, pinned to the opener's partition — a scenario the old first-URL gate cannot pass. 24/24 checks green; unit tests added for the scripted-popup detector.

## v2.27.5 (2026-06-17) — Fix: Discord (and other) OAuth logins failing in popups

### Fixed
- **OAuth logins that use a popup now complete and log the originating tab in** — previously a Discord-OAuth flow (e.g. the Ticket Tool dashboard at tickettool.xyz) had its auth popup routed into the Peek overlay, which severed `window.opener`, so after authorizing, the callback showed *"Login process is successful. But something went wrong…"* — the code exchange worked but the session handback to the tab failed. Vex now keeps **any OAuth-shaped popup** (not just the 4 hard-coded providers) as a real popup with `window.opener` intact, gating on URL *shape* — path `…/oauth2?/(authorize|auth)` or `…/auth/(authorize|callback)`, or `response_type=code`, or `client_id`+`redirect_uri` — instead of a host allowlist. The popup is also pinned **explicitly to the originating tab's session partition**, so the login cookie lands where the tab can read it — verified for container tabs (`persist:container-work`) and off-the-record tabs, not just the default session.

### Notes
- This widens the real-popup (opener-intact) treatment from the 4-host allowlist to any OAuth-shaped popup. That is standard browser behavior and applies only to OAuth-shaped popups (non-OAuth `window.open` popups still route to Peek); it does not change data isolation (the popup shares the opener tab's partition, as the allowlisted providers already did).
- New `scripts/verify-oauth-popup-partition.js` proves the popup's session in real Electron (identity, on-disk partition path, cookie landing, ephemeral OTR, `window.opener` non-null). Unit tests added for the OAuth-shape detector.

## v2.27.4 (2026-06-16) — "Copy Text from Doc" reliably gets the real Google Docs text

### Fixed
- **"Copy Text from Doc" now actually gets the real text from Google Docs instead of falling back to OCR.** The previous version fetched Google's `mobilebasic`/export endpoints from *inside* the editor page, where Google Docs' service worker intercepts the request and returns the canvas app shell (no real text) — so every text path looked blocked and it dropped to OCR. It now loads Google's plain-HTML render (`/mobilebasic` for Docs, `/htmlview` for Sheets) as a **real top-level navigation in a hidden, off-screen webview on your logged-in session** — the manual "change the URL to mobilebasic" trick, automated — and reads the rendered text. A real navigation gets the genuine text page, so you get exact text with no OCR mistakes. The in-page export fetch is now a secondary path and OCR is only a last resort. The result panel header shows which path ran ("Google Doc (real text)" vs "OCR (visible page)").

## v2.27.3 (2026-06-16) — "Copy Text from Doc" now gets the REAL text (no OCR mistakes)

### Changed
- **"Copy Text from Doc" now extracts the document's actual text first, like the dedicated "unlock copy" extensions — exact, no OCR errors.** Instead of jumping to OCR, it now fetches Google's own real-text render endpoints from inside the page (so they carry your Google login cookies), in order: **`/mobilebasic`** (Google's server-rendered plain-HTML version — gated differently from the download, so it still serves the real text on most copy-disabled docs), then **`/export?format=txt`**, then **`/export?format=html`**. Sheets use `export?format=csv` + `htmlview`; Slides use the text export. The first path that returns real content wins → exact text with zero mistakes. It detects sign-in / "request access" interstitials and skips them instead of returning a junk login page. **OCR (Tesseract.js, on-device) is now only a last resort** if Google hard-gates every text path.

## v2.27.2 (2026-06-16) — Copy text out of Google Docs & copy-locked pages

### Added
- **"Copy Text from Doc" — get the text out of Google Docs and copy-locked pages.** Copy Unlock (v2.27.0) re-enables selection of normal page text, but **Google Docs renders its text on a `<canvas>`**, so there's no selectable text to unlock — it needs a different approach. The new tool (Quick Tools menu → "Copy Text from Doc", or Ctrl+K → "Copy Text from Doc") gets the text two ways automatically: (1) **Google export fast path** — for Docs/Sheets it fetches the document's own `/export?format=txt|csv` endpoint *from inside the page*, so it carries your Google login cookies and returns exact text when you have view access; (2) **OCR fallback** — if export is blocked or the doc is canvas-rendered, it captures the rendered page and reads the pixels with Tesseract.js (loaded on demand, runs **entirely on your machine** — the image never leaves it). The extracted text is copied to your clipboard and shown in a panel you can select and edit. OCR works per visible screen (scroll + re-run for long docs); the export path needs you signed into Google with view access.

## v2.27.1 (2026-06-16) — Quick Tools menu in the top bar (puzzle button)

### Added
- **A "Quick Tools & Extensions" button in the top bar, just left of the AI button.** Click the puzzle icon for a one-tap menu of handy per-page tools — **Unlock Copy & Right-Click** (the new Copy Unlock feature, first in the list), Reading Mode, Dark mode for this site, Translate Page, Read Aloud, Zap Element, Boost This Site, Screenshot, Responsive Preview, and Privacy Report — plus **Manage Chrome extensions…** which opens Settings. Each item runs the same action as its command-bar entry, so behavior stays consistent. The popover is themed (matches every theme, light or dark), and dismisses on Esc or an outside click.

## v2.27.0 (2026-06-16) — Copy Unlock: bypass sites that block selecting & copying

### Added
- **Copy Unlock — re-enable selecting, copying, and right-click on sites that disable them.** Lots of pages turn off text selection and the right-click menu (via CSS `user-select:none`, `oncontextmenu` blockers, or capture-phase handlers that swallow `copy`/`selectstart`). Vex can now bypass that. Two ways to use it: **Ctrl+K → "Unlock Copy & Right-Click"** unlocks just the current page on demand (the "let me copy this" button), or turn on **Settings → Browsing extras → "Always allow copy & right-click (bypass site blocks)"** to apply it automatically on every page. The unlock re-enables selection via injected CSS, clears the inline `on*` blockers sites re-assign, and stops their capture-phase block handlers **without** calling `preventDefault` — so the native copy and context menu go through, and Vex's own mouse gestures keep working. Default is **off** so it never interferes with legitimate copy handlers in web apps (spreadsheets, code editors). Note: it can't read canvas-rendered editors like Google Docs (there's no selectable text there) and never touches DRM-protected media.

## v2.26.5 (2026-06-15) — Reliable build gate for invalid Widevine (VMP) signing

### Changed
- **The build now aborts when the Widevine signer falls back to a development/cached signature** — the deterministic signal that the app isn't validly signed for DRM (Spotify/Netflix). `scripts/vmp-sign.js` scans `sign-pkg`'s own output for "Certificate is valid for development only" / "Using cached signature" and fails the build with remediation steps. (v2.26.4 relied on `verify-pkg`, which proved unreliable as an in-build gate — it reported success in the build environment while failing standalone.) Set `VEX_SKIP_VMP_VERIFY=1` to build without DRM on purpose. **Fixing DRM requires a valid castLabs EVS signature** (`python -m castlabs_evs.account reauth` / `signup`, then rebuild) — it is not an app-code issue.

## v2.26.4 (2026-06-15) — Build fails loudly when the Widevine (VMP) signature is invalid (superseded by 2.26.5)

### Changed
- Attempted to gate the build on `vmp verify-pkg` after signing; this proved unreliable in the build environment (passed in-build while failing standalone) and is superseded by the output-detection gate in v2.26.5.

## v2.26.3 (2026-06-15) — DRM Retry now resets the stuck component-updater state

### Fixed
- **DRM Retry now actually recovers a stuck Widevine install.** On affected machines the standard Widevine CDM had registered but never finished downloading (empty `WidevineCdm` folder, no version recorded), and the component updater kept backing off — so clearing only the folder (v2.26.2) didn't help. Retry now also drops the updater's record of the Widevine components from `Local State` (preserving the encryption key that protects your saved passwords/cookies), so the relaunch re-downloads the CDM from scratch.

## v2.26.2 (2026-06-15) — DRM Retry now clears the cached component (clean re-download)

### Fixed
- **The DRM "Retry" button now clears the cached Widevine component before relaunching.** A plain relaunch didn't help when the first install left a partial/corrupted component on disk — the updater kept reusing the broken copy and failing every time. Retry now wipes the component cache under your profile so the relaunch re-downloads it cleanly.

## v2.26.1 (2026-06-15) — Resilient Widevine/DRM setup + Retry button

### Fixed
- **DRM ("Widevine") setup is now resilient and recoverable.** Settings → About could show *"DRM failed: …"* with no way to recover, and a stalled CDM download could even delay the main window. The castLabs Widevine component now initializes fire-and-forget (never blocks window creation), each attempt races a 30s timeout, and a slow first-run download gets a second attempt. When it does fail, **Settings → About now shows a Retry button** that relaunches Vex to re-run the install (the reliable fix for a transient first-run network failure), and the status re-polls so a slow download flips to "ready" on its own. Protected playback (Spotify/Netflix) works once the CDM reports ready.

## v2.26.0 (2026-06-15) — EasyList ad blocking, tab hibernation, per-site dark mode & privacy fixes

### Added
- **EasyList + EasyPrivacy ad/tracker blocking.** The request blocker now runs on the full EasyList + EasyPrivacy filter sets (via `@ghostery/adblocker`), a huge coverage jump over the previous hand-maintained domain list. It's wired surgically — Vex calls the engine's matcher inside its own request handler rather than handing over `webRequest`, so the tracker counter, per-partition wiring, and frame-ancestors stripping all keep working. The legacy list is still ORed in so nothing regresses, the engine never blocks page navigations, and the compiled engine is cached under your profile for instant, offline-safe startup.
- **Tab hibernation.** Background tabs left idle past a threshold (default 30 min; set `vex.tabHibernateMinutes` to `0` to disable) are suspended to free memory and reloaded when you click back. The active tab, audio-playing tabs, pinned tabs, and local/start pages are never suspended.
- **Per-site dark mode.** Right-click a page → **Dark mode for this site** to force-darken just that site (remembered per host). Right-click → **Reset this site’s settings** clears that site's saved zoom and dark-mode override. The old global force-dark toggle still works.

### Fixed
- **Favicons no longer leak your browsing to Google.** Tab icons previously came from Google's `s2/favicons` service, which told Google every domain you opened — at odds with Vex's tracker blocker. Vex now uses each site's own first-party favicon (with a clean placeholder fallback).
- **Client Hints now match the spoofed Chrome user-agent.** `Sec-CH-UA` request headers were still advertising Electron even with the Chrome UA set; they're now normalized to Chrome 124 on every tab session, so sites that sniff Client Hints (which most modern sites prefer over the UA string) see a consistent desktop Chrome.

## v2.25.3 (2026-06-15) — Fix site layouts broken by the consent blocker (e.g. Roblox footer mid-page)

### Fixed
- **Pages no longer render with misplaced content (Roblox showed its "About Us" footer in the middle of the game store page).** Vex's cookie/consent-banner blocker was injecting `html,body{position:static!important;overflow:auto!important}` into **every** page unconditionally. That override stripped the positioning context sites use to anchor elements to `<body>`, so Roblox's global footer dropped into the middle of the page. The scroll/position un-lock (which exists to undo a banner's scroll-lock) is now applied **only when an actual consent element is present** — re-checked briefly for banners that mount after load — so banner-free sites are left untouched. Cookie banners are still blocked as before.
- **Regular tabs now report the Chrome user-agent.** The Chrome UA spoof ("avoid unsupported-browser blocks") covered the default session and panel partitions but skipped `persist:main`, the partition every tab uses, so sites saw the raw Electron UA. `persist:main` now gets the Chrome UA too.

## v2.25.2 (2026-06-13) — Firebase sign-in popup no longer opens blank in Peek

### Fixed
- **"Sign in with Google" popups that loaded blank now complete.** The Firebase auth-handler popup (e.g. `elevenlabs.io/__/auth/handler`) was being routed into the Peek overlay, which severed `window.opener` so the popup could never hand the login back — it just sat white. Vex now opens the auth handler as a real popup window (matched by the `/__/auth/handler` path, since it lives on the site's own domain), keeping the opener intact. Together with v2.25.1 this fixes federated sign-in on ElevenLabs and similar sites.

## v2.25.1 (2026-06-13) — "Sign in with Google" works again (Firebase redirect logins)

### Fixed
- **Federated sign-in (e.g. "Sign in with Google" on ElevenLabs and other Firebase sites) no longer fails** with *"Unable to process request due to missing initial state."* Chromium's third-party storage partitioning was isolating the auth-handler's storage so the redirect couldn't read its own login state. Vex now disables that partitioning, restoring redirect-based logins. (Vex's ad/tracker blocker still handles the cross-site tracking that partitioning was guarding against.)

## v2.25.0 (2026-06-13) — Customize every left-sidebar button

### Added
- **Every left-sidebar button can now be customized**, not just the web-app ones. **Right-click any button** → Rename, Change icon, Hide, Reset. Buttons that open a website (Claude/Spotify/WhatsApp, pinned sites) also get **Change link** + service switch.
- **Settings → Sidebar Buttons** — a master list to **rename, change icon, change link (web buttons), show/hide, and reorder** every button, and the place to **restore hidden buttons** (previously there was no way back once a button was hidden).

### Fixed
- The sidebar right-click menu no longer leaves an invisible overlay behind after you pick an item (same class of bug fixed for the tab/group menus).

## v2.24.1 (2026-06-13) — Clicked links open with Vex on cold start

### Fixed
- **Clicking a link when Vex isn't already running now opens the link**, not just the browser. On a cold launch the link arrived before the page had finished wiring up its handler, so it was dropped and Vex showed the start page. Vex now buffers the incoming link until the page is ready and then navigates to it. Verified in real Electron.

## v2.24.0 (2026-06-13) — Group colors actually change + match every theme

### Fixed
- **Changing a tab group's color now actually changes it.** Group pills on the top bar were all rendering the *same* color no matter what you picked. Root cause: the pill color was being computed on the page root (where the group's own color isn't known), so every group fell back to one fixed default. The color is now computed on each group's own pill, so picks are distinct and apply immediately. Verified in real Chromium across themes, not just unit tests.
- The group/tab/stack right-click menus no longer leave an invisible full-screen overlay behind that could swallow your next click.

### Changed
- **Group colors now match every theme — and re-match when you switch themes.** Colors are stored as theme references and the choices are drawn from the active theme's palette, so a group is Dracula's purple in Dracula and Ocean's cyan in Ocean — switching themes recolors your groups live. New groups default to the current theme's accent. This applies to **AI-created groups** too (auto-grouper and the AI tab command) — they map onto the theme palette and re-theme like manual groups.

## v2.23.0 (2026-06-13) — Wizard shows everything + all settings re-editable

### Changed
- **Reopening the setup wizard now shows every step**, pre-filled with what you've already saved and tagged **“✓ already set”** — nothing is hidden, so theme, GitHub, and Local AI (Ollama) always appear. Each AI backend (Cloud / Ollama / On-device) is judged independently, so having cloud AI no longer hides the Ollama step.

### Added
- **Weather location is now editable in Settings → Personalization**, with the same district pick-list as the wizard (search → pick “Ataşehir · İstanbul · Türkiye”). Shows your current location too.
- **“Choose a theme…” button in Settings** opens the theme picker, so theme is reachable from Settings as well.
- Editing your **display name, GitHub username, search engine, or weather** in Settings now updates the start page **immediately** (previously some only applied after a restart).

## v2.22.0 (2026-06-13) — Fuller setup wizard + district-accurate location

### Added
- The setup wizard now covers **a lot more**: default **search engine**, **make Vex your default browser**, the three AI backends as **separate steps** (Cloud / Claude, local **Ollama** with a one-click detect, and **on-device** WebGPU), **Vex Sync**, and adding your first login to the **password manager** — on top of theme, name, weather, and GitHub.
- **District-level location.** Weather location now searches up to 5 matches and lets you pick the exact one shown as *“Ataşehir · İstanbul · Türkiye”* — so districts resolve correctly instead of snapping to a stray top hit. Applies to both the setup wizard and the start-page location button.

### Changed
- Resume logic understands the new steps: configuring **any one** AI backend clears all three AI steps (you’re never nagged to set up Ollama after you’ve set up cloud AI), and each other step disappears once its value is saved.

## v2.21.0 (2026-06-12) — Update prompt + resumable setup wizard

### Added
- **Update available popup.** A few seconds after launch (and from Settings → Check for Updates), if a newer version exists Vex shows a prompt with a **Download** button that grabs the new installer directly. Uses the lightweight HTTPS version check, so it can't crash the app like the old auto-updater path.
- **Setup-wizard button** in the top bar, just right of the reload button — re-open the onboarding wizard anytime if you skipped it during first run.

### Changed
- The onboarding wizard now **resumes instead of restarting.** Re-opening it shows only the steps you haven't completed yet (theme, name, weather, GitHub, AI) and skips the ones already set — so pausing part-way doesn't make you redo everything. If nothing's left, it just says you're all set.

## v2.20.3 (2026-06-12) — Theme previews actually render now

### Fixed
- The theme preview thumbnails were **collapsing to zero size**, so every card showed only a flat colored label bar instead of the preview. Two layout bugs caused it: the thumb used `aspect-ratio` for its height (which computes nothing when its only child is absolutely positioned), and the card is a `<button>`, whose UA default `align-items: flex-start` stopped the thumb from stretching to full width. The thumb now has an explicit width and height, so the detailed mini-window preview renders for every theme. Verified by capturing the real picker CSS, not a simplified mock.

## v2.20.2 (2026-06-12) — Bulletproof theme previews

### Fixed
- Theme previews were rendering as **flat color blocks** in the installed app (the container-query CSS they relied on didn't apply in that context). Each preview is now drawn with **inline styles only** — no external CSS classes, no CSS variables, no container queries — using each theme's real colors read directly from its stylesheet. Every theme (originals and new alike) now shows the identical detailed Vex window, and the previews can't be defeated by stale, cached, or overridden styles.

## v2.20.1 (2026-06-12) — Detailed live previews

### Changed
- The live theme previews are now the **detailed** Vex window (top bar, sidebar, tab, and the full Vex Sync settings content) — the same rich look the new themes had — rendered live from CSS in each theme's colors. Every theme's preview is identical in style and never an image file.

## v2.20.0 (2026-06-12) — Live theme previews + sidebar fixes

### Changed
- **Theme previews now render live from CSS** in each theme's own colors — no image files at all. Every theme (originals included) is the exact same format, and previews can never be stale, cached, or mismatched between builds again.

### Fixed
- The **close-sidebar button** (next to the Vex Sync icon) now collapses the **entire** left sidebar — icon rail included; click again to reopen. Removed the duplicate toggle that was next to the AI button.

## v2.19.1 (2026-06-12) — Sidebar toggle by the sync icon

### Added
- A **close/open left sidebar** button in the top bar, right next to the Vex Sync icon (also still on Ctrl+B and in the tabs header).

## v2.19.0 (2026-06-12) — Force-refresh theme previews

### Fixed
- **Theme previews now always reload after an update** — preview images are cache-busted by app version, so the regenerated (uniform) previews show instead of stale cached screenshots. All 35 themes share one identical preview style.

## v2.18.0 (2026-06-12) — Favorite themes + 6 more themes

### Added
- **Favorite themes** — hover any theme card in the picker (Ctrl+Shift+Y or the start-page Theme button) and click the **star** to favorite it. Starred themes appear in a **★ Favorites** section at the top of the picker.
- **6 more themes** — Ruby, Lime, Bronze, Plum, Arctic, and Wine (35 total).
- All previews remain one consistent generated style.

## v2.17.0 (2026-06-12) — 8 more themes + uniform previews

### Added
- **8 new themes** — Slate, Emerald, Amethyst, Volcano, Sapphire, Honey, Mint, and Obsidian (29 total).

### Changed
- **All theme previews now use one consistent style** — every theme card is the same full-app render in its own colors, so the whole picker is uniform.

## v2.16.5 (2026-06-12) — Revert to the original previews

### Fixed
- Restored the **original theme preview screenshots** (the real ones that were always there). v2.16.4 had overwritten them with a generated render — reverted to the v2.16.3 state (original screenshots for the first themes; matching previews for the newer ones).

## v2.16.3 (2026-06-12) — Restore original previews, match the new ones to them

### Fixed
- **Restored the original theme preview screenshots** (Oxford, Ocean, Midnight, etc.) that v2.16.2 had overwritten, and regenerated the new themes' previews in the **same full-app style** (top bar, sidebar, tabs, Settings content) at the same 1400×600 — so every theme's preview now looks consistent with the originals.

## v2.16.2 (2026-06-12) — Real preview screenshots for every theme

### Changed
- **Every theme now has a real screenshot preview** in the picker (not a flat swatch or mini-mockup) — all 21 themes are rendered consistently as an actual Vex window in their own colors. Regenerate anytime with `npm run capture-themes`.

## v2.16.1 (2026-06-12) — Widevine/DRM status

### Added
- **DRM (Widevine) status in Settings → About** — shows whether protected playback (Spotify, Netflix) is actually enabled, so you can tell at a glance if DRM is ready, loading, or only works in the installed build.

### Note
- Protected (DRM) playback requires the **installed, VMP-signed build** — it won't work when running Vex from source (`npm start`). If Spotify says "Playback of protected content is not enabled", check the new DRM line in Settings → About.

## v2.16.0 (2026-06-12) — Theme previews + 6 more themes

### Added
- **6 more themes** — Aurora, Crimson, Gold, Sakura, Cyberpunk, and Monochrome (21 themes total).
- **Live preview cards** — themes without a screenshot now render a real mini-UI mockup (sidebar, tabs, toolbar, text, accent button) drawn from their own palette, so every theme in the picker looks like a proper preview instead of a flat swatch.

## v2.15.1 (2026-06-12) — Fix "Check for Updates"

### Fixed
- **"Check for Updates" no longer closes the app.** It was invoking electron-updater's native checker, which on this build can spawn native helpers that crash the process. The manual check is now a lightweight HTTPS version lookup (fetches the latest release's version and compares) — it can't take the app down, tells you if you're up to date, and links straight to the download when a newer version exists.

## v2.15.0 (2026-06-12) — Search engines, more themes, custom wallpaper & more

### Added
- **Search engine picker** on the start page — click the engine button in the search bar to choose **Google, Bing, DuckDuckGo, Brave, Startpage, Ecosia, or YouTube**. The bar shows which one is active ("Search with DuckDuckGo…") and Enter sends your query there. Your choice is remembered.
- **Sidebar collapse button** — a chevron in the tabs header collapses/expands the left sidebar (still on Ctrl+B; the top-bar button reopens it too).
- **6 new themes** — Sunset, Rosé, Matrix, Mocha, Solarized, and Vaporwave, on top of the existing 8.
- **Custom Image theme** — in the theme picker, choose **Custom Image** and upload any picture; it becomes your start-page wallpaper (auto-downscaled, with a readability scrim) paired with a clean graphite-dark UI.
- **Download an on-device model during setup** — the first-run wizard's AI step now lets you pick and download a WebGPU model right there (where supported).

### Changed
- **Weather shows °C** instead of °F.

## v2.14.0 (2026-06-12) — First-run setup wizard

### Added
- **First-run setup wizard** — on a fresh install, Vex now walks you step-by-step through setting up each tool: pick a **theme**, your **name**, **weather** location, **GitHub** username, and **AI backend** (cloud worker URL / detect Ollama / on-device later). Every step has a **Skip**, and there's a **Skip setup** to bail entirely. Re-run anytime via Ctrl+K → "Run Setup Wizard". Existing installs never see it.

### Changed
- **Weather now shows °C** instead of °F on the start page.

## v2.13.0 (2026-06-12) — Theme button on the start page

### Added
- A **Theme** button in the top-right of the start page — click it and the full theme picker (all 8 themes with previews) appears. Picking one re-themes the whole browser instantly.

## v2.12.0 (2026-06-12) — Daily verse, weather location & Spotify playback

### Added
- **Daily Qur'an verse (Turkish)** on the start page, under the greeting — a different ayah each day (Diyanet translation), cached so it's stable through the day and silently hidden if offline.
- **Set location for weather** — a "📍 Set location" button next to the Weather widget. Type your city (geocoded via Open-Meteo) and the weather switches to it; the button disappears once a location is saved. Stored locally only.

### Fixed
- **Built-in Spotify can play now.** Two causes: the Widevine DRM component wasn't being initialized (castLabs Electron needs `components.whenReady()` before any EME playback), and the `mediaKeySystem` permission was being prompted (and silently failing in the panel) instead of auto-allowed like a normal browser. Both fixed — Play and other playback controls work in the Spotify panel.

## v2.11.5 (2026-06-12) — Spinner fix

### Fixed
- **Loading spinners no longer jump up-and-left each cycle.** The shared `spin` keyframe baked in a `translate(-50%,-50%)` that only the centered webview loader needed, so every other spinner (AI panel "Thinking", history, sync, generic) skipped on loop. The generic spinner now rotates cleanly in place; the centered loader keeps its own keyframe.

## v2.11.4 (2026-06-12) — AI Backend refresh button

### Added
- A **Refresh** button right next to the "Local (Ollama)" status in Settings → AI Backend, so you can re-check Ollama on the spot (it re-pings and reloads the model list). The existing "Refresh Ollama Status" button still works too.

## v2.11.3 (2026-06-12) — Settings scroll fix

### Fixed
- **Settings scrolls again** while the category bar stays pinned. v2.11.2 pinned the header but accidentally killed scrolling (the panel toggles `display:block`, which overrode the flex layout). The header is now an absolutely-pinned overlay and the list keeps its normal scroll — best of both.

## v2.11.2 (2026-06-12) — Settings header fix

### Fixed
- **Settings category bar genuinely stays pinned now** — `position: sticky` wasn't holding in this layout, so the search + category chips are now a fixed header above the scroll area instead. Scroll the settings and the chips stay put.

## v2.11.1 (2026-06-12) — Fixes

### Fixed
- **On-device AI chat hung on "Thinking…"** — the local path was forcing JSON-grammar generation, which stalls small WebGPU models. On-device chat now uses a plain-text prompt (so it actually responds), is scoped to chat only, and has a 120s timeout that falls back to cloud/Ollama if anything stalls — so the spinner can never loop forever.
- **Settings category bar now stays pinned** while you scroll (the sticky styling moved onto a solid toolbar wrapper).

### Added
- **Search bar in Settings** — filter all settings by keyword; the category chips hide while searching.

## v2.11.0 (2026-06-12) — Screenshot-to-code + MCP tools in the agent

### Added
- **Screenshot → Code** (Ctrl+K → "Screenshot → Code") — capture the current page and have AI rebuild it as a single self-contained file. Choose **Plain HTML+CSS**, **HTML+Tailwind**, or **React (CDN)**, then preview the result in a new tab or copy the code. The screenshot is downscaled client-side before upload to keep it fast and cheap. *(Requires the AI worker redeployed with the new `screenshot-to-code` vision action — the app shows a clear message if your worker is older.)*
- **MCP tools in the agent** — tools from your connected MCP servers are now offered to the autonomous agent alongside its built-in actions (namespaced `mcp__…` so they never collide). Ask the agent to do something a connected MCP server can handle and it can call that tool directly, feeding the result back into its reasoning. The standalone MCP explorer from v2.10.0 still works for manual calls.

## v2.10.0 (2026-06-12) — MCP client

### Added
- **MCP Servers** (Settings → MCP Servers, or Ctrl+K → "MCP Servers & Tools") — connect Vex to **Model Context Protocol** servers over HTTP. Add a server (URL + optional bearer token), Vex performs the MCP handshake and lists the server's tools, and a built-in **explorer** lets you pick a tool, fill in JSON arguments (pre-skeletoned from the tool's input schema), and run it — seeing the result inline. JSON-RPC traffic is proxied through Vex so there are no CORS limits, and both plain-JSON and SSE responses are handled.
- Scope note: this is a standalone MCP client/explorer; wiring MCP tools into the autonomous agent is a planned follow-up, kept separate so the stable agent is untouched.

## v2.9.0 (2026-06-12) — On-device AI (WebGPU)

### Added
- **On-Device AI** (Settings → On-Device AI, or Ctrl+K → "On-Device AI") — run a small LLM **entirely on your machine** via WebGPU: private, offline, no server. Pick a model (Llama 3.2 1B/3B, Qwen 2.5 1.5B, Phi 3.5 mini), press **Download & load** (weights download once and cache), and flip on "Use on-device AI for chat & summaries". Chat / summarize / explain / translate then run locally; agent & multi-tab still use cloud.
- Fully opt-in and safe: nothing downloads until you ask, WebGPU is feature-detected (the option explains itself if your device lacks it), and the router **falls back to cloud/Ollama automatically** if on-device isn't ready or errors. Your model choice is remembered.

## v2.8.0 (2026-06-12) — Cross-site tracker insights

### Added
- **"Following you across sites"** in the Privacy Report (Ctrl+K → "Privacy Report") — Vex now records *which of your sites* each blocked tracker appeared on, and surfaces the ones seen on multiple sites: the companies actually following you around the web, ranked by reach, with the site list. Turns the raw block count into a real privacy picture (Ghostery/Disconnect-style).

## v2.7.0 (2026-06-12) — Persistent AI memory

### Added
- **AI Memory** (Settings → AI Memory) — tell Vex facts and preferences to keep in mind in *every* chat: your name, role, tone ("answer concisely"), languages, tech stack, location… They're injected as context on each AI request, so the assistant stops forgetting who you are between sessions.
- **Remember a fact** (Ctrl+K → "AI: Remember a Fact") — jot a memory from anywhere without opening settings.
- Works on **both** the local (Ollama) and cloud backends — no worker change needed — and is purely additive (never overrides your persona or the default prompt). Memory is per-device but **syncs across your devices** when Vex Sync is on. Toggle it off anytime; nothing is sent until you add a fact.

## v2.6.0 (2026-06-12) — Developer & power tools

### Added
- **API client** (Ctrl+K → "API Client") — a built-in REST client: pick a method, set headers and a body, hit Send, and browse the response as a collapsible, syntax-coloured JSON tree (or raw text). CORS-free (runs in main, like curl); shows status, time, and size.
- **Format JSON** (Ctrl+K → "Format JSON") — turn the current raw-JSON tab into the same collapsible tree.
- **Responsive Preview** (Ctrl+K → "Responsive Preview") — see the current page side-by-side at iPhone SE / iPhone 14 / iPad / laptop / desktop widths in one overlay, with reload-all. Polypane-lite for checking responsive layouts.
- **Watch This Page** (Ctrl+K) — Vex periodically refetches a page, strips it to text, and **alerts you when it changes** (restocks, docs, status pages, listings). Manage everything in **Watched Pages**; optional OS notifications. Each watch runs on its own interval.
- **Wayback archiving** — "Save to Wayback Machine" preserves the current page on web.archive.org; "View Archived Version" (also on right-click → links) opens the latest snapshot to recover dead/changed links.

## v2.5.0 (2026-06-12) — Privacy hardening pack

### Added
- **Fingerprint protection** (Settings → Privacy Hardening, default off) — Brave-style "farbling" injects tiny, per-session, imperceptible noise into the canvas / WebGL / audio readouts that tracking scripts hash to fingerprint you, and normalizes `hardwareConcurrency` / `deviceMemory` / GPU strings. The noise is consistent within a session (sites still work) but changes every launch, so you can't be silently linked across sites or over time. Applies to pages opened after toggling.
- **DNS-over-HTTPS** (Settings → Privacy Hardening, default off) — encrypt your DNS lookups via Cloudflare, Google, or Quad9. *Opportunistic* (safe, falls back to system DNS) or *Strict* (DoH only). Applies browser-wide immediately via Chromium's secure resolver.
- **Privacy Report** (Ctrl+K → "Privacy Report", or the button in Settings) — a live shield showing how many trackers/ads were blocked this session, the top blocked domains, and your fingerprint + DNS protection status. Reset counters anytime.
- The existing ad/tracker blocker now **tallies** what it stops so the report has real numbers.

## v2.4.0 (2026-06-12) — Reading pack: highlights, recall & accessibility

### Added
- **Persistent highlights** — select text on any page and highlight it (Ctrl+K → "Highlight", or right-click → Highlight; yellow/green/pink). Highlights are stored locally per-URL and **reappear every time you revisit the page**. Add a note to any highlight. New **Highlights** sidebar panel lists every highlight across all pages, grouped by page, with a count badge.
- **Recall ("memex")** — full-text search of everything you've read. As you browse, the readable text of each page is indexed locally (capped, stored in `userData/recall.json`, never uploaded). The new **Recall** sidebar panel finds any page by its *content* — "that paragraph about DPI throttling" — not just its title. Off-the-record/container/file pages are never indexed. Toggle + clear in Settings → Recall.
- **Reading & Accessibility pack** (Settings → Reading & Accessibility), applied to every page:
  - **Dyslexia-friendly fonts** — Lexend, Atkinson Hyperlegible, OpenDyslexic.
  - **Color-vision filters** — protanopia / deuteranopia / tritanopia simulation + grayscale (feColorMatrix).
  - **Reading ruler** — a translucent bar that follows your cursor to keep your place.
  - **Bionic Reading** (Ctrl+K) — bolds the start of each word to speed reading; run again to undo.
  - **Speed Read / RSVP** (Ctrl+K) — flashes the article one word at a time at an adjustable 150–900 WPM.
  - **Translate Selection** (Ctrl+K) — translate highlighted text into your language inline.

## v2.3.2 (2026-06-12) — Adaptive memory guard

### Added
- **Memory guard** (Settings → Performance) — when total browser memory crosses a ceiling (default 1.2 GB), Vex sleeps the least-recently-used background tabs (never the active or pinned ones) until back under. Light sessions are untouched; heavy ones stay capped, keeping Vex near its floor without disrupting normal use. Off / 0.9 / 1.2 / 1.6 / 2.4 GB.

## v2.3.1 (2026-06-12) — Lazy session restore (big memory win)

### Changed
- **Lazy session restore** — on launch, only the focused tab loads a webview; the rest of your saved session restores as lightweight placeholders (title + favicon) and materializes the instant you click them. On a real session this cut startup memory by ~60% (≈950 MB → ≈390 MB private). Sleeping tabs and tab groups are unaffected; auto-sleep skips not-yet-loaded tabs.

## v2.3.0 (2026-06-12) — Library, AI tab commands & the works

### Added
- **Read Later / Library** — save pages to a queue (Ctrl+K → "Read Later"), unread badge on the new Library sidebar panel; opening marks read.
- **Auto-archive** — tabs untouched for N days (Settings → Library) close into the Library archive instead of rotting open.
- **Clip to Notes** — selected text (or the page link) saved into a pinned "Clippings" note with source + date.
- **AI Tab Commands** — "close all YouTube tabs", "group my shopping tabs": AI plans, you confirm, it applies.
- **Now Playing** — a mini bar for tabs making sound: play/pause, mute, jump-to-tab.
- **Pin Site to Sidebar** — keep any site as a Vivaldi-style web panel (right-click its icon to unpin).
- **Off-the-Record tab** — ephemeral tab: no history, cookies vanish on close.
- **Boss key** — Ctrl+Alt+H hides + mutes every Vex window instantly; again to restore.
- **Reverse-image search** — right-click any image → Search with Google Lens / copy / open.
- **QR code** — Ctrl+K → "QR Code" to open the current page on your phone.
- **Per-tab volume** — tab right-click → "Page volume…".
- **Resource Monitor** — live CPU/memory per browser process.
- **Quick slots** — Ctrl+Alt+1/2/3 run your first three command chains.
- **Ambient grouping** — links opened from a grouped tab join that group automatically.

## v2.2.0 (2026-06-12) — Focus, gestures, bookmarks, feeds & more

### Added
- **Focus Mode** — Ctrl+K → "Focus 25/50": hides all chrome and blocks distracting sites (editable blocklist in Settings → Focus) for the session.
- **Compact Mode** — collapse both sidebars for maximum page space (persists).
- **Mouse gestures** — hold right button and drag: ← back, → forward, ↑ top, ↓ reload, ↓→ close tab, ↓← reopen.
- **Bookmarks** — ☆ in the URL bar + a Bookmarks sidebar panel with folders and search.
- **Feeds (RSS)** — a minimal, algorithm-free feed reader panel.
- **Read Aloud** — text-to-speech for the current article.
- **AI Compose** — AI writes/rewrites text straight into the focused input on the page.
- **Command Chains** — run several command-bar actions as one command (Settings → Command Chains).
- **Container tabs** — Work/Personal/Shopping tabs with isolated cookies (log into two accounts at once).
- **Cookie-banner auto-hide** — major consent walls are hidden and scroll unlocked (toggle in Settings).
- **Screenshot annotation** — pen/box/arrow editor on captured screenshots.
- Sync worker: no-email dev fallback for sign-in (returns the code when RESEND_API_KEY is absent).

## v2.1.0 (2026-06-12) — Peek, Skills, Boosts, Handoff & Passwords

### Added
- **Peek** — Shift+click any link to preview it in a floating overlay; Esc dismisses, Ctrl+Enter (or one click) promotes it to a real tab.
- **AI Skills** — saved, reusable AI commands ("Summarize in 5 bullets", "Explain like I'm 5", …) that run on the current page from the command bar; create your own in Settings → AI Skills.
- **Boosts** — per-site customization: **Zap Element** (Ctrl+K) hides any element forever on that site; **Boost This Site** opens a custom CSS/JS editor. Managed in Settings → Boosts.
- **Send to Phone / Handoff** — push the current tab to your other Vex devices via the sync worker (Ctrl+K → "Send to Phone"); tabs sent from Vex Mobile open here automatically. Requires Vex Sync sign-in.
- **Password manager** — Vex offers to save logins as you sign in, autofills them on return visits, and lists them in Settings → Passwords. Encrypted at rest with the OS keychain (safeStorage/DPAPI); never-save list per site.

## v2.0.5 (2026-06-12) — Settings glow-up & customizable sidebar

### Added
- **Customizable sidebar buttons** — right-click a service icon (Claude / WhatsApp / Spotify) to **Rename**, **Change icon** (15-icon picker), **Change link**, **Delete (hide)**, or **Reset**. Claude can one-click **Switch to Claude / Gemini / ChatGPT**. Customizations persist across launches.

### Changed
- **Settings redesign** — the flat list is now vivid, color-coded **category cards** with icons, a sticky category nav to jump between sections, and livelier toggles/inputs/buttons. All existing settings and handlers are unchanged.

## v2.0.4 (2026-06-12) — Guided tour

### Added
- **Interactive tour** — a spotlight walkthrough that highlights every control (address bar, vertical tabs, workspaces, command bar, AI agent, split screen…) with tooltips and Back / Next / Skip. Offered automatically on first run; replay anytime via `Ctrl+K` → "Tour".

## v1.2.0 (2026-04-16) — Polish & Cleanup

### Changed
- Removed duplicate AI button from sidebar — top-bar button is now the single entry point
- Settings About: prominent version display with Electron/Chromium versions
- Unified toast notifications (slide-in from right, color-coded borders)
- Workspace accent color stripe at top of window

### Added
- Copy URL button in URL bar
- Middle-click to close tabs
- Double-click URL bar to select all
- Electron + Chromium version info in Settings About
- "Report Issue" link in Settings
- Update check timestamp persistence

### Fixed
- AI panel no longer registered in sidebar panel system
- Consistent spinner and empty state CSS classes available globally

## v1.1.0 (2026-04-16) — Multi-Tab AI
- Tab selector: Current/All/Group/Custom tab selection modes
- Cross-tab AI reasoning with comparison tables
- Multi-tab context extraction (parallel, 60K char budget)
- "Compare tabs" and "Summarize tabs" quick actions + commands

## v1.0.0 (2026-04-16)

### Features
- Vertical tabs with drag reorder and tab groups
- Sidebar panels: WhatsApp, Claude AI, CUSA, Roblox, GitHub
- Custom start page with editable shortcuts, weather, GitHub stats
- Command bar (Ctrl+K) with URL, search, and AI mode
- Ad/tracker blocker with 40+ domains
- Tab sessions, workspaces (Personal/CUSA/School/Dev)
- Notes panel with markdown preview
- Downloads manager with progress tracking
- Full browsing history with search and date filters
- Memory panel with per-tab usage and sleep mode
- Auto-sleep inactive tabs
- Tab restore on relaunch, recently closed tabs (Ctrl+Shift+T)
- Theme editor with 7 presets + custom colors
- Reading mode, translate, screenshots
- Zoom per-domain persistence
- Tab preview on hover
- F11 fullscreen with auto-hiding sidebars
- Per-video PiP button overlay
- Tab audio indicator + mute (Ctrl+M)
- Incognito/private windows
- Tab pinning (icon-only mode)
- AI assistant panel with page context awareness
- AI agent with 19 tools (navigate, click, type, extract, etc.)
- 3 permission modes: Ask, Plan, Auto
- Scheduled AI tasks with templates
- Auto-updater with GitHub Releases
- Windows installer (NSIS) with Start Menu + Desktop shortcuts
