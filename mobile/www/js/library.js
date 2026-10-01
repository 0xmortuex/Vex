// === Vex Mobile — the library ===
//
// The desktop keeps every feature on a named shelf, searchable, with "Ask Vex
// what you don't know" at the top: say what you are trying to do and it names
// the feature. A phone browser with this much in it needs the same thing, or
// half of it is undiscoverable.
//
// Every entry says what it is for, where it lives, and can open it.

const VexLibrary = (() => {
  const SHELVES = [
    ['Browsing', [
      ['tabs', 'Tab switcher', 'Every open tab as a card, with search and groups. Swipe up on the address bar to get here.', () => VexUI.openTabGrid()],
      ['sleep', 'Sleeping tabs', 'A tab you have left stops running after a while — its timers, its animations — and wakes the instant you tap it.', () => VexPanels.tabsSettings()],
      ['groups', 'Tab groups', 'Name a set of tabs, give it a colour, close the lot at once. Long-press a card in the switcher.', () => VexUI.openTabGrid()],
      ['private', 'Private tabs', 'No history, no cookies kept. Can be locked behind your fingerprint.', () => VexUI.newTab({ incognito: true })],
      ['sessions', 'Sessions', 'Save the tabs you have open, by name. They open on the desktop too.', () => VexPanels.sessions()],
      ['find', 'Find in page', 'Search the page you are on.', () => VexUI.openFind()],
      ['shortcuts', 'Keywords and !bangs', 'Type "yt sea shanties", "w halyard" or "gh vex" in the address bar to search that site, or a DuckDuckGo !bang anywhere in what you type. The same list as the desktop.', () => VexUI.openOmnibox('yt ')],
      ['copy-unlock', 'Let me copy text', 'For a site that stops you selecting its text or empties what you copy — this page from the menu, or the whole site from its sheet. The desktop’s Copy Unlock.', () => VexUI.toast('Menu → Let me copy text here')],
      ['switch-tab', 'Switch to an open tab', 'Type part of a tab’s name in the address bar and it is offered first, instead of opening the page again.', () => VexUI.openOmnibox('')],
      ['pdf-find', 'Find in a PDF', 'The magnifier in the PDF reader searches every page, marks each match and jumps between them. Pinch to zoom, too.', () => VexUI.toast('Open a PDF, then tap the magnifier')],
      ['tab-history', 'Long-press Back', 'Every page this tab has been to, nearest first — jump five pages back in one tap. Long-press Forward for the other way.', () => VexUI.tabHistory(-1)],
      ['swipe-close', 'Swipe to close', 'Throw a tab card, or a row in any list, sideways to close or remove it — Undo follows.', () => VexUI.openTabGrid()],
      ['video-download', 'Download the video', 'A video file, or the stream a site plays — saved whole, with progress in the notification shade. Menu → Download the video.', () => VexPanels.downloads()],
      ['toolbar', 'Toolbar', 'Top or bottom, hiding as you scroll, with the buttons you choose.', () => VexPanels.appearance()]
    ]],
    ['Reading', [
      ['translate-device', 'Translate a page on the phone', 'ML Kit\u2019s models run here. Once a language is downloaded a page translates with no connection at all, and nothing is sent anywhere — which is more than Chrome or Samsung Internet does.', () => VexPanels.translation()],
      ['reader', 'Reader', 'The article, without the rest of the page, in the browser’s own type.', () => VexViews.openReader()],
      ['read-aloud', 'Read aloud', 'The article, in the phone’s own voice, a paragraph at a time — skip, slow down, carry on. It keeps reading with the screen off; pause or stop it from the notification or your headphones.', () => VexUI.readAloud()],
      ['reading-list', 'Reading list', 'Pages kept for later, marked off as you read them.', () => VexPanels.readingList()],
      ['pdf', 'PDFs', 'Read in Vex rather than downloaded — Android’s WebView cannot draw one, so Vex does.', () => VexUI.toast('Open any PDF link')],
      ['saved', 'Saved pages', 'The whole page kept on the phone, for reading offline — it opens with no connection at all, and its scripts are taken out when it is saved.', () => VexPanels.savedPages()],
      ['notes', 'Notes', 'A line about a page, or a passage kept from one. Select text and choose "Keep as a note" — it is highlighted on the page whenever you come back — and export the lot as Markdown.', () => VexPanels.notes()],
      ['contrast', 'Contrast and night shade', 'For pages that are grey on grey, or too bright to read in bed.', () => VexPanels.appearance()],
      ['zoom', 'Text size and pinch zoom', 'Per site, and forced on sites that forbid it.', () => VexPanels.appearance()],
      ['ui-size', 'Interface size', 'Vex’s own buttons and labels, bigger. Android’s font-size setting only reaches the page.', () => VexPanels.appearance()]
    ]],
    ['Finding things again', [
      ['history', 'History', 'Everything you opened, searchable, by day.', () => VexPanels.history()],
      ['recall', 'Recall', 'Search the text of the pages you read, not just their titles. The index never leaves the phone.', () => VexPanels.recall()],
      ['bookmarks', 'Bookmarks', 'In folders, importable and exportable as the standard bookmarks file.', () => VexPanels.bookmarks()],
      ['start', 'Start page tiles', 'Most-visited until you pin one; then the grid is yours.', () => VexPanels.quickAccess()]
    ]],
    ['The assistant', [
      ['ask', 'Ask about this page', 'A question about what is on screen, answered by your own worker.', () => VexViews.openAI()],
      ['agent', 'Let it do things', '"Close all the YouTube tabs." It works in steps, and shows you each one.', () => VexViews.openAI('agent')],
      ['summarise', 'Summarise', 'The page, shorter.', () => VexViews.summarisePage()],
      ['translate', 'Translate', 'The page in another language, through your worker — when the phone cannot do it itself.', () => VexUI.translatePage()],
      ['memory', 'What it remembers', 'Facts you have told it to keep.', () => VexPanels.assistantSettings()],
      ['backup', 'Backup', 'Everything in one encrypted file, for moving to another phone. Not your saved logins — those cannot leave the Keystore.', () => VexPanels.backup()],
      ['diagnostics', 'Diagnostics', 'What this phone is, what its WebView can do, and the last problems — copyable for a bug report.', () => VexPanels.diagnostics()],
      ['on-device', 'On-device AI', 'A model that runs inside Vex with no network at all, and Gemini Nano where the phone has it.', () => VexPanels.localAI()],
      ['nano', 'Summarise with Gemini Nano', 'Instant, on the phone, nothing stored by Vex — the weights belong to Android.', () => VexPanels.localAI()]
    ]],
    ['Privacy', [
      ['blocking', 'Ad and tracker blocking', 'Network and cosmetic, with a list of what it cost each site.', () => VexPanels.privacy()],
      ['shield', 'Fingerprint shield', 'Runs before the page’s first script and nudges what it can read about the device.', () => VexPanels.privacy()],
      ['site-rules', 'Rules for one site', 'JavaScript, images, dark, desktop layout, text size, blocking — per site.', () => {
        const tab = VexTabStore.active();
        if (tab && tab.url) VexSheets.site(VexSearch.prettyHost(tab.url)); else VexPanels.privacy();
      }],
      ['permissions', 'Site permissions', 'Which sites may use the camera, the microphone, your location — asked once per site, and the page waits for your answer.', () => VexPanels.permissions()],
      ['clear', 'Clear browsing data', 'A list with tick boxes — cookies, cache, history, the Recall index, saved pages — and the same list every time you leave Vex, if you want it.', () => VexPanels.clearData()]
    ]],
    ['Your things', [
      ['passwords', 'Passwords and 2FA', 'Under a key that stays in the phone’s keystore. Filling is always a tap.', () => VexPanels.passwords()],
      ['details', 'Your details', 'What it types into a sign-up form when you ask.', () => VexPanels.details()],
      ['sync', 'Sync with the desktop', 'Bookmarks, reading list, sessions and rules, encrypted with a key only your devices have.', () => VexPanels.sync()],
      ['reminders', 'Reminders', 'Bring a page back this evening, tomorrow, at the weekend.', () => VexPanels.reminders()],
      ['downloads', 'Downloads', 'With live progress from the system queue, a Stop button while one is running, and a way into the phone’s own Downloads folder. A file the page made itself is saved too, which Android’s download manager cannot do.', () => VexPanels.downloads()]
    ]],
    ['The phone', [
      ['qr-scan', 'Scan a QR code', 'From the address bar. A 2FA code goes into the vault instead of opening.', () => VexUI.openScanner()],
      ['qr-share', 'Show a page as a QR code', 'Hand what you are reading to the machine next to you.', () => {
        const tab = VexTabStore.active();
        if (tab && tab.url) VexUI.showQr(tab.url, tab.title); else VexUI.toast('Open a page first');
      }],
      ['voice', 'Say it instead', 'Dictate into the address bar.', () => VexUI.openOmnibox('')],
      ['pip', 'Floating video', 'The video keeps playing in a small window while you do something else.', () => VexUI.toast('Play a video, then use the controls above the toolbar')],
      ['video-assistant', 'Speed, brightness and sound', 'Tap the label on the video bar. The brightness is a filter on the element, so it goes past what the site’s own player allows.', () => VexUI.toast('Play a video, then tap the label on the bar')],
      ['home-screen', 'Add to the home screen', 'A site, pinned to the launcher with its own icon.', () => VexUI.toast('Open a site, then Menu → Add to home screen')],
      ['default', 'Make Vex the default browser', 'So links from other apps open here.', () => VexBridge.openDefaultBrowserSettings()],
      ['widget', 'The home-screen search bar', 'Search, speak or scan without opening Vex first. Add it the way you add any widget.', () => VexUI.toast('Long-press your home screen → Widgets → Vex')],
      ['shortcuts', 'Long-press the icon', 'A new tab, a private tab, the microphone and the camera, straight from the launcher.', () => VexUI.toast('Long-press Vex on your home screen')]
    ]]
  ];

  function flat() {
    const out = [];
    for (const [shelf, entries] of SHELVES) {
      for (const [id, name, description, run] of entries) out.push({ id, shelf, name, description, run });
    }
    return out;
  }

  return {
    SHELVES,
    flat,

    count() { return flat().length; },

    search(query) {
      const needle = String(query || '').trim().toLowerCase();
      if (!needle) return flat();
      return flat().filter(entry =>
        (entry.name + ' ' + entry.description + ' ' + entry.shelf).toLowerCase().includes(needle));
    },

    // "I want to read this later without a signal" → the features for it.
    // Asked of your own assistant, with the catalogue as the context, so the
    // answer is about what this browser actually has.
    async ask(question) {
      const catalogue = flat().map(entry => '- ' + entry.name + ': ' + entry.description).join('\n');
      return VexAI.ask(question, {
        context: {
          url: 'vex://library',
          title: 'What Vex for Android can do',
          text: 'These are the features of the browser the person is using. Answer only with the ones that '
            + 'fit what they are trying to do, name them exactly as written, and say where each one lives.\n\n'
            + catalogue
        }
      });
    }
  };
})();

if (typeof window !== 'undefined') window.VexLibrary = VexLibrary;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLibrary };
