package com.vex.browser.tabs;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.CookieManager;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Saves an HLS stream — the .m3u8 most video sites that are not YouTube play —
 * as one file in Downloads.
 *
 * Android's DownloadManager fetches one URL; a stream is a playlist of a few
 * hundred short segments. This reads the playlist the page itself was playing,
 * picks the best rendition that carries its own sound, fetches each segment
 * with the page's cookies and user agent, and writes them end to end: MPEG-TS
 * segments make a .ts, fragmented-MP4 segments (with their init section first)
 * make an .mp4. Both play in any player on the phone.
 *
 * What it will not do is said rather than attempted: a live stream has no end
 * to save, SAMPLE-AES and DRM are encryption by design, and a rendition whose
 * sound is a separate playlist would be a silent film. AES-128 — a key the
 * page itself fetches over HTTPS — is ordinary transport encryption, and is
 * decrypted segment by segment as the page would.
 *
 * Writes go straight to the file as they arrive, so a two-gigabyte film never
 * sits in memory. Each job runs on its own thread; cancel() stops it between
 * segments and removes the half-written file.
 */
public final class StreamDownloader {

    /** What the chrome hears about a job. */
    public interface Listener {
        void progress(String jobId, int done, int total, long bytes);
        void finished(String jobId, String localUri, long bytes, String mimeType);
        void failed(String jobId, String message);
    }

    private static final Map<String, Boolean> cancelled = new ConcurrentHashMap<>();
    private static final Pattern ATTRIBUTE = Pattern.compile("([A-Z0-9-]+)=(\"[^\"]*\"|[^,]*)");
    private static int sequence = 0;

    private StreamDownloader() {}

    public static synchronized String nextId() {
        sequence++;
        return "stream-" + System.currentTimeMillis() + "-" + sequence;
    }

    public static void cancel(String jobId) {
        if (jobId != null) cancelled.put(jobId, Boolean.TRUE);
    }

    public static void start(final Context context, final String jobId, final String playlistUrl,
                             final String userAgent, final String filename, final Listener listener) {
        Thread worker = new Thread(() -> {
            try {
                run(context.getApplicationContext(), jobId, playlistUrl, userAgent, filename, listener);
            } catch (Exception error) {
                String message = error.getMessage();
                listener.failed(jobId, message == null || message.isEmpty() ? "The video could not be saved" : message);
            } finally {
                cancelled.remove(jobId);
            }
        }, "vex-stream-" + jobId);
        worker.setPriority(Thread.NORM_PRIORITY - 1);
        worker.start();
    }

    // ── The job ──────────────────────────────────────────────────────────────

    static final class Segment {
        String url;
        long length = -1;        // a byte range, when the playlist gives one
        long offset = 0;
        String keyUrl;           // AES-128 key for this segment, or null
        byte[] iv;               // explicit IV, or null for the sequence number
        long sequenceNumber;
    }

    static final class MediaPlaylist {
        final List<Segment> segments = new ArrayList<>();
        String initUrl;          // EXT-X-MAP, for fragmented MP4
        long initLength = -1;
        long initOffset = 0;
    }

