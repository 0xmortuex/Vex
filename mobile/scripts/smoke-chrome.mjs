// Drive the mobile chrome in a phone-sized Chromium and check the paths a
// person actually takes: navigate, menu, site rules, tabs, reader, assistant,
// themes, privacy, find, private browsing, Android back.
//
// It runs against the iframe fallback (no Capacitor), so the native calls are
// stubs — which is the point: every line of chrome code runs, and the few
// places that need a real answer from native (page extraction, the AI worker)
// are given one by the stubs below.
//
//   npm i -D playwright && npx playwright install chromium
//   node scripts/smoke-chrome.mjs [--shots <dir>]
//
// Any failed expectation, or any page error, fails the run.

import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const wwwDir = path.join(here, '..', 'www');
const shotIndex = process.argv.indexOf('--shots');
const shotDir = shotIndex > 0 ? process.argv[shotIndex + 1] : null;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

const errors = [];
const results = {};

// A crash halfway through says nothing about how far the walkthrough got. This
// writes what was collected before the throw — synchronously, because stderr
// to a CI pipe does not always flush before exit.
process.on('uncaughtException', error => {
  fs.writeSync(2, 'CRASH ' + ((error && error.stack) || error) + '\n\nreached:\n');
  for (const [key, value] of Object.entries(results)) {
    fs.writeSync(2, '  ' + key + ' = ' + JSON.stringify(value) + '\n');
  }
  process.exit(1);
});
// The chrome is SERVED, not opened as a file.
//
// On a device Capacitor serves it from https://localhost, and the difference
// matters: a page on a file:// origin cannot import an ES module at all, which
// is how the PDF reader (pdf.js, loaded on demand) came to work on a phone and
// not here. A static server of twenty lines is the smallest way to be faithful.
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png', '.txt': 'text/plain'
};
const server = http.createServer((request, response) => {
  const asked = decodeURIComponent((request.url || '/').split('?')[0]);
  const file = path.join(wwwDir, asked === '/' ? 'index.html' : asked);
  // Nothing outside www/, however the path is spelled.
  if (!file.startsWith(wwwDir)) { response.writeHead(403).end(); return; }
  fs.readFile(file, (error, body) => {
    if (error) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    response.end(body);
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;

// Playwright wants the exact Chromium build it shipped with. Where a container
// has pre-installed a different one (and so Playwright's own download is turned
// off), CHROMIUM_PATH — or that browser, if it is where containers put it —
// keeps the walkthrough runnable instead of asking for a download that cannot
// happen.
const prebuilt = '/opt/pw-browsers/chromium';
const executablePath = process.env.CHROMIUM_PATH
  || (fs.existsSync(prebuilt) && fs.statSync(prebuilt).isFile() ? prebuilt : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const context = await browser.newContext({ ...devices['Pixel 7'] });

// Hermetic: the run must behave the same on a laptop, in a sandbox with no
// network, and on a CI runner with a fast one. Nothing here should reach a
// real site — the fallback's iframes would otherwise load news.ycombinator.com
// and fail on its framing policy, which says nothing about Vex.
await context.route('**', route => {
  const url = route.request().url();
  if (url.startsWith(origin) || url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:')) {
    return route.continue();
  }
  return route.abort();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push('pageerror: ' + error.message));
page.on('console', message => {
  if (message.type() !== 'error') return;
  // Requests are aborted on purpose (above), and a site that refuses to be
  // framed is the fallback's problem, not the chrome's.
  if (/ERR_|Failed to load resource|frame-ancestors|Content Security Policy|Refused to (display|frame)/.test(message.text())) return;
  errors.push('console: ' + message.text());
});

// Why a tap failed matters more than that it did: a chrome that lays out
// differently in a newer Chromium looks, from here, exactly like a chrome with
// the wrong selector. So a failed tap reports the element's box, the styles
// that could have hidden it, and which overlays were open at the time.
const describe = async selector => page.evaluate(sel => {
  const node = document.querySelector(sel);
  if (!node) return 'no such element';
  const box = node.getBoundingClientRect();
  const chain = [];
  for (let at = node; at && at !== document.documentElement; at = at.parentElement) {
    const style = getComputedStyle(at);
    chain.push((at.id ? '#' + at.id : at.tagName.toLowerCase())
      + ' [' + style.display + '/' + style.visibility + '/opacity ' + style.opacity
      + (at.hidden ? '/hidden attr' : '')
      + (style.transform !== 'none' ? '/' + style.transform : '')
      + ' ' + Math.round(at.getBoundingClientRect().width) + '×' + Math.round(at.getBoundingClientRect().height) + ']');
  }
  const open = ['panel', 'omnibox', 'tabgrid', 'findbar', 'scan', 'qrshare', 'dialog', 'sheet']
    .filter(id => document.getElementById(id) && !document.getElementById(id).hidden);
  return 'box ' + Math.round(box.width) + '×' + Math.round(box.height)
    + ' at ' + Math.round(box.x) + ',' + Math.round(box.y)
    + ' · viewport ' + innerWidth + '×' + innerHeight
    + ' · body "' + document.body.className + '" toolbar=' + document.body.dataset.toolbar
    + ' · open: ' + (open.join(', ') || 'nothing')
    + '\n    ' + chain.join('\n    ');
}, selector);

// A forced click does not wait for anything: Playwright resolves the element and
// clicks that node. If the chrome re-renders in between — which it does, on every
// state change — the node it resolved is gone from the document and has no box,
// which is what run 3 hit. So aim again rather than give up on the first miss.
const tap = async (selector, wait = 200) => {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.click(selector, { force: true, timeout: 8000 });
      break;
    } catch (error) {
      if (attempt >= 8) {
        const state = await describe(selector).catch(() => 'could not inspect');
        throw new Error('tap ' + selector + ' failed ' + attempt + ' times: '
          + error.message.split('\n')[0] + '\n  ' + state);
      }
      await page.waitForTimeout(150);
    }
  }
  await page.waitForTimeout(wait);
};
const shot = async name => { if (shotDir) await page.screenshot({ path: path.join(shotDir, name + '.png') }); };
const sheetRow = async label => {
  const rows = await page.$$('#sheet-list .sheet-row');
  for (const row of rows) {
    if ((await row.textContent()).trim().startsWith(label)) { await row.click({ force: true }); await page.waitForTimeout(250); return true; }
  }
  return false;
};

await page.goto(origin + '/index.html');
await page.waitForTimeout(900);

// ── The first run, which is what a person actually meets first ──────────────
results.welcomeShown = await page.isVisible('#panel') && (await page.textContent('#panel-title')) === 'Welcome to Vex';
results.welcomeSteps = 0;
for (let step = 0; step < 6; step++) {
  const next = await page.$('#panel-body .welcome-nav .pill-btn:not(.ghost)');
  if (!next) break;
  results.welcomeSteps++;
  const label = (await next.textContent()).trim();
  await next.click({ force: true });
  await page.waitForTimeout(220);
  if (label === 'Start browsing') break;
}
results.welcomeDismissed = !(await page.isVisible('#panel'));
results.welcomeRemembered = await page.evaluate(() => VexStore.get('vex.onboarded', false));
await shot('00-welcome');

// Stand in for the parts of native the chrome asks real questions of.
await page.evaluate(() => {
  const article = {
    ok: true, title: 'The Wreck of the Deutschland', byline: 'G. M. Hopkins',
    published: '2026-01-01T00:00:00Z', words: 900,
    blocks: [
      { type: 'h2', text: 'A section heading' },
      { type: 'p', text: 'Thou mastering me God! giver of breath and bread.' },
      { type: 'p', text: 'World’s strand, sway of the sea; Lord of living and dead.' },
      { type: 'blockquote', text: 'Over again I feel thy finger and find thee.' }
    ]
  };
  window.VexBridge.evaluate = async (id, code) => {
    if (code.includes('theme-color')) return { result: '"#1e3a5f"' };
    return { result: JSON.stringify(article) };
  };
  // A worker that always answers, so the assistant path is exercised without
  // a network or a token belonging to anyone.
  window.fetch = async () => ({
    ok: true,
    json: async () => ({ result: { reply: 'Four paragraphs about a shipwreck.', suggestedFollowUps: ['Who wrote it?'] } })
  });
});

// ── Seed some history so the start page and suggestions have something ──────
await page.evaluate(async () => {
  const now = Date.now();
  for (const entry of [
    { url: 'https://en.wikipedia.org/wiki/Web_browser', title: 'Web browser — Wikipedia', at: now - 90000000 },
    { url: 'https://developer.mozilla.org/', title: 'MDN Web Docs', at: now - 7200000 },
    { url: 'https://github.com/0xmortuex/Vex', title: 'Vex on GitHub', at: now - 60000 },
    { url: 'https://news.ycombinator.com/', title: 'Hacker News', at: now - 1000 }
  ]) await VexHistory.add(entry);
  // And one page's text, so Recall has something to find.
  await VexHistory.index({
    url: 'https://developer.mozilla.org/',
    title: 'MDN Web Docs',
    text: 'The shipwreck of the Deutschland is discussed in this imaginary page about prosody and metre.'
  });
  await VexCollections.bookmarks.add({ url: 'https://claude.ai/', title: 'Claude' });
  await VexCollections.reading.add({ url: 'https://example.org/long-read', title: 'A long read' });
  VexStart.render();
});
await page.waitForTimeout(250);
results.startTiles = await page.$$eval('#start-tiles .tile', tiles => tiles.length);
results.startRail = await page.$$eval('#start-recent .rail-card', cards => cards.length);
await shot('01-start');

// ── Omnibox → navigate ──────────────────────────────────────────────────────
await tap('#tb-url');
results.omniOpen = await page.isVisible('#omnibox');
await page.fill('#omni-input', 'mdn');
await page.waitForTimeout(400);                 // local rows, then the engine's
results.suggestions = await page.$$eval('#omni-results .omni-row', rows => rows.length);
results.suggestionHighlight = await page.$$eval('#omni-results mark', marks => marks.length);
// The engine's own suggestions, under the local ones, each with the arrow that
// puts it in the box instead of going there.
results.engineSuggestions = await page.$$eval('#omni-results .omni-row',
  rows => rows.filter(row => (row.textContent || '').includes('DuckDuckGo')).length);
results.suggestFillArrows = await page.$$eval('#omni-results .omni-fill', fills => fills.length);
await shot('02-omnibox');
results.suggestFills = await page.evaluate(async () => {
  const fill = document.querySelectorAll('#omni-results .omni-fill')[1];
  if (!fill) return '';
  fill.click();
  await new Promise(resolve => setTimeout(resolve, 150));
  return document.getElementById('omni-input').value;
});
// A private tab is private from the search engine too.
results.suggestNotWhenPrivate = await page.evaluate(async () => {
  const before = VexTabStore.active;
  VexTabStore.active = () => ({ id: 'p', url: 'https://x.example/', incognito: true });
  VexSearch.forgetSuggestions();
  const answers = await VexSearch.remoteSuggest('something');
  VexTabStore.active = before;
  return answers.length;
});
await page.fill('#omni-input', 'example.com');
await page.press('#omni-input', 'Enter');
await page.waitForTimeout(450);
results.urlPill = (await page.textContent('#tb-url-text')).trim();
results.startHidden = !(await page.isVisible('#start'));

// ── On-device AI ────────────────────────────────────────────────────────────
// There is no plugin in a desktop browser, so this is the shape of the panel on
// a phone that cannot run a model: it says so, it still offers Nano, and the
// routing refuses to claim a model it does not have.
await page.evaluate(() => VexPanels.localAI());
await page.waitForTimeout(350);
results.localAiRows = await page.$$eval('#panel-body .sheet-row', rows => rows.length);
// The panel has to say how a model gets here, because that is the part a person
// cannot guess: the models worth running are licence-gated.
results.localAiHonest = ((await page.textContent('#panel-body')) || '').includes('licence');
results.localAiRoutesNothing = await page.evaluate(() => VexLocalAI.handles('chat'));
results.localAiNeverAgent = await page.evaluate(() => VexLocalAI.CHAT_ACTIONS.includes('agent'));
results.localAiPrompt = await page.evaluate(() =>
  VexLocalAI.promptFor('summarize', '', { text: 'A long article about ships.' }).includes('bullet'));
await shot('12-local-ai');

// The development stand-in is a model's whole shape without being one, so the
// path a person actually takes — import, choose, load, ask, watch it stream —
// can be walked here rather than only on a phone.
results.localAiImported = await page.evaluate(async () => {
  await VexLocalAI.importFile('Gemma3-1B-IT.litertlm');
  await new Promise(resolve => setTimeout(resolve, 200));
  await VexLocalAI.refresh();
  return VexLocalAI.installed().includes('Gemma3-1B-IT.litertlm');
});
// The panel was open the whole time; it has to have noticed the model land.
await page.waitForTimeout(700);
results.localAiPanelFollows = ((await page.textContent('#panel-body')) || '').includes('MB on disk');
results.localAiLoads = await page.evaluate(async () => {
  await VexLocalAI.setModel('Gemma3-1B-IT.litertlm');
  await VexLocalAI.setMode('prefer');
  return VexLocalAI.load();
});
results.localAiHandlesNow = await page.evaluate(() => VexLocalAI.handles('chat'));
results.localAiStreamed = await page.evaluate(async () => {
  let pieces = 0;
  const answer = await VexLocalAI.generate('Say something.', { onToken: () => { pieces++; } });
  return pieces > 3 && answer.length > 20;
});
await page.evaluate(() => VexPanels.close());

// Through the assistant, with the view rendering it: the answer must come from
// the phone and say so, and nothing may reach the network.
await page.evaluate(() => VexViews.openAI());
await page.waitForTimeout(250);
await page.fill('#vex-chat-input', 'What is this page about?');
await page.press('#vex-chat-input', 'Enter');
await page.waitForTimeout(900);
results.chatOnDeviceTag = await page.$$eval('#vex-chat-log .bubble-tag',
  tags => tags.some(tag => tag.textContent.includes('this phone')));
results.chatOnDeviceAnswer = ((await page.textContent('#vex-chat-log')) || '').includes('stand-in');
await shot('13-on-device-chat');
await page.evaluate(async () => {
  await VexLocalAI.setMode('off');
  await VexLocalAI.unload();
  VexAI.clear();
  VexPanels.close();
});

// ── A PDF ───────────────────────────────────────────────────────────────────
// The reader opens on the event the native side sends instead of a download,
// and Back closes it before anything underneath. pdf.js itself is not exercised
// here — there is no PDF to fetch in a hermetic run — so what is checked is the
// part Vex wrote: that the viewer opens, covers, says what it is reading, and
// gets out of the way.
await page.evaluate(() => window.__vexEmit('pdf', {
  id: VexTabStore.activeId(), url: 'https://example.com/timetable.pdf', filename: 'timetable.pdf'
}));
await page.waitForTimeout(1400);                  // fetch, import pdf.js, render
results.pdfOpens = await page.isVisible('#pdfview');
results.pdfNames = ((await page.textContent('#pdf-name')) || '').includes('timetable.pdf');
// pdf.js really runs: a canvas with the page drawn on it, and a page count.
results.pdfRendered = await page.$$eval('#pdf-pages canvas', pages => pages.length);
results.pdfCounts = ((await page.textContent('#pdf-count')) || '').trim();
results.pdfBackCloses = await page.evaluate(async () => {
  const handled = await VexUI.handleBack();
  return handled && !!document.getElementById('pdfview').hidden;
});
await shot('17-pdf');

// ── Backup ──────────────────────────────────────────────────────────────────
// The panel says what it carries before it carries it, and the file itself is
// unreadable without the passphrase — which is the whole of the promise.
await page.evaluate(() => VexPanels.backup());
await page.waitForTimeout(350);
const backupText = (await page.textContent('#panel-body')) || '';
results.backupSaysWhatItCannot = backupText.includes('Keystore');
results.backupCounts = backupText.includes('bookmarks');
results.backupSealed = await page.evaluate(async () => {
  const text = await VexBackup.write('a good passphrase');
  return !text.includes('example') && JSON.parse(text).format === 'vex.backup';
});
results.backupOpens = await page.evaluate(async () => {
  const envelope = JSON.parse(await VexBackup.write('a good passphrase'));
  const data = await VexBackup.decrypt(envelope, 'a good passphrase');
  return Object.keys(data.settings).length > 5;
});
await shot('16-backup');
await page.evaluate(() => VexPanels.close());

// ── Diagnostics ─────────────────────────────────────────────────────────────
// What a bug report needs: the phone, what its WebView can do, and the last
// problems. The recorder is checked by giving it one.
await page.evaluate(() => VexReport.note('A problem, for the diagnostics page', 'smoke'));
await page.evaluate(() => VexPanels.diagnostics());
await page.waitForTimeout(400);
results.diagnosticsRows = await page.$$eval('#panel-body .sheet-row', rows => rows.length);
const diagnosticsText = (await page.textContent('#panel-body')) || '';
results.diagnosticsWebView = diagnosticsText.includes('WebView');
results.diagnosticsFeatures = diagnosticsText.includes('fingerprint shield');
results.diagnosticsShowsProblem = diagnosticsText.includes('A problem, for the diagnostics page');
results.diagnosticsText = await page.evaluate(async () => {
  const text = await VexReport.asText();
  return text.includes('WebView features:') && text.includes('A problem, for the diagnostics page');
});
// A token in an error message is exactly the thing not to put on a page people
// screenshot.
results.diagnosticsRedacts = await page.evaluate(() => {
  const entry = VexReport.note('failed: https://x.example/a?token=SECRETVALUE&b=1', '');
  return !entry.message.includes('SECRETVALUE');
});
await shot('15-diagnostics');
await page.evaluate(() => VexPanels.close());

// ── Polishing a selection ───────────────────────────────────────────────────
// The sheet Nano's three jobs are offered through, and the fallback when there
// is no Nano: a worker answer, shown with something to do about it.
await page.evaluate(() => window.__vexEmit('selection', {
  id: VexTabStore.activeId(), action: 'polish', text: 'this sentance has a typo in it'
}));
await page.waitForTimeout(350);
results.polishSheet = await page.$$eval('#sheet-list .sheet-row', rows => rows.length);
results.polishOffersGrammar = ((await page.textContent('#sheet-list')) || '').includes('grammar');
await shot('14-polish');
await page.evaluate(() => VexSheets.close());

// ── The tab bar, which only a wide window gets ──────────────────────────────
// A phone does not show one. Widen the window to a tablet and it should appear,
// with a chip per tab; narrow it again and it should go away, because a fold or
// a split screen changes the answer without restarting anything.
results.tabBarOnPhone = await page.evaluate(() => !!document.getElementById('tabstrip').hidden);
await page.setViewportSize({ width: 900, height: 700 });
await page.waitForTimeout(300);
results.tabBarOnTablet = await page.isVisible('#tabstrip');
results.tabBarChips = await page.$$eval('#tabstrip .tabstrip-tab', chips => chips.length);
results.tabBarActive = await page.$$eval('#tabstrip .tabstrip-tab.active', chips => chips.length);
await shot('11-tabbar');
await page.setViewportSize({ width: 412, height: 915 });
await page.waitForTimeout(300);
results.tabBarGoesAway = await page.evaluate(() => !!document.getElementById('tabstrip').hidden);

// ── The home-screen widget's three taps ─────────────────────────────────────
// A widget tap arrives the way a share does: as a window event carrying what
// was tapped. Capacitor puts the payload's fields on the event itself, which is
// the shape this reproduces.
await page.evaluate(() => {
  const event = new Event('vexOpenText');
  event.widget = 'search';
  window.dispatchEvent(event);
});
await page.waitForTimeout(250);
results.widgetOpensOmnibox = await page.isVisible('#omnibox');
await page.evaluate(() => VexUI.closeOmnibox());
await page.waitForTimeout(150);
results.widgetDictates = await page.evaluate(() => typeof VexUI.dictateIntoOmnibox === 'function');

// ── Menu sheet ──────────────────────────────────────────────────────────────
await tap('#tb-menu');
results.menuRows = await page.$$eval('#sheet-list .sheet-row', rows => rows.length);
results.menuQuick = await page.$$eval('#sheet-quick .quick', quick => quick.length);
await shot('03-menu');

// ── Site rules ──────────────────────────────────────────────────────────────
results.siteSheetOpened = await sheetRow('This site');
results.siteRows = await page.$$eval('#sheet-list .sheet-row', rows => rows.length);
await shot('04-site');
// Turn JavaScript off for this host and check it was recorded.
const rows = await page.$$('#sheet-list .sheet-row');
for (const row of rows) {
  if ((await row.textContent()).includes('JavaScript')) { await row.click({ force: true }); break; }
}
await page.waitForTimeout(250);
results.scriptsOff = await page.evaluate(() => VexSiteRules.for('example.com').scripts === false);
results.ruleDescribed = await page.evaluate(() => VexSiteRules.describe('example.com'));
await page.evaluate(() => VexSheets.close());

// ── Reader ──────────────────────────────────────────────────────────────────
await page.evaluate(() => VexViews.openReader());
await page.waitForTimeout(400);
results.readerOpen = await page.isVisible('#reader');
results.readerTitle = await page.textContent('#reader-body h1');
results.readerParas = await page.$$eval('#reader-body p', paras => paras.length);
await shot('05-reader');
await tap('#reader-bigger');
results.readerSize = await page.evaluate(() => VexStore.get('vex.readerSize', 19));
// Typeface, measure, line spacing and paper: four attributes on #reader, each
// absent while it is the default, so the stylesheet needs no rule for "normal".
results.readerLookDefault = await page.evaluate(() =>
  ['font', 'width', 'leading', 'tint'].map(name => document.getElementById('reader').dataset[name] || '-').join(','));
results.readerLook = await page.evaluate(async () => {
  await VexStore.set('vex.readerFont', 'serif');
  await VexStore.set('vex.readerTint', 'paper');
  VexViews.readerLook();                       // applies as it draws the sheet
  const reader = document.getElementById('reader');
  return (reader.dataset.font || '-') + ',' + (reader.dataset.tint || '-');
});
results.readerLookRows = await page.$$eval('#sheet-list .sheet-row', rows => rows.length);
await page.evaluate(() => VexSheets.close());
// How far through it you are. The walkthrough's article is shorter than the
// screen, so the arithmetic is given something to measure.
results.readerProgress = await page.evaluate(() => {
  const body = document.getElementById('reader-body');
  const spacer = document.createElement('div');
  spacer.style.height = '3000px';
  body.appendChild(spacer);
  body.scrollTop = body.scrollHeight;
  VexViews.onReaderScroll();
  const width = document.getElementById('reader-progress').style.width;
  spacer.remove();
  body.scrollTop = 0;
  return width;
});
await page.evaluate(async () => {
  await VexStore.set('vex.readerFont', 'theme');
  await VexStore.set('vex.readerTint', 'theme');
  VexSheets.close();
});
await tap('#reader-close');

// ── Assistant ───────────────────────────────────────────────────────────────
await page.evaluate(async () => {
  await VexStore.set('vex.aiWorkerUrl', 'https://worker.example.workers.dev');
  await VexBridge.vaultSet('vex.aiToken', 'a'.repeat(32));
});
await page.evaluate(() => VexViews.openAI());
await page.waitForTimeout(300);
await page.fill('#vex-chat-input', 'What is this page about?');
await page.press('#vex-chat-input', 'Enter');
await page.waitForTimeout(500);
results.chatBubbles = await page.$$eval('#vex-chat-log .bubble', bubbles => bubbles.length);
results.chatAnswer = (await page.$$eval('#vex-chat-log .bubble.assistant', bubbles => bubbles.map(b => b.textContent)))[0] || '';
results.chatFollowUps = await page.$$eval('#vex-chat-suggest .chip', chips => chips.length);
await shot('06-assistant');

// ── Appearance: switch theme ────────────────────────────────────────────────
await page.evaluate(() => VexPanels.appearance());
await page.waitForTimeout(300);
results.themeCards = await page.$$eval('.theme-card', cards => cards.length);
await shot('07-appearance');
const themeCards = await page.$$('.theme-card');
await themeCards[3].click({ force: true });          // a specific theme, not auto
await page.waitForTimeout(350);
results.themeApplied = await page.evaluate(() => document.documentElement.dataset.theme);
results.themeStored = await page.evaluate(() => VexStore.get('vex.theme', 'auto'));
await shot('08-theme-dark');

// A skin, and the texture it sets.
await page.evaluate(async () => { await VexTheme.setSkin('graph', 0.08); });
await page.waitForTimeout(200);
results.skinTexture = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--skin-texture').includes('svg+xml'));

// ── Privacy panel ───────────────────────────────────────────────────────────
await page.evaluate(() => VexPanels.privacy());
await page.waitForTimeout(300);
results.privacyRows = await page.$$eval('#panel-body .sheet-row', rows => rows.length);
await shot('09-privacy');
results.shieldScript = await page.evaluate(() => VexShield.script('strict').includes('hardwareConcurrency'));
results.shieldOffEmpty = await page.evaluate(() => VexShield.script('off') === '');

// ── Tabs ────────────────────────────────────────────────────────────────────
await page.evaluate(() => VexPanels.close());
await page.evaluate(async () => {
  await VexTabStore.create('https://news.ycombinator.com/');
  await VexTabStore.create('https://github.com/0xmortuex/Vex');
  VexTabStore.all().forEach((tab, index) => VexTabStore.update(tab.id, {
    title: ['example.com', 'Hacker News', 'Vex on GitHub'][index] || 'Tab'
  }));
});
await tap('#tb-tabs', 320);
results.tabCards = await page.$$eval('.tabcard', cards => cards.length);
await shot('10-tabs');
// Search by URL, not title: the fallback's iframe load handler rewrites a
// tab's title to its src, which a real WebView would not do.
await page.fill('#tg-search', 'github');
await page.waitForTimeout(220);
results.tabSearchCards = await page.$$eval('.tabcard', cards => cards.length);
await page.fill('#tg-search', '');
await page.waitForTimeout(150);
// A private tab in front blocks screenshots and the recents thumbnail; so does
// the switcher's private side. The chrome asks native for it exactly once per
// change, which is what this watches.
let screenshotCalls = [];
await page.exposeFunction('vexNoteScreenshotFlag', value => { screenshotCalls.push(value); });
await page.evaluate(() => {
  const real = VexBridge.setScreenshotsBlocked.bind(VexBridge);
  VexBridge.setScreenshotsBlocked = value => { window.vexNoteScreenshotFlag(value); return real(value); };
});
await tap('#tg-private', 250);
results.privateEmptyCopy = ((await page.textContent('.tabgrid-empty')) || '').slice(0, 20);
results.screenshotsBlockedOnPrivateSide = screenshotCalls.slice();
await tap('#tg-normal', 200);
results.screenshotsAllowedAgain = screenshotCalls.slice();

// Closing a tab offers it back in the toast, and Undo brings it back. A private
// tab is never offered, because it is never written to the closed list.
results.undoClose = await page.evaluate(async () => {
  const opened = await VexTabStore.create('https://undo.example/', { background: true });
  const before = VexTabStore.all().length;
  await VexUI.closeTabWithUndo(VexTabStore.get(opened.id));
  const toast = document.querySelector('#toasts .toast');
  const offered = !!(toast && /Undo/.test(toast.textContent));
  const button = toast && toast.querySelector('button');
  if (button) button.click();
  await new Promise(resolve => setTimeout(resolve, 500));
  return { offered, back: VexTabStore.all().length === before,
    url: (VexTabStore.all().find(tab => tab.url === 'https://undo.example/') || {}).url || '' };
});
results.undoPrivate = await page.evaluate(async () => {
  const opened = await VexTabStore.create('https://secret.example/', { background: true, incognito: true });
  await VexUI.closeTabWithUndo(VexTabStore.get(opened.id));
  const toast = document.querySelector('#toasts .toast');
  return !(toast && /Undo/.test(toast.textContent));
});
await page.evaluate(async () => {
  for (const tab of VexTabStore.all().filter(tab => tab.url === 'https://undo.example/')) {
    await VexTabStore.close(tab.id);
  }
});
await tap('#tg-done');

// ── Private browsing keeps out of history ───────────────────────────────────
const historyBefore = await page.evaluate(() => VexStore.get('vex.history', []).length);
await page.evaluate(async () => {
  const tab = await VexTabStore.create('https://secret.example/', { incognito: true });
  VexTabStore.update(tab.id, { url: 'https://secret.example/', title: 'Secret' });
});
await page.waitForTimeout(250);
results.privateBodyClass = await page.evaluate(() => document.body.classList.contains('private'));
results.historyUnchanged = (await page.evaluate(() => VexStore.get('vex.history', []).length)) === historyBefore;
await shot('11-private');

// ── Long-press menu ─────────────────────────────────────────────────────────
await page.evaluate(() => VexSheets.link({ link: 'https://example.com/story', image: '' }));
await page.waitForTimeout(250);
results.linkSheetRows = await page.$$eval('#sheet-list .sheet-row', rows => rows.length);
await shot('12-longpress');
await page.evaluate(() => VexSheets.close());

// ── Removing a bookmark, and taking it back ─────────────────────────────────
// Driven through the panel itself: the × on the row, the toast it raises, and
// Undo putting back the same bookmark rather than a new one with today's date.
results.bookmarkUndo = await page.evaluate(async () => {
  await VexCollections.bookmarks.add({ url: 'https://undo-me.example/', title: 'Undo me', folder: 'Smoke' });
  const before = VexCollections.bookmarks.get('https://undo-me.example/');
  VexPanels.bookmarks();
  await new Promise(resolve => setTimeout(resolve, 250));
  const row = [...document.querySelectorAll('#panel-body .list-row')]
    .find(node => node.textContent.includes('Undo me'));
  row.querySelector('.x').click();
  await new Promise(resolve => setTimeout(resolve, 250));
  const gone = !VexCollections.bookmarks.has('https://undo-me.example/');
  const toast = [...document.querySelectorAll('#toasts .toast')].pop();
  toast.querySelector('button').click();
  await new Promise(resolve => setTimeout(resolve, 250));
  const after = VexCollections.bookmarks.get('https://undo-me.example/');
  const folderHeading = [...document.querySelectorAll('#panel-body .list-head')]
    .some(node => node.textContent === 'Smoke' && node.classList.contains('tappable'));
  await VexCollections.bookmarks.remove('https://undo-me.example/');
  VexPanels.close();
  return [gone, !!after && after.id === before.id && after.folder === 'Smoke', folderHeading].join(',');
});

// ── The number on the tabs button ───────────────────────────────────────────
// It has to be the number of cards the switcher will show, which is the side you
// are on: a normal tab counting the private ones tells whoever is holding the
// phone how many of those there are.
results.tabCount = await page.evaluate(async () => {
  const read = () => (document.getElementById('tb-tabcount') || {}).textContent;
  const normals = VexTabStore.normal().length;
  const secret = await VexTabStore.create('https://counted.example/', { incognito: true });
  await VexTabStore.activate(VexTabStore.normal()[0].id);
  VexUI.renderToolbar();
  const onNormal = read();
  await VexTabStore.activate(secret.id);
  VexUI.renderToolbar();
  const onPrivate = read();
  const privates = VexTabStore.private().length;
  await VexTabStore.close(secret.id);
  await VexTabStore.activate(VexTabStore.normal()[0].id);
  VexUI.renderToolbar();
  return { onNormal, onPrivate, normals: String(normals), privates: String(privates) };
});

// ── Leaving Vex locks private browsing again ─────────────────────────────────
// The few minutes' grace is so that switching tabs is not a fingerprint every
// time, not so that handing somebody the phone opens private browsing.
results.privateRelocks = await page.evaluate(async () => {
  await VexStore.set('vex.lockPrivate', true);
  let asked = 0;
  VexBridge.authenticate = async () => { asked++; return { ok: true }; };

  const first = await VexUI.unlockPrivate();
  const grace = await VexUI.unlockPrivate();        // still unlocked: no prompt
  VexUI.relockPrivate();
  const after = await VexUI.unlockPrivate();        // asked again

  await VexStore.set('vex.lockPrivate', false);
  return [first, grace, after, asked].join(',');
});

// ── Every way into private browsing passes the lock ──────────────────────────
// "Open in private tab" on a link used to skip it, and coming back to Vex with
// a private tab in front showed the page without asking.
results.privateLockEverywhere = await page.evaluate(async () => {
  await VexStore.set('vex.lockPrivate', true);
  let answer = false;
  const realAuthenticate = VexBridge.authenticate;
  VexBridge.authenticate = async () => ({ ok: answer });
  VexUI.relockPrivate();
  const before = VexTabStore.private().length;
  await VexUI.openUrl('https://secret.example/', { newTab: true, incognito: true });
  const refused = VexTabStore.private().length === before;

  answer = true;
  await VexUI.openUrl('https://secret.example/', { newTab: true, incognito: true });
  const opened = !!(VexTabStore.active() && VexTabStore.active().incognito);

  VexUI.relockPrivate();                              // left Vex
  answer = false;
  const shown = await VexUI.guardPrivateOnReturn();   // came back, wrong finger
  const hidden = !!(VexTabStore.active() && !VexTabStore.active().incognito);

  for (const tab of VexTabStore.private()) await VexTabStore.close(tab.id);
  await VexStore.set('vex.lockPrivate', false);
  VexBridge.authenticate = realAuthenticate;
  return [refused, opened, shown, hidden].join(' ');
});

// ── The video bar's own sheet ───────────────────────────────────────────────
// Speed, brightness and sound all existed in js/media.js with nothing in the
// chrome reaching any of them. This drives the sheet and checks the page was
// actually told.
results.videoSheet = await page.evaluate(async () => {
  const told = [];
  for (const name of ['speed', 'brightness', 'mute']) {
    const real = VexMedia[name].bind(VexMedia);
    VexMedia[name] = async (id, value) => { told.push(name + '=' + value); return real(id, value); };
  }
  VexMedia.state = async () => ({ playing: true, width: 640, height: 360, duration: 90, current: 3, muted: false });

  document.getElementById('media-label').click();
  await new Promise(resolve => setTimeout(resolve, 250));
  const rows = [...document.querySelectorAll('#sheet-list .sheet-row')].map(row => row.textContent);

  // Speed → 1.5×
  const speedRow = [...document.querySelectorAll('#sheet-list .sheet-row')]
    .find(row => /^Speed/.test(row.textContent));
  speedRow.click();
  await new Promise(resolve => setTimeout(resolve, 250));
  [...document.querySelectorAll('#sheet-list .sheet-row')]
    .find(row => row.textContent.trim().startsWith('1.5')).click();
  await new Promise(resolve => setTimeout(resolve, 300));

  // And mute, from the top of the sheet again.
  document.getElementById('media-label').click();
  await new Promise(resolve => setTimeout(resolve, 250));
  [...document.querySelectorAll('#sheet-list .sheet-row')]
    .find(row => /Mute it/.test(row.textContent)).click();
  await new Promise(resolve => setTimeout(resolve, 300));
  VexSheets.close();
  return { rows: rows.length, told: told.join(' ') };
});

// ── When a page will not load ───────────────────────────────────────────────
// Vex draws its own error page, and its buttons are vex:// links because a page
// cannot call the chrome. Both halves are driven here: the page it builds, and
// what the chrome does when one of those links is followed.
results.errorPage = await page.evaluate(async () => {
  const tab = VexTabStore.active();
  const built = VexErrors.html({
    url: 'https://missing.example/thing', code: -2, description: 'net::ERR_NAME_NOT_RESOLVED',
    hasSaved: true, offline: false
  });
  const drawn = await VexErrors.show(Object.assign({}, tab, { pendingUrl: 'https://missing.example/thing' }),
    { code: -2, description: 'net::ERR_NAME_NOT_RESOLVED' });
  return {
    title: (built.match(/<h1>([^<]*)<\/h1>/) || [])[1] || '',
    offersSaved: built.includes('vex://saved'),
    offersSearch: built.includes('vex://search'),
    noScript: !built.includes('<script'),
    drawn
  };
});
// A description Chromium phrased with a < in it must not come out as &lt;.
results.errorEscapes = await page.evaluate(() =>
  VexErrors.html({ url: 'https://x.example/', code: -99, description: 'it said <b>no</b>' }));
// The vex:// buttons: "search for it instead" leaves the tab on a search.
results.errorCommand = await page.evaluate(async () => {
  const tab = VexTabStore.active();
  await VexErrors.handle(Object.assign(tab, { errorUrl: 'https://missing.example/thing' }),
    'search', '?missing.example');
  await new Promise(resolve => setTimeout(resolve, 300));
  return VexTabStore.active().pendingUrl || VexTabStore.active().url;
});

// ── A page asking for the camera ────────────────────────────────────────────
// The decision is the chrome's: native waits for an answer, and anything the
// chrome does not name is denied. Before this existed the WebView handed a page
// whatever Android had granted Vex, and the site-permissions screen was a list
// nothing ever wrote to.
results.permissionDecides = await page.evaluate(async () => {
  const answered = [];
  const real = VexBridge.answerPermission.bind(VexBridge);
  VexBridge.answerPermission = async (requestId, granted) => {
    answered.push(requestId + ':' + granted.join('+'));
    return real(requestId, granted);
  };
  VexBridge.requestPermission = async () => true;       // Android says yes

  // Remembered as blocked: denied without a word.
  await VexPermissions.set('deny.example', 'camera', 'block');
  VexBridge.emitNative('permissionRequest', {
    id: VexTabStore.activeId(), origin: 'https://deny.example', kinds: 'camera', requestId: 'p1'
  });
  await new Promise(resolve => setTimeout(resolve, 300));

  // Remembered as allowed: granted without a word.
  await VexPermissions.set('yes.example', 'microphone', 'allow');
  VexBridge.emitNative('permissionRequest', {
    id: VexTabStore.activeId(), origin: 'https://yes.example', kinds: 'microphone', requestId: 'p2'
  });
  await new Promise(resolve => setTimeout(resolve, 300));

  // Never asked before: a dialog, and what you choose is remembered.
  VexBridge.emitNative('permissionRequest', {
    id: VexTabStore.activeId(), origin: 'https://new.example', kinds: 'location', requestId: 'p3'
  });
  await new Promise(resolve => setTimeout(resolve, 300));
  const asked = document.getElementById('dialog').hidden === false
    && document.getElementById('dialog-message').textContent;
  document.getElementById('dialog-ok').click();
  await new Promise(resolve => setTimeout(resolve, 400));

  VexBridge.answerPermission = real;
  const remembered = VexPermissions.get('new.example', 'location');
  // Leave the permissions list as it was found: a later check counts its rows.
  for (const host of ['deny.example', 'yes.example', 'new.example']) await VexPermissions.clearSite(host);
  return { answered: answered.join(' '), asked, remembered };
});

// ── How big the interface is ────────────────────────────────────────────────
// Android's font-size setting reaches a WebView's page text, not a web app's
// layout, so this is Vex's own answer: one multiplier on the type scale, the
// toolbar height and the tap target.
results.uiScale = await page.evaluate(async () => {
  const read = () => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim();
  const toolbar = () => Math.round(document.getElementById('toolbar').getBoundingClientRect().height);
  const before = { scale: read(), height: toolbar() };
  await VexTheme.setUiScale(1.4);
  const after = { scale: read(), height: toolbar() };
  await VexTheme.setUiScale(1);
  return { before, after, back: read() };
});

// ── Reading aloud ───────────────────────────────────────────────────────────
// Headless Chromium has a speechSynthesis that accepts utterances and never
// speaks, so the engine itself cannot be driven here. What can: that the article
// turns into lines, that the bar appears and says where it is, that the buttons
// are wired to the right thing, and that the bar shrinks the content rect
// instead of floating over a page that is drawn above it.
const contentHeight = () => page.evaluate(() => Math.round(
  document.getElementById('content').getBoundingClientRect().height));
results.contentBeforeSpeakBar = await contentHeight();
results.speakLines = await page.evaluate(async () => {
  const article = await VexReader.extract(VexTabStore.active().id);
  return VexSpeak.linesFor(article).length;
});
await page.evaluate(() => {
  // Stand where a successful read would leave it, without an engine.
  Object.assign(VexSpeak.state, {
    loaded: true, speaking: true, index: 1, base: 0,
    parts: ['A headline', 'One.', 'Two.', 'Three.'],
    title: 'A headline', url: VexTabStore.active().url
  });
  VexUI.renderSpeakBar();
});
await page.waitForTimeout(250);
results.speakBarShown = await page.isVisible('#speakbar');
results.speakBarLabel = await page.textContent('#speak-label');
results.speakBarIcon = await page.getAttribute('#speakbar use', 'href');
results.contentWithSpeakBar = await contentHeight();
await shot('12b-readaloud');

await tap('#speak-next');
results.speakSkipped = await page.evaluate(() => VexSpeak.state.index);
await tap('#speak-rate');
results.speakRate = await page.evaluate(() => VexStore.get('vex.speakRate', 1));
results.speakRateShown = await page.textContent('#speak-rate');
await tap('#speak-close');
results.speakBarGone = await page.evaluate(() => document.getElementById('speakbar').hidden);
results.contentAfterSpeakBar = await contentHeight();
// The menu offers it, and the voice picker opens from the same menu.
results.speakInMenu = await page.evaluate(() =>
  VexSheets.DEFAULT_ORDER.includes('read-aloud') && !!VexSheets.ACTIONS['read-aloud']);

// ── Translation, on the device ──────────────────────────────────────────────
// The page rewrite needs a native WebView to evaluate a script in, which this
// machine does not have. What it can drive is everything around it: the plugin
// calls, the panel, and the sentences the chrome says when it declines.
results.translateLanguages = await page.evaluate(async () => {
  const languages = await VexTranslate.languages();
  return languages.map(entry => entry.language + (entry.downloaded ? '*' : ''));
});
results.translateRound = await page.evaluate(async () => {
  const identified = await VexBridge.translateIdentify('Dies ist ein deutscher Satz mit Umlauten: schön.');
  await VexBridge.translateEnsureModel(identified, 'en', false);
  const texts = await VexBridge.translateTexts(identified, 'en', ['Guten Tag', '']);
  return { identified, texts };
});
// Without a page to evaluate in, it declines in words rather than throwing.
results.translateDeclines = await page.evaluate(() =>
  VexTranslate.page(VexTabStore.active(), 'en').then(result => result.why || 'ok'));
await page.evaluate(() => VexPanels.translation());
await page.waitForTimeout(400);
results.translationPanel = await page.textContent('#panel-title');
results.translationRows = await page.$$eval('#panel-body .sheet-row', rows => rows.length);
await shot('12d-translation');
await page.evaluate(() => VexPanels.close());

// ── Launcher shortcuts and the widget ───────────────────────────────────────
// The four targets the launcher and the widget both send. Each has to land
// somewhere in the chrome rather than being dropped on the floor.
results.shortcutTargets = await page.evaluate(async () => {
  const out = {};
  const before = VexTabStore.all().length;
  window.dispatchEvent(new CustomEvent('vexOpenText', { detail: { widget: 'new-tab' } }));
  await new Promise(resolve => setTimeout(resolve, 400));
  out.newTab = VexTabStore.all().length - before;
  const privateBefore = VexTabStore.private().length;
  window.dispatchEvent(new CustomEvent('vexOpenText', { detail: { widget: 'new-private-tab' } }));
  await new Promise(resolve => setTimeout(resolve, 400));
  out.private = VexTabStore.private().length - privateBefore;
  VexUI.closeOmnibox();
  // The scanner is raised before the camera is asked for, and this machine has
  // no camera, so look while the asking is still in flight.
  window.dispatchEvent(new CustomEvent('vexOpenText', { detail: { widget: 'scan' } }));
  out.scan = !document.getElementById('scan').hidden;
  await new Promise(resolve => setTimeout(resolve, 300));
  VexUI.closeScanner();
  return out;
});
// Shared text from another app still opens as a page.
results.sharedTextOpens = await page.evaluate(async () => {
  const before = VexTabStore.all().length;
  window.dispatchEvent(new CustomEvent('vexOpenText', { detail: { text: 'example.org' } }));
  await new Promise(resolve => setTimeout(resolve, 400));
  return VexTabStore.all().length > before;
});
await page.evaluate(async () => {
  // Back to one normal tab on example.com, which the rest of the walkthrough
  // assumes it is standing on.
  for (const tab of VexTabStore.all().slice(1)) await VexTabStore.close(tab.id);
  VexUI.closeOmnibox(); VexSheets.close(); VexPanels.close();
});
await page.waitForTimeout(300);

// ── Clearing browsing data ──────────────────────────────────────────────────
// What matters is that it clears what was ticked and nothing else, so the test
// is: tick one thing, clear, and see that the others were left alone.
results.clearDefaults = await page.evaluate(() => {
  const picked = VexClear.chosen();
  return [picked.cookies, picked.cache, picked.history, picked.recall, picked.saved, picked.tabs];
});
// Through Storage, which is how you get here, so Back has somewhere to go.
await page.evaluate(() => VexPanels.storage());
await page.waitForTimeout(300);
await page.evaluate(() => VexPanels.clearData());
await page.waitForTimeout(350);
results.clearPanelTitle = await page.textContent('#panel-title');
results.clearRows = await page.$$eval('#panel-body .sheet-row', rows => rows.length);
await shot('12c-clear');
results.clearCleared = await page.evaluate(async () => {
  // History only: the Recall index and the saved pages must survive it.
  await VexHistory.add({ url: 'https://cleared.example/', title: 'Gone' });
  const before = await VexHistory.stats();
  const done = await VexClear.run({ history: true });
  const after = await VexHistory.stats();
  return { done, visitsBefore: before.visits, visitsAfter: after.visits };
});
// Back from here steps up to Storage rather than closing the panel.
await page.evaluate(() => VexPanels.back());
await page.waitForTimeout(300);
results.clearBackGoesUp = await page.textContent('#panel-title');
await page.evaluate(() => VexPanels.close());

// ── Find, and the page layer's cover refcount ───────────────────────────────
await page.evaluate(() => VexUI.openFind());
await page.waitForTimeout(200);
results.findOpen = await page.isVisible('#findbar');
await page.evaluate(() => VexUI.closeFind());

// The omnibox offers to find what you typed on the page you are on, and tapping
// that row opens the find bar with the words already in it.
results.findRowOffered = await page.evaluate(async () => {
  VexUI.openOmnibox('');
  document.getElementById('omni-input').value = 'knot';
  await VexUI.renderSuggestions('knot');
  const rows = [...document.querySelectorAll('#omni-results .omni-row')];
  const found = rows.find(row => /Find .knot. on this page/.test(row.textContent));
  if (found) found.click();
  await new Promise(resolve => setTimeout(resolve, 250));
  // One string, because the expectations below compare with !==.
  return [!!found, !document.getElementById('findbar').hidden,
    document.getElementById('find-input').value].join(',');
});
await page.evaluate(() => { VexUI.closeFind(); VexUI.closeOmnibox(); });

await page.evaluate(async () => {
  await VexTabStore.activate(VexTabStore.normal()[0].id);
  VexUI.closeTabGrid(); VexSheets.close(); VexPanels.close(); VexUI.closeOmnibox(); VexViews.closeReader();
});
await page.waitForTimeout(250);
const layerVisible = () => page.evaluate(() => {
  const host = document.getElementById('fallback-webviews');
  return host ? host.style.display !== 'none' : null;
});
results.pageLayerVisibleAtRest = await layerVisible();
await page.evaluate(() => VexUI.openTabGrid());
await page.waitForTimeout(300);
results.pageLayerHiddenWithGrid = (await layerVisible()) === false;
await page.evaluate(() => VexUI.closeTabGrid());
await page.waitForTimeout(250);
results.pageLayerVisibleAfterGrid = await layerVisible();

// ── Android back walks the stack ────────────────────────────────────────────
await page.evaluate(() => VexPanels.settings());
await page.waitForTimeout(250);
await page.evaluate(() => VexPanels.appearance());
await page.waitForTimeout(250);
results.backToSettings = await page.evaluate(async () => {
  await VexUI.handleBack();
  return document.getElementById('panel-title').textContent;
});
results.backClosesPanel = await page.evaluate(async () => {
  await VexUI.handleBack();
  return document.getElementById('panel').hidden;
});

// ── Recall: find a page by what it said ─────────────────────────────────────
await page.evaluate(() => VexPanels.recall('shipwreck prosody'));
await page.waitForTimeout(500);
results.recallHits = await page.$$eval('#panel-body .list-row', rows => rows.length);
results.recallSnippet = (await page.$$eval('#panel-body .recall-snippet', nodes => nodes.map(n => n.textContent)))[0] || '';
await shot('13-recall');

// ── Reading list ────────────────────────────────────────────────────────────
await page.evaluate(() => VexPanels.readingList());
await page.waitForTimeout(300);
results.readingRows = await page.$$eval('#panel-body .list-row', rows => rows.length);

// ── Bookmarks in folders, and the export ────────────────────────────────────
await page.evaluate(async () => {
  await VexCollections.bookmarks.addFolder('Work');
  const claude = VexCollections.bookmarks.get('https://claude.ai/');
  await VexCollections.bookmarks.move(claude.id, 'Work');
  VexPanels.bookmarks();
});
await page.waitForTimeout(300);
results.bookmarkFolders = await page.$$eval('#panel-body .list-head', heads => heads.map(h => h.textContent));
results.bookmarkExport = await page.evaluate(() => VexCollections.bookmarks.exportHtml().includes('claude.ai'));
results.bookmarkImport = await page.evaluate(async () => {
  const added = await VexCollections.bookmarks.importHtml(
    '<DL><DT><H3>Imported</H3><DL><DT><A HREF="https://example.net/a">A page</A></DL></DL>');
  return added;
});
await shot('14-bookmarks');

// ── Sessions ────────────────────────────────────────────────────────────────
results.sessionSaved = await page.evaluate(async () => {
  const session = await VexCollections.sessions.save('Test session', VexTabStore.normal());
  // The desktop's own shape, so a phone session opens on the PC.
  return !!(session.id && session.createdAt && Array.isArray(session.tabs) && session.tabs[0].partition);
});

// ── Passwords and 2FA ───────────────────────────────────────────────────────
results.totpMatchesRfc = await page.evaluate(async () =>
  (await VexVault.totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { digits: 8, at: 59000 })) === '94287082');
results.otpAuthParsed = await page.evaluate(() => {
  const parsed = VexVault.parseOtpAuth('otpauth://totp/GitHub:me?secret=JBSWY3DPEHPK3PXP&issuer=GitHub');
  return parsed && parsed.issuer === 'GitHub' && parsed.secret === 'JBSWY3DPEHPK3PXP';
});
results.loginSaved = await page.evaluate(async () => {
  await VexVault.unlock();
  await VexVault.save({ host: 'example.com', username: 'me@example.com', password: 'hunter2', secret: 'JBSWY3DPEHPK3PXP' });
  return VexVault.hasFor('example.com') && VexVault.forHost('example.com').length === 1;
});
await page.evaluate(() => VexPanels.passwords());
await page.waitForTimeout(600);
results.passwordRows = await page.$$eval('#panel-body .list-row', rows => rows.length);
results.totpShown = /^\d{6}$/.test((await page.textContent('#panel-body .totp-code')) || '');
await shot('15-passwords');

// ── Sync: the record merge is the desktop's own file ────────────────────────
results.syncMerge = await page.evaluate(() => {
  const records = window.VexSyncRecords;
  const phone = records.capture(records.empty(), records.flatten({ 'preference:vex.bookmarks': [{ id: 'a', url: 'https://a' }] }), 'phone');
  const pc = records.capture(records.empty(), records.flatten({ 'preference:vex.bookmarks': [{ id: 'b', url: 'https://b' }] }), 'pc');
  const merged = records.unflatten(records.values(records.merge(phone, pc)));
  return merged['preference:vex.bookmarks'].map(entry => entry.id).join(',');
});
results.syncRoundTrip = await page.evaluate(async () => {
  const key = await SyncCrypto.generateKey();
  const blob = await SyncCrypto.encrypt({ hello: 'world' }, key);
  const back = await SyncCrypto.decrypt(blob, key);
  return back.hello === 'world';
});
await page.evaluate(() => VexPanels.sync());
await page.waitForTimeout(300);
results.syncPanelFields = await page.$$eval('#panel-body .field', fields => fields.length);
await shot('16-sync');

// ── Site permissions ────────────────────────────────────────────────────────
results.permissionStored = await page.evaluate(async () => {
  await VexPermissions.set('example.com', 'camera', 'allow');
  await VexPermissions.set('example.com', 'location', 'block');
  return VexPermissions.describe('example.com');
});
await page.evaluate(() => VexPanels.permissions());
await page.waitForTimeout(250);
results.permissionRows = await page.$$eval('#panel-body .list-row', rows => rows.length);

// ── The menu, rearranged ────────────────────────────────────────────────────
await page.evaluate(() => VexPanels.menuEditor());
await page.waitForTimeout(300);
results.menuEditorRows = await page.$$eval('#panel-body .list-row', rows => rows.length);
results.menuHides = await page.evaluate(async () => {
  await VexStore.set('vex.menuHidden', ['print', 'capture']);
  VexSheets.menu();
  const rows = document.querySelectorAll('#sheet-list .sheet-row').length;
  VexSheets.close();
  return rows;
});
await shot('17-menu-editor');

// ── Quick access ────────────────────────────────────────────────────────────
results.quickPinned = await page.evaluate(async () => {
  await VexCollections.quick.add({ url: 'https://news.ycombinator.com/', title: 'Hacker News' });
  VexStart.render();
  return document.querySelectorAll('#start-tiles .tile').length;
});

// ── Toolbar at the top ──────────────────────────────────────────────────────
results.toolbarTop = await page.evaluate(async () => {
  await VexStore.set('vex.toolbarPosition', 'top');
  VexUI.applyToolbarPosition();
  return document.body.dataset.toolbar;
});
await page.waitForTimeout(200);
await shot('18-toolbar-top');
results.toolbarAboveContent = await page.evaluate(() => {
  const toolbar = document.getElementById('toolbar').getBoundingClientRect();
  const content = document.getElementById('content').getBoundingClientRect();
  return toolbar.top < content.top;
});
await page.evaluate(async () => {
  await VexStore.set('vex.toolbarPosition', 'bottom');
  VexUI.applyToolbarPosition();
});

// ── The toolbar hides while you scroll ──────────────────────────────────────
results.toolbarHides = await page.evaluate(() => {
  VexUI.onPageScroll({ dy: 120, y: 400, atTop: false });
  return document.body.classList.contains('toolbar-hidden');
});
results.toolbarReturns = await page.evaluate(() => {
  VexUI.onPageScroll({ dy: -120, y: 100, atTop: false });
  return !document.body.classList.contains('toolbar-hidden');
});

// ── QR: drawing one, and reading an otpauth code ────────────────────────────
results.qrDrawn = await page.evaluate(() => {
  const canvas = VexTools.drawQr('https://example.com/a-page', 240);
  return !!(canvas && canvas.width > 40);
});
await page.evaluate(() => VexUI.showQr('https://example.com/a-page', 'Example'));
await page.waitForTimeout(250);
results.qrVisible = await page.isVisible('#qrshare');
await shot('19-qr');
await page.evaluate(() => VexUI.closeQr());

// ── Dialogs ─────────────────────────────────────────────────────────────────
results.promptReturns = await page.evaluate(async () => {
  const pending = VexUI.prompt('A name', 'What shall we call it?', 'Draft');
  await new Promise(resolve => setTimeout(resolve, 120));
  document.getElementById('dialog-input').value = 'Named';
  document.getElementById('dialog-ok').click();
  return pending;
});
results.confirmCancels = await page.evaluate(async () => {
  const pending = VexUI.confirm('Sure?');
  await new Promise(resolve => setTimeout(resolve, 120));
  document.getElementById('dialog-cancel').click();
  return pending;
});

// ── Saved pages ─────────────────────────────────────────────────────────────
results.pageSaved = await page.evaluate(async () => {
  window.VexBridge.evaluate = async () => ({ result: JSON.stringify('<html><body>' + 'x'.repeat(400) + '</body></html>') });
  const tab = VexTabStore.active();
  VexTabStore.update(tab.id, { url: 'https://example.com/story', title: 'A story' });
  const saved = await VexTools.savePage(VexTabStore.active());
  const all = await VexTools.savedPages();
  return !!saved && all.length === 1;
});

// ── Toolbar buttons are yours to choose ─────────────────────────────────────
results.toolbarButtonsChosen = await page.evaluate(async () => {
  await VexStore.set('vex.toolbarButtons', { left: ['back', 'forward', 'home'], right: ['tabs', 'menu'] });
  VexUI.renderToolbar();
  return document.querySelectorAll('#tb-left .tb-btn').length + ':' + document.querySelectorAll('#tb-right .tb-btn').length;
});
await shot('20-toolbar-buttons');
await page.evaluate(async () => { await VexStore.set('vex.toolbarButtons', null); VexUI.renderToolbar(); });

// ── Page presentation: forced zoom, contrast, night shade ───────────────────
results.presentationScript = await page.evaluate(async () => {
  await VexStore.set('vex.forceZoom', true);
  await VexStore.set('vex.pageContrast', 1.3);
  await VexStore.set('vex.nightShade', 0.35);
  const script = VexSiteRules.presentationScript();
  return script.includes('user-scalable=yes') && script.includes('contrast(1.3)') && script.includes('sepia(0.35)');
});
results.presentationEmptyWhenOff = await page.evaluate(async () => {
  await VexStore.set('vex.forceZoom', false);
  await VexStore.set('vex.pageContrast', 1);
  await VexStore.set('vex.nightShade', 0);
  return VexSiteRules.presentationScript() === '';
});

// ── Details autofill ────────────────────────────────────────────────────────
results.profileSaved = await page.evaluate(async () => {
  await VexVault.saveProfile({ name: 'A Person', email: 'a@example.com', phone: '', city: 'Ankara' });
  const profile = VexVault.profile();
  return VexVault.hasProfile() && profile.name === 'A Person' && profile.phone === undefined;
});

// ── Pop-ups ─────────────────────────────────────────────────────────────────
results.popupBlocked = await page.evaluate(async () => {
  await VexStore.set('vex.blockPopups', true);
  const before = VexTabStore.all().length;
  window.__vexEmit('newTab', { url: 'https://ads.example/popup', background: true });
  await new Promise(resolve => setTimeout(resolve, 200));
  return VexTabStore.all().length === before;
});
results.popupToast = await page.$$eval('.toast', toasts => toasts.some(t => t.textContent.includes('Blocked a pop-up')));

// ── The blocking dashboard ──────────────────────────────────────────────────
results.blockedByHost = await page.evaluate(async () => {
  await VexBlock.count('news.example', 12);
  await VexBlock.count('shop.example', 40);
  return VexBlock.worstSites(2).map(site => site.host + ':' + site.count).join(',');
});

// ── The agent ───────────────────────────────────────────────────────────────
results.agentParses = await page.evaluate(() => {
  const call = VexAgent.parseCall('Here you go:\n{"thought":"close them","tool":"close_tabs","parameters":{"match":"youtube"},"intent":"action"}');
  return call && call.tool === 'close_tabs' && call.parameters.match === 'youtube';
});
results.agentRefusesJunk = await page.evaluate(() => VexAgent.parseCall('I cannot do that') === null);
results.agentClosesTabs = await page.evaluate(async () => {
  await VexTabStore.create('https://www.youtube.com/watch?v=1', { background: true });
  await VexTabStore.create('https://www.youtube.com/watch?v=2', { background: true });
  const before = VexTabStore.all().length;
  // Drive one tool directly: the loop itself needs a worker, the tools do not.
  let worker = null;
  window.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    worker = body;
    return {
      ok: true,
      json: async () => ({ result: body.lastToolResult
        ? { thought: 'done', tool: 'finish', parameters: { summary: 'Closed them' }, intent: 'safe' }
        : { thought: 'close the youtube tabs', tool: 'close_tabs', parameters: { match: 'youtube' }, intent: 'action' } })
    };
  };
  const outcome = await VexAgent.pursue('close every youtube tab');
  return {
    summary: outcome.summary,
    closed: before - VexTabStore.all().length,
    sentTools: Array.isArray(worker.availableTools) && worker.availableTools.some(tool => tool.name === 'close_tabs'),
    action: worker.action
  };
});
await page.evaluate(() => VexViews.openAI('agent'));
await page.waitForTimeout(300);
results.agentPanel = await page.textContent('#panel-title');
await shot('21-agent');

// ── Notes, from a selection ─────────────────────────────────────────────────
results.noteKept = await page.evaluate(async () => {
  window.__vexEmit('selection', {
    id: VexTabStore.activeId(), action: 'note',
    text: 'The halyard parted at the masthead.'
  });
  await new Promise(resolve => setTimeout(resolve, 300));
  const notes = await VexNotes.all();
  return notes.length === 1 && notes[0].kind === 'quote' && notes[0].text.includes('halyard');
});
await page.evaluate(() => VexPanels.notes());
await page.waitForTimeout(300);
results.notesPanelRows = await page.$$eval('#panel-body .list-row', rows => rows.length);

// ── Reminders ───────────────────────────────────────────────────────────────
results.reminderScheduled = await page.evaluate(async () => {
  const at = Date.now() + 3600000;
  const entry = await VexRemind.add({ url: 'https://example.com/later', title: 'Later', note: 'read this', at });
  return !!entry && VexRemind.pending().length === 1 && VexRemind.describe(at).length > 3;
});
results.reminderRemoved = await page.evaluate(async () => {
  const entry = VexRemind.pending()[0];
  await VexRemind.remove(entry.id);
  return VexRemind.pending().length === 0;
});
results.reminderDropsPast = await page.evaluate(async () => {
  await VexStore.set('vex.reminders', [{ id: 'old', url: 'https://a', at: Date.now() - 1000 }]);
  await VexRemind.rearm();
  return VexRemind.all().length === 0;
});

// ── The library ─────────────────────────────────────────────────────────────
await page.evaluate(() => VexPanels.library());
await page.waitForTimeout(300);
results.libraryRows = await page.$$eval('#panel-body .sheet-row', rows => rows.length);
results.libraryShelves = await page.$$eval('#panel-body .list-head', heads => heads.length);
await shot('22-library');
results.librarySearch = await page.evaluate(() => VexLibrary.search('offline').map(entry => entry.id));
results.libraryOpens = await page.evaluate(() => {
  // Every entry has to point at something that exists.
  return VexLibrary.flat().every(entry => typeof entry.run === 'function' && entry.name && entry.description);
});

// Tapping one has to do what it says. "Rules for one site" opens a sheet, and
// the row used to close it again in the same tap; "Site permissions" opens a
// panel, and Back from it should come back to the library, not the page.
results.libraryRuns = await page.evaluate(async () => {
  const tap = async name => {
    const row = [...document.querySelectorAll('#panel-body .sheet-row')]
      .find(node => node.textContent.startsWith(name));
    row.click();
    await new Promise(resolve => setTimeout(resolve, 300));
  };
  VexPanels.library();
  await new Promise(resolve => setTimeout(resolve, 200));
  await tap('Rules for one site');
  const sheetStayed = VexSheets.isOpen();
  VexSheets.close();

  VexPanels.library();
  await new Promise(resolve => setTimeout(resolve, 200));
  await tap('Site permissions');
  const opened = document.getElementById('panel-title').textContent;
  VexPanels.back();
  await new Promise(resolve => setTimeout(resolve, 200));
  const backTo = document.getElementById('panel-title').textContent;
  VexPanels.close();
  return [sheetStayed, opened, backTo].join(' | ');
});

// ── Downloads follow the queue ──────────────────────────────────────────────
// The bar has to move while you watch, and a finished one has to stop being a
// progress bar. The queue is faked: 30 of 100 bytes, then all of it.
results.downloadsLive = await page.evaluate(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const real = VexBridge.downloadStatus;
  let queue = [{ id: 41, url: 'https://files.example/a.zip', status: 2, downloaded: 30, total: 100, localUri: '' }];
  VexBridge.downloadStatus = async () => ({ downloads: queue });
  await VexDB.clear('downloads');
  await VexDB.add('downloads', { url: 'https://files.example/a.zip', filename: 'a.zip', size: 0, at: Date.now(), downloadId: '41' });
  VexPanels.downloads();
  await wait(300);
  const before = document.querySelector('#panel-body .progress-row i').style.width;
  queue = [{ ...queue[0], downloaded: 70 }];
  await wait(1200);
  const during = document.querySelector('#panel-body .progress-row i').style.width;
  queue = [{ ...queue[0], status: 8, downloaded: 100 }];
  await wait(1200);
  const after = document.querySelectorAll('#panel-body .progress-row').length;
  VexPanels.close();
  VexBridge.downloadStatus = real;
  await VexDB.clear('downloads');
  return [before, during, after].join(' ');
});

// Save on "Add a login" goes back to Passwords; Back from there has to step
// up past it, not into the form that was just saved.
results.addLoginBack = await page.evaluate(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  VexPanels.settings();
  await wait(200);
  await VexPanels.passwords();
  await VexPanels.addLogin();
  document.getElementById('login-host').value = 'back.example';
  [...document.querySelectorAll('#panel-body .pill-btn')].find(node => node.textContent === 'Save').click();
  await wait(300);
  const saved = document.getElementById('panel-title').textContent;
  VexPanels.back();
  await wait(300);
  const backTo = document.getElementById('panel-title').textContent;
  VexPanels.close();
  return saved + ' | ' + backTo;
});

