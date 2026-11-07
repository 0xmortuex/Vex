package com.google.mediapipe.tasks.components.containers;

public abstract class NormalizedKeypoint {
    public static NormalizedKeypoint create(float x, float y) { return null; }
    public abstract float x();
    public abstract float y();
}
