// The ad blocker's filter lists (@ghostery/adblocker's prebuilt set, from
// raw.githubusercontent.com): when they may be downloaded, and how.
//
// They came down with Node's own fetch, which knows nothing of Vex's
// sessions, so with all of Vex going through Tor or a proxy they still left
// directly from the real address; and they were downloaded (at the first
// start, then every week) with the blocker switched off (found 2026-10-11).
// They now come through Vex's default session, which the route for all of
// Vex covers (main.js routing:set-all), and not at all while Settings ›
// General › Block ads and trackers is off.
// @ts-check

/**
 * A fetch for the lists that refuses while the blocker is off.
 * @param {{ fetch: (url: string, init?: any) => Promise<any>, isOn: () => boolean }} deps
 */
function createListFetch({ fetch, isOn }) {
  if (typeof fetch !== 'function' || typeof isOn !== 'function') throw new Error('createListFetch needs fetch and isOn');
  return async function listFetch(/** @type {string} */ url, /** @type {any} */ init) {
    if (!isOn()) throw new Error('The ad blocker is off, so its filter lists are not downloaded');
    return fetch(url, init);
  };
}

/**
 * The switch as the main window saved it (vex-storage/settings.json,
 * js/storage.js saveSettings): on unless it was switched off.
 * @param {unknown} settings
 */
function storedBlockerOn(settings) {
  return !(settings && typeof settings === 'object' && /** @type {any} */ (settings).adBlocker === false);
}

module.exports = { createListFetch, storedBlockerOn };