    private static void run(Context context, String jobId, String playlistUrl, String userAgent,
                            String filename, Listener listener) throws Exception {
        String text = fetchText(playlistUrl, userAgent);
        String mediaUrl = playlistUrl;
        if (text.contains("#EXT-X-STREAM-INF")) {
            mediaUrl = pickVariant(text, playlistUrl);
            text = fetchText(mediaUrl, userAgent);
        }
        if (!text.startsWith("#EXTM3U")) throw new IOException("That is not a video playlist");
        if (!text.contains("#EXT-X-ENDLIST")) throw new IOException("That is a live stream — there is no end to save");
        MediaPlaylist playlist = parseMedia(text, mediaUrl);
        if (playlist.segments.isEmpty()) throw new IOException("The playlist has no video in it");

        boolean fragmented = playlist.initUrl != null;
        String mimeType = fragmented ? "video/mp4" : "video/mp2t";
        String name = cleanName(filename) + (fragmented ? ".mp4" : ".ts");

        Output output = Output.open(context, name, mimeType);
        long written = 0;
        boolean complete = false;
        try {
            byte[] lastKey = null;
            String lastKeyUrl = null;
            if (fragmented) {
                byte[] init = fetchBytes(playlist.initUrl, userAgent, playlist.initOffset, playlist.initLength);
                output.stream.write(init);
                written += init.length;
            }
            int total = playlist.segments.size();
            for (int index = 0; index < total; index++) {
                if (cancelled.containsKey(jobId)) throw new IOException("cancelled");
                Segment segment = playlist.segments.get(index);
                byte[] bytes = fetchBytes(segment.url, userAgent, segment.offset, segment.length);
                if (segment.keyUrl != null) {
                    if (!segment.keyUrl.equals(lastKeyUrl)) {
                        lastKey = fetchBytes(segment.keyUrl, userAgent, 0, -1);
                        lastKeyUrl = segment.keyUrl;
                    }
                    bytes = decrypt(bytes, lastKey, segment.iv != null ? segment.iv : sequenceIv(segment.sequenceNumber));
                }
                output.stream.write(bytes);
                written += bytes.length;
                listener.progress(jobId, index + 1, total, written);
            }
            output.stream.flush();
            complete = true;
        } finally {
            output.close(context, complete);
        }
        listener.finished(jobId, output.uri.toString(), written, mimeType);
    }

    /**
     * The best rendition that carries its own sound. A variant whose AUDIO group
     * points at a separate playlist has no sound in its segments; saving it would
     * save a silent film, so those are passed over while any other exists.
     */
    static String pickVariant(String master, String base) throws IOException {
        List<String[]> audioGroupsWithUri = new ArrayList<>();
        String[] lines = master.split("\r?\n");
        for (String line : lines) {
            if (line.startsWith("#EXT-X-MEDIA:")) {
                Map<String, String> attributes = attributes(line.substring(line.indexOf(':') + 1));
                if ("AUDIO".equals(attributes.get("TYPE")) && attributes.containsKey("URI")) {
                    audioGroupsWithUri.add(new String[] { attributes.get("GROUP-ID") });
                }
            }
        }
        String best = null, bestMuxed = null;
        long bestRate = -1, bestMuxedRate = -1;
        for (int index = 0; index < lines.length; index++) {
            String line = lines[index].trim();
            if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
            Map<String, String> attributes = attributes(line.substring(line.indexOf(':') + 1));
            String uri = null;
            for (int next = index + 1; next < lines.length; next++) {
                String candidate = lines[next].trim();
                if (candidate.isEmpty() || candidate.startsWith("#")) continue;
                uri = candidate;
                break;
            }
            if (uri == null) continue;
            long rate = parseLong(attributes.get("BANDWIDTH"), 0);
            String audio = attributes.get("AUDIO");
            boolean separateSound = false;
            for (String[] group : audioGroupsWithUri) if (group[0] != null && group[0].equals(audio)) separateSound = true;
            if (rate > bestRate) { bestRate = rate; best = uri; }
            if (!separateSound && rate > bestMuxedRate) { bestMuxedRate = rate; bestMuxed = uri; }
        }
        if (bestMuxed != null) return resolve(base, bestMuxed);
        if (best != null) throw new IOException("This site sends the sound separately from the picture, which Vex cannot join yet");
        throw new IOException("The playlist lists no video");
    }

