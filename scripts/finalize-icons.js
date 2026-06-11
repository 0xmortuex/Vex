// electron-icon-builder writes outputs to assets/icons/ even with --flatten.
// electron-builder expects icon at assets/icon.ico and assets/icon.png.
// Copy the generated files into the expected locations.

const path = require('path');
const fs = require('fs');

const iconsDir = path.join(__dirname, '..', 'assets', 'icons');
const assetsDir = path.join(__dirname, '..', 'assets');

if (!fs.existsSync(iconsDir)) {
  console.error(`[finalize-icons] generated dir not found: ${iconsDir}`);
  process.exit(1);
}

const icoSrc = path.join(iconsDir, 'icon.ico');
const icoDst = path.join(assetsDir, 'icon.ico');
if (fs.existsSync(icoSrc)) {
  fs.copyFileSync(icoSrc, icoDst);
  console.log(`[finalize-icons] wrote ${icoDst}`);
} else {
  console.error('[finalize-icons] missing icon.ico output');
  process.exit(1);
}

// electron-builder looks for a single PNG at assets/icon.png — use 512x512
// (large enough for hi-DPI Linux AppImage and taskbar fallback).
const pngSrc = path.join(iconsDir, '512x512.png');
const pngDst = path.join(assetsDir, 'icon.png');
if (fs.existsSync(pngSrc)) {
  fs.copyFileSync(pngSrc, pngDst);
  console.log(`[finalize-icons] wrote ${pngDst}`);
} else {
  console.error('[finalize-icons] missing 512x512.png output');
  process.exit(1);
}
