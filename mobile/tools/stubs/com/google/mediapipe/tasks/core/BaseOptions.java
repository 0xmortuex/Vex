package com.google.mediapipe.tasks.core;

public abstract class BaseOptions {
    public static Builder builder() { return null; }
    public abstract static class Builder {
        public abstract Builder setModelAssetPath(String value);
        public abstract Builder setModelAssetBuffer(java.nio.ByteBuffer value);
        public abstract Builder setModelAssetFileDescriptor(Integer value);
        public final BaseOptions build() { return null; }
    }
}
