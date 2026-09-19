// @vitest-environment jsdom
//
// Looking into something takes days and touches everything: eleven tabs, four
// bookmarks you will never find again, a note, and two AI conversations each
// attached to a tab that no longer exists. A week later the question comes back
// and none of it is together.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
const { ResearchProjects } = require('../../src/renderer/js/research-projects.js');
globalThis.PageExport = require('../../src/renderer/js/page-export.js').PageExport;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.VexIcons = { svg: () => '<svg></svg>' };
  window.vexPrompt = vi.fn(async () => 'Replacing the boiler');
  window.vexConfirm = vi.fn(async () => true);
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  globalThis.TabManager = {
    activeTabId: 1,
    tabs: [{ id: 1, url: 'https://which.co.uk/boilers', title: 'Best boilers', partition: 'persist:main' }],
    getActiveTab() { return this.tabs.find(t => t.id === this.activeTabId); },
    createTab: vi.fn(),
  };
  window.VexTabPolicy = { canPersist: (tab) => !!tab && String(tab.partition || '').startsWith('persist:') };
  ResearchProjects.projects = [];
  ResearchProjects.init();
});

describe('projects', () => {
  it('a new project is the one you are working on', () => {
    const p = ResearchProjects.create('Replacing the boiler');
    expect(ResearchProjects.activeId()).toBe(p.id);
    expect(ResearchProjects.active().name).toBe('Replacing the boiler');
  });

  it('survives a restart', () => {
    ResearchProjects.create('Boiler');
    ResearchProjects.addNote('Vaillant quoted £2,400');
    ResearchProjects.projects = [];
    ResearchProjects.init();
    expect(ResearchProjects.list()[0].items[0].text).toBe('Vaillant quoted £2,400');
  });

  it('insists on a name, and will not take two the same', () => {
    expect(() => ResearchProjects.create('  ')).toThrow(/Give the project a name/);
    ResearchProjects.create('Boiler');
    expect(() => ResearchProjects.create('boiler')).toThrow(/already a project/);
  });

  it('renames without colliding', () => {
    const a = ResearchProjects.create('Boiler');
    ResearchProjects.create('Windows');
    expect(() => ResearchProjects.rename(a.id, 'windows')).toThrow(/already a project/);
    expect(ResearchProjects.rename(a.id, 'Boiler 2024').name).toBe('Boiler 2024');
  });

  it('deleting the one you were working on leaves nothing selected', () => {
    const p = ResearchProjects.create('Boiler');
    ResearchProjects.remove(p.id);
    expect(ResearchProjects.active()).toBe(null);
    expect(ResearchProjects.list()).toEqual([]);
  });
});

describe('putting things in', () => {
  beforeEach(() => { ResearchProjects.create('Boiler'); });

  it('a page, with where it came from', () => {
    ResearchProjects.addPage('https://www.which.co.uk/boilers', 'Best boilers');
    const item = ResearchProjects.active().items[0];
    expect(item).toMatchObject({ kind: 'page', host: 'which.co.uk', title: 'Best boilers' });
  });

  it('the same page twice is once', () => {
    ResearchProjects.addPage('https://which.co.uk/a', 'A');
    expect(() => ResearchProjects.addPage('https://which.co.uk/a', 'A')).toThrow(/already in/);
  });

  it('only a real web page', () => {
    for (const bad of ['file:///C:/secret.txt', 'vex://start', 'javascript:alert(1)', '']) {
      expect(() => ResearchProjects.addPage(bad, 'x'), bad).toThrow(/real web page/);
    }
  });

  it('a note, but not an empty one', () => {
    ResearchProjects.addNote('  Vaillant quoted £2,400  ');
    expect(ResearchProjects.active().items[0]).toMatchObject({ kind: 'note', text: 'Vaillant quoted £2,400' });
    expect(() => ResearchProjects.addNote('   ')).toThrow(/nothing to write down/);
  });

  it('a conversation — the part every browser loses', () => {
    ResearchProjects.addChat([
      { role: 'user', content: 'combi or system boiler?' },
      { role: 'assistant', content: 'It depends on how many bathrooms…' },
      { role: 'assistant', content: '   ' },            // dropped
      { role: 'system', content: 'ignored role' },      // kept, as assistant
    ], 'Boiler types');
    const chat = ResearchProjects.active().items[0];
    expect(chat.kind).toBe('chat');
    expect(chat.messages).toHaveLength(3);
    expect(chat.messages[0]).toEqual({ role: 'user', content: 'combi or system boiler?' });
    expect(chat.messages[2].role).toBe('assistant');
    expect(() => ResearchProjects.addChat([], 'x')).toThrow(/no conversation to save/);
  });

  it('refuses to add anything when no project exists at all', () => {
    ResearchProjects.projects = [];
    localStorage.removeItem(ResearchProjects.ACTIVE_KEY);
    expect(() => ResearchProjects.addNote('x')).toThrow(/Make a project first/);
  });

  it('removes one item without disturbing the rest', () => {
    ResearchProjects.addNote('one');
    ResearchProjects.addNote('two');
    const p = ResearchProjects.active();
    ResearchProjects.removeItem(p.id, p.items[0].id);
    expect(ResearchProjects.active().items.map(i => i.text)).toEqual(['one']);
  });
});

