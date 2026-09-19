// === A page as an e-book ====================================================
//
// An EPUB is a zip with a fixed shape: a `mimetype` file first and
// uncompressed, a container file pointing at the package document, the
// package listing the chapter, and the chapter itself as XHTML. One chapter
// here — the page's readable text, as the renderer extracted it — with its
// title, address and the date it was saved, so the book says where it came
// from. Pictures are left out: an e-book reader has no network to fetch them.
const AdmZip = require('adm-zip');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function buildEpub({ title, url, xhtmlBody, date = new Date(), id }) {
  if (!xhtmlBody || !String(xhtmlBody).trim()) throw new Error('The page had no readable text to put in a book');
  const name = String(title || url || 'Page').slice(0, 200);
  const uid = id || 'urn:vex:' + Date.now().toString(36);
  const when = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  // noSort: adm-zip sorts entries by name by default, which put mimetype
  // second — and a reader identifies an EPUB by it being first.
  const zip = new AdmZip(undefined, { noSort: true });
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  // Stored, not deflated: readers find the type by reading these bytes raw.
  zip.getEntry('mimetype').header.method = 0;
  zip.addFile('META-INF/container.xml', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n'
    + '  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n</container>\n'));
  zip.addFile('OEBPS/content.opf', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">\n'
    + '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
    + `    <dc:identifier id="uid">${esc(uid)}</dc:identifier>\n    <dc:title>${esc(name)}</dc:title>\n    <dc:language>en</dc:language>\n`
    + (url ? `    <dc:source>${esc(url)}</dc:source>\n` : '')
    + `    <meta property="dcterms:modified">${when}</meta>\n  </metadata>\n`
    + '  <manifest>\n    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n'
    + '    <item id="page" href="page.xhtml" media-type="application/xhtml+xml"/>\n  </manifest>\n'
    + '  <spine><itemref idref="page"/></spine>\n</package>\n'));
  zip.addFile('OEBPS/nav.xhtml', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>'
    + `<body><nav epub:type="toc"><ol><li><a href="page.xhtml">${esc(name)}</a></li></ol></nav></body></html>\n`));
  zip.addFile('OEBPS/page.xhtml', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${esc(name)}</title></head><body>\n`
    + `<h1>${esc(name)}</h1>\n`
    + (url ? `<p><small>From <a href="${esc(url)}">${esc(url)}</a>, saved ${esc(date.toDateString())}.</small></p>\n` : '')
    + String(xhtmlBody) + '\n</body></html>\n'));
  return zip.toBuffer();
}

module.exports = { buildEpub };
