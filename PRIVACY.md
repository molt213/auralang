# Privacy Policy — AuraLang

Last updated: 2026-07-01

AuraLang is a Chrome extension that translates the audio of your active browser tab in real time. This policy describes what data the extension accesses and how it is used.

## What AuraLang accesses

- **Tab audio**: when you click "Start translation," the extension captures the audio stream of your active tab (`tabCapture` permission) in order to transcribe and translate it. The original tab audio is muted while capturing.
- **Settings**: your source/target language, interface language, theme (dark/light), and optional external API configuration are stored locally via `chrome.storage.local`.

## What AuraLang does NOT do

- It does not collect personal identification data, health data, financial data, authentication credentials, personal communications, location, browsing history, or user activity (clicks, keystrokes).
- It does not have a backend server. There is no account, no login, no analytics, no telemetry.
- It does not sell or share user data with third parties for advertising or any purpose unrelated to providing the translation feature.

## How audio is processed

1. **Transcription**: audio is transcribed locally, on your own device. Two engines may be used:
   - **Whisper** (default) runs on `@huggingface/transformers` (ONNX Runtime WASM). Its model weights (~40–150 MB depending on the variant) are downloaded once from Hugging Face (huggingface.co) and cached locally.
   - **Dolphin** (optional, optimized for Japanese) runs on the sherpa-onnx WebAssembly runtime. Its model weights (~250 MB) are downloaded once from the Hugging Face mirror of the sherpa-onnx export (with hf-mirror.com and ModelScope as automatic fallbacks) and cached in your browser's IndexedDB.
   In both cases audio never leaves your device for transcription.
2. **Translation**: the transcribed text is sent solely to the translation service you select:
   - **Google** sends text to Google's public translation endpoint (`translate.googleapis.com`).
   - **MyMemory** sends text to MyMemory's public translation API (`api.mymemory.translated.net`), which applies its own free daily quota.
   - **Baidu** sends text to Baidu's translation API (`fanyi-api.baidu.com`) with the App ID and secret key you enter; Baidu applies its own quota. Only a hash of the secret key is sent, never the key itself.
   - **Bilibili Index-Translate** sends text to Bilibili's public translation endpoint (`index-translate.bilibili.com`). No key is required, and the preset never forwards a stored Baidu or external API key to that host. A `declarativeNetRequest` rule removes the browser's `Origin` header for requests to this host only, because Bilibili's WAF rejects extension origins; no other request or header is modified.
   - **External API** sends text to the OpenAI-compatible API host and model that you configure. Before connecting to a new external host, AuraLang requests Chrome permission for that specific host.
   If you enable a separate final translation service, the settled text is also sent to that provider.

## Data retention

Nothing is stored outside your browser by AuraLang. Settings persist in `chrome.storage.local` until you uninstall the extension or clear them manually. API credentials (an external API key, or a Baidu App ID and secret key) are stored in that local extension storage so they can authorize requests to your chosen host; AuraLang never includes them in the extension bundle or sends them to another host. Audio and transcribed text are processed in memory and are not saved anywhere by AuraLang. Your selected external provider may retain requests under its own policy.

## Contact

Questions about this policy can be raised via [GitHub Issues](https://github.com/CristinaFores/auralang/issues).
