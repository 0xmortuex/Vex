const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('');
const DOMPurify = createDOMPurify(dom.window);

const test1 = '<div style="background: expression(alert(1));">test</div>';
const result1 = DOMPurify.sanitize(test1, { USE_PROFILES: { html: true } });
console.log('expression() test:');
console.log('Input:', test1);
console.log('Output:', result1);

const test2 = '<div style="behavior: url(evil.htc);">test</div>';
const result2 = DOMPurify.sanitize(test2, { USE_PROFILES: { html: true } });
console.log('\nbehavior test:');
console.log('Input:', test2);
console.log('Output:', result2);

const test3 = '<div style="color: red; background: url(javascript:alert(1));">test</div>';
const result3 = DOMPurify.sanitize(test3, { USE_PROFILES: { html: true } });
console.log('\njavascript URL test:');
console.log('Input:', test3);
console.log('Output:', result3);
