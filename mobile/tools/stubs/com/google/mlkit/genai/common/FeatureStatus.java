// ML Kit GenAI's shared surface. Checked against googlesamples/mlkit
// android/genai (BaseActivity.kt, SummarizationActivity.kt and friends).
package com.google.mlkit.genai.common;

public final class FeatureStatus {
    private FeatureStatus() { }
    public static final int UNAVAILABLE = 0;
    public static final int DOWNLOADABLE = 1;
    public static final int DOWNLOADING = 2;
    public static final int AVAILABLE = 3;
}
