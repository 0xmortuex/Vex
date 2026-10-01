package com.vex.browser.localai;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.vex.browser.MainActivity;

import java.io.File;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;

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

    private LiteRtRunner litert() {
        if (litert == null) litert = new LiteRtRunner(getContext());
        return litert;
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

    @PluginMethod
    public void load(PluginCall call) {
        String name = call.getString("name", "");
        File model = store().fileFor(name);
        if (!model.exists()) { call.reject("That model is not on this device"); return; }
        litert().load(model, call.getString("backend", "cpu"), call.getString("system", ""),
                new LiteRtRunner.Ready() {
                    @Override public void onReady(String loaded, String backend) {
                        JSObject result = new JSObject();
                        result.put("loaded", true);
                        result.put("model", loaded);
                        result.put("backend", backend);
                        call.resolve(result);
                        notifyListeners("modelLoaded", result);
                    }
                    @Override public void onError(String message) { call.reject(message); }
                });
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
        if (prompt.isEmpty()) { call.reject("Nothing to answer"); return; }
        litert().generate(prompt, new LiteRtRunner.Tokens() {
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
