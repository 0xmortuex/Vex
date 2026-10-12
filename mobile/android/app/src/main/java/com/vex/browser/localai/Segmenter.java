package com.vex.browser.localai;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.net.Uri;
import android.util.Base64;

import android.media.ExifInterface;

import com.google.mediapipe.framework.image.BitmapImageBuilder;
import com.google.mediapipe.framework.image.ByteBufferExtractor;
import com.google.mediapipe.framework.image.MPImage;
import com.google.mediapipe.tasks.components.containers.NormalizedKeypoint;
import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.vision.interactivesegmenter.InteractiveSegmenter;
import com.google.mediapipe.tasks.vision.interactivesegmenter.InteractiveSegmenterOptions;
import com.google.mediapipe.tasks.vision.interactivesegmenter.Stroke;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.util.ArrayList;
import java.util.List;

/**
 * Scrapbook's scissors: MediaPipe's interactive segmenter ("magic touch"),
 * which is told where the thing is — a tap, or a scribble over it — and says
 * which pixels belong to it. What it hands back is a cut-out: the picture with
 * everything else made transparent, cropped to the thing, as a PNG.
 *
 * The picture is held here, decoded once and shrunk to a size a phone can
 * segment in a moment; the chrome only ever sees a preview and the cut-outs.
 */
public class Segmenter {

    private static final int MAX_SIDE = 1280;

    private final Context context;
    private InteractiveSegmenter segmenter;
    private File loadedFrom;
    private Bitmap picture;

    public Segmenter(Context context) {
        this.context = context;
    }

    public synchronized boolean hasPicture() { return picture != null; }

    private void ensureLoaded(File model) throws Exception {
        if (segmenter != null && model.equals(loadedFrom)) return;
        close();
        // A mapped buffer rather than a path: setModelAssetPath reads from the
        // APK's assets, and this model lives in the app's files.
        MappedByteBuffer buffer;
        try (FileInputStream in = new FileInputStream(model); FileChannel channel = in.getChannel()) {
            buffer = channel.map(FileChannel.MapMode.READ_ONLY, 0, channel.size());
        }
        InteractiveSegmenterOptions options = InteractiveSegmenterOptions.builder()
                .setBaseOptions(BaseOptions.builder().setModelAssetBuffer(buffer).build())
                .build();
        segmenter = InteractiveSegmenter.createFromOptions(context, options);
        loadedFrom = model;
        if (picture != null) segmenter.setImage(new BitmapImageBuilder(picture).build());
    }