describe('adding the page you are on', () => {
  it('files it under the project being worked on', async () => {
    ResearchProjects.create('Boiler');
    await ResearchProjects.addCurrentPage();
    expect(ResearchProjects.active().items[0]).toMatchObject({ kind: 'page', title: 'Best boilers' });
    expect(window.showToast).toHaveBeenCalledWith('Added to “Boiler”');
  });

  it('asks for a project the first time, rather than refusing', async () => {
    window.vexPrompt = vi.fn(async () => 'Boiler');
    await ResearchProjects.addCurrentPage();
    expect(window.vexPrompt).toHaveBeenCalled();
    expect(ResearchProjects.active().name).toBe('Boiler');
    expect(ResearchProjects.active().items).toHaveLength(1);
  });

  it('and adds nothing if you back out of naming it', async () => {
    window.vexPrompt = vi.fn(async () => null);
    expect(await ResearchProjects.addCurrentPage()).toBe(null);
    expect(ResearchProjects.list()).toEqual([]);
  });

  it('a private tab is not collected, here as everywhere', async () => {
    ResearchProjects.create('Boiler');
    TabManager.tabs[0].partition = 'private-1';
    await expect(ResearchProjects.addCurrentPage()).rejects.toThrow(/private tab is not collected/);
    expect(ResearchProjects.active().items).toEqual([]);
  });
});

describe('saving the conversation', () => {
  beforeEach(() => {
    ResearchProjects.create('Boiler');
    window.AIPanel = { _viewingId: null, _convPrivate: {}, _getConv: () => [{ role: 'user', content: 'combi or system?' }, { role: 'assistant', content: 'Depends.' }] };
  });

  it('keeps it with the research it belongs to, titled by what you asked', async () => {
    await ResearchProjects.addCurrentChat();
    expect(ResearchProjects.active().items[0]).toMatchObject({ kind: 'chat', title: 'combi or system?' });
  });

  it('a chat from a private tab is not collected', async () => {
    window.AIPanel._convPrivate = { 1: true };
    await expect(ResearchProjects.addCurrentChat()).rejects.toThrow(/private tab is not collected/);
  });

  it('says so when there is no panel', async () => {
    delete window.AIPanel;
    await expect(ResearchProjects.addCurrentChat()).rejects.toThrow(/not available/);
  });
});

describe('getting it back out', () => {
  it('exports as Markdown, grouped, with the conversation written out', () => {
    const p = ResearchProjects.create('Replacing the boiler');
    ResearchProjects.addPage('https://which.co.uk/boilers', 'Best boilers');
    ResearchProjects.addNote('Vaillant quoted £2,400');
    ResearchProjects.addChat([{ role: 'user', content: 'combi or system?' }, { role: 'assistant', content: 'Depends on bathrooms.' }], 'Boiler types');
    const md = ResearchProjects.toMarkdown(p.id);

    expect(md).toContain('# Replacing the boiler');
    expect(md).toContain('## Pages');
    expect(md).toContain('[Best boilers](https://which.co.uk/boilers) — which.co.uk');
    expect(md).toContain('## Notes');
    expect(md).toContain('- Vaillant quoted £2,400');
    expect(md).toContain('## Boiler types');
    expect(md).toContain('**You:** combi or system?');
    expect(md).toContain('**Vex:** Depends on bathrooms.');
    expect(md).not.toMatch(/\n{3,}/);              // no yawning gaps
  });

  it('leaves out the headings for what is not there', () => {
    const p = ResearchProjects.create('Empty-ish');
    ResearchProjects.addNote('just a note');
    const md = ResearchProjects.toMarkdown(p.id);
    expect(md).toContain('## Notes');
    expect(md).not.toContain('## Pages');
  });

  it('a square bracket in a title cannot break the link', () => {
    const p = ResearchProjects.create('X');
    ResearchProjects.addPage('https://example.com/a', 'Review [2026] of boilers');
    expect(ResearchProjects.toMarkdown(p.id)).toContain('[Review 2026 of boilers](https://example.com/a)');
  });

  it('says so for a project that is gone', () => {
    expect(() => ResearchProjects.toMarkdown('nope')).toThrow(/gone/);
  });
});

