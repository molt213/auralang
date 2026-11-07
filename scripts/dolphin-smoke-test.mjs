// Node smoke test for the sherpa-onnx Dolphin integration path.
// Loads the exact wasm runtime that ships in the extension (after
// `npm run prepare-wasm`), writes the model into the Emscripten FS the way the
// worker does, and decodes a WAV sample.
//
// Requires the model files locally (not committed — ~250 MB):
//   model.int8.onnx (249,658,954 B) and tokens.txt (504,662 B) from
//   https://hf-mirror.com/csukuangfj/sherpa-onnx-dolphin-small-ctc-multi-lang-int8-2025-04-02/resolve/main/
// Place them (plus an optional 0.wav) in tmp/dolphin-model or pass a directory.
// Usage: npm run smoke:dolphin [wasmDir] [modelDir]
import { createRequire } from 'node:module'
import { copyFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [wasmDirArg, modelDirArg] = process.argv.slice(2)
const wasmDir = wasmDirArg ?? join(root, 'public', 'wasm', 'sherpa-onnx-vad-asr')
const modelDir = modelDirArg ?? join(root, 'tmp', 'dolphin-model')

const modelPath = join(modelDir, 'model.int8.onnx')
const tokensPath = join(modelDir, 'tokens.txt')
for (const path of [modelPath, tokensPath]) {
  if (!existsSync(path)) {
    console.error(
      `Missing ${path} — download model.int8.onnx (249,658,954 B) and tokens.txt (504,662 B) from https://hf-mirror.com/csukuangfj/sherpa-onnx-dolphin-small-ctc-multi-lang-int8-2025-04-02/resolve/main/ and re-run.`,
    )
    process.exit(1)
  }
}

function findWav(dir) {
  const direct = join(dir, '0.wav')
  try {
    statSync(direct)
    return direct
  } catch {
    // fall through to test_wavs/
  }
  const nested = join(dir, 'test_wavs', '0.wav')
  try {
    statSync(nested)
    return nested
  } catch {
    throw new Error(`no wav found in ${dir} (contents: ${readdirSync(modelDir).join(', ')})`)
  }
}

function parseWav(path) {
  const buf = readFileSync(path)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const channels = view.getUint16(22, true)
  const sampleRate = view.getUint32(24, true)
  const bitsPerSample = view.getUint16(34, true)
  if (bitsPerSample !== 16) throw new Error(`expected 16-bit pcm, got ${bitsPerSample}`)
  let offset = 36
  while (view.getUint32(offset, true) !== 0x61746164) {
    offset += 8 + view.getUint32(offset + 4, true)
    if (offset >= buf.length) throw new Error('data chunk not found')
  }
  offset += 8
  const samples = new Float32Array((buf.length - offset) / 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(offset + i * 2, true) / 32768
  }
  return { samples, sampleRate, channels }
}

let onRuntimeInitialized
const runtimeReady = new Promise((resolve) => {
  onRuntimeInitialized = resolve
})

const Module = {
  print: (text) => console.log('[wasm]', text),
  printErr: (text) => console.error('[wasm-err]', text),
  // Skip the glue's build-time-embedded .data package (base model + VAD);
  // this test writes the small model into the FS itself, as the worker will.
  skipBundledDataPackage: true,
  onRuntimeInitialized: () => {
    console.log('[test] runtime initialized')
    onRuntimeInitialized()
  },
}

const glueSrc = readFileSync(join(wasmDir, 'sherpa-onnx-wasm-main-vad-asr.js'), 'utf8')
// The glue is pthread-enabled: init spools up worker threads that reload the
// glue file. Node resolves it as ESM (package.json type: module) and dies on
// require(), so hand the pool a CommonJS copy of the same file. A real browser
// worker loads it as a classic script and needs none of this.
const pthreadGluePath = join(modelDir, 'sherpa-pthread-glue.cjs')
writeFileSync(pthreadGluePath, glueSrc)
copyFileSync(join(wasmDir, 'sherpa-onnx-wasm-main-vad-asr.wasm'), join(modelDir, 'sherpa-onnx-wasm-main-vad-asr.wasm'))

const loadGlue = new Function(
  'Module',
  'require',
  'exports',
  '__dirname',
  '__filename',
  'global',
  'self',
  'location',
  glueSrc,
)
Module.mainScriptUrlOrBlob = pthreadGluePath
Module.wasmBinary = readFileSync(join(wasmDir, 'sherpa-onnx-wasm-main-vad-asr.wasm'))
loadGlue(
  Module,
  require,
  {},
  wasmDir,
  join(wasmDir, 'sherpa-onnx-wasm-main-vad-asr.js'),
  globalThis,
  globalThis,
  { pathname: `/${join('wasm', 'sherpa-onnx-wasm-main-vad-asr.data')}` },
)

await runtimeReady

console.log('[test] loading model into wasm FS...')
// Same call shape the glue's own file packager uses; this build exports only
// the function (Module.FS_createDataFile), not the FS object.
Module.FS_createDataFile('/dolphin.onnx', null, readFileSync(modelPath), true, true, true)
Module.FS_createDataFile('/tokens.txt', null, readFileSync(tokensPath), true, true, true)

// The asr API wrapper is a classic script (module.exports at the end in node);
// load it the way a browser worker would via importScripts.
const asrSrc = readFileSync(join(wasmDir, 'sherpa-onnx-asr.js'), 'utf8')
const asrModule = { exports: {} }
new Function('module', 'exports', 'Module', asrSrc)(asrModule, asrModule.exports, Module)
const { OfflineRecognizer } = asrModule.exports

const config = {
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    dolphin: { model: '/dolphin.onnx' },
    tokens: '/tokens.txt',
    numThreads: 1,
    provider: 'cpu',
    debug: 1,
  },
}

console.log('[test] creating recognizer...')
const recognizer = new OfflineRecognizer(config, Module)
console.log('[test] recognizer ready')

const wav = parseWav(findWav(modelDir))
console.log(`[test] wav: ${wav.sampleRate} Hz, ${wav.channels} ch, ${(wav.samples.length / wav.sampleRate).toFixed(2)}s`)

const stream = recognizer.createStream()
stream.acceptWaveform(16000, wav.samples)
const started = Date.now()
recognizer.decode(stream)
const result = recognizer.getResult(stream)
console.log(`[test] decode took ${Date.now() - started} ms`)
console.log('[test] RESULT:', JSON.stringify(result, null, 2))
stream.free()
recognizer.free()
