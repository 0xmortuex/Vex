package com.google.mlkit.genai.common;

public interface DownloadCallback {
    void onDownloadStarted(long bytesToDownload);
    void onDownloadProgress(long totalBytesDownloaded);
    void onDownloadCompleted();
    void onDownloadFailed(GenAiException e);
}
