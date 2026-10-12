package com.google.ai.edge.litertlm;

// A Kotlin sealed class whose cases are data classes: Java constructs the
// cases directly.
public abstract class Content {
    public static final class Text extends Content { public Text(String text) { } }
    public static final class ImageBytes extends Content { public ImageBytes(byte[] bytes) { } }
    public static final class ImageFile extends Content { public ImageFile(String absolutePath) { } }
    public static final class AudioBytes extends Content { public AudioBytes(byte[] bytes) { } }
    public static final class AudioFile extends Content { public AudioFile(String absolutePath) { } }
}
