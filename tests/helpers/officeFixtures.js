'use strict';
// Small writers for test documents: a .docx, .xlsx, .pptx, .epub, .odt/.ods/.odp, .rtf, a password-protected Office file and a
// damaged zip. They are made with fflate (already in node_modules) so a test needs no files on disk. Used by the unit tests and by
// the scripts that drive the real viewer.
const { zipSync, strToU8 } = require('fflate');

// A 2x2 PNG, red, green, blue, white.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8Dwn4GBgYGJAQoAHhgCAh6X4CYAAAAASUVORK5CYII=', 'base64');
const png = () => new Uint8Array(PNG);

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const zip = (files, opts) => {
  const o = {};
  for (const [k, v] of Object.entries(files)) o[k] = typeof v === 'string' ? strToU8(v) : v;
  return Buffer.from(zipSync(o, opts || { level: 6 }));
};

// ---- Word -------------------------------------------------------------------------------------------------
function docx(opts = {}) {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
  const r = (text, rpr) => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  const p = (inner, ppr) => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;
  const body = [];
  body.push(p(r('Field notes on tides'), '<w:pStyle w:val="Title"/>'));
  body.push(p(r('1. Why the sea moves'), '<w:pStyle w:val="Heading1"/>'));
  body.push(p(r('Tides are the ') + r('rise and fall', '<w:b/>') + r(' of sea levels, caused by the ') + r('Moon', '<w:i/>') + r(' and the Sun. ')
    + '<w:hyperlink r:id="rIdLink"><w:r><w:t>Read more</w:t></w:r></w:hyperlink>' + r(' or jump to the ') + '<w:hyperlink w:anchor="summary"><w:r><w:t>summary</w:t></w:r></w:hyperlink>' + r('.')
    + '<w:r><w:footnoteReference w:id="2"/></w:r>'));
  body.push(p(r('Coloured text', '<w:color w:val="C00000"/>') + r(' and highlighted text', '<w:highlight w:val="yellow"/>') + r(' and black-on-dark risk', '<w:color w:val="000000"/>')));
  body.push(p(r('Things to bring'), '<w:pStyle w:val="Heading2"/>'));
  body.push(p(r('A notebook'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'));
  body.push(p(r('A pencil'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'));
  body.push(p(r('A sharper pencil'), '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>'));
  body.push(p(r('First step'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>'));
  body.push(p(r('Second step'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>'));
  body.push(p(r('Measurements'), '<w:pStyle w:val="Heading2"/>'));
  body.push(`<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>`
    + `<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Place</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Height (m)</w:t></w:r></w:p></w:tc></w:tr>`
    + `<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Harbour</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="FFF2CC"/></w:tcPr><w:p><w:r><w:t>High</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>4.2</w:t></w:r></w:p></w:tc></w:tr>`
    + `<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>Low</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>0.3</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`);
  body.push(p(r('A picture:') + `<w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="Pic" descr="A tiny test picture"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
    + `<w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><wp:docPr id="2" name="Ext"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:link="rIdExt"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`));
  body.push(p(r('Reviewed text: ') + '<w:ins w:id="10" w:author="Ada" w:date="2026-05-01T10:00:00Z"><w:r><w:t>this was added</w:t></w:r></w:ins>' + r(' and ') + '<w:del w:id="11" w:author="Bob" w:date="2026-05-02T10:00:00Z"><w:r><w:delText>this was removed</w:delText></w:r></w:del>' + r('.')));
  body.push(p('<w:commentRangeStart w:id="0"/>' + r('A remark lives on this sentence.') + '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>'));
  body.push(p('<m:oMath><m:r><m:t>E=mc2</m:t></m:r></m:oMath>'));
  body.push(p('<w:bookmarkStart w:id="5" w:name="summary"/>' + r('Summary') + '<w:bookmarkEnd w:id="5"/>', '<w:pStyle w:val="Heading1"/>'));
  body.push(p(r('Tides follow the Moon.')));
  if (opts.paragraphs) for (let i = 0; i < opts.paragraphs; i++) body.push(p(r(`Filler paragraph number ${i} about the sea and its habits.`)));
  const doc = `${XML}<w:document ${W}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const styles = `${XML}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>`
    + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>';
  const numbering = `${XML}<w:numbering ${W}>`
    + '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>'
    + '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>'
    + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>';
  const footnotes = `${XML}<w:footnotes ${W}><w:footnote w:type="separator" w:id="0"><w:p/></w:footnote><w:footnote w:id="2"><w:p><w:r><w:t>Spring tides are the strongest.</w:t></w:r></w:p></w:footnote></w:footnotes>`;
  const comments = `${XML}<w:comments ${W}><w:comment w:id="0" w:author="Ada" w:date="2026-05-03T09:00:00Z" w:initials="A"><w:p><w:r><w:t>Check this against the almanac.</w:t></w:r></w:p></w:comment></w:comments>`;
  const rels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/tides" TargetMode="External"/>'
    + '<Relationship Id="rIdExt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://tracker.example/pixel.png" TargetMode="External"/>'
    + '<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>'
    + '<Relationship Id="rIdSt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
    + '<Relationship Id="rIdFn" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>'
    + '<Relationship Id="rIdCm" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>';
  const files = {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': doc, 'word/styles.xml': styles, 'word/numbering.xml': numbering, 'word/footnotes.xml': footnotes, 'word/comments.xml': comments,
    'word/_rels/document.xml.rels': rels, 'word/media/image1.png': png(),
    'docProps/core.xml': `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Field notes on tides</dc:title><dc:creator>Ada</dc:creator></cp:coreProperties>`,
  };
  if (opts.macros) files['word/vbaProject.bin'] = new Uint8Array([1, 2, 3]);
  return zip(files);
}

// ---- Excel ------------------------------------------------------------------------------------------------
const colName = (c) => { let s = ''; c += 1; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
function xlsx(opts = {}) {
  const rows = opts.rows || 5000;
  const shared = ['Item', 'Date', 'Qty', 'Price', 'Total', 'Note'];
  const sIndex = new Map(shared.map((s, i) => [s, i]));
  const sst = (s) => { if (!sIndex.has(s)) { sIndex.set(s, shared.length); shared.push(s); } return sIndex.get(s); };
  const out = [];
  out.push(`<row r="1" ht="24" customHeight="1">${['Item', 'Date', 'Qty', 'Price', 'Total', 'Note'].map((h, c) => `<c r="${colName(c)}1" t="s" s="1"><v>${sst(h)}</v></c>`).join('')}</row>`);
  for (let i = 2; i <= rows + 1; i++) {
    const day = 45000 + i;                    // an Excel date serial
    const item = 'Item ' + ((i * 7919) % 997);
    out.push(`<row r="${i}"><c r="A${i}" t="s"><v>${sst(item)}</v></c><c r="B${i}" s="2"><v>${day}</v></c><c r="C${i}"><v>${(i % 9) + 1}</v></c><c r="D${i}" s="3"><v>${(i % 50) + 0.25}</v></c>`
      + `<c r="E${i}" s="3"><f>C${i}*D${i}</f><v>${((i % 9) + 1) * ((i % 50) + 0.25)}</v></c>`
      + (i === 3 ? `<c r="F${i}" t="s"><v>${sst('Merged note across three columns')}</v></c>` : '') + '</row>');
  }
  const sheetXml = `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + '<cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="14" customWidth="1"/><col min="6" max="6" width="30" customWidth="1"/></cols>'
    + `<sheetData>${out.join('')}</sheetData><autoFilter ref="A1:F${rows + 1}"/><mergeCells count="1"><mergeCell ref="F3:H3"/></mergeCells></worksheet>`;
  const sheet2 = `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Second sheet</t></is></c><c r="B1" t="b"><v>1</v></c><c r="C1" t="e"><v>#DIV/0!</v></c></row>`
    + '<row r="2"><c r="A2"><v>0.1234</v></c><c r="B2" s="4"><v>0.256</v></c><c r="C2" s="5"><v>1234567.891</v></c><c r="D2"><f>SUM(A2:C2)</f><v>1234568.2704</v></c></row></sheetData></worksheet>';
  const sstXml = `${XML}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`;
  const styles = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00 &quot;TL&quot;"/></numFmts>`
    + '<fonts count="2"><font><sz val="11"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/></patternFill></fill></fills>'
    + '<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0"/><xf numFmtId="0" fontId="1" fillId="2"/><xf numFmtId="14" fontId="0" fillId="0"/><xf numFmtId="164" fontId="0" fillId="0"/><xf numFmtId="9" fontId="0" fillId="0"/><xf numFmtId="4" fontId="0" fillId="0"/></cellXfs></styleSheet>';
  const files = {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/><sheet name="Odds &amp; ends" sheetId="2" r:id="rId2"/><sheet name="Hidden" sheetId="3" state="hidden" r:id="rId3"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="x/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': sheetXml, 'xl/worksheets/sheet2.xml': sheet2, 'xl/sharedStrings.xml': sstXml, 'xl/styles.xml': styles,
  };
  if (opts.macros) files['xl/vbaProject.bin'] = new Uint8Array([1, 2, 3]);
  return zip(files);
}

// ---- PowerPoint ---------------------------------------------------------------------------------------------
function pptx(opts = {}) {
  const n = opts.slides || 30;
  const NSP = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const files = {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    'ppt/media/image1.png': png(),
    'ppt/slideMasters/slideMaster1.xml': `${XML}<p:sldMaster ${NSP}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="609600" y="274638"/><a:ext cx="10972800" cy="1143000"/></a:xfrm></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="609600" y="1600200"/><a:ext cx="10972800" cy="4525963"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4000" b="1"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2400"/></a:lvl1pPr></p:bodyStyle></p:txStyles></p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
    'ppt/slideLayouts/slideLayout1.xml': `${XML}<p:sldLayout ${NSP}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp></p:spTree></p:cSld></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  };
  const ids = [], prel = [];
  for (let i = 1; i <= n; i++) {
    const pic = i % 5 === 0 ? `<p:pic><p:nvPicPr><p:cNvPr id="9" name="Pic" descr="Test picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/></p:blipFill><p:spPr><a:xfrm><a:off x="8000000" y="4000000"/><a:ext cx="2000000" cy="2000000"/></a:xfrm></p:spPr></p:pic>` : '';
    const tbl = i % 7 === 0 ? `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="10" name="Tbl"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="609600" y="4300000"/><a:ext cx="6000000" cy="1000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="3000000"/><a:gridCol w="3000000"/></a:tblGrid><a:tr h="370840"><a:tc><a:txBody><a:p><a:r><a:t>Cell A</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Cell B</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>` : '';
    const chart = i === 9 ? '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="11" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="609600" y="4000000"/><a:ext cx="4000000" cy="2000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></p:graphicFrame>' : '';
    files[`ppt/slides/slide${i}.xml`] = `${XML}<p:sld ${NSP}><p:cSld><p:spTree>`
      + `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Slide ${i}: ${i === 1 ? 'The sea and its tides' : 'Point number ' + i}</a:t></a:r></a:p></p:txBody></p:sp>`
      + `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:pPr lvl="0"/><a:r><a:rPr b="1"/><a:t>Bold start </a:t></a:r><a:r><a:t>then plain text on slide ${i}</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:rPr><a:solidFill><a:srgbClr val="C00000"/></a:solidFill></a:rPr><a:t>A red sub point</a:t></a:r></a:p></p:txBody></p:sp>`
      + `<p:sp><p:nvSpPr><p:cNvPr id="4" name="Box"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="609600" y="5500000"/><a:ext cx="2500000" cy="800000"/></a:xfrm><a:prstGeom prst="roundRect"/><a:solidFill><a:srgbClr val="1F4E78"/></a:solidFill></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1800"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Box ${i}</a:t></a:r></a:p></p:txBody></p:sp>`
      + pic + tbl + chart + '</p:spTree></p:cSld></p:sld>';
    files[`ppt/slides/_rels/slide${i}.xml.rels`] = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${i}.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`;
    files[`ppt/notesSlides/notesSlide${i}.xml`] = `${XML}<p:notes ${NSP}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="n"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Speaker note for slide ${i}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
    ids.push(`<p:sldId id="${255 + i}" r:id="rIdS${i}"/>`);
    prel.push(`<Relationship Id="rIdS${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i}.xml"/>`);
  }
  files['ppt/presentation.xml'] = `${XML}<p:presentation ${NSP}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM"/></p:sldMasterIdLst><p:sldIdLst>${ids.join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`;
  files['ppt/_rels/presentation.xml.rels'] = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdM" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${prel.join('')}</Relationships>`;
  return zip(files);
}

// ---- EPUB ---------------------------------------------------------------------------------------------------
function epub(opts = {}) {
  const n = opts.chapters || 4;
  const files = {};
  files.mimetype = 'application/epub+zip';
  files['META-INF/container.xml'] = `${XML}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  const manifest = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', '<item id="img1" href="images/dot.png" media-type="image/png"/>', '<item id="css" href="book.css" media-type="text/css"/>'];
  const spine = [], toc = [];
  for (let i = 1; i <= n; i++) {
    manifest.push(`<item id="c${i}" href="ch${i}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="c${i}"/>`);
    toc.push(`<li><a href="ch${i}.xhtml">Chapter ${i}: ${i === 1 ? 'The shore' : 'Stage ' + i}</a>${i === 2 ? '<ol><li><a href="ch2.xhtml#part">Part of two</a></li></ol>' : ''}</li>`);
    let paras = '';
    for (let k = 0; k < (opts.paragraphs || 14); k++) paras += `<p>${k === 0 ? '<img src="images/dot.png" alt="A dot"/> ' : ''}In chapter ${i}, paragraph ${k}, the tide came in over the grey sand and the gulls complained about it to anyone who would listen, which was nobody at all.</p>`;
    files[`OEBPS/ch${i}.xhtml`] = `${XML}<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${i}</title><link rel="stylesheet" href="book.css"/><script>window.evil=1</script></head><body><h1>Chapter ${i}</h1>${paras}${i === 2 ? '<h2 id="part">Part of two</h2><p>Second half <a href="ch3.xhtml">next chapter</a> <a href="https://example.org/x">outside</a> <a href="javascript:alert(1)">bad</a></p>' : ''}</body></html>`;
  }
  files['OEBPS/nav.xhtml'] = `${XML}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${toc.join('')}</ol></nav></body></html>`;
  files['OEBPS/content.opf'] = `${XML}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:test:book</dc:identifier><dc:title>The Grey Shore</dc:title><dc:creator>I. Tester</dc:creator><dc:language>en</dc:language></metadata><manifest>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>`;
  files['OEBPS/images/dot.png'] = png();
  files['OEBPS/book.css'] = 'body { color: #aa0000; } p { text-indent: 1em; }';
  // mimetype first and stored
  const ordered = {};
  ordered.mimetype = [strToU8(files.mimetype), { level: 0 }];
  for (const [k, v] of Object.entries(files)) if (k !== 'mimetype') ordered[k] = typeof v === 'string' ? strToU8(v) : v;
  return Buffer.from(zipSync(ordered));
}

// ---- OpenDocument -------------------------------------------------------------------------------------------
const ODF_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"';
function odf(mime, content, extra) {
  const files = { mimetype: [strToU8(mime), { level: 0 }], 'META-INF/manifest.xml': strToU8(`${XML}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>`), 'content.xml': strToU8(content) };
  for (const [k, v] of Object.entries(extra || {})) files[k] = typeof v === 'string' ? strToU8(v) : v;
  return Buffer.from(zipSync(files));
}
function odt() {
  return odf('application/vnd.oasis.opendocument.text', `${XML}<office:document-content ${ODF_NS}><office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style><style:style style:name="T2" style:family="text"><style:text-properties fo:font-style="italic"/></style:style></office:automatic-styles><office:body><office:text>`
    + '<text:h text:outline-level="1">Open document heading</text:h><text:p>Plain, <text:span text:style-name="T1">bold</text:span>, <text:span text:style-name="T2">italic</text:span> and a <text:a xlink:href="https://example.org/">link</text:a>.<text:note text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>An ODF footnote.</text:p></text:note-body></text:note></text:p>'
    + '<text:list><text:list-item><text:p>one</text:p></text:list-item><text:list-item><text:p>two</text:p></text:list-item></text:list>'
    + '<table:table><table:table-row><table:table-cell><text:p>A1</text:p></table:table-cell><table:table-cell table:number-columns-spanned="2"><text:p>B1</text:p></table:table-cell><table:covered-table-cell/></table:table-row></table:table>'
    + '<text:p><draw:frame svg:width="2cm" svg:height="2cm"><draw:image xlink:href="Pictures/p.png"/></draw:frame><office:annotation><dc:creator>Ada</dc:creator><text:p>An ODF comment</text:p></office:annotation></text:p>'
    + '</office:text></office:body></office:document-content>', { 'Pictures/p.png': png() });
}
function ods() {
  return odf('application/vnd.oasis.opendocument.spreadsheet', `${XML}<office:document-content ${ODF_NS} xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"><office:body><office:spreadsheet><table:table table:name="Grades">`
    + '<table:table-row><table:table-cell office:value-type="string"><text:p>Name</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Score</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Date</text:p></table:table-cell></table:table-row>'
    + '<table:table-row table:number-rows-repeated="2"><table:table-cell office:value-type="string"><text:p>Ada</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="93.5" table:formula="of:=SUM([.B1];10)"><text:p>93.5</text:p></table:table-cell><table:table-cell office:value-type="date" office:date-value="2026-03-04"><text:p>04.03.2026</text:p></table:table-cell></table:table-row>'
    + '</table:table></office:spreadsheet></office:body></office:document-content>');
}
function odp() {
  return odf('application/vnd.oasis.opendocument.presentation', `${XML}<office:document-content ${ODF_NS}><office:body><office:presentation>`
    + '<draw:page draw:name="One"><draw:frame svg:x="2cm" svg:y="1cm" svg:width="20cm" svg:height="3cm"><draw:text-box><text:p>ODP slide one title</text:p></draw:text-box></draw:frame><draw:frame svg:x="2cm" svg:y="6cm" svg:width="6cm" svg:height="6cm"><draw:image xlink:href="Pictures/p.png"/></draw:frame><presentation:notes><draw:frame><draw:text-box><text:p>ODP note</text:p></draw:text-box></draw:frame></presentation:notes></draw:page>'
    + '<draw:page draw:name="Two"><draw:frame svg:x="2cm" svg:y="1cm" svg:width="20cm" svg:height="3cm"><draw:text-box><text:p>Second slide</text:p></draw:text-box></draw:frame></draw:page>'
    + '</office:presentation></office:body></office:document-content>', { 'Pictures/p.png': png() });
}

function rtf() {
  return Buffer.from('{\\rtf1\\ansi\\ansicpg1254\\deff0{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red255\\green0\\blue0;}\\pard\\b Title line\\b0\\par Plain and {\\i italic} and {\\ul underlined} text, Turkish: \\\'fd\\\'f0\\\'fe \\u351?\\u287?\\par {\\pard\\li720 Indented paragraph\\par}'
    + '\\trowd\\cellx3000\\cellx6000 \\intbl Cell one\\cell \\intbl Cell two\\cell\\row \\pard After the table.\\par}', 'latin1');
}

// ---- things that must be refused --------------------------------------------------------------------------------
// A password-protected Office file is not a zip: it is an OLE container that begins with these 8 bytes.
function encrypted() { const b = Buffer.alloc(4096); Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(b, 0); Buffer.from('EncryptionInfo', 'utf16le').copy(b, 600); return b; }
// An old binary .doc has the same beginning; the viewer tells the two apart by what the address says it should be.
const legacy = encrypted;
function corrupt(good) { const g = good || docx(); return g.subarray(0, Math.floor(g.length * 0.6)); }
function notAZip() { return Buffer.from('This is plain text, not a document package.\n'.repeat(20)); }

module.exports = { docx, xlsx, pptx, epub, odt, ods, odp, rtf, encrypted, legacy, corrupt, notAZip, png, zip, colName };
