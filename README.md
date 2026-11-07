<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="icons/auralang_logo_pack/presentation/wordmark-dark.png">
    <img src="icons/auralang_logo_pack/presentation/wordmark-light.png" alt="AuraLang — Real-time audio translation" width="420">
  </picture>
</p>

<p align="center">
  <strong>Real-time audio translation for any browser tab.</strong><br>
  Transcribes locally with Whisper or Dolphin, translates, and shows live captions — free by default, with optional external AI APIs.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/pakdegbkjgibdjkpdniabdocffiejolo"><img alt="Available on the Chrome Web Store" src="https://img.shields.io/badge/Chrome_Web_Store-Available-22C55E?style=for-the-badge&logo=googlechrome&logoColor=white"></a>
</p>

<p align="center">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-6C4DFF">
  <img alt="React 18" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-build-646CFF?logo=vite&logoColor=white">
  <img alt="No API key" src="https://img.shields.io/badge/API_key-not_required-22C55E">
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
</p>

---

## 📥 Install

**[Add AuraLang from the Chrome Web Store →](https://chromewebstore.google.com/detail/pakdegbkjgibdjkpdniabdocffiejolo)**

Prefer to run it from source? See [Run it locally](#-run-it-locally).

## ✨ What it does

Watching a talk, a podcast, or a video in a language you don't speak? AuraLang listens to the tab, translates on the fly, and shows the result as live captions — in a floating panel and on top of the video.

- 🎧 **Any tab with audio** — videos, calls, podcasts, live streams.
- 🧠 **On-device transcription** — Whisper runs locally; audio never leaves your machine.
- 🔊 **Original audio kept** — Chrome mutes a captured tab; AuraLang replays the original at a level you control (defaults to a quiet background, adjustable live up to full volume).
- 📊 **Live transcript** — read the original + translation in a draggable floating panel that never shrinks the page.
- 🎬 **On-video subtitles** — the latest original and translation appear at the bottom of the active video.
- 🪟 **Always-on-top captions** — click the button on the video to pop the captions into a floating window you can drag anywhere, even over other apps.
- ⚡ **Captions that keep up** — a provisional translation appears while the speaker is still talking, then the AI-model translation streams in and replaces it without blanking the line.
- 🎚️ **Model modes** — Auto / Light (whisper-tiny) / Balanced (whisper-base) / Dolphin (Japanese-optimized CTC): trade speed for accuracy per your device.
- 🔒 **Free by default** — Google, MyMemory, or Bilibili's Index-Translate need no key; Baidu's free monthly quota and external OpenAI-compatible APIs are optional.
- 🌗 **Light & dark themes**, interface in **English, Spanish, and Simplified Chinese**.

## ⚙️ How it works

```
Tab audio ─▶ Whisper / Dolphin (local transcription) ─▶ Google / MyMemory / Baidu / Index-Translate / external API ─▶ live captions (floating panel + on-video subtitles + always-on-top window)
```

Audio is buffered and cut on natural speech pauses, transcribed on-device, translated, and shown as live captions. Chrome mutes a captured tab, so the original audio is replayed by the extension at a level you choose (defaults to a quiet background).

## 🔌 Use an external AI API

The free **Google** and **MyMemory** translation services do not require a key; if Google is unreachable on your network, pick MyMemory in Settings. **Baidu** works with a Baidu Translate App ID and secret key (free monthly quota after identity verification). **Bilibili Index-Translate** is built in as a keyless free preset of Bilibili's public OpenAI-compatible endpoint; pick 35B-A3B for quality or 9B/2B for speed. Bilibili's WAF rejects requests whose `Origin` is a `chrome-extension://` URL, so a `declarativeNetRequest` rule removes that header for `index-translate.bilibili.com` only. To use another AI model, choose **External API**. AuraLang accepts the OpenAI chat-completions format, so it works with OpenAI and compatible providers such as DeepSeek, Groq, OpenRouter, SiliconFlow, or a local Ollama server.

Enter the provider's API base URL, model name, and API key. AuraLang appends `/chat/completions` when necessary. When you start translation for the first time with a new API host, Chrome asks for permission to contact that host; declining the request keeps translation stopped.

AuraLang can also split the two translation roles. Choose a free service (Google, MyMemory, or Baidu) as the main provider for **provisional captions**, then enable **Final translation** and pick either the built-in Index-Translate preset or your own OpenAI-compatible endpoint. The fast service fills the line while the speaker is still talking; when the utterance settles, the final translation streams from the chosen model. If the free service is unreachable, the provisional line is skipped but the final translation still arrives. With final translation disabled, the main provider handles both stages.

Examples:

| Provider | API base URL | Model name |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Ollama (local) | `http://localhost:11434/v1` | your locally installed model |

Your key is stored only in `chrome.storage.local` for this browser profile. It is never included in the extension bundle or sent anywhere other than the API host you select. External providers may charge for API use; check the provider's pricing before starting a stream.

## 🚀 Run it locally

**Requirements:** Google Chrome 116+

```bash
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** → select the `dist/` folder
4. On the tab you want to translate, click the AuraLang icon to open the **floating panel**
5. Pick source & target languages, then hit **Start translation**
> The Whisper/Dolphin model downloads on first Start and is cached afterwards. Size depends on the model mode: Light ~150 MB, Balanced ~290 MB, Dolphin ~250 MB. Auto picks a Whisper tier from your device.

## 🛠️ Development

```bash
npm run dev         # Vite dev server (reload the extension after changes)
npm run type-check  # TypeScript, no emit
npm run lint        # ESLint
npm run test        # Jest + React Testing Library
npm run zip         # Build + package dist.zip for the Web Store
```

## 🧱 Tech stack

| Layer | Tool |
|---|---|
| Extension API | Chrome MV3 — `tabCapture`, `offscreen`, `scripting`, `storage` |
| Build | Vite + `@crxjs/vite-plugin` |
| UI | React 18 + TypeScript (strict) |
| Styles | Tailwind CSS |
| Transcription | Whisper via `@huggingface/transformers` (local, offscreen document) or the Dolphin CTC model via the sherpa-onnx WASM runtime (Japanese-optimized) |
| Translation | Google Translate (free, default), MyMemory, Baidu, Bilibili Index-Translate (free, built in), or a user-configured OpenAI-compatible API |

## 📁 Project structure

```
src/
  asr/          # Model tiers/registry, model manager (probe ladder), inference queue, Dolphin engine client
  background/   # Service worker — tabCapture, offscreen lifecycle, panel injection
  content/      # Injected page overlay, floating control panel, always-on-top captions
  offscreen/    # AudioContext + transcription / translation pipeline
  popup/        # React UI (rendered inside the floating panel iframe)
    components/ # Header, StatusCircle/StatusStrip, LanguageSelect, SettingsPanel, TranscriptFeed…
    hooks/      # useApiConfig, useTranslation, useI18n, useTheme
  welcome/      # First-install onboarding page
  services/     # transcriptionService, translationService
  types/        # Shared TypeScript interfaces
public/
  workers/      # Dolphin classic worker (sherpa-onnx WASM runtime)
  wasm/         # Staged sherpa-onnx runtime (built by scripts/prepare-sherpa-wasm.mjs from vendor/)
vendor/         # Pristine sherpa-onnx WASM runtime + Apache-2.0 LICENSE
```

## 🔐 Privacy

No backend, no telemetry, no account. Transcription happens on your device; the transcribed **text** is sent only to the selected translation service. Settings, including an optional external API key, are stored in `chrome.storage.local` on your machine. Full details in [PRIVACY.md](./PRIVACY.md).

## 📚 Docs

- [AGENTS.md](./AGENTS.md) — architecture, TypeScript, services, testing & accessibility conventions (source of truth for contributors).
- [docs/DOLPHIN_ENGINE.md](./docs/DOLPHIN_ENGINE.md) — the optional Dolphin (Japanese) ASR engine: layout, runtime quirks, verification.
- [CONTRIBUTING.md](./CONTRIBUTING.md) — setup, branching, commit conventions.
- [PRIVACY.md](./PRIVACY.md) — privacy policy.
- [DISCLAIMER.md](./DISCLAIMER.md) — accuracy limitations, third-party services, no affiliation.
- [SECURITY.md](./SECURITY.md) — how to report a vulnerability.
- [LICENSE](./LICENSE) — MIT.

## 📦 Publishing

```bash
npm run zip
```

Upload `dist.zip` to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).

---

<p align="center"><sub>Built with care — concepts before code.</sub></p>
