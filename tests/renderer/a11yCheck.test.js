// @vitest-environment jsdom
//
// The accessibility check: the common, certain failures, in words. The audit
// is the same function that runs inside the page, run here on a built page.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/page-export.js');
const { A11yCheck, auditPage } = require('../../src/renderer/js/a11y-check.js');

function page(html, { lang = 'en', title = 'A page' } = {}) {
  document.documentElement.setAttribute('lang', lang);
  if (!lang) document.documentElement.removeAttribute('lang');
  document.title = title;
  document.body.innerHTML = html;
  return auditPage(document, window, { assumeVisible: true });
}
const rules = (r) => r.issues.map(i => i.rule);

beforeEach(() => { document.body.innerHTML = ''; });

describe('the page itself', () => {
  it('a page with a language and a title passes', () => {
    expect(rules(page('<h1>Hello</h1>'))).toEqual([]);
  });
  it('says so when either is missing', () => {
    expect(rules(page('<h1>x</h1>', { lang: '', title: '' }))).toEqual(['lang', 'title']);
  });
});

describe('pictures', () => {
  it('no alt at all is a problem; alt="" is a deliberate "decorative" and is fine', () => {
    const r = page('<h1>x</h1><img src="a.png"><img src="b.png" alt=""><img src="c.png" alt="A boiler">');
    expect(rules(r)).toEqual(['img-alt']);
    expect(r.issues[0].snippet).toContain('a.png');
  });
  it('pictures hidden from screen readers on purpose are left alone', () => {
    expect(rules(page('<h1>x</h1><img src="a.png" aria-hidden="true"><img src="b.png" role="presentation"><div hidden><img src="c.png"></div>'))).toEqual([]);
  });
});

describe('form boxes', () => {
  it('a box with no label of any kind is a problem', () => {
    const r = page('<h1>x</h1><input type="text">');
    expect(r.issues[0]).toMatchObject({ rule: 'field-label', severity: 'error' });
  });
  it('a placeholder alone is only worth a look', () => {
    expect(page('<h1>x</h1><input placeholder="Email">').issues[0]).toMatchObject({ rule: 'field-label', severity: 'warning' });
  });
  it('every real way of labelling counts', () => {
    const html = '<h1>x</h1>'
      + '<label for="a">Name</label><input id="a">'
      + '<label>Email <input></label>'
      + '<input aria-label="Search">'
      + '<span id="l">Phone</span><input aria-labelledby="l">'
      + '<input title="Postcode">'
      + '<input type="hidden"><input type="submit">';
    expect(rules(page(html))).toEqual([]);
  });
});

describe('buttons and links', () => {
  it('an icon button with no name is a problem; one with a label or a titled svg is fine', () => {
    const r = page('<h1>x</h1><button><svg></svg></button><button aria-label="Close"><svg></svg></button><button><svg><title>Menu</title></svg></button><button>Save</button>');
    expect(rules(r)).toEqual(['button-name']);
  });
  it('a link with no words is a problem; an image link with alt text is fine', () => {
    const r = page('<h1>x</h1><a href="/a"></a><a href="/b"><img src="x.png" alt="Home"></a><a href="/c">Contact</a>');
    expect(rules(r)).toEqual(['link-name']);
  });
});

describe('headings', () => {
  it('no main heading is worth a look', () => {
    expect(page('<h2>Section</h2>').issues[0]).toMatchObject({ rule: 'headings', severity: 'warning' });
  });
  it('a skipped level is flagged at the heading that skips', () => {
    const r = page('<h1>Title</h1><h2>Part</h2><h4>Detail</h4><h2>Next</h2><h3>Fine</h3>');
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].message).toMatch(/from level 2 to 4/);
    expect(r.issues[0].snippet).toContain('Detail');
  });
});

describe('contrast', () => {
  it('grey on white body text fails; black on white passes', () => {
    const r = page('<h1>x</h1><p style="color:rgb(170,170,170);background:rgb(255,255,255)">faint</p><p style="color:rgb(0,0,0)">strong</p>');
    expect(rules(r)).toEqual(['contrast']);
    expect(r.issues[0].message).toMatch(/2\.3\d:1, where 4\.5:1 is the minimum for normal text/);
  });
  it('large text has the lower 3:1 bar', () => {
    // #767676 on white is 4.54:1 — passes both; #949494 is 3.03:1 — fails normal, passes large.
    const r = page('<h1>x</h1><p style="color:rgb(148,148,148);font-size:30px">big grey</p><p style="color:rgb(148,148,148);font-size:14px">small grey</p>');
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].snippet).toContain('small grey');
  });
  it('one report per colour pair, not one per paragraph', () => {
    const r = page('<h1>x</h1>' + '<p style="color:rgb(200,200,200)">faint</p>'.repeat(20));
    expect(r.issues.filter(i => i.rule === 'contrast')).toHaveLength(1);
    expect(r.counts.contrast).toBe(20);
  });
  it('text over a picture is not guessed at', () => {
    expect(rules(page('<h1>x</h1><div style="background-image:url(a.png)"><p style="color:rgb(200,200,200)">over a photo</p></div>'))).toEqual([]);
  });
});

