// Checks a wallpaper list file before you host it:
//
//   node scripts/validate-wallpaper-catalogue.js path\to\wallpaper-catalogue.json
//
// Prints every entry Vex would skip and why, and exits 1 if the file as a whole is wrong or
// any entry is skipped. See docs/wallpaper-catalogue.md for the format.
const fs = require('fs');
const { validateCatalogue } = require('../src/main/wallpaper-catalogue');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/validate-wallpaper-catalogue.js <file.json>');
  process.exit(2);
}
let doc;
try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
  console.error('Cannot read ' + file + ': ' + err.message);
  process.exit(1);
}
let result;
try { result = validateCatalogue(doc); } catch (err) {
  console.error('INVALID: ' + err.message);
  process.exit(1);
}
for (const p of result.problems) console.error('SKIPPED: ' + p);
console.log(result.entries.length + ' entries are good' + (result.problems.length ? ', ' + result.problems.length + ' would be skipped' : '') + '.');
process.exit(result.problems.length ? 1 : 0);
