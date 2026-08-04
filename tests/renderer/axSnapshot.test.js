import { describe, it, expect } from 'vitest';
import { flattenAXTree } from '../../src/renderer/js/ax-snapshot.js';

// Minimal helper mirroring Chromium's getFullAXTree node shape.
const node = (id, role, name, childIds = [], extra = {}) => ({
  nodeId: String(id),
  role: { value: role },
  ...(name ? { name: { value: name } } : {}),
  childIds: childIds.map(String),
  ...extra,
});

describe('flattenAXTree', () => {
  it('returns nothing for an empty tree', () => {
    expect(flattenAXTree([]).lines).toEqual([]);
    expect(flattenAXTree(null).lines).toEqual([]);
  });

  it('emits role and name, indented by depth', () => {
    const nodes = [
      node(1, 'RootWebArea', 'Example', [2]),
      node(2, 'button', 'Sign in'),
    ];
    const { lines } = flattenAXTree(nodes);
    expect(lines[0]).toBe('RootWebArea "Example"');
    expect(lines[1]).toBe('  button "Sign in"');
  });

  it('drops noise roles but keeps their children at the parent depth', () => {
    const nodes = [
      node(1, 'RootWebArea', 'Page', [2]),
      node(2, 'generic', '', [3]),
      node(3, 'link', 'Docs'),
    ];
    const { lines } = flattenAXTree(nodes);
    expect(lines).toEqual(['RootWebArea "Page"', '  link "Docs"']);
  });

  it('drops ignored nodes', () => {
    const nodes = [
      node(1, 'RootWebArea', 'Page', [2]),
      node(2, 'button', 'Hidden', [], { ignored: true }),
    ];
    expect(flattenAXTree(nodes).lines).toEqual(['RootWebArea "Page"']);
  });

  it('reports useful states and omits false ones', () => {
    const nodes = [
      node(1, 'RootWebArea', 'Page', [2]),
      node(2, 'button', 'Submit', [], {
        properties: [
          { name: 'disabled', value: { value: true } },
          { name: 'focusable', value: { value: true } },  // not in USEFUL_STATES
          { name: 'checked', value: { value: 'false' } }, // false-y, dropped
        ],
      }),
    ];
    const { lines } = flattenAXTree(nodes);
    expect(lines[1]).toBe('  button "Submit" [disabled]');
  });

  it('renders non-boolean states as name:value', () => {
    const nodes = [
      node(1, 'RootWebArea', 'Page', [2]),
      node(2, 'heading', 'Title', [], { properties: [{ name: 'level', value: { value: 2 } }] }),
    ];
    expect(flattenAXTree(nodes).lines[1]).toBe('  heading "Title" [level:2]');
  });

  it('includes the value of a textbox', () => {
    const nodes = [
      node(1, 'RootWebArea', 'Page', [2]),
      { ...node(2, 'textbox', 'Email'), value: { value: 'me@example.com' } },
    ];
    expect(flattenAXTree(nodes).lines[1]).toBe('  textbox "Email" = "me@example.com"');
  });

  it('collapses whitespace and truncates long names', () => {
    const nodes = [
      node(1, 'RootWebArea', 'Page', [2]),
      node(2, 'link', 'a  b\n\nc'),
      node(3, 'link', 'x'.repeat(200)),
    ];
    nodes[0].childIds = ['2', '3'];
    const { lines } = flattenAXTree(nodes, { maxNameLen: 10 });
    expect(lines[1]).toBe('  link "a b c"');
    expect(lines[2]).toBe('  link "xxxxxxxxxx…"');
  });

  it('stops at maxLines and flags truncation', () => {
    const kids = Array.from({ length: 50 }, (_, i) => i + 2);
    const nodes = [node(1, 'RootWebArea', 'Page', kids), ...kids.map(i => node(i, 'link', 'L' + i))];
    const { lines, truncated } = flattenAXTree(nodes, { maxLines: 5 });
    expect(lines.length).toBe(5);
    expect(truncated).toBe(true);
  });

  it('is not truncated when it fits', () => {
    const nodes = [node(1, 'RootWebArea', 'Page', [2]), node(2, 'link', 'One')];
    expect(flattenAXTree(nodes).truncated).toBe(false);
  });

  it('does not recurse forever on a cyclic tree', () => {
    // Chromium shouldn't emit one, but a malformed tree must not hang the UI.
    const nodes = [node(1, 'RootWebArea', 'Page', [2]), node(2, 'link', 'Loop', [1])];
    const { lines } = flattenAXTree(nodes, { maxLines: 20 });
    expect(lines.length).toBeLessThanOrEqual(20);
  });
});
