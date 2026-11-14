package androidx.webkit;

import android.webkit.WebSettings;

public class WebSettingsCompat {
    public static void setAlgorithmicDarkeningAllowed(WebSettings settings, boolean allow) { }
    public static boolean isAlgorithmicDarkeningAllowed(WebSettings settings) { return false; }
}
