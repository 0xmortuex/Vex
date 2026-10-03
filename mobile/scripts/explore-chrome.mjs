// A day with Vex, by tapping.
//
// smoke-chrome.mjs checks named paths; this one uses the chrome the way a
// person does and reports what goes wrong, without knowing in advance what
// should happen. Two halves:
//
//   1. Daily scenarios, by touch: read an article, bookmark it, find a word,
//      shop, sign in, juggle tabs, ask the assistant, let it do something,
//      every AI Lab feature.
//   2. A crawl: every row of the menu, and every row of every settings page
//      two levels down, each tapped from a clean state.
//
// Findings: page errors and console errors (with the step that caused them),
// taps that changed nothing, pages wider than the phone, and "undefined",
// "NaN", "[object Object]" or "null" shown to the person.
//
// The pages it browses are served from scripts/fixtures on the same origin,
// so the iframe fallback can run page scripts in them as a WebView would.
//
//   node scripts/explore-chrome.mjs [--shots <dir>] [--json <file>]

import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const wwwDir = path.join(here, '..', 'www');
const fixtureDir = path.join(here, 'fixtures');
const arg = name => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : null; };
const shotDir = arg('--shots');
const jsonOut = arg('--json');
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.txt': 'text/plain'
};
const server = http.createServer((request, response) => {
  const asked = decodeURIComponent((request.url || '/').split('?')[0]);
  const fixture = asked.startsWith('/fixtures/');
  const root = fixture ? fixtureDir : wwwDir;
  const file = path.join(root, fixture ? asked.slice('/fixtures/'.length) : (asked === '/' ? 'index.html' : asked));
  if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
  fs.readFile(file, (error, body) => {
    if (error) { response.writeHead(404, { 'Content-Type': 'text/html' }).end('<title>Not found</title><h1>404</h1>'); return; }
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    response.end(body);
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const site = name => origin + '/fixtures/' + name;

const prebuilt = '/opt/pw-browsers/chromium';
const executablePath = process.env.CHROMIUM_PATH
  || (fs.existsSync(prebuilt) && fs.statSync(prebuilt).isFile() ? prebuilt : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const context = await browser.newContext({ ...devices['Pixel 7'] });
await context.route('**', route => {
  const url = route.request().url();
  if (url.startsWith(origin) || /^(file|data|blob):/.test(url)) return route.continue();
  return route.abort();
});
const page = await context.newPage();

// ── Findings ────────────────────────────────────────────────────────────────
const findings = [];
const walked = [];
let current = 'boot';
const found = (what, where = current) => {
  const key = where + ' | ' + what;
  if (!findings.some(item => item.key === key)) findings.push({ key, where, what });
};
page.on('pageerror', error => found('page error: ' + error.message.split('\n')[0]));
page.on('console', message => {
  if (message.type() !== 'error') return;
  if (/ERR_|Failed to load resource|frame-ancestors|Content Security Policy|Refused to (display|frame)|404/.test(message.text())) return;
  found('console error: ' + message.text().split('\n')[0].slice(0, 200));
});
setTimeout(() => {
  fs.writeSync(2, 'HUNG at ' + current + '\n');
  report();
  process.exit(1);
}, 25 * 60 * 1000).unref();

// ── Touch ───────────────────────────────────────────────────────────────────
const wait = ms => page.waitForTimeout(ms);
const shot = async name => { if (shotDir) await page.screenshot({ path: path.join(shotDir, name + '.png') }); };

/** What the person sees right now, in a line. */
async function seen() {
  return page.evaluate(() => {
    const visible = id => { const node = document.getElementById(id); return node && !node.hidden; };
    const parts = [];
    if (visible('dialog')) parts.push('dialog: ' + document.getElementById('dialog-title').textContent + ' — ' + document.getElementById('dialog-message').textContent.slice(0, 80));
    if (visible('sheet')) parts.push('sheet: ' + (document.getElementById('sheet-title').textContent || '(untitled)'));
    if (visible('panel')) parts.push('panel: ' + document.getElementById('panel-title').textContent);
    for (const id of ['reader', 'pdfview', 'omnibox', 'tabgrid', 'findbar', 'scan', 'qrshare', 'speakbar']) if (visible(id)) parts.push(id);
    const toasts = [...document.querySelectorAll('#toasts > *')].map(node => node.textContent.trim()).filter(Boolean);
    if (toasts.length) parts.push('toast: ' + toasts.at(-1).slice(0, 80));
    const tab = window.VexTabStore && VexTabStore.active();
    parts.push('tab: ' + (tab ? (tab.title || tab.url || 'blank') : 'none'));
    return parts.join(' · ');
  });
}

/** The things a person should never be shown, and a page wider than the phone. */
async function inspect() {
  const problems = await page.evaluate(() => {
    const out = [];
    const areas = ['panel-body', 'sheet-list', 'dialog', 'reader-body', 'start'].map(id => document.getElementById(id))
      .filter(node => node && node.offsetParent !== null);
    for (const area of areas) {
      const text = area.innerText || '';
      const bad = text.match(/\b(undefined|NaN)\b|\[object Object\]|(^|\s)null(\s|$)/);
      if (bad) out.push('shows “' + bad[0].trim() + '” in #' + area.id + ': …' + text.slice(Math.max(0, bad.index - 40), bad.index + 40).replace(/\s+/g, ' ') + '…');
      if (area.scrollWidth > area.clientWidth + 2 && getComputedStyle(area).overflowX !== 'auto') {
        // Which child sticks out, so it can be found.
        let widest = null;
        for (const child of area.querySelectorAll('*')) {
          const box = child.getBoundingClientRect();
          if (box.right > innerWidth + 2 && (!widest || box.width < widest.box.width)) {
            const scroller = child.closest('.panel-chips, .chat-suggest, .lab-bar, .lab-thumbs, .lab-tiles, .tabstrip, pre, code, table');
            if (!scroller) widest = { child, box };
          }
        }
        if (widest) out.push('#' + area.id + ' is wider than the phone: <' + widest.child.tagName.toLowerCase() + ' class="' + widest.child.className + '"> ends at ' + Math.round(widest.box.right) + 'px of ' + innerWidth);
      }
    }
    return out;
  });
  for (const problem of problems) found(problem);
}

/** Answer whatever dialog is up the way a cautious person does: Cancel. */
async function dismissDialog(answer = 'cancel') {
  for (let i = 0; i < 4; i++) {
    const open = await page.evaluate(() => !document.getElementById('dialog').hidden);
    if (!open) return;
    const hasCancel = await page.evaluate(() => !document.getElementById('dialog-cancel').hidden);
    await page.click(answer === 'ok' || !hasCancel ? '#dialog-ok' : '#dialog-cancel', { force: true });
    await wait(150);
  }
}

/** Back to the page, as a person does: Back until nothing is in the way. */
async function home() {
  for (let i = 0; i < 10; i++) {
    await dismissDialog();
    const open = await page.evaluate(() => ['panel', 'sheet', 'reader', 'pdfview', 'omnibox', 'tabgrid', 'findbar', 'scan', 'qrshare']
      .some(id => { const node = document.getElementById(id); return node && !node.hidden; }));
    if (!open) return;
    // Android's Back, which is how a person leaves anything.
    await page.evaluate(() => VexUI.handleBack());
    await wait(200);
  }
  found('Back did not get back to the page from: ' + await seen());
  await page.evaluate(() => { VexPanels.close(); VexSheets.close(); });
}

async function tap(selector, settle = 350) {
  await page.click(selector, { force: true, timeout: 5000 });
  await wait(settle);
}

/** Tap the visible control whose text starts with `label`. */
async function tapText(label, scope = '#panel-body, #sheet-list, #sheet-quick, #dialog') {
  const ok = await page.evaluate(({ label, scope }) => {
    const candidates = [...document.querySelectorAll(scope.split(',').map(s => s.trim() + ' :is(button, .sheet-row, .chip, .lab-tile, a, [role=button], .list-row)').join(','))]
      .filter(node => node.offsetParent !== null || node.getClientRects().length);
    const want = label.toLowerCase();
    // What a screen reader would say: the words on it, or its label when it is an icon.
    const name = node => ((node.querySelector('.row-label') || node).textContent.trim() || node.getAttribute('aria-label') || '').toLowerCase();
    const hit = candidates.find(node => name(node) === want)
      || candidates.find(node => name(node).startsWith(want))
      || candidates.find(node => name(node).includes(want));
    if (!hit) return false;
    hit.scrollIntoView({ block: 'center' });
    hit.click();
    return true;
  }, { label, scope });
  if (!ok) found('no “' + label + '” to tap (' + await seen() + ')');
  await wait(400);
  return ok;
}

async function type(selector, text, enter = false) {
  await page.fill(selector, text);
  if (enter) await page.press(selector, 'Enter');
  await wait(300);
}

async function open(url) {
  await home();
  await tap('#tb-url');
  await type('#omni-input', url, true);
  await wait(900);
}

async function step(label, fn) {
  current = label;
  const before = findings.length;
  // Every scenario starts where a person starts one: on the page (the first
  // run starts on the welcome, which Back would dismiss).
  try { if (walked.length) await home(); await fn(); }
  catch (error) { found('step failed: ' + error.message.split('\n')[0].slice(0, 200)); }
  await inspect();
  walked.push({ label, problems: findings.length - before, after: await seen().catch(() => '?') });
}

// ── Boot, the way the app is first opened ───────────────────────────────────
await page.goto(origin + '/index.html');
await wait(1200);
await step('first run: welcome', async () => {
  for (let i = 0; i < 8; i++) {
    const next = await page.$('#panel-body .welcome-nav .pill-btn:not(.ghost)');
    if (!next) break;
    const label = (await next.textContent()).trim();
    await next.click({ force: true });
    await wait(250);
    if (label === 'Start browsing') break;
  }
  if (await page.isVisible('#panel')) found('the welcome did not finish');
});
await shot('00-start');

// ── 1. A day of browsing ────────────────────────────────────────────────────
await step('open an article by typing its address', async () => {
  await open(site('article.html'));
  const title = await page.evaluate(() => VexTabStore.active() && VexTabStore.active().title);
  if (!/tides/i.test(title || '')) found('the tab title is “' + title + '”, not the page’s');
  const pill = await page.textContent('#tb-url-text');
  if (!pill.trim()) found('the address pill is empty on a loaded page');
});
await shot('01-article');

await step('search the web from the address bar', async () => {
  await tap('#tb-url');
  await page.fill('#omni-input', 'tides');
  await wait(500);
  const rows = await page.$$eval('#omni-results .omni-row', nodes => nodes.length);
  if (!rows) found('typing in the address bar suggested nothing (history has the article)');
  await home();
});

await step('bookmark the article from the menu', async () => {
  await tap('#tb-menu');
  await tapText('Bookmark', '#sheet-quick, #sheet-list');
  await home();
  const marked = await page.evaluate(() => VexCollections.bookmarks.all().some(item => /article/.test(item.url)));
  if (!marked) found('bookmarking did not add a bookmark');
});

await step('save it for later', async () => {
  await tap('#tb-menu');
  await tapText('Add to reading list', '#sheet-list');
  await home();
  const saved = await page.evaluate(() => VexCollections.reading.all().some(item => /article/.test(item.url)));
  if (!saved) found('“Add to reading list” did not add it');
  await home();
});

await step('read it in Reader, bigger, then close', async () => {
  await tap('#tb-menu');
  await tapText('Reader', '#sheet-list');
  await wait(600);
  if (!(await page.isVisible('#reader'))) { found('Reader did not open on an article'); return; }
  const words = await page.$eval('#reader-body', node => node.innerText.split(/\s+/).length);
  if (words < 100) found('Reader showed ' + words + ' words of a 250-word article');
  await tap('#reader-bigger');
  await shot('02-reader');
  await home();
});

// Find counts through the WebView's own findAllAsync, which only the phone
// has: here it can only be opened and closed.
await step('find a word on the page', async () => {
  await tap('#tb-menu');
  await tapText('Find in page', '#sheet-list');
  if (!(await page.isVisible('#findbar'))) found('Find in page did not open the find bar');
  await type('#find-input', 'moon');
  await home();
});

await step('read the article aloud', async () => {
  await tap('#tb-menu');
  await tapText('Read aloud', '#sheet-list');
  await wait(600);
  await home();
});

await step('translate the page', async () => {
  await tap('#tb-menu');
  await tapText('Translate page', '#sheet-list');
  await wait(700);
  await dismissDialog();
  await home();
});

await step('this site: permissions and blocking', async () => {
  await tap('#tb-menu');
  await tapText('This site', '#sheet-list');
  await wait(300);
  await home();
});

await step('shop: follow a link inside the page', async () => {
  await open(site('shop.html'));
  await page.evaluate(() => {
    const frame = [...document.querySelectorAll('#fallback-webviews iframe')].find(node => node.style.display !== 'none');
    frame.contentDocument.querySelector('footer a').click();
  });
  await wait(900);
  const title = await page.evaluate(() => VexTabStore.active().title);
  if (!/Contact/.test(title)) found('after a link inside the page the tab says “' + title + '”');
});

await step('tabs: a new tab, a private one, switch, close and undo', async () => {
  await tap('#tb-tabs');
  if (!(await page.isVisible('#tabgrid'))) { found('the tabs button did not show the tabs'); return; }
  await tap('#tg-new');
  await wait(300);
  await open(site('login.html'));
  await tap('#tb-tabs');
  await tap('#tg-private');
  await tap('#tg-new');
  await wait(300);
  await open(site('article.html'));
  const privateNow = await page.evaluate(() => VexTabStore.active().incognito);
  if (!privateNow) found('a tab opened from the private side is not private');
  await tap('#tb-tabs');
  await tap('#tg-normal');
  await shot('03-tabs');
  const cards = await page.$$('#tabgrid-list .tab-card, #tabgrid-list > *');
  if (cards.length < 2) found('the tab grid shows ' + cards.length + ' tabs after opening 3');
  const before = await page.evaluate(() => VexTabStore.normal().length);
  const closer = await page.$('#tabgrid-list .tab-card .tab-close, #tabgrid-list [aria-label^="Close"]');
  if (closer) {
    await closer.click({ force: true });
    await wait(300);
    const after = await page.evaluate(() => VexTabStore.normal().length);
    if (after !== before - 1) found('closing a tab from the grid left ' + after + ' of ' + before);
    const undo = await page.$('#toasts button');
    if (undo) { await undo.click({ force: true }); await wait(400); }
    else found('no Undo after closing a tab');
    const restored = await page.evaluate(() => VexTabStore.normal().length);
    if (restored !== before) found('Undo brought back ' + (restored - (before - 1)) + ' tabs');
  } else found('no close button on a tab card');
  await home();
});

await step('history, bookmarks, reading list', async () => {
  await tap('#tb-menu');
  await tapText('History', '#sheet-list');
  const rows = await page.$$eval('#panel-body .list-row', nodes => nodes.length);
  if (rows < 2) found('History lists ' + rows + ' pages after visiting 4');
  await home();
  await tap('#tb-menu');
  await tapText('Bookmarks', '#sheet-list');
  await home();
  await tap('#tb-menu');
  await tapText('Reading list', '#sheet-list');
  await home();
});

await step('passwords: add a login with a generated password', async () => {
  await tap('#tb-menu');
  await tapText('Passwords', '#sheet-list');
  await wait(300);
  await shot('04-passwords');
  await home();
});

// ── 2. The assistant and the AI Lab, with the development model ─────────────
await step('get a model: Models → Gemma 4 E2B → Download', async () => {
  await page.evaluate(() => VexPanels.settings());
  await wait(300);
  await tapText('Assistant');
  await tapText('On-device AI');
  await tapText('Gemma 4 E2B');
  await tapText('Download', '#sheet-list');
  await wait(600);
  await dismissDialog();
  const here = await page.evaluate(() => Object.keys(VexLocalAI.state.models));
  if (!here.includes('gemma-4-E2B-it.litertlm')) found('downloading Gemma 4 E2B did not put it on the phone: ' + here.join(', '));
  await tapText('Use it');
  await tapText('Prefer on-device', '#sheet-list');
  await shot('05-models');
  await home();
});

await step('ask the assistant about the page', async () => {
  await open(site('article.html'));
  await tap('#tb-menu');
  await tapText('Ask the assistant', '#sheet-list');
  await wait(400);
  await type('#vex-chat-input', 'What causes spring tides?', true);
  await wait(1500);
  const bubbles = await page.$$eval('#vex-chat-log .bubble', nodes => nodes.map(node => node.className + ':' + node.textContent.slice(0, 60)));
  if (!bubbles.some(text => text.startsWith('bubble assistant'))) found('no answer from the on-device model: ' + bubbles.join(' | '));
  await shot('06-ask');
});

await step('let it do something: click the contact link', async () => {
  await open(site('shop.html'));
  await tap('#tb-menu');
  await tapText('Ask the assistant', '#sheet-list');
  await tapText('Do it', '#panel-body');
  await type('#vex-chat-input', 'click CONTACT US', true);
  await wait(2500);
  await dismissDialog('ok');
  await wait(1500);
  const log = await page.$eval('#vex-chat-log', node => node.innerText.slice(0, 400));
  if (/needs your AI worker|Set up the assistant/.test(log)) found('“Do it” refused with Gemma 4 on the phone: ' + log);
  await shot('07-do-it');
  await home();
});

for (const [id, label] of [['chat', 'AI Chat'], ['image', 'Ask Image'], ['audio', 'Audio Scribe'], ['prompt', 'Prompt Lab'],
  ['agent', 'Agent Skills'], ['garden', 'Tiny Garden'], ['actions', 'Mobile Actions'], ['scrapbook', 'Scrapbook']]) {
  await step('AI Lab: ' + label, async () => {
    await tap('#tb-menu');
    await tapText('AI Lab', '#sheet-list');
    await tapText(label);
    await wait(400);
    const needs = await page.$$eval('#panel-body .sheet-row', rows => rows.map(row => row.textContent).filter(text => /licence|GB|MB/.test(text)).length);
    if (needs) {
      // Get its model the way a person would: the first one offered.
      const first = await page.$('#panel-body .sheet-row');
      await first.click({ force: true });
      await wait(400);
      // A model behind the licence: say it has been accepted, give a token.
      if (await page.evaluate(() => !document.getElementById('sheet').hidden)) {
        await tapText('I have accepted it', '#sheet-list');
        await wait(300);
        if (await page.evaluate(() => !document.getElementById('dialog').hidden && !document.getElementById('dialog-input').hidden)) {
          await page.fill('#dialog-input', 'hf_dev_token_for_the_walkthrough');
          await page.click('#dialog-ok', { force: true });
        } else found('no place to paste the token');
      }
      await wait(1200);
      const still = await page.$$eval('#panel-body .sheet-row', rows => rows.filter(row => /needs \d+ GB|licence/.test(row.textContent)).length);
      if (still) found('the model finished downloading but the page still asks for one');
    }
    // Use it, by touch.
    const text = async () => page.$eval('#panel-body', node => node.innerText);
    const until = async (test, ms = 4000) => { for (let t = 0; t < ms; t += 200) { if (await test()) return true; await wait(200); } return false; };
    const answered = () => page.$$eval('#lab-chat-log .bubble.assistant:not([data-streaming])', nodes => nodes.length > 0);
    if (id === 'chat' || id === 'agent') {
      await type('#lab-chat-input', id === 'chat' ? 'Hello there' : 'Tell me about tides', true);
      if (!(await until(answered))) found('no answer in ' + label);
    } else if (id === 'image') {
      await tap('.lab-attach');
      await tapText('Choose from the phone', '#sheet-list');
      await wait(300);
      if (!(await page.$('.lab-thumb'))) found('choosing a picture showed no thumbnail');
      await type('#lab-chat-input', 'What is in this picture?', true);
      if (!(await until(answered))) found('no answer about the picture');
    } else if (id === 'audio') {
      await tapText('Record');
      await wait(400);
      await tapText('Transcribe');
      if (!(await until(async () => /stand-in/.test(await page.$eval('.lab-output', node => node.textContent))))) found('Transcribe gave nothing');
    } else if (id === 'prompt') {
      await page.fill('.lab-input', 'Write a haiku about lamps');
      await page.dispatchEvent('.lab-input', 'input');
      await tapText('Run');
      if (!(await until(async () => /stand-in/.test(await page.$eval('.lab-output', node => node.textContent))))) found('Run gave nothing');
    } else if (id === 'garden') {
      await tapText('Plant a daisy in plot 5');
      if (!(await until(async () => (await page.$$eval('.lab-plot-plant', nodes => nodes[4] && nodes[4].textContent)) === '🌱'))) found('“Plant a daisy in plot 5” planted nothing');
    } else if (id === 'actions') {
      await tapText('Turn on the flashlight');
      if (!(await until(async () => !!(await page.$('#lab-actions .sheet-row:not(.static)')) || /flashlight/i.test(await page.$eval('#lab-actions', node => node.textContent))))) found('“Turn on the flashlight” did nothing');
    } else if (id === 'scrapbook') {
      await tapText('Add a photo');
      if (!(await until(async () => !!(await page.$('.lab-cut-overlay'))))) found('Add a photo did not open the cutter');
      else await tapText('Back to the page');
    }
    await wait(700);
    void text;
    await shot('08-lab-' + id);
  });
  await home();
}

// ── 2b. The rest of a day: each thing checked by what it leaves behind ──────
const toastText = () => page.$$eval('#toasts > *', nodes => nodes.map(node => node.textContent).join(' | '));
const until = async (test, ms = 4000) => { for (let t = 0; t < ms; t += 200) { if (await test()) return true; await wait(200); } return false; };
const panelRows = () => page.$$eval('#panel-body .list-row, #panel-body .sheet-row:not(.static)', nodes => nodes.length);
const menu = async label => { await tap('#tb-menu'); return tapText(label, '#sheet-list'); };

await step('save the article for offline, then open it from Saved pages', async () => {
  await open(site('article.html'));
  await menu('Save page for offline');
  if (!(await until(async () => /Saved|could not|failed/i.test(await toastText())))) found('saving for offline said nothing');
  const said = await toastText();
  if (!/Saved/.test(said)) found('saving for offline: ' + said.slice(0, 120));
  await home();
  await menu('Saved pages');
  if ((await panelRows()) < 1) found('Saved pages is empty after saving one');
});

await step('remind me about this page', async () => {
  await open(site('article.html'));
  await menu('Remind me about this');
  const choices = await page.$$eval('#sheet-list .sheet-row .row-label', nodes => nodes.map(node => node.childNodes[0].textContent.trim()));
  if (!choices.length) { found('“Remind me about this” offered no times'); return; }
  await tapText(choices[0], '#sheet-list');
  await dismissDialog('ok');
  await home();
  await menu('Reminders');
  if ((await panelRows()) < 1) found('Reminders is empty after setting one (' + choices[0] + ')');
});

await step('show the page as a QR code', async () => {
  await open(site('article.html'));
  await menu('Show as QR code');
  if (!(await page.isVisible('#qrshare'))) { found('the QR code did not show'); return; }
  const size = await page.$eval('#qrshare-canvas canvas', node => node.width).catch(() => 0);
  if (!size) found('the QR code is empty');
});

await step('copy the link', async () => {
  await open(site('article.html'));
  await menu('Copy link');
  if (!(await until(async () => /Copied|copied/.test(await toastText()), 1500))) found('Copy link said nothing: ' + await toastText());
});

await step('close a tab and reopen it from the menu', async () => {
  await open(site('shop.html'));
  await tap('#tb-tabs');
  await tap('#tg-new');
  await open(site('contact.html'));
  const before = await page.evaluate(() => VexTabStore.normal().length);
  await page.evaluate(() => VexUI.closeTabWithUndo(VexTabStore.active().id));
  await wait(300);
  await home();
  await menu('Reopen closed tab');
  await wait(600);
  const after = await page.evaluate(() => VexTabStore.normal().length);
  if (after !== before) found('Reopen closed tab: ' + before + ' tabs before closing, ' + after + ' after reopening');
});

await step('find a page by what it said', async () => {
  await open(site('article.html'));
  await wait(1500);                   // indexed after it loads
  await menu('Search what you read');
  await page.fill('#panel-search-input', 'spring tides');
  await page.dispatchEvent('#panel-search-input', 'input');
  await wait(800);
  if ((await panelRows()) < 1) found('Search what you read found nothing for “spring tides” after reading the tides article');
});

await step('sessions: keep this set of tabs', async () => {
  await menu('Sessions');
  const action = await page.$eval('#panel-action', node => !node.hidden && node.textContent).catch(() => false);
  if (action) {
    await tap('#panel-action');
    if (await page.evaluate(() => !document.getElementById('dialog').hidden)) {
      if (await page.evaluate(() => !document.getElementById('dialog-input').hidden)) await page.fill('#dialog-input', 'Lamps');
      await page.click('#dialog-ok', { force: true });
      await wait(400);
    }
    if ((await panelRows()) < 1) found('Sessions is empty after saving one');
  }
});

await step('history: clear it all', async () => {
  await menu('History');
  if (!(await page.$eval('#panel-action', node => !node.hidden))) { found('History has no Clear'); return; }
  await tap('#panel-action');
  await dismissDialog('ok');
  await wait(400);
  const left = await page.evaluate(async () => (await VexHistory.search('', 50)).length);
  if (left) found('Clear left ' + left + ' visits in history');
});

await step('bookmarks: remove one, then undo', async () => {
  await open(site('article.html'));
  await page.evaluate(() => VexCollections.bookmarks.add({ url: location.origin + '/fixtures/shop.html', title: 'Lamp Shop' }));
  await menu('Bookmarks');
  const before = await page.evaluate(() => VexCollections.bookmarks.all().length);
  const remove = await page.$('#panel-body .list-row button.x');
  if (!remove) { found('no way to remove a bookmark from the list'); return; }
  await remove.click({ force: true });
  await wait(300);
  const removed = await page.evaluate(() => VexCollections.bookmarks.all().length);
  if (removed !== before - 1) found('removing a bookmark left ' + removed + ' of ' + before);
  const undo = await page.$('#toasts button');
  if (!undo) { found('no Undo after removing a bookmark'); return; }
  await undo.click({ force: true });
  await wait(400);
  if ((await page.evaluate(() => VexCollections.bookmarks.all().length)) !== before) found('Undo did not bring the bookmark back');
});

await step('reading list: open what was saved', async () => {
  await menu('Reading list');
  const row = await page.$('#panel-body .list-row');
  if (!row) { found('the reading list is empty'); return; }
  await row.click({ force: true });
  await wait(900);
  if (await page.isVisible('#panel')) found('opening a reading-list item left the list open');
});

await step('appearance: change the theme', async () => {
  await page.evaluate(() => VexPanels.appearance());
  await wait(300);
  const before = await page.evaluate(() => document.documentElement.dataset.theme + '|' + getComputedStyle(document.body).backgroundColor);
  const cards = await page.$$('#panel-body .theme-card');
  if (cards.length < 2) { found('Appearance shows ' + cards.length + ' themes'); return; }
  await cards[cards.length - 1].click({ force: true });
  await wait(400);
  const after = await page.evaluate(() => document.documentElement.dataset.theme + '|' + getComputedStyle(document.body).backgroundColor);
  if (after === before) found('choosing another theme changed nothing (' + before + ')');
  // The page redraws with the new theme ticked: find the first card again.
  await page.click('#panel-body .theme-card', { force: true });
  await wait(300);
});

await step('start page: a new tab, then a tile', async () => {
  await tap('#tb-tabs');
  await tap('#tg-new');
  await wait(400);
  // A new tab opens the address bar, ready to type; Back shows the start page.
  if (!(await page.isVisible('#omnibox'))) found('a new tab did not open the address bar');
  await page.evaluate(() => VexUI.handleBack());
  await wait(300);
  if (!(await page.isVisible('#start'))) { found('Back from a new tab’s address bar did not show the start page'); return; }
  const tile = await page.$('#start-tiles .tile');
  if (!tile) { found('the start page has no tiles after a day of browsing'); return; }
  const label = await tile.textContent();
  await tile.click({ force: true });
  await wait(1500);
  if (await page.isVisible('#start')) found('tapping the start-page tile “' + label + '” went nowhere; the tab is at ' + await page.evaluate(() => VexTabStore.active().url));
});

await step('sync: try to sign in with no worker set', async () => {
  await page.evaluate(() => VexPanels.sync());
  await wait(300);
  const text = (await page.$eval('#panel-body', node => node.innerText)).slice(0, 300);
  if (!/worker|Worker/.test(text)) found('Sync does not say it needs a worker: ' + text.replace(/\s+/g, ' ').slice(0, 120));
  await shot('09-sync');
});

await step('backup: start one, then think better of it', async () => {
  await page.evaluate(() => VexPanels.backup());
  await wait(300);
  const rows = await page.$$eval('#panel-body .sheet-row:not(.static) .row-label', nodes => nodes.map(node => node.childNodes[0].textContent.trim()));
  const make = rows.find(label => /^(Make|Create|Back up|Save)/i.test(label));
  if (!make) { found('Backup offers nothing to make one: ' + rows.join(', ')); return; }
  await tapText(make);
  await wait(400);
  await dismissDialog();
});

// ── 3. The crawl ────────────────────────────────────────────────────────────
await open(site('article.html'));

async function menuLabels() {
  await tap('#tb-menu');
  const labels = await page.$$eval('#sheet-list .sheet-row .row-label', nodes => nodes.map(node => node.childNodes[0].textContent.trim()));
  await home();
  return labels;
}

/** Tap something and say whether anything at all happened. */
async function tapAndWatch(fn) {
  await page.evaluate(() => {
    window.__changes = 0;
    window.__observer = new MutationObserver(records => { window.__changes += records.length; });
    window.__observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  const before = await seen();
  await fn();
  await wait(500);
  const changes = await page.evaluate(() => { window.__observer.disconnect(); return window.__changes; });
  return { before, after: await seen(), changes };
}

const skipMenu = /^(Print|Share|Add to home screen|Send to my devices|Scan)/;
for (const label of await menuLabels()) {
  if (skipMenu.test(label)) { walked.push({ label: 'menu: ' + label, problems: 0, after: 'skipped (hands off to Android)' }); continue; }
  await step('menu: ' + label, async () => {
    await open(site('article.html'));
    await tap('#tb-menu');
    const result = await tapAndWatch(() => tapText(label, '#sheet-list'));
    if (result.changes === 0) found('tapping it changed nothing on screen');
    await dismissDialog();
  });
  await home();
}

// Settings: every row, and every row of what it opens.
async function rowsOf() {
  return page.$$eval('#panel-body .sheet-row:not(.static)', rows => rows.map(row => {
    const label = row.querySelector('.row-label');
    return { label: label ? label.childNodes[0].textContent.trim() : row.textContent.trim().slice(0, 40), toggle: !!row.querySelector('.switch') };
  }).filter(row => row.label && !row.static));
}

async function openPath(pathLabels) {
  await home();
  await page.evaluate(() => VexPanels.settings());
  await wait(300);
  for (const label of pathLabels) await tapText(label);
}

const dangerous = /^(Delete|Erase|Clear everything|Sign out|Forget|Reset|Restore|Remove all|Leave)/i;
const settings = (await (async () => { await openPath([]); return rowsOf(); })());
for (const row of settings) {
  if (dangerous.test(row.label)) continue;
  await step('settings: ' + row.label, async () => {
    await openPath([]);
    const result = await tapAndWatch(() => tapText(row.label));
    if (result.changes === 0) found('tapping it changed nothing on screen');
    if (row.toggle) { await tapText(row.label); return; }          // and back
    const title = await page.evaluate(() => !document.getElementById('panel').hidden && document.getElementById('panel-title').textContent);
    await dismissDialog();
    if (!title || title === 'Settings') return;
    const inner = await rowsOf();
    for (const sub of inner.slice(0, 40)) {
      if (dangerous.test(sub.label)) continue;
      current = 'settings: ' + row.label + ' → ' + sub.label;
      try {
        await openPath([row.label]);
        const watched = await tapAndWatch(() => tapText(sub.label));
        if (watched.changes === 0) found('tapping it changed nothing on screen');
        await dismissDialog();
        if (sub.toggle) { await openPath([row.label]); await tapText(sub.label); }
        await inspect();
      } catch (error) { found('step failed: ' + error.message.split('\n')[0]); }
      walked.push({ label: current, problems: 0, after: await seen().catch(() => '?') });
    }
  });
  await home();
}

report();
await browser.close();
server.close();

function report() {
  const out = { walked: walked.length, findings: findings.map(({ where, what }) => ({ where, what })) };
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ ...out, steps: walked }, null, 2));
  console.log('Walked ' + walked.length + ' steps; ' + findings.length + ' findings.');
  for (const item of findings) console.log('• [' + item.where + '] ' + item.what);
}
