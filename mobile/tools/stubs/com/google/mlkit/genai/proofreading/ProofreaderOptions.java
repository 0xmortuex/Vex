package com.google.mlkit.genai.proofreading;

import android.content.Context;

public class ProofreaderOptions {
    public static Builder builder(Context context) { return null; }
    public static class Builder {
        public Builder setInputType(int inputType) { return this; }
        public Builder setLanguage(int language) { return this; }
        public ProofreaderOptions build() { return null; }
    }
    public static final class InputType {
        private InputType() { }
        public static final int KEYBOARD = 0;
        public static final int VOICE = 1;
    }
    public static final class Language {
        private Language() { }
        public static final int ENGLISH = 0;
    }
}
