# Vendored libraries

Two, both for QR codes, both shipped as-is from npm:

- `jsqr.js` — [jsQR](https://github.com/cozmo/jsQR) 1.4.0, Apache-2.0
  (`jsqr-LICENSE.txt`). Decodes a QR code out of a camera frame, so the
  address bar can scan one the way Samsung Internet's does. Chosen over ML Kit
  because it needs no Play Services and no native dependency.
- `qrcode.js` — [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)
  2.0.4, MIT. Draws the QR code that hands the page you are on to another
  device — the same library the desktop build uses for the same job.

Neither is modified. Update them by copying the file out of the npm package
again, not by editing here.

## pdf.js (`pdf/`)

`pdf.min.mjs` and `pdf.worker.min.mjs` from pdfjs-dist 6.3.289, plus its licence.
Android's WebView cannot render a PDF — it hands every one of them to the
download manager — so Vex renders them itself. 1.7 MB, loaded on demand the first
time a PDF is opened rather than at boot, because most sessions never meet one.

It is an ES module, which is why the walkthrough serves the chrome over http
instead of opening it as a file: a page on a file:// origin cannot import a
module at all, and the app itself is served from https://localhost by Capacitor.
