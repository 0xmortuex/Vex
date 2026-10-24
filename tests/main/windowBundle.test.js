// The packaged window loads index.html's ~280 scripts as a few concatenated
// chunks (scripts/window-bundle.js, electron-builder's beforePack). These
// tests keep the chunks equal to index.html and refuse code that would act
// differently once concatenated.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const wb = require('../../scripts/window-bundle.js');

const root = path.resolve(__dirname, '../..');
const indexHtml = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');

// index.html's script tags, read independently of the bundler.
function tagsOf(html) {
  return [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)].map(m => m[1]);
}

describe('the window bundle matches index.html', () => {
  const plan = wb.plan(root);

  it('holds every script index.html loads, once, in index.html order', () => {
    const files = plan.chunks.flatMap(c => c.files);
    expect(files.length).toBeGreaterThan(200);
    expect(files).toEqual(tagsOf(indexHtml));
    for (const [i, chunk] of plan.chunks.entries()) {
      const order = [...plan.built[i].code.matchAll(/^;\/\/ ---- (.+)$/gm)].map(m => m[1]);
      expect(order).toEqual(chunk.files);
    }
  });

  it('can be bundled without changing behaviour (no problems found)', () => {
    expect(plan.problems).toEqual([]);
  });

  it('splits at the break comments, so problems.js and start-up each begin a chunk', () => {
    expect(plan.chunks.map(c => c.files[0])).toEqual(['js/early-look.js', '../diagnostics.js', 'js/problems.js', 'js/tabs.js', 'js/toolbox-workbench.js', 'js/app.js']);
  });

  it('the packaged page loads only the chunks, preloaded, and says how many there are', () => {
    const page = plan.page;
    expect(tagsOf(page)).toEqual(plan.chunks.map(c => c.name));
    for (const c of plan.chunks) {
      expect(page).toContain(`<script src="${c.name}" data-vex-window-bundle></script>`);
      expect(page).toContain(`<link rel="preload" as="script" href="${c.name}">`);
    }
    expect(page).toContain(`<meta name="vex-window-bundle" content="${plan.chunks.length}">`);
    // Everything else on the page is untouched.
    const strip = (h) => h.replace(/<script\b[^>]*><\/script>\s*/g, '').replace(/<!--\s*window-bundle: break[\s\S]*?-->\s*/g, '').replace(/^\s*<(meta name="vex-window-bundle"|link rel="preload" as="script")[^>]*>\s*$/gm, '').replace(/\s+/g, ' ');
    expect(strip(page)).toBe(strip(indexHtml));
  });

  it('every chunk parses and records that it finished', () => {
    plan.built.forEach((b, i) => {
      expect(() => new vm.Script(b.code)).not.toThrow();
      expect(b.code).toContain(`.push(${i + 1});\n//# sourceMappingURL=window-${i + 1}.js.map\n`);
      const map = JSON.parse(b.map);
      expect(map.sources).toEqual(plan.chunks[i].files.map(f => '../' + f));
      // One mapping per generated line before the trailer.
      expect(map.mappings.split(';').length).toBe(b.code.split('\n').length - 3);
    });
  });

  it('the chunks sit one folder under renderer/, like js/, so currentScript-relative URLs still resolve', () => {
    for (const c of plan.chunks) expect(c.name).toMatch(/^bundle\/window-\d+\.js$/);
  });

  it('electron-builder builds the chunks before every pack and ships them in place of the source page', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.build.beforePack).toBe('scripts/window-bundle.js');
    expect(pkg.build.files).toContain('!src/renderer/index.html');
    expect(pkg.build.files).toContainEqual({ from: 'build/window-bundle/src', to: 'src', filter: ['**/*'] });
    expect(typeof wb).toBe('function');
  });
});

