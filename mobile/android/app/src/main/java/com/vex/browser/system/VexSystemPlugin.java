package com.vex.browser.system;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.app.role.RoleManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.util.Rational;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.File;
import java.net.HttpURLConnection;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.vex.browser.MainActivity;

/**
 * The device, rather than the web: the fingerprint prompt that guards private
 * tabs and the password vault, pinning a site to the home screen, dictating
 * into the address bar, the floating video window, runtime permissions, and
 * the one screen Android keeps the "default browser" switch on.
 *
 * Each of these is a Samsung Internet feature with no web equivalent, so there
 * is nothing to do in the chrome but ask for it.
 */
@CapacitorPlugin(name = "VexSystem")
public class VexSystemPlugin extends Plugin {

    // ── Biometrics ───────────────────────────────────────────────────────────

    @PluginMethod
    public void biometricsAvailable(PluginCall call) {
        int status = BiometricManager.from(getContext()).canAuthenticate(
                BiometricManager.Authenticators.BIOMETRIC_WEAK
                        | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
        JSObject result = new JSObject();
        result.put("available", status == BiometricManager.BIOMETRIC_SUCCESS);
        result.put("reason", status == BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE ? "no-hardware"
                : status == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED ? "none-enrolled" : "");
        call.resolve(result);
    }

    /**
     * Ask for a fingerprint, face or the device PIN. Resolves either way — a
     * refusal is an answer, not an error, and the chrome decides what a "no"
     * means (stay out of private tabs, keep the vault shut).
     */
    @PluginMethod
    public void authenticate(PluginCall call) {
        final String title = call.getString("title", "Unlock Vex");
        final String subtitle = call.getString("subtitle", "");
        getActivity().runOnUiThread(() -> {
            try {
                BiometricPrompt prompt = new BiometricPrompt(getActivity(),
                        ContextCompat.getMainExecutor(getContext()),
                        new BiometricPrompt.AuthenticationCallback() {
                            @Override
                            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                                JSObject answer = new JSObject();
                                answer.put("ok", true);
                                call.resolve(answer);
                            }

                            @Override
                            public void onAuthenticationError(int errorCode, CharSequence errString) {
                                JSObject answer = new JSObject();
                                answer.put("ok", false);
                                answer.put("error", String.valueOf(errString));
                                call.resolve(answer);
                            }
                        });
                BiometricPrompt.PromptInfo.Builder info = new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK
                                | BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                        .setConfirmationRequired(false);
                if (!subtitle.isEmpty()) info.setSubtitle(subtitle);
                prompt.authenticate(info.build());
            } catch (Throwable error) {
                JSObject answer = new JSObject();
                answer.put("ok", false);
                answer.put("error", String.valueOf(error.getMessage()));
                call.resolve(answer);
            }
        });
    }

    // ── Home-screen shortcuts ────────────────────────────────────────────────

