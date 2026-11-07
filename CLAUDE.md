# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

AuraLang is a Manifest V3 Chrome extension that translates the active tab's audio in real time: it captures tab audio, transcribes it locally, translates the text, and shows it as live captions. No backend, no API key.

`AGENTS.md` is the authoritative contract for stack, TypeScript, service boundaries, testing and accessibility conventions — read it before extending the code. This file focuses on commands and the cross-cutting architecture that isn't obvious from any single file.

## Commands

```bash
npm run dev         # Vite dev server (reload the extension manually after changes)
npm run build       # tsc + vite build → dist/
npm run type-check  # tsc --noEmit
npm run lint        # eslint .
npm run test        # Jest + React Testing Library (jsdom / node per file)
npm run zip         # package existing dist/ into dist.zip (run `build` first)
```

Run a single test file or pattern:

```bash
npm run test -- src/services/translationService.test.ts
npm run test -- -t "returns translated text"
```

**Loading the extension:** `npm run build`, then in `chrome://extensions` (Developer mode) → Load unpacked → select `dist/`. For the store, `npm run build && npm run zip` and upload `dist.zip` (Chrome requires a higher `manifest.json` version than the published one for each new upload).

Pre-release gate: `type-check`, `lint`, `test`, `build` must all pass (also enforced by CI in `.github/workflows/ci.yml`).

## Architecture: execution contexts

The extension runs across isolated JS contexts that communicate **only** via typed messages (`ExtensionMessage` / `MessageType` in `src/types/index.ts`). Understanding this boundary is essential:

- **`src/popup/`** — React UI, rendered inside the **floating panel iframe** injected into the page (not a side panel or popup window). Reads/writes user config via `chrome.storage.local`. Sends `START_CAPTURE`/`STOP_CAPTURE`; receives `MODEL_STATUS`, `TRANSCRIPT_UPDATE`, `CAPTURE_ENDED`, `ERROR`.
- **`src/background/index.ts`** — service worker. On toolbar-icon click it injects the floating panel into that tab (which also grants `activeTab` for the exact tab), redeems the `tabCapture` stream id, ensures the offscreen document exists, and relays `BEGIN_STREAM`/`END_STREAM`.
- **`src/offscreen/`** — the only context with `AudioContext` and WASM inference (a service worker has neither). Runs the whole audio pipeline.
- **`src/content/`** — page-side UI injected with `chrome.scripting.executeScript({ func })`: the caption overlay, the always-on-top captions button, and the floating panel host.

Pipeline (offscreen): `audioCapture.ts` captures tab audio and cuts it into chunks on natural speech pauses (VAD, not a fixed clock: full pause → short pause once the chunk is long → at the safety cap, the quietest point of a lookback window; rules in `src/asr/chunkCutter.ts`) → `inferenceQueue.ts` runs one chunk at a time (dropping oldest if it falls behind) → `pipeline.ts` calls transcription → translation. A cap-split continuation begins mid-clause, where Dolphin loses most of the clause, so `audioCapture` prepends a 2 s run-in of the previous chunk (`ChunkingProfile.seamRunInMs`) and `stripSeamRepeat` removes the duplicated run at the seam (character overlap for Japanese/Chinese). The original is assembled first and segmented later: a line stays open across short pauses and the cap, and across a full pause unless its text can end a sentence (`hasUnfinishedEnding` — binding particles, te-forms and subordinate endings), so `sentenceAssembly.ts` folds the next chunk in and re-translates the whole line; four seconds of dropped silence force a new line. The recognizer closes every chunk with a period even mid-clause, so punctuation is not used as a boundary.

Two things keep the captions close to live. The external API is asked to **stream** its answer, so the caption grows token by token (`partialThrottle.ts` holds that to ~8 updates/s). In parallel, `previewPipeline.ts` decodes the buffer that has **not** been cut yet and emits a provisional line — translated by the same service the settled caption uses (also streamed, so a slow model still fills the line). Because a Dolphin decode costs ~240 ms per second of audio (RTF ≈ 0.24, measured — see `docs/DOLPHIN_ENGINE.md`), each preview schedules the next one at `400 ms + 2.2 × its own duration`, so previews never starve the settled decodes.

The hand-off has three invariants, all enforced in `transcriptUpdates.ts` and mirrored in `videoSubtitleOverlay.ts`:
1. The provisional translation is remembered per segment (`previewTranslations.ts`) and is included in the settled `pending` update at the source, so the line never blanks out to “translating”.
2. The LLM stream only replaces the provisional line once it has a phrase of its own (`isStreamingTranslationReady`), then every later partial replaces the previous one.
3. A failed or skipped request keeps the provisional translation (with the failure marked subtly in the feed) rather than replacing it with an empty state. A completed translation is never walked backwards.
4. A line the next chunk continues is amended in place: its original grows, it returns to `pending`, and its translation restarts from the full sentence. A per-segment revision (`pipeline.ts`) makes the answer for the shorter text a stale message, and `transcriptUpdates.ts` refuses to shrink a row's original.

### On-page caption UI (content script)

