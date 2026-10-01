package com.google.mlkit.genai.rewriting;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.genai.common.DownloadCallback;

// Declares close() but does NOT implement AutoCloseable — checked
// against the real library by a build that failed when this stub said
// otherwise. It cannot be used in try-with-resources.
public interface Rewriter {
    ListenableFuture<Integer> checkFeatureStatus();
    ListenableFuture<Void> downloadFeature(DownloadCallback callback);
    ListenableFuture<RewritingResult> runInference(RewritingRequest request);
    void close();
}
