# Dolphin ASR engine

The optional **Dolphin** transcription engine: DataoceanAI's Dolphin CTC-Attention model,
exported to ONNX by the [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) project
(Apache-2.0), tuned for Japanese (35k h ReazonSpeech) alongside 40 Asian languages
(212k h total). Chosen for Japanese live content over the shipped Whisper tiers:
published Japanese word-error rates are far better than whisper-base (FLEURS ja WER
5.5 vs 25.0 in the Dolphin paper) at a ~250 MB download.

## Architecture

`src/asr/dolphin/` (TypeScript, offscreen side) and `public/workers/sherpa-dolphin.worker.js`
(classic worker):

```
offscreen/index.ts ──▶ asrClient.ts (routes by tier.engine)
                        ├── whisper tiers ──▶ asrWorker.ts ──▶ modelManager (transformers.js)
                        └── sherpa-dolphin ──▶ dolphinClient.ts ──▶ public/workers/sherpa-dolphin.worker.js
                                                                         ├── sherpa-onnx wasm runtime (vendor/, staged by scripts/prepare-sherpa-wasm.mjs)
                                                                         ├── model download + IndexedDB cache (auralang-dolphin-models)
                                                                         └── OfflineRecognizer (dolphin CTC)
```

- Audio chunking/VAD stays in `audioCapture.ts` as for Whisper; each `TRANSCRIBE`
  message is one utterance. Dolphin does its own language detection (sherpa-onnx
  exposes no way to force a language — `OfflineDolphinModelConfig` has only a
  `model` field) and emits native punctuation. Because that detection can miss on
  marginal audio (a lone breath decoding to Korean on a Japanese stream), the
  pipeline drops decodes whose script the configured source language cannot
  produce (`isWrongLanguageOutput` in `utils/text.ts`), and the external-API
  translation prompt tells the model never to comment on odd input.
- Chunking is per engine (`src/asr/chunking.ts`), decided by
  `src/asr/chunkCutter.ts`: a full pause ends a chunk (Dolphin 1400 ms vs
  Whisper's 900 ms); past `softMaxMs` a 250 ms pause also ends it; and the
  safety cap (7 s / 5 s) cuts at the quietest point of the preceding
  `lookbackMs`, carrying the remainder into the next chunk instead of dropping
  it. The quiet test adapts to a background bed (music, game audio) when the
  last five seconds hold a bed clearly below the speech level — otherwise it
  keeps the fixed threshold, so bed-only audio is still sent for decoding.
- Why the cut point matters (measured with the real int8 model in a Node
  harness, clauses glued with 0.15 s gaps so speech crosses the cap):
  CTC cannot re-join a split utterance, and a mid-clause cut costs the
  continuation 0–90 % of its content — an 10.8 s utterance cut at 7 s left only
  "ようです。" of a 6.4 s clause (coverage 39 %), a 15 s one fell to 22 %. With
  the rules above the same audio cuts at the clause pause and every clause
  decodes in full (100 %). Chunks stay *bounded* on purpose: the model itself
  drops whole segments from inputs ≳11 s (a 34 s input lost a 6 s middle
  segment), so a bigger `maxChunkMs` is not the fix.
- A split that the rules cannot avoid (continuous speech over music) still
  leaves the next chunk starting mid-clause. Decoding that continuation on its
  own loses most of it — the same 7 s cut returned `"ようです。"` (28 % of the
  clause) — so a cap-split chunk is decoded with `seamRunInMs` (2 s) of the
  previous chunk's tail prepended (`audioCapture.ts`'s `seamRunIn`, replayed for
  previews too). On the same audio the run-in lifts coverage to 100 %, and the
  text pipeline strips the duplicated run at the seam: word overlap for spaced
  scripts, character overlap for Japanese/Chinese (`stripSeamRepeat` with
  `carriedSeam`). The run-in does not count toward the cut rules, and the
  decoded input stays ≤ 9 s, under the model's ~11 s limit.