`src/content/videoSubtitleOverlay.ts` is injected with `chrome.scripting.executeScript({ func })`, which **serializes the function** — it must stay self-contained (no imports and no module-scope references; type-only imports are fine, they are erased at build time). It renders one caption block in two hosts: the overlay above the video, and a Document Picture-in-Picture window toggled by a small button on the page. The window is owned by the page, so it lives and dies with the tab rather than with the panel; Chrome only opens it from a user gesture, which is why the trigger is a page button. Display rule for both hosts: a finalized segment that is still translating outranks the next utterance's provisional line.

`src/content/floatingPanel.ts` follows the same self-contained rule. It creates a Shadow-DOM host with a drag bar, resize grip, minimize/close controls, and an iframe pointing at `src/popup/index.html` (declared in `manifest.json` → `web_accessible_resources`). Geometry is persisted in `chrome.storage.local`. The toolbar icon toggles the panel; closing the panel does **not** stop capture, because the captions overlay and the always-on-top window are independent of it (the toolbar badge shows `REC` while capture runs). There is no `sidePanel` permission anymore — the panel floats over the page instead of shrinking it.

### Critical constraint: the offscreen document has almost no extension APIs

The offscreen document exposes **only** `chrome.runtime.getURL` and messaging. It does **not** have `chrome.storage` or `chrome.runtime.getManifest`. Consequences already baked in — do not reintroduce these:
- `src/asr/modelManager.ts` persists its bad-rung cache in `localStorage`, not `chrome.storage`.
- The extension version is imported from `manifest.json` at build time, not read via `getManifest()`.
- The user's model-mode preference lives in `chrome.storage` (popup only); the offscreen learns it from the `START_CAPTURE` payload, never by reading storage.

WASM is single-threaded on purpose (`numThreads = 1`): multi-thread WASM needs `SharedArrayBuffer`/COEP, which breaks `tabCapture` in the offscreen document.

## Architecture: ASR model tiers (`src/asr/`)

Model selection is data-driven via `registry.ts` (tiers) and `modelManager.ts` (loader). Two verified tiers ship today, both **fp32-only**:
- **Light** = `onnx-community/whisper-tiny` (~150 MB)
- **Balanced** = `onnx-community/whisper-base` (~290 MB)
- **Auto** picks between them from `navigator.hardwareConcurrency`/`deviceMemory`.

A fourth mode, **Dolphin**, is a different engine, not a tier variant: DataoceanAI's Dolphin CTC model (sherpa-onnx int8 export, ~250 MB) tuned for Japanese and other Asian languages. transformers.js cannot load it, so it has its own **classic** worker (`public/workers/sherpa-dolphin.worker.js`) running the sherpa-onnx WASM runtime (`vendor/sherpa-onnx-wasm/`, staged into `public/wasm/` by `scripts/prepare-sherpa-wasm.mjs`). `asrClient.ts` routes per tier: whisper tiers keep using the module ASR worker. Two runtime quirks baked in: the glue resolves `.wasm`/pthread worker URLs relative to `self.location.href`, so the worker pins `Module.mainScriptUrlOrBlob` and `Module.locateFile` to the runtime directory; and model downloads use a stall watchdog (per-source, not total timeout) with a hf-mirror/ModelScope fallback chain. See `docs/DOLPHIN_ENGINE.md`.

`modelManager` loads a tier via a **probe ladder**: it tries each dtype rung in order and falls through on session-creation failure, remembering broken rungs per machine + extension version.

**Do not add a quantized rung (q8/int8/q4) without verifying that specific export actually creates a session.** Both the `q8` and `int8` decoders of whisper-tiny/base are broken upstream (`Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale`, a MatMulNBits error); a rung that always throws is worse than not offering it. See `docs/ASR_ARCHITECTURE.md` for the full rationale and the (unshipped) Phase 3 plan.

The model downloads **on first Start**, never on panel open — that click is the user's consent, and the idle screen shows the model + size beforehand.

## Model & translation specifics

- Whisper weights are fetched once from Hugging Face and cached by transformers.js (browser Cache Storage). This is the "remote code" the store listing must justify — it's model data run in isolation via ONNX Runtime WASM, not executable code.
- Translation uses one of five providers: Google's free, unofficial `translate.googleapis.com` endpoint, MyMemory, Baidu's official API, Bilibili's keyless Index-Translate preset (`https://index-translate.bilibili.com/v1`), or a user-configured OpenAI-compatible endpoint. The source language is passed explicitly (Whisper already knows it) rather than auto-detected. Index-Translate keeps its fixed base URL and sends a placeholder key, so a stored Baidu secret or custom endpoint is never forwarded to Bilibili.
- The main provider fills **provisional captions**. An optional second `finalTranslation` config (OpenAI-compatible or the Index-Translate preset) can take over for settled translations; `resolveFinalTranslationConfig` in `src/offscreen/translationConfigs.ts` picks it. This split exists so a free service that is down cannot take the final translation down with it. With the final config disabled, the main provider handles both stages.
- `tabCapture` unavoidably triggers Chrome's generic "read and change all your data on all websites" warning for any extension; the extension only captures the chosen tab's audio and sends nothing to a backend.