describe('limits and marking', () => {
  it('stops listing after 60 of one kind but keeps counting', () => {
    const r = page('<h1>x</h1>' + '<img src="a.png">'.repeat(80));
    expect(r.issues).toHaveLength(60);
    expect(r.counts['img-alt']).toBe(80);
  });
  it('marks each flagged element so it can be shown on the page', () => {
    const r = page('<h1>x</h1><img src="a.png"><input>');
    for (const i of r.issues) expect(document.querySelector('[data-vex-a11y="' + i.index + '"]')).not.toBe(null);
  });
});

describe('the sheet', () => {
  beforeEach(() => {
    window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.showToast = vi.fn();
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  });

  it('runs the audit in the page and shows it grouped, problems marked', async () => {
    const wv = { getURL: () => 'https://shop.example/' };
    globalThis.WebviewManager = { getActiveWebview: () => wv };
    const result = { issues: [
      { rule: 'img-alt', severity: 'error', message: 'A picture with no description.', snippet: '<img src="a.png">', index: 0 },
      { rule: 'contrast', severity: 'warning', message: 'Text too faint', snippet: '<p>x</p>', index: 1 },
    ], counts: { 'img-alt': 1, contrast: 3 } };
    window.vexGuestEval = vi.fn(async (_w, code) => (code.includes('data-vex-a11y="') ? true : result));
    await A11yCheck.run();
    expect(window.vexGuestEval.mock.calls[0][1]).toContain('function auditPage');
    const text = document.querySelector('.vex-a11y-overlay').textContent;
    expect(text).toContain('1 problem and 1 to look at');
    expect(text).toContain('Pictures with no description · 1');
    expect(text).toContain('Text too faint · 3');
    expect(text).toContain('…and 2 more like these');
    document.querySelector('[data-find]').click();
    expect(window.vexGuestEval.mock.calls.at(-1)[1]).toContain('[data-vex-a11y="0"]');
  });

  it('the report names the page and lists everything', () => {
    const r = page('<h1>x</h1><img src="a.png">', { lang: '' });
    const text = A11yCheck.report(r, 'https://shop.example/');
    expect(text).toMatch(/^Accessibility check — https:\/\/shop\.example\//);
    expect(text).toContain('Page language (1)');
    expect(text).toContain('Pictures with no description (1)');
  });

  it('a clean page says so, and says what that does and does not mean', () => {
    expect(A11yCheck.summary({ issues: [], counts: {} })).toMatch(/not a full audit/);
  });

  it('page content in a finding cannot become markup', async () => {
    globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => '' }) };
    window.vexGuestEval = vi.fn(async () => ({ issues: [{ rule: 'img-alt', severity: 'error', message: 'x', snippet: '<img src=x onerror=alert(1)>', index: 0 }], counts: {} }));
    await A11yCheck.run();
    expect(document.querySelector('.vex-a11y-overlay img')).toBe(null);
  });
});

describe('reading well', () => {
  beforeEach(() => {
    window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  });
  it('a snippet is the page\'s own markup, without the marker Vex adds', () => {
    const r = page('<h1>x</h1><img src="a.png">');
    expect(r.issues[0].snippet).toBe('<img src="a.png">');
    expect(document.querySelector('img').getAttribute('data-vex-a11y')).toBe('0');
  });
  it('the same finding is said once, with each element listed under it', async () => {
    const r = page('<h1>x</h1><img src="a.png"><img src="b.png"><img src="c.png">');
    globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => '' }) };
    window.vexGuestEval = vi.fn(async () => r);
    await A11yCheck.run();
    const text = document.querySelector('.vex-a11y-overlay').textContent;
    expect(text.split('A picture with no description').length - 1).toBe(1);
    for (const f of ['a.png', 'b.png', 'c.png']) expect(text).toContain(f);
    const report = A11yCheck.report(r, '');
    expect(report.split('A picture with no description').length - 1).toBe(1);
    expect(report).toContain('    <img src="c.png">');
  });
});