describe('the view', () => {
  it('lists projects with what is in them, and marks the one being worked on', () => {
    ResearchProjects.create('Boiler');
    ResearchProjects.addPage('https://a.example/1', 'One');
    ResearchProjects.addNote('a note');
    ResearchProjects.open();
    const row = document.querySelector('.vex-proj-box [data-body] > div');
    expect(row.textContent).toContain('Boiler');
    expect(row.textContent).toContain('1 page · 1 note');
    const name = [...row.querySelectorAll('div')].find(d => d.textContent === 'Boiler');
    expect(name.getAttribute('style')).toContain('font-weight:650');
  });

  it('opens a project and lists its contents, and a page opens in a tab', () => {
    const p = ResearchProjects.create('Boiler');
    ResearchProjects.addPage('https://a.example/1', 'One');
    ResearchProjects.open(p.id);
    const row = document.querySelector('[data-body] > div');
    expect(row.textContent).toContain('One');
    expect(row.textContent).toContain('a.example');
    row.click();
    expect(TabManager.createTab).toHaveBeenCalledWith('https://a.example/1', true);
  });

  it('copies the project as Markdown', async () => {
    const p = ResearchProjects.create('Boiler');
    ResearchProjects.addNote('a note');
    ResearchProjects.open(p.id);
    document.querySelector('[data-export]').click();
    await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('# Boiler')));
  });

  it('asks before opening a great many tabs at once', async () => {
    const p = ResearchProjects.create('Boiler');
    for (let i = 0; i < 7; i++) ResearchProjects.addPage('https://a.example/' + i, 'Page ' + i);
    ResearchProjects.open(p.id);
    document.querySelector('[data-openall]').click();
    await vi.waitFor(() => expect(window.vexConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Open 7 tabs?' })));
    await vi.waitFor(() => expect(TabManager.createTab).toHaveBeenCalledTimes(7));
  });

  it('opens a handful without asking', async () => {
    const p = ResearchProjects.create('Boiler');
    for (let i = 0; i < 3; i++) ResearchProjects.addPage('https://a.example/' + i, 'Page ' + i);
    ResearchProjects.open(p.id);
    document.querySelector('[data-openall]').click();
    await vi.waitFor(() => expect(TabManager.createTab).toHaveBeenCalledTimes(3));
    expect(window.vexConfirm).not.toHaveBeenCalled();
  });

  it('a project name cannot become markup', () => {
    ResearchProjects.create('<img src=x onerror=alert(1)>');
    ResearchProjects.open();
    const body = document.querySelector('[data-body]');
    expect(body.querySelector('img')).toBe(null);
    expect(body.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('Escape closes it, and opening twice leaves one', () => {
    ResearchProjects.open();
    ResearchProjects.open();
    expect(document.querySelectorAll('.vex-proj-overlay')).toHaveLength(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.vex-proj-overlay')).toBe(null);
  });

  it('says plainly when there is nothing yet', () => {
    ResearchProjects.open();
    expect(document.querySelector('[data-body]').textContent).toMatch(/No projects yet/);
  });
});

describe('highlights and references', () => {
  it('a highlight and its page share one reference, cited from what the page says about itself', () => {
    localStorage.clear();
    ResearchProjects.init();
    ResearchProjects.create('Tides');
    const meta = { title: 'How tides work', authors: ['Jane Q. Smith'], date: '2024-03-03', site: 'Ocean Journal', url: 'https://ocean.example/tides' };
    ResearchProjects.addQuote('The Moon pulls the sea.', { url: 'https://ocean.example/tides', title: 'How tides work', meta });
    ResearchProjects.addPage('https://ocean.example/tides', 'How tides work', null, meta);
    ResearchProjects.addPage('https://other.example/a', 'Another page');
    const md = ResearchProjects.toMarkdown(ResearchProjects.activeId());
    expect(md).toContain('## Highlights\n\n> The Moon pulls the sea.\n\n— How tides work [1]');
    expect(md).toMatch(/\[How tides work\]\(https:\/\/ocean\.example\/tides\) — ocean\.example \[1\]/);
    expect(md).toMatch(/\[Another page\]\(https:\/\/other\.example\/a\) — other\.example \[2\]/);
    expect(md).toContain('## References\n\n1. Smith, J. Q. (2024, March 3). How tides work. Ocean Journal. https://ocean.example/tides');
    expect(md).toMatch(/\n2\. Another page\. \(n\.d\.\)\. other\.example\. https:\/\/other\.example\/a/);
    // …in the style asked for.
    expect(ResearchProjects.toMarkdown(ResearchProjects.activeId(), { style: 'mla' })).toMatch(/1\. Smith, Jane Q\. "How tides work\."/);
  });

  it('a highlight needs text and a real page', () => {
    expect(() => ResearchProjects.addQuote('  ', { url: 'https://a.example' })).toThrow('Select some text');
    expect(() => ResearchProjects.addQuote('x', { url: 'file:///c:/x' })).toThrow('real web page');
  });
});
