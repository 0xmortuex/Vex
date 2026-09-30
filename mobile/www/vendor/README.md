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
