package com.vex.browser;

import android.Manifest;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.provider.MediaStore;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;

import android.speech.RecognizerIntent;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.vex.browser.block.VexBlockPlugin;
import com.vex.browser.localai.VexLocalAIPlugin;
import com.vex.browser.speech.VexSpeakPlugin;
import com.vex.browser.tabs.VexTabsPlugin;
import com.vex.browser.translate.VexTranslatePlugin;
import com.vex.browser.remind.VexRemindPlugin;
import com.vex.browser.system.VexSystemPlugin;
import com.vex.browser.vault.VexSecretsPlugin;
import com.vex.browser.widget.SearchWidget;

/**
 * The single activity. It hosts two WebView layers:
 *
 *   • Capacitor's bridge WebView, which renders the Vex chrome from assets
 *     (mobile/www) — toolbar, omnibox, tab switcher, sheets.
 *   • A container of page WebViews owned by {@link VexTabsPlugin}, laid over
 *     the chrome's content rect.
 *
 * It also owns the two things a plugin cannot own on its own: the file chooser
 * activity result (a page's &lt;input type="file"&gt; starts in native code, not
 * in a JS call, so there is no PluginCall to hang the result on) and the
 * intents that make Vex usable as the device's browser.
 */
public class MainActivity extends BridgeActivity {

    /** What a page's file input, dictation or a permission prompt is waiting on. */
    public interface TextResult { void onText(String text); }
    public interface PermissionResult { void onResult(boolean granted); }

    private ActivityResultLauncher<Intent> fileChooser;
    private ActivityResultLauncher<Intent> voiceInput;
    private ActivityResultLauncher<String> permissionRequest;
    private ValueCallback<Uri[]> pendingFileCallback;
    /** Where the camera was asked to put a photo for a page's file input. */
    private Uri pendingPhoto;
    private File pendingPhotoFile;
    private TextResult pendingVoiceCallback;
    private PermissionResult pendingPermissionCallback;
    /** An intent that arrived before the chrome was listening. */
    private JSObject pendingLaunch;
    private boolean chromeListening;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge is built.
        registerPlugin(VexTabsPlugin.class);
        registerPlugin(VexBlockPlugin.class);
        registerPlugin(VexSecretsPlugin.class);
        registerPlugin(VexSystemPlugin.class);
        registerPlugin(VexRemindPlugin.class);
        registerPlugin(VexLocalAIPlugin.class);
        registerPlugin(VexSpeakPlugin.class);
        registerPlugin(VexTranslatePlugin.class);
        super.onCreate(savedInstanceState);

