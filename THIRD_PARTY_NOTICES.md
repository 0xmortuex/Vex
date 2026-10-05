# Third-party notices

Vex is made by 0xmortuex and is released under the MIT License (see [LICENSE](LICENSE)).
Vex is built on, and ships with, software made by other people. This file lists that software and its licences.

This list was generated on 2026-10-02 from the production dependencies of Vex 2.35.2 as installed in `node_modules` — the same set electron-builder packs into the app. Development tools (test runners, linters, the build tool) are not shipped and are not listed.

## Contents

1. [Electron, castLabs Electron and Chromium](#electron-castlabs-electron-and-chromium)
2. [Fonts](#fonts)
3. [Code copied into the Vex source](#code-copied-into-the-vex-source)
4. [npm packages shipped with Vex](#npm-packages-shipped-with-vex)
5. [Licence texts](#licence-texts)
6. [Software Vex downloads while running](#software-vex-downloads-while-running)

## Electron, castLabs Electron and Chromium

Vex runs on **castLabs Electron for Content Security** (version 42.11.0+wvcus), a build of [Electron](https://www.electronjs.org/) by castLabs GmbH that adds Widevine DRM support. Electron in turn contains **Chromium** and **Node.js**.

- **Electron** — MIT License. Copyright (c) Electron contributors; Copyright (c) 2013-2020 GitHub Inc. The full text ships with Vex as `LICENSE.electron.txt` in the install folder.
- **castLabs Electron** — MIT License. Copyright (c) 2017-2025 castLabs GmbH. (https://github.com/castlabs/electron-releases)
- **Chromium, Node.js, V8, FFmpeg and the other components inside Electron** — many licences (BSD-3-Clause, MIT, Apache-2.0, LGPL-2.1 for FFmpeg, and others). Their full licence texts ship with Vex as `LICENSES.chromium.html` in the install folder (by default `%LOCALAPPDATA%\Programs\Vex\LICENSES.chromium.html`).
- **Widevine Content Decryption Module** — made by Google. It is not part of the Vex installer: castLabs Electron fetches it through Google's component updater when the app starts, and its use is governed by Google's terms. Vex is signed for Widevine through the castLabs EVS (VMP) service.

The MIT text for Electron and castLabs Electron is the standard MIT text in [MIT License](#mit-license) below.

## Fonts

These fonts are bundled in `src/renderer/fonts`. All are under the SIL Open Font License 1.1; each font's own licence file (with its copyright line) is shipped next to it.

| Font | Licence file | Copyright |
|---|---|---|
| Outfit | `outfit-OFL.txt` | Copyright 2021 The Outfit Project Authors (https://github.com/Outfitio/Outfit-Fonts) |
| Space Grotesk | `spacegrotesk-OFL.txt` | Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk) |
| JetBrains Mono | `jetbrainsmono-OFL.txt` | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) |
| Fraunces | `fraunces-OFL.txt` | Copyright 2018 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces) |
| Spectral | `spectral-OFL.txt` | Copyright 2017 The Spectral Project Authors (https://github.com/productiontype/Spectral) |

The full SIL Open Font License 1.1 text is in [SIL Open Font License 1.1](#sil-open-font-license-11) below.

## Code copied into the Vex source

- **jsQR** (`src/renderer/vendor/jsQR.js`) — QR code reader used by the Authenticator to read 2FA QR codes. Apache License 2.0. Copyright 2017 Cosmo Wolfe. https://github.com/cozmo/jsQR. The file is the published `dist/jsQR.js` build and has no version header. Apache-2.0 text below.
- **Runtime copies of shipped packages** (`src/renderer/vendor/runtime/`) — at build time Vex copies the browser builds of `@mlc-ai/web-llm`, `tesseract.js`, `tesseract.js-core`, `@huggingface/transformers` and `onnxruntime-web` into this folder (with their licence files) so the app can load them in its pages. They are the same packages listed below under their own licences.

## npm packages shipped with Vex

148 packages. Licence names are as each package declares them in its `package.json`.

| Package | Version | Licence |
|---|---|---|
| @ghostery/adblocker | 2.18.0 | MPL-2.0 |
| @ghostery/adblocker-content | 2.18.0 | MPL-2.0 |
| @ghostery/adblocker-electron | 2.18.0 | MPL-2.0 |
| @ghostery/adblocker-electron-preload | 2.18.0 | MPL-2.0 |
| @ghostery/adblocker-extended-selectors | 2.18.0 | MPL-2.0 |
| @ghostery/url-parser | 1.3.1 | MPL-2.0 |
| @huggingface/jinja | 0.5.10 | MIT |
| @huggingface/tokenizers | 0.2.0 | Apache-2.0 |
| @huggingface/transformers | 4.3.0 | Apache-2.0 |
| @isaacs/fs-minipass | 4.0.1 | ISC |
| @mlc-ai/web-llm | 0.2.84 | Apache-2.0 |
| @pinojs/redact | 0.4.0 | MIT |
| @protobufjs/aspromise | 1.1.2 | BSD-3-Clause |
| @protobufjs/base64 | 1.1.2 | BSD-3-Clause |
| @protobufjs/codegen | 2.0.5 | BSD-3-Clause |
| @protobufjs/eventemitter | 1.1.1 | BSD-3-Clause |
| @protobufjs/fetch | 1.1.1 | BSD-3-Clause |
| @protobufjs/float | 1.0.2 | BSD-3-Clause |
| @protobufjs/path | 1.1.2 | BSD-3-Clause |
| @protobufjs/pool | 1.1.0 | BSD-3-Clause |
| @protobufjs/utf8 | 1.1.2 | BSD-3-Clause |
| @remusao/guess-url-type | 2.1.0 | MPL-2.0 |
| @remusao/small | 2.1.0 | MPL-2.0 |
| @remusao/smaz | 2.2.0 | MPL-2.0 |
| @remusao/smaz-compress | 2.2.0 | MPL-2.0 |
| @remusao/smaz-decompress | 2.2.0 | MPL-2.0 |
| @remusao/trie | 2.1.0 | MPL-2.0 |
| @selderee/plugin-htmlparser2 | 0.12.0 | MIT |
| @types/node | 26.4.1 | MIT |
| @zone-eu/mailsplit | 5.4.17 | (MIT OR EUPL-1.1+) |
| adm-zip | 0.6.1 | MIT |
| ansi-regex | 5.0.1 | MIT |
| ansi-styles | 4.3.0 | MIT |
| atomic-sleep | 1.0.0 | MIT |
| bmp-js | 0.1.0 | MIT |
| camelcase | 5.0.0 | MIT |
| chownr | 3.0.0 | BlueOak-1.0.0 |
| cliui | 6.0.0 | ISC |
| color-convert | 2.0.1 | MIT |
| color-name | 1.1.4 | MIT |
| decamelize | 1.2.0 | MIT |
| deepmerge-ts | 8.0.2 | BSD-3-Clause |
| define-data-property | 1.1.4 | MIT |
| define-properties | 1.2.1 | MIT |
| detect-libc | 2.1.2 | Apache-2.0 |
| dijkstrajs | 1.0.3 | MIT |
| dom-serializer | 2.0.0 | MIT |
| domelementtype | 2.3.0 | BSD-2-Clause |
| domhandler | 5.0.3 | BSD-2-Clause |
| domutils | 3.2.2 | BSD-2-Clause |
| emoji-regex | 8.0.0 | MIT |
| encoding-japanese | 2.4.0 | MIT |
| entities | 4.5.0 | BSD-2-Clause |
| entities | 7.0.1 | BSD-2-Clause |
| es-define-property | 1.0.1 | MIT |
| es-errors | 1.3.0 | MIT |
| escape-string-regexp | 4.0.0 | MIT |
| find-up | 4.1.0 | MIT |
| flatbuffers | 25.9.23 | Apache-2.0 |
| get-caller-file | 2.0.5 | ISC |
| global-agent | 4.1.3 | BSD-3-Clause |
| globalthis | 1.0.4 | MIT |
| gopd | 1.2.0 | MIT |
| guid-typescript | 1.0.9 | ISC |
| has-property-descriptors | 1.0.2 | MIT |
| he | 1.2.0 | MIT |
| html-to-text | 10.0.1 | MIT |
| htmlparser2 | 10.1.0 | MIT |
| iconv-lite | 0.7.3 | MIT |
| idb-keyval | 6.3.0 | Apache-2.0 |
| imapflow | 2.0.5 | MIT |
| ip-address | 10.7.2 | MIT |
| is-fullwidth-code-point | 3.0.0 | MIT |
| is-url | 1.2.4 | MIT |
| leac | 0.7.0 | MIT |
| libbase64 | 1.3.0 | MIT |
| libmime | 5.4.4 | MIT |
| libqp | 2.1.1 | MIT |
| linkify-it | 5.0.2 | MIT |
| locate-path | 5.0.0 | MIT |
| loglevel | 1.9.2 | MIT |
| long | 5.3.2 | Apache-2.0 |
| mailparser | 3.9.28 | MIT |
| matcher | 4.0.0 | MIT |
| minipass | 7.1.3 | BlueOak-1.0.0 |
| minizlib | 3.1.0 | MIT |
| node-fetch | 2.7.0 | MIT |
| nodemailer | 10.0.10 | MIT-0 |
| object-keys | 1.1.1 | MIT |
| on-exit-leak-free | 2.1.2 | MIT |
| onnxruntime-common | 1.30.0 | MIT |
| onnxruntime-common | 1.31.0-dev.20260911-2a43ec07e | MIT |
| onnxruntime-web | 1.31.0-dev.20260914-8d85527a0 | MIT |
| opencollective-postinstall | 2.0.3 | MIT |
| p-limit | 2.3.0 | MIT |
| p-locate | 4.1.0 | MIT |
| p-try | 2.2.0 | MIT |
| parseley | 0.13.1 | MIT |
| path-exists | 4.0.0 | MIT |
| peberminta | 0.10.0 | MIT |
| pino | 10.3.1 | MIT |
| pino-abstract-transport | 3.0.0 | MIT |
| pino-std-serializers | 7.1.0 | MIT |
| platform | 1.3.6 | MIT |
| pngjs | 5.0.0 | MIT |
| process-warning | 5.1.0 | MIT |
| protobufjs | 7.6.6 | BSD-3-Clause |
| punycode.js | 2.3.1 | MIT |
| qrcode | 1.5.4 | MIT |
| quick-format-unescaped | 4.0.4 | MIT |
| real-require | 0.2.0 | MIT |
| real-require | 1.0.0 | MIT |
| regenerator-runtime | 0.13.11 | MIT |
| require-directory | 2.1.1 | MIT |
| require-main-filename | 2.0.0 | ISC |
| safe-stable-stringify | 2.5.0 | MIT |
| safer-buffer | 2.1.2 | MIT |
| selderee | 0.12.0 | MIT |
| semver | 7.8.5 | ISC |
| serialize-error | 8.1.0 | MIT |
| set-blocking | 2.0.0 | ISC |
| smart-buffer | 4.2.0 | MIT |
| socks | 2.8.10 | MIT |
| sonic-boom | 4.2.1 | MIT |
| split2 | 4.2.0 | ISC |
| string-width | 4.2.3 | MIT |
| strip-ansi | 6.0.1 | MIT |
| tar | 7.5.22 | BlueOak-1.0.0 |
| tesseract.js | 7.0.0 | Apache-2.0 |
| tesseract.js-core | 7.0.0 | Apache-2.0 |
| thread-stream | 4.2.0 | MIT |
| tlds | 1.261.0 | MIT |
| tldts-core | 7.4.2 | MIT |
| tldts-experimental | 7.4.2 | MIT |
| tr46 | 0.0.3 | MIT |
| type-fest | 0.20.2 | (MIT OR CC0-1.0) |
| uc.micro | 2.1.0 | MIT |
| undici-types | 8.3.0 | MIT |
| wasm-feature-detect | 1.9.0 | Apache-2.0 |
| webidl-conversions | 3.0.1 | BSD-2-Clause |
| whatwg-url | 5.0.0 | MIT |
| which-module | 2.0.1 | ISC |
| wrap-ansi | 6.2.0 | MIT |
| y18n | 4.0.3 | ISC |
| yallist | 5.0.0 | BlueOak-1.0.0 |
| yargs | 15.4.1 | MIT |
| yargs-parser | 18.1.3 | ISC |
| zlibjs | 0.3.1 | MIT |

## Licence texts

### MIT License

Used by Electron, castLabs Electron and the packages below. Each package's copyright line(s) are listed; the licence text that applies to all of them follows.

- **@huggingface/jinja@0.5.10** — Copyright (c) 2023 Hugging Face
- **@pinojs/redact@0.4.0** — Copyright (c) 2025 pinojs contributors
- **@selderee/plugin-htmlparser2@0.12.0** — Copyright (c) 2021-2026 KillyMXI <killy@mxii.eu.org>
- **@types/node@26.4.1** — Copyright (c) Microsoft Corporation.
- **adm-zip@0.6.1** — Copyright (c) 2012 Another-D-Mention Software and other contributors
- **ansi-regex@5.0.1** — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
- **ansi-styles@4.3.0** — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
- **atomic-sleep@1.0.0** — Copyright (c) 2020 David Mark Clements
- **bmp-js@0.1.0** — Copyright (c) 2014 @丝刀口
- **camelcase@5.0.0** — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
- **color-convert@2.0.1** — Copyright (c) 2011-2016 Heather Arthur <fayearthur@gmail.com>
- **color-name@1.1.4** — Copyright (c) 2015 Dmitry Ivanov
- **decamelize@1.2.0** — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
- **define-data-property@1.1.4** — Copyright (c) 2023 Jordan Harband
- **define-properties@1.2.1** — Copyright (C) 2015 Jordan Harband
- **emoji-regex@8.0.0** — Copyright Mathias Bynens <https://mathiasbynens.be/>
- **encoding-japanese@2.4.0** — Copyright (c) 2012-present polygonplanet; Copyright (c) Microsoft Corporation.
- **es-define-property@1.0.1** — Copyright (c) 2024 Jordan Harband
- **es-errors@1.3.0** — Copyright (c) 2024 Jordan Harband
- **escape-string-regexp@4.0.0** — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
- **find-up@4.1.0** — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
- **globalthis@1.0.4** — Copyright (c) 2016 Jordan Harband
- **gopd@1.2.0** — Copyright (c) 2022 Jordan Harband
- **has-property-descriptors@1.0.2** — Copyright (c) 2022 Inspect JS
- **he@1.2.0** — Copyright Mathias Bynens <https://mathiasbynens.be/>
- **html-to-text@10.0.1** — Copyright (c) Malte Legenhausen <legenhausen@werk85.de>
- **htmlparser2@10.1.0** — Copyright 2010, 2011, Chris Winberry <chris@winberry.net>. All rights reserved.
- **iconv-lite@0.7.3** — Copyright (c) 2011 Alexander Shtuchkin
- **imapflow@2.0.5** — Copyright (c) 2020-2024 Postal Systems OÜ
- **ip-address@10.7.2** — Copyright (C) 2011 by Beau Gunderson
- **is-fullwidth-code-point@3.0.0** — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
- **is-url@1.2.4** — (no copyright line in the package; see its repository)
- **leac@0.7.0** — Copyright (c) 2021-2025 KillyMXI <killy@mxii.eu.org>
- **libbase64@1.3.0** — Copyright (c) 2014-2017 Andris Reinman
- **libmime@5.4.4** — Copyright (c) 2014-2016 Andris Reinman
- **libqp@2.1.1** — Copyright (c) 2014-2022 Andris Reinman
- **linkify-it@5.0.2** — Copyright (c) 2015 Vitaly Puzrin.
- **locate-path@5.0.0** — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
- **loglevel@1.9.2** — Copyright (c) 2013 Tim Perry
- **mailparser@3.9.28** — Copyright (c) 2020 - 2025 Andris Reinman
- **matcher@4.0.0** — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
- **minizlib@3.1.0** — Copyright (c) 2017-2023 Isaac Z. Schlueter and Contributors; Copyright (c) 2017-2023 Node.js contributors. All rights reserved.; Copyright (c) 2017-2023 Joyent, Inc. and other Node contributors. All rights reserved.
- **node-fetch@2.7.0** — Copyright (c) 2016 David Frank
- **object-keys@1.1.1** — Copyright (C) 2013 Jordan Harband
- **on-exit-leak-free@2.1.2** — Copyright (c) 2021 Matteo Collina
- **onnxruntime-common@1.30.0** — Copyright (c) fs-eire
- **onnxruntime-common@1.31.0-dev.20260911-2a43ec07e** — Copyright (c) fs-eire
- **onnxruntime-web@1.31.0-dev.20260914-8d85527a0** — Copyright (c) fs-eire
- **opencollective-postinstall@2.0.3** — Copyright (c) 2018 Open Collective
- **p-limit@2.3.0** — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
- **p-locate@4.1.0** — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
- **p-try@2.2.0** — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
- **parseley@0.13.1** — Copyright (c) 2021-2025 KillyMXI <killy@mxii.eu.org>
- **path-exists@4.0.0** — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
- **peberminta@0.10.0** — Copyright (c) 2021-2025 KillyMXI <killy@mxii.eu.org>
- **pino@10.3.1** — Copyright (c) 2016-2025 Matteo Collina, David Mark Clements and the Pino contributors listed at <https://github.com/pinojs/pino#the-team> and in the README file.
- **pino-abstract-transport@3.0.0** — Copyright (c) 2021 pino
- **pino-std-serializers@7.1.0** — Copyright Mateo Collina, David Mark Clements, James Sumners
- **platform@1.3.6** — Copyright 2014-2020 Benjamin Tan; Copyright 2011-2013 John-David Dalton
- **pngjs@5.0.0** — (no copyright line in the package; see its repository)
- **process-warning@5.1.0** — Copyright (c) 2020-present The Fastify team <https://github.com/fastify/fastify#team>
- **punycode.js@2.3.1** — Copyright Mathias Bynens <https://mathiasbynens.be/>
- **qrcode@1.5.4** — Copyright (c) 2012 Ryan Day
- **quick-format-unescaped@4.0.4** — Copyright (c) 2016-2019 David Mark Clements
- **real-require@0.2.0** — Copyright (c) 2021 Paolo Insogna and the real-require contributors
- **real-require@1.0.0** — Copyright (c) 2021 Paolo Insogna and the real-require contributors
- **regenerator-runtime@0.13.11** — Copyright (c) 2014-present, Facebook, Inc.
- **require-directory@2.1.1** — Copyright (c) 2011 Troy Goode <troygoode@gmail.com>
- **safe-stable-stringify@2.5.0** — Copyright (c) Ruben Bridgewater
- **safer-buffer@2.1.2** — Copyright (c) 2018 Nikita Skovoroda <chalkerx@gmail.com>
- **selderee@0.12.0** — Copyright (c) 2021-2026 KillyMXI <killy@mxii.eu.org>
- **serialize-error@8.1.0** — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
- **smart-buffer@4.2.0** — Copyright (c) 2013-2017 Josh Glazebrook
- **socks@2.8.10** — Copyright (c) 2013 Josh Glazebrook
- **sonic-boom@4.2.1** — Copyright (c) 2017 Matteo Collina
- **string-width@4.2.3** — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
- **strip-ansi@6.0.1** — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
- **thread-stream@4.2.0** — Copyright (c) 2021 Matteo Collina
- **tlds@1.261.0** — Copyright (c) 2013 Stephen Mathieson and 2020 Richie Bendall
- **tldts-core@7.4.2** — Copyright (c) 2017 Thomas Parisot, 2018 Rémi Berson
- **tldts-experimental@7.4.2** — Copyright (c) 2017 Thomas Parisot, 2018 Rémi Berson
- **tr46@0.0.3** — Copyright (c) Sebastian Mayr <npm@smayr.name>
- **uc.micro@2.1.0** — Copyright Mathias Bynens <https://mathiasbynens.be/>
- **undici-types@8.3.0** — Copyright (c) Matteo Collina and Undici contributors
- **whatwg-url@5.0.0** — Copyright (c) 2015–2016 Sebastian Mayr
- **wrap-ansi@6.2.0** — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
- **yargs@15.4.1** — Copyright 2010 James Halliday (mail@substack.net); Modified work Copyright 2014 Contributors (ben@npmjs.com)

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### ISC License

- **@isaacs/fs-minipass@4.0.1** — Copyright (c) Isaac Z. Schlueter and Contributors
- **cliui@6.0.0** — Copyright (c) 2015, Contributors
- **get-caller-file@2.0.5** — Copyright 2018 Stefan Penner
- **guid-typescript@1.0.9** — Copyright (c) nicolas
- **require-main-filename@2.0.0** — Copyright (c) 2016, Contributors
- **semver@7.8.5** — Copyright (c) Isaac Z. Schlueter and Contributors
- **set-blocking@2.0.0** — Copyright (c) 2016, Contributors
- **split2@4.2.0** — Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com>
- **which-module@2.0.1** — Copyright (c) 2016, Contributors
- **y18n@4.0.3** — Copyright (c) 2015, Contributors
- **yargs-parser@18.1.3** — Copyright (c) 2016, Contributors

```
ISC License

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### Apache License 2.0

Used by jsQR and the packages below. Any NOTICE file a package ships is reproduced under its name, as the licence requires.

- **@huggingface/tokenizers@0.2.0** — by Hugging Face (https://github.com/huggingface/tokenizers.js)
- **@huggingface/transformers@4.3.0** — by Hugging Face (https://github.com/huggingface/transformers.js)
- **@mlc-ai/web-llm@0.2.84** (https://github.com/mlc-ai/web-llm)
- **detect-libc@2.1.2** — by Lovell Fuller <npm@lovell.info> (git://github.com/lovell/detect-libc)
- **flatbuffers@25.9.23** — by The FlatBuffers project (https://github.com/google/flatbuffers)
- **idb-keyval@6.3.0** — Copyright 2016, Jake Archibald (https://github.com/jakearchibald/idb-keyval)
- **long@5.3.2** — by Daniel Wirtz <dcode@dcode.io> (https://github.com/dcodeIO/long.js)
- **tesseract.js@7.0.0** (https://github.com/naptha/tesseract.js)
- **tesseract.js-core@7.0.0** — by antimatter15 (https://github.com/naptha/tesseract.js-core)
- **wasm-feature-detect@1.9.0** — Copyright 2017 Google Inc. (GoogleChromeLabs/wasm-feature-detect)
- **jsQR** — Copyright 2017 Cosmo Wolfe

```
Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction, and
distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity authorized by the copyright
owner that is granting the License.

"Legal Entity" shall mean the union of the acting entity and all other entities
that control, are controlled by, or are under common control with that entity.
For the purposes of this definition, "control" means (i) the power, direct or
indirect, to cause the direction or management of such entity, whether by
contract or otherwise, or (ii) ownership of fifty percent (50%) or more of the
outstanding shares, or (iii) beneficial ownership of such entity.

"You" (or "Your") shall mean an individual or Legal Entity exercising
permissions granted by this License.

"Source" form shall mean the preferred form for making modifications, including
but not limited to software source code, documentation source, and configuration
files.

"Object" form shall mean any form resulting from mechanical transformation or
translation of a Source form, including but not limited to compiled object code,
generated documentation, and conversions to other media types.

"Work" shall mean the work of authorship, whether in Source or Object form, made
available under the License, as indicated by a copyright notice that is included
in or attached to the work (an example is provided in the Appendix below).

"Derivative Works" shall mean any work, whether in Source or Object form, that
is based on (or derived from) the Work and for which the editorial revisions,
annotations, elaborations, or other modifications represent, as a whole, an
original work of authorship. For the purposes of this License, Derivative Works
shall not include works that remain separable from, or merely link (or bind by
name) to the interfaces of, the Work and Derivative Works thereof.

"Contribution" shall mean any work of authorship, including the original version
of the Work and any modifications or additions to that Work or Derivative Works
thereof, that is intentionally submitted to Licensor for inclusion in the Work
by the copyright owner or by an individual or Legal Entity authorized to submit
on behalf of the copyright owner. For the purposes of this definition,
"submitted" means any form of electronic, verbal, or written communication sent
to the Licensor or its representatives, including but not limited to
communication on electronic mailing lists, source code control systems, and
issue tracking systems that are managed by, or on behalf of, the Licensor for
the purpose of discussing and improving the Work, but excluding communication
that is conspicuously marked or otherwise designated in writing by the copyright
owner as "Not a Contribution."

"Contributor" shall mean Licensor and any individual or Legal Entity on behalf
of whom a Contribution has been received by Licensor and subsequently
incorporated within the Work.

2. Grant of Copyright License.

Subject to the terms and conditions of this License, each Contributor hereby
grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free,
irrevocable copyright license to reproduce, prepare Derivative Works of,
publicly display, publicly perform, sublicense, and distribute the Work and such
Derivative Works in Source or Object form.

3. Grant of Patent License.

Subject to the terms and conditions of this License, each Contributor hereby
grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free,
irrevocable (except as stated in this section) patent license to make, have
made, use, offer to sell, sell, import, and otherwise transfer the Work, where
such license applies only to those patent claims licensable by such Contributor
that are necessarily infringed by their Contribution(s) alone or by combination
of their Contribution(s) with the Work to which such Contribution(s) was
submitted. If You institute patent litigation against any entity (including a
cross-claim or counterclaim in a lawsuit) alleging that the Work or a
Contribution incorporated within the Work constitutes direct or contributory
patent infringement, then any patent licenses granted to You under this License
for that Work shall terminate as of the date such litigation is filed.

4. Redistribution.

You may reproduce and distribute copies of the Work or Derivative Works thereof
in any medium, with or without modifications, and in Source or Object form,
provided that You meet the following conditions:

You must give any other recipients of the Work or Derivative Works a copy of
this License; and
You must cause any modified files to carry prominent notices stating that You
changed the files; and
You must retain, in the Source form of any Derivative Works that You distribute,
all copyright, patent, trademark, and attribution notices from the Source form
of the Work, excluding those notices that do not pertain to any part of the
Derivative Works; and
If the Work includes a "NOTICE" text file as part of its distribution, then any
Derivative Works that You distribute must include a readable copy of the
attribution notices contained within such NOTICE file, excluding those notices
that do not pertain to any part of the Derivative Works, in at least one of the
following places: within a NOTICE text file distributed as part of the
Derivative Works; within the Source form or documentation, if provided along
with the Derivative Works; or, within a display generated by the Derivative
Works, if and wherever such third-party notices normally appear. The contents of
the NOTICE file are for informational purposes only and do not modify the
License. You may add Your own attribution notices within Derivative Works that
You distribute, alongside or as an addendum to the NOTICE text from the Work,
provided that such additional attribution notices cannot be construed as
modifying the License.
You may add Your own copyright statement to Your modifications and may provide
additional or different license terms and conditions for use, reproduction, or
distribution of Your modifications, or for any such Derivative Works as a whole,
provided Your use, reproduction, and distribution of the Work otherwise complies
with the conditions stated in this License.

5. Submission of Contributions.

Unless You explicitly state otherwise, any Contribution intentionally submitted
for inclusion in the Work by You to the Licensor shall be under the terms and
conditions of this License, without any additional terms or conditions.
Notwithstanding the above, nothing herein shall supersede or modify the terms of
any separate license agreement you may have executed with Licensor regarding
such Contributions.

6. Trademarks.

This License does not grant permission to use the trade names, trademarks,
service marks, or product names of the Licensor, except as required for
reasonable and customary use in describing the origin of the Work and
reproducing the content of the NOTICE file.

7. Disclaimer of Warranty.

Unless required by applicable law or agreed to in writing, Licensor provides the
Work (and each Contributor provides its Contributions) on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied,
including, without limitation, any warranties or conditions of TITLE,
NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE. You are
solely responsible for determining the appropriateness of using or
redistributing the Work and assume any risks associated with Your exercise of
permissions under this License.

8. Limitation of Liability.

In no event and under no legal theory, whether in tort (including negligence),
contract, or otherwise, unless required by applicable law (such as deliberate
and grossly negligent acts) or agreed to in writing, shall any Contributor be
liable to You for damages, including any direct, indirect, special, incidental,
or consequential damages of any character arising as a result of this License or
out of the use or inability to use the Work (including but not limited to
damages for loss of goodwill, work stoppage, computer failure or malfunction, or
any and all other commercial damages or losses), even if such Contributor has
been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability.

While redistributing the Work or Derivative Works thereof, You may choose to
offer, and charge a fee for, acceptance of support, warranty, indemnity, or
other liability obligations and/or rights consistent with this License. However,
in accepting such obligations, You may act only on Your own behalf and on Your
sole responsibility, not on behalf of any other Contributor, and only if You
agree to indemnify, defend, and hold each Contributor harmless for any liability
incurred by, or claims asserted against, such Contributor by reason of your
accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work

To apply the Apache License to your work, attach the following boilerplate
notice, with the fields enclosed by brackets "[]" replaced with your own
identifying information. (Don't include the brackets!) The text should be
enclosed in the appropriate comment syntax for the file format. We also
recommend that a file or class name and description of purpose be included on
the same "printed page" as the copyright notice for easier identification within
third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### Other licences

Each licence file is reproduced in full. Packages that ship the exact same licence file are listed together under one copy of it.

#### @ghostery/adblocker@2.18.0, @ghostery/adblocker-content@2.18.0, @ghostery/adblocker-electron@2.18.0, @ghostery/adblocker-electron-preload@2.18.0, @ghostery/adblocker-extended-selectors@2.18.0 — MPL-2.0

```
Copyright (c) 2017-present Ghostery GmbH. All rights reserved.

Mozilla Public License Version 2.0
==================================

1. Definitions
--------------

1.1. "Contributor"
    means each individual or legal entity that creates, contributes to
    the creation of, or owns Covered Software.

1.2. "Contributor Version"
    means the combination of the Contributions of others (if any) used
    by a Contributor and that particular Contributor's Contribution.

1.3. "Contribution"
    means Covered Software of a particular Contributor.

1.4. "Covered Software"
    means Source Code Form to which the initial Contributor has attached
    the notice in Exhibit A, the Executable Form of such Source Code
    Form, and Modifications of such Source Code Form, in each case
    including portions thereof.

1.5. "Incompatible With Secondary Licenses"
    means

    (a) that the initial Contributor has attached the notice described
        in Exhibit B to the Covered Software; or

    (b) that the Covered Software was made available under the terms of
        version 1.1 or earlier of the License, but not also under the
        terms of a Secondary License.

1.6. "Executable Form"
    means any form of the work other than Source Code Form.

1.7. "Larger Work"
    means a work that combines Covered Software with other material, in
    a separate file or files, that is not Covered Software.

1.8. "License"
    means this document.

1.9. "Licensable"
    means having the right to grant, to the maximum extent possible,
    whether at the time of the initial grant or subsequently, any and
    all of the rights conveyed by this License.

1.10. "Modifications"
    means any of the following:

    (a) any file in Source Code Form that results from an addition to,
        deletion from, or modification of the contents of Covered
        Software; or

    (b) any new file in Source Code Form that contains any Covered
        Software.

1.11. "Patent Claims" of a Contributor
    means any patent claim(s), including without limitation, method,
    process, and apparatus claims, in any patent Licensable by such
    Contributor that would be infringed, but for the grant of the
    License, by the making, using, selling, offering for sale, having
    made, import, or transfer of either its Contributions or its
    Contributor Version.

1.12. "Secondary License"
    means either the GNU General Public License, Version 2.0, the GNU
    Lesser General Public License, Version 2.1, the GNU Affero General
    Public License, Version 3.0, or any later versions of those
    licenses.

1.13. "Source Code Form"
    means the form of the work preferred for making modifications.

1.14. "You" (or "Your")
    means an individual or a legal entity exercising rights under this
    License. For legal entities, "You" includes any entity that
    controls, is controlled by, or is under common control with You. For
    purposes of this definition, "control" means (a) the power, direct
    or indirect, to cause the direction or management of such entity,
    whether by contract or otherwise, or (b) ownership of more than
    fifty percent (50%) of the outstanding shares or beneficial
    ownership of such entity.

2. License Grants and Conditions
--------------------------------

2.1. Grants

Each Contributor hereby grants You a world-wide, royalty-free,
non-exclusive license:

(a) under intellectual property rights (other than patent or trademark)
    Licensable by such Contributor to use, reproduce, make available,
    modify, display, perform, distribute, and otherwise exploit its
    Contributions, either on an unmodified basis, with Modifications, or
    as part of a Larger Work; and

(b) under Patent Claims of such Contributor to make, use, sell, offer
    for sale, have made, import, and otherwise transfer either its
    Contributions or its Contributor Version.

2.2. Effective Date

The licenses granted in Section 2.1 with respect to any Contribution
become effective for each Contribution on the date the Contributor first
distributes such Contribution.

2.3. Limitations on Grant Scope

The licenses granted in this Section 2 are the only rights granted under
this License. No additional rights or licenses will be implied from the
distribution or licensing of Covered Software under this License.
Notwithstanding Section 2.1(b) above, no patent license is granted by a
Contributor:

(a) for any code that a Contributor has removed from Covered Software;
    or

(b) for infringements caused by: (i) Your and any other third party's
    modifications of Covered Software, or (ii) the combination of its
    Contributions with other software (except as part of its Contributor
    Version); or

(c) under Patent Claims infringed by Covered Software in the absence of
    its Contributions.

This License does not grant any rights in the trademarks, service marks,
or logos of any Contributor (except as may be necessary to comply with
the notice requirements in Section 3.4).

2.4. Subsequent Licenses

No Contributor makes additional grants as a result of Your choice to
distribute the Covered Software under a subsequent version of this
License (see Section 10.2) or under the terms of a Secondary License (if
permitted under the terms of Section 3.3).

2.5. Representation

Each Contributor represents that the Contributor believes its
Contributions are its original creation(s) or it has sufficient rights
to grant the rights to its Contributions conveyed by this License.

2.6. Fair Use

This License is not intended to limit any rights You have under
applicable copyright doctrines of fair use, fair dealing, or other
equivalents.

2.7. Conditions

Sections 3.1, 3.2, 3.3, and 3.4 are conditions of the licenses granted
in Section 2.1.

3. Responsibilities
-------------------

3.1. Distribution of Source Form

All distribution of Covered Software in Source Code Form, including any
Modifications that You create or to which You contribute, must be under
the terms of this License. You must inform recipients that the Source
Code Form of the Covered Software is governed by the terms of this
License, and how they can obtain a copy of this License. You may not
attempt to alter or restrict the recipients' rights in the Source Code
Form.

3.2. Distribution of Executable Form

If You distribute Covered Software in Executable Form then:

(a) such Covered Software must also be made available in Source Code
    Form, as described in Section 3.1, and You must inform recipients of
    the Executable Form how they can obtain a copy of such Source Code
    Form by reasonable means in a timely manner, at a charge no more
    than the cost of distribution to the recipient; and

(b) You may distribute such Executable Form under the terms of this
    License, or sublicense it under different terms, provided that the
    license for the Executable Form does not attempt to limit or alter
    the recipients' rights in the Source Code Form under this License.

3.3. Distribution of a Larger Work

You may create and distribute a Larger Work under terms of Your choice,
provided that You also comply with the requirements of this License for
the Covered Software. If the Larger Work is a combination of Covered
Software with a work governed by one or more Secondary Licenses, and the
Covered Software is not Incompatible With Secondary Licenses, this
License permits You to additionally distribute such Covered Software
under the terms of such Secondary License(s), so that the recipient of
the Larger Work may, at their option, further distribute the Covered
Software under the terms of either this License or such Secondary
License(s).

3.4. Notices

You may not remove or alter the substance of any license notices
(including copyright notices, patent notices, disclaimers of warranty,
or limitations of liability) contained within the Source Code Form of
the Covered Software, except that You may alter any license notices to
the extent required to remedy known factual inaccuracies.

3.5. Application of Additional Terms

You may choose to offer, and to charge a fee for, warranty, support,
indemnity or liability obligations to one or more recipients of Covered
Software. However, You may do so only on Your own behalf, and not on
behalf of any Contributor. You must make it absolutely clear that any
such warranty, support, indemnity, or liability obligation is offered by
You alone, and You hereby agree to indemnify every Contributor for any
liability incurred by such Contributor as a result of warranty, support,
indemnity or liability terms You offer. You may include additional
disclaimers of warranty and limitations of liability specific to any
jurisdiction.

4. Inability to Comply Due to Statute or Regulation
---------------------------------------------------

If it is impossible for You to comply with any of the terms of this
License with respect to some or all of the Covered Software due to
statute, judicial order, or regulation then You must: (a) comply with
the terms of this License to the maximum extent possible; and (b)
describe the limitations and the code they affect. Such description must
be placed in a text file included with all distributions of the Covered
Software under this License. Except to the extent prohibited by statute
or regulation, such description must be sufficiently detailed for a
recipient of ordinary skill to be able to understand it.

5. Termination
--------------

5.1. The rights granted under this License will terminate automatically
if You fail to comply with any of its terms. However, if You become
compliant, then the rights granted under this License from a particular
Contributor are reinstated (a) provisionally, unless and until such
Contributor explicitly and finally terminates Your grants, and (b) on an
ongoing basis, if such Contributor fails to notify You of the
non-compliance by some reasonable means prior to 60 days after You have
come back into compliance. Moreover, Your grants from a particular
Contributor are reinstated on an ongoing basis if such Contributor
notifies You of the non-compliance by some reasonable means, this is the
first time You have received notice of non-compliance with this License
from such Contributor, and You become compliant prior to 30 days after
Your receipt of the notice.

5.2. If You initiate litigation against any entity by asserting a patent
infringement claim (excluding declaratory judgment actions,
counter-claims, and cross-claims) alleging that a Contributor Version
directly or indirectly infringes any patent, then the rights granted to
You by any and all Contributors for the Covered Software under Section
2.1 of this License shall terminate.

5.3. In the event of termination under Sections 5.1 or 5.2 above, all
end user license agreements (excluding distributors and resellers) which
have been validly granted by You or Your distributors under this License
prior to termination shall survive termination.

************************************************************************
*                                                                      *
*  6. Disclaimer of Warranty                                           *
*  -------------------------                                           *
*                                                                      *
*  Covered Software is provided under this License on an "as is"       *
*  basis, without warranty of any kind, either expressed, implied, or  *
*  statutory, including, without limitation, warranties that the       *
*  Covered Software is free of defects, merchantable, fit for a        *
*  particular purpose or non-infringing. The entire risk as to the     *
*  quality and performance of the Covered Software is with You.        *
*  Should any Covered Software prove defective in any respect, You     *
*  (not any Contributor) assume the cost of any necessary servicing,   *
*  repair, or correction. This disclaimer of warranty constitutes an   *
*  essential part of this License. No use of any Covered Software is   *
*  authorized under this License except under this disclaimer.         *
*                                                                      *
************************************************************************

************************************************************************
*                                                                      *
*  7. Limitation of Liability                                          *
*  --------------------------                                          *
*                                                                      *
*  Under no circumstances and under no legal theory, whether tort      *
*  (including negligence), contract, or otherwise, shall any           *
*  Contributor, or anyone who distributes Covered Software as          *
*  permitted above, be liable to You for any direct, indirect,         *
*  special, incidental, or consequential damages of any character      *
*  including, without limitation, damages for lost profits, loss of    *
*  goodwill, work stoppage, computer failure or malfunction, or any    *
*  and all other commercial damages or losses, even if such party      *
*  shall have been informed of the possibility of such damages. This   *
*  limitation of liability shall not apply to liability for death or   *
*  personal injury resulting from such party's negligence to the       *
*  extent applicable law prohibits such limitation. Some               *
*  jurisdictions do not allow the exclusion or limitation of           *
*  incidental or consequential damages, so this exclusion and          *
*  limitation may not apply to You.                                    *
*                                                                      *
************************************************************************

8. Litigation
-------------

Any litigation relating to this License may be brought only in the
courts of a jurisdiction where the defendant maintains its principal
place of business and such litigation shall be governed by laws of that
jurisdiction, without reference to its conflict-of-law provisions.
Nothing in this Section shall prevent a party's ability to bring
cross-claims or counter-claims.

9. Miscellaneous
----------------

This License represents the complete agreement concerning the subject
matter hereof. If any provision of this License is held to be
unenforceable, such provision shall be reformed only to the extent
necessary to make it enforceable. Any law or regulation which provides
that the language of a contract shall be construed against the drafter
shall not be used to construe this License against a Contributor.

10. Versions of the License
---------------------------

10.1. New Versions

Mozilla Foundation is the license steward. Except as provided in Section
10.3, no one other than the license steward has the right to modify or
publish new versions of this License. Each version will be given a
distinguishing version number.

10.2. Effect of New Versions

You may distribute the Covered Software under the terms of the version
of the License under which You originally received the Covered Software,
or under the terms of any subsequent version published by the license
steward.

10.3. Modified Versions

If you create software not governed by this License, and you want to
create a new license for such software, you may create and use a
modified version of this License if you rename the license and remove
any references to the name of the license steward (except to note that
such modified license differs from this License).

10.4. Distributing Source Code Form that is Incompatible With Secondary
Licenses

If You choose to distribute Source Code Form that is Incompatible With
Secondary Licenses under the terms of this version of the License, the
notice described in Exhibit B of this License must be attached.

Exhibit A - Source Code Form License Notice
-------------------------------------------

  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.

If it is not possible or desirable to put the notice in a particular
file, then You may include the notice in a location (such as a LICENSE
file in a relevant directory) where a recipient would be likely to look
for such a notice.

You may add additional accurate notices of copyright ownership.

Exhibit B - "Incompatible With Secondary Licenses" Notice
---------------------------------------------------------

  This Source Code Form is "Incompatible With Secondary Licenses", as
  defined by the Mozilla Public License, v. 2.0.
```

#### @ghostery/url-parser@1.3.1 — MPL-2.0

```
Copyright (c) 2017-2025 Ghostery GmbH. All rights reserved.

Mozilla Public License Version 2.0
==================================

1. Definitions
--------------

1.1. "Contributor"
    means each individual or legal entity that creates, contributes to
    the creation of, or owns Covered Software.

1.2. "Contributor Version"
    means the combination of the Contributions of others (if any) used
    by a Contributor and that particular Contributor's Contribution.

1.3. "Contribution"
    means Covered Software of a particular Contributor.

1.4. "Covered Software"
    means Source Code Form to which the initial Contributor has attached
    the notice in Exhibit A, the Executable Form of such Source Code
    Form, and Modifications of such Source Code Form, in each case
    including portions thereof.

1.5. "Incompatible With Secondary Licenses"
    means

    (a) that the initial Contributor has attached the notice described
        in Exhibit B to the Covered Software; or

    (b) that the Covered Software was made available under the terms of
        version 1.1 or earlier of the License, but not also under the
        terms of a Secondary License.

1.6. "Executable Form"
    means any form of the work other than Source Code Form.

1.7. "Larger Work"
    means a work that combines Covered Software with other material, in
    a separate file or files, that is not Covered Software.

1.8. "License"
    means this document.

1.9. "Licensable"
    means having the right to grant, to the maximum extent possible,
    whether at the time of the initial grant or subsequently, any and
    all of the rights conveyed by this License.

1.10. "Modifications"
    means any of the following:

    (a) any file in Source Code Form that results from an addition to,
        deletion from, or modification of the contents of Covered
        Software; or

    (b) any new file in Source Code Form that contains any Covered
        Software.

1.11. "Patent Claims" of a Contributor
    means any patent claim(s), including without limitation, method,
    process, and apparatus claims, in any patent Licensable by such
    Contributor that would be infringed, but for the grant of the
    License, by the making, using, selling, offering for sale, having
    made, import, or transfer of either its Contributions or its
    Contributor Version.

1.12. "Secondary License"
    means either the GNU General Public License, Version 2.0, the GNU
    Lesser General Public License, Version 2.1, the GNU Affero General
    Public License, Version 3.0, or any later versions of those
    licenses.

1.13. "Source Code Form"
    means the form of the work preferred for making modifications.

1.14. "You" (or "Your")
    means an individual or a legal entity exercising rights under this
    License. For legal entities, "You" includes any entity that
    controls, is controlled by, or is under common control with You. For
    purposes of this definition, "control" means (a) the power, direct
    or indirect, to cause the direction or management of such entity,
    whether by contract or otherwise, or (b) ownership of more than
    fifty percent (50%) of the outstanding shares or beneficial
    ownership of such entity.

2. License Grants and Conditions
--------------------------------

2.1. Grants

Each Contributor hereby grants You a world-wide, royalty-free,
non-exclusive license:

(a) under intellectual property rights (other than patent or trademark)
    Licensable by such Contributor to use, reproduce, make available,
    modify, display, perform, distribute, and otherwise exploit its
    Contributions, either on an unmodified basis, with Modifications, or
    as part of a Larger Work; and

(b) under Patent Claims of such Contributor to make, use, sell, offer
    for sale, have made, import, and otherwise transfer either its
    Contributions or its Contributor Version.

2.2. Effective Date

The licenses granted in Section 2.1 with respect to any Contribution
become effective for each Contribution on the date the Contributor first
distributes such Contribution.

2.3. Limitations on Grant Scope

The licenses granted in this Section 2 are the only rights granted under
this License. No additional rights or licenses will be implied from the
distribution or licensing of Covered Software under this License.
Notwithstanding Section 2.1(b) above, no patent license is granted by a
Contributor:

(a) for any code that a Contributor has removed from Covered Software;
    or

(b) for infringements caused by: (i) Your and any other third party's
    modifications of Covered Software, or (ii) the combination of its
    Contributions with other software (except as part of its Contributor
    Version); or

(c) under Patent Claims infringed by Covered Software in the absence of
    its Contributions.

This License does not grant any rights in the trademarks, service marks,
or logos of any Contributor (except as may be necessary to comply with
the notice requirements in Section 3.4).

2.4. Subsequent Licenses

No Contributor makes additional grants as a result of Your choice to
distribute the Covered Software under a subsequent version of this
License (see Section 10.2) or under the terms of a Secondary License (if
permitted under the terms of Section 3.3).

2.5. Representation

Each Contributor represents that the Contributor believes its
Contributions are its original creation(s) or it has sufficient rights
to grant the rights to its Contributions conveyed by this License.

2.6. Fair Use

This License is not intended to limit any rights You have under
applicable copyright doctrines of fair use, fair dealing, or other
equivalents.

2.7. Conditions

Sections 3.1, 3.2, 3.3, and 3.4 are conditions of the licenses granted
in Section 2.1.

3. Responsibilities
-------------------

3.1. Distribution of Source Form

All distribution of Covered Software in Source Code Form, including any
Modifications that You create or to which You contribute, must be under
the terms of this License. You must inform recipients that the Source
Code Form of the Covered Software is governed by the terms of this
License, and how they can obtain a copy of this License. You may not
attempt to alter or restrict the recipients' rights in the Source Code
Form.

3.2. Distribution of Executable Form

If You distribute Covered Software in Executable Form then:

(a) such Covered Software must also be made available in Source Code
    Form, as described in Section 3.1, and You must inform recipients of
    the Executable Form how they can obtain a copy of such Source Code
    Form by reasonable means in a timely manner, at a charge no more
    than the cost of distribution to the recipient; and

(b) You may distribute such Executable Form under the terms of this
    License, or sublicense it under different terms, provided that the
    license for the Executable Form does not attempt to limit or alter
    the recipients' rights in the Source Code Form under this License.

3.3. Distribution of a Larger Work

You may create and distribute a Larger Work under terms of Your choice,
provided that You also comply with the requirements of this License for
the Covered Software. If the Larger Work is a combination of Covered
Software with a work governed by one or more Secondary Licenses, and the
Covered Software is not Incompatible With Secondary Licenses, this
License permits You to additionally distribute such Covered Software
under the terms of such Secondary License(s), so that the recipient of
the Larger Work may, at their option, further distribute the Covered
Software under the terms of either this License or such Secondary
License(s).

3.4. Notices

You may not remove or alter the substance of any license notices
(including copyright notices, patent notices, disclaimers of warranty,
or limitations of liability) contained within the Source Code Form of
the Covered Software, except that You may alter any license notices to
the extent required to remedy known factual inaccuracies.

3.5. Application of Additional Terms

You may choose to offer, and to charge a fee for, warranty, support,
indemnity or liability obligations to one or more recipients of Covered
Software. However, You may do so only on Your own behalf, and not on
behalf of any Contributor. You must make it absolutely clear that any
such warranty, support, indemnity, or liability obligation is offered by
You alone, and You hereby agree to indemnify every Contributor for any
liability incurred by such Contributor as a result of warranty, support,
indemnity or liability terms You offer. You may include additional
disclaimers of warranty and limitations of liability specific to any
jurisdiction.

4. Inability to Comply Due to Statute or Regulation
---------------------------------------------------

If it is impossible for You to comply with any of the terms of this
License with respect to some or all of the Covered Software due to
statute, judicial order, or regulation then You must: (a) comply with
the terms of this License to the maximum extent possible; and (b)
describe the limitations and the code they affect. Such description must
be placed in a text file included with all distributions of the Covered
Software under this License. Except to the extent prohibited by statute
or regulation, such description must be sufficiently detailed for a
recipient of ordinary skill to be able to understand it.

5. Termination
--------------

5.1. The rights granted under this License will terminate automatically
if You fail to comply with any of its terms. However, if You become
compliant, then the rights granted under this License from a particular
Contributor are reinstated (a) provisionally, unless and until such
Contributor explicitly and finally terminates Your grants, and (b) on an
ongoing basis, if such Contributor fails to notify You of the
non-compliance by some reasonable means prior to 60 days after You have
come back into compliance. Moreover, Your grants from a particular
Contributor are reinstated on an ongoing basis if such Contributor
notifies You of the non-compliance by some reasonable means, this is the
first time You have received notice of non-compliance with this License
from such Contributor, and You become compliant prior to 30 days after
Your receipt of the notice.

5.2. If You initiate litigation against any entity by asserting a patent
infringement claim (excluding declaratory judgment actions,
counter-claims, and cross-claims) alleging that a Contributor Version
directly or indirectly infringes any patent, then the rights granted to
You by any and all Contributors for the Covered Software under Section
2.1 of this License shall terminate.

5.3. In the event of termination under Sections 5.1 or 5.2 above, all
end user license agreements (excluding distributors and resellers) which
have been validly granted by You or Your distributors under this License
prior to termination shall survive termination.

************************************************************************
*                                                                      *
*  6. Disclaimer of Warranty                                           *
*  -------------------------                                           *
*                                                                      *
*  Covered Software is provided under this License on an "as is"       *
*  basis, without warranty of any kind, either expressed, implied, or  *
*  statutory, including, without limitation, warranties that the       *
*  Covered Software is free of defects, merchantable, fit for a        *
*  particular purpose or non-infringing. The entire risk as to the     *
*  quality and performance of the Covered Software is with You.        *
*  Should any Covered Software prove defective in any respect, You     *
*  (not any Contributor) assume the cost of any necessary servicing,   *
*  repair, or correction. This disclaimer of warranty constitutes an   *
*  essential part of this License. No use of any Covered Software is   *
*  authorized under this License except under this disclaimer.         *
*                                                                      *
************************************************************************

************************************************************************
*                                                                      *
*  7. Limitation of Liability                                          *
*  --------------------------                                          *
*                                                                      *
*  Under no circumstances and under no legal theory, whether tort      *
*  (including negligence), contract, or otherwise, shall any           *
*  Contributor, or anyone who distributes Covered Software as          *
*  permitted above, be liable to You for any direct, indirect,         *
*  special, incidental, or consequential damages of any character      *
*  including, without limitation, damages for lost profits, loss of    *
*  goodwill, work stoppage, computer failure or malfunction, or any    *
*  and all other commercial damages or losses, even if such party      *
*  shall have been informed of the possibility of such damages. This   *
*  limitation of liability shall not apply to liability for death or   *
*  personal injury resulting from such party's negligence to the       *
*  extent applicable law prohibits such limitation. Some               *
*  jurisdictions do not allow the exclusion or limitation of           *
*  incidental or consequential damages, so this exclusion and          *
*  limitation may not apply to You.                                    *
*                                                                      *
************************************************************************

8. Litigation
-------------

Any litigation relating to this License may be brought only in the
courts of a jurisdiction where the defendant maintains its principal
place of business and such litigation shall be governed by laws of that
jurisdiction, without reference to its conflict-of-law provisions.
Nothing in this Section shall prevent a party's ability to bring
cross-claims or counter-claims.

9. Miscellaneous
----------------

This License represents the complete agreement concerning the subject
matter hereof. If any provision of this License is held to be
unenforceable, such provision shall be reformed only to the extent
necessary to make it enforceable. Any law or regulation which provides
that the language of a contract shall be construed against the drafter
shall not be used to construe this License against a Contributor.

10. Versions of the License
---------------------------

10.1. New Versions

Mozilla Foundation is the license steward. Except as provided in Section
10.3, no one other than the license steward has the right to modify or
publish new versions of this License. Each version will be given a
distinguishing version number.

10.2. Effect of New Versions

You may distribute the Covered Software under the terms of the version
of the License under which You originally received the Covered Software,
or under the terms of any subsequent version published by the license
steward.

10.3. Modified Versions

If you create software not governed by this License, and you want to
create a new license for such software, you may create and use a
modified version of this License if you rename the license and remove
any references to the name of the license steward (except to note that
such modified license differs from this License).

10.4. Distributing Source Code Form that is Incompatible With Secondary
Licenses

If You choose to distribute Source Code Form that is Incompatible With
Secondary Licenses under the terms of this version of the License, the
notice described in Exhibit B of this License must be attached.

Exhibit A - Source Code Form License Notice
-------------------------------------------

  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.

If it is not possible or desirable to put the notice in a particular
file, then You may include the notice in a location (such as a LICENSE
file in a relevant directory) where a recipient would be likely to look
for such a notice.

You may add additional accurate notices of copyright ownership.

Exhibit B - "Incompatible With Secondary Licenses" Notice
---------------------------------------------------------

  This Source Code Form is "Incompatible With Secondary Licenses", as
  defined by the Mozilla Public License, v. 2.0.
```

#### @protobufjs/aspromise@1.1.2, @protobufjs/base64@1.1.2, @protobufjs/codegen@2.0.5, @protobufjs/eventemitter@1.1.1, @protobufjs/fetch@1.1.1, @protobufjs/float@1.0.2, @protobufjs/path@1.1.2, @protobufjs/pool@1.1.0, @protobufjs/utf8@1.1.2 — BSD-3-Clause

```
Copyright (c) 2016, Daniel Wirtz  All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

* Redistributions of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in the
  documentation and/or other materials provided with the distribution.
* Neither the name of its author, nor the names of its contributors
  may be used to endorse or promote products derived from this software
  without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

#### @remusao/guess-url-type@2.1.0, @remusao/small@2.1.0, @remusao/smaz@2.2.0, @remusao/smaz-compress@2.2.0, @remusao/smaz-decompress@2.2.0, @remusao/trie@2.1.0 — MPL-2.0

```
Mozilla Public License Version 2.0
==================================

1. Definitions
--------------

1.1. "Contributor"
    means each individual or legal entity that creates, contributes to
    the creation of, or owns Covered Software.

1.2. "Contributor Version"
    means the combination of the Contributions of others (if any) used
    by a Contributor and that particular Contributor's Contribution.

1.3. "Contribution"
    means Covered Software of a particular Contributor.

1.4. "Covered Software"
    means Source Code Form to which the initial Contributor has attached
    the notice in Exhibit A, the Executable Form of such Source Code
    Form, and Modifications of such Source Code Form, in each case
    including portions thereof.

1.5. "Incompatible With Secondary Licenses"
    means

    (a) that the initial Contributor has attached the notice described
        in Exhibit B to the Covered Software; or

    (b) that the Covered Software was made available under the terms of
        version 1.1 or earlier of the License, but not also under the
        terms of a Secondary License.

1.6. "Executable Form"
    means any form of the work other than Source Code Form.

1.7. "Larger Work"
    means a work that combines Covered Software with other material, in
    a separate file or files, that is not Covered Software.

1.8. "License"
    means this document.

1.9. "Licensable"
    means having the right to grant, to the maximum extent possible,
    whether at the time of the initial grant or subsequently, any and
    all of the rights conveyed by this License.

1.10. "Modifications"
    means any of the following:

    (a) any file in Source Code Form that results from an addition to,
        deletion from, or modification of the contents of Covered
        Software; or

    (b) any new file in Source Code Form that contains any Covered
        Software.

1.11. "Patent Claims" of a Contributor
    means any patent claim(s), including without limitation, method,
    process, and apparatus claims, in any patent Licensable by such
    Contributor that would be infringed, but for the grant of the
    License, by the making, using, selling, offering for sale, having
    made, import, or transfer of either its Contributions or its
    Contributor Version.

1.12. "Secondary License"
    means either the GNU General Public License, Version 2.0, the GNU
    Lesser General Public License, Version 2.1, the GNU Affero General
    Public License, Version 3.0, or any later versions of those
    licenses.

1.13. "Source Code Form"
    means the form of the work preferred for making modifications.

1.14. "You" (or "Your")
    means an individual or a legal entity exercising rights under this
    License. For legal entities, "You" includes any entity that
    controls, is controlled by, or is under common control with You. For
    purposes of this definition, "control" means (a) the power, direct
    or indirect, to cause the direction or management of such entity,
    whether by contract or otherwise, or (b) ownership of more than
    fifty percent (50%) of the outstanding shares or beneficial
    ownership of such entity.

2. License Grants and Conditions
--------------------------------

2.1. Grants

Each Contributor hereby grants You a world-wide, royalty-free,
non-exclusive license:

(a) under intellectual property rights (other than patent or trademark)
    Licensable by such Contributor to use, reproduce, make available,
    modify, display, perform, distribute, and otherwise exploit its
    Contributions, either on an unmodified basis, with Modifications, or
    as part of a Larger Work; and

(b) under Patent Claims of such Contributor to make, use, sell, offer
    for sale, have made, import, and otherwise transfer either its
    Contributions or its Contributor Version.

2.2. Effective Date

The licenses granted in Section 2.1 with respect to any Contribution
become effective for each Contribution on the date the Contributor first
distributes such Contribution.

2.3. Limitations on Grant Scope

The licenses granted in this Section 2 are the only rights granted under
this License. No additional rights or licenses will be implied from the
distribution or licensing of Covered Software under this License.
Notwithstanding Section 2.1(b) above, no patent license is granted by a
Contributor:

(a) for any code that a Contributor has removed from Covered Software;
    or

(b) for infringements caused by: (i) Your and any other third party's
    modifications of Covered Software, or (ii) the combination of its
    Contributions with other software (except as part of its Contributor
    Version); or

(c) under Patent Claims infringed by Covered Software in the absence of
    its Contributions.

This License does not grant any rights in the trademarks, service marks,
or logos of any Contributor (except as may be necessary to comply with
the notice requirements in Section 3.4).

2.4. Subsequent Licenses

No Contributor makes additional grants as a result of Your choice to
distribute the Covered Software under a subsequent version of this
License (see Section 10.2) or under the terms of a Secondary License (if
permitted under the terms of Section 3.3).

2.5. Representation

Each Contributor represents that the Contributor believes its
Contributions are its original creation(s) or it has sufficient rights
to grant the rights to its Contributions conveyed by this License.

2.6. Fair Use

This License is not intended to limit any rights You have under
applicable copyright doctrines of fair use, fair dealing, or other
equivalents.

2.7. Conditions

Sections 3.1, 3.2, 3.3, and 3.4 are conditions of the licenses granted
in Section 2.1.

3. Responsibilities
-------------------

3.1. Distribution of Source Form

All distribution of Covered Software in Source Code Form, including any
Modifications that You create or to which You contribute, must be under
the terms of this License. You must inform recipients that the Source
Code Form of the Covered Software is governed by the terms of this
License, and how they can obtain a copy of this License. You may not
attempt to alter or restrict the recipients' rights in the Source Code
Form.

3.2. Distribution of Executable Form

If You distribute Covered Software in Executable Form then:

(a) such Covered Software must also be made available in Source Code
    Form, as described in Section 3.1, and You must inform recipients of
    the Executable Form how they can obtain a copy of such Source Code
    Form by reasonable means in a timely manner, at a charge no more
    than the cost of distribution to the recipient; and

(b) You may distribute such Executable Form under the terms of this
    License, or sublicense it under different terms, provided that the
    license for the Executable Form does not attempt to limit or alter
    the recipients' rights in the Source Code Form under this License.

3.3. Distribution of a Larger Work

You may create and distribute a Larger Work under terms of Your choice,
provided that You also comply with the requirements of this License for
the Covered Software. If the Larger Work is a combination of Covered
Software with a work governed by one or more Secondary Licenses, and the
Covered Software is not Incompatible With Secondary Licenses, this
License permits You to additionally distribute such Covered Software
under the terms of such Secondary License(s), so that the recipient of
the Larger Work may, at their option, further distribute the Covered
Software under the terms of either this License or such Secondary
License(s).

3.4. Notices

You may not remove or alter the substance of any license notices
(including copyright notices, patent notices, disclaimers of warranty,
or limitations of liability) contained within the Source Code Form of
the Covered Software, except that You may alter any license notices to
the extent required to remedy known factual inaccuracies.

3.5. Application of Additional Terms

You may choose to offer, and to charge a fee for, warranty, support,
indemnity or liability obligations to one or more recipients of Covered
Software. However, You may do so only on Your own behalf, and not on
behalf of any Contributor. You must make it absolutely clear that any
such warranty, support, indemnity, or liability obligation is offered by
You alone, and You hereby agree to indemnify every Contributor for any
liability incurred by such Contributor as a result of warranty, support,
indemnity or liability terms You offer. You may include additional
disclaimers of warranty and limitations of liability specific to any
jurisdiction.

4. Inability to Comply Due to Statute or Regulation
---------------------------------------------------

If it is impossible for You to comply with any of the terms of this
License with respect to some or all of the Covered Software due to
statute, judicial order, or regulation then You must: (a) comply with
the terms of this License to the maximum extent possible; and (b)
describe the limitations and the code they affect. Such description must
be placed in a text file included with all distributions of the Covered
Software under this License. Except to the extent prohibited by statute
or regulation, such description must be sufficiently detailed for a
recipient of ordinary skill to be able to understand it.

5. Termination
--------------

5.1. The rights granted under this License will terminate automatically
if You fail to comply with any of its terms. However, if You become
compliant, then the rights granted under this License from a particular
Contributor are reinstated (a) provisionally, unless and until such
Contributor explicitly and finally terminates Your grants, and (b) on an
ongoing basis, if such Contributor fails to notify You of the
non-compliance by some reasonable means prior to 60 days after You have
come back into compliance. Moreover, Your grants from a particular
Contributor are reinstated on an ongoing basis if such Contributor
notifies You of the non-compliance by some reasonable means, this is the
first time You have received notice of non-compliance with this License
from such Contributor, and You become compliant prior to 30 days after
Your receipt of the notice.

5.2. If You initiate litigation against any entity by asserting a patent
infringement claim (excluding declaratory judgment actions,
counter-claims, and cross-claims) alleging that a Contributor Version
directly or indirectly infringes any patent, then the rights granted to
You by any and all Contributors for the Covered Software under Section
2.1 of this License shall terminate.

5.3. In the event of termination under Sections 5.1 or 5.2 above, all
end user license agreements (excluding distributors and resellers) which
have been validly granted by You or Your distributors under this License
prior to termination shall survive termination.

************************************************************************
*                                                                      *
*  6. Disclaimer of Warranty                                           *
*  -------------------------                                           *
*                                                                      *
*  Covered Software is provided under this License on an "as is"       *
*  basis, without warranty of any kind, either expressed, implied, or  *
*  statutory, including, without limitation, warranties that the       *
*  Covered Software is free of defects, merchantable, fit for a        *
*  particular purpose or non-infringing. The entire risk as to the     *
*  quality and performance of the Covered Software is with You.        *
*  Should any Covered Software prove defective in any respect, You     *
*  (not any Contributor) assume the cost of any necessary servicing,   *
*  repair, or correction. This disclaimer of warranty constitutes an   *
*  essential part of this License. No use of any Covered Software is   *
*  authorized under this License except under this disclaimer.         *
*                                                                      *
************************************************************************

************************************************************************
*                                                                      *
*  7. Limitation of Liability                                          *
*  --------------------------                                          *
*                                                                      *
*  Under no circumstances and under no legal theory, whether tort      *
*  (including negligence), contract, or otherwise, shall any           *
*  Contributor, or anyone who distributes Covered Software as          *
*  permitted above, be liable to You for any direct, indirect,         *
*  special, incidental, or consequential damages of any character      *
*  including, without limitation, damages for lost profits, loss of    *
*  goodwill, work stoppage, computer failure or malfunction, or any    *
*  and all other commercial damages or losses, even if such party      *
*  shall have been informed of the possibility of such damages. This   *
*  limitation of liability shall not apply to liability for death or   *
*  personal injury resulting from such party's negligence to the       *
*  extent applicable law prohibits such limitation. Some               *
*  jurisdictions do not allow the exclusion or limitation of           *
*  incidental or consequential damages, so this exclusion and          *
*  limitation may not apply to You.                                    *
*                                                                      *
************************************************************************

8. Litigation
-------------

Any litigation relating to this License may be brought only in the
courts of a jurisdiction where the defendant maintains its principal
place of business and such litigation shall be governed by laws of that
jurisdiction, without reference to its conflict-of-law provisions.
Nothing in this Section shall prevent a party's ability to bring
cross-claims or counter-claims.

9. Miscellaneous
----------------

This License represents the complete agreement concerning the subject
matter hereof. If any provision of this License is held to be
unenforceable, such provision shall be reformed only to the extent
necessary to make it enforceable. Any law or regulation which provides
that the language of a contract shall be construed against the drafter
shall not be used to construe this License against a Contributor.

10. Versions of the License
---------------------------

10.1. New Versions

Mozilla Foundation is the license steward. Except as provided in Section
10.3, no one other than the license steward has the right to modify or
publish new versions of this License. Each version will be given a
distinguishing version number.

10.2. Effect of New Versions

You may distribute the Covered Software under the terms of the version
of the License under which You originally received the Covered Software,
or under the terms of any subsequent version published by the license
steward.

10.3. Modified Versions

If you create software not governed by this License, and you want to
create a new license for such software, you may create and use a
modified version of this License if you rename the license and remove
any references to the name of the license steward (except to note that
such modified license differs from this License).

10.4. Distributing Source Code Form that is Incompatible With Secondary
Licenses

If You choose to distribute Source Code Form that is Incompatible With
Secondary Licenses under the terms of this version of the License, the
notice described in Exhibit B of this License must be attached.

Exhibit A - Source Code Form License Notice
-------------------------------------------

  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.

If it is not possible or desirable to put the notice in a particular
file, then You may include the notice in a location (such as a LICENSE
file in a relevant directory) where a recipient would be likely to look
for such a notice.

You may add additional accurate notices of copyright ownership.

Exhibit B - "Incompatible With Secondary Licenses" Notice
---------------------------------------------------------

  This Source Code Form is "Incompatible With Secondary Licenses", as
  defined by the Mozilla Public License, v. 2.0.
```

#### @zone-eu/mailsplit@5.4.17 — (MIT OR EUPL-1.1+)

`LICENSE.EUPL-1.2`

```
EUROOPA LIIDU TARKVARA VABA KASUTUSE LITSENTS v. 1.2
EUPL © Euroopa Liit 2007, 2016

Euroopa Liidu tarkvara vaba kasutuse litsents („EUPL“) kehtib allpool määratletud teose suhtes, mida levitatakse vastavalt käesoleva litsentsi tingimustele. Teost on keelatud kasutada muul viisil kui vastavalt käesoleva litsentsi tingimustele niivõrd, kuivõrd sellise kasutamise suhtes kehtivad teose autoriõiguse omaja õigused).

Teost levitatakse vastavalt käesoleva litsentsi tingimustele, kui allpool määratletud litsentsiandja paneb vahetult teose autoriõiguse märke järele järgmise märke:

Litsentsitud EUPL alusel

või on muul viisil väljendanud soovi litsentsida originaalteos EUPL alusel.

1. Mõisted
Käesolevas litsentsis kasutatakse järgmisi mõisteid:

— „litsents“ – käesolev litsents;

— „originaalteos“ – teos või tarkvara, mida litsentsiandja käesoleva litsentsi alusel levitab või edastab ning mis on kättesaadav lähtekoodina ja teatavatel juhtudel ka täitmiskoodina;

— „tuletatud teos“ – teos või tarkvara, mida litsentsisaajal on olnud võimalik luua tuginedes originaalteosele või selle muudetud versioonile. Käesolevas litsentsis ei määratleta muudatuse ulatust või sõltuvust originaalteosest, mis on vajalik selleks, et klassifitseerida teos tuletatud teoseks; selline ulatus määratakse kindlaks vastavalt artiklis 15 nimetatud riigis kehtivatele autoriõigust käsitlevatele õigusaktidele;

— „teos“ – originaalteos või sellest tuletatud teosed;

— „lähtekood“ – teose inimloetav vorm, mida inimestel on kõige lihtsam uurida ja muuta;

— „täitmiskood“ – igasugune kood, mille on tavaliselt koostanud arvuti ja mis on mõeldud arvuti poolt programmina tõlgendamiseks;

— „litsentsiandja“ – füüsiline või juriidiline isik, kes levitab või edastab teost litsentsi alusel;

— „edasiarendaja“ – füüsiline või juriidiline isik, kes muudab teost litsentsi alusel või osaleb muul moel tuletatud teose loomises;

— „litsentsisaaja“ või „Teie“ – iga füüsiline või juriidiline isik, kes kasutab teost ükskõik mis moel vastavalt litsentsi tingimustele;

— „levitamine“ või „edastamine“ – teose koopiate müümine, teisele isikule andmine, laenutamine, rentimine, levitamine, edastamine, ülekandmine või teose koopiate või selle oluliste funktsioonide muul viisil teistele füüsilistele või juriidilistele isikutele kättesaadavaks tegemine võrgus või võrguväliselt.

2. Litsentsiga antavate õiguste ulatus
Käesolevaga annab litsentsiandja Teile ülemaailmse, tasuta, all-litsentsi andmise õigusega lihtlitsentsi, mille alusel võite teha originaalteose autoriõiguse kehtivusaja jooksul järgmist:

— kasutada teost mis tahes eesmärgil ja mis tahes viisil,

— teost reprodutseerida,

— teost muuta ja luua teosel põhinevaid tuletatud teoseid,

— teost või selle koopiaid üldsusele edastada, sealhulgas neid kättesaadavaks teha või eksponeerida, samuti avalikult esitada,

— teost või selle koopiaid levitada,

— teost või selle koopiaid laenutada ja rentida,

— anda all-litsentse teose või selle koopiate suhtes kehtivate õiguste kohta.

Neid õigusi võib teostada mistahes praegu tuntud või hiljem leiutatud keskkonnas, toel või formaadis, ja sellises ulatuses, nagu lubab kohaldatav õigus.

Riikides, kus kehtivad isiklikud õigused, loobub litsentsiandja seadusega lubatud ulatuses oma õigusest teostada isiklikke õigusi, et oleks võimalik eespool loetletud varalisi õigusi litsentsida.

Litsentsiandja annab litsentsisaajale tasuta lihtlitsentsi kõigi litsentsiandjale kuuluvate patentide kasutamiseks ulatuses, mis on vajalik teose suhtes käesoleva litsentsiga antud õiguste kasutamiseks.

3. Lähtekoodi edastamine
Litsentsiandja võib teose kättesaadavaks teha kas lähtekoodi või täitmiskoodi kujul. Kui teos tehakse kättesaadavaks täitmiskoodi kujul, lisab litsentsiandja igale tema poolt levitatavale teose koopiale lähtekoodi masinloetava koopia või näitab teose autoriõiguse märke järele lisatud märkega ära hoidla, kust lähtekood on kergesti ja tasuta kättesaadav seni, kuni litsentsiandja jätkab teose levitamist või edastamist.

4. Autoriõiguse piiramine
Käesolev litsents ei võta litsentsisaajalt võimalusi, mis tulenevad teose õiguste omaja ainuõiguste suhtes kehtestatud eranditest või ainuõiguste piiramisest, nende õiguste ammendumisest või muudest nende õiguste suhtes kohaldatavatest piirangutest.

5. Litsentsisaaja kohustused
Eespool nimetatud õigused antakse litsentsisaajale tingimusel, et ta peab kinni teatavatest piirangutest ja täidab teatavaid talle pandud kohustusi. Need kohustused on järgmised:

Õigus autorsusele. Litsentsisaaja hoiab puutumatuna kõik autoriõiguse, patentide ja kaubamärkide kohta käivad märked ja kõik märked, mis viitavad litsentsile ja garantii puudumisele. Litsentsisaaja peab teose iga tema poolt levitatavale või edastatavale koopiale lisama nimetatud märgete koopiad ja litsentsi koopia. Litsentsisaaja peab tagama, et iga tuletatud teos kannab selget märget selle kohta, et teost on muudetud ja muutmise kuupäeva.
Klausel vaba kasutamise tagamise kohta (copyleft). Kui litsentsisaaja levitab või edastab originaalteose või tuletatud teoste koopiaid, toimub see levitamine või edastamine vastavalt käesoleva litsentsi tingimustele või käesoleva litsentsi hilisema versiooni tingimustele, välja arvatud juhul, kui originaalteost levitatakse ainult vastavalt litsentsi käesolevale versioonile (näiteks märkides „ainult EUPL v.1.2“). Litsentsisaaja ei tohi (litsentsiandjaks saades) teosele või tuletatud teosele lisada ega kehtestada mingeid lisatingimusi, mis muudavad või piiravad litsentsi tingimusi.
Ühilduvuse klausel. Kui litsentsisaaja levitab või edastab tuletatud teoseid või nende koopiaid, mis põhinevad nii teosel kui ka teisel, käesoleva litsentsiga ühilduva litsentsi alusel litsentsitud teosel, võib see levitamine või edastamine toimuda vastavalt nimetatud ühilduva litsentsi tingimustele. Käesolevas klauslis tähendab „ühilduv litsents“ käesoleva litsentsi lisas loetletud litsentse. Kui litsentsisaaja ühilduvale litsentsile vastavad kohustused on vastuolus tema kohustustega vastavalt käesolevale litsentsile, loetakse kehtivaks ühilduva litsentsi kohased kohustused.
Lähtekoodi lisamine. Teose koopiate levitamisel või edastamisel lisab litsentsisaaja igale koopiale lähtekoodi masinloetava koopia või näitab ära hoidla, kust lähtekood on kergesti ja tasuta kättesaadav seni, kuni litsentsisaaja jätkab teose levitamist või edastamist.
Õiguskaitse. Käesoleva litsentsiga ei anta luba kasutada litsentsiandja ärinimesid, kaubamärke, teenindusmärke või nimesid, välja arvatud juhul, kui see on vajalik mõistlikuks ja tavapäraseks kasutamiseks teose päritolu kirjeldamisel ja autoriõiguse märke sisu reprodutseerimisel.
6. Autorsuse ahel
Esialgne litsentsiandja tagab, et käesoleva litsentsiga antav autoriõigus originaalteosele kuulub talle või on talle litsentsitud ja et tal on õigus seda litsentsiga edasi anda.

Iga edasiarendaja tagab, et autoriõigus tema poolt teosele tehtavatele muudatustele kuulub talle või on talle litsentsitud ja et tal on õigus litsentsi anda.

Iga kord, kui Te võtate vastu litsentsi, annavad esialgne litsentsiandja ja hilisemad edasiarendajad Teile litsentsi nende osaluse kasutamiseks teoses vastavalt käesoleva litsentsi tingimustele.

7. Garantii puudumine
Teos on veel pooleli ja arvukad edasiarendajad parendavad seda järjepidevalt. See ei ole lõpetatud teos ja võib seetõttu sisaldada defekte ja programmivigu, mis on omased seda liiki arendustegevusele.

Seetõttu levitatakse teost litsentsi alusel „sellisena, nagu see on“ ilma teose suhtes kehtiva garantiita, muu hulgas garantiita kaubandusliku kvaliteedi kohta, garantiita sobivuse kohta mingi kindla eesmärgi jaoks, garantiita defektide ja vigade puudumise kohta, garantiita täpsuse kohta ja selle kohta, et ei ole rikutud muid intellektuaalse omandi õigusi peale käesoleva litsentsi artiklis 6 nimetatud autoriõiguse.

Käesolev garantii puudumise klausel on litsentsi oluline osa ja teosele õiguste andmise eeltingimus.

8. Vastutuse välistamine
Välja arvatud tahtliku õiguserikkumise või füüsilistele isikutele tekitatud otsese kahju puhul, ei vastuta litsentsiandja mitte mingil juhul litsentsi või teose kasutamise tagajärjel tekkinud mistahes otsese või kaudse, varalise või moraalse kahju eest, muu hulgas maineväärtuse langusest tekkinud kahju, tööseisakute, arvutirikke ja talitlushäirete, andmete kadumise ja ärikahju eest, isegi juhul kui litsentsiandjat on sellise kahju tekkimise võimalikkusest teavitatud. Litsentsiandja vastutab siiski vastavalt tootevastutust käsitlevatele õigusaktidele niivõrd, kuivõrd need õigusaktid on teose suhtes kohaldatavad.

9. Lisakokkulepped
Teose levitamisel võite Te sõlmida lisakokkuleppe, milles määratakse kindlaks käesoleva litsentsiga vastavuses olevad kohustused või teenused. Kuid kui olete nõus võtma kohustusi, võite Te tegutseda ainult iseenda nimel ja vastutusel, mitte esialgse litsentsiandja või teiste edasiarendajate nimel, ja ainult juhul, kui Te nõustute vabastama edasiarendajad vastutusest, kaitsma ja hoidma neid kahju tekkimise eest vastutuse või nõuete osas, mida nende vastu võidakse esitada selle tagajärjel, et Teie pakute garantiid või võtate lisavastutuse.

10. Litsentsiga nõustumine
Käesoleva litsentsi sätetega saab nõustuda, klõpsates ikoonile „Nõustun“ litsentsi teksti näitava akna all või väljendades nõusolekut muul sarnasel viisil vastavalt kehtivatele õigusaktidele. Sellele ikoonile klõpsates väljendate selgelt ja pöördumatult oma nõusolekut käesoleva litsentsi ja kõigi selle tingimuste suhtes.

Samuti nõustute pöördumatult käesoleva litsentsi ja kõigi selle tingimustega, kui teostate Teile käesoleva litsentsi artikliga 2 antud õigusi, näiteks kasutate teost, loote tuletatud teose või levitate või edastate teost või selle koopiaid.

11. Üldsuse teavitamine
Juhul, kui Te kasutate teose levitamiseks või edastamiseks elektroonilisi sidevahendeid (näiteks võimaldate teose allalaadimist veebisaidilt), tuleb levitamiskanalil või andmekandjal (näiteks veebisaidil) teha üldsusele kättesaadavaks vähemalt kohaldatava õiguse alusel kohustuslik teave litsentsiandja ja litsentsi kohta ning selle kohta, kuidas see on litsentsisaajale kättesaadav, litsentsilepingu sõlmimise kohta ja selle kohta, kuidas litsentsisaaja saab litsentsi säilitada ja reprodutseerida.

12. Litsentsi lõppemine
Litsents ja sellega antud õigused lõppevad automaatselt juhul, kui litsentsisaaja rikub litsentsi tingimusi.

Sellise lõppemise korral ei lõpe ühegi sellise isiku litsents, kes sai teose litsentsisaajalt vastavalt litsentsi tingimustele, juhul kui see isik täidab jätkuvalt litsentsi tingimusi.

13. Muud sätted
Ilma et see piiraks litsentsi artikli 9 kohaldamist, sisaldab litsents kogu kokkulepet, mis osapoolte vahel seose teosega on.

Kui mõni litsentsi säte on vastavalt kohaldatavatele õigusaktidele kehtetu või seda ei ole võimalik jõustada, ei mõjuta see litsentsi kui terviku kehtivust ega jõustatavust. Sellist sätet tõlgendatakse või muudetakse nii nagu vaja, et see kehtiks ja saaks tagada selle täitmise.

Euroopa Komisjon võib avaldada käesoleva litsentsi muid keeleversioone või uusi versioone või lisa uuendatud versioone, kuivõrd see on vajalik ja mõistlik, vähendamata sellega litsentsiga antavate õiguste ulatust. Litsentsi uued versioonid avaldatakse kordumatu versiooninumbriga.

Käesoleva litsentsi kõik keeleversioonid, mille Euroopa Komisjon on heaks kiitnud, on võrdväärsed. Osapooled võivad kasutada enda valitud keeleversiooni.

14. Kohtualluvus
Ilma et see piiraks konkreetse osapooltevahelise kokkuleppe kohaldamist,

— kuuluvad käesoleva litsentsi tõlgendamisest tulenevad kohtuvaidlused Euroopa Liidu institutsioonide, organite, büroode või asutuste kui litsentsiandja ja mistahes litsentsisaaja vahel Euroopa Liidu Kohtu pädevusse, nagu on sätestatud Euroopa Liidu toimimise lepingu artiklis 272,

— kuuluvad käesoleva litsentsi tõlgendamisest tulenevad kohtuvaidlused muude osapoolte vahel selle pädeva kohtu ainupädevusse, kelle tööpiirkonnas asub litsentsiandja elukoht või peamine tegevuskoht.

15. Kohaldatav õigus
Ilma et see piiraks konkreetse osapooltevahelise kokkuleppe kohaldamist,

— kohaldatakse käesoleva litsentsi suhtes selle Euroopa Liidu liikmesriigi õigust, kus paikneb litsentsiandja peakorter, elukoht või asukoht,

— kohaldatakse litsentsi suhtes Belgia õigust, kui litsentsiandja peakorter, elukoht või asukoht asub väljaspool Euroopa Liidu liikmesriike.

Liide
Euroopa Liidu tarkvara vaba kasutuse litsentsi artiklis 5 osutatud „ühilduvad litsentsid“ on järgmised:

— GNU General Public License (GPL) v. 2, v. 3

— GNU Affero General Public License (AGPL) v. 3

— Open Software License (OSL) v. 2.1, v. 3.0

— Eclipse Public License (EPL) v. 1.0

— CeCILL v. 2.0, v. 2.1

— Mozilla Public Licence (MPL) v. 2

— GNU Lesser General Public Licence (LGPL) v. 2.1, v. 3

— Creative Commons Attribution-ShareAlike v. 3.0 Unported (CC BY-SA 3.0) muude teoste puhul peale tarkvara

— European Union Public Licence (EUPL) v. 1.1, v. 1.2

— Québec Free and Open-Source Licence – Reciprocity (LiLiQ-R) or Strong Reciprocity (LiLiQ-R+)

Euroopa Komisjon võib käesolevat lisa ajakohastada loetletud litsentside hilisemate versioonidega ilma, et peaks selleks koostama EUPLi uue versiooni, eeldusel et nende litsentsidega tagatakse käesoleva litsentsi artiklis 2 sätestatud õigused ja kaitstakse hõlmatud lähtekoodi eksklusiivse omastamise eest.

Kõigi muude käesoleva liite muudatuste või täienduste jaoks on vaja koostada EUPLi uus versioon.
```

`LICENSE.MIT`

```
MIT License

Copyright (c) 2011-2019, 2024 Andris Reinman and Zone Media OÜ

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### chownr@3.0.0, yallist@5.0.0 — BlueOak-1.0.0

```
All packages under `src/` are licensed according to the terms in
their respective `LICENSE` or `LICENSE.md` files.

The remainder of this project is licensed under the Blue Oak
Model License, as follows:

-----

# Blue Oak Model License

Version 1.0.0

## Purpose

This license gives everyone as much permission to work with
this software as possible, while protecting contributors
from liability.

## Acceptance

In order to receive this license, you must agree to its
rules.  The rules of this license are both obligations
under that agreement and conditions to your license.
You must not do anything with this software that triggers
a rule that you cannot or will not follow.

## Copyright

Each contributor licenses you to do everything with this
software that would otherwise infringe that contributor's
copyright in it.

## Notices

You must ensure that everyone who gets a copy of
any part of this software from you, with or without
changes, also gets the text of this license or a link to
<https://blueoakcouncil.org/license/1.0.0>.

## Excuse

If anyone notifies you in writing that you have not
complied with [Notices](#notices), you can keep your
license by taking all practical steps to comply within 30
days after the notice.  If you do not do so, your license
ends immediately.

## Patent

Each contributor licenses you to do everything with this
software that would otherwise infringe any patent claims
they can license or become able to license.

## Reliability

No contributor can revoke this license.

## No Liability

***As far as the law allows, this software comes as is,
without any warranty or condition, and no contributor
will be liable to anyone for any damages related to this
software or this license, under any kind of legal claim.***
```

#### deepmerge-ts@8.0.2 — BSD-3-Clause

```
BSD 3-Clause License

Copyright (c) 2021, Rebecca Stevens
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

#### dijkstrajs@1.0.3 — MIT

```
'''
Dijkstra path-finding functions. Adapted from the Dijkstar Python project.

Copyright (C) 2008
  Wyatt Baldwin <self@wyattbaldwin.com>
  All rights reserved

Licensed under the MIT license.

  http://www.opensource.org/licenses/mit-license.php

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
'''
```

#### dom-serializer@2.0.0 — MIT

```
License

(The MIT License)

Copyright (c) 2014 The cheeriojs contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

#### domelementtype@2.3.0, domhandler@5.0.3, domutils@3.2.2, entities@4.5.0, entities@7.0.1 — BSD-2-Clause

```
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

#### global-agent@4.1.3 — BSD-3-Clause

```
Copyright (c) 2026, Gajus Kuizinas (https://gajus.com/)
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of the Gajus Kuizinas (https://gajus.com/) nor the
      names of its contributors may be used to endorse or promote products
      derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL ANUARY BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

#### minipass@7.1.3, tar@7.5.22 — BlueOak-1.0.0

```
# Blue Oak Model License

Version 1.0.0

## Purpose

This license gives everyone as much permission to work with
this software as possible, while protecting contributors
from liability.

## Acceptance

In order to receive this license, you must agree to its
rules.  The rules of this license are both obligations
under that agreement and conditions to your license.
You must not do anything with this software that triggers
a rule that you cannot or will not follow.

## Copyright

Each contributor licenses you to do everything with this
software that would otherwise infringe that contributor's
copyright in it.

## Notices

You must ensure that everyone who gets a copy of
any part of this software from you, with or without
changes, also gets the text of this license or a link to
<https://blueoakcouncil.org/license/1.0.0>.

## Excuse

If anyone notifies you in writing that you have not
complied with [Notices](#notices), you can keep your
license by taking all practical steps to comply within 30
days after the notice.  If you do not do so, your license
ends immediately.

## Patent

Each contributor licenses you to do everything with this
software that would otherwise infringe any patent claims
they can license or become able to license.

## Reliability

No contributor can revoke this license.

## No Liability

***As far as the law allows, this software comes as is,
without any warranty or condition, and no contributor
will be liable to anyone for any damages related to this
software or this license, under any kind of legal claim.***
```

#### nodemailer@10.0.10 — MIT-0

```
Copyright (c) 2011-2023 Andris Reinman

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### protobufjs@7.6.6 — BSD-3-Clause

```
This license applies to all parts of protobuf.js except those files
either explicitly including or referencing a different license or
located in a directory containing a different LICENSE file.

---

Copyright (c) 2016, Daniel Wirtz  All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

* Redistributions of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in the
  documentation and/or other materials provided with the distribution.
* Neither the name of its author, nor the names of its contributors
  may be used to endorse or promote products derived from this software
  without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

---

Code generated by the command line utilities is owned by the owner
of the input file used when generating it. This code is not
standalone and requires a support library to be linked with it. This
support library is itself covered by the above license.
```

#### type-fest@0.20.2 — (MIT OR CC0-1.0)

```
MIT License

Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https:/sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

#### webidl-conversions@3.0.1 — BSD-2-Clause

```
# The BSD 2-Clause License

Copyright (c) 2014, Domenic Denicola
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

#### zlibjs@0.3.1 — MIT

```
/**
 * @license
 * zlib.js
 * JavaScript Zlib Library
 * https://github.com/imaya/zlib.js
 *
 * The MIT License
 *
 * Copyright (c) 2012 imaya
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
```

### SIL Open Font License 1.1

Used by the fonts listed in [Fonts](#fonts). Copyright lines: Outfit: Copyright 2021 The Outfit Project Authors (https://github.com/Outfitio/Outfit-Fonts) — Space Grotesk: Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk) — JetBrains Mono: Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) — Fraunces: Copyright 2018 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces) — Spectral: Copyright 2017 The Spectral Project Authors (https://github.com/productiontype/Spectral)

```
This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## Software Vex downloads while running

These are **not** part of the Vex installer and are **not** distributed by Vex. Vex fetches them from their own publishers: a few automatically on first start (the filter lists, the spell-check dictionary and Widevine), the rest only when you turn on the feature that needs them. Each stays under its own licence.

| Component | Licence | When Vex downloads it | From |
|---|---|---|---|
| **Tor Expert Bundle** 15.0.20 (Tor and the libraries it ships with, such as OpenSSL, libevent and zlib) | Tor: BSD-3-Clause; the bundled libraries under their own licences, included in the bundle | The first time you open a Tor tab, unless Tor is already running on your PC. Checked against a pinned SHA-256. | archive.torproject.org |
| **ByeDPI** 0.17.3 | See its repository (https://github.com/hufrea/byedpi) | Only when you choose the Strong or Auto bypass mode for the Discord panel, or the Roblox bypass. Checked against a pinned SHA-256. | github.com/hufrea/byedpi releases |
| **Vencord** (Discord client mod) | GPL-3.0-or-later | Only when you click "Install / Update Vencord" in the Discord panel menu. Vex does not include, change or redistribute Vencord; it fetches the official build for you and loads it into the Discord panel. | github.com/Vendicated/Vencord releases |
| **Extensions from the built-in catalogue** (for example Dark Reader, Stylus, Violentmonkey, Return YouTube Dislike, uBlock Origin, and extensions by 0xmortuex) | Each extension's own licence (for example uBlock Origin, Stylus and Return YouTube Dislike are GPL-3.0; Dark Reader and Violentmonkey are MIT) | Only when you click Install. | Each project's GitHub releases |
| **Ad and tracker filter lists** (EasyList, EasyPrivacy, Peter Lowe's list, uBlock Origin lists) and the Ghostery `resources.json` | Each list's own licence (for example EasyList is GPL-3.0 / CC BY-SA 3.0) | On first start, then kept in your profile. | raw.githubusercontent.com/ghostery/adblocker |
| **Widevine CDM** | Proprietary, Google | On start, through Chromium's component updater, when it is missing or out of date. | Google |
| **Spell-check dictionary** (en-US `.bdic`) | Hunspell/SCOWL dictionary licences (BSD/MIT-style) | Once, on first start. | redirector.gvt1.com (Google) |
| **Whisper speech models** (`onnx-community/whisper-base`, `whisper-small`) | As stated on each model card (Whisper weights: MIT) | Only when you turn on dictation and agree to the download. | huggingface.co |
| **On-device AI models** (WebLLM) | Each model's own licence, shown on its model card | Only when you click Download in the AI settings. | huggingface.co/mlc-ai and raw.githubusercontent.com/mlc-ai |
| **Tesseract OCR English data** | Apache-2.0 | The first time you read text from an image or scanned PDF. | cdn.jsdelivr.net (@tesseract.js-data) |

Vex also starts **Ollama** on your PC if you have installed it yourself; Ollama is not shipped or downloaded by Vex.

