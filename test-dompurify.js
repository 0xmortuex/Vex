const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('');
const DOMPurify = createDOMPurify(dom.window);

const test1 = '<div style="background: expression(alert(1));">test</div>';
const result1 = DOMPurify.sanitize(test1, { USE_PROFILES: { html: true } });
console.log('Inline style test:');
console.log('Input:', test1);
console.log('Output:', result1);

const test2 = '<style>@import url(evil.css); body { background: expression(alert(1)); }</style><p>test</p>';
const result2 = DOMPurify.sanitize(test2, { USE_PROFILES: { html: true }, FORCE_BODY: true });
console.log('\nStyle tag test:');
console.log('Input:', test2);
console.log('Output:', result2);
