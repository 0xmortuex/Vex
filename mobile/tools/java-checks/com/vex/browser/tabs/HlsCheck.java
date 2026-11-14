package com.vex.browser.tabs;

/**
 * The HLS playlist reader, run on the JVM by scripts/check-java.mjs. The
 * parsing is plain Java; only fetching and writing need a phone, so this is
 * where the decisions that matter — which rendition, which key, which bytes —
 * are pinned down.
 */
public class HlsCheck {
    static void expect(boolean ok, String what) {
        if (!ok) throw new AssertionError(what);
        System.out.println("ok  " + what);
    }
    public static void main(String[] args) throws Exception {
        String master = "#EXTM3U\n"
            + "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"aud\",NAME=\"en\",URI=\"audio/en.m3u8\"\n"
            + "#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=1920x1080,AUDIO=\"aud\"\n"
            + "hd/separate.m3u8\n"
            + "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS=\"avc1.4d401e,mp4a.40.2\"\n"
            + "low/index.m3u8?token=1\n"
            + "#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720\n"
            + "https://other.example/mid/index.m3u8\n";
        expect(StreamDownloader.pickVariant(master, "https://cdn.example/v/master.m3u8")
            .equals("https://other.example/mid/index.m3u8"), "best rendition with its own sound wins over a louder-bitrate silent one");

        String onlySeparate = "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",URI=\"a.m3u8\"\n#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO=\"a\"\nv.m3u8\n";
        try { StreamDownloader.pickVariant(onlySeparate, "https://x/"); expect(false, "separate sound refused"); }
        catch (java.io.IOException error) { expect(error.getMessage().contains("sound separately"), "separate sound refused"); }

        String media = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:7\n"
            + "#EXT-X-KEY:METHOD=AES-128,URI=\"../keys/k1\",IV=0x000000000000000000000000000000AB\n"
            + "#EXTINF:6.0,\nseg7.ts\n#EXTINF:6.0,\n/abs/seg8.ts\n"
            + "#EXT-X-KEY:METHOD=NONE\n#EXTINF:6.0,\nhttps://edge.example/seg9.ts\n#EXT-X-ENDLIST\n";
        StreamDownloader.MediaPlaylist parsed = StreamDownloader.parseMedia(media, "https://cdn.example/v/low/index.m3u8");
        expect(parsed.segments.size() == 3, "three segments");
        expect(parsed.segments.get(0).url.equals("https://cdn.example/v/low/seg7.ts"), "relative segment resolved");
        expect(parsed.segments.get(1).url.equals("https://cdn.example/abs/seg8.ts"), "root-relative segment resolved");
        expect(parsed.segments.get(0).keyUrl.equals("https://cdn.example/v/keys/k1"), "key resolved");
        expect(parsed.segments.get(0).iv[15] == (byte) 0xAB && parsed.segments.get(0).iv[0] == 0, "explicit IV read");
        expect(parsed.segments.get(1).sequenceNumber == 8, "sequence numbers count from the media sequence");
        expect(parsed.segments.get(2).keyUrl == null, "METHOD=NONE ends encryption");

        String fmp4 = "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\",BYTERANGE=\"700@0\"\n"
            + "#EXT-X-BYTERANGE:1000@700\n#EXTINF:4,\nmain.mp4\n#EXT-X-BYTERANGE:1200\n#EXTINF:4,\nmain.mp4\n#EXT-X-ENDLIST\n";
        StreamDownloader.MediaPlaylist frag = StreamDownloader.parseMedia(fmp4, "https://c/x/p.m3u8");
        expect("https://c/x/init.mp4".equals(frag.initUrl) && frag.initLength == 700 && frag.initOffset == 0, "fMP4 init section");
        expect(frag.segments.get(0).offset == 700 && frag.segments.get(0).length == 1000, "byte range with offset");
        expect(frag.segments.get(1).offset == 1700 && frag.segments.get(1).length == 1200, "byte range continuing from the last");

        try { StreamDownloader.parseMedia("#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"skd://x\"\nseg.ts\n", "https://c/"); expect(false, "SAMPLE-AES refused"); }
        catch (java.io.IOException error) { expect(error.getMessage().contains("protected"), "SAMPLE-AES refused"); }

        expect(StreamDownloader.cleanName(" a/b:c*?\"<>| d ").equals("a b c d"), "file name cleaned");
        expect(StreamDownloader.cleanName("").equals("video"), "empty name becomes video");
    }
}
