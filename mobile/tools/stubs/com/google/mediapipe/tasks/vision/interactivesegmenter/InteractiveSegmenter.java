package com.google.mediapipe.tasks.vision.interactivesegmenter;

import com.google.mediapipe.framework.image.MPImage;
import java.util.List;

// tasks-vision 1.0.0: an image is set once, then segmented by strokes.
public class InteractiveSegmenter implements AutoCloseable {
    public static InteractiveSegmenter createFromOptions(android.content.Context context, InteractiveSegmenterOptions options) { return null; }
    public void setImage(MPImage image) { }
    public MPImage segment(List<Stroke> strokes) { return null; }
    @Override public void close() { }
}
