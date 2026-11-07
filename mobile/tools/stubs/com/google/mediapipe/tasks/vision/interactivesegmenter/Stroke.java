package com.google.mediapipe.tasks.vision.interactivesegmenter;

import com.google.mediapipe.tasks.components.containers.NormalizedKeypoint;
import java.util.List;

public abstract class Stroke {
    public enum BrushMode { POSITIVE, NEGATIVE, LASSO }
    public static Builder builder() { return null; }
    public abstract static class Builder {
        public abstract Builder setBrushMode(BrushMode brushMode);
        public abstract Builder setPoints(List<NormalizedKeypoint> points);
        public abstract Builder setCompleted(boolean completed);
        public abstract Stroke build();
    }
}
