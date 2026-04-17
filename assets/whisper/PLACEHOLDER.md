# Whisper setup

Download two files and place them here:

1. **whisper.exe** — from https://github.com/ggerganov/whisper.cpp/releases
   - Grab the latest Windows release ZIP, unpack, find `main.exe`, rename to `whisper.exe`
2. **ggml-base.bin** — from https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
   - ~140 MB, multilingual (English, Turkish, many more)
   - For higher quality use `ggml-small.bin` (~470 MB, slower) instead

Final layout:

```
assets/whisper/
├── whisper.exe
└── ggml-base.bin
```

Vex will auto-detect the files at startup. Until both are present, the Memory Recorder panel shows a setup guide.
