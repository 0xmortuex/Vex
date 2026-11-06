# Copy Text from Image: languages, size and licence

Right-click a picture, **Copy Text from Image**: the words in it go to the clipboard (English and Turkish), and a toast shows how they begin.

## Why Turkish needed its own data

The recognition engine is Tesseract (`vendor/runtime`, bundled). It had only ever been given English, so the letters ç ğ ı İ ö ş ü came out as c g i I o s u, or as `¢`, `§`, `1`, `ii`.

Measured in real Electron 42 on this sentence, drawn to a canvas in Arial, Segoe UI and Times New Roman at 26, 36 and 52 px (9 pictures, 648 characters):

> İstanbul'da çok güzel bir şehir. Öğrenci ışığı söndürdü, şu üzüm bağı ğ.

| Languages | Wrong characters (Levenshtein) | Character error rate |
|---|---|---|
| `eng` | 196 of 648 | 30.25 % |
| `eng+tur` | 9 of 648 | 1.39 % |

With `eng+tur` the sentence came out exactly right in one of the nine pictures; the remaining mistakes are one or two letters, mostly `ş` read as `s` in "şu" and `ğ` read as `§` at 26 px. The whole path (download, cache, reading, clipboard) was also run end to end: a 40 px Arial picture read with 2.8 % error.

## Where the data comes from, and what it costs

It is **not** in the installer. It is one pack that the person agrees to once, with its size on the button:

| File | Size | SHA-256 |
|---|---|---|
| `eng.traineddata.gz` | 2,952,873 bytes | `45b4cb34…fcff91` |
| `tur.traineddata.gz` | 2,141,291 bytes | `384ba0dc…3d8c04` |
| total | 5,094,164 bytes (5.1 MB) | |

- Host: `cdn.jsdelivr.net`, packages `@tesseract.js-data/eng@1.0.0` and `@tesseract.js-data/tur@1.0.0`, folder `4.0.0_best_int` (Tesseract's "best" models, integer-quantised). The URLs name an exact version, so the bytes never change.
- Both files are checked against the size and SHA-256 above (`src/main/ocr-lang-pack.js`) before use; a mismatch deletes the file and the download fails out loud. There is no second host.
- The request goes through the egress ledger as **Text-from-image language pack**, so it shows in "what left this computer".
- It is kept in `<profile>/ocr-lang/`. Ctrl+K **Remove text recognition data** deletes it (and the copy in the worker's cache); the question comes back the next time.
- Before this feature, Tesseract fetched `eng.traineddata` from the same CDN by itself the first time any picture was read (Screenshot OCR, the redact tool), without asking and without a ledger line. That path is unchanged; Copy Text from Image never uses it. It reads only from the cache it is given (`cacheMethod: 'readOnly'`, a language path no request can follow), so the engine cannot go online by itself. A real run with every `http(s)` request counted saw none.

## Licence

The language data is Tesseract's **tessdata_best** (<https://github.com/tesseract-ocr/tessdata_best>), under the **Apache License 2.0**. The npm packages that carry it (<https://github.com/naptha/tessdata>) are MIT. Neither needs more than this notice; the engine's own licence is `vendor/runtime/tesseract-LICENSE`.

## What happens to the picture

It is read in the window. A picture on a web page is fetched once more through its own tab's session (never from a private or Tor tab without asking); a `data:` picture is used as it is; a `blob:` picture is asked for from its own page. It is brought down to at most 3500 pixels on its longest side before reading, and nothing is uploaded anywhere. **Cancel** on the small card stops the reading (or the download).

## Without the pack

If the person says "Not now": when an English cache from an older reading exists, the picture is read in English only, with a note that Turkish letters may come out wrong; otherwise nothing is read and nothing is downloaded, and the toast says so.