describe('what concatenation would change is refused', () => {
  const run = (files) => wb.analyze([{ files: Object.keys(files) }], (src) => files[src]);

  it('keeps top-level const/let/class shared between files (nothing is wrapped)', () => {
    const ctx = vm.createContext({});
    const a = 'const Shared = { n: 1 };\nclass K {}\n', b = 'Shared.n++;\nvar seen = typeof K;\n';
    new vm.Script(';' + a + ';' + b).runInContext(ctx);
    new vm.Script('var later = Shared.n;').runInContext(ctx);
    expect(ctx.later).toBe(2);
    expect(ctx.seen).toBe('function');
    expect(run({ 'a.js': a, 'b.js': b })).toEqual([]);
  });

  it('a file touching a later file\'s const while it loads (typeof would throw bundled)', () => {
    const p = run({ 'a.js': 'if (typeof Later !== "undefined") Later.init();\n', 'b.js': 'const Later = {};\n' });
    expect(p.join('\n')).toMatch(/a\.js:1 uses Later while it loads, and Later is declared later by b\.js/);
  });

  it('also inside an IIFE or an array callback run at load, but not in a function called later', () => {
    expect(run({ 'a.js': '(function () { Later.x(); })();\n', 'b.js': 'class Later {}\n' })).toHaveLength(1);
    expect(run({ 'a.js': '[1].forEach(() => Later.x());\n', 'b.js': 'let Later = 1;\n' })).toHaveLength(1);
    expect(run({ 'a.js': 'document.addEventListener("click", () => Later.x());\nfunction f() { return typeof Later; }\n', 'b.js': 'const Later = 1;\n' })).toEqual([]);
    // A name the file declares itself, or a later var, behaves the same either way.
    expect(run({ 'a.js': 'const Later = 1; Later;\n', 'b.js': 'var Other = Later;\n' })).toEqual([]);
    expect(run({ 'a.js': 'typeof LaterVar;\n', 'b.js': 'var LaterVar = 1;\n' })).toEqual([]);
  });

  it('a later function declaration (hoisted into the earlier file\'s run)', () => {
    expect(run({ 'a.js': 'if (typeof helper === "function") helper();\n', 'b.js': 'function helper() {}\n' })).toHaveLength(1);
  });

  it('two files declaring the same function in one chunk', () => {
    expect(run({ 'a.js': 'function fmt() { return 1; }\n', 'b.js': 'function fmt() { return 2; }\n' }).join('\n')).toMatch(/both declare function fmt\(\)/);
  });

  it('a name declared by two files where one is const/let/class', () => {
    expect(run({ 'a.js': 'const X = 1;\n', 'b.js': 'var X = 2;\n' }).join('\n')).toMatch(/X is declared by both a\.js and b\.js/);
  });

  it('a file-level "use strict"', () => {
    expect(run({ 'a.js': '"use strict";\nvar a = 1;\n' }).join('\n')).toMatch(/starts with "use strict"/);
    expect(run({ 'a.js': '(function () { "use strict"; })();\n' })).toEqual([]);
  });

  it('a file that does not parse', () => {
    expect(() => run({ 'a.js': 'const = ;' })).toThrow(/a\.js does not parse/);
  });
});

describe('chunk boundaries', () => {
  it('splits at break comments and around any tag that is not a plain classic script, keeping those in place', () => {
    const html = [
      '<html><head></head><body>',
      '<script src="js/a.js"></script>',
      '<!-- <script src="js/commented.js"></script> -->',
      '<script src="js/b.js"></script>',
      '<!-- window-bundle: break - why -->',
      '<script src="js/c.js"></script>',
      '<script type="module" src="js/m.js"></script>',
      '<script src="js/d.js" defer></script>',
      '<script src="js/e.js"></script>',
      '</body></html>',
    ].join('\n');
    const chunks = wb.planChunks(html);
    expect(chunks.map(c => c.files)).toEqual([['js/a.js', 'js/b.js'], ['js/c.js'], ['js/e.js']]);
    expect(wb.pageScripts(html)).toEqual(['js/a.js', 'js/b.js', 'js/c.js', 'js/e.js']);
  });
});