// A panel drawn again in place keeps its place: change something at the
// bottom of Appearance and you are still at the bottom.
results.panelKeepsPlace = await page.evaluate(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  VexPanels.appearance();
  await wait(150);
  const body = document.getElementById('panel-body');
  body.scrollTop = 300;
  const before = body.scrollTop;
  VexPanels.appearance();
  await wait(250);
  const after = body.scrollTop;
  VexPanels.close();
  return before > 0 && Math.abs(after - before) <= 1;
});

// History is pruned by its index, and "Never" means never.
results.historyPrune = await page.evaluate(async () => {
  const day = 86400000;
  const old = { url: 'https://prune.example/old', title: 'old', host: 'prune.example', at: Date.now() - 400 * day };
  const ancient = { url: 'https://prune.example/ancient', title: 'ancient', host: 'prune.example', at: Date.now() - 2000 * day };
  const fresh = { url: 'https://prune.example/fresh', title: 'fresh', host: 'prune.example', at: Date.now() - day };
  for (const row of [old, ancient, fresh]) await VexDB.add('history', row);
  const kept = await VexDB.prune({ historyDays: VexDB.NEVER });
  const removed = await VexDB.prune({ historyDays: 365 });
  const left = (await VexDB.scan('history', { limit: 5000 })).filter(row => row.host === 'prune.example').map(row => row.title);
  await VexDB.deleteWhere('history', row => row.host === 'prune.example');
  return kept + ' ' + removed + ' ' + left.join(',');
});

