package com.google.mlkit.nl.languageid;

import com.google.android.gms.tasks.Task;

import java.io.Closeable;

public interface LanguageIdentifier extends Closeable {
    /** A BCP-47 tag, or "und" when it cannot tell. */
    Task<String> identifyLanguage(String text);
    @Override void close();
}