    @PluginMethod
    public void addShortcut(PluginCall call) {
        final String url = call.getString("url", "");
        final String title = call.getString("title", url);
        final String icon = call.getString("icon", "");
        if (url.isEmpty()) {
            call.reject("A URL is required");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (!ShortcutManagerCompat.isRequestPinShortcutSupported(getContext())) {
                call.reject("This launcher does not take pinned shortcuts");
                return;
            }
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.setPackage(getContext().getPackageName());
            ShortcutInfoCompat.Builder shortcut = new ShortcutInfoCompat.Builder(getContext(), "vex-" + url.hashCode())
                    .setShortLabel(title.length() > 24 ? title.substring(0, 24) : title)
                    .setLongLabel(title)
                    .setIntent(intent);
            Bitmap bitmap = decodeDataUrl(icon);
            shortcut.setIcon(bitmap != null
                    ? IconCompat.createWithAdaptiveBitmap(bitmap)
                    : IconCompat.createWithResource(getContext(), com.vex.browser.R.mipmap.ic_launcher));
            ShortcutManagerCompat.requestPinShortcut(getContext(), shortcut.build(), null);
            call.resolve();
        });
    }

    private static Bitmap decodeDataUrl(String dataUrl) {
        if (dataUrl == null || !dataUrl.startsWith("data:image")) return null;
        int comma = dataUrl.indexOf(',');
        if (comma < 0) return null;
        try {
            byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Exception ignored) {
            return null;
        }
    }

    // ── Dictation ────────────────────────────────────────────────────────────

    @PluginMethod
    public void voiceInput(PluginCall call) {
        if (!(getActivity() instanceof MainActivity)) {
            call.reject("No activity");
            return;
        }
        getActivity().runOnUiThread(() ->
                ((MainActivity) getActivity()).startVoiceInput(spoken -> {
                    JSObject result = new JSObject();
                    result.put("text", spoken == null ? "" : spoken);
                    call.resolve(result);
                }));
    }

    // ── Floating video ───────────────────────────────────────────────────────

    /**
     * Samsung's "video pop-up": the page keeps playing in a small window while
     * you do something else. Android's own Picture-in-Picture is that window.
     */
    @PluginMethod
    public void enterPictureInPicture(PluginCall call) {
        final int width = call.getInt("width", 16);
        final int height = call.getInt("height", 9);
        getActivity().runOnUiThread(() -> {
            try {
                PictureInPictureParams params = new PictureInPictureParams.Builder()
                        .setAspectRatio(new Rational(Math.max(1, width), Math.max(1, height)))
                        .build();
                boolean entered = getActivity().enterPictureInPictureMode(params);
                JSObject result = new JSObject();
                result.put("ok", entered);
                call.resolve(result);
            } catch (Throwable error) {
                call.reject("Could not go to picture-in-picture: " + error.getMessage());
            }
        });
    }

    // ── Runtime permissions ──────────────────────────────────────────────────

    @PluginMethod
    public void hasPermission(PluginCall call) {
        String name = call.getString("name", "");
        JSObject result = new JSObject();
        result.put("granted", ContextCompat.checkSelfPermission(getContext(), androidPermission(name))
                == PackageManager.PERMISSION_GRANTED);
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        final String name = call.getString("name", "");
        if (!(getActivity() instanceof MainActivity)) {
            call.reject("No activity");
            return;
        }
        getActivity().runOnUiThread(() ->
                ((MainActivity) getActivity()).requestRuntimePermission(androidPermission(name), granted -> {
                    JSObject result = new JSObject();
                    result.put("granted", granted);
                    call.resolve(result);
                }));
    }

    private static String androidPermission(String name) {
        switch (name == null ? "" : name) {
            case "camera": return android.Manifest.permission.CAMERA;
            case "microphone": return android.Manifest.permission.RECORD_AUDIO;
            case "location": return android.Manifest.permission.ACCESS_FINE_LOCATION;
            case "notifications": return android.Manifest.permission.POST_NOTIFICATIONS;
            default: return android.Manifest.permission.INTERNET;
        }
    }

    // ── Fetching on the chrome's behalf ──────────────────────────────────────

    /**
     * A plain GET, for the search engine's suggestion endpoint.
     *
     * The chrome cannot make this request itself: none of the suggestion
     * endpoints send an Access-Control-Allow-Origin header, so a fetch from the
     * chrome's own origin is refused before it leaves. Native has no such rule.
     *
     * Deliberately narrow — https only, four seconds, 64 KB, no cookies and no
     * redirect off https — because "fetch any URL for me" is a capability, not a
     * convenience.
     */
    @PluginMethod
    public void fetchText(PluginCall call) {
        final String url = call.getString("url", "");
        if (!url.startsWith("https://")) { call.reject("Only https"); return; }
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new java.net.URL(url).openConnection();
                connection.setConnectTimeout(4000);
                connection.setReadTimeout(4000);
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                connection.setRequestProperty("Accept", "application/json, text/plain, */*");
                // No Cookie header is set, and no CookieHandler is installed for
                // this connection, so the request carries no identity.
                int status = connection.getResponseCode();
                StringBuilder body = new StringBuilder();
                if (status >= 200 && status < 300) {
                    java.io.InputStream in = connection.getInputStream();
                    byte[] buffer = new byte[8192];
                    int read;
                    int total = 0;
                    while ((read = in.read(buffer)) != -1 && total < 65536) {
                        body.append(new String(buffer, 0, read, java.nio.charset.StandardCharsets.UTF_8));
                        total += read;
                    }
                    in.close();
                }
                JSObject result = new JSObject();
                result.put("ok", status >= 200 && status < 300);
                result.put("status", status);
                result.put("body", body.toString());
                call.resolve(result);
            } catch (Exception error) {
                JSObject result = new JSObject();
                result.put("ok", false);
                result.put("status", 0);
                result.put("body", "");
                call.resolve(result);          // a failed suggestion is not an error
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    /**
     * Fetch a file into the cache so the chrome can render it — a PDF, today.
     *
     * With the page's own cookies: a PDF behind a login is the common case (a
     * bank statement, a ticket, a paper), and a fetch without them downloads an
     * HTML sign-in page with a .pdf name, which is worse than failing.
     *
     * Capped: a browser should not fill the phone with a file nobody asked to
     * keep, and this one lands in the cache directory where Android can reclaim
     * it.
     */
    @PluginMethod
    public void fetchFile(PluginCall call) {
        final String url = call.getString("url", "");
        final String name = call.getString("name", "file");
        final long limit = 80L * 1024 * 1024;
        if (!url.startsWith("https://") && !url.startsWith("http://")) {
            call.reject("Only http and https");
            return;
        }
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                File folder = new File(getContext().getCacheDir(), "view");
                if (!folder.exists() && !folder.mkdirs()) { call.reject("No cache directory"); return; }
                File target = new File(folder, name.replaceAll("[^A-Za-z0-9._-]", "_"));

                connection = (HttpURLConnection) new java.net.URL(url).openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setInstanceFollowRedirects(true);
                String cookies = android.webkit.CookieManager.getInstance().getCookie(url);
                if (cookies != null && !cookies.isEmpty()) connection.setRequestProperty("Cookie", cookies);
                connection.setRequestProperty("Accept", "*/*");

                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) { call.reject("The server answered " + status); return; }
                String type = connection.getContentType();

                java.io.InputStream in = connection.getInputStream();
                java.io.FileOutputStream out = new java.io.FileOutputStream(target);
                byte[] buffer = new byte[1 << 16];
                long total = 0;
                int read;
                while ((read = in.read(buffer)) != -1) {
                    total += read;
                    if (total > limit) {
                        out.close();
                        in.close();
                        if (!target.delete()) target.deleteOnExit();
                        call.reject("That file is larger than 80 MB — download it instead");
                        return;
                    }
                    out.write(buffer, 0, read);
                }
                out.flush();
                out.close();
                in.close();

                JSObject result = new JSObject();
                result.put("path", target.getAbsolutePath());
                result.put("bytes", total);
                result.put("type", type == null ? "" : type);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? error.toString() : error.getMessage());
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    // ── What this phone actually is ──────────────────────────────────────────

    /**
     * The facts a bug report needs and the chrome cannot see.
     *
     * Half of what Vex does is conditional on the WebView: private tabs need
     * multi-profile, the fingerprint shield needs document-start scripts, dark
     * pages need algorithmic darkening. When one of them silently does nothing,
     * the first question is which of those this phone has.
     *
     * Only features already used elsewhere in this app are reported, because a
     * WebViewFeature constant that does not exist in the library is a compile
     * error rather than something a try/catch can save.
     */
    @PluginMethod
    public void deviceReport(PluginCall call) {
        JSObject result = new JSObject();
        result.put("android", Build.VERSION.RELEASE);
        result.put("sdk", Build.VERSION.SDK_INT);
        result.put("device", Build.MANUFACTURER + " " + Build.MODEL);
        result.put("abi", Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "");

        PackageInfo webview = null;
        try { webview = WebViewCompat.getCurrentWebViewPackage(getContext()); } catch (Throwable ignored) { }
        result.put("webview", webview == null ? "unknown" : webview.packageName);
        result.put("webviewVersion", webview == null ? "unknown" : webview.versionName);

        JSObject features = new JSObject();
        features.put("multiProfile", supports(WebViewFeature.MULTI_PROFILE));
        features.put("documentStartScript", supports(WebViewFeature.DOCUMENT_START_SCRIPT));
        features.put("algorithmicDarkening", supports(WebViewFeature.ALGORITHMIC_DARKENING));
        result.put("webviewFeatures", features);

        try {
            File files = getContext().getFilesDir();
            result.put("freeBytes", files.getUsableSpace());
        } catch (Throwable ignored) {
            result.put("freeBytes", -1);
        }
        try {
            PackageInfo self = getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0);
            result.put("version", self.versionName);
        } catch (Throwable ignored) {
            result.put("version", "");
        }
        call.resolve(result);
    }

    private static boolean supports(String feature) {
        try { return WebViewFeature.isFeatureSupported(feature); } catch (Throwable error) { return false; }
    }

    // ── Being the browser ────────────────────────────────────────────────────

    /**
     * What Vex was launched to do, when the launch was not a URL: text shared
     * from another app, or a tap on the home-screen widget.
     *
     * The chrome asks for this once on boot, because an intent that arrives
     * during a cold start is delivered long before any JavaScript is listening.
     * Asking is also the signal that it IS listening: everything after this
     * arrives as a window event instead.
     */
    @PluginMethod
    public void pendingIntent(PluginCall call) {
        JSObject result = new JSObject();
        JSObject pending = getActivity() instanceof MainActivity
                ? ((MainActivity) getActivity()).takePendingLaunch()
                : null;
        result.put("text", pending == null ? null : pending.getString("text"));
        result.put("widget", pending == null ? null : pending.getString("widget"));
        call.resolve(result);
    }

    @PluginMethod
    public void isDefaultBrowser(PluginCall call) {
        JSObject result = new JSObject();
        boolean isDefault = false;
        try {
            Intent probe = new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com"));
            android.content.pm.ResolveInfo info = getContext().getPackageManager()
                    .resolveActivity(probe, PackageManager.MATCH_DEFAULT_ONLY);
            isDefault = info != null && getContext().getPackageName().equals(info.activityInfo.packageName);
        } catch (Exception ignored) {
        }
        result.put("value", isDefault);
        call.resolve(result);
    }

    /**
     * Android never lets an app make itself the default. All it can do is open
     * the screen where the person can, and on Android 10+ ask the role system
     * to put up the one-tap dialog.
     */
    @PluginMethod
    public void openDefaultBrowserSettings(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    RoleManager roles = (RoleManager) getContext().getSystemService(Context.ROLE_SERVICE);
                    if (roles != null && roles.isRoleAvailable(RoleManager.ROLE_BROWSER)
                            && !roles.isRoleHeld(RoleManager.ROLE_BROWSER)) {
                        getActivity().startActivityForResult(
                                roles.createRequestRoleIntent(RoleManager.ROLE_BROWSER), 4801);
                        call.resolve();
                        return;
                    }
                }
                getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS));
                call.resolve();
            } catch (ActivityNotFoundException error) {
                try {
                    getActivity().startActivity(new Intent(Settings.ACTION_SETTINGS));
                    call.resolve();
                } catch (Exception second) {
                    call.reject("Could not open Android settings");
                }
            }
        });
    }

    // ── Immersive reading ────────────────────────────────────────────────────

    @PluginMethod
    public void setFullscreen(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("value", false));
        getActivity().runOnUiThread(() -> {
            android.view.View decor = getActivity().getWindow().getDecorView();
            int flags = decor.getSystemUiVisibility();
            int immersive = android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                    | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
            decor.setSystemUiVisibility(on ? flags | immersive : flags & ~immersive);
            call.resolve();
        });
    }

    /** Keep the screen on while reading or watching. */
    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("value", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    /** Hand a file (a screenshot, a saved page) to another app. */
    @PluginMethod
    public void shareFile(PluginCall call) {
        final String path = call.getString("path", "");
        final String mime = call.getString("mimeType", "*/*");
        final String title = call.getString("title", "Share");
        getActivity().runOnUiThread(() -> {
            try {
                java.io.File file = new java.io.File(path);
                Uri uri = androidx.core.content.FileProvider.getUriForFile(
                        getContext(), getContext().getPackageName() + ".fileprovider", file);
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType(mime);
                intent.putExtra(Intent.EXTRA_STREAM, uri);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().startActivity(Intent.createChooser(intent, title));
                call.resolve();
            } catch (Exception error) {
                call.reject("Could not share that file: " + error.getMessage());
            }
        });
    }
}
