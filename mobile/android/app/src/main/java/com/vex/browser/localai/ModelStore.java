package com.vex.browser.localai;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Where on-device models live, and how they get there.
 *
 * A .litertlm model is between half a gigabyte and four, which on a phone means
 * the download WILL be interrupted — the screen locks, the train goes into a
 * tunnel, Android kills the process. So it writes to <name>.part and resumes
 * with a Range request from whatever is already on disk, and only renames to the
 * final name once the length matches what the server promised. A truncated file
 * that looks finished is the one outcome worth engineering against: the engine
 * fails to load it with a native error nobody can read.
 */
public class ModelStore {

    public interface Progress {
        void onProgress(long received, long total);
        void onDone(File file);
        void onError(String message);
    }

    private final Context context;
    private volatile boolean cancelled;

    public ModelStore(Context context) {
        this.context = context;
    }

    public File directory() {
        File dir = new File(context.getFilesDir(), "models");
        if (!dir.exists() && !dir.mkdirs()) return context.getFilesDir();
        return dir;
    }

    public File fileFor(String name) {
        // The name comes from the chrome's catalogue, but it ends up as a path:
        // anything that could climb out of the models directory is stripped.
        String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (safe.isEmpty()) safe = "model.litertlm";
        return new File(directory(), safe);
    }

    public List<String[]> list() {
        List<String[]> out = new ArrayList<>();
        File[] files = directory().listFiles();
        if (files == null) return out;
        for (File file : files) {
            if (file.isDirectory() || file.getName().endsWith(".part")) continue;
            out.add(new String[] { file.getName(), String.valueOf(file.length()) });
        }
        return out;
    }

    public boolean delete(String name) {
        File file = fileFor(name);
        File part = new File(file.getAbsolutePath() + ".part");
        boolean gone = !file.exists() || file.delete();
        if (part.exists()) gone &= part.delete();
        return gone;
    }

    public void cancel() {
        cancelled = true;
    }

    /** How much of this model is already on disk, finished or not. */
    public long bytesOnDisk(String name) {
        File file = fileFor(name);
        if (file.exists()) return file.length();
        File part = new File(file.getAbsolutePath() + ".part");
        return part.exists() ? part.length() : 0;
    }

    public boolean isComplete(String name) {
        return fileFor(name).exists();
    }

    /**
     * Fetch a model, resuming if there is a part file. Blocking: the plugin runs
     * it on its own thread and reports back through {@link Progress}.
     */
    public void download(String name, String url, Map<String, String> headers, Progress progress) {
        cancelled = false;
        File target = fileFor(name);
        if (target.exists()) { progress.onDone(target); return; }
        File part = new File(target.getAbsolutePath() + ".part");

        HttpURLConnection connection = null;
        try {
            long already = part.exists() ? part.length() : 0;
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(30000);
            connection.setReadTimeout(60000);
            connection.setInstanceFollowRedirects(true);
            if (headers != null) {
                for (Map.Entry<String, String> entry : headers.entrySet()) {
                    connection.setRequestProperty(entry.getKey(), entry.getValue());
                }
            }
            if (already > 0) connection.setRequestProperty("Range", "bytes=" + already + "-");

            int status = connection.getResponseCode();
            // 206 means the server honoured the range; 200 means it ignored it
            // and is sending the whole file, so what is on disk is useless.
            boolean resuming = status == 206;
            if (status != 200 && status != 206) {
                progress.onError("The server answered " + status
                        + (status == 401 || status == 403
                        ? " — this model is behind a licence, so it needs an access token" : ""));
                return;
            }
            if (!resuming) already = 0;

            long length = connection.getContentLengthLong();
            long total = length < 0 ? -1 : already + length;

            InputStream in = connection.getInputStream();
            FileOutputStream out = new FileOutputStream(part, resuming);
            byte[] buffer = new byte[1 << 16];
            long received = already;
            long lastReport = 0;
            try {
                int read;
                while ((read = in.read(buffer)) != -1) {
                    if (cancelled) { progress.onError("cancelled"); return; }
                    out.write(buffer, 0, read);
                    received += read;
                    // Reporting every chunk would wake the chrome a thousand
                    // times a second for nothing.
                    if (received - lastReport > (1 << 20)) {
                        lastReport = received;
                        progress.onProgress(received, total);
                    }
                }
                out.flush();
                out.getFD().sync();
            } finally {
                try { out.close(); } catch (IOException ignored) { }
                try { in.close(); } catch (IOException ignored) { }
            }

            if (total > 0 && received != total) {
                progress.onError(String.format(Locale.US,
                        "The download stopped early (%d of %d bytes) — it will resume where it left off",
                        received, total));
                return;
            }
            if (!part.renameTo(target)) {
                progress.onError("The model downloaded but could not be moved into place");
                return;
            }
            progress.onProgress(received, received);
            progress.onDone(target);
        } catch (Exception error) {
            progress.onError(error.getMessage() == null ? error.toString() : error.getMessage());
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