// Back with no history left: a tab you kept stays, a tab a page opened goes
// back to that page, and a link another app sent is closed on the way out.
results.backOutOfHistory = await page.evaluate(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  for (const tab of VexTabStore.all()) await VexTabStore.close(tab.id);
  const kept = await VexTabStore.create('https://kept.example/');
  const other = await VexTabStore.create('https://other.example/');
  await wait(100);
  VexTabStore.update(other.id, { canGoBack: false });
  const leaves = await VexUI.handleBack();                 // false: minimise, close nothing
  const stillTwo = VexTabStore.all().length;

  const child = await VexTabStore.create('https://child.example/', { opener: kept.id });
  await wait(100);
  VexTabStore.update(child.id, { canGoBack: false });
  await VexUI.handleBack();
  const backTo = VexTabStore.activeId() === kept.id && !VexTabStore.get(child.id);

  const sent = await VexTabStore.create('https://sent.example/', { fromApp: true });
  await wait(100);
  VexTabStore.update(sent.id, { canGoBack: false });
  const handed = await VexUI.handleBack();
  const sentGone = !VexTabStore.get(sent.id);
  return [leaves, stillTwo, backTo, handed, sentGone].join(' ');
});

// ── Saving a video ──────────────────────────────────────────────────────────
// A plain file goes to the download queue; a player built on a blob: URL is
// found through the playlist its page requested, saved as a stream job whose
// progress and finish the downloads list follows.
results.videoDownload = await page.evaluate(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const realEvaluate = VexBridge.evaluate;
  const realStream = VexBridge.mediaStream;
  await VexDB.clear('downloads');
  for (const tab of VexTabStore.all()) await VexTabStore.close(tab.id);
  const tab = await VexTabStore.create('https://clips.example/watch');
  VexTabStore.update(tab.id, { url: 'https://clips.example/watch', title: 'Clip' });

  let page = { found: true, src: 'https://cdn.example/clip.webm?sig=1', sources: [], title: 'A clip: the / one' };
  VexBridge.evaluate = async () => ({ result: JSON.stringify(page) });
  const file = await VexMedia.download(VexTabStore.get(tab.id));

  page = { found: true, src: 'blob:https://clips.example/1234', sources: [], title: 'Streamed' };
  VexBridge.mediaStream = async () => 'https://cdn.example/master.m3u8';
  const stream = await VexMedia.download(VexTabStore.get(tab.id));
  VexBridge.emitNative('streamProgress', { jobId: stream.streamJob, done: 30, total: 120, bytes: 3 << 20 });
  VexPanels.downloads();
  await wait(300);
  const during = [...document.querySelectorAll('#panel-body .list-row .u')].map(node => node.textContent)
    .find(text => text.includes('pieces')) || '';
  VexBridge.emitNative('streamDone', { jobId: stream.streamJob, localUri: 'content://media/1', bytes: 12 << 20 });
  await wait(1300);
  const rows = await VexDB.scan('downloads', { limit: 10 });
  const done = rows.find(row => row.streamJob === stream.streamJob);

  page = { found: true, src: 'blob:https://tube.example/9', sources: [], title: 'Locked' };
  VexBridge.mediaStream = async () => '';
  const none = await VexMedia.download(VexTabStore.get(tab.id));

  VexPanels.close();
  VexBridge.evaluate = realEvaluate;
  VexBridge.mediaStream = realStream;
  await VexDB.clear('downloads');
  return [
    file && file.filename, !!(file && file.downloadId),
    stream && stream.filename, during.includes('30 of 120 pieces'),
    !!(done && done.streamDone && done.localUri === 'content://media/1'),
    none === null
  ].join(' | ');
});

