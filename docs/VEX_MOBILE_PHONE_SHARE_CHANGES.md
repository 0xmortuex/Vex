# vex-mobile: the change list for share-sheet capture (T3-036)

Status: **BLOCKED-EXTERNAL.** The desktop side is built and tested in this repository; the phone app
lives in a separate repository (vex-mobile) and has not been touched. This file is the exact list of
what that app has to do. The wire format is in [PHONE_SHARE.md](PHONE_SHARE.md) and
[SYNC_PROTOCOL.md](SYNC_PROTOCOL.md) section 7. There is no server change and no new key.

## 1. Receive shares (Android)

`AndroidManifest.xml`, on the activity that should receive a share:

```xml
<intent-filter>
  <action android:name="android.intent.action.SEND" />
  <category android:name="android.intent.category.DEFAULT" />
  <data android:mimeType="text/plain" />
</intent-filter>
<intent-filter>
  <action android:name="android.intent.action.SEND" />
  <category android:name="android.intent.category.DEFAULT" />
  <data android:mimeType="image/*" />
</intent-filter>
```

Read `EXTRA_TEXT`, `EXTRA_SUBJECT` and, for images, `EXTRA_STREAM` (a content URI; read it through
`ContentResolver`, never as a file path). iOS: a Share Extension with the same three inputs.

## 2. Choose the payload

| Share | Payload (before encryption) |
|---|---|
| `EXTRA_TEXT` contains an `http(s)` address | `{ "url": "<first address, 2048 max>", "title": "<EXTRA_SUBJECT, 300 max>", "note": "<rest of the text, 1000 max>" }` |
| text with no address | `{ "kind": "text", "text": "<4000 max>", "title": "<EXTRA_SUBJECT, 300 max, optional>" }` |
| an image | `{ "kind": "image", "image": { "mime": "<image/png \| image/jpeg \| image/gif \| image/webp>", "data": "<base64, 9000 characters max>" }, "title": "<optional>" }` |

Do not send `to` unless the share is meant for one desktop. Never put a `url` in a text or image payload (a
payload with a `url` is treated as a link).

## 3. Fit the picture (the only hard part)

The whole encrypted item must stay within the server's 16 384-character limit. The base64 of the picture is
capped at 9000 characters (about 6.5 KB of picture). In the app:

1. Decode the shared image with sampling (`inSampleSize`), never fully into memory.
2. Scale so the longest side is at most 160 px, encode as JPEG at quality 60 (PNG only for pictures with
   transparency and only if it fits).
3. If the base64 is over 9000 characters, lower the quality in steps of 10 down to 20, then the size by 25%,
   and try again. After six tries, stop.
4. Tell the person plainly: "Sent a small copy" on success, "This picture is too large to send" on failure.
   Never silently send a link or a different picture instead.

A full-size photo cannot travel this way; that needs the attachment endpoint described at the end of
[PHONE_SHARE.md](PHONE_SHARE.md).

## 4. Send

Encrypt with the account key (SYNC_PROTOCOL.md 3.2) and `POST /sync/drop {"encryptedBlob": "..."}` with the
phone's Bearer token. Show the result: "Sent to Vex" on 200, the server's message on 400/401/403/429. Name the
device so it looks like a phone ("Pixel 8", "my phone"): the desktop lists shares only from such a device.

## 5. Tests the app should have

* An address inside a sentence becomes the link payload with the rest as `note`.
* Text with no address becomes `kind: "text"` and has no `url`.
* A 4001-character text is cut to 4000.
* A 3 MB picture ends up as a payload whose base64 is at most 9000 characters, or is refused with the message
  above.
* No payload carries both `url` and `kind`.
* A cancelled share sends nothing.

The desktop's own test against a fake relay (`tests/renderer/phoneShareMedia.test.js`) is a good fixture
for the payload shapes.
