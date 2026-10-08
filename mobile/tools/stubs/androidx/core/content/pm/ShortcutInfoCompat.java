package androidx.core.content.pm;

import android.content.Context;
import android.content.Intent;

import androidx.core.graphics.drawable.IconCompat;

public class ShortcutInfoCompat {
    public static class Builder {
        public Builder(Context context, String id) { }
        public Builder setShortLabel(CharSequence label) { return this; }
        public Builder setLongLabel(CharSequence label) { return this; }
        public Builder setIcon(IconCompat icon) { return this; }
        public Builder setIntent(Intent intent) { return this; }
        public ShortcutInfoCompat build() { return new ShortcutInfoCompat(); }
    }
}
