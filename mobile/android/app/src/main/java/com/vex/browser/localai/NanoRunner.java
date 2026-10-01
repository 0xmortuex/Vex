package com.vex.browser.localai;

import android.content.Context;

import androidx.core.content.ContextCompat;

import com.google.common.util.concurrent.FutureCallback;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.genai.common.DownloadCallback;
import com.google.mlkit.genai.common.FeatureStatus;
import com.google.mlkit.genai.common.GenAiException;
import com.google.mlkit.genai.proofreading.Proofreader;
import com.google.mlkit.genai.proofreading.ProofreaderOptions;
import com.google.mlkit.genai.proofreading.Proofreading;
import com.google.mlkit.genai.proofreading.ProofreadingRequest;
import com.google.mlkit.genai.proofreading.ProofreadingResult;
import com.google.mlkit.genai.proofreading.ProofreadingSuggestion;
import com.google.mlkit.genai.rewriting.Rewriter;
import com.google.mlkit.genai.rewriting.RewriterOptions;
import com.google.mlkit.genai.rewriting.Rewriting;
import com.google.mlkit.genai.rewriting.RewritingRequest;
import com.google.mlkit.genai.rewriting.RewritingResult;
import com.google.mlkit.genai.rewriting.RewritingSuggestion;
import com.google.mlkit.genai.summarization.Summarization;
import com.google.mlkit.genai.summarization.SummarizationRequest;
import com.google.mlkit.genai.summarization.SummarizationResult;
import com.google.mlkit.genai.summarization.Summarizer;
import com.google.mlkit.genai.summarization.SummarizerOptions;

import java.util.List;

/**
 * Gemini Nano, through ML Kit's GenAI features.
 *
 * This is the other kind of on-device AI: the weights belong to the system
 * (AICore), not to Vex, so there is nothing to download into the app and nothing
 * to keep. The trade is that it does three fixed jobs — summarise, proofread,
 * rewrite — rather than answering an arbitrary prompt. Open-ended prompting
 * exists (genai-prompt) but only as Kotlin suspend functions, so it is not
 * reachable from a Java-only app; LiteRT-LM covers that case instead.
 *
 * Every feature is gated on the device: a Galaxy S25 or a Pixel 9 has AICore, a
 * mid-range phone does not, and checkFeatureStatus is the only honest way to ask.
 */
public class NanoRunner {

    public interface Text {
        void onText(String text);
        void onError(String message);
    }

    public interface Status {
        void onStatus(String status);
    }

    public interface Download {
        void onProgress(long received, long total);
        void onDone();
        void onError(String message);
    }

    private final Context context;

    public NanoRunner(Context context) {
        this.context = context;
    }

    private Summarizer summarizer(int bullets) {
        int outputType = bullets <= 1 ? SummarizerOptions.OutputType.ONE_BULLET
                : bullets == 2 ? SummarizerOptions.OutputType.TWO_BULLETS
                : SummarizerOptions.OutputType.THREE_BULLETS;
        return Summarization.getClient(SummarizerOptions.builder(context)
                .setInputType(SummarizerOptions.InputType.ARTICLE)
                .setOutputType(outputType)
                .setLanguage(SummarizerOptions.Language.ENGLISH)
                .build());
    }

    private static String name(int status) {
        switch (status) {
            case FeatureStatus.AVAILABLE: return "available";
            case FeatureStatus.DOWNLOADABLE: return "downloadable";
            case FeatureStatus.DOWNLOADING: return "downloading";
            default: return "unavailable";
        }
    }

    private static String reason(Throwable error) {
        if (error == null) return "unknown";
        String message = error.getMessage();
        return message == null ? error.toString() : message;
    }

    /** Ask the system whether Nano is usable here, without starting anything. */
    public void status(final Status callback) {
        try {
            final Summarizer client = summarizer(3);
            Futures.addCallback(client.checkFeatureStatus(), new FutureCallback<Integer>() {
                @Override public void onSuccess(Integer status) {
                    close(client);
                    callback.onStatus(name(status == null ? FeatureStatus.UNAVAILABLE : status));
                }
                @Override public void onFailure(Throwable error) {
                    close(client);
                    callback.onStatus("unavailable");
                }
            }, ContextCompat.getMainExecutor(context));
        } catch (Throwable error) {
            // On a device with no AICore at all, getClient itself can throw.
            callback.onStatus("unavailable");
        }
    }

