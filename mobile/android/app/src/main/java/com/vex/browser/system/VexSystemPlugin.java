package com.vex.browser.system;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.app.role.RoleManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
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
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                call.reject("This Android version has no picture-in-picture");
                return;
            }
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