    /** Take a picture from the phone; returns a JPEG preview as base64. */
    public synchronized String open(File model, Uri uri) throws Exception {
        Bitmap decoded = decode(uri);
        if (decoded == null) throw new IllegalArgumentException("That is not a picture Vex can read");
        picture = decoded.copy(Bitmap.Config.ARGB_8888, false);
        ensureLoaded(model);
        segmenter.setImage(new BitmapImageBuilder(picture).build());
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        picture.compress(Bitmap.CompressFormat.JPEG, 85, out);
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    public int width() { return picture == null ? 0 : picture.getWidth(); }
    public int height() { return picture == null ? 0 : picture.getHeight(); }

    private Bitmap decode(Uri uri) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream in = context.getContentResolver().openInputStream(uri)) {
            BitmapFactory.decodeStream(in, null, bounds);
        }
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / sample > MAX_SIDE * 2) sample *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        Bitmap bitmap;
        try (InputStream in = context.getContentResolver().openInputStream(uri)) {
            bitmap = BitmapFactory.decodeStream(in, null, options);
        }
        if (bitmap == null) return null;
        // A phone photo is stored sideways with a note saying so.
        int rotate = 0;
        try (InputStream in = context.getContentResolver().openInputStream(uri)) {
            if (in != null) {
                int orientation = new ExifInterface(in).getAttributeInt(
                        ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                if (orientation == ExifInterface.ORIENTATION_ROTATE_90) rotate = 90;
                else if (orientation == ExifInterface.ORIENTATION_ROTATE_180) rotate = 180;
                else if (orientation == ExifInterface.ORIENTATION_ROTATE_270) rotate = 270;
            }
        } catch (Throwable ignored) { }
        float scale = Math.min(1f, (float) MAX_SIDE / Math.max(bitmap.getWidth(), bitmap.getHeight()));
        if (scale < 1f || rotate != 0) {
            Matrix matrix = new Matrix();
            if (scale < 1f) matrix.postScale(scale, scale);
            if (rotate != 0) matrix.postRotate(rotate);
            bitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
        }
        return bitmap;
    }

    /**
     * Cut out what the strokes point at. Each stroke is a list of points in the
     * picture's own 0–1 coordinates; a negative stroke takes away.
     *
     * Returns { png, x, y, w, h } — the cut-out and where it sat in the picture,
     * in pixels — or null when nothing was found.
     */
    public synchronized Cutout cut(File model, List<float[][]> positive, List<float[][]> negative) throws Exception {
        if (picture == null) throw new IllegalStateException("Choose a picture first");
        ensureLoaded(model);
        List<Stroke> strokes = new ArrayList<>();
        addStrokes(strokes, positive, Stroke.BrushMode.POSITIVE);
        addStrokes(strokes, negative, Stroke.BrushMode.NEGATIVE);
        if (strokes.isEmpty()) return null;

        MPImage mask = segmenter.segment(strokes);
        int maskWidth = mask.getWidth();
        int maskHeight = mask.getHeight();
        ByteBuffer raw = ByteBufferExtractor.extract(mask);
        raw.order(ByteOrder.nativeOrder());
        FloatBuffer floats = raw.asFloatBuffer();
        float[] confidence = new float[maskWidth * maskHeight];
        floats.get(confidence, 0, Math.min(confidence.length, floats.remaining()));

        int width = picture.getWidth();
        int height = picture.getHeight();
        int[] pixels = new int[width * height];
        picture.getPixels(pixels, 0, width, 0, 0, width, height);
        int left = width, top = height, right = -1, bottom = -1;
        for (int y = 0; y < height; y++) {
            int my = Math.min(maskHeight - 1, y * maskHeight / height);
            for (int x = 0; x < width; x++) {
                int mx = Math.min(maskWidth - 1, x * maskWidth / width);
                float value = confidence[my * maskWidth + mx];
                int index = y * width + x;
                if (value > 0.5f) {
                    // A soft edge where the model was unsure, rather than a jagged one.
                    int alpha = (int) Math.min(255, Math.max(0, (value - 0.5f) * 2 * 255 * 1.6f));
                    pixels[index] = (pixels[index] & 0x00ffffff) | (alpha << 24);
                    if (x < left) left = x;
                    if (x > right) right = x;
                    if (y < top) top = y;
                    if (y > bottom) bottom = y;
                } else {
                    pixels[index] = 0;
                }
            }
        }
        if (right < left || bottom < top) return null;
        int cropWidth = right - left + 1;
        int cropHeight = bottom - top + 1;
        Bitmap cut = Bitmap.createBitmap(cropWidth, cropHeight, Bitmap.Config.ARGB_8888);
        cut.setPixels(pixels, top * width + left, width, 0, 0, cropWidth, cropHeight);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        cut.compress(Bitmap.CompressFormat.PNG, 100, out);
        cut.recycle();
        Cutout result = new Cutout();
        result.png = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        result.x = left;
        result.y = top;
        result.w = cropWidth;
        result.h = cropHeight;
        return result;
    }

    private static void addStrokes(List<Stroke> into, List<float[][]> strokes, Stroke.BrushMode mode) {
        if (strokes == null) return;
        for (float[][] stroke : strokes) {
            List<NormalizedKeypoint> points = new ArrayList<>();
            for (float[] point : stroke) {
                if (point == null || point.length < 2) continue;
                float x = Math.max(0f, Math.min(1f, point[0]));
                float y = Math.max(0f, Math.min(1f, point[1]));
                points.add(NormalizedKeypoint.create(x, y));
            }
            if (points.isEmpty()) continue;
            into.add(Stroke.builder().setBrushMode(mode).setPoints(points).setCompleted(true).build());
        }
    }

    public static final class Cutout {
        public String png;
        public int x, y, w, h;
    }

    public synchronized void close() {
        if (segmenter != null) {
            try { segmenter.close(); } catch (Throwable ignored) { }
            segmenter = null;
        }
        loadedFrom = null;
    }

    public synchronized void forgetPicture() {
        picture = null;
    }
}
