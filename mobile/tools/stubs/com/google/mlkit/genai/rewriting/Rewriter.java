package com.google.mlkit.genai.rewriting;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.genai.common.DownloadCallback;

public interface Rewriter extends AutoCloseable {
    ListenableFuture<Integer> checkFeatureStatus();
    ListenableFuture<Void> downloadFeature(DownloadCallback callback);
    ListenableFuture<RewritingResult> runInference(RewritingRequest request);
    @Override void close();
}
