// @vitest-environment jsdom
//
// Settings › General › Search keywords (found missing 2026-10-10): a keyword
// of your own could only be added by editing storage by hand, and the
// built-in ones were listed nowhere. Reset to Defaults takes them too.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const { SearchShortcuts, resolveSearchShortcut } = require('../../src/renderer/js/search-shortcuts.js');
globalThis.SearchShortcuts = SearchShortcuts;
const { SearchKeywordsUI } = require('../../src/renderer/js/search-keywords-ui.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="setting-search-keywords"></div><button id="setting-search-keyword-add"></button>';
  window.showToast = vi.fn();
});

describe('keywords of your own', () => {
  it('are added from Settings and then work in the address bar', async () => {
    const answers = ['Jira', 'https://my.jira/browse?q=%s'];
    window.vexPrompt = vi.fn(async () => answers.shift());
    SearchKeywordsUI.init();
    await SearchKeywordsUI.add();
    expect(resolveSearchShortcut('jira PROJ-7')).toBe('https://my.jira/browse?q=PROJ-7');
    expect(document.getElementById('setting-search-keywords').textContent).toContain('jira → https://my.jira/browse?q=%s');
  });

  it('are taken off with Remove', () => {
    SearchShortcuts.setUserKeyword('jira', 'https://my.jira/?q=%s');
    SearchKeywordsUI.render();
    document.querySelector('.search-keyword-row button').click();
    expect(SearchShortcuts.userKeywords()).toEqual({});
  });

  it('refuse a bad keyword or an address without %s, and say why', () => {
    expect(() => SearchShortcuts.setUserKeyword('two words', 'https://a/?q=%s')).toThrow(/one word/);
    expect(() => SearchShortcuts.setUserKeyword('ok', 'https://a/?q=')).toThrow(/%s/);
    expect(() => SearchShortcuts.setUserKeyword('ok', 'javascript:alert(1)//%s')).toThrow(/https/);
  });

  it('never write over a list that cannot be read', () => {
    localStorage.setItem('vex.searchKeywords', '{broken');
    expect(() => SearchShortcuts.setUserKeyword('ok', 'https://a/?q=%s')).toThrow();
    expect(localStorage.getItem('vex.searchKeywords')).toBe('{broken');
  });

  it('the built-in ones are listed, with the @ where one is needed', () => {
    SearchKeywordsUI.render();
    const text = document.querySelector('.search-keyword-builtins').textContent;
    expect(text).toContain('yt YouTube');
    expect(text).toContain('@w Wikipedia');
  });

  it('Reset to Defaults clears them', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/app.js'), 'utf8');
    const keys = app.slice(app.indexOf('const SETTINGS_PREF_KEYS'), app.indexOf('const SETTINGS_DEFAULTS'));
    expect(keys).toContain("'vex.searchKeywords'");
  });
});
