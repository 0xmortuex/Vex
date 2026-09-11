// @vitest-environment jsdom
//
// "Copy text from doc" on a Google Sheet returned 52 characters: the sheet's
// title, its tab name, and the two scroll arrows "> <". None of the cells.
//
// /htmlview is only a shell; the grid is loaded afterwards, one page per sheet,
// from /htmlview/sheet?gid=N. These fixtures mirror the markup of Google's real
// pages (checked against the live public sample sheet): the shell lists sheets
// as JS object literals with JS-escaped strings, and the grid is a
// <table class="waffle"> whose rows start with a row-number <th>, separated by
// all-empty spacer rows.

import { describe, it, expect } from 'vitest';
import { parseSheetList, tableToText } from '../../src/renderer/js/doc-extract.js';

const SHELL = `<html><head><title>CUSA | Blacklist Registry Holder</title></head><body>
<div id="doc-title">CUSA | Blacklist Registry Holder : Sheet1</div>
<ul id="sheet-menu"><li>Sheet1</li></ul><button>&gt;</button><button>&lt;</button>
<script>
items.push({name: "Sheet1", pageUrl: "https:\\/\\/docs.google.com\\/spreadsheets\\/d\\/ABC\\/htmlview\\/sheet?headers\\x3dtrue&gid=0", gid: "0"});
items.push({name: "Temp \\"Bans\\"", pageUrl: "https:\\/\\/docs.google.com\\/spreadsheets\\/d\\/ABC\\/htmlview\\/sheet?headers\\x3dtrue&gid=77", gid: "77"});
</script></body></html>`;

function grid(rows) {
    const body = rows.map(r => r === null
        ? '<tr><th class="row-header">x</th><td></td><td></td></tr>'
        : `<tr><th class="row-header">${r[0]}</th>${r.slice(1).map(c => `<td>${c}</td>`).join('')}</tr>`
    ).join('');
    const doc = new DOMParser().parseFromString(
        `<table class="waffle"><thead><tr><th></th><th>A</th><th>B</th><th>C</th></tr></thead><tbody>${body}</tbody></table>`,
        'text/html');
    return doc.querySelector('table.waffle');
}

describe('parseSheetList', () => {
    it('finds every sheet in the shell and decodes the JS escapes', () => {
        expect(parseSheetList(SHELL)).toEqual([
            { name: 'Sheet1', url: 'https://docs.google.com/spreadsheets/d/ABC/htmlview/sheet?headers=true&gid=0' },
            { name: 'Temp "Bans"', url: 'https://docs.google.com/spreadsheets/d/ABC/htmlview/sheet?headers=true&gid=77' },
        ]);
    });

    it('returns nothing rather than guessing when there is no list', () => {
        expect(parseSheetList('<html><body>Sign in</body></html>')).toEqual([]);
        expect(parseSheetList('')).toEqual([]);
        expect(parseSheetList(undefined)).toEqual([]);
    });

    it('does not list the same sheet twice', () => {
        expect(parseSheetList(SHELL + SHELL)).toHaveLength(2);
    });
});

describe('tableToText', () => {
    it('reads the cells, not the shell chrome the old reader returned', () => {
        const text = tableToText(grid([
            ['1', 'USERNAME', 'ROBLOX ID', 'LENGTH'],
            ['2', 'Ham4err', '4320333072', 'PERM'],
        ]));

        expect(text).toBe('USERNAME\tROBLOX ID\tLENGTH\nHam4err\t4320333072\tPERM');
        expect(text).not.toMatch(/Registry Holder|^>$|^<$/m);
    });

    it('drops the row-number column and the empty spacer rows', () => {
        const text = tableToText(grid([['1', 'a', 'b', 'c'], null, ['2', 'd', 'e', 'f'], null]));
        expect(text).toBe('a\tb\tc\nd\te\tf');
        expect(text).not.toMatch(/^\d+\t/m);
    });

    it('trims trailing empty cells but keeps empty cells in the middle', () => {
        expect(tableToText(grid([['1', 'a', '', 'c'], ['2', 'd', '', '']]))).toBe('a\t\tc\nd');
    });

    it('keeps the text of hyperlinked cells', () => {
        const text = tableToText(grid([['1', '<a href="https://x.test">Special Operations Command</a>', '', '']]));
        expect(text).toBe('Special Operations Command');
    });

    it('collapses whitespace inside a cell so a cell stays one field', () => {
        expect(tableToText(grid([['1', 'two\n  lines', 'x', '']]))).toBe('two lines\tx');
    });

    it('returns empty for a missing grid, so the caller falls back', () => {
        expect(tableToText(null)).toBe('');
    });
});