console.log(JSON.stringify(results, null, 2));
await browser.close();

const expected = {
  welcomeShown: true, welcomeSteps: 4, welcomeDismissed: true, welcomeRemembered: true,
  startTiles: 4, startRail: 4,
  omniOpen: true, suggestions: 5, suggestionHighlight: 4,
  engineSuggestions: 3, suggestFillArrows: 4, suggestFills: 'mdn meaning',
  suggestNotWhenPrivate: 0,
  urlPill: 'example.com', startHidden: true,
  menuQuick: 4,
  siteSheetOpened: true, scriptsOff: true,
  readerOpen: true, readerTitle: 'The Wreck of the Deutschland', readerSize: 21,
  chatBubbles: 2, chatFollowUps: 1,
  themeCards: 9, themeStored: 'midnight', themeApplied: 'midnight', skinTexture: true,
  shieldScript: true, shieldOffEmpty: true,
  tabCards: 3, tabSearchCards: 1,
  privateBodyClass: true, historyUnchanged: true,
  findOpen: true,
  pageLayerVisibleAtRest: true, pageLayerHiddenWithGrid: true, pageLayerVisibleAfterGrid: true,
  backToSettings: 'Settings', backClosesPanel: true,
  recallHits: 1, readingRows: 1, bookmarkExport: true, bookmarkImport: 1,
  sessionSaved: true, totpMatchesRfc: true, otpAuthParsed: true, loginSaved: true,
  passwordRows: 1, totpShown: true,
  syncMerge: 'a,b', syncRoundTrip: true,
  permissionStored: 'camera allowed · location blocked', permissionRows: 1,
  quickPinned: 1, toolbarTop: 'top', toolbarAboveContent: true,
  toolbarHides: true, toolbarReturns: true, qrDrawn: true, qrVisible: true,
  promptReturns: 'Named', confirmCancels: false, pageSaved: true,
  toolbarButtonsChosen: '3:2', presentationScript: true, presentationEmptyWhenOff: true,
  profileSaved: true, popupBlocked: true, popupToast: true,
  blockedByHost: 'shop.example:40,news.example:12',
  agentParses: true, agentRefusesJunk: true, agentPanel: 'Let it do things',
  noteKept: true, notesPanelRows: 1,
  reminderScheduled: true, reminderRemoved: true, reminderDropsPast: true,
  libraryOpens: true,
  downloadsLive: '30% 70% 0',
  privateLockEverywhere: 'true true false true',
  videoDownload: 'A clip the one.webm | true | Streamed | true | true | true',
  backOutOfHistory: 'false 2 true false true',
  panelKeepsPlace: true, historyPrune: '0 2 fresh', localAiPanelFollows: true,
  addLoginBack: 'Passwords and 2FA | Settings',
  speakBarShown: true,
  speakBarGone: true,
  speakInMenu: true,
  speakBarIcon: '#i-pause',
  speakBarLabel: '2 / 4',
  speakSkipped: 2,
  speakRate: 1.25,
  speakRateShown: '1.25×',
  sharedTextOpens: true,
  undoPrivate: true,
  privateRelocks: 'true,true,true,2',
  bookmarkUndo: 'true,true,true',
  libraryRuns: 'true | Site permissions | Everything Vex can do',
  findRowOffered: 'true,true,knot',
  readerLookDefault: '-,-,-,-',
  readerLook: 'serif,paper',
  readerLookRows: 4,
  readerProgress: '100%',
  translationPanel: 'Translation',
  translateDeclines: 'There is no text on this page to translate',
  clearPanelTitle: 'Clear browsing data',
  clearBackGoesUp: 'Storage',
  widgetOpensOmnibox: true, widgetDictates: true,
  tabBarOnPhone: true, tabBarOnTablet: true, tabBarChips: 1, tabBarActive: 1,
  tabBarGoesAway: true,
  localAiHonest: true, localAiRoutesNothing: false, localAiNeverAgent: false,
  localAiPrompt: true, localAiImported: true, localAiLoads: true,
  localAiHandlesNow: true, localAiStreamed: true,
  chatOnDeviceTag: true, chatOnDeviceAnswer: true,
  polishSheet: 5, polishOffersGrammar: true,
  pdfOpens: true, pdfNames: true, pdfBackCloses: true, pdfRendered: 1, pdfCounts: '1 / 1',
  backupSaysWhatItCannot: true, backupCounts: true, backupSealed: true, backupOpens: true,
  diagnosticsWebView: true, diagnosticsFeatures: true, diagnosticsShowsProblem: true,
  diagnosticsText: true, diagnosticsRedacts: true
};

