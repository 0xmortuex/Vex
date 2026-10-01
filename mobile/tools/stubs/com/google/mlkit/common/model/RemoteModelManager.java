package com.google.mlkit.common.model;

import com.google.android.gms.tasks.Task;

import java.util.Set;

public class RemoteModelManager {
    public static RemoteModelManager getInstance() { return new RemoteModelManager(); }

    public <T extends RemoteModel> Task<Set<T>> getDownloadedModels(Class<T> type) { return null; }

    public Task<Void> deleteDownloadedModel(RemoteModel model) { return null; }

    public Task<Void> download(RemoteModel model, DownloadConditions conditions) { return null; }
}
