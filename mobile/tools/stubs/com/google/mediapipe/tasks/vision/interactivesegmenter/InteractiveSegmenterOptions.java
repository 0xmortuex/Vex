package com.google.mediapipe.tasks.vision.interactivesegmenter;

import com.google.mediapipe.tasks.core.BaseOptions;

public abstract class InteractiveSegmenterOptions {
    public static Builder builder() { return null; }
    public abstract static class Builder {
        public abstract Builder setBaseOptions(BaseOptions baseOptions);
        public abstract InteractiveSegmenterOptions build();
    }
}
