// main.js runs top to bottom when Electron loads it. A top-level const, let or
// class that is READ by top-level code before its declaration line throws
// "Cannot access X before initialization" and the app never opens (the
// knowledge base wiring did exactly that with atomicWrite, 2026-10-16; the unit
// tests did not load main.js). Function bodies are skipped: they run later.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

function tdzHits(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, locations: true });
  const declAt = new Map();
  for (const st of ast.body) {
    if (st.type === 'VariableDeclaration' && st.kind !== 'var') {
      for (const d of st.declarations) {
        const names = [];
        (function pat(p) {
          if (!p) return;
          if (p.type === 'Identifier') names.push(p.name);
          else if (p.type === 'ObjectPattern') p.properties.forEach(x => pat(x.value || x.argument));
          else if (p.type === 'ArrayPattern') p.elements.forEach(pat);
          else if (p.type === 'AssignmentPattern') pat(p.left);
          else if (p.type === 'RestElement') pat(p.argument);
        })(d.id);
        for (const n of names) declAt.set(n, { pos: st.start, line: st.loc.start.line, end: d.end });
      }
    } else if (st.type === 'ClassDeclaration') declAt.set(st.id.name, { pos: st.start, line: st.loc.start.line, end: st.end });
  }
  const hits = [];
  function visit(node, topLine) {
    if (!node || typeof node.type !== 'string') return;
    if (/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)) return;   // runs later
    if (node.type === 'ClassBody') {
      // methods run later; computed keys and static blocks/fields run now (rare) - skipped
      return;
    }
    if (node.type === 'Identifier') {
      const d = declAt.get(node.name);
      if (d && node.start < d.pos) hits.push({ name: node.name, useLine: node.loc.start.line, declLine: d.line });
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      if (node.type === 'MemberExpression' && k === 'property' && !node.computed) continue;
      if (node.type === 'Property' && k === 'key' && !node.computed) continue;
      if (node.type === 'MethodDefinition' && k === 'key') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(x => x && visit(x));
      else if (v && typeof v === 'object') visit(v);
    }
  }
  for (const st of ast.body) {
    if (st.type === 'FunctionDeclaration') continue;
    visit(st);
  }
  
  const seen = new Set();
  return hits.filter(h => { const k = h.name + h.useLine; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(h => path.basename(file) + ':' + h.useLine + ' uses ' + h.name + ' declared at line ' + h.declLine);
}

describe('top-level load order', () => {
  const root = path.resolve(__dirname, '../../src');
  const files = [path.join(root, 'main.js'), path.join(root, 'preload.js'),
    ...fs.readdirSync(path.join(root, 'main')).filter(f => f.endsWith('.js')).map(f => path.join(root, 'main', f))];
  for (const f of files) {
    it(path.relative(root, f) + ' reads no top-level const before it is declared', () => {
      expect(tdzHits(f)).toEqual([]);
    });
  }
});
