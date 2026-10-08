package androidx.core.content.pm;

import android.content.Context;
import android.content.IntentSender;

public class ShortcutManagerCompat {
    public static boolean isRequestPinShortcutSupported(Context context) { return false; }
    public static boolean requestPinShortcut(Context context, ShortcutInfoCompat shortcut, IntentSender callback) { return false; }
}
