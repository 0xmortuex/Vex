// @vitest-environment jsdom
//
// "Save Page as Markdown / as an E-book": the article, not the menus around
// it, as Markdown; and the same as clean XHTML for an EPUB.
import { describe, it, expect } from 'vitest';
const { vexReadablePage } = require('../../src/renderer/js/page-export.js');
const zlib = require('zlib');
const { buildEpub } = require('../../src/main/epub.js');

const PAGE = `
  <nav><a href="/">Home</a> <a href="/about">About</a></nav>
  <header>Site banner</header>
  <article>
    <h1>How tides work</h1>
    <p>The <strong>Moon</strong> pulls the sea, as <a href="/moon">this page</a> explains.</p>
    <ul><li>High tide</li><li>Low tide</li></ul>
    <pre>tide = moon + sun</pre>
    <table><tr><th>Place</th><th>Range</th></tr><tr><td>Bay of Fundy</td><td>16 m</td></tr></table>
    <img src="/tide.png" alt="A tide chart">
    <form><input value="subscribe"></form>
    <aside>Related posts</aside>
  </article>
  <footer>Copyright</footer>`;

describe('the readable page', () => {
  it('is the article as Markdown, without the site around it', () => {
    document.title = 'Tides';
    document.body.innerHTML = PAGE;
    const r = vexReadablePage();
    expect(r.title).toBe('Tides');
    expect(r.markdown).toContain('# How tides work');
    expect(r.markdown).toContain('The **Moon** pulls the sea, as [this page](http://localhost:3000/moon) explains.');
    expect(r.markdown).toContain('- High tide\n- Low tide');
    expect(r.markdown).toContain('```\ntide = moon + sun\n```');
    expect(r.markdown).toContain('| Place | Range |\n| --- | --- |\n| Bay of Fundy | 16 m |');
    expect(r.markdown).toContain('![A tide chart](http://localhost:3000/tide.png)');
    for (const gone of ['Home', 'Site banner', 'Related posts', 'Copyright', 'subscribe']) expect(r.markdown).not.toContain(gone);
  });

  it('and as XHTML with only plain tags, absolute links, and pictures as their words', () => {
    document.body.innerHTML = PAGE.replace('<p>', '<p class="lead" onclick="x()" style="color:red">');
    const { xhtml } = vexReadablePage();
    expect(xhtml).toContain('<p>The <strong>Moon</strong>');
    expect(xhtml).toContain('<a href="http://localhost:3000/moon">this page</a>');
    expect(xhtml).not.toMatch(/onclick|style=|class=|<img|<form/);
    expect(xhtml).toContain('A tide chart');
  });
});

// The entries of a zip, in file order, read straight from the local headers.
function unzip(buf) {
  const out = {};
  for (let i = 0; buf.readUInt32LE(i) === 0x04034b50;) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), n = buf.readUInt16LE(i + 26), x = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + n).toString();
    const data = buf.slice(i + 30 + n + x, i + 30 + n + x + size);
    out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString();
    i += 30 + n + x + size;
  }
  return out;
}

describe('the e-book', () => {
  it('is a valid EPUB shape: mimetype first and stored, then the package and the page', () => {
    const buf = buildEpub({ title: 'How tides work & why', url: 'https://tides.example/a', xhtmlBody: '<p>The Moon pulls the sea.</p>', date: new Date('2026-09-19T12:00:00Z') });
    // The first entry IN THE FILE (a listing may sort): name, and stored (0).
    expect(buf.slice(30, 30 + buf.readUInt16LE(26)).toString()).toBe('mimetype');
    expect(buf.readUInt16LE(8)).toBe(0);
    const files = unzip(buf);
    expect(Object.keys(files)).toEqual(['mimetype', 'META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/page.xhtml']);
    expect(files.mimetype).toBe('application/epub+zip');
    expect(files['META-INF/container.xml']).toContain('full-path="OEBPS/content.opf"');
    const opf = files['OEBPS/content.opf'];
    expect(opf).toContain('<dc:title>How tides work &amp; why</dc:title>');
    expect(opf).toContain('<dc:source>https://tides.example/a</dc:source>');
    const page = files['OEBPS/page.xhtml'];
    expect(page).toContain('<p>The Moon pulls the sea.</p>');
    expect(page).toContain('From <a href="https://tides.example/a">');
  });

  it('refuses a page with nothing to read', () => {
    expect(() => buildEpub({ title: 't', url: 'u', xhtmlBody: '  ' })).toThrow('no readable text');
  });
});