    /**
     * Ask AICore for the weights. They are shared with every other app that uses
     * Nano, so this is usually quick and often already done.
     */
    public void download(final Download callback) {
        try {
            final Summarizer client = summarizer(3);
            Futures.addCallback(client.downloadFeature(new DownloadCallback() {
                private long total;
                @Override public void onDownloadStarted(long bytesToDownload) { total = bytesToDownload; }
                @Override public void onDownloadProgress(long totalBytesDownloaded) {
                    callback.onProgress(totalBytesDownloaded, total);
                }
                @Override public void onDownloadCompleted() { callback.onDone(); }
                @Override public void onDownloadFailed(GenAiException error) { callback.onError(reason(error)); }
            }), new FutureCallback<Void>() {
                @Override public void onSuccess(Void result) { close(client); }
                @Override public void onFailure(Throwable error) {
                    close(client);
                    callback.onError(reason(error));
                }
            }, ContextCompat.getMainExecutor(context));
        } catch (Throwable error) {
            callback.onError(reason(error));
        }
    }

    public void summarize(final String text, final int bullets, final Text callback) {
        try {
            final Summarizer client = summarizer(bullets);
            Futures.addCallback(client.runInference(SummarizationRequest.builder(text).build()),
                    new FutureCallback<SummarizationResult>() {
                        @Override public void onSuccess(SummarizationResult result) {
                            close(client);
                            callback.onText(result == null ? "" : result.getSummary());
                        }
                        @Override public void onFailure(Throwable error) {
                            close(client);
                            callback.onError(reason(error));
                        }
                    }, ContextCompat.getMainExecutor(context));
        } catch (Throwable error) {
            callback.onError(reason(error));
        }
    }

    public void proofread(final String text, final Text callback) {
        try {
            final Proofreader client = Proofreading.getClient(ProofreaderOptions.builder(context)
                    .setInputType(ProofreaderOptions.InputType.KEYBOARD)
                    .setLanguage(ProofreaderOptions.Language.ENGLISH)
                    .build());
            Futures.addCallback(client.runInference(ProofreadingRequest.builder(text).build()),
                    new FutureCallback<ProofreadingResult>() {
                        @Override public void onSuccess(ProofreadingResult result) {
                            close(client);
                            List<ProofreadingSuggestion> results = result == null ? null : result.getResults();
                            callback.onText(results == null || results.isEmpty() ? "" : results.get(0).getText());
                        }
                        @Override public void onFailure(Throwable error) {
                            close(client);
                            callback.onError(reason(error));
                        }
                    }, ContextCompat.getMainExecutor(context));
        } catch (Throwable error) {
            callback.onError(reason(error));
        }
    }

    public void rewrite(final String text, final String style, final Text callback) {
        try {
            final Rewriter client = Rewriting.getClient(RewriterOptions.builder(context)
                    .setOutputType(outputFor(style))
                    .setLanguage(RewriterOptions.Language.ENGLISH)
                    .build());
            Futures.addCallback(client.runInference(RewritingRequest.builder(text).build()),
                    new FutureCallback<RewritingResult>() {
                        @Override public void onSuccess(RewritingResult result) {
                            close(client);
                            List<RewritingSuggestion> results = result == null ? null : result.getResults();
                            callback.onText(results == null || results.isEmpty() ? "" : results.get(0).getText());
                        }
                        @Override public void onFailure(Throwable error) {
                            close(client);
                            callback.onError(reason(error));
                        }
                    }, ContextCompat.getMainExecutor(context));
        } catch (Throwable error) {
            callback.onError(reason(error));
        }
    }

    private static int outputFor(String style) {
        if (style == null) return RewriterOptions.OutputType.REPHRASE;
        switch (style) {
            case "shorten": return RewriterOptions.OutputType.SHORTEN;
            case "elaborate": return RewriterOptions.OutputType.ELABORATE;
            case "friendly": return RewriterOptions.OutputType.FRIENDLY;
            case "professional": return RewriterOptions.OutputType.PROFESSIONAL;
            case "emojify": return RewriterOptions.OutputType.EMOJIFY;
            default: return RewriterOptions.OutputType.REPHRASE;
        }
    }

    private static void close(AutoCloseable client) {
        try { client.close(); } catch (Exception ignored) { }
    }
}
