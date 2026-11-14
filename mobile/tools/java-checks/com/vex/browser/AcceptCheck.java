package com.vex.browser;

/**
 * Which file inputs get the camera beside the files: the accept attribute, as
 * a page writes it — MIME types, wildcards, extensions, comma lists — or none.
 */
public class AcceptCheck {
    static void expect(boolean ok, String what) {
        if (!ok) throw new AssertionError(what);
        System.out.println("ok  " + what);
    }

    static boolean images(String... accept) {
        return MainActivity.wants(accept, "image/", ".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".gif");
    }

    static boolean videos(String... accept) {
        return MainActivity.wants(accept, "video/", ".mp4", ".mov", ".webm", ".3gp", ".mkv");
    }

    public static void main(String[] args) {
        expect(images("image/*"), "image/* takes photos");
        expect(!videos("image/*"), "image/* takes no video");
        expect(images("image/png", "application/pdf"), "one image type among others is enough");
        expect(images("application/pdf, image/jpeg"), "a comma list inside one entry is split");
        expect(images(".JPG"), "an extension counts, whatever its case");
        expect(!images(".pdf", "application/pdf"), "a PDF-only input gets no camera");
        expect(images(), "no accept list takes anything");
        expect(images(""), "an empty accept attribute takes anything");
        expect(images((String[]) null), "no array at all takes anything");
        expect(videos("*/*"), "*/* takes anything");
        expect(videos("video/mp4"), "video/mp4 takes video");
    }
}
