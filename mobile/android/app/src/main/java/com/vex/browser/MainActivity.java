package com.vex.browser;

import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;

import android.speech.RecognizerIntent;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.vex.browser.block.VexBlockPlugin;
import com.vex.browser.localai.VexLocalAIPlugin;
import com.vex.browser.speech.VexSpeakPlugin;
import com.vex.browser.tabs.VexTabsPlugin;
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
                    pendingFileCallback = null;
                    if (callback == null) return;
                    boolean ok = result.getResultCode() == RESULT_OK && result.getData() != null;
                    // A null value is required when the user cancels, or the
                    // page's file input stays stuck waiting forever.
                    callback.onReceiveValue(ok ? parseFileResult(result.getData()) : null);
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

    /** Called by the tab layer when a page opens a file picker. */
    public void openFileChooser(Intent intent, ValueCallback<Uri[]> callback) {
        if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
        pendingFileCallback = callback;
        try {
            fileChooser.launch(Intent.createChooser(intent, getString(R.string.file_chooser_title)));
        } catch (Exception ex) {
            pendingFileCallback = null;
            callback.onReceiveValue(null);
        }
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

        if (Intent.ACTION_SEND.equals(action) && "text/plain".equals(intent.getType())) {
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
