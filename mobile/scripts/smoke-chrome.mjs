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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(here, '..', 'www', 'index.html');
const shotIndex = process.argv.indexOf('--shots');
const shotDir = shotIndex > 0 ? process.argv[shotIndex + 1] : null;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

const errors = [];
const results = {};
const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const context = await browser.newContext({ ...devices['Pixel 7'] });
const page = await context.newPage();
page.on('pageerror', error => errors.push('pageerror: ' + error.message));
page.on('console', message => {
  if (message.type() !== 'error') return;
  if (/ERR_|Failed to load resource/.test(message.text())) return;    // no network in a sandbox
  errors.push('console: ' + message.text());
});

const tap = async (selector, wait = 200) => { await page.click(selector, { force: true }); await page.waitForTimeout(wait); };
const shot = async name => { if (shotDir) await page.screenshot({ path: path.join(shotDir, name + '.png') }); };
const sheetRow = async label => {
  const rows = await page.$$('#sheet-list .sheet-row');
  for (const row of rows) {
    if ((await row.textContent()).trim().startsWith(label)) { await row.click({ force: true }); await page.waitForTimeout(250); return true; }
  }
  return false;
};

await page.goto('file://' + indexPath);
await page.waitForTimeout(800);

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
  await VexStore.set('vex.history', [
    { url: 'https://news.ycombinator.com/', title: 'Hacker News', at: now - 1000 },
    { url: 'https://github.com/0xmortuex/Vex', title: 'Vex on GitHub', at: now - 60000 },
    { url: 'https://developer.mozilla.org/', title: 'MDN Web Docs', at: now - 7200000 },
    { url: 'https://en.wikipedia.org/wiki/Web_browser', title: 'Web browser — Wikipedia', at: now - 90000000 }
  ]);
  await VexStore.set('vex.bookmarks', [{ url: 'https://claude.ai/', title: 'Claude', at: now }]);
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
await page.waitForTimeout(220);
results.suggestions = await page.$$eval('#omni-results .omni-row', rows => rows.length);
results.suggestionHighlight = await page.$$eval('#omni-results mark', marks => marks.length);
await shot('02-omnibox');
await page.fill('#omni-input', 'example.com');
await page.press('#omni-input', 'Enter');
await page.waitForTimeout(450);
results.urlPill = (await page.textContent('#tb-url-text')).trim();
results.startHidden = !(await page.isVisible('#start'));

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
await tap('#tg-private', 250);
results.privateEmptyCopy = ((await page.textContent('.tabgrid-empty')) || '').slice(0, 20);
await tap('#tg-normal', 200);
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

// ── Find, and the page layer's cover refcount ───────────────────────────────
await page.evaluate(() => VexUI.openFind());
await page.waitForTimeout(200);
results.findOpen = await page.isVisible('#findbar');
await page.evaluate(() => VexUI.closeFind());

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

console.log(JSON.stringify(results, null, 2));
await browser.close();

const expected = {
  startTiles: 4, startRail: 4,
  omniOpen: true, suggestions: 2, suggestionHighlight: 1,
  urlPill: 'example.com', startHidden: true,
  menuRows: 13, menuQuick: 4,
  siteSheetOpened: true, scriptsOff: true,
  readerOpen: true, readerTitle: 'The Wreck of the Deutschland', readerSize: 21,
  chatBubbles: 2, chatFollowUps: 1,
  themeCards: 9, themeStored: 'midnight', themeApplied: 'midnight', skinTexture: true,
  shieldScript: true, shieldOffEmpty: true,
  tabCards: 3, tabSearchCards: 1,
  privateBodyClass: true, historyUnchanged: true,
  linkSheetRows: 5, findOpen: true,
  pageLayerVisibleAtRest: true, pageLayerHiddenWithGrid: true, pageLayerVisibleAfterGrid: true,
  backToSettings: 'Settings', backClosesPanel: true
};

const failures = [];
for (const [key, want] of Object.entries(expected)) {
  if (results[key] !== want) failures.push(key + ': expected ' + JSON.stringify(want) + ', got ' + JSON.stringify(results[key]));
}
if (!String(results.chatAnswer).includes('shipwreck')) failures.push('chatAnswer: the worker reply did not reach the log');
if (results.siteRows < 6) failures.push('siteRows: the site sheet is missing rules');
if (results.privacyRows < 6) failures.push('privacyRows: the privacy panel is missing rows');
if (results.readerParas < 2) failures.push('readerParas: the reader rendered no body');
if (!String(results.ruleDescribed).includes('JavaScript off')) failures.push('ruleDescribed: ' + results.ruleDescribed);
if (!String(results.privateEmptyCopy).startsWith('No private tabs')) failures.push('privateEmptyCopy: ' + results.privateEmptyCopy);
failures.push(...errors);

if (failures.length) {
  for (const failure of failures) console.error('FAIL ' + failure);
  process.exit(1);
}
console.log('ok — mobile chrome smoke passed (' + Object.keys(expected).length + ' expectations)');
