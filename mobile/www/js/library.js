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
      ['groups', 'Tab groups', 'Name a set of tabs. Long-press a card in the switcher.', () => VexUI.openTabGrid()],
      ['private', 'Private tabs', 'No history, no cookies kept. Can be locked behind your fingerprint.', () => VexUI.newTab({ incognito: true })],
      ['sessions', 'Sessions', 'Save the tabs you have open, by name. They open on the desktop too.', () => VexPanels.sessions()],
      ['find', 'Find in page', 'Search the page you are on.', () => VexUI.openFind()],
      ['toolbar', 'Toolbar', 'Top or bottom, hiding as you scroll, with the buttons you choose.', () => VexPanels.appearance()]
    ]],
    ['Reading', [
      ['reader', 'Reader', 'The article, without the rest of the page, in the browser’s own type.', () => VexViews.openReader()],
      ['reading-list', 'Reading list', 'Pages kept for later, marked off as you read them.', () => VexPanels.readingList()],
      ['pdf', 'PDFs', 'Read in Vex rather than downloaded — Android’s WebView cannot draw one, so Vex does.', () => VexUI.toast('Open any PDF link')],
      ['saved', 'Saved pages', 'The whole page kept on the phone, for reading offline — it opens with no connection at all.', () => VexPanels.savedPages()],
      ['notes', 'Notes', 'A line about a page, or a passage kept from one. Select text and choose "Keep as a note".', () => VexPanels.notes()],
      ['contrast', 'Contrast and night shade', 'For pages that are grey on grey, or too bright to read in bed.', () => VexPanels.appearance()],
      ['zoom', 'Text size and pinch zoom', 'Per site, and forced on sites that forbid it.', () => VexPanels.appearance()]
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
      ['translate', 'Translate', 'The page in another language, through your worker.', () => VexUI.translatePage()],
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
      ['permissions', 'Site permissions', 'Which sites may use the camera, the microphone, your location.', () => VexPanels.permissions()],
      ['clear', 'Clear data', 'Everything, or one site.', () => VexPanels.storage()]
    ]],
    ['Your things', [
      ['passwords', 'Passwords and 2FA', 'Under a key that stays in the phone’s keystore. Filling is always a tap.', () => VexPanels.passwords()],
      ['details', 'Your details', 'What it types into a sign-up form when you ask.', () => VexPanels.details()],
      ['sync', 'Sync with the desktop', 'Bookmarks, reading list, sessions and rules, encrypted with a key only your devices have.', () => VexPanels.sync()],
      ['reminders', 'Reminders', 'Bring a page back this evening, tomorrow, at the weekend.', () => VexPanels.reminders()],
      ['downloads', 'Downloads', 'With live progress from the system queue.', () => VexPanels.downloads()]
    ]],
    ['The phone', [
      ['qr-scan', 'Scan a QR code', 'From the address bar. A 2FA code goes into the vault instead of opening.', () => VexUI.openScanner()],
      ['qr-share', 'Show a page as a QR code', 'Hand what you are reading to the machine next to you.', () => {
        const tab = VexTabStore.active();
        if (tab && tab.url) VexUI.showQr(tab.url, tab.title); else VexUI.toast('Open a page first');
      }],
      ['voice', 'Say it instead', 'Dictate into the address bar.', () => VexUI.openOmnibox('')],
      ['pip', 'Floating video', 'The video keeps playing in a small window while you do something else.', () => VexUI.toast('Play a video, then use the controls above the toolbar')],
      ['home-screen', 'Add to the home screen', 'A site, pinned to the launcher with its own icon.', () => VexUI.toast('Open a site, then Menu → Add to home screen')],
      ['default', 'Make Vex the default browser', 'So links from other apps open here.', () => VexBridge.openDefaultBrowserSettings()]
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