const failures = [];
for (const [key, want] of Object.entries(expected)) {
  if (results[key] !== want) failures.push(key + ': expected ' + JSON.stringify(want) + ', got ' + JSON.stringify(results[key]));
}
if (!String(results.chatAnswer).includes('shipwreck')) failures.push('chatAnswer: the worker reply did not reach the log');
if (results.siteRows < 8) failures.push('siteRows: the site sheet is missing rules');
if (results.menuRows < 20) failures.push('menuRows: the menu lost entries (' + results.menuRows + ')');
if (String(results.clearDefaults) !== 'true,true,true,false,false,false') {
  failures.push('clearDefaults: the tick boxes do not start where they should (' + results.clearDefaults + ')');
}
if (results.clearRows < 9) failures.push('clearRows: the clear panel lost rows (' + results.clearRows + ')');
if (results.tabCount.onNormal !== results.tabCount.normals
  || results.tabCount.onPrivate !== results.tabCount.privates
  || results.tabCount.onNormal === results.tabCount.onPrivate) {
  failures.push('tabCount: showed ' + results.tabCount.onNormal + ' with ' + results.tabCount.normals
    + ' normal tabs, and ' + results.tabCount.onPrivate + ' with ' + results.tabCount.privates + ' private');
}
if (results.videoSheet.rows !== 5) {
  failures.push('videoSheet: expected five rows, got ' + results.videoSheet.rows);
}
if (results.videoSheet.told !== 'speed=1.5 mute=true') {
  failures.push('videoSheet: the page was told "' + results.videoSheet.told + '"');
}
if (results.errorPage.title !== 'This site could not be found') {
  failures.push('errorPage: the wrong words for -2 (' + results.errorPage.title + ')');
}
for (const key of ['offersSaved', 'offersSearch', 'noScript', 'drawn']) {
  if (results.errorPage[key] !== true) failures.push('errorPage: ' + key + ' was ' + results.errorPage[key]);
}
if (!results.errorEscapes.includes('it said &lt;b&gt;no&lt;/b&gt;')) {
  failures.push('errorEscapes: the description was not escaped exactly once');
}
if (!/duckduckgo|missing\.example/.test(results.errorCommand)) {
  failures.push('errorCommand: "search for it instead" went to ' + results.errorCommand);
}
if (results.permissionDecides.answered !== 'p1: p2:microphone p3:location') {
  failures.push('permissionDecides: the answers were ' + results.permissionDecides.answered);
}
if (!/new\.example wants to use your location/.test(results.permissionDecides.asked || '')) {
  failures.push('permissionDecides: it did not ask (' + results.permissionDecides.asked + ')');
}
if (results.permissionDecides.remembered !== 'allow') {
  failures.push('permissionDecides: the answer was not remembered ('
    + results.permissionDecides.remembered + ')');
}
if (results.uiScale.before.scale !== '1' || results.uiScale.after.scale !== '1.4'
  || results.uiScale.back !== '1') {
  failures.push('uiScale: the multiplier did not move (' + JSON.stringify(results.uiScale) + ')');
}
if (!(results.uiScale.after.height > results.uiScale.before.height)) {
  failures.push('uiScale: the toolbar did not grow with it ('
    + results.uiScale.before.height + ' → ' + results.uiScale.after.height + ')');
}
if (!results.undoClose.offered) failures.push('undoClose: closing a tab did not offer Undo');
if (!results.undoClose.back || results.undoClose.url !== 'https://undo.example/') {
  failures.push('undoClose: Undo did not bring the tab back (' + JSON.stringify(results.undoClose) + ')');
}
// Exactly one call each way, and in that order: a flag asked for twice is a
// flag somebody will forget to clear.
if (String(results.screenshotsBlockedOnPrivateSide) !== 'true') {
  failures.push('screenshotsBlockedOnPrivateSide: expected one true, got ['
    + results.screenshotsBlockedOnPrivateSide + ']');
}
if (String(results.screenshotsAllowedAgain) !== 'true,false') {
  failures.push('screenshotsAllowedAgain: expected it to be cleared once, got ['
    + results.screenshotsAllowedAgain + ']');
}
if (String(results.translateLanguages).indexOf('en*') !== 0) {
  failures.push('translateLanguages: English should be there already (' + results.translateLanguages + ')');
}
if (results.translateRound.identified !== 'tr') {
  failures.push('translateRound: the stand-in should call that not-English ('
    + results.translateRound.identified + ')');
}
if (String(results.translateRound.texts) !== '[en] Guten Tag,') {
  failures.push('translateRound: a string came back wrong (' + JSON.stringify(results.translateRound.texts) + ')');
}
if (results.translationRows < 3) {
  failures.push('translationRows: the translation panel lost rows (' + results.translationRows + ')');
}
if (results.shortcutTargets.newTab !== 1) {
  failures.push('shortcutTargets: "new tab" opened ' + results.shortcutTargets.newTab + ' tabs');
}
if (results.shortcutTargets.private !== 1) {
  failures.push('shortcutTargets: "new private tab" left ' + results.shortcutTargets.private + ' private tabs');
}
if (results.shortcutTargets.scan !== true) failures.push('shortcutTargets: "scan" did not open the scanner');
if (String(results.clearCleared.done) !== 'history') {
  failures.push('clearCleared: asking for history cleared ' + results.clearCleared.done);
}
if (!(results.clearCleared.visitsAfter < results.clearCleared.visitsBefore)) {
  failures.push('clearCleared: history was not cleared (' + results.clearCleared.visitsBefore
    + ' → ' + results.clearCleared.visitsAfter + ')');
}
if (!(results.speakLines > 2)) failures.push('speakLines: the article did not turn into lines to read ('
  + results.speakLines + ')');
