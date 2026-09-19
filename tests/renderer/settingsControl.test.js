// @vitest-environment jsdom
//
// "Turn off mouse gestures", "set the search engine to DuckDuckGo": a setting
// found by the words next to it, changed only after the user says yes, through
// the control's own change event, so the code that already saves it saves it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const { VexSettingsControl: S } = require('../../src/renderer/js/settings-control.js');

// The real Settings markup, so a label change there is caught here.
const html = fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');
const settings = html.slice(html.indexOf('<div class="panel" id="panel-settings"'));

beforeEach(() => {
  document.body.innerHTML = settings;
  globalThis.vexConfirm = vi.fn(async () => true);
});

describe('reading a request', () => {
  it('understands the ways people ask', () => {
    expect(S.parseRequest('turn on streamer mode')).toEqual({ query: 'streamer mode', want: true });
    expect(S.parseRequest('turn mouse gestures off')).toEqual({ query: 'mouse gestures', want: false });
    expect(S.parseRequest('Disable the ad blocker.')).toEqual({ query: 'the ad blocker', want: false });
    expect(S.parseRequest('set the search engine to DuckDuckGo')).toEqual({ query: 'the search engine', want: 'DuckDuckGo' });
    expect(S.parseRequest('what time is it')).toBeNull();
  });
});

describe('finding the control', () => {
  it('by the words next to it, in the real Settings', () => {
    expect(S.find('mouse gestures', { kind: 'toggle' }).el.id).toBe('setting-gestures');
    expect(S.find('search engine', { kind: 'choice' }).el.id).toBe('setting-search-engine');
    expect(S.find('streamer', { kind: 'choice' }).el.id).toBe('setting-streamer-mode');
  });
  it('says so rather than guessing', () => {
    expect(() => S.find('flux capacitor')).toThrow(/No setting called "flux capacitor"/);
  });
});

describe('changing it', () => {
  it('asks first, then sets the control and fires its change event', async () => {
    const el = document.getElementById('setting-gestures');
    el.checked = true;
    const changed = vi.fn();
    el.addEventListener('change', changed);
    const r = await S.apply('turn off mouse gestures');
    expect(vexConfirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'Turn off "Mouse gestures (hold right button + drag)"?' }));
    expect(el.checked).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ changed: true, id: 'setting-gestures', from: true, to: false });
    S.undo(r);
    expect(el.checked).toBe(true);
  });

  it('a no leaves it alone; already so asks nothing', async () => {
    const el = document.getElementById('setting-search-engine');
    el.value = 'google';
    vexConfirm.mockResolvedValueOnce(false);
    expect((await S.apply('set the search engine to duckduckgo')).changed).toBe(false);
    expect(el.value).toBe('google');
    vexConfirm.mockClear();
    expect(await S.apply('set search engine to google')).toMatchObject({ changed: false, message: '"Default Search Engine" is already "Google"' });
    expect(vexConfirm).not.toHaveBeenCalled();
  });

  it('a choice that is not on the list names the ones that are', async () => {
    await expect(S.apply('set search engine to altavista')).rejects.toThrow('"altavista" is not one of: Google, DuckDuckGo, Brave Search, Bing');
  });
});

describe('from Ctrl+K', () => {
  const { VexQuickCommands } = require('../../src/renderer/js/quick-commands.js');
  globalThis.VexSettingsControl = S;
  it('offers the change, and words that name no setting are left to other commands', async () => {
    document.getElementById('setting-gestures').checked = true;
    const [r] = VexQuickCommands.results('turn off mouse gestures');
    expect(r).toMatchObject({ id: 'quick-setting', label: 'Turn off "Mouse gestures (hold right button + drag)"', hint: 'Asks before changing it · Settings' });
    await r.action();
    expect(document.getElementById('setting-gestures').checked).toBe(false);
    expect(VexQuickCommands.results('turn on the kettle').filter(x => x.id === 'quick-setting' || x.id === 'quick-error')).toEqual([]);
  });
});
