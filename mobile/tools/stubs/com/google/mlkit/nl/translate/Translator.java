package com.google.mlkit.nl.translate;

import com.google.android.gms.tasks.Task;
import com.google.mlkit.common.model.DownloadConditions;

import java.io.Closeable;

// Unlike the GenAI clients, this one really is Closeable.
public interface Translator extends Closeable {
    Task<Void> downloadModelIfNeeded(DownloadConditions conditions);
    Task<String> translate(String input);
    @Override void close();
}