- The cut is on acoustic pauses, so the caption boundary is not always a
  sentence boundary: a Japanese speaker can pause right after a case particle
  (`"…事前予告を。"` | `"させて頂ければと思いました。"`), and the second line is
  then translated without the object it belongs to. The line is therefore
  assembled first and segmented later: it stays open across short pauses and
  the safety cap, and across a full pause unless its text can end a sentence
  (`hasUnfinishedEnding`: binding particles, te-forms, clause and subordinate
  endings). When it stays open, `sentenceAssembly.ts` appends the next chunk
  (the recognizer's boundary period dropped), keeps the line's id, and the whole
  line is re-translated. Punctuation cannot drive this: the model closes every
  chunk with `。` even mid-clause (measured: `"…風で舞い。"`). A four-second
  dropped-silence gap, a two-extension limit and a 160-character cap keep a
  restart from inheriting a finished line.
- Model files (exact byte sizes, verified): `model.int8.onnx` 249,658,954 B,
  `tokens.txt` 504,662 B, from `csukuangfj/sherpa-onnx-dolphin-small-ctc-multi-lang-int8-2025-04-02`
  on huggingface.co, with hf-mirror.com and ModelScope as automatic fallbacks.
- The glue in the release tarball unconditionally fetches a build-time-embedded
  `.data` package (an older Dolphin *base* + VAD bundle). `prepare-sherpa-wasm.mjs`
  gates that call behind `Module.skipBundledDataPackage`; the build fails loudly
  if an upstream release changes the packaging shape.

## Runtime quirks (burned by real verification)

1. **Worker-relative URL resolution.** The Emscripten glue computes `_scriptName`
   from `self.location.href` — inside a worker that is *our* worker script, not the
   glue. It therefore 404s the `.wasm` and spawns pthread workers from the wrong
   file, hanging `onRuntimeInitialized` forever. The worker pins
   `Module.mainScriptUrlOrBlob` and `Module.locateFile` to the runtime directory.
2. **Stall timeout, not total timeout.** Model downloads must survive slow mirrors
   (0.6 MB/s seen on hf-mirror). A total `AbortSignal.timeout` kills any complete
   250 MB download; the worker uses a watchdog that only aborts when no bytes
   arrive for 30s, then tries the next source.
3. **SharedArrayBuffer works** in extension pages/workers despite
   `crossOriginIsolated === false` — the pthread pool wasm build runs fine.
4. **CSP**: the default MV3 CSP (`script-src 'self' 'wasm-unsafe-eval'`) suffices;
   model hosts send permissive CORS headers. No `web_accessible_resources` or
   `connect-src` entries are needed.

## Decode cost (measured, int8, 1 thread, wasm)

`tmp/dolphin-decode-cost.mjs` decodes one clip at increasing lengths on the
staged runtime (`node tmp/dolphin-decode-cost.mjs ja.wav 3`):

| audio | best | median | RTF |
| ----- | ---- | ------ | --- |
| 1 s   | 250 ms  | 251 ms  | 0.25 |
| 2 s   | 467 ms  | 481 ms  | 0.23 |
| 4 s   | 923 ms  | 932 ms  | 0.23 |
| 6 s   | 1435 ms | 1435 ms | 0.24 |
| 8 s   | 1984 ms | 2000 ms | 0.25 |

Cost is linear at roughly **240 ms per second of audio**, so decoding the buffer
that is still being spoken (0.7–7 s, the window the cutter produces) costs
0.2–1.7 s of CPU. `src/offscreen/previewPipeline.ts` is built on that number:
each provisional caption schedules the next preview at `400 ms + 2.2 × the
duration of the last one`, and previews are skipped whenever a real chunk is
being decoded — the settled caption always wins the recognizer. The provisional
line is translated by the service the user configured (streamed, so a slow model
still fills the line) and its translation is carried into the settled caption
until the real one arrives.

## Verification

- `npm run smoke:dolphin`-style Node harness (`scripts/dolphin-smoke-test.mjs`):
  loads the exact staged runtime, writes the model into the Emscripten FS, and
  decodes a WAV. Requires the model files in a local directory (see the header
  of the script for URLs).
- Browser E2E was exercised by loading the built extension headlessly, driving a
  debug page through `ENSURE_MODEL`/`TRANSCRIBE`, and transcribing a real Japanese
  sample (SenseVoiceSmall's `example/ja.mp3`) to the correct punctuated Japanese
  transcript. Not committed as an automated test (needs a 250 MB download and a
  browser).

## Not verified / follow-ups

- The full tab-capture UI flow (toolbar click → floating panel → Start) has not been
  exercised in CI; the worker protocol and routing are unit-tested.
- Japanese post-processing in `utils/text.ts` (`collapseRepeats`, `stripSeamRepeat`)
  is whitespace-oriented and largely no-ops on Japanese — worth a pass for the
  Dolphin tier.
- No download resume: an interrupted 250 MB download restarts from zero on the
  next attempt.
