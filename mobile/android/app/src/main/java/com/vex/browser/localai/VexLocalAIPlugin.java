package com.vex.browser.localai;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.vex.browser.MainActivity;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The AI that never leaves the phone.
 *
 * Two backends, because they answer different questions:
 *
 *   • LiteRT-LM with a model you download — open-ended, works offline, works on
 *     any 64-bit phone, costs a gigabyte of storage and some seconds per reply.
 *   • Gemini Nano through ML Kit — instant, nothing to store, but only the three
 *     jobs the system exposes, and only on a phone with AICore.
 *
 * The chrome decides which to use; this only reports honestly what is possible.
 * Generation streams back as events rather than one resolved call, because a
 * reply takes tens of seconds and a person should watch it arrive.
 */
@CapacitorPlugin(name = "VexLocalAI")
public class VexLocalAIPlugin extends Plugin {

    private LiteRtRunner litert;
    private NanoRunner nano;
    private ModelStore store;
    private final AudioClips audio = new AudioClips();
    private Segmenter segmenter;

    private LiteRtRunner litert() {
        if (litert == null) {
            litert = new LiteRtRunner(getContext());
            litert.setToolHandler(this::askChromeToRun);
        }
        return litert;
    }

    private Segmenter segmenter() {
        if (segmenter == null) segmenter = new Segmenter(getContext());
        return segmenter;
    }

    // ── Tools the model calls, run by the chrome ─────────────────────────────
    //
    // LiteRT-LM calls a tool from inside the reply, on its own thread, and
    // waits for the answer before it carries on. The chrome is the one that
    // knows how to run them (a garden to plant in, a Wikipedia to ask), so the
    // call goes out as an event and this thread waits for toolResult — never
    // for ever: a chrome that went away mid-reply must not hang the engine.

    private final AtomicInteger nextCall = new AtomicInteger(1);
    private final Map<String, String[]> toolAnswers = new ConcurrentHashMap<>();
    private final Map<String, CountDownLatch> toolWaits = new ConcurrentHashMap<>();

    private String askChromeToRun(String name, String argumentsJson) {
        String callId = "tool-" + nextCall.getAndIncrement();
        CountDownLatch done = new CountDownLatch(1);
        toolWaits.put(callId, done);
        JSObject data = new JSObject();
        data.put("callId", callId);
        data.put("name", name);
        data.put("args", argumentsJson);
        notifyListeners("toolCall", data);
        try {
            if (!done.await(90, TimeUnit.SECONDS)) return "{\"error\":\"The tool took too long\"}";
            String[] answer = toolAnswers.remove(callId);
            return answer == null ? "{}" : answer[0];
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return "{\"error\":\"Interrupted\"}";
        } finally {
            toolWaits.remove(callId);
        }
    }

    @PluginMethod
    public void toolResult(PluginCall call) {
        String callId = call.getString("callId", "");
        CountDownLatch waiting = toolWaits.get(callId);
        if (waiting != null) {
            toolAnswers.put(callId, new String[] { call.getString("result", "{}") });
            waiting.countDown();
        }
        call.resolve();
    }

    private NanoRunner nano() {
        if (nano == null) nano = new NanoRunner(getContext());
        return nano;
    }

    private ModelStore store() {
        if (store == null) store = new ModelStore(getContext());
        return store;
    }

    // ── What this phone can do ───────────────────────────────────────────────

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", LiteRtRunner.supported());
        result.put("loaded", litert().isLoaded());
        result.put("busy", litert().isBusy());
        result.put("model", litert().loadedModel());
        result.put("backend", litert().loadedBackend());
        result.put("vision", litert().hasVision());
        result.put("audio", litert().hasAudio());
        result.put("recording", audio.isRecording());
        result.put("clipMillis", audio.lastMillis());

