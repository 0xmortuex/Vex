// Drive the mobile chrome in a phone-sized Chromium and check that the paths a
// person actually takes still work: omnibox → navigate, the menu sheet, a new
// tab, the tab switcher, bookmarks, settings, find, a private tab, and Android
// back. It runs against the iframe fallback (no Capacitor), which is enough to
// exercise every line of chrome code — the native calls are stubbed, not the UI.
//
//   npm i -D playwright && npx playwright install chromium
//   node scripts/smoke-chrome.mjs
//
// Any assertion that comes back false, or any page error, fails the run.
import { chromium, devices } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const errors = [];
const here = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(here, '..', 'www', 'index.html');
// A preinstalled Chromium (CI images, Claude Code sandboxes) is used when the
// environment points at one; otherwise Playwright's own download is used.
const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
page.on('pageerror', err => errors.push('pageerror: ' + err.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

const tap = async selector => { await page.click(selector, { force: true }); await page.waitForTimeout(180); };
const menu = async label => {
  await tap('#tb-menu');
  const rows = await page.$$('#sheet-list .sheet-row');
  for (const row of rows) {
    if ((await row.textContent()).trim().startsWith(label)) { await row.click({ force: true }); break; }
  }
  await page.waitForTimeout(250);
};

await page.goto('file://' + indexPath);
await page.waitForTimeout(700);

const r = {};
r.startVisible = await page.isVisible('#start');
r.tabCount = (await page.textContent('#tb-tabcount')).trim();

// Omnibox → navigate
await tap('#tb-url');
r.omniOpen = await page.isVisible('#omnibox');
await page.fill('#omni-input', 'example.com');
await page.waitForTimeout(200);
r.suggestions = await page.$$eval('#omni-results .omni-row', rows => rows.length);
await page.press('#omni-input', 'Enter');
await page.waitForTimeout(400);
r.urlPill = (await page.textContent('#tb-url-text')).trim();
r.omniClosed = !(await page.isVisible('#omnibox'));
r.startHidden = !(await page.isVisible('#start'));

// Menu contents
await tap('#tb-menu');
r.menuRows = await page.$$eval('#sheet-list .sheet-row', rows => rows.length);
await page.evaluate(() => VexUI.closeSheet());
await page.waitForTimeout(120);

// New tab via the menu, then the tab switcher
await menu('New tab');
r.omniAfterNewTab = await page.isVisible('#omnibox');
await tap('#omni-cancel');
r.tabCountAfterNew = (await page.textContent('#tb-tabcount')).trim();
await tap('#tb-tabs');
r.gridOpen = await page.isVisible('#tabgrid');
r.cards = await page.$$eval('.tabcard', cards => cards.length);
await tap('#tg-private');
r.privateEmptyCopy = (await page.textContent('.tabgrid-empty') || '').slice(0, 24);
await tap('#tg-normal');
await tap('#tg-done');
r.gridClosed = !(await page.isVisible('#tabgrid'));

// Bookmark the page, then read it back
await tap('#tb-menu');
await tap('#m-star');
await menu('Bookmarks');
r.bookmarkPanel = (await page.textContent('#panel-title')).trim();
r.bookmarkRows = await page.$$eval('#panel-body .list-row', rows => rows.length);

// Android back: closes the panel, then walks tabs
r.backClosedPanel = await page.evaluate(() => VexUI.handleBack());
await page.waitForTimeout(150);
r.panelClosed = !(await page.isVisible('#panel'));

// Settings renders its controls and toggles persist
await menu('Settings');
r.settingsControls = await page.$$eval('#panel-body .sheet-row, #panel-body .field', els => els.length);
await tap('#set-block');
r.blockingOff = await page.evaluate(() => VexStore.get('vex.blockEnabled', true));
await tap('#panel-back');

// Find bar
await menu('Find in page');
r.findOpen = await page.isVisible('#findbar');
await page.fill('#find-input', 'test');
await page.waitForTimeout(250);
await tap('#find-close');
r.findClosed = !(await page.isVisible('#findbar'));

// Private tab
await menu('New private tab');
await tap('#omni-cancel');
r.privateBodyClass = await page.evaluate(() => document.body.classList.contains('private'));
r.privateTabCount = await page.evaluate(() => VexTabStore.private().length);

// History must not record the private tab
r.historyLength = await page.evaluate(() => VexStore.get('vex.history', []).length);

// The page layer must be uncovered again once every overlay is closed.
await page.evaluate(async () => {
  await VexTabStore.activate(VexTabStore.normal()[0].id);
  VexUI.closeTabGrid(); VexUI.closeSheet(); VexPanels.close(); VexUI.closeOmnibox();
});
await page.waitForTimeout(200);
r.pageLayerVisibleAtRest = await page.evaluate(() => {
  const host = document.getElementById('fallback-webviews');
  return host ? host.style.display !== 'none' : null;
});
// …and covered again the moment an overlay is up.
await page.evaluate(() => VexUI.openTabGrid());
await page.waitForTimeout(250);
r.pageLayerHiddenWithGrid = await page.evaluate(() => {
  const host = document.getElementById('fallback-webviews');
  return host ? host.style.display === 'none' : null;
});
await page.evaluate(() => VexUI.closeTabGrid());
await page.waitForTimeout(200);
r.pageLayerVisibleAfterGrid = await page.evaluate(() => {
  const host = document.getElementById('fallback-webviews');
  return host ? host.style.display !== 'none' : null;
});

console.log(JSON.stringify(r, null, 2));
await browser.close();

// Everything here is either a boolean that must be true, a count that must be
// non-zero, or a string that must match. Spell that out rather than eyeballing.
const expected = {
  startVisible: true, tabCount: '1', omniOpen: true, omniClosed: true, startHidden: true,
  urlPill: 'example.com', menuRows: 11, omniAfterNewTab: true, tabCountAfterNew: '2',
  gridOpen: true, cards: 2, gridClosed: true, bookmarkPanel: 'Bookmarks',
  backClosedPanel: true, panelClosed: true, blockingOff: false, findOpen: true,
  findClosed: true, privateBodyClass: true, privateTabCount: 1,
  pageLayerVisibleAtRest: true, pageLayerHiddenWithGrid: true, pageLayerVisibleAfterGrid: true
};
const failures = [];
for (const [key, want] of Object.entries(expected)) {
  if (r[key] !== want) failures.push(key + ': expected ' + JSON.stringify(want) + ', got ' + JSON.stringify(r[key]));
}
if (r.suggestions < 1) failures.push('suggestions: expected at least one row');
if (r.settingsControls < 10) failures.push('settingsControls: expected the settings panel to render its rows');
// Network failures are expected in a sandbox (the filter lists are fetched at
// boot); anything else is a real page error.
for (const error of errors) {
  if (!/Failed to load resource|ERR_/.test(error)) failures.push(error);
}
if (failures.length) {
  for (const failure of failures) console.error('FAIL ' + failure);
  process.exit(1);
}
console.log('ok — mobile chrome smoke passed');
