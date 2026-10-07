// Release tooling: what ships, what the build may delete, and who moves the
// website badge.
//  - The AI/OCR runtimes load from src/renderer/vendor/runtime; their npm
//    packages were packed into app.asar a second time (~224 MB) and pulled a
//    high-severity sharp advisory into the shipped tree.
//  - `rimraf dist` deleted a Vex the owner was running from dist\.
//  - release.js moved the website badge 12–14 minutes before the release
//    existed; post-publish moves it once the release is proved.

import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const pkg = require('../../package.json');
const { runningFrom } = require('../../scripts/check-dist-free.js');

describe('the vendored runtimes', () => {
  it('their npm packages are build-time only, so they are not packed into app.asar', () => {
    for (const name of ['@huggingface/transformers', '@mlc-ai/web-llm', 'tesseract.js']) {
      expect(pkg.dependencies[name]).toBeUndefined();
      expect(pkg.devDependencies[name]).toBeTruthy();
    }
  });

  it('nothing outside vendor/runtime requires or imports them', () => {
    const hits = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!p.includes(path.join('vendor', 'runtime'))) walk(p); continue; }
        if (!/\.(m?js|html)$/.test(e.name)) continue;
        const src = fs.readFileSync(p, 'utf8');
        if (/(?:require\(|from\s+|import\()\s*['"](?:@huggingface\/|@mlc-ai\/|tesseract\.js|onnxruntime-)/.test(src)) hits.push(path.relative(root, p));
      }
    };
    walk(path.join(root, 'src'));
    expect(hits).toEqual([]);
  });

  it('only the tesseract core builds the browser loads (*.wasm.js) are copied', () => {
    const src = fs.readFileSync(path.join(root, 'scripts/bundle-browser-libs.js'), 'utf8');
    expect(src).toMatch(/file\.endsWith\('\.wasm\.js'\)/);
  });
});

describe('the build never deletes a running Vex', () => {
  it('every script that empties dist\\ checks first', () => {
    for (const name of ['dist', 'dist:win', 'publish']) {
      const s = pkg.scripts[name];
      expect(s.indexOf('node scripts/check-dist-free.js')).toBeGreaterThanOrEqual(0);
      expect(s.indexOf('node scripts/check-dist-free.js')).toBeLessThan(s.indexOf('rimraf dist'));
    }
  });

  it('finds a Vex.exe inside dist\\ and ignores the installed one', () => {
    const dist = path.join(root, 'dist');
    const inDist = path.join(dist, 'win-unpacked', 'Vex.exe');
    const installed = 'C:\\Users\\someone\\AppData\\Local\\Programs\\Vex\\Vex.exe';
    expect(runningFrom([installed], dist)).toEqual([]);
    expect(runningFrom([installed, inDist], dist)).toEqual([inDist]);
    expect(runningFrom([inDist.toUpperCase()], dist)).toHaveLength(1);
    // A sibling folder whose name starts with "dist" is not dist\.
    expect(runningFrom([path.join(root, 'dist-f3', 'win-unpacked', 'Vex.exe')], dist)).toEqual([]);
    expect(runningFrom(['', null], dist)).toEqual([]);
  });
});

describe('release.js', () => {
  const src = fs.readFileSync(path.join(root, 'scripts/release.js'), 'utf8');

  it('never touches the website — post-publish moves the badge after the release is proved', () => {
    expect(src).not.toMatch(/index\.html/);
    expect(src).not.toMatch(/const WEBSITE/);
    expect(src).not.toMatch(/\.replace\(\/Latest/);
    expect(pkg.scripts.postpublish).toBe('node scripts/post-publish.js');
  });

  it('commits only its three files and matches the exact changelog heading', () => {
    expect(src).toContain('-- package.json package-lock.json CHANGELOG.md');
    expect(src).toContain('`## v${version} `');
  });
});