        JSObject models = new JSObject();
        for (String[] entry : store().list()) models.put(entry[0], entry[1]);
        result.put("models", models);
        result.put("directory", store().directory().getAbsolutePath());
        call.resolve(result);
    }

    @PluginMethod
    public void nanoStatus(PluginCall call) {
        nano().status(status -> {
            JSObject result = new JSObject();
            result.put("status", status);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void nanoDownload(PluginCall call) {
        nano().download(new NanoRunner.Download() {
            @Override public void onProgress(long received, long total) {
                JSObject data = new JSObject();
                data.put("received", received);
                data.put("total", total);
                notifyListeners("nanoProgress", data);
            }
            @Override public void onDone() {
                JSObject result = new JSObject();
                result.put("ok", true);
                call.resolve(result);
            }
            @Override public void onError(String message) { call.reject(message); }
        });
    }

    // ── The downloadable model ───────────────────────────────────────────────

    @PluginMethod
    public void download(PluginCall call) {
        final String name = call.getString("name", "");
        final String url = call.getString("url", "");
        if (name.isEmpty() || url.isEmpty()) {
            call.reject("A download needs a name and a url");
            return;
        }
        final Map<String, String> headers = new HashMap<>();
        JSObject given = call.getObject("headers", new JSObject());
        if (given != null) {
            for (java.util.Iterator<String> keys = given.keys(); keys.hasNext(); ) {
                String key = keys.next();
                headers.put(key, given.getString(key, ""));
            }
        }
        // Resolve at once: the download outlives the call, and its progress and
        // outcome arrive as events the settings panel is already listening to.
        JSObject started = new JSObject();
        started.put("started", true);
        started.put("resumingFrom", store().bytesOnDisk(name));
        call.resolve(started);

        final android.content.Context context = getContext();
        final String jobId = "model-" + name;
        com.vex.browser.work.LongWork.begin(context, jobId, "Downloading " + name);
        Executors.newSingleThreadExecutor().execute(() -> store().download(name, url, headers,
                new ModelStore.Progress() {
                    @Override public void onProgress(long received, long total) {
                        com.vex.browser.work.LongWork.progress(context, jobId,
                                total > 0 ? (int) (100L * received / total) : -1,
                                (received >> 20) + (total > 0 ? " of " + (total >> 20) : "") + " MB");
                        JSObject data = new JSObject();
                        data.put("name", name);
                        data.put("received", received);
                        data.put("total", total);
                        notifyListeners("modelProgress", data);
                    }
                    @Override public void onDone(File file) {
                        com.vex.browser.work.LongWork.end(context, jobId, "The on-device model is ready");
                        JSObject data = new JSObject();
                        data.put("name", name);
                        data.put("bytes", file.length());
                        notifyListeners("modelReady", data);
                    }
                    @Override public void onError(String message) {
                        com.vex.browser.work.LongWork.end(context, jobId, null);
                        JSObject data = new JSObject();
                        data.put("name", name);
                        data.put("message", message);
                        notifyListeners("modelFailed", data);
                    }
                }));
    }

    /**
     * Pick a .litertlm the phone already has and copy it in.
     *
     * The picker is native and so is the copy: a model is between half a
     * gigabyte and three, and nothing that size can travel through the bridge.
     * It reuses MainActivity's file chooser, the one a page's file input uses.
     */
    @PluginMethod
    public void pickModel(PluginCall call) {
        final String name = call.getString("name", "");
        if (name.isEmpty()) { call.reject("Which model is this?"); return; }
        if (!(getActivity() instanceof MainActivity)) { call.reject("No activity to ask"); return; }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        ((MainActivity) getActivity()).openFileChooser(intent, uris -> {
            if (uris == null || uris.length == 0 || uris[0] == null) {
                JSObject empty = new JSObject();
                empty.put("picked", false);
                call.resolve(empty);
                return;
            }
            JSObject picked = new JSObject();
            picked.put("picked", true);
            call.resolve(picked);
            importInto(uris[0], name);
        });
    }

    private void importInto(final android.net.Uri uri, final String name) {
        Executors.newSingleThreadExecutor().execute(() -> store().importFrom(
                uri, name, new ModelStore.Progress() {
                    @Override public void onProgress(long received, long total) {
                        JSObject data = new JSObject();
                        data.put("name", name);
                        data.put("received", received);
                        data.put("total", total);
                        notifyListeners("modelProgress", data);
                    }
                    @Override public void onDone(File file) {
                        JSObject data = new JSObject();
                        data.put("name", name);
                        data.put("bytes", file.length());
                        notifyListeners("modelReady", data);
                    }
                    @Override public void onError(String message) {
                        JSObject data = new JSObject();
                        data.put("name", name);
                        data.put("message", message);
                        notifyListeners("modelFailed", data);
                    }
                }));
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        store().cancel();
        call.resolve();
    }

    @PluginMethod
    public void deleteModel(PluginCall call) {
        String name = call.getString("name", "");
        if (name.isEmpty()) { call.reject("Which model?"); return; }
        if (name.equals(litert().loadedModel())) litert().unload();
        JSObject result = new JSObject();
        result.put("deleted", store().delete(name));
        call.resolve(result);
    }

    private static LiteRtRunner.ChatSpec chatSpec(PluginCall call) {
        LiteRtRunner.ChatSpec chat = new LiteRtRunner.ChatSpec();
        chat.system = call.getString("system", "");
        chat.topK = call.getInt("topK", 0);
        Double topP = call.getDouble("topP");
        Double temperature = call.getDouble("temperature");
        chat.topP = topP == null ? 0.95 : topP;
        chat.temperature = temperature == null ? 1.0 : temperature;
        chat.toolsJson = call.getString("tools", "");
        return chat;
    }

    private LiteRtRunner.Ready resolvingReady(final PluginCall call) {
        return new LiteRtRunner.Ready() {
            @Override public void onReady(String loaded, String backend) {
                JSObject result = new JSObject();
                result.put("loaded", true);
                result.put("model", loaded);
                result.put("backend", backend);
                result.put("vision", litert().hasVision());
                result.put("audio", litert().hasAudio());
                call.resolve(result);
                notifyListeners("modelLoaded", result);
            }
            @Override public void onError(String message) { call.reject(message); }
        };
    }

    /**
     * Load a model and start a conversation on it. The engine is kept when it
     * was built the same way — model, backend, image and audio readers — so a
     * feature asking for different sampling or tools costs a new conversation,
     * not a reload.
     */
    @PluginMethod
    public void load(PluginCall call) {
        String name = call.getString("name", "");
        File model = store().fileFor(name);
        if (!model.exists()) { call.reject("That model is not on this device"); return; }
        LiteRtRunner.EngineSpec engine = new LiteRtRunner.EngineSpec();
        engine.backend = call.getString("backend", "cpu");
        engine.vision = Boolean.TRUE.equals(call.getBoolean("vision", false));
        engine.audio = Boolean.TRUE.equals(call.getBoolean("audio", false));
        engine.maxTokens = call.getInt("maxTokens", 0);
        litert().load(model, engine, chatSpec(call), resolvingReady(call));
    }

    /** Forget the conversation so far; optionally with new prompt, sampling and tools. */
    @PluginMethod
    public void reset(PluginCall call) {
        litert().reset(chatSpec(call), resolvingReady(call));
    }

    @PluginMethod
    public void unload(PluginCall call) {
        litert().unload();
        call.resolve();
    }

    @PluginMethod
    public void generate(PluginCall call) {
        final String id = call.getString("id", "");
        String prompt = call.getString("prompt", "");
        List<byte[]> images = new ArrayList<>();
        try {
            JSONArray given = call.getArray("images", new com.getcapacitor.JSArray());
            for (int i = 0; i < given.length(); i++) {
                images.add(android.util.Base64.decode(given.getString(i), android.util.Base64.DEFAULT));
            }
        } catch (Exception error) { call.reject("A picture could not be read"); return; }
        List<byte[]> clips = new ArrayList<>();
        if (Boolean.TRUE.equals(call.getBoolean("withClip", false))) {
            byte[] clip = audio.last();
            if (clip == null) { call.reject("There is no recording to send"); return; }
            clips.add(clip);
        }
        if (prompt.isEmpty() && images.isEmpty() && clips.isEmpty()) { call.reject("Nothing to answer"); return; }
        litert().generate(prompt, images, clips, new LiteRtRunner.Tokens() {
            @Override public void onToken(String text) {
                JSObject data = new JSObject();
                data.put("id", id);
                data.put("text", text);
                notifyListeners("token", data);
            }
            @Override public void onDone(String whole) {
                JSObject result = new JSObject();
                result.put("id", id);
                result.put("text", whole);
                call.resolve(result);
                notifyListeners("generated", result);
            }
            @Override public void onError(String message) { call.reject(message); }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        litert().stop();
        call.resolve();
    }

    // ── Pictures for a model that can see ────────────────────────────────────

    /**
     * Choose or take a photo. It is shrunk here to the size the vision encoder
     * works at — a 12-megapixel photo through the bridge would be twenty
     * megabytes of base64 for nothing — and handed back as JPEG.
     */
    @PluginMethod
    public void pickImage(PluginCall call) {
        if (!(getActivity() instanceof MainActivity)) { call.reject("No activity to ask"); return; }
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        boolean capture = Boolean.TRUE.equals(call.getBoolean("capture", false));
        ((MainActivity) getActivity()).openFileChooser(intent, new String[] { "image/*" }, capture, uris -> {
            if (uris == null || uris.length == 0 || uris[0] == null) {
                JSObject empty = new JSObject();
                empty.put("picked", false);
                call.resolve(empty);
                return;
            }
            final android.net.Uri uri = uris[0];
            Executors.newSingleThreadExecutor().execute(() -> {
                try {
                    android.graphics.Bitmap bitmap = shrink(uri, call.getInt("maxSide", 1024));
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 88, out);
                    JSObject result = new JSObject();
                    result.put("picked", true);
                    result.put("base64", android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP));
                    result.put("width", bitmap.getWidth());
                    result.put("height", bitmap.getHeight());
                    call.resolve(result);
                } catch (Throwable error) {
                    call.reject(error.getMessage() == null ? "That picture could not be read" : error.getMessage());
                }
            });
        });
    }

    private android.graphics.Bitmap shrink(android.net.Uri uri, int maxSide) throws Exception {
        android.content.ContentResolver resolver = getContext().getContentResolver();
        android.graphics.BitmapFactory.Options bounds = new android.graphics.BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (java.io.InputStream in = resolver.openInputStream(uri)) {
            android.graphics.BitmapFactory.decodeStream(in, null, bounds);
        }
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / sample > maxSide * 2) sample *= 2;
        android.graphics.BitmapFactory.Options options = new android.graphics.BitmapFactory.Options();
        options.inSampleSize = sample;
        android.graphics.Bitmap bitmap;
        try (java.io.InputStream in = resolver.openInputStream(uri)) {
            bitmap = android.graphics.BitmapFactory.decodeStream(in, null, options);
        }
        if (bitmap == null) throw new IllegalArgumentException("That is not a picture Vex can read");
        int rotate = 0;
        try (java.io.InputStream in = resolver.openInputStream(uri)) {
            if (in != null) {
                int orientation = new android.media.ExifInterface(in).getAttributeInt(
                        android.media.ExifInterface.TAG_ORIENTATION, android.media.ExifInterface.ORIENTATION_NORMAL);
                if (orientation == android.media.ExifInterface.ORIENTATION_ROTATE_90) rotate = 90;
                else if (orientation == android.media.ExifInterface.ORIENTATION_ROTATE_180) rotate = 180;
                else if (orientation == android.media.ExifInterface.ORIENTATION_ROTATE_270) rotate = 270;
            }
        } catch (Throwable ignored) { }
        float scale = Math.min(1f, (float) maxSide / Math.max(bitmap.getWidth(), bitmap.getHeight()));
        if (scale < 1f || rotate != 0) {
            android.graphics.Matrix matrix = new android.graphics.Matrix();
            if (scale < 1f) matrix.postScale(scale, scale);
            if (rotate != 0) matrix.postRotate(rotate);
            bitmap = android.graphics.Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
        }
        return bitmap;
    }

    // ── Sound for a model that can hear ──────────────────────────────────────

    /** Record from the microphone until stopAudio or thirty seconds. */
    @PluginMethod
    public void recordAudio(PluginCall call) {
        if (audio.isRecording()) { call.reject("Already recording"); return; }
        if (getContext().checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            call.reject("Vex needs the microphone for this — allow it and try again");
            return;
        }
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                audio.record((percent, seconds) -> {
                    JSObject data = new JSObject();
                    data.put("level", percent);
                    data.put("seconds", seconds);
                    notifyListeners("audioLevel", data);
                });
                JSObject result = new JSObject();
                result.put("millis", audio.lastMillis());
                call.resolve(result);
            } catch (Throwable error) {
                call.reject(error.getMessage() == null ? "The recording failed" : error.getMessage());
            }
        });
    }

    @PluginMethod
    public void stopAudio(PluginCall call) {
        audio.stop();
        call.resolve();
    }

    @PluginMethod
    public void clearAudio(PluginCall call) {
        audio.clear();
        call.resolve();
    }

    /** An audio file from the phone, decoded and resampled to what the model takes. */
    @PluginMethod
    public void importAudio(PluginCall call) {
        if (!(getActivity() instanceof MainActivity)) { call.reject("No activity to ask"); return; }
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("audio/*");
        ((MainActivity) getActivity()).openFileChooser(intent, uris -> {
            if (uris == null || uris.length == 0 || uris[0] == null) {
                JSObject empty = new JSObject();
                empty.put("picked", false);
                call.resolve(empty);
                return;
            }
            final android.net.Uri uri = uris[0];
            Executors.newSingleThreadExecutor().execute(() -> {
                try {
                    audio.importFrom(getContext(), uri);
                    JSObject result = new JSObject();
                    result.put("picked", true);
                    result.put("millis", audio.lastMillis());
                    call.resolve(result);
                } catch (Throwable error) {
                    call.reject(error.getMessage() == null ? "That file could not be decoded" : error.getMessage());
                }
            });
        });
    }

    // ── Scrapbook: cut things out of photos ──────────────────────────────────

    @PluginMethod
    public void scrapOpen(PluginCall call) {
        final File model = store().fileFor(call.getString("model", ""));
        if (!model.exists()) { call.reject("The cut-out model is not on this phone yet"); return; }
        if (!(getActivity() instanceof MainActivity)) { call.reject("No activity to ask"); return; }
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        boolean capture = Boolean.TRUE.equals(call.getBoolean("capture", false));
        ((MainActivity) getActivity()).openFileChooser(intent, new String[] { "image/*" }, capture, uris -> {
            if (uris == null || uris.length == 0 || uris[0] == null) {
                JSObject empty = new JSObject();
                empty.put("picked", false);
                call.resolve(empty);
                return;
            }
            final android.net.Uri uri = uris[0];
            Executors.newSingleThreadExecutor().execute(() -> {
                try {
                    String preview = segmenter().open(model, uri);
                    JSObject result = new JSObject();
                    result.put("picked", true);
                    result.put("base64", preview);
                    result.put("width", segmenter().width());
                    result.put("height", segmenter().height());
                    call.resolve(result);
                } catch (Throwable error) {
                    call.reject(error.getMessage() == null ? "That picture could not be opened" : error.getMessage());
                }
            });
        });
    }

    private static List<float[][]> strokes(JSONArray given) throws Exception {
        List<float[][]> out = new ArrayList<>();
        if (given == null) return out;
        for (int i = 0; i < given.length(); i++) {
            JSONArray stroke = given.getJSONArray(i);
            float[][] points = new float[stroke.length()][];
            for (int j = 0; j < stroke.length(); j++) {
                JSONArray point = stroke.getJSONArray(j);
                points[j] = new float[] { (float) point.getDouble(0), (float) point.getDouble(1) };
            }
            out.add(points);
        }
        return out;
    }

    @PluginMethod
    public void scrapCut(PluginCall call) {
        final File model = store().fileFor(call.getString("model", ""));
        final List<float[][]> positive;
        final List<float[][]> negative;
        try {
            positive = strokes(call.getArray("positive", new com.getcapacitor.JSArray()));
            negative = strokes(call.getArray("negative", new com.getcapacitor.JSArray()));
        } catch (Exception error) { call.reject("Those strokes could not be read"); return; }
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                Segmenter.Cutout cut = segmenter().cut(model, positive, negative);
                JSObject result = new JSObject();
                result.put("found", cut != null);
                if (cut != null) {
                    result.put("png", cut.png);
                    result.put("x", cut.x);
                    result.put("y", cut.y);
                    result.put("w", cut.w);
                    result.put("h", cut.h);
                }
                call.resolve(result);
            } catch (Throwable error) {
                call.reject(error.getMessage() == null ? "The cut-out failed" : error.getMessage());
            }
        });
    }

    @PluginMethod
    public void scrapClose(PluginCall call) {
        if (segmenter != null) {
            segmenter.forgetPicture();
            segmenter.close();
        }
        call.resolve();
    }

    // ── Mobile Actions ───────────────────────────────────────────────────────

    @PluginMethod
    public void deviceAction(PluginCall call) {
        String name = call.getString("name", "");
        try {
            JSONObject args = new JSONObject(call.getString("args", "{}"));
            String text = DeviceActions.run(getActivity(), name, args);
            JSObject result = new JSObject();
            result.put("text", text);
            call.resolve(result);
        } catch (Throwable error) {
            call.reject(error.getMessage() == null ? "That did not work" : error.getMessage());
        }
    }

    // ── Nano's three jobs ────────────────────────────────────────────────────

    private NanoRunner.Text resolving(final PluginCall call) {
        return new NanoRunner.Text() {
            @Override public void onText(String text) {
                JSObject result = new JSObject();
                result.put("text", text);
                call.resolve(result);
            }
            @Override public void onError(String message) { call.reject(message); }
        };
    }

    @PluginMethod
    public void nanoSummarize(PluginCall call) {
        String text = call.getString("text", "");
        if (text.isEmpty()) { call.reject("Nothing to summarise"); return; }
        nano().summarize(text, call.getInt("bullets", 3), resolving(call));
    }

    @PluginMethod
    public void nanoProofread(PluginCall call) {
        String text = call.getString("text", "");
        if (text.isEmpty()) { call.reject("Nothing to proofread"); return; }
        nano().proofread(text, resolving(call));
    }

    @PluginMethod
    public void nanoRewrite(PluginCall call) {
        String text = call.getString("text", "");
        if (text.isEmpty()) { call.reject("Nothing to rewrite"); return; }
        nano().rewrite(text, call.getString("style", "rephrase"), resolving(call));
    }
}