// The bar is a flex item precisely so the page moves up to make room for it.
if (!(results.contentWithSpeakBar < results.contentBeforeSpeakBar)) {
  failures.push('contentWithSpeakBar: the speak bar did not shrink the content rect ('
    + results.contentBeforeSpeakBar + ' → ' + results.contentWithSpeakBar + ')');
}
if (results.contentAfterSpeakBar !== results.contentBeforeSpeakBar) {
  failures.push('contentAfterSpeakBar: closing the speak bar did not give the page its height back ('
    + results.contentBeforeSpeakBar + ' → ' + results.contentAfterSpeakBar + ')');
}
if (results.linkSheetRows < 6) failures.push('linkSheetRows: the long-press menu lost entries');
if (results.privacyRows < 6) failures.push('privacyRows: the privacy panel is missing rows');
if (results.readerParas < 2) failures.push('readerParas: the reader rendered no body');
if (!String(results.ruleDescribed).includes('JavaScript off')) failures.push('ruleDescribed: ' + results.ruleDescribed);
if (!String(results.recallSnippet).toLowerCase().includes('shipwreck')) failures.push('recallSnippet: ' + results.recallSnippet);
if (!(results.bookmarkFolders || []).includes('Work')) failures.push('bookmarkFolders: ' + JSON.stringify(results.bookmarkFolders));
if (results.menuEditorRows < 20) failures.push('menuEditorRows: ' + results.menuEditorRows);
if (results.syncPanelFields < 2) failures.push('syncPanelFields: the sync panel did not render its fields');
if (!(results.menuHides < results.menuRows)) failures.push('menuHides: hiding entries did not shorten the menu');
if (!results.agentClosesTabs || results.agentClosesTabs.closed !== 2) {
  failures.push('agentClosesTabs: ' + JSON.stringify(results.agentClosesTabs));
}
if (results.agentClosesTabs && results.agentClosesTabs.action !== 'agent') failures.push('the agent did not use the agent action');
if (results.agentClosesTabs && !results.agentClosesTabs.sentTools) failures.push('the agent did not send its tool list');
if (results.libraryRows < 25) failures.push('libraryRows: ' + results.libraryRows);
if (results.localAiRows < 4) failures.push('localAiRows: the on-device panel is missing rows ('
  + results.localAiRows + ')');
if (results.diagnosticsRows < 6) failures.push('diagnosticsRows: ' + results.diagnosticsRows);
if (results.libraryShelves < 5) failures.push('libraryShelves: ' + results.libraryShelves);
if (!(results.librarySearch || []).includes('saved')) failures.push('librarySearch: ' + JSON.stringify(results.librarySearch));
if (!String(results.privateEmptyCopy).startsWith('No private tabs')) failures.push('privateEmptyCopy: ' + results.privateEmptyCopy);
failures.push(...errors);

server.close();

if (failures.length) {
  for (const failure of failures) console.error('FAIL ' + failure);
  process.exit(1);
}
console.log('ok — mobile chrome smoke passed (' + Object.keys(expected).length + ' expectations)');