        // The chrome has a hole in it where the page goes; a solid background
        // on the bridge WebView would paint over the page.
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
        }

        fileChooser = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                result -> {
                    ValueCallback<Uri[]> callback = pendingFileCallback;
                    Uri photo = pendingPhoto;
                    File photoFile = pendingPhotoFile;
                    pendingFileCallback = null;
                    pendingPhoto = null;
                    pendingPhotoFile = null;
                    if (callback == null) return;
                    Uri[] chosen = null;
                    if (result.getResultCode() == RESULT_OK) {
                        if (result.getData() != null) chosen = parseFileResult(result.getData());
                        // The camera writes where it was told and often hands
                        // back no data at all; an empty file means it did not.
                        if (chosen == null && photo != null && photoFile != null && photoFile.length() > 0) {
                            chosen = new Uri[] { photo };
                        }
                    }
                    // A null value is required when the user cancels, or the
                    // page's file input stays stuck waiting forever.
                    callback.onReceiveValue(chosen);
                });

        voiceInput = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                result -> {
                    TextResult callback = pendingVoiceCallback;
                    pendingVoiceCallback = null;
                    if (callback == null) return;
                    String spoken = "";
                    if (result.getResultCode() == RESULT_OK && result.getData() != null) {
                        java.util.ArrayList<String> heard =
                                result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                        if (heard != null && !heard.isEmpty()) spoken = heard.get(0);
                    }
                    callback.onText(spoken);
                });

        permissionRequest = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(),
                granted -> {
                    PermissionResult callback = pendingPermissionCallback;
                    pendingPermissionCallback = null;
                    if (callback != null) callback.onResult(Boolean.TRUE.equals(granted));
                });

        handleIntent(getIntent());
    }

    /** Dictation into the address bar — the system recogniser, not ours. */
    public void startVoiceInput(TextResult callback) {
        if (pendingVoiceCallback != null) pendingVoiceCallback.onText("");
        pendingVoiceCallback = callback;
        try {
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Say what you are looking for");
            voiceInput.launch(intent);
        } catch (Exception error) {
            pendingVoiceCallback = null;
            callback.onText("");
        }
    }

    /**
     * A page asked for the camera, the microphone or a location. Vex can only
     * grant what the app itself holds, so the app has to ask Android first.
     */
    public void requestRuntimePermission(String permission, PermissionResult callback) {
        if (pendingPermissionCallback != null) pendingPermissionCallback.onResult(false);
        pendingPermissionCallback = callback;
        try {
            permissionRequest.launch(permission);
        } catch (Exception error) {
            pendingPermissionCallback = null;
            callback.onResult(false);
        }
    }

    private Uri[] parseFileResult(Intent data) {
        if (data.getClipData() != null) {
            int count = data.getClipData().getItemCount();
            Uri[] uris = new Uri[count];
            for (int i = 0; i < count; i++) uris[i] = data.getClipData().getItemAt(i).getUri();
            return uris;
        }
        return data.getData() != null ? new Uri[]{data.getData()} : null;
    }

    /**
     * Called by the tab layer when a page opens a file picker.
     *
     * An input that takes images or video gets the camera beside the files, as
     * in Chrome and Samsung Internet — a form asking for a photo of a receipt
     * should not need the photo taken in another app first. With `capture` on
     * the input, the camera opens straight away.
     */
    public void openFileChooser(Intent content, String[] accept, boolean capture, ValueCallback<Uri[]> callback) {
        if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
        pendingFileCallback = callback;
        pendingPhoto = null;
        pendingPhotoFile = null;
        boolean images = wants(accept, "image/", ".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".gif");
        boolean videos = wants(accept, "video/", ".mp4", ".mov", ".webm", ".3gp", ".mkv");
        if ((!images && !videos) || !getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            launchChooser(content, new ArrayList<>(), false);
            return;
        }
        // Vex declares the camera permission (for sites' video calls), and an
        // app that declares it may not send ACTION_IMAGE_CAPTURE without it:
        // the camera app refuses. So it is asked for here, once; a no leaves
        // the files.
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            launchChooser(content, cameraIntents(images, videos), capture);
        } else {
            requestRuntimePermission(Manifest.permission.CAMERA, granted -> {
                if (pendingFileCallback != callback) return;
                launchChooser(content, granted ? cameraIntents(images, videos) : new ArrayList<>(), capture && granted);
            });
        }
    }

    /** A plain file picker, for Vex's own imports (a model file, a backup). */
    public void openFileChooser(Intent content, ValueCallback<Uri[]> callback) {
        if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
        pendingFileCallback = callback;
        pendingPhoto = null;
        pendingPhotoFile = null;
        launchChooser(content, new ArrayList<>(), false);
    }

    private void launchChooser(Intent content, List<Intent> cameras, boolean capture) {
        ValueCallback<Uri[]> callback = pendingFileCallback;
        try {
            Intent launch;
            if (capture && !cameras.isEmpty()) {
                launch = cameras.get(0);
            } else {
                launch = Intent.createChooser(content, getString(R.string.file_chooser_title));
                if (!cameras.isEmpty()) {
                    launch.putExtra(Intent.EXTRA_INITIAL_INTENTS, cameras.toArray(new Intent[0]));
                }
            }
            fileChooser.launch(launch);
        } catch (Exception ex) {
            pendingFileCallback = null;
            pendingPhoto = null;
            pendingPhotoFile = null;
            if (callback != null) callback.onReceiveValue(null);
        }
    }

    /** Does the accept list take this kind? No list, or a wildcard, takes everything. */
    static boolean wants(String[] accept, String mimePrefix, String... extensions) {
        boolean any = true;
        if (accept != null) {
            for (String raw : accept) {
                if (raw == null) continue;
                for (String part : raw.split(",")) {
                    String type = part.trim().toLowerCase(Locale.ROOT);
                    if (type.isEmpty()) continue;
                    any = false;
                    if (type.equals("*/*") || type.startsWith(mimePrefix)) return true;
                    for (String extension : extensions) if (type.equals(extension)) return true;
                }
            }
        }
        return any;
    }

    private List<Intent> cameraIntents(boolean images, boolean videos) {
        List<Intent> intents = new ArrayList<>();
        if (images) {
            try {
                File dir = new File(getCacheDir(), "camera");
                if (!dir.exists()) dir.mkdirs();
                // Yesterday's photos have been uploaded or abandoned.
                File[] old = dir.listFiles();
                long dayAgo = System.currentTimeMillis() - 24L * 60 * 60 * 1000;
                if (old != null) for (File file : old) if (file.lastModified() < dayAgo) file.delete();
                File file = new File(dir, "photo-" + System.currentTimeMillis() + ".jpg");
                Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", file);
                Intent photo = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                photo.putExtra(MediaStore.EXTRA_OUTPUT, uri);
                // The grant has to ride on ClipData to survive the chooser.
                photo.setClipData(ClipData.newRawUri("", uri));
                photo.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                if (photo.resolveActivity(getPackageManager()) != null) {
                    intents.add(photo);
                    pendingPhoto = uri;
                    pendingPhotoFile = file;
                }
            } catch (Exception ignored) {
                // No camera app, or nowhere to put the photo: files only.
            }
        }
        if (videos) {
            Intent video = new Intent(MediaStore.ACTION_VIDEO_CAPTURE);
            if (video.resolveActivity(getPackageManager()) != null) intents.add(video);
        }
        return intents;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    /**
     * The launcher shortcuts in res/xml/shortcuts.xml. Each carries one of these
     * actions and names this activity, so they arrive here and nowhere else.
     * They are mapped onto the same four targets the home-screen widget uses,
     * because they mean the same four things.
     */
    private static String shortcutTarget(String action) {
        if (action == null) return null;
        switch (action) {
            case "com.vex.browser.action.NEW_TAB": return "new-tab";
            case "com.vex.browser.action.NEW_PRIVATE_TAB": return "new-private-tab";
            case "com.vex.browser.action.VOICE": return "voice";
            case "com.vex.browser.action.SCAN": return "scan";
            default: return null;
        }
    }

    /**
     * http/https VIEW intents are delivered by @capacitor/app as appUrlOpen.
     * Shared text, WEB_SEARCH, the widget and the launcher shortcuts are not, so
     * they are forwarded to the chrome as a window event the boot script listens
     * for.
     */
    private void handleIntent(Intent intent) {
        if (intent == null || getBridge() == null) return;
        String action = intent.getAction();
        String text = null;

        // Some apps send "text/plain; charset=utf-8": the filter still matches
        // it, so this must too, or the share arrives and silently does nothing.
        String type = intent.getType();
        if (Intent.ACTION_SEND.equals(action) && type != null && type.toLowerCase(java.util.Locale.ROOT).startsWith("text/plain")) {
            text = intent.getStringExtra(Intent.EXTRA_TEXT);
        } else if (Intent.ACTION_WEB_SEARCH.equals(action)) {
            text = intent.getStringExtra("query");
        }

        JSObject payload = null;
        String widget = intent.getStringExtra(SearchWidget.EXTRA_ACTION);
        if (widget == null || widget.isEmpty()) widget = shortcutTarget(action);
        if (widget != null && !widget.isEmpty()) {
            payload = new JSObject();
            payload.put("widget", widget);
        } else if (text != null && !text.trim().isEmpty()) {
            payload = new JSObject();
            payload.put("text", text.trim());
        }
        if (payload == null) return;

        // A launcher or widget tap starts the activity, so this runs long before
        // the chrome has parsed a line of JavaScript. Until the chrome has asked
        // for it once, the intent waits rather than being shouted at nobody.
        if (!chromeListening) {
            pendingLaunch = payload;
            return;
        }
        final String detail = payload.toString();
        getBridge().getWebView().post(() ->
                getBridge().triggerWindowJSEvent("vexOpenText", detail));
    }

    /**
     * Handed to the chrome on boot by VexSystem.pendingIntent(). Asking marks the
     * chrome as listening, so everything after this point arrives as an event.
     */
    public JSObject takePendingLaunch() {
        chromeListening = true;
        JSObject payload = pendingLaunch;
        pendingLaunch = null;
        return payload;
    }
}
