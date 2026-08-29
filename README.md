<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="icons/auralang_logo_pack/presentation/wordmark-dark.png">
    <img src="icons/auralang_logo_pack/presentation/wordmark-light.png" alt="AuraLang — Real-time audio translation" width="420">
  </picture>
</p>

<p align="center">
  <strong>Real-time audio translation for any browser tab.</strong><br>
  Transcribes locally with Whisper, translates, and reads it back aloud — free by default, with optional external AI APIs.
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

Watching a talk, a podcast, or a video in a language you don't speak? AuraLang listens to the tab, translates on the fly, and speaks the result — so you can **watch the screen instead of reading subtitles**.

- 🎧 **Any tab with audio** — videos, calls, podcasts, live streams.
- 🧠 **On-device transcription** — Whisper runs locally; audio never leaves your machine.
- 🗣️ **Spoken translation** — the original tab audio is muted; you only hear the translation.
- 📊 **Live transcript with karaoke** — read the original + translation in a side panel; the line being spoken is highlighted.
- 🎚️ **Model modes** — Auto / Light (whisper-tiny) / Balanced (whisper-base): trade speed for accuracy per your device.
- 🔒 **Free by default** — Google Translate needs no key; an external OpenAI-compatible API is optional.
- 🌗 **Light & dark themes**, interface in **English, Spanish, and Simplified Chinese**.

## ⚙️ How it works

```
Tab audio ─▶ Whisper (local transcription) ─▶ Google Translate or your external API ─▶ Web Speech API (spoken output)
```

Audio is buffered and cut on natural speech pauses, transcribed on-device, translated, and read aloud through the browser's built-in voice. The original tab audio is muted while capturing.

## 🔌 Use an external AI API

The default **Google free** translation service does not require a key. To use an AI model instead, open **Settings** and choose **External API**. AuraLang accepts the OpenAI chat-completions format, so it works with OpenAI and compatible providers such as DeepSeek, Groq, OpenRouter, SiliconFlow, or a local Ollama server.

Enter the provider's API base URL, model name, and API key. AuraLang appends `/chat/completions` when necessary. When you start translation for the first time with a new API host, Chrome asks for permission to contact that host; declining the request keeps translation stopped.

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
4. On the tab you want to translate, click the AuraLang icon to open the **side panel**
5. Pick source & target languages, then hit **Start translation**

> The Whisper model downloads on first Start and is cached afterwards. Size depends on the model mode: Light ~150 MB, Balanced ~290 MB. Auto picks one from your device.

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
| Extension API | Chrome MV3 — `tabCapture`, `offscreen`, `sidePanel`, `storage` |
| Build | Vite + `@crxjs/vite-plugin` |
| UI | React 18 + TypeScript (strict) |
| Styles | Tailwind CSS |
| Transcription | Whisper via `@huggingface/transformers` (local, offscreen document) |
| Translation | Google Translate (free, default) or a user-configured OpenAI-compatible API |
| Speech | Web Speech API (`speechSynthesis`) |

## 📁 Project structure

```
src/
  asr/          # Model tiers/registry, model manager (probe ladder), inference queue
  background/   # Service worker — tabCapture + offscreen + side panel lifecycle
  offscreen/    # AudioContext + transcription / translation / TTS pipeline
  popup/        # React UI (rendered in the side panel)
    components/ # Header, StatusHero, WaveformIndicator, LanguageSelect, SettingsPanel, TranscriptFeed…
    hooks/      # useApiConfig, useTranslation, useI18n, useTheme
  welcome/      # First-install onboarding page
  services/     # transcriptionService, translationService, ttsService
  types/        # Shared TypeScript interfaces
```

## 🔐 Privacy

No backend, no telemetry, no account. Transcription happens on your device; the transcribed **text** is sent only to the selected translation service. Settings, including an optional external API key, are stored in `chrome.storage.local` on your machine. Full details in [PRIVACY.md](./PRIVACY.md).

## 📚 Docs

- [AGENTS.md](./AGENTS.md) — architecture, TypeScript, services, testing & accessibility conventions (source of truth for contributors).
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
