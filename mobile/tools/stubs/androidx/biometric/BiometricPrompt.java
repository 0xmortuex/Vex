package androidx.biometric;

import androidx.fragment.app.FragmentActivity;

import java.util.concurrent.Executor;

public class BiometricPrompt {
    public static final int ERROR_NEGATIVE_BUTTON = 13;
    public static final int ERROR_USER_CANCELED = 10;

    public static class AuthenticationResult { }

    public abstract static class AuthenticationCallback {
        public void onAuthenticationError(int errorCode, CharSequence errString) { }
        public void onAuthenticationSucceeded(AuthenticationResult result) { }
        public void onAuthenticationFailed() { }
    }

    public static class PromptInfo {
        public static class Builder {
            public Builder setTitle(CharSequence title) { return this; }
            public Builder setSubtitle(CharSequence subtitle) { return this; }
            public Builder setDescription(CharSequence description) { return this; }
            public Builder setNegativeButtonText(CharSequence text) { return this; }
            public Builder setAllowedAuthenticators(int authenticators) { return this; }
            public Builder setConfirmationRequired(boolean required) { return this; }
            public PromptInfo build() { return new PromptInfo(); }
        }
    }

    public BiometricPrompt(FragmentActivity activity, Executor executor, AuthenticationCallback callback) { }
    public void authenticate(PromptInfo info) { }
    public void cancelAuthentication() { }
}