    static MediaPlaylist parseMedia(String text, String base) throws IOException {
        MediaPlaylist playlist = new MediaPlaylist();
        String keyUrl = null;
        byte[] iv = null;
        long sequenceNumber = 0;
        long pendingLength = -1, pendingOffset = -1, nextOffset = 0;
        for (String raw : text.split("\r?\n")) {
            String line = raw.trim();
            if (line.isEmpty()) continue;
            if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
                sequenceNumber = parseLong(line.substring(line.indexOf(':') + 1), 0);
            } else if (line.startsWith("#EXT-X-KEY:")) {
                Map<String, String> attributes = attributes(line.substring(line.indexOf(':') + 1));
                String method = attributes.get("METHOD");
                if (method == null || "NONE".equals(method)) {
                    keyUrl = null;
                    iv = null;
                } else if ("AES-128".equals(method)) {
                    String uri = attributes.get("URI");
                    if (uri == null) throw new IOException("The video's key is missing");
                    if (uri.startsWith("skd:") || uri.startsWith("data:")) throw new IOException("This video is protected (DRM) and cannot be saved");
                    keyUrl = resolve(base, uri);
                    iv = attributes.containsKey("IV") ? hex(attributes.get("IV")) : null;
                } else {
                    throw new IOException("This video is protected (" + method + ") and cannot be saved");
                }
            } else if (line.startsWith("#EXT-X-MAP:")) {
                Map<String, String> attributes = attributes(line.substring(line.indexOf(':') + 1));
                String uri = attributes.get("URI");
                if (uri != null) {
                    playlist.initUrl = resolve(base, uri);
                    String range = attributes.get("BYTERANGE");
                    if (range != null) {
                        long[] parsed = byteRange(range, 0);
                        playlist.initLength = parsed[0];
                        playlist.initOffset = parsed[1];
                    }
                }
            } else if (line.startsWith("#EXT-X-BYTERANGE:")) {
                long[] parsed = byteRange(line.substring(line.indexOf(':') + 1), nextOffset);
                pendingLength = parsed[0];
                pendingOffset = parsed[1];
            } else if (!line.startsWith("#")) {
                Segment segment = new Segment();
                segment.url = resolve(base, line);
                segment.keyUrl = keyUrl;
                segment.iv = iv;
                segment.sequenceNumber = sequenceNumber++;
                if (pendingLength >= 0) {
                    segment.length = pendingLength;
                    segment.offset = pendingOffset;
                    nextOffset = pendingOffset + pendingLength;
                    pendingLength = -1;
                }
                playlist.segments.add(segment);
            }
        }
        return playlist;
    }

    // ── Pieces ───────────────────────────────────────────────────────────────

    static Map<String, String> attributes(String list) {
        Map<String, String> out = new java.util.HashMap<>();
        Matcher matcher = ATTRIBUTE.matcher(list);
        while (matcher.find()) {
            String value = matcher.group(2);
            if (value.startsWith("\"") && value.endsWith("\"") && value.length() >= 2) value = value.substring(1, value.length() - 1);
            out.put(matcher.group(1), value);
        }
        return out;
    }

    static String resolve(String base, String reference) throws IOException {
        try {
            return new URL(new URL(base), reference).toString();
        } catch (Exception error) {
            throw new IOException("A link in the playlist is broken");
        }
    }

    private static long[] byteRange(String value, long defaultOffset) {
        String[] parts = value.trim().split("@");
        long length = parseLong(parts[0], -1);
        long offset = parts.length > 1 ? parseLong(parts[1], defaultOffset) : defaultOffset;
        return new long[] { length, offset };
    }

    private static long parseLong(String value, long fallback) {
        if (value == null) return fallback;
        try { return Long.parseLong(value.trim()); } catch (NumberFormatException error) { return fallback; }
    }

    private static byte[] hex(String value) {
        String clean = value.startsWith("0x") || value.startsWith("0X") ? value.substring(2) : value;
        if (clean.length() % 2 == 1) clean = "0" + clean;
        byte[] out = new byte[16];
        byte[] parsed = new byte[clean.length() / 2];
        for (int at = 0; at < parsed.length; at++) {
            parsed[at] = (byte) Integer.parseInt(clean.substring(at * 2, at * 2 + 2), 16);
        }
        System.arraycopy(parsed, Math.max(0, parsed.length - 16), out, Math.max(0, 16 - parsed.length), Math.min(16, parsed.length));
        return out;
    }

    private static byte[] sequenceIv(long sequenceNumber) {
        byte[] iv = new byte[16];
        for (int at = 15; at >= 8; at--) {
            iv[at] = (byte) (sequenceNumber & 0xff);
            sequenceNumber >>= 8;
        }
        return iv;
    }

    private static byte[] decrypt(byte[] bytes, byte[] key, byte[] iv) throws Exception {
        if (key == null || key.length != 16) throw new IOException("The video's key could not be read");
        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        return cipher.doFinal(bytes);
    }

    static String cleanName(String filename) {
        String name = filename == null ? "" : filename.trim();
        name = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", " ").replaceAll("\\s+", " ").trim();
        if (name.length() > 80) name = name.substring(0, 80).trim();
        return name.isEmpty() ? "video" : name;
    }

    private static HttpURLConnection connect(String url, String userAgent, long offset, long length) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(30000);
        connection.setInstanceFollowRedirects(true);
        if (userAgent != null && !userAgent.isEmpty()) connection.setRequestProperty("User-Agent", userAgent);
        String cookie = CookieManager.getInstance().getCookie(url);
        if (cookie != null) connection.setRequestProperty("Cookie", cookie);
        if (length >= 0) connection.setRequestProperty("Range", "bytes=" + offset + "-" + (offset + length - 1));
        int status = connection.getResponseCode();
        if (status >= 400) {
            connection.disconnect();
            throw new IOException(status == 403 || status == 401
                    ? "The site refused the video to anything but its own player"
                    : "The site answered " + status + " for part of the video");
        }
        return connection;
    }

    private static byte[] fetchBytes(String url, String userAgent, long offset, long length) throws IOException {
        IOException last = null;
        // One retry: a dropped segment on a mobile network should not end a
        // twenty-minute download.
        for (int attempt = 0; attempt < 2; attempt++) {
            HttpURLConnection connection = null;
            try {
                connection = connect(url, userAgent, offset, length);
                try (InputStream in = connection.getInputStream()) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream(length > 0 ? (int) Math.min(length, 8 << 20) : 1 << 20);
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                    return out.toByteArray();
                }
            } catch (IOException error) {
                last = error;
                if (error.getMessage() != null && error.getMessage().startsWith("The site")) throw error;
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
        throw last != null ? last : new IOException("Part of the video did not arrive");
    }

    private static String fetchText(String url, String userAgent) throws IOException {
        return new String(fetchBytes(url, userAgent, 0, -1), java.nio.charset.StandardCharsets.UTF_8)
                .replace("\uFEFF", "").trim();
    }

    // ── Where it goes ────────────────────────────────────────────────────────

    /** A file in Downloads, open for writing as the segments arrive. */
    private static final class Output {
        Uri uri;
        OutputStream stream;
        File file;               // before Android 10

        static Output open(Context context, String name, String mimeType) throws IOException {
            Output output = new Output();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                // Hidden from other apps until it is whole.
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                output.uri = context.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (output.uri == null) throw new IOException("Downloads is not writable");
                output.stream = context.getContentResolver().openOutputStream(output.uri);
                if (output.stream == null) throw new IOException("Downloads is not writable");
            } else {
                File folder = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (folder != null && !folder.exists()) folder.mkdirs();
                output.file = new File(folder, name);
                output.stream = new FileOutputStream(output.file);
                output.uri = Uri.fromFile(output.file);
            }
            output.stream = new java.io.BufferedOutputStream(output.stream, 256 * 1024);
            return output;
        }

        void close(Context context, boolean complete) {
            try { stream.close(); } catch (IOException ignored) { /* closing is all that is left */ }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                if (complete) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    context.getContentResolver().update(uri, values, null, null);
                } else {
                    context.getContentResolver().delete(uri, null, null);
                }
            } else if (!complete && file != null) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        }
    }

}
