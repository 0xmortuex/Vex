package com.vex.browser;

import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.vex.browser.block.VexBlockPlugin;
import com.vex.browser.tabs.VexTabsPlugin;

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

    private ActivityResultLauncher<Intent> fileChooser;
    private ValueCallback<Uri[]> pendingFileCallback;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge is built.
        registerPlugin(VexTabsPlugin.class);
        registerPlugin(VexBlockPlugin.class);
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

        handleIntent(getIntent());
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
     * http/https VIEW intents are delivered by @capacitor/app as appUrlOpen.
     * Shared text and WEB_SEARCH are not, so they are forwarded to the chrome
     * as a window event the boot script listens for.
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
        if (text == null || text.trim().isEmpty()) return;

        JSObject payload = new JSObject();
        payload.put("text", text.trim());
        getBridge().getWebView().post(() ->
                getBridge().triggerWindowJSEvent("vexOpenText", payload.toString()));
    }
}
