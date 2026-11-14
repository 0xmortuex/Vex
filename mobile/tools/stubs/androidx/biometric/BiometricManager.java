package androidx.biometric;

import android.content.Context;

public class BiometricManager {
    public static final int BIOMETRIC_SUCCESS = 0;
    public static final int BIOMETRIC_ERROR_NO_HARDWARE = 12;
    public static final int BIOMETRIC_ERROR_NONE_ENROLLED = 11;

    public static class Authenticators {
        public static final int BIOMETRIC_STRONG = 0x000000F;
        public static final int BIOMETRIC_WEAK = 0x00000FF;
        public static final int DEVICE_CREDENTIAL = 0x00008000;
    }

    public static BiometricManager from(Context context) { return new BiometricManager(); }
    public int canAuthenticate(int authenticators) { return BIOMETRIC_SUCCESS; }
}
